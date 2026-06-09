-- ============================================================================
-- 107_delete_fuel_bill_rpc.sql
-- ----------------------------------------------------------------------------
-- Audit-grade transactional DELETE RPC for a fuel bill (header + its lines).
-- This replaces the last direct client hard-delete of a fuel-bill root:
--
--   FuelBillsView BillDetail.del did, as a raw client write with no Activity
--   audit (preceded by a best-effort storage PDF removal):
--       sb.from('fuel_bills').delete().eq('id', bill.id)        (root)
--   and relied on the fuel_bill_lines.bill_id ON DELETE CASCADE FK to clear the
--   child line rows.
--
-- This migration folds the root delete (and therefore the cascaded line delete)
-- into ONE transaction and writes ONE record.deleted Activity event in the same
-- transaction, so the hard delete is both atomic and audited.
--
-- FK / CASCADE note: fuel_bill_lines.bill_id is
--   `TEXT NOT NULL REFERENCES fuel_bills(id) ON DELETE CASCADE`
-- (archive/026_fuel_bills.sql line 44). Deleting the fuel_bills root therefore
-- cascades the lines automatically — this RPC does NOT delete fuel_bill_lines
-- explicitly (matching the client's prior reliance on the cascade, see the
-- BillUploadModal rollback comment "ON DELETE CASCADE on fuel_bill_lines.bill_id
-- clears any partial lines"). We capture the line count BEFORE the delete so the
-- audit payload can report exactly how many lines were cascaded away.
--
-- PARAMETER TYPE — uuid: the lane brief named delete_fuel_bill(p_bill_id uuid).
-- fuel_bills.id is declared TEXT (a client-minted slug, e.g.
-- 'fb-1718000000000-ab12cd'), NOT a uuid. A uuid parameter would fail the
-- PostgREST cast on every real call. So this RPC takes p_bill_id text, matching
-- the column and the sibling root-delete lifecycle RPCs (mig 100 + mig 106,
-- which likewise take p_*_id text against TEXT-slug ids). The wrapper passes
-- bill.id directly.
--
-- ENTITY TYPE — equipment.item (entity_id = the fuel bill id): fuel bills are
-- equipment/fuel financial documents. There is NO fuel-bill-scoped activity
-- entity registered in src/lib/activityRegistry.js (the registered entities are
-- task.instance / *.batch / *.housing / *.animal / *.processing / *.forecast /
-- *.breeding / *.daily / equipment.item / weighin.session), and fuel_bills has
-- no equipment_id column (it is a supplier invoice, not tied to one machine), so
-- there is no equipment row to point the entity_id at. Per the lane contract we
-- do NOT invent an unregistered entity type; equipment.item is the registered
-- entity that covers the equipment/fuel domain, and the _activity_can_read
-- resolver already has an equipment.item branch (mig 058/062). entity_id is the
-- bill id and entity_label is the invoice number / supplier so the event reads
-- clearly in the global Activity log. (NOTE for a future lane: if fuel bills get
-- their own dedicated activity entity + read-resolver branch + registry entry,
-- re-scope this event to it.)
--
-- Scope note: the record.deleted event lives on the equipment.item entity with
-- entity_id = the now-deleted bill id. It remains in the GLOBAL activity log as
-- the durable audit record; full tombstone/deleted-record redesign is out of
-- scope for this checkpoint.
--
-- Permission shape: the Bills tab (FuelBillsView) is admin-only (it is mounted
-- inside the admin WebformsAdminView fuel-log surface; the table header comment
-- in archive/026_fuel_bills.sql records "only admin should be writing"). The
-- RPC therefore gates on is_admin() (mig 037). SECURITY DEFINER here is for
-- root+cascade+audit atomicity, NOT to broaden who may delete — a non-admin
-- caller is rejected (RAISE) and anon (auth.uid() = NULL → is_admin() false) is
-- rejected too. Auth/role violations RAISE; the admin UI never reaches them.
--
-- Return shape (jsonb):
--   ok=true:  {ok, reason:'deleted', bill_id, lines_deleted, event_id}
--   ok=false: {ok:false, reason:'bad_args'|'no_bill', bill_id?}
--
-- Mirrors delete_layer_batch (mig 106) + the processing-batch lifecycle RPCs
-- (mig 100): SECURITY DEFINER, search_path public, REVOKE PUBLIC/anon + GRANT
-- authenticated, NOTIFY pgrst. Revoking anon EXECUTE is safe here because this
-- RPC is never evaluated in the login/auth RLS path.
--
-- Apply order: TEST first (this lane), PROD after explicit lane approval.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.delete_fuel_bill(
  p_bill_id text
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_caller        uuid := auth.uid();
  v_invoice       text;
  v_supplier      text;
  v_delivery      date;
  v_total         numeric;
  v_lines_count   int := 0;
  v_label         text;
  v_ae_id         text;
BEGIN
  -- 1. Authenticate.
  IF v_caller IS NULL THEN
    RAISE EXCEPTION 'delete_fuel_bill: authenticated caller required';
  END IF;

  -- 2. Authorize: admin only (the Bills tab is admin-gated; mig 037 is_admin()).
  --    SECURITY DEFINER is for atomicity, not to broaden who may delete.
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'delete_fuel_bill: caller is not admin';
  END IF;

  -- 3. Validate args.
  IF p_bill_id IS NULL OR p_bill_id = '' THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'bad_args');
  END IF;

  -- 4. Load + LOCK the bill (need invoice/supplier/delivery/total for the audit
  --    body + label). FOR UPDATE makes read+audit+delete idempotent under
  --    concurrency: a second concurrent call blocks here until the first commits,
  --    then finds the row gone and returns no_bill with no duplicate audit
  --    (rather than re-auditing + a false ok on a 0-row delete). Existence-gate
  --    so a stale UI delete of an already-gone bill returns no_bill.
  SELECT b.invoice_number, b.supplier, b.delivery_date, b.total
    INTO v_invoice, v_supplier, v_delivery, v_total
    FROM public.fuel_bills b
    WHERE b.id = p_bill_id
    FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'no_bill', 'bill_id', p_bill_id);
  END IF;

  -- 5. Count the child lines BEFORE the delete so the audit payload reports how
  --    many lines the FK cascade will remove. The lines themselves are NOT
  --    deleted here — fuel_bill_lines.bill_id has ON DELETE CASCADE, so deleting
  --    the root (step 7) clears them automatically.
  SELECT count(*)::int INTO v_lines_count
    FROM public.fuel_bill_lines l
    WHERE l.bill_id = p_bill_id;

  v_label := COALESCE(
    NULLIF(trim(COALESCE(v_invoice, '')), ''),
    NULLIF(trim(COALESCE(v_supplier, '')), ''),
    p_bill_id
  );

  -- 6. Audit BEFORE the row is gone (record.deleted on the equipment.item entity;
  --    entity_id = the fuel bill id — see the header for why this domain uses the
  --    registered equipment.item entity). Payload carries the bill identity + the
  --    count of lines cascaded.
  v_ae_id := 'ae-' || gen_random_uuid()::text;
  INSERT INTO public.activity_events (
    id, entity_type, entity_id, actor_profile_id, event_type, body, payload
  ) VALUES (
    v_ae_id,
    'equipment.item',
    p_bill_id,
    v_caller,
    'record.deleted',
    'Deleted fuel bill ' || v_label
      || COALESCE(' · ' || v_delivery::text, '')
      || ' (' || v_lines_count::text || ' line'
      || CASE WHEN v_lines_count = 1 THEN '' ELSE 's' END || ')',
    jsonb_build_object(
      'entity_label', v_label,
      'action', 'delete_fuel_bill',
      'bill_id', p_bill_id,
      'invoice_number', v_invoice,
      'supplier', v_supplier,
      'delivery_date', v_delivery,
      'total', v_total,
      'lines_deleted', v_lines_count
    )
  );

  -- 7. Delete the bill root (same transaction). fuel_bill_lines cascade away.
  DELETE FROM public.fuel_bills WHERE id = p_bill_id;

  RETURN jsonb_build_object(
    'ok', true,
    'reason', 'deleted',
    'bill_id', p_bill_id,
    'lines_deleted', v_lines_count,
    'event_id', v_ae_id
  );
END
$fn$;

REVOKE ALL ON FUNCTION public.delete_fuel_bill(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.delete_fuel_bill(text) TO authenticated;

NOTIFY pgrst, 'reload schema';

-- ============================================================================
-- End of 107_delete_fuel_bill_rpc.sql
-- ============================================================================
