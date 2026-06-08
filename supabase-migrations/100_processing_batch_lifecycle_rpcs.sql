-- ============================================================================
-- 100_processing_batch_lifecycle_rpcs.sql
-- ----------------------------------------------------------------------------
-- Audit-grade transactional processing-batch DELETE/UNSCHEDULE RPCs for the
-- AUTHENTICATED app (CattleBatchPage / SheepBatchPage). These replace the last
-- direct client hard-deletes of processing-batch roots:
--
--   * CattleBatchPage.handleUnschedule did
--       sb.from('cattle_processing_batches').delete().eq('id', batch.id)
--     with no audit trail.
--   * SheepBatchPage.handleDeleteBatch did, AFTER the per-sheep detach loop,
--       sb.from('sheep').update({processing_batch_id: null}).eq(...)   (straggler clear)
--       sb.from('sheep_processing_batches').delete().eq('id', batch.id) (no audit)
--     as two SEPARATE client writes — not atomic with each other.
--
-- This migration moves the straggler-clear + row delete into one transaction
-- and writes a record.deleted Activity event in the same transaction, so the
-- hard delete is both atomic and audited.
--
-- Permission shape mirrors the detach RPCs (migration 081): admin OR management
-- only, enforced IN the function (SECURITY DEFINER is for cross-row atomicity,
-- NOT to broaden who may delete). REVOKE from PUBLIC/anon; GRANT to
-- authenticated. Auth/role violations RAISE — the UI never reaches them.
--
-- Scope notes:
--   * The per-sheep detach reverts (flock + transfer audit + weigh-in clear +
--     Activity) stay in detach_sheep_from_processing_batch (migration 081); the
--     page still runs that loop first. This RPC only owns the final atomic
--     straggler-clear + batch delete. Folding the whole detach loop into one
--     mega-RPC is deliberately out of scope (smallest safe slice).
--   * The cattle path has no detach loop: a 'scheduled' batch is created empty
--     (cows_detail=[]), so unschedule just deletes the empty row. The defensive
--     cattle unlink is normally a 0-row no-op but guarantees no dangling
--     cattle.processing_batch_id is ever left behind.
--   * The record.deleted event lives on the cattle.processing / sheep.processing
--     entity. After the batch row is gone the per-entity activity read is
--     existence-gated, but the event remains in the GLOBAL activity log as the
--     durable audit record. Full tombstone/deleted-record redesign is out of
--     scope for this checkpoint.
--
-- Return shape (jsonb):
--   ok=true:  {ok, reason:'unscheduled'|'deleted', batch_id,
--             cattle_unlinked|sheep_unlinked, event_id}
--   ok=false: {ok:false, reason, batch_id?, status?}  (reason in:
--             bad_args | no_batch | not_scheduled)
--
-- Apply order: TEST first (this lane), PROD after explicit lane approval.
-- ============================================================================

-- ── unschedule_cattle_processing_batch ──────────────────────────────────────

CREATE OR REPLACE FUNCTION public.unschedule_cattle_processing_batch(
  p_batch_id    text,
  p_team_member text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_caller   uuid := auth.uid();
  v_role     text;
  v_status   text;
  v_name     text;
  v_unlinked int := 0;
  v_ae_id    text;
BEGIN
  -- 1. Authenticate
  IF v_caller IS NULL THEN
    RAISE EXCEPTION 'unschedule_cattle_processing_batch: authenticated caller required';
  END IF;

  -- 2. Authorize: admin OR management only (matches page edit rights)
  v_role := public.profile_role();
  IF v_role IS NULL OR v_role NOT IN ('admin', 'management') THEN
    RAISE EXCEPTION 'unschedule_cattle_processing_batch: caller role % cannot unschedule', COALESCE(v_role, 'null');
  END IF;

  -- 3. Validate args
  IF p_batch_id IS NULL OR p_batch_id = '' THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'bad_args');
  END IF;

  -- 4. Load the batch.
  SELECT b.status, b.name
    INTO v_status, v_name
    FROM public.cattle_processing_batches b
    WHERE b.id = p_batch_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'no_batch', 'batch_id', p_batch_id);
  END IF;

  -- 5. Only 'scheduled' (pre-send, empty) batches may be unscheduled. This
  --    mirrors the page guard, enforced server-side.
  IF v_status IS DISTINCT FROM 'scheduled' THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'not_scheduled', 'batch_id', p_batch_id, 'status', v_status);
  END IF;

  -- 6. Defensive unlink: a scheduled batch is created empty, but never leave a
  --    dangling cattle.processing_batch_id behind. Normally a 0-row no-op.
  WITH unlinked AS (
    UPDATE public.cattle
      SET processing_batch_id = NULL
      WHERE processing_batch_id = p_batch_id
      RETURNING 1
  )
  SELECT count(*) INTO v_unlinked FROM unlinked;

  -- 7. Audit BEFORE the row is gone (record.deleted on the batch entity).
  v_ae_id := 'ae-' || gen_random_uuid()::text;
  INSERT INTO public.activity_events (
    id, entity_type, entity_id, actor_profile_id, event_type, body, payload
  ) VALUES (
    v_ae_id,
    'cattle.processing',
    p_batch_id,
    v_caller,
    'record.deleted',
    'Unscheduled processing batch ' || COALESCE(NULLIF(v_name, ''), p_batch_id),
    jsonb_build_object(
      'entity_label', COALESCE(NULLIF(v_name, ''), p_batch_id),
      'action', 'unschedule',
      'prior_status', v_status,
      'cattle_unlinked', v_unlinked,
      'team_member', p_team_member
    )
  );

  -- 8. Delete the batch row (same transaction).
  DELETE FROM public.cattle_processing_batches WHERE id = p_batch_id;

  RETURN jsonb_build_object(
    'ok', true,
    'reason', 'unscheduled',
    'batch_id', p_batch_id,
    'cattle_unlinked', v_unlinked,
    'event_id', v_ae_id
  );
