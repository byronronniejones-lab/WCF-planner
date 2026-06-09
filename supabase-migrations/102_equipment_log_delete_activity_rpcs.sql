-- ============================================================================
-- 102_equipment_log_delete_activity_rpcs.sql
-- ----------------------------------------------------------------------------
-- Audit-grade transactional DELETE RPCs for the EquipmentDetail child logs.
-- These replace the last direct client hard-deletes of equipment fueling rows
-- and maintenance events:
--
--   * deleteFueling did
--       sb.from('equipment_fuelings').delete().eq('id', fuelingId)
--     with no Activity audit (then a client-side current-reading resync).
--   * deleteMaintenance did
--       sb.from('equipment_maintenance_events').delete().eq('id', id)
--     with no Activity audit and no surfaced error.
--
-- Each delete + its record.deleted Activity event now commit in one transaction,
-- scoped to the equipment.item entity (entity_id = equipment id).
--
-- Permission shapes — DELIBERATELY DIFFERENT, each mirroring its table's RLS:
--   * equipment_fuelings: migration 092 narrowed direct delete to
--       equipment_fuelings_priv_delete: profile_role() IN
--       ('admin','management','farm_team','equipment_tech')
--     so delete_equipment_fueling AUTHENTICATES and then enforces that same
--     role set (RAISE on violation — the privileged UI never reaches it).
--   * equipment_maintenance_events: still equipment_maintenance_auth_all
--       (FOR ALL TO authenticated USING(true)) from migration 016 — any
--     authenticated user. So delete_equipment_maintenance_event requires only
--     auth.uid() and adds NO role gate; tightening it would change behavior.
--
--   SECURITY DEFINER is for delete + Activity atomicity, NOT to broaden who may
--   delete. REVOKE from PUBLIC/anon; GRANT to authenticated.
--
-- Scope notes:
--   * The client-side current-reading resync after a fueling delete
--     (syncCurrentReadingFromFuelings) stays in EquipmentDetail and runs AFTER
--     the RPC succeeds — it recomputes equipment.current_* from the remaining
--     fuelings and is not part of the atomic delete.
--   * Both child tables are equipment_id NOT NULL REFERENCES equipment(id), so
--     the equipment row is resolved for the entity label; full tombstone/
--     deleted-record redesign remains out of scope.
--
-- Return shape (jsonb):
--   delete_equipment_fueling:
--     ok=true:  {ok, reason:'deleted', fueling_id, equipment_id, event_id}
--     ok=false: {ok:false, reason:'bad_args'|'no_fueling', fueling_id?}
--   delete_equipment_maintenance_event:
--     ok=true:  {ok, reason:'deleted', event_id_deleted, equipment_id, event_id}
--     ok=false: {ok:false, reason:'bad_args'|'no_event', maintenance_id?}
--
-- Apply order: TEST first (this lane), PROD after explicit lane approval.
-- ============================================================================

-- ── delete_equipment_fueling ────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.delete_equipment_fueling(
  p_fueling_id   text,
  p_entity_label text DEFAULT NULL,
  p_team_member  text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_caller    uuid := auth.uid();
  v_role      text;
  v_equip_id  text;
  v_date      date;
  v_gallons   numeric;
  v_fuel_type text;
  v_name      text;
  v_label     text;
  v_ae_id     text;
BEGIN
  -- 1. Authenticate.
  IF v_caller IS NULL THEN
    RAISE EXCEPTION 'delete_equipment_fueling: authenticated caller required';
  END IF;

  -- 2. Authorize: mirror equipment_fuelings_priv_delete (migration 092).
  v_role := public.profile_role();
  IF v_role IS NULL OR v_role NOT IN ('admin', 'management', 'farm_team', 'equipment_tech') THEN
    RAISE EXCEPTION 'delete_equipment_fueling: caller role % cannot delete fuelings', COALESCE(v_role, 'null');
  END IF;

  -- 3. Validate args.
  IF p_fueling_id IS NULL OR p_fueling_id = '' THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'bad_args');
  END IF;

  -- 4. Load + LOCK the fueling row (need equipment id for the Activity entity +
  --    date/gallons/fuel for the audit body). FOR UPDATE makes the read+audit+
  --    delete idempotent under concurrency: a second concurrent call blocks here
  --    until the first commits, then finds the row gone and returns no_fueling
  --    with no duplicate audit (rather than re-auditing + a false ok on a 0-row
  --    delete).
  SELECT f.equipment_id, f.date, f.gallons, f.fuel_type
    INTO v_equip_id, v_date, v_gallons, v_fuel_type
    FROM public.equipment_fuelings f
    WHERE f.id = p_fueling_id
    FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'no_fueling', 'fueling_id', p_fueling_id);
  END IF;

  SELECT e.name INTO v_name FROM public.equipment e WHERE e.id = v_equip_id;
  v_label := COALESCE(NULLIF(trim(COALESCE(p_entity_label, '')), ''), NULLIF(v_name, ''), v_equip_id);

  -- 5. Audit BEFORE the row is gone (record.deleted on the equipment.item entity).
  v_ae_id := 'ae-' || gen_random_uuid()::text;
  INSERT INTO public.activity_events (
    id, entity_type, entity_id, actor_profile_id, event_type, body, payload
  ) VALUES (
    v_ae_id,
    'equipment.item',
    v_equip_id,
    v_caller,
    'record.deleted',
    'Deleted fueling entry (' || COALESCE(v_date::text, '?')
      || COALESCE(' · ' || v_gallons::text || ' gal', '') || ')',
    jsonb_build_object(
      'entity_label', v_label,
      'action', 'delete_fueling',
      'fueling_id', p_fueling_id,
      'fueling_date', v_date,
      'gallons', v_gallons,
      'fuel_type', v_fuel_type,
      'team_member', p_team_member
    )
  );

  -- 6. Delete the fueling row (same transaction).
  DELETE FROM public.equipment_fuelings WHERE id = p_fueling_id;

  RETURN jsonb_build_object(
    'ok', true,
    'reason', 'deleted',
    'fueling_id', p_fueling_id,
    'equipment_id', v_equip_id,
    'event_id', v_ae_id
  );
