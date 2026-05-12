-- ============================================================================
-- Migration 055: stamp_broiler_batch_avg RPC
-- ----------------------------------------------------------------------------
-- Public-safe broiler week-avg stamping for app_store.ppp-v4.
--
-- Background: WeighInsWebform.finalizeSession (anon) called
-- writeBroilerBatchAvg in src/lib/broiler.js, which read app_store.ppp-v4 +
-- upserted it client-side. PROD anon RLS silently returns 0 rows on
-- app_store SELECT, so resp.data was always null and the upsert never
-- fired -- public broiler completions never stamped week4Lbs / week6Lbs on
-- the batch row.
--
-- Fix: a SECURITY DEFINER RPC that runs the same compute + write
-- server-side. Same posture as migration 049 (pig_session_metrics): the
-- RPC is the ONLY new anon-reachable surface. app_store's existing RLS
-- stays untouched -- no direct anon grants on the table.
--
-- Lifecycle:
--   1. Caller flips the session row to status='complete'.
--   2. Caller calls stamp_broiler_batch_avg(session_id).
--   3. RPC validates session is a complete broiler week-4 or week-6 session
--      with a batch_id, reads weigh_ins, computes the rounded avg, takes
--      FOR UPDATE on the app_store.ppp-v4 row, mutates the matching batch,
--      and upserts the result.
--
-- Return shape: jsonb
--   {ok:true,  applied:true,  week, avg, batch}    -- happy path
--   {ok:true,  applied:false, reason}              -- benign no-op
--                                                     (no entries / no
--                                                      matching batch /
--                                                      ppp-v4 absent)
--   RAISE EXCEPTION                                -- session shape bad
--                                                     OR DB error
--
-- Why FOR UPDATE on app_store.ppp-v4: this RPC is a read-mutate-write on a
-- single jsonb blob. Two near-simultaneous completes (or admin metadata
-- edits via writeBroilerBatchAvg) could lose one batch's stamp under
-- last-read-wins. FOR UPDATE serializes the read-mutate-write.
--
-- Why strict status='complete' gate: matches writeBroilerBatchAvg's
-- existing contract -- draft saves never bleed into the batch tile.
-- WeighInsWebform.finalizeSession is the only public caller and only
-- invokes the RPC AFTER a successful update to status='complete'.
--
-- Tagged dollar-quote $broiler_batch_avg$ so the test bootstrap's exec_sql
-- (itself defined with plain $$) can EXECUTE this migration without
-- nested-quote collisions.
--
-- Idempotent: CREATE OR REPLACE FUNCTION. Re-running the RPC for the same
-- session is stable -- recomputes the same avg from the same entries and
-- overwrites the same field.
-- ============================================================================

BEGIN;

CREATE OR REPLACE FUNCTION public.stamp_broiler_batch_avg(
  session_id_in text
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $broiler_batch_avg$
DECLARE
  v_session        record;
  v_week           int;
  v_field_key      text;
  v_sum            numeric := 0;
  v_count          int     := 0;
  v_avg            numeric;
  v_ppp            jsonb;
  v_updated        jsonb;
  v_touched        boolean := false;
  v_item           jsonb;
  v_new_item       jsonb;
BEGIN
  IF session_id_in IS NULL OR session_id_in = '' THEN
    RAISE EXCEPTION 'stamp_broiler_batch_avg: session_id required';
  END IF;

  SELECT id, species, status, batch_id, broiler_week
    INTO v_session
    FROM public.weigh_in_sessions
   WHERE id = session_id_in;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'stamp_broiler_batch_avg: session % not found', session_id_in;
  END IF;

  IF v_session.species IS DISTINCT FROM 'broiler' THEN
    RAISE EXCEPTION
      'stamp_broiler_batch_avg: species must be broiler; got %',
      v_session.species;
  END IF;

  IF v_session.status IS DISTINCT FROM 'complete' THEN
    RAISE EXCEPTION
      'stamp_broiler_batch_avg: session % must be complete; got %',
      session_id_in, v_session.status;
  END IF;

  IF v_session.batch_id IS NULL OR v_session.batch_id = '' THEN
    RAISE EXCEPTION
      'stamp_broiler_batch_avg: session % has no batch_id',
      session_id_in;
  END IF;

  v_week := v_session.broiler_week;
  IF v_week IS NULL OR v_week NOT IN (4, 6) THEN
    RAISE EXCEPTION
      'stamp_broiler_batch_avg: broiler_week must be 4 or 6; got %',
      v_week;
  END IF;
  v_field_key := CASE v_week WHEN 4 THEN 'week4Lbs' ELSE 'week6Lbs' END;

  -- Compute avg from valid weights only (>0). No usable entries is a
  -- benign no-op, mirroring writeBroilerBatchAvg's behaviour.
  SELECT COALESCE(SUM(weight), 0)::numeric, COUNT(*)::int
    INTO v_sum, v_count
    FROM public.weigh_ins
   WHERE session_id = session_id_in
     AND weight IS NOT NULL
     AND weight > 0;

  IF v_count = 0 THEN
    RETURN jsonb_build_object(
      'ok',       true,
      'applied',  false,
      'reason',   'no valid weights'
    );
  END IF;
  v_avg := round((v_sum / v_count)::numeric, 2);

  -- Serialize read-mutate-write on the ppp-v4 row. The `data` column on
  -- app_store stores the batches array directly (no wrapper object); see
  -- writeBroilerBatchAvg upsert in src/lib/broiler.js for the matching
  -- write shape.
  SELECT data
    INTO v_ppp
    FROM public.app_store
   WHERE key = 'ppp-v4'
   FOR UPDATE;

  IF v_ppp IS NULL OR jsonb_typeof(v_ppp) IS DISTINCT FROM 'array' THEN
    RETURN jsonb_build_object(
      'ok',       true,
      'applied',  false,
      'reason',   'ppp-v4 missing'
    );
  END IF;

  -- Walk the array, replace the matching batch with a copy that has
  -- v_field_key set to v_avg. Re-emit untouched siblings verbatim.
  v_updated := '[]'::jsonb;
  FOR v_item IN SELECT jsonb_array_elements(v_ppp)
  LOOP
    IF v_item ->> 'name' = v_session.batch_id THEN
      v_new_item := jsonb_set(v_item, ARRAY[v_field_key], to_jsonb(v_avg), true);
      v_updated := v_updated || jsonb_build_array(v_new_item);
      v_touched := true;
    ELSE
      v_updated := v_updated || jsonb_build_array(v_item);
    END IF;
  END LOOP;

  IF NOT v_touched THEN
    -- Lock is released by COMMIT. No write needed.
    RETURN jsonb_build_object(
      'ok',       true,
      'applied',  false,
      'reason',   'batch not found in ppp-v4'
    );
  END IF;

  UPDATE public.app_store
     SET data = v_updated,
         updated_at = now()
   WHERE key = 'ppp-v4';

  RETURN jsonb_build_object(
    'ok',       true,
    'applied',  true,
    'week',     v_week,
    'avg',      v_avg,
    'batch',    v_session.batch_id
  );
END;
$broiler_batch_avg$;

REVOKE ALL ON FUNCTION public.stamp_broiler_batch_avg(text) FROM public;
GRANT EXECUTE ON FUNCTION public.stamp_broiler_batch_avg(text) TO anon, authenticated;

COMMIT;
