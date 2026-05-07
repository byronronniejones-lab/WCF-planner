-- ============================================================================
-- 049_pig_session_metrics_rpc.sql
-- ----------------------------------------------------------------------------
-- Public-safe pig weigh-in session metrics RPC.
--
-- Surfaces aggregate metrics (weighed count, avg weight, group ADG, age
-- range, feed/pig) for a pig weigh-in session WITHOUT exposing the underlying
-- private stores (app_store, pig_dailys) to the anon client. SECURITY
-- DEFINER lets the function read those server-side; anon EXECUTE grants the
-- public form access to aggregates only.
--
-- Anon scope (R1): species='pig' AND status='draft' (the only public-active
-- status in the weigh_in_sessions check constraint, see archive/001_cattle_module.sql
-- line 150). Other sessions return available=false with null fields.
--
-- Authenticated scope: any pig session, including history. No new SQL role
-- gate — UI role gating remains a separate concern.
--
-- Group ADG (R2): rank-matched (lightest-to-heaviest pairing, average gain
-- across paired ranks, divided by day diff). Robust to unequal session
-- counts.
--
-- Persisted shape (planned trips, etc.) is unchanged. This migration only
-- ADDS read-side helpers; no policies modified, no tables created or
-- altered, no new direct GRANTS on app_store or pig_dailys.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- Drop any prior signature variants. CREATE OR REPLACE FUNCTION only matches
-- on identical (name + arg list); changing arg types would otherwise leave a
-- stale signature behind that PostgREST then refuses to disambiguate
-- (PGRST203). Idempotent on a clean DB.
-- ----------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.pig_session_metrics(uuid);

-- ----------------------------------------------------------------------------
-- pig_slug helper — IMMUTABLE; mirrors src/lib/pig.js pigSlug exactly.
-- Lowercase + collapse non-alphanumeric runs to '-' + trim leading/trailing
-- dashes. 'P-26-01A' -> 'p-26-01a' (no separating dash before the letter
-- because lowercase A and 0-9 are both alphanumeric).
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.pig_slug(s text)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT trim(both '-' FROM regexp_replace(
           lower(coalesce(s, '')),
           '[^a-z0-9]+',
           '-',
           'g'
         ))
$$;

GRANT EXECUTE ON FUNCTION public.pig_slug(text) TO anon, authenticated;

