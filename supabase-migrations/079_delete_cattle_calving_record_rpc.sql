-- 079: Audit-grade transactional delete for cattle calving records.
--
-- Audit-grade SECDEF RPC Phase A. The calving-record delete was a bare
-- client hard delete (CattleAnimalPage + CattleHerdsView) with no audit and
-- no atomicity. This RPC deletes the row AND logs a record.deleted Activity
-- event in a SINGLE transaction. The event is scoped to the dam's
-- cattle.animal record (the dam persists — only the calving record is
-- removed — so _activity_can_read('cattle.animal', dam) resolves). The dam is
-- resolved by dam_tag among active cattle; if no active dam matches the tag,
-- the row is still deleted but no event is logged (orphan-tag fallback).
--
-- Operational permission (not admin-only): authenticated + active caller,
-- matching the prior client path. REVOKE anon, GRANT authenticated.
--
-- Apply order: TEST first, PROD after lane approval.

CREATE OR REPLACE FUNCTION public.delete_cattle_calving_record(
  p_record_id   text,
  p_team_member text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_caller       uuid := auth.uid();
  v_role         text;
  v_dam_tag      text;
  v_calving_date date;
  v_dam_id       text;
  v_ae_id        text;
BEGIN
  -- 1. Authenticate
  IF v_caller IS NULL THEN
    RAISE EXCEPTION 'delete_cattle_calving_record: authenticated caller required';
  END IF;

  -- 2. Active caller (operational, not admin-only)
  v_role := public.profile_role();
  IF v_role IS NULL OR v_role = 'inactive' THEN
    RAISE EXCEPTION 'delete_cattle_calving_record: caller role % cannot delete', COALESCE(v_role, 'null');
  END IF;

  -- 3. Load the record (no-op return if already gone)
  SELECT dam_tag, calving_date
    INTO v_dam_tag, v_calving_date
    FROM public.cattle_calving_records
    WHERE id = p_record_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'not_found');
  END IF;

  -- 4. Resolve the dam (persists after the delete) for the Activity scope.
  SELECT id INTO v_dam_id
    FROM public.cattle
    WHERE tag = v_dam_tag AND deleted_at IS NULL
    ORDER BY tag
    LIMIT 1;

  -- 5. Delete the calving record.
  DELETE FROM public.cattle_calving_records WHERE id = p_record_id;

  -- 6. record.deleted Activity event scoped to the dam (same transaction).
  IF v_dam_id IS NOT NULL THEN
    v_ae_id := 'ae-' || gen_random_uuid()::text;
    INSERT INTO public.activity_events (
      id, entity_type, entity_id, actor_profile_id, event_type, body, payload
    ) VALUES (
      v_ae_id,
      'cattle.animal',
      v_dam_id,
      v_caller,
      'record.deleted',
      'Deleted calving record (' || COALESCE(v_calving_date::text, '?') || ') for #' || COALESCE(v_dam_tag, '?'),
      jsonb_build_object(
        'record_type', 'cattle_calving_record',
        'calving_record_id', p_record_id,
        'dam_tag', v_dam_tag,
        'calving_date', v_calving_date,
        'team_member', p_team_member
      )
    );
  END IF;

  RETURN jsonb_build_object('ok', true, 'reason', 'deleted', 'dam_id', v_dam_id, 'event_id', v_ae_id);
END
$fn$;

REVOKE ALL ON FUNCTION public.delete_cattle_calving_record(text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.delete_cattle_calving_record(text, text) TO authenticated;

NOTIFY pgrst, 'reload schema';
