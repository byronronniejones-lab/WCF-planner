-- ============================================================================
-- 128_pasture_map_move_ledger.sql  (Pasture Map CP3 - Move Ledger / Occupancy)
-- ----------------------------------------------------------------------------
-- Adds the dated animal-group move ledger on top of the CP1/CP2 land model.
-- Land remains species-neutral: cattle herds, sheep flocks, breeder pigs, and
-- feeder pigs are stored as group keys on move events, never as columns on
-- land_areas. Current occupancy and rest state are derived from append-only
-- events + impact rows.
--
-- Rules locked in PROJECT.md:
--   * no fake last-grazed dates; imported/drawn areas stay baseline until a
--     real move touches them.
--   * once an animal touches any part of a paddock/rest unit, rest resets for
--     that unit.
--   * cattle one paddock per herd: each new move supersedes the herd's prior
--     current move.
--   * feeder-pig exclusivity: only one active feeder-pig group can occupy a
--     touched area at a time.
--   * sheep and breeder pigs may use overlapping ad-hoc areas.
--
-- Roles:
--   read moves/occupancy:  farm_team / management / admin
--   record moves:         farm_team / management / admin
--   geometry edits remain management/admin only (migrations 116/127).
--
-- NO BEGIN/COMMIT: TEST applies via exec_sql; PROD applies with psql
-- --single-transaction. Apply order: TEST first, PROD after Ronnie approval.
-- Depends on: migrations 116 and 127.
-- ============================================================================

CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS postgis WITH SCHEMA extensions;