-- ----------------------------------------------------------------------------
-- pig_session_metrics — main aggregate RPC.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.pig_session_metrics(session_id_in text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_role                  text := COALESCE(auth.role(), 'anon');
  v_session               record;
  v_session_date          date;
  v_batch_slug            text;

  v_feeders               jsonb;
  v_group                 jsonb;
  v_sub                   jsonb;
  v_sub_id                text;
  v_sub_name              text;
  v_parent_group          jsonb;
  v_started_count         integer;

  v_cycles                jsonb;
  v_cycle                 jsonb;
  v_exposure_start        date;
  v_farrowing_start       date;
  v_farrowing_end         date;
  v_farrowings            jsonb;
  v_first_farrow          date;
  v_last_farrow           date;
  v_rec_count             integer;
  v_age_min_days          integer;
  v_age_max_days          integer;
  v_has_actual            boolean := false;

  v_weighed_count         integer := 0;
  v_avg_weight            numeric;

  v_prior_session_id      text;
  v_prior_session_date    date;
  v_days_diff             integer;
  v_group_adg             numeric;

  v_legacy_feed           numeric := 0;
  v_dailys_feed           numeric := 0;
  v_feed_total            numeric;
  v_feed_pig_count        integer;
  v_feed_per_pig          numeric;

  v_mortality_count       integer := 0;
  v_trip_attribution      integer := 0;

  v_breeders              jsonb;
  v_transfer_count        integer := 0;

  v_unavailable           jsonb;
  v_scope                 text;
BEGIN
  -- Caller-visible scope label. authenticated and service_role both map to
  -- the 'authenticated' bucket — service_role is at least as privileged as
  -- authenticated, so admin SQL/CLI callers should see the same view as
  -- a logged-in admin. Everything else (anon, no role) falls back to 'anon'.
  v_scope := CASE WHEN v_role IN ('authenticated', 'service_role') THEN 'authenticated' ELSE 'anon' END;

  v_unavailable := jsonb_build_object(
    'session_id', session_id_in,
    'species', NULL,
    'batch_id', NULL,
    'sub_batch_id', NULL,
    'session_date', NULL,
    'weighed_count', 0,
    'avg_weight_lbs', NULL,
    'prior_session_id', NULL,
    'prior_session_date', NULL,
    'group_adg_lbs_per_day', NULL,
    'age_min_days', NULL,
    'age_max_days', NULL,
    'has_actual_farrowing', false,
    'feed_total_lbs', NULL,
    'feed_pig_count', NULL,
    'feed_per_pig_lbs', NULL,
    'scope', v_scope,
    'available', false
  );

  -- 1. Resolve session.
  SELECT id, species, status, batch_id, date
    INTO v_session
    FROM public.weigh_in_sessions
    WHERE id = session_id_in;

  IF NOT FOUND THEN
    RETURN v_unavailable;
  END IF;

  -- 2. Species + scope guards.
  IF v_session.species IS DISTINCT FROM 'pig' THEN
    RETURN jsonb_set(
      v_unavailable,
      '{species}',
      to_jsonb(v_session.species)
    );
  END IF;

  IF v_scope = 'anon' AND v_session.status <> 'draft' THEN
    RETURN jsonb_set(
      jsonb_set(v_unavailable, '{species}', to_jsonb('pig'::text)),
      '{batch_id}',
      to_jsonb(v_session.batch_id)
    );
  END IF;

  v_session_date := v_session.date;
  v_batch_slug := public.pig_slug(v_session.batch_id);

  -- 3. Resolve sub-batch from app_store.ppp-feeders-v1.
  SELECT data INTO v_feeders FROM public.app_store WHERE key = 'ppp-feeders-v1';
  IF v_feeders IS NOT NULL THEN
    FOR v_group IN SELECT jsonb_array_elements(v_feeders)
    LOOP
      FOR v_sub IN SELECT jsonb_array_elements(COALESCE(v_group->'subBatches', '[]'::jsonb))
      LOOP
        IF public.pig_slug(v_sub->>'name') = v_batch_slug THEN
          v_sub_id := v_sub->>'id';
          v_sub_name := v_sub->>'name';
          v_parent_group := v_group;
          v_started_count := COALESCE((v_sub->>'giltCount')::int, 0)
                           + COALESCE((v_sub->>'boarCount')::int, 0);
          EXIT;
        END IF;
      END LOOP;
      EXIT WHEN v_sub_id IS NOT NULL;
    END LOOP;
  END IF;

  -- 4. Session-level weights.
  SELECT COUNT(*)::int, AVG(weight)
    INTO v_weighed_count, v_avg_weight
    FROM public.weigh_ins
    WHERE session_id = session_id_in
      AND weight IS NOT NULL
      AND weight > 0;
  IF v_weighed_count = 0 THEN
    v_avg_weight := NULL;
  END IF;

  -- 5. Prior pig session for the same batch_id slug.
  SELECT id, date
    INTO v_prior_session_id, v_prior_session_date
    FROM public.weigh_in_sessions s
    WHERE s.species = 'pig'
      AND public.pig_slug(s.batch_id) = v_batch_slug
      AND s.date < v_session_date
    ORDER BY s.date DESC, s.started_at DESC NULLS LAST
    LIMIT 1;

  -- 6. Rank-matched group ADG.
  IF v_prior_session_id IS NOT NULL THEN
    v_days_diff := v_session_date - v_prior_session_date;
    IF v_days_diff > 0 THEN
      WITH cur AS (
        SELECT weight,
               ROW_NUMBER() OVER (ORDER BY weight ASC, id ASC) AS rk
          FROM public.weigh_ins
          WHERE session_id = session_id_in AND weight IS NOT NULL AND weight > 0
      ),
      prior AS (
        SELECT weight,
               ROW_NUMBER() OVER (ORDER BY weight ASC, id ASC) AS rk
          FROM public.weigh_ins
          WHERE session_id = v_prior_session_id AND weight IS NOT NULL AND weight > 0
      ),
      matched AS (
        SELECT (cur.weight - prior.weight) AS gain
          FROM cur
          INNER JOIN prior ON cur.rk = prior.rk
      )
      SELECT AVG(gain) / v_days_diff INTO v_group_adg FROM matched;
    END IF;
  END IF;

  -- 7. Age range from breeding cycle + farrowing records.
  IF v_parent_group IS NOT NULL AND (v_parent_group ? 'cycleId') THEN
    SELECT data INTO v_cycles FROM public.app_store WHERE key = 'ppp-breeding-v1';
    IF v_cycles IS NOT NULL THEN
      SELECT cy
        INTO v_cycle
        FROM jsonb_array_elements(v_cycles) cy
        WHERE cy->>'id' = (v_parent_group->>'cycleId')
        LIMIT 1;
    END IF;

    IF v_cycle IS NOT NULL AND (v_cycle->>'exposureStart') IS NOT NULL THEN
      v_exposure_start := (v_cycle->>'exposureStart')::date;
      -- BOAR_EXPOSURE_DAYS=45, GESTATION_DAYS=116; mirrors src/lib/pig.js.
      v_farrowing_start := v_exposure_start + 116;
      v_farrowing_end := v_exposure_start + 160; -- (45 - 1) + 116 = 160

      SELECT data INTO v_farrowings FROM public.app_store WHERE key = 'ppp-farrowing-v1';

      IF v_farrowings IS NOT NULL THEN
        SELECT MIN(d), MAX(d), COUNT(*)::int
          INTO v_first_farrow, v_last_farrow, v_rec_count
          FROM (
            SELECT (rec->>'farrowingDate')::date AS d
              FROM jsonb_array_elements(v_farrowings) rec
              WHERE rec->>'group' = (v_cycle->>'group')
                AND rec->>'farrowingDate' IS NOT NULL
                AND (rec->>'farrowingDate')::date BETWEEN v_farrowing_start AND v_farrowing_end + 14
          ) sub;
      ELSE
        v_rec_count := 0;
      END IF;

      IF v_rec_count > 0 THEN
        v_age_max_days := v_session_date - v_first_farrow;
        v_age_min_days := v_session_date - v_last_farrow;
        v_has_actual := true;
      ELSE
        v_age_max_days := v_session_date - v_farrowing_start;
        v_age_min_days := v_session_date - v_farrowing_end;
        v_has_actual := false;
      END IF;

      -- Not yet born: clamp both to NULL when oldest is non-positive.
      IF v_age_max_days IS NOT NULL AND v_age_max_days <= 0 THEN
        v_age_max_days := NULL;
        v_age_min_days := NULL;
      ELSIF v_age_min_days IS NOT NULL AND v_age_min_days < 0 THEN
        v_age_min_days := 0;
      END IF;
    END IF;
  END IF;

  -- 8. Ledger-aware feed_pig_count.
  --    started − mortality − transfers − processing-trip attributions.
  --    Mortality and trip attributions read from v_parent_group; transfers
  --    read from app_store.ppp-breeders-v1. None of these arrays carry a
  --    date filter today; v1 sums all known events. Future refinement can
  --    add session_date filters when those records gain dates.
  IF v_sub_id IS NOT NULL AND v_started_count IS NOT NULL THEN
    SELECT COALESCE(SUM(COALESCE((m->>'count')::int, 0)), 0)::int
      INTO v_mortality_count
      FROM jsonb_array_elements(COALESCE(v_parent_group->'pigMortalities', '[]'::jsonb)) m
      WHERE m->>'sub_batch_name' = v_sub_name;

    SELECT COALESCE(SUM(att_count), 0)::int
      INTO v_trip_attribution
      FROM (
        SELECT COALESCE((att->>'count')::int, 0) AS att_count
          FROM jsonb_array_elements(COALESCE(v_parent_group->'processingTrips', '[]'::jsonb)) trip
          CROSS JOIN LATERAL jsonb_array_elements(COALESCE(trip->'subAttributions', '[]'::jsonb)) att
          WHERE att->>'subId' = v_sub_id
      ) trip_atts;

    SELECT data INTO v_breeders FROM public.app_store WHERE key = 'ppp-breeders-v1';
    IF v_breeders IS NOT NULL THEN
      SELECT COUNT(*)::int
        INTO v_transfer_count
        FROM jsonb_array_elements(v_breeders) br
        WHERE br ? 'transferredFromBatch'
          AND (br->'transferredFromBatch'->>'batchName') = (v_parent_group->>'batchName')
          AND (br->'transferredFromBatch'->>'subBatchName') = v_sub_name;
    END IF;

    v_feed_pig_count := v_started_count - v_mortality_count - v_trip_attribution - v_transfer_count;
    IF v_feed_pig_count < 0 THEN
      v_feed_pig_count := 0;
    END IF;
  END IF;

  -- 9. Feed total: sub.legacyFeedLbs + sum(pig_dailys.feed_lbs through session_date)
  --    matched on the sub's name (case-insensitive + slug fallback, mirroring
  --    src/pig/PigBatchesView.jsx dailysForName).
  IF v_sub_name IS NOT NULL THEN
    v_legacy_feed := COALESCE((v_sub->>'legacyFeedLbs')::numeric, 0);

    SELECT COALESCE(SUM(d.feed_lbs), 0)::numeric
      INTO v_dailys_feed
      FROM public.pig_dailys d
      WHERE d.date IS NOT NULL
        AND d.date <= to_char(v_session_date, 'YYYY-MM-DD')
        AND d.feed_lbs IS NOT NULL
        AND (
          lower(coalesce(d.batch_label, '')) = lower(v_sub_name)
          OR lower(coalesce(d.batch_id, '')) = lower(v_sub_name)
          OR public.pig_slug(d.batch_label) = public.pig_slug(v_sub_name)
          OR public.pig_slug(d.batch_id) = public.pig_slug(v_sub_name)
        );

    v_feed_total := v_legacy_feed + v_dailys_feed;
    IF v_feed_pig_count IS NOT NULL AND v_feed_pig_count > 0 THEN
      v_feed_per_pig := v_feed_total / v_feed_pig_count;
    END IF;
  END IF;

  RETURN jsonb_build_object(
    'session_id',           session_id_in,
    'species',              'pig',
    'batch_id',             v_session.batch_id,
    'sub_batch_id',         v_sub_id,
    'session_date',         v_session_date,
    'weighed_count',        v_weighed_count,
    'avg_weight_lbs',       v_avg_weight,
    'prior_session_id',     v_prior_session_id,
    'prior_session_date',   v_prior_session_date,
    'group_adg_lbs_per_day',v_group_adg,
    'age_min_days',         v_age_min_days,
    'age_max_days',         v_age_max_days,
    'has_actual_farrowing', v_has_actual,
    'feed_total_lbs',       v_feed_total,
    'feed_pig_count',       v_feed_pig_count,
    'feed_per_pig_lbs',     v_feed_per_pig,
    'scope',                v_scope,
    'available',            true
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.pig_session_metrics(text) TO anon, authenticated;

-- ============================================================================
-- End of 049_pig_session_metrics_rpc.sql
-- No new direct grants on app_store, pig_dailys, breeders/farrowings/cycles
-- jsonb stores — those tables stay at their existing access level. The RPC
-- is the only NEW anon-reachable surface introduced by this migration.
-- ============================================================================