END
$fn$;

REVOKE ALL ON FUNCTION public.delete_equipment_fueling(text, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.delete_equipment_fueling(text, text, text) TO authenticated;

-- ── delete_equipment_maintenance_event ──────────────────────────────────────

CREATE OR REPLACE FUNCTION public.delete_equipment_maintenance_event(
  p_event_id     text,
  p_entity_label text DEFAULT NULL,
  p_team_member  text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_caller     uuid := auth.uid();
  v_equip_id   text;
  v_event_date date;
  v_event_type text;
  v_title      text;
  v_name       text;
  v_label      text;
  v_ae_id      text;
BEGIN
  -- 1. Authenticate. Mirrors equipment_maintenance_auth_all (TO authenticated);
  --    no role gate exists on this table, so none is added here.
  IF v_caller IS NULL THEN
    RAISE EXCEPTION 'delete_equipment_maintenance_event: authenticated caller required';
  END IF;

  -- 2. Validate args.
  IF p_event_id IS NULL OR p_event_id = '' THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'bad_args');
  END IF;

  -- 3. Load + LOCK the maintenance event (equipment id for the Activity entity +
  --    type/title/date for the audit body). FOR UPDATE makes the read+audit+
  --    delete idempotent under concurrency: a second concurrent call blocks here
  --    until the first commits, then finds the row gone and returns no_event with
  --    no duplicate audit (rather than re-auditing + a false ok on a 0-row delete).
  SELECT m.equipment_id, m.event_date, m.event_type, m.title
    INTO v_equip_id, v_event_date, v_event_type, v_title
    FROM public.equipment_maintenance_events m
    WHERE m.id = p_event_id
    FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'no_event', 'maintenance_id', p_event_id);
  END IF;

  SELECT e.name INTO v_name FROM public.equipment e WHERE e.id = v_equip_id;
  v_label := COALESCE(NULLIF(trim(COALESCE(p_entity_label, '')), ''), NULLIF(v_name, ''), v_equip_id);

  -- 4. Audit BEFORE the row is gone (record.deleted on the equipment.item entity).
  v_ae_id := 'ae-' || gen_random_uuid()::text;
  INSERT INTO public.activity_events (
    id, entity_type, entity_id, actor_profile_id, event_type, body, payload
  ) VALUES (
    v_ae_id,
    'equipment.item',
    v_equip_id,
    v_caller,
    'record.deleted',
    'Deleted maintenance event (' || COALESCE(v_event_type, 'event')
      || COALESCE(' · ' || NULLIF(v_title, ''), '')
      || COALESCE(' · ' || v_event_date::text, '') || ')',
    jsonb_build_object(
      'entity_label', v_label,
      'action', 'delete_maintenance_event',
      'maintenance_id', p_event_id,
      'event_date', v_event_date,
      'event_type', v_event_type,
      'title', v_title,
      'team_member', p_team_member
    )
  );

  -- 5. Delete the maintenance event row (same transaction).
  DELETE FROM public.equipment_maintenance_events WHERE id = p_event_id;

  RETURN jsonb_build_object(
    'ok', true,
    'reason', 'deleted',
    'event_id_deleted', p_event_id,
    'equipment_id', v_equip_id,
    'event_id', v_ae_id
  );
END
$fn$;

REVOKE ALL ON FUNCTION public.delete_equipment_maintenance_event(text, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.delete_equipment_maintenance_event(text, text, text) TO authenticated;

-- ── Reload PostgREST schema cache ───────────────────────────────────────────

NOTIFY pgrst, 'reload schema';

-- ============================================================================
-- End of 102_equipment_log_delete_activity_rpcs.sql
-- ============================================================================
