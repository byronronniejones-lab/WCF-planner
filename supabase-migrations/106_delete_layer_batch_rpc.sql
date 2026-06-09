-- ============================================================================
-- 106_delete_layer_batch_rpc.sql
-- ----------------------------------------------------------------------------
-- Audit-grade transactional DELETE RPC for the layer-batch root + its housings.
-- This replaces the last direct client hard-delete of a layer batch:
--
--   LayerBatchPage.handleDeleteBatch did, as TWO SEPARATE client writes (not
--   atomic with each other, and with no Activity audit):
--       sb.from('layer_housings').delete().eq('batch_id', batch.id)  (children)
--       sb.from('layer_batches').delete().eq('id', batch.id)         (root)
--
-- This migration folds the child-housing delete + the batch-root delete into
-- ONE transaction and writes ONE record.deleted Activity event in the same
-- transaction, so the hard delete is both atomic and audited.
--
-- PARAMETER TYPE — text, NOT uuid (deliberate deviation from the lane brief):
--   The lane brief named delete_layer_batch(p_batch_id uuid), but layer_batches.id
--   is a TEXT SLUG, not a uuid. Batch ids are minted client-side as
--   f.name.toLowerCase().replace(/[^a-z0-9]+/g,'-') (LayerBatchPage.buildBatchRec),
--   e.g. 'l-26-01' or 'retirement-home'. Every activity entity resolver
--   (mig 062/064/067/072/076/078) matches layer_batches with
--   `WHERE id = p_entity_id` against a TEXT p_entity_id, and the daily-group
--   tests assert ids like 'l-26-01'. A uuid parameter would fail the PostgREST
--   cast on every real call ('l-26-01' is not a uuid). So this RPC takes
--   p_batch_id text, matching the column and the processing-batch lifecycle RPCs
--   (mig 100, which likewise take p_batch_id text). The wrapper passes
--   batch.id directly.
--
-- FK note: layer_batches / layer_housings are hand-created tables (see mig 056,
-- "the two live hand-created tables"). There is no migration-managed FK from
-- layer_housings.batch_id -> layer_batches.id, so whether the DB has an ON
-- DELETE CASCADE on that link is not guaranteed here. We therefore delete the
-- housings EXPLICITLY first, capturing their count + names for the audit
-- payload, and never rely on a cascade. (Even if a cascade exists, the explicit
-- delete simply removes the housings before the root delete runs, leaving the
-- cascade nothing to do — correct either way.)
--
-- Scope notes:
--   * layer_dailys / egg_dailys are LEFT INTACT as history (verified product
--     decision). Those metrics rows are keyed by batch_id/batch_label but are an
--     immutable reporting trail; they are NOT cascaded by this RPC.
--   * The record.deleted event lives on the layer.batch entity. After the batch
--     row is gone the per-entity activity read is existence-gated, but the event
--     remains in the GLOBAL activity log as the durable audit record. Full
--     tombstone/deleted-record redesign is out of scope for this checkpoint.
--
-- Permission shape: the page gate is canEdit = admin || management. SECURITY
-- DEFINER here is for cross-row atomicity (children + root + audit), NOT to
-- broaden who may delete — the function AUTHENTICATES the caller (auth.uid()
-- not null) so anon (auth.uid() = NULL) is rejected, mirroring the access the
-- client delete had (the table grants authenticated full CRUD; the modal's
-- delete button is admin/management-only UX). Auth violations RAISE — the UI
-- never reaches them.
--
-- Return shape (jsonb):
--   ok=true:  {ok, reason:'deleted', batch_id, housings_cleared, event_id}
--   ok=false: {ok:false, reason:'bad_args'|'no_batch', batch_id?}
--
-- Mirrors create_recurring_task_template (mig 105) + the processing-batch
-- lifecycle RPCs (mig 100) and the equipment-log delete RPCs (mig 102):
-- SECURITY DEFINER, search_path public, REVOKE PUBLIC/anon + GRANT
-- authenticated, NOTIFY pgrst. Anon callers have auth.uid() = NULL so the
-- function rejects them; revoking anon EXECUTE is safe here because this RPC is
-- never evaluated in the login/auth RLS path.
--
-- Apply order: TEST first (this lane), PROD after explicit lane approval.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.delete_layer_batch(
  p_batch_id text
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_caller         uuid := auth.uid();
  v_name           text;
  v_housing_count  int := 0;
  v_housing_names  text[] := ARRAY[]::text[];
  v_ae_id          text;
BEGIN
  -- 1. Authenticate. Mirrors the access the client delete had (the table grants
  --    authenticated full CRUD; the modal's delete button is admin/management
  --    UX). Anon callers have auth.uid() = NULL and are rejected here.
  IF v_caller IS NULL THEN
    RAISE EXCEPTION 'delete_layer_batch: authenticated caller required';
  END IF;

  -- 2. Validate args.
  IF p_batch_id IS NULL OR p_batch_id = '' THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'bad_args');
  END IF;

  -- 3. Load the batch name for the audit body. Existence-gate so a stale UI
  --    delete of an already-gone batch returns no_batch rather than auditing a
  --    phantom delete.
  SELECT b.name
    INTO v_name
    FROM public.layer_batches b
    WHERE b.id = p_batch_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'no_batch', 'batch_id', p_batch_id);
  END IF;

  -- 4. Delete the child housings EXPLICITLY first (do not rely on any DB
  --    cascade), capturing count + names so the audit payload can report exactly
  --    what was cleared.
  WITH cleared AS (
    DELETE FROM public.layer_housings
      WHERE batch_id = p_batch_id
      RETURNING housing_name
  )
  SELECT count(*)::int,
         COALESCE(array_agg(housing_name) FILTER (WHERE housing_name IS NOT NULL), ARRAY[]::text[])
    INTO v_housing_count, v_housing_names
    FROM cleared;

  -- 5. Audit BEFORE the root row is gone (record.deleted on the layer.batch
  --    entity). Payload carries the batch name + the count/names of housings
  --    cleared. layer_dailys / egg_dailys are intentionally NOT touched.
  v_ae_id := 'ae-' || gen_random_uuid()::text;
  INSERT INTO public.activity_events (
    id, entity_type, entity_id, actor_profile_id, event_type, body, payload
  ) VALUES (
    v_ae_id,
    'layer.batch',
    p_batch_id,
    v_caller,
    'record.deleted',
    'Deleted layer batch ' || COALESCE(NULLIF(v_name, ''), p_batch_id)
      || ' (' || v_housing_count::text || ' housing'
      || CASE WHEN v_housing_count = 1 THEN '' ELSE 's' END || ' cleared)',
    jsonb_build_object(
      'entity_label', COALESCE(NULLIF(v_name, ''), p_batch_id),
      'action', 'delete',
      'housings_cleared', v_housing_count,
      'housing_names', to_jsonb(v_housing_names)
    )
  );

  -- 6. Delete the batch root (same transaction).
  DELETE FROM public.layer_batches WHERE id = p_batch_id;

  RETURN jsonb_build_object(
    'ok', true,
    'reason', 'deleted',
    'batch_id', p_batch_id,
    'housings_cleared', v_housing_count,
    'event_id', v_ae_id
  );
END
$fn$;

REVOKE ALL ON FUNCTION public.delete_layer_batch(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.delete_layer_batch(text) TO authenticated;

NOTIFY pgrst, 'reload schema';

-- ============================================================================
-- End of 106_delete_layer_batch_rpc.sql
-- ============================================================================
