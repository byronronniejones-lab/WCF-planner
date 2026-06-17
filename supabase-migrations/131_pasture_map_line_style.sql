-- ============================================================================
-- 131_pasture_map_line_style.sql  (Pasture Map CP7 - Boundary Line Style)
-- ----------------------------------------------------------------------------
-- Adds optional per-area boundary styling so paddock/pasture/infrastructure
-- outlines can carry a manager-chosen line color and stroke weight. These are
-- presentation fields only; geometry, acreage, move history, and rest state
-- remain unchanged.
--
-- Role model:
--   update_land_area line style args: management / admin only
--   list_land_areas summaries expose line_color / line_weight to map readers.
--
-- Depends on: mig 116 land_areas + _land_area_summary + update_land_area.
-- ============================================================================

ALTER TABLE public.land_areas
  ADD COLUMN IF NOT EXISTS line_color text,
  ADD COLUMN IF NOT EXISTS line_weight integer;

DO $$
BEGIN
  ALTER TABLE public.land_areas
    ADD CONSTRAINT land_areas_line_color_check
    CHECK (line_color IS NULL OR line_color ~ '^#[0-9A-Fa-f]{6}$');
EXCEPTION WHEN duplicate_object THEN
  NULL;
END $$;

DO $$
BEGIN
  ALTER TABLE public.land_areas
    ADD CONSTRAINT land_areas_line_weight_check
    CHECK (line_weight IS NULL OR line_weight BETWEEN 1 AND 10);
EXCEPTION WHEN duplicate_object THEN
  NULL;
END $$;

COMMENT ON COLUMN public.land_areas.line_color IS
  'Optional manager-selected hex color for the rendered boundary stroke.';
COMMENT ON COLUMN public.land_areas.line_weight IS
  'Optional manager-selected boundary stroke width in pixels, 1..10.';

CREATE OR REPLACE FUNCTION public._land_area_summary(p_id text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
STABLE
AS $fn$
DECLARE
  v_out jsonb;
  v_current jsonb;
  v_current_count int := 0;
  v_last_departure timestamptz;
  v_last_touch timestamptz;
  v_baseline boolean := true;
  v_rest_days int;
  v_rest_state text;
BEGIN
  WITH latest AS (
    SELECT DISTINCT ON (m.animal_type, m.group_key) m.*
      FROM public.pasture_move_events m
     ORDER BY m.animal_type, m.group_key, m.moved_at DESC, m.created_at DESC
  )
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'move_id', l.id,
           'animal_type', l.animal_type,
           'group_key', l.group_key,
           'group_label', l.group_label,
           'moved_at', l.moved_at,
           'animal_count', l.animal_count,
           'impact_kind', i.impact_kind
         ) ORDER BY l.animal_type, l.group_label), '[]'::jsonb),
         count(*)::int
    INTO v_current, v_current_count
    FROM latest l
    JOIN public.pasture_move_impacts i
      ON i.move_id = l.id
     AND i.land_area_id = p_id
     AND i.impact_kind IN ('destination', 'overlap');

  SELECT max(impacted_at)
    INTO v_last_departure
    FROM public.pasture_move_impacts
   WHERE land_area_id = p_id
     AND impact_kind = 'departure';

  SELECT max(impacted_at)
    INTO v_last_touch
    FROM public.pasture_move_impacts
   WHERE land_area_id = p_id
     AND impact_kind IN ('destination', 'overlap');

  SELECT baseline_no_history
    INTO v_baseline
    FROM public.land_areas
   WHERE id = p_id;

  IF v_current_count > 0 THEN
    v_rest_days := 0;
    v_rest_state := 'occupied';
  ELSIF v_last_departure IS NOT NULL THEN
    v_rest_days := floor(extract(epoch from (now() - v_last_departure)) / 86400)::int;
    v_rest_state := CASE WHEN v_rest_days < 60 THEN 'resting' ELSE 'rested' END;
  ELSIF COALESCE(v_baseline, true) THEN
    v_rest_days := NULL;
    v_rest_state := 'baseline';
  ELSE
    v_rest_days := NULL;
    v_rest_state := 'no_history';
  END IF;

  SELECT jsonb_build_object(
    'id', a.id,
    'parent_id', a.parent_id,
    'kind', a.kind,
    'name', a.name,
    'permanence', a.permanence,
    'designation', a.designation,
    'status', a.status,
    'review_status', a.review_status,
    'geometry_status', a.geometry_status,
    'baseline_no_history', a.baseline_no_history,
    'manual_acres', a.manual_acres,
    'computed_acres', a.computed_acres,
    'effective_acres', COALESCE(a.manual_acres, a.computed_acres),
    'source', a.source,
    'source_external_id', a.source_external_id,
    'import_batch_id', a.import_batch_id,
    'raw_name', a.raw_name,
    'raw_notes', a.raw_notes,
    'raw_color', a.raw_color,
    'line_color', a.line_color,
    'line_weight', a.line_weight,
    'created_at', a.created_at,
    'updated_at', a.updated_at,
    'child_count', (SELECT count(*) FROM public.land_areas c
                     WHERE c.parent_id = a.id AND c.deleted_at IS NULL),
    'raw_geometry', CASE WHEN a.raw_geometry IS NULL THEN NULL
                         ELSE extensions.ST_AsGeoJSON(a.raw_geometry)::jsonb END,
    'current_version', (
      SELECT jsonb_build_object(
        'id', v.id,
        'version_number', v.version_number,
        'computed_acres', v.computed_acres,
        'created_at', v.created_at,
        'geometry', extensions.ST_AsGeoJSON(v.geom)::jsonb)
      FROM public.land_area_geometry_versions v
      WHERE v.land_area_id = a.id
      ORDER BY v.version_number DESC
      LIMIT 1
    ),
    'current_occupants', v_current,
    'current_occupancy_count', v_current_count,
    'last_touched_at', v_last_touch,
    'last_moved_out_at', v_last_departure,
    'rest_days', v_rest_days,
    'rest_state', v_rest_state
  )
  INTO v_out
  FROM public.land_areas a
  WHERE a.id = p_id;

  RETURN v_out;
