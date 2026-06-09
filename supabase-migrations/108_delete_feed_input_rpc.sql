-- ============================================================================
-- 108_delete_feed_input_rpc.sql
-- ----------------------------------------------------------------------------
-- Audit-grade transactional DELETE RPC for a feed input (root + its tests).
-- This replaces the last direct client hard-delete of a feed-input root:
--
--   LivestockFeedInputsPanel.deleteFeedPermanently did, as a raw client write
--   (preceded by a best-effort storage PDF removal of the children's PDFs and
--   followed by a best-effort client recordFeedInputDeletedActivity):
--       sb.from('cattle_feed_inputs').delete().eq('id', id)        (root)
--   and relied on the cattle_feed_tests.feed_input_id ON DELETE CASCADE FK to
--   clear the child test rows. The Activity audit was a separate, best-effort,
--   NON-transactional client RPC after the delete — so a delete that succeeded
--   while the audit write failed left a hard delete with no audit trail.
--
-- This migration folds the root delete (and therefore the cascaded test delete)
-- into ONE transaction and writes ONE record.deleted Activity event in the same
-- transaction, so the hard delete is both atomic and audited.
--
-- FK / CASCADE note: cattle_feed_tests.feed_input_id is
--   `text NOT NULL REFERENCES cattle_feed_inputs(id) ON DELETE CASCADE`
-- (archive/001_cattle_module.sql line 54). Deleting the cattle_feed_inputs root
-- therefore cascades the tests automatically — this RPC does NOT delete
-- cattle_feed_tests explicitly (matching the client's prior reliance on the
-- cascade). We capture the test count BEFORE the delete so the audit payload can
-- report exactly how many tests were cascaded away.
--
-- ENTITY — the synthetic cattle.forecast singleton stream: the existing client
-- helper recordFeedInputDeletedActivity (LivestockFeedInputsPanel ~line 239)
-- logs feed-input lifecycle to the registered cattle.forecast workflow entity
-- with entity_id = 'cattle-forecast' (the FEED_ACTIVITY_ENTITY constant), NOT to
-- a per-feed entity — feed inputs have no dedicated activity entity. This RPC
-- mirrors that EXACT entity_type/entity_id + body + payload shape so the
-- record.deleted event lands on the SAME global stream the create/update events
-- already use, and the per-feed view continues to read cleanly. The stored row
-- also carries `entity_label: 'Cattle Forecast'` in the payload, matching how
-- record_activity_event (mig 066) folds the label into the payload jsonb.
--
-- Scope note: the record.deleted event lives on the cattle.forecast entity with
-- the deleted feed's id in the payload (feed_input_id). It remains in the GLOBAL
-- activity log as the durable audit record; full tombstone/deleted-record
-- redesign is out of scope for this checkpoint.
--
-- PARAMETER TYPE — text (NOT uuid): the lane brief named
-- delete_feed_input(p_input_id uuid). cattle_feed_inputs.id is declared TEXT (a
-- client-minted slug, e.g. 'rye-baleage' — see the id derivation in
-- LivestockFeedInputsPanel.saveFeed), NOT a uuid. A uuid parameter would fail
-- the PostgREST cast on every real call (the wrapper passes feed.id, a slug). So
-- this RPC takes p_input_id text, matching the column and the sibling root-delete
-- lifecycle RPCs (mig 107 delete_fuel_bill + mig 106 delete_layer_batch + mig
-- 100, which likewise take p_*_id text against TEXT-slug ids — mig 107's header
-- records the same uuid→text correction for the identical reason). The wrapper
-- passes inputId directly.
--
-- Permission shape — GATE PER CURRENT ACCESS (authenticated): the
-- cattle_feed_inputs table RLS is feed_inputs_auth_write
--   `FOR ALL TO authenticated USING (true) WITH CHECK (true)`
-- (archive/001_cattle_module.sql lines 46-48) — i.e. ANY authenticated user may
-- delete a feed input today (the LivestockFeedInputsPanel is an admin surface,
-- but the table boundary itself is authenticated-only with no role gate, like
-- equipment_maintenance_events / delete_equipment_maintenance_event in mig 102).
-- This RPC therefore AUTHENTICATES the caller and adds NO role gate; tightening
-- it would change who can delete. SECURITY DEFINER here is for
-- root+cascade+audit atomicity, NOT to broaden who may delete. anon
-- (auth.uid() = NULL) is rejected. Auth violations RAISE.
--
-- Return shape (jsonb):
--   ok=true:  {ok, reason:'deleted', input_id, tests_deleted, event_id}
--   ok=false: {ok:false, reason:'bad_args'|'no_input', input_id?}
--
-- Mirrors delete_fuel_bill (mig 107) + the layer-batch / processing-batch
-- lifecycle RPCs (mig 106 / mig 100): SECURITY DEFINER, search_path public,
-- REVOKE PUBLIC/anon + GRANT authenticated, NOTIFY pgrst. Revoking anon EXECUTE
-- is safe here because this RPC is never evaluated in the login/auth RLS path.
--
-- Apply order: TEST first (this lane), PROD after explicit lane approval.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.delete_feed_input(
  p_input_id text
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_caller       uuid := auth.uid();
  v_input_id     text := p_input_id;
  v_name         text;
  v_tests_count  int := 0;
  v_label        text;
  v_ae_id        text;
BEGIN
  -- 1. Authenticate.
  IF v_caller IS NULL THEN
    RAISE EXCEPTION 'delete_feed_input: authenticated caller required';
  END IF;

  -- 2. Authorize: authenticated-only, mirroring feed_inputs_auth_write
  --    (FOR ALL TO authenticated USING(true)). No role gate exists on this
  --    table, so none is added here — SECURITY DEFINER is for atomicity, not to
  --    broaden who may delete.

  -- 3. Validate args. cattle_feed_inputs.id is a TEXT slug (e.g. 'rye-baleage');
  --    a NULL/blank id is bad_args.
  IF v_input_id IS NULL OR v_input_id = '' THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'bad_args');
  END IF;

  -- 4. Load + LOCK the feed input (need the name for the audit body/label).
  --    FOR UPDATE makes read+audit+delete idempotent under concurrency: a second
  --    concurrent call blocks here until the first commits, then finds the row
  --    gone and returns no_input with no duplicate audit (rather than re-auditing
  --    + a false ok on a 0-row delete). Existence-gate so a stale UI delete of an
  --    already-gone feed returns no_input.
  SELECT f.name
    INTO v_name
    FROM public.cattle_feed_inputs f
    WHERE f.id = v_input_id
    FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'no_input', 'input_id', v_input_id);
  END IF;

  -- 5. Count the child tests BEFORE the delete so the audit payload reports how
  --    many tests the FK cascade will remove. The tests themselves are NOT
  --    deleted here — cattle_feed_tests.feed_input_id has ON DELETE CASCADE, so
  --    deleting the root (step 7) clears them automatically.
  SELECT count(*)::int INTO v_tests_count
    FROM public.cattle_feed_tests t
    WHERE t.feed_input_id = v_input_id;

  v_label := COALESCE(NULLIF(trim(COALESCE(v_name, '')), ''), 'Unnamed feed');

  -- 6. Audit BEFORE the row is gone (record.deleted on the cattle.forecast
  --    singleton stream — see the header for why feed lifecycle uses the
  --    registered cattle.forecast entity with entity_id = 'cattle-forecast').
  --    Body + payload MIRROR the client recordFeedInputDeletedActivity exactly so
  --    the event reads identically on the global stream, and the stored payload
  --    folds entity_label the same way record_activity_event (mig 066) does.
  v_ae_id := 'ae-' || gen_random_uuid()::text;
  INSERT INTO public.activity_events (
    id, entity_type, entity_id, actor_profile_id, event_type, body, payload
  ) VALUES (
    v_ae_id,
    'cattle.forecast',
    'cattle-forecast',
    v_caller,
    'record.deleted',
    'Feed input ' || v_label || ' deleted',
    jsonb_build_object(
      'feed_input_action', 'deleted',
      'feed_input_id', v_input_id,
      'feed_name', v_label,
      'tests_deleted', v_tests_count,
      'entity_label', 'Cattle Forecast'
    )
  );

  -- 7. Delete the feed input root (same transaction). cattle_feed_tests cascade
  --    away via the feed_input_id ON DELETE CASCADE FK. Historical cattle_dailys
  --    snapshots remain intact (jsonb values, not FK).
  DELETE FROM public.cattle_feed_inputs WHERE id = v_input_id;

  RETURN jsonb_build_object(
    'ok', true,
    'reason', 'deleted',
    'input_id', v_input_id,
    'tests_deleted', v_tests_count,
    'event_id', v_ae_id
  );
END
$fn$;

REVOKE ALL ON FUNCTION public.delete_feed_input(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.delete_feed_input(text) TO authenticated;

NOTIFY pgrst, 'reload schema';

-- ============================================================================
-- End of 108_delete_feed_input_rpc.sql
-- ============================================================================