-- One row per user-recorded move. Append-only: corrections are modeled by a
-- later move, not by mutating history.
CREATE TABLE IF NOT EXISTS public.pasture_move_events (
  id                text PRIMARY KEY,
  animal_type       text NOT NULL
                      CHECK (animal_type IN ('cattle_herd', 'sheep_flock',
                                             'breeder_pigs', 'feeder_pigs')),
  group_key         text NOT NULL,
  group_label       text NOT NULL,
  from_land_area_id text REFERENCES public.land_areas(id) ON DELETE SET NULL,
  to_land_area_id   text REFERENCES public.land_areas(id) ON DELETE SET NULL,
  moved_at          timestamptz NOT NULL,
  animal_count      int CHECK (animal_count IS NULL OR animal_count > 0),
  notes             text,
  created_by        uuid REFERENCES public.profiles(id),
  created_at        timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS pasture_move_events_group_idx
  ON public.pasture_move_events (animal_type, group_key, moved_at DESC, created_at DESC);
CREATE INDEX IF NOT EXISTS pasture_move_events_to_area_idx
  ON public.pasture_move_events (to_land_area_id, moved_at DESC);
CREATE INDEX IF NOT EXISTS pasture_move_events_from_area_idx
  ON public.pasture_move_events (from_land_area_id, moved_at DESC);

REVOKE ALL ON TABLE public.pasture_move_events FROM PUBLIC, anon, authenticated;
ALTER TABLE public.pasture_move_events ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS pasture_move_events_deny_all ON public.pasture_move_events;
CREATE POLICY pasture_move_events_deny_all ON public.pasture_move_events
  FOR ALL USING (false);

-- Impact rows tell the map which land areas a move touches. A destination move
-- touches its target area and any valid active area whose polygon intersects the
-- target polygon. When a group moves again, the prior move's destination/overlap
-- impacts get a departure impact so rest can start for every touched unit.
CREATE TABLE IF NOT EXISTS public.pasture_move_impacts (
  move_id     text NOT NULL REFERENCES public.pasture_move_events(id) ON DELETE CASCADE,
  land_area_id text NOT NULL REFERENCES public.land_areas(id) ON DELETE CASCADE,
  impact_kind text NOT NULL CHECK (impact_kind IN ('destination', 'overlap', 'departure')),
  impacted_at timestamptz NOT NULL,
  PRIMARY KEY (move_id, land_area_id, impact_kind)
);

CREATE INDEX IF NOT EXISTS pasture_move_impacts_area_idx
  ON public.pasture_move_impacts (land_area_id, impacted_at DESC);

REVOKE ALL ON TABLE public.pasture_move_impacts FROM PUBLIC, anon, authenticated;
ALTER TABLE public.pasture_move_impacts ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS pasture_move_impacts_deny_all ON public.pasture_move_impacts;
CREATE POLICY pasture_move_impacts_deny_all ON public.pasture_move_impacts
  FOR ALL USING (false);

-- Current polygon for a land area, as PostGIS geometry. Uses the latest
-- append-only version first and falls back to a valid polygon raw_geometry.
CREATE OR REPLACE FUNCTION public._land_area_current_geom(p_id text)
RETURNS extensions.geometry
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
STABLE
AS $fn$
DECLARE
  v_geom extensions.geometry;
BEGIN
  SELECT v.geom
    INTO v_geom
    FROM public.land_area_geometry_versions v
   WHERE v.land_area_id = p_id
   ORDER BY v.version_number DESC
   LIMIT 1;

  IF v_geom IS NOT NULL THEN
    RETURN v_geom;
  END IF;

  SELECT CASE
           WHEN a.raw_geometry IS NOT NULL
            AND extensions.ST_GeometryType(a.raw_geometry) IN ('ST_Polygon', 'ST_MultiPolygon')
           THEN extensions.ST_Multi(a.raw_geometry)
           ELSE NULL
         END
    INTO v_geom
    FROM public.land_areas a
   WHERE a.id = p_id;

  RETURN v_geom;
END
$fn$;
REVOKE ALL ON FUNCTION public._land_area_current_geom(text) FROM PUBLIC, anon, authenticated;

-- One move -> json summary for client list/history.
CREATE OR REPLACE FUNCTION public._pasture_move_summary(p_id text)
RETURNS jsonb
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, extensions
STABLE
AS $fn$
  SELECT jsonb_build_object(
    'id', m.id,
    'animal_type', m.animal_type,
    'group_key', m.group_key,
    'group_label', m.group_label,
    'from_land_area_id', m.from_land_area_id,
    'from_land_area_name', fa.name,
    'to_land_area_id', m.to_land_area_id,
    'to_land_area_name', ta.name,
    'moved_at', m.moved_at,
    'animal_count', m.animal_count,
    'notes', m.notes,
    'created_at', m.created_at,
    'impact_count', (
      SELECT count(*) FROM public.pasture_move_impacts i WHERE i.move_id = m.id
    )
  )
  FROM public.pasture_move_events m
  LEFT JOIN public.land_areas fa ON fa.id = m.from_land_area_id
  LEFT JOIN public.land_areas ta ON ta.id = m.to_land_area_id
  WHERE m.id = p_id;
$fn$;
REVOKE ALL ON FUNCTION public._pasture_move_summary(text) FROM PUBLIC, anon, authenticated;

-- Replace the CP1 helper with the same return shape plus CP3 occupancy/rest
-- fields. list_land_areas keeps calling this helper, so existing clients get
-- the new derived state without a new endpoint.
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

-- Recent append-only move list.
CREATE OR REPLACE FUNCTION public.list_pasture_moves(
  p_limit int DEFAULT 100
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $fn$
DECLARE
  v_caller uuid := auth.uid();
  v_role text;
  v_moves jsonb;
  v_limit int := LEAST(GREATEST(COALESCE(p_limit, 100), 1), 500);
BEGIN
  IF v_caller IS NULL THEN
    RAISE EXCEPTION 'list_pasture_moves: authenticated caller required';
  END IF;

  v_role := public.profile_role();
  IF v_role IS NULL OR v_role NOT IN ('farm_team', 'management', 'admin') THEN
    RAISE EXCEPTION 'PM_VALIDATION: caller role % cannot read pasture moves', COALESCE(v_role, 'null');
  END IF;

  SELECT COALESCE(jsonb_agg(public._pasture_move_summary(m.id)
           ORDER BY m.moved_at DESC, m.created_at DESC), '[]'::jsonb)
    INTO v_moves
    FROM (
      SELECT id, moved_at, created_at
        FROM public.pasture_move_events
       ORDER BY moved_at DESC, created_at DESC
       LIMIT v_limit
    ) m;

  RETURN jsonb_build_object('moves', v_moves);
END
$fn$;
REVOKE ALL ON FUNCTION public.list_pasture_moves(int) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.list_pasture_moves(int) TO authenticated;

-- Record one move and derive impacts. Replay-idempotent by p_move_id.
CREATE OR REPLACE FUNCTION public.record_pasture_move(
  p_move_id         text,
  p_animal_type     text,
  p_group_key       text,
  p_group_label     text,
  p_to_land_area_id text,
  p_moved_at        timestamptz,
  p_animal_count    int DEFAULT NULL,
  p_notes           text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $fn$
DECLARE
  v_caller uuid := auth.uid();
  v_role text;
  v_prev public.pasture_move_events%ROWTYPE;
  v_to public.land_areas%ROWTYPE;
  v_to_geom extensions.geometry;
  v_conflict text;
BEGIN
  IF v_caller IS NULL THEN
    RAISE EXCEPTION 'record_pasture_move: authenticated caller required';
  END IF;

  v_role := public.profile_role();
  IF v_role IS NULL OR v_role NOT IN ('farm_team', 'management', 'admin') THEN
    RAISE EXCEPTION 'PM_VALIDATION: caller role % cannot record pasture moves', COALESCE(v_role, 'null');
  END IF;

  IF p_move_id IS NULL OR p_move_id !~ '^[A-Za-z0-9-]+$' OR length(p_move_id) > 100 THEN
    RAISE EXCEPTION 'PM_VALIDATION: invalid move id';
  END IF;
  IF EXISTS (SELECT 1 FROM public.pasture_move_events WHERE id = p_move_id) THEN
    RETURN public._pasture_move_summary(p_move_id) || jsonb_build_object('replayed', true);
  END IF;

  IF p_animal_type NOT IN ('cattle_herd', 'sheep_flock', 'breeder_pigs', 'feeder_pigs') THEN
    RAISE EXCEPTION 'PM_VALIDATION: unknown animal type %', COALESCE(p_animal_type, 'null');
  END IF;
  IF p_group_key IS NULL OR length(btrim(p_group_key)) = 0 OR length(p_group_key) > 120 THEN
    RAISE EXCEPTION 'PM_VALIDATION: group key required';
  END IF;
  IF p_group_label IS NULL OR length(btrim(p_group_label)) = 0 OR length(p_group_label) > 160 THEN
    RAISE EXCEPTION 'PM_VALIDATION: group label required';
  END IF;
  IF p_moved_at IS NULL THEN
    RAISE EXCEPTION 'PM_VALIDATION: moved_at required';
  END IF;
  IF p_animal_count IS NOT NULL AND p_animal_count <= 0 THEN
    RAISE EXCEPTION 'PM_VALIDATION: animal_count must be positive';
  END IF;

  IF p_to_land_area_id IS NOT NULL THEN
    SELECT * INTO v_to
      FROM public.land_areas
     WHERE id = p_to_land_area_id
       AND deleted_at IS NULL
     FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'PM_VALIDATION: destination land area % not found', p_to_land_area_id;
    END IF;
    IF v_to.status <> 'active' THEN
      RAISE EXCEPTION 'PM_VALIDATION: destination land area % is not active', p_to_land_area_id;
    END IF;
    v_to_geom := public._land_area_current_geom(p_to_land_area_id);
  END IF;

  -- Serialize one group so concurrent field tablets cannot double-open a group.
  PERFORM pg_advisory_xact_lock(hashtext('pasture_move_group'), hashtext(p_animal_type || ':' || btrim(p_group_key)));

  SELECT * INTO v_prev
    FROM public.pasture_move_events
   WHERE animal_type = p_animal_type
     AND group_key = btrim(p_group_key)
   ORDER BY moved_at DESC, created_at DESC
   LIMIT 1
   FOR UPDATE;

  IF p_animal_type = 'feeder_pigs' AND p_to_land_area_id IS NOT NULL THEN
    WITH latest AS (
      SELECT DISTINCT ON (m.animal_type, m.group_key) m.*
        FROM public.pasture_move_events m
       ORDER BY m.animal_type, m.group_key, m.moved_at DESC, m.created_at DESC
    ),
    target_impacts AS (
      SELECT p_to_land_area_id AS land_area_id
      UNION
      SELECT a.id
        FROM public.land_areas a
       WHERE v_to_geom IS NOT NULL
         AND a.id <> p_to_land_area_id
         AND a.deleted_at IS NULL
         AND a.status = 'active'
         AND a.geometry_status = 'valid'
         AND public._land_area_current_geom(a.id) IS NOT NULL
         AND extensions.ST_Intersects(public._land_area_current_geom(a.id), v_to_geom)
    )
    SELECT l.group_label
      INTO v_conflict
      FROM latest l
      JOIN public.pasture_move_impacts i
        ON i.move_id = l.id
       AND i.impact_kind IN ('destination', 'overlap')
      JOIN target_impacts ti
        ON ti.land_area_id = i.land_area_id
     WHERE l.animal_type = 'feeder_pigs'
       AND l.group_key <> btrim(p_group_key)
     LIMIT 1;

    IF v_conflict IS NOT NULL THEN
      RAISE EXCEPTION 'PM_VALIDATION: feeder pig area already occupied by %', v_conflict;
    END IF;
  END IF;

  INSERT INTO public.pasture_move_events
    (id, animal_type, group_key, group_label, from_land_area_id, to_land_area_id,
     moved_at, animal_count, notes, created_by)
  VALUES
    (p_move_id, p_animal_type, btrim(p_group_key), btrim(p_group_label),
     v_prev.to_land_area_id, p_to_land_area_id, p_moved_at, p_animal_count,
     NULLIF(btrim(COALESCE(p_notes, '')), ''), v_caller);

  -- Close the prior move's touched areas so rest starts for all impacted units.
  IF v_prev.id IS NOT NULL THEN
    INSERT INTO public.pasture_move_impacts (move_id, land_area_id, impact_kind, impacted_at)
    SELECT p_move_id, i.land_area_id, 'departure', p_moved_at
      FROM public.pasture_move_impacts i
     WHERE i.move_id = v_prev.id
       AND i.impact_kind IN ('destination', 'overlap')
    ON CONFLICT DO NOTHING;
  END IF;

  IF p_to_land_area_id IS NOT NULL THEN
    INSERT INTO public.pasture_move_impacts (move_id, land_area_id, impact_kind, impacted_at)
    VALUES (p_move_id, p_to_land_area_id, 'destination', p_moved_at)
    ON CONFLICT DO NOTHING;

    -- If the destination geometry overlaps any other active polygon, mark those
    -- areas as touched too. This is what lets ad-hoc sheep/breeder-pig areas
    -- reset rest on the permanent paddocks they cross.
    IF v_to_geom IS NOT NULL THEN
      INSERT INTO public.pasture_move_impacts (move_id, land_area_id, impact_kind, impacted_at)
      SELECT p_move_id, a.id, 'overlap', p_moved_at
        FROM public.land_areas a
       WHERE a.id <> p_to_land_area_id
         AND a.deleted_at IS NULL
         AND a.status = 'active'
         AND a.geometry_status = 'valid'
         AND public._land_area_current_geom(a.id) IS NOT NULL
         AND extensions.ST_Intersects(public._land_area_current_geom(a.id), v_to_geom)
      ON CONFLICT DO NOTHING;
    END IF;

    UPDATE public.land_areas
       SET baseline_no_history = false,
           updated_at = now()
     WHERE id IN (
       SELECT land_area_id
         FROM public.pasture_move_impacts
        WHERE move_id = p_move_id
          AND impact_kind IN ('destination', 'overlap')
     );
  END IF;

  -- The previous area also now has real history.
  UPDATE public.land_areas
     SET baseline_no_history = false,
         updated_at = now()
   WHERE id IN (
     SELECT land_area_id
       FROM public.pasture_move_impacts
      WHERE move_id = p_move_id
        AND impact_kind = 'departure'
   );

  RETURN public._pasture_move_summary(p_move_id) || jsonb_build_object('replayed', false);
END
$fn$;
REVOKE ALL ON FUNCTION public.record_pasture_move(text, text, text, text, text, timestamptz, int, text)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.record_pasture_move(text, text, text, text, text, timestamptz, int, text)
  TO authenticated;
