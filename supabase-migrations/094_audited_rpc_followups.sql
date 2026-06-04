-- 094: Audited RPC follow-ups for cattle breeding cycles and sheep lambing deletes.
--
-- This lane closes two
-- remaining audit-atomicity gaps without changing product UI:
--   1. cattle_breeding_cycles create/update/delete now happens inside SECDEF
--      RPCs that also log the cattle.breeding Activity event in the same txn.
--   2. sheep_lambing_records delete now mirrors migration 079's cattle calving
--      delete RPC: delete the sub-row and log record.deleted on the dam record
--      in the same txn when the dam can be resolved.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- Cattle breeding cycles

CREATE OR REPLACE FUNCTION public.upsert_cattle_breeding_cycle(
  p_cycle_id            text DEFAULT NULL,
  p_herd                text DEFAULT 'mommas',
  p_bull_exposure_start date DEFAULT NULL,
  p_bull_tags           text DEFAULT NULL,
  p_cow_tags            text DEFAULT NULL,
  p_notes               text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_caller       uuid := auth.uid();
  v_role         text;
  v_id           text;
  v_existing     public.cattle_breeding_cycles%ROWTYPE;
  v_is_update    boolean := false;
  v_ae_id        text;
  v_label        text;
  v_herd         text;
  v_event_type   text;
  v_body         text;
BEGIN
  IF v_caller IS NULL THEN
    RAISE EXCEPTION 'upsert_cattle_breeding_cycle: authenticated caller required';
  END IF;

  v_role := public.profile_role();
  IF v_role IS NULL OR v_role = 'inactive' THEN
    RAISE EXCEPTION 'upsert_cattle_breeding_cycle: caller role % cannot write', COALESCE(v_role, 'null');
  END IF;

  IF p_bull_exposure_start IS NULL THEN
    RAISE EXCEPTION 'upsert_cattle_breeding_cycle: bull exposure start required';
  END IF;

  v_id := COALESCE(NULLIF(trim(p_cycle_id), ''), 'cbc-' || gen_random_uuid()::text);
  v_herd := COALESCE(NULLIF(trim(p_herd), ''), 'mommas');
  IF v_herd NOT IN ('mommas', 'backgrounders', 'finishers', 'bulls') THEN
    RAISE EXCEPTION 'upsert_cattle_breeding_cycle: invalid herd %', v_herd;
  END IF;

  SELECT * INTO v_existing
    FROM public.cattle_breeding_cycles
    WHERE id = v_id;
  v_is_update := FOUND;

  IF v_is_update THEN
    UPDATE public.cattle_breeding_cycles
       SET herd = v_herd,
           bull_exposure_start = p_bull_exposure_start,
           bull_tags = NULLIF(p_bull_tags, ''),
           cow_tags = NULLIF(p_cow_tags, ''),
           notes = NULLIF(p_notes, '')
     WHERE id = v_id;
    v_event_type := 'field.updated';
    v_body := 'Updated breeding cycle: ' || v_herd || ' - ' || p_bull_exposure_start::text;
  ELSE
    INSERT INTO public.cattle_breeding_cycles (
      id, herd, bull_exposure_start, bull_tags, cow_tags, notes
    ) VALUES (
      v_id, v_herd, p_bull_exposure_start, NULLIF(p_bull_tags, ''), NULLIF(p_cow_tags, ''), NULLIF(p_notes, '')
    );
    v_event_type := 'record.created';
    v_body := 'Created breeding cycle: ' || v_herd || ' - ' || p_bull_exposure_start::text;
  END IF;

  v_label := v_herd || ' - ' || p_bull_exposure_start::text;
  v_ae_id := 'ae-' || gen_random_uuid()::text;
  INSERT INTO public.activity_events (
    id, entity_type, entity_id, actor_profile_id, event_type, body, payload
  ) VALUES (
    v_ae_id,
    'cattle.breeding',
    'cattle-breeding',
    v_caller,
    v_event_type,
    v_body,
    jsonb_build_object(
      'entity_label', 'Cattle Breeding',
      'record_type', 'cattle_breeding_cycle',
      'cycle_id', v_id,
      'herd', v_herd,
      'bull_exposure_start', p_bull_exposure_start,
      'field', 'breeding_cycle',
      'old', CASE WHEN v_is_update THEN to_jsonb(v_existing) ELSE NULL END,
      'new', jsonb_build_object(
        'id', v_id,
        'herd', v_herd,
        'bull_exposure_start', p_bull_exposure_start,
        'bull_tags', NULLIF(p_bull_tags, ''),
        'cow_tags', NULLIF(p_cow_tags, ''),
        'notes', NULLIF(p_notes, '')
      )
    )
  );

  RETURN jsonb_build_object(
    'ok', true,
    'cycle_id', v_id,
    'event_id', v_ae_id,
    'event_type', v_event_type,
    'label', v_label
  );
END
$fn$;

CREATE OR REPLACE FUNCTION public.delete_cattle_breeding_cycle(
  p_cycle_id text
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_caller uuid := auth.uid();
  v_role   text;
  v_row    public.cattle_breeding_cycles%ROWTYPE;
  v_ae_id  text;
BEGIN
  IF v_caller IS NULL THEN
    RAISE EXCEPTION 'delete_cattle_breeding_cycle: authenticated caller required';
  END IF;

  v_role := public.profile_role();
  IF v_role IS NULL OR v_role = 'inactive' THEN
    RAISE EXCEPTION 'delete_cattle_breeding_cycle: caller role % cannot delete', COALESCE(v_role, 'null');
  END IF;

  SELECT * INTO v_row
    FROM public.cattle_breeding_cycles
    WHERE id = p_cycle_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'not_found');
  END IF;

  DELETE FROM public.cattle_breeding_cycles WHERE id = p_cycle_id;

  v_ae_id := 'ae-' || gen_random_uuid()::text;
  INSERT INTO public.activity_events (
    id, entity_type, entity_id, actor_profile_id, event_type, body, payload
  ) VALUES (
    v_ae_id,
    'cattle.breeding',
    'cattle-breeding',
    v_caller,
    'record.deleted',
    'Deleted breeding cycle: ' || COALESCE(v_row.herd, 'mommas') || ' - ' || COALESCE(v_row.bull_exposure_start::text, '?'),
    jsonb_build_object(
      'entity_label', 'Cattle Breeding',
      'record_type', 'cattle_breeding_cycle',
      'cycle_id', p_cycle_id,
      'herd', v_row.herd,
      'bull_exposure_start', v_row.bull_exposure_start,
      'field', 'breeding_cycle',
      'old', to_jsonb(v_row)
    )
  );

  RETURN jsonb_build_object('ok', true, 'reason', 'deleted', 'cycle_id', p_cycle_id, 'event_id', v_ae_id);
END
$fn$;

-- Sheep lambing record delete

CREATE OR REPLACE FUNCTION public.delete_sheep_lambing_record(
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
  v_lambing_date date;
  v_dam_id       text;
  v_ae_id        text;
BEGIN
  IF v_caller IS NULL THEN
    RAISE EXCEPTION 'delete_sheep_lambing_record: authenticated caller required';
  END IF;

  v_role := public.profile_role();
  IF v_role IS NULL OR v_role = 'inactive' THEN
    RAISE EXCEPTION 'delete_sheep_lambing_record: caller role % cannot delete', COALESCE(v_role, 'null');
  END IF;

  SELECT dam_tag, lambing_date
    INTO v_dam_tag, v_lambing_date
    FROM public.sheep_lambing_records
    WHERE id = p_record_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'not_found');
  END IF;

  SELECT id INTO v_dam_id
    FROM public.sheep
    WHERE tag = v_dam_tag AND deleted_at IS NULL
    ORDER BY tag
    LIMIT 1;

  DELETE FROM public.sheep_lambing_records WHERE id = p_record_id;

  IF v_dam_id IS NOT NULL THEN
    v_ae_id := 'ae-' || gen_random_uuid()::text;
    INSERT INTO public.activity_events (
      id, entity_type, entity_id, actor_profile_id, event_type, body, payload
    ) VALUES (
      v_ae_id,
      'sheep.animal',
      v_dam_id,
      v_caller,
      'record.deleted',
      'Deleted lambing record (' || COALESCE(v_lambing_date::text, '?') || ') for #' || COALESCE(v_dam_tag, '?'),
      jsonb_build_object(
        'record_type', 'sheep_lambing_record',
        'lambing_record_id', p_record_id,
        'dam_tag', v_dam_tag,
        'lambing_date', v_lambing_date,
        'team_member', p_team_member
      )
    );
  END IF;

  RETURN jsonb_build_object('ok', true, 'reason', 'deleted', 'dam_id', v_dam_id, 'event_id', v_ae_id);
END
$fn$;

REVOKE ALL ON FUNCTION public.upsert_cattle_breeding_cycle(text, text, date, text, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.upsert_cattle_breeding_cycle(text, text, date, text, text, text) TO authenticated;

REVOKE ALL ON FUNCTION public.delete_cattle_breeding_cycle(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.delete_cattle_breeding_cycle(text) TO authenticated;

REVOKE ALL ON FUNCTION public.delete_sheep_lambing_record(text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.delete_sheep_lambing_record(text, text) TO authenticated;

NOTIFY pgrst, 'reload schema';
