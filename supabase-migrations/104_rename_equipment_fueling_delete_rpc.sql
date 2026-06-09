-- ============================================================================
-- 104_rename_equipment_fueling_delete_rpc.sql
-- ----------------------------------------------------------------------------
-- Fixes a function-name COLLISION introduced by migration 102.
--
-- Migration 091 already defined the Light/My-Submissions owner-scoped delete:
--     delete_equipment_fueling(p_id text)          -- _delete_owned_simple wrapper
-- Migration 102 then added the privileged, audited EquipmentDetail delete under
-- the SAME name with a different signature:
--     delete_equipment_fueling(p_fueling_id text, p_entity_label text, p_team_member text)
--
-- Two same-named RPCs with different permission models is a footgun (and risks
-- PostgREST overload ambiguity). PostgREST currently disambiguates by parameter
-- names so nothing is broken, but the privileged audited RPC is renamed here to
-- remove the collision:
--     admin_delete_equipment_fueling(p_fueling_id text, p_entity_label text, p_team_member text)
--
-- This migration:
--   1. Creates admin_delete_equipment_fueling with the IDENTICAL body, role gate
--      (admin/management/farm_team/equipment_tech, mirroring
--      equipment_fuelings_priv_delete from mig 092), FOR UPDATE locking, and
--      in-transaction record.deleted Activity that migration 102 shipped.
--   2. DROPs the colliding delete_equipment_fueling(text, text, text) overload.
--   3. LEAVES migration 091's delete_equipment_fueling(text) ownership RPC and
--      the equipment-maintenance / weigh-in delete RPCs untouched.
--
-- Client wrapper deleteEquipmentFueling is updated to call the new name in the
-- same change.
--
-- Apply order: TEST first, PROD after explicit approval (this lane).
-- ============================================================================

-- ── admin_delete_equipment_fueling (renamed from mig 102) ────────────────────

CREATE OR REPLACE FUNCTION public.admin_delete_equipment_fueling(
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
    RAISE EXCEPTION 'admin_delete_equipment_fueling: authenticated caller required';
  END IF;

  -- 2. Authorize: mirror equipment_fuelings_priv_delete (migration 092).
  v_role := public.profile_role();
  IF v_role IS NULL OR v_role NOT IN ('admin', 'management', 'farm_team', 'equipment_tech') THEN
    RAISE EXCEPTION 'admin_delete_equipment_fueling: caller role % cannot delete fuelings', COALESCE(v_role, 'null');
  END IF;

  -- 3. Validate args.
  IF p_fueling_id IS NULL OR p_fueling_id = '' THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'bad_args');
  END IF;

  -- 4. Load + LOCK the fueling row. FOR UPDATE makes read+audit+delete idempotent
  --    under concurrency: a second concurrent call blocks here, then finds the
  --    row gone and returns no_fueling with no duplicate audit.
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

REVOKE ALL ON FUNCTION public.admin_delete_equipment_fueling(text, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_delete_equipment_fueling(text, text, text) TO authenticated;

-- ── Drop the colliding migration-102 overload ───────────────────────────────
-- Removes delete_equipment_fueling(text, text, text). The migration-091
-- owner-scoped delete_equipment_fueling(text) is intentionally KEPT.

DROP FUNCTION IF EXISTS public.delete_equipment_fueling(text, text, text);

-- ── Reload PostgREST schema cache ───────────────────────────────────────────

NOTIFY pgrst, 'reload schema';

-- ============================================================================
-- End of 104_rename_equipment_fueling_delete_rpc.sql
-- ============================================================================