END
$fn$;

REVOKE ALL ON FUNCTION public.unschedule_cattle_processing_batch(text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.unschedule_cattle_processing_batch(text, text) TO authenticated;

-- ── delete_sheep_processing_batch ───────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.delete_sheep_processing_batch(
  p_batch_id    text,
  p_team_member text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_caller   uuid := auth.uid();
  v_role     text;
  v_name     text;
  v_unlinked int := 0;
  v_ae_id    text;
BEGIN
  -- 1. Authenticate
  IF v_caller IS NULL THEN
    RAISE EXCEPTION 'delete_sheep_processing_batch: authenticated caller required';
  END IF;

  -- 2. Authorize: admin OR management only (matches page edit rights)
  v_role := public.profile_role();
  IF v_role IS NULL OR v_role NOT IN ('admin', 'management') THEN
    RAISE EXCEPTION 'delete_sheep_processing_batch: caller role % cannot delete', COALESCE(v_role, 'null');
  END IF;

  -- 3. Validate args
  IF p_batch_id IS NULL OR p_batch_id = '' THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'bad_args');
  END IF;

  -- 4. Load the batch.
  SELECT b.name
    INTO v_name
    FROM public.sheep_processing_batches b
    WHERE b.id = p_batch_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'no_batch', 'batch_id', p_batch_id);
  END IF;

  -- 5. Clear any sheep still pointing at this batch. The page runs the per-sheep
  --    detach RPCs first (flock revert + transfer audit + weigh-in clear +
  --    Activity per animal); this clears the straggler link for sheep that could
  --    not be auto-reverted, so the delete never orphans a processing_batch_id.
  --    Same effect as the old client UPDATE, now atomic with the delete.
  WITH unlinked AS (
    UPDATE public.sheep
      SET processing_batch_id = NULL
      WHERE processing_batch_id = p_batch_id
      RETURNING 1
  )
  SELECT count(*) INTO v_unlinked FROM unlinked;

  -- 6. Audit BEFORE the row is gone (record.deleted on the batch entity).
  v_ae_id := 'ae-' || gen_random_uuid()::text;
  INSERT INTO public.activity_events (
    id, entity_type, entity_id, actor_profile_id, event_type, body, payload
  ) VALUES (
    v_ae_id,
    'sheep.processing',
    p_batch_id,
    v_caller,
    'record.deleted',
    'Deleted processing batch ' || COALESCE(NULLIF(v_name, ''), p_batch_id),
    jsonb_build_object(
      'entity_label', COALESCE(NULLIF(v_name, ''), p_batch_id),
      'action', 'delete',
      'sheep_unlinked', v_unlinked,
      'team_member', p_team_member
    )
  );

  -- 7. Delete the batch row (same transaction).
  DELETE FROM public.sheep_processing_batches WHERE id = p_batch_id;

  RETURN jsonb_build_object(
    'ok', true,
    'reason', 'deleted',
    'batch_id', p_batch_id,
    'sheep_unlinked', v_unlinked,
    'event_id', v_ae_id
  );
END
$fn$;

REVOKE ALL ON FUNCTION public.delete_sheep_processing_batch(text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.delete_sheep_processing_batch(text, text) TO authenticated;

-- ── Reload PostgREST schema cache ───────────────────────────────────────────

NOTIFY pgrst, 'reload schema';

-- ============================================================================
-- End of 100_processing_batch_lifecycle_rpcs.sql
-- ============================================================================