END
$fn$;
REVOKE ALL ON FUNCTION public._land_area_summary(text) FROM PUBLIC, anon, authenticated;

DROP FUNCTION IF EXISTS public.update_land_area(
  text, text, text, text, boolean, text, text, text, text, numeric, boolean
);

CREATE OR REPLACE FUNCTION public.update_land_area(
  p_id               text,
  p_name             text    DEFAULT NULL,
  p_kind             text    DEFAULT NULL,
  p_parent_id        text    DEFAULT NULL,
  p_clear_parent     boolean DEFAULT false,
  p_permanence       text    DEFAULT NULL,
  p_designation      text    DEFAULT NULL,
  p_status           text    DEFAULT NULL,
  p_review_status    text    DEFAULT NULL,
  p_manual_acres     numeric DEFAULT NULL,
  p_clear_manual     boolean DEFAULT false,
  p_line_color       text    DEFAULT NULL,
  p_line_weight      integer DEFAULT NULL,
  p_clear_line_style boolean DEFAULT false
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $fn$
DECLARE
  v_caller uuid := auth.uid();
  v_role   text;
  v_row    public.land_areas%ROWTYPE;
  v_color  text;
BEGIN
  IF v_caller IS NULL THEN
    RAISE EXCEPTION 'update_land_area: authenticated caller required';
  END IF;

  v_role := public.profile_role();
  IF v_role IS NULL OR v_role NOT IN ('management', 'admin') THEN
    RAISE EXCEPTION 'PM_VALIDATION: caller role % cannot edit land areas', COALESCE(v_role, 'null');
  END IF;

  SELECT * INTO v_row FROM public.land_areas WHERE id = p_id FOR UPDATE;
  IF NOT FOUND OR v_row.deleted_at IS NOT NULL THEN
    RAISE EXCEPTION 'PM_VALIDATION: land area % not found', p_id;
  END IF;

  IF p_name IS NOT NULL THEN
    IF length(btrim(p_name)) = 0 OR length(p_name) > 200 THEN
      RAISE EXCEPTION 'PM_VALIDATION: name must be 1..200 characters';
    END IF;
    UPDATE public.land_areas SET name = btrim(p_name) WHERE id = p_id;
  END IF;

  IF p_kind IS NOT NULL THEN
    IF p_kind NOT IN ('unclassified', 'pasture', 'feeder_pig_area', 'section',
                      'paddock', 'infrastructure', 'scratch', 'outline_candidate') THEN
      RAISE EXCEPTION 'PM_VALIDATION: unknown kind %', p_kind;
    END IF;
    UPDATE public.land_areas SET kind = p_kind WHERE id = p_id;
  END IF;

  IF p_clear_parent THEN
    UPDATE public.land_areas SET parent_id = NULL WHERE id = p_id;
  ELSIF p_parent_id IS NOT NULL THEN
    IF p_parent_id = p_id THEN
      RAISE EXCEPTION 'PM_VALIDATION: an area cannot be its own parent';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM public.land_areas
                    WHERE id = p_parent_id AND deleted_at IS NULL) THEN
      RAISE EXCEPTION 'PM_VALIDATION: parent area % not found', p_parent_id;
    END IF;
    IF EXISTS (
      WITH RECURSIVE ancestors(id, parent_id, depth) AS (
        SELECT la.id, la.parent_id, 1
          FROM public.land_areas la WHERE la.id = p_parent_id
        UNION ALL
        SELECT la.id, la.parent_id, a.depth + 1
          FROM public.land_areas la
          JOIN ancestors a ON la.id = a.parent_id
         WHERE a.depth < 1000
      )
      SELECT 1 FROM ancestors WHERE id = p_id
    ) THEN
      RAISE EXCEPTION 'PM_VALIDATION: parent assignment would create a cycle';
    END IF;
    UPDATE public.land_areas SET parent_id = p_parent_id WHERE id = p_id;
  END IF;

  IF p_permanence IS NOT NULL THEN
    IF p_permanence NOT IN ('permanent', 'temporary') THEN
      RAISE EXCEPTION 'PM_VALIDATION: unknown permanence %', p_permanence;
    END IF;
    UPDATE public.land_areas SET permanence = p_permanence WHERE id = p_id;
  END IF;

  IF p_designation IS NOT NULL THEN
    IF p_designation NOT IN ('cattle', 'feeder_pig', 'sheep', 'breeder_pig', 'mixed', 'none') THEN
      RAISE EXCEPTION 'PM_VALIDATION: unknown designation %', p_designation;
    END IF;
    UPDATE public.land_areas SET designation = p_designation WHERE id = p_id;
  END IF;

  IF p_status IS NOT NULL THEN
    IF p_status NOT IN ('active', 'retired', 'blocked_repair') THEN
      RAISE EXCEPTION 'PM_VALIDATION: unknown status %', p_status;
    END IF;
    UPDATE public.land_areas SET status = p_status WHERE id = p_id;
  END IF;

  IF p_review_status IS NOT NULL THEN
    IF p_review_status NOT IN ('pending_review', 'reviewed') THEN
      RAISE EXCEPTION 'PM_VALIDATION: unknown review_status %', p_review_status;
    END IF;
    UPDATE public.land_areas SET review_status = p_review_status WHERE id = p_id;
  END IF;

  IF p_clear_manual THEN
    UPDATE public.land_areas SET manual_acres = NULL WHERE id = p_id;
  ELSIF p_manual_acres IS NOT NULL THEN
    IF p_manual_acres < 0 OR p_manual_acres > 1000000 THEN
      RAISE EXCEPTION 'PM_VALIDATION: manual_acres out of range';
    END IF;
    UPDATE public.land_areas SET manual_acres = round(p_manual_acres, 4) WHERE id = p_id;
  END IF;

  IF p_clear_line_style THEN
    UPDATE public.land_areas
       SET line_color = NULL,
           line_weight = NULL
     WHERE id = p_id;
  ELSE
    IF p_line_color IS NOT NULL THEN
      v_color := lower(btrim(p_line_color));
      IF v_color !~ '^#[0-9a-f]{6}$' THEN
        RAISE EXCEPTION 'PM_VALIDATION: line_color must be a 6-digit hex color';
      END IF;
      UPDATE public.land_areas SET line_color = v_color WHERE id = p_id;
    END IF;

    IF p_line_weight IS NOT NULL THEN
      IF p_line_weight < 1 OR p_line_weight > 10 THEN
        RAISE EXCEPTION 'PM_VALIDATION: line_weight must be between 1 and 10';
      END IF;
      UPDATE public.land_areas SET line_weight = p_line_weight WHERE id = p_id;
    END IF;
  END IF;

  UPDATE public.land_areas SET updated_at = now() WHERE id = p_id;
  RETURN public._land_area_summary(p_id);
END
$fn$;
REVOKE ALL ON FUNCTION public.update_land_area(
  text, text, text, text, boolean, text, text, text, text, numeric, boolean, text, integer, boolean
) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.update_land_area(
  text, text, text, text, boolean, text, text, text, text, numeric, boolean, text, integer, boolean
) TO authenticated;

NOTIFY pgrst, 'reload schema';
