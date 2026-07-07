-- ============================================================================
-- 158_pasture_map_positive_overlap_impacts.sql
-- ----------------------------------------------------------------------------
-- Defect: after Mommas moved FP4D1 -> FP4E1, FP4D1 correctly rested and FP4E1
-- correctly read occupied, but boundary-neighbour paddocks that only SHARE AN
-- EDGE with a destination (e.g. FP4C1 next to FP4D1, FP4E2 next to FP4E1) turned
-- green / "resting" even though a group never grazed them.
--
-- Root cause: record_pasture_move (body from mig 148) derives its 'overlap'
-- impacts with extensions.ST_Intersects, which is TRUE for a shared boundary.
-- A shared edge is a zero-AREA touch, not a grazing overlap. So a move into an
-- area wrote 'overlap' impacts onto every edge-touching neighbour, and the next
-- move then wrote 'departure' impacts derived from those same neighbours -- so a
-- neighbour that was never a real destination read occupied (fresh overlap) or
-- resting (derived departure).
--
-- Fix (predicate-level, read-derived; no data mutation, no schema/RLS/return
-- shape change):
--   1) _pasture_areas_overlap(a, b): a shared "grazing overlap" predicate that
--      means positive-AREA polygon intersection, not "touches". It keeps the
--      index-friendly ST_Intersects prefilter, then requires the geodesic area
--      of the intersection to exceed ~1 square metre. An area threshold (not
--      ST_Overlaps) is used deliberately so full CONTAINMENT -- a child paddock
--      inside its parent pasture, or an ad-hoc area drawn across a permanent
--      paddock -- still counts as a real overlap. The 1 m^2 floor rejects
--      boundary/precision specks while preserving any genuine overlap (real
--      paddock overlaps are thousands of m^2).
--   2) record_pasture_move (9-arg, from mig 148) replaces BOTH ST_Intersects-only
--      overlap checks -- the feeder-pig conflict candidate set and the inserted
--      overlap impacts for a new destination -- with the positive-area predicate.
--      Everything else is preserved verbatim: Light role (mig 139),
--      p_total_weight_lbs (mig 148), grants/revokes, the advisory lock, and the
--      feeder-pig conflict behaviour.
--   3) _land_area_is_occupied + _land_area_summary (bodies from mig 155) add the
--      positive-area guard to the READ derivation too, so already-written false
--      boundary-touch impacts become INERT without deleting any rows:
--        - destination impacts count as before (a group placed directly here);
--        - overlap impacts count for current occupancy / last-touch ONLY when
--          this area has a positive-area overlap with the move's to_land_area_id;
--        - departure impacts count when land_area_id = from_land_area_id OR, for
--          overlap-derived departures, when this area has a positive-area overlap
--          with the move's from_land_area_id.
--      This is what makes FP4C1 / FP4E2 re-read as baseline the instant the read
--      functions are replaced, with no PROD data cleanup.
--
-- Preserved guards: mig 149 orphan (NULL directional link) guard, mig 147
-- child-from-parent suppression, and mig 155 same-move departure-beats-overlap.
--
-- Depends on: 128 (_land_area_current_geom), 148 (record_pasture_move 9-arg),
-- 155 (latest _land_area_summary / _land_area_is_occupied bodies).
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1) Shared "grazing overlap" predicate: positive-AREA intersection, not touch.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public._pasture_areas_overlap(p_a text, p_b text)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, extensions
STABLE
AS $fn$
  WITH g AS (
    SELECT public._land_area_current_geom(p_a) AS ga,
           public._land_area_current_geom(p_b) AS gb
  )
  SELECT COALESCE((
    SELECT g.ga IS NOT NULL
       AND g.gb IS NOT NULL
       -- Index-friendly prefilter; short-circuits ST_Intersection below.
       AND extensions.ST_Intersects(g.ga, g.gb)
       -- Positive-AREA overlap only: a shared edge / vertex is a zero-area touch
       -- (ST_Intersection returns a line/point -> geodesic area 0). ~1 m^2 floor
       -- drops boundary/precision specks; real overlaps are far larger.
       AND extensions.ST_Area(
             extensions.ST_Intersection(g.ga, g.gb)::extensions.geography
           ) > 1.0
      FROM g
  ), false);
$fn$;
REVOKE ALL ON FUNCTION public._pasture_areas_overlap(text, text) FROM PUBLIC, anon, authenticated;

-- ----------------------------------------------------------------------------
-- 2) record_pasture_move (9-arg, mig 148 body) — positive-area overlap in the
--    feeder-pig conflict candidate set and the inserted destination overlaps.
--    Everything else (Light role, weight, grants, advisory lock, feeder-pig
--    conflict behaviour) is preserved verbatim.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.record_pasture_move(
  p_move_id          text,
  p_animal_type      text,
  p_group_key        text,
  p_group_label      text,
  p_to_land_area_id  text,
  p_moved_at         timestamptz,
  p_animal_count     int DEFAULT NULL,
  p_total_weight_lbs numeric DEFAULT NULL,
  p_notes            text DEFAULT NULL
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
  IF v_role IS NULL OR v_role NOT IN ('farm_team', 'management', 'admin', 'light') THEN
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
  IF p_total_weight_lbs IS NOT NULL AND p_total_weight_lbs <= 0 THEN
    RAISE EXCEPTION 'PM_VALIDATION: total_weight_lbs must be positive';
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
         -- 158: real (positive-area) overlap only; a shared edge is not a conflict.
         AND public._pasture_areas_overlap(a.id, p_to_land_area_id)
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
     moved_at, animal_count, total_weight_lbs, notes, created_by)
  VALUES
    (p_move_id, p_animal_type, btrim(p_group_key), btrim(p_group_label),
     v_prev.to_land_area_id, p_to_land_area_id, p_moved_at, p_animal_count,
     p_total_weight_lbs, NULLIF(btrim(COALESCE(p_notes, '')), ''), v_caller);

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

    IF v_to_geom IS NOT NULL THEN
      INSERT INTO public.pasture_move_impacts (move_id, land_area_id, impact_kind, impacted_at)
      SELECT p_move_id, a.id, 'overlap', p_moved_at
        FROM public.land_areas a
       WHERE a.id <> p_to_land_area_id
         AND a.deleted_at IS NULL
         AND a.status = 'active'
         AND a.geometry_status = 'valid'
         AND public._land_area_current_geom(a.id) IS NOT NULL
         -- 158: only stamp an overlap impact on areas that share real (positive)
         -- area with the destination, not shared-edge neighbours.
         AND public._pasture_areas_overlap(a.id, p_to_land_area_id)
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
REVOKE ALL ON FUNCTION public.record_pasture_move(text, text, text, text, text, timestamptz, int, numeric, text)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.record_pasture_move(text, text, text, text, text, timestamptz, int, numeric, text)
  TO authenticated;

-- ----------------------------------------------------------------------------
-- 3a) _land_area_is_occupied (mig 155 body) — overlap counts only on positive
--     area overlap with the destination. Same-move departure (155) and child
--     suppression (147) preserved.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public._land_area_is_occupied(p_id text)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, extensions
STABLE
AS $fn$
  WITH latest AS (
    SELECT DISTINCT ON (m.animal_type, m.group_key) m.*
      FROM public.pasture_move_events m
     ORDER BY m.animal_type, m.group_key, m.moved_at DESC, m.created_at DESC
  )
  SELECT EXISTS (
    SELECT 1
      FROM latest l
      JOIN public.pasture_move_impacts i
        ON i.move_id = l.id
       AND i.land_area_id = p_id
       AND i.impact_kind IN ('destination', 'overlap')
       AND l.to_land_area_id IS NOT NULL
       -- Same-move departure wins over overlap: the group moved OUT of this
       -- area, so an adjacent destination overlap must not keep it occupied.
       AND NOT (
         i.impact_kind = 'overlap'
         AND EXISTS (
           SELECT 1
             FROM public.pasture_move_impacts d
            WHERE d.move_id = i.move_id
              AND d.land_area_id = i.land_area_id
              AND d.impact_kind = 'departure'
         )
       )
       -- Preserve mig 147 parent suppression: a child paddock destination does
       -- not make the parent pasture occupied via overlap.
       AND NOT (
         i.impact_kind = 'overlap'
         AND EXISTS (
           SELECT 1 FROM public.land_areas c
            WHERE c.id = l.to_land_area_id
              AND c.parent_id = p_id
         )
       )
       -- 158: an overlap impact makes this area occupied only when it shares
       -- real (positive) area with the move's destination. Shared-edge
       -- neighbours (zero-area touch) are not occupied.
       AND (
         i.impact_kind = 'destination'
         OR public._pasture_areas_overlap(p_id, l.to_land_area_id)
       )
  );
$fn$;
REVOKE ALL ON FUNCTION public._land_area_is_occupied(text) FROM PUBLIC, anon, authenticated;

-- ----------------------------------------------------------------------------
-- 3b) _land_area_summary (mig 155 body) — positive-area overlap guard added to
--     occupancy, last-touch, and departure derivations. Orphan (149), child
--     suppression (147), and same-move departure (155) preserved. Return shape
--     unchanged.
-- ----------------------------------------------------------------------------
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
     AND i.impact_kind IN ('destination', 'overlap')
     -- Orphan guard: a move whose destination link was nulled (143-reset /
     -- area hard-delete FK SET NULL) is not a current placement anywhere.
     AND l.to_land_area_id IS NOT NULL
     -- Same-move departure wins over overlap: the area is resting after move-out
     -- even when the new destination intersects the old boundary.
     AND NOT (
       i.impact_kind = 'overlap'
       AND EXISTS (
         SELECT 1
           FROM public.pasture_move_impacts d
          WHERE d.move_id = i.move_id
            AND d.land_area_id = i.land_area_id
            AND d.impact_kind = 'departure'
       )
     )
     -- Suppress child-derived occupancy: an overlap impact whose move landed in a
     -- direct child paddock of p_id does NOT make this pasture "occupied".
     AND NOT (
       i.impact_kind = 'overlap'
       AND EXISTS (
         SELECT 1 FROM public.land_areas c
          WHERE c.id = l.to_land_area_id
            AND c.parent_id = p_id
       )
     )
     -- 158: an overlap impact counts as current occupancy only when p_id shares
     -- real (positive) area with the move's destination; a shared-edge neighbour
     -- (zero-area touch) is not occupied.
     AND (
       i.impact_kind = 'destination'
       OR public._pasture_areas_overlap(p_id, l.to_land_area_id)
     );

  -- Resting derives from the latest departure; ignore departures whose move left
  -- a direct child paddock of p_id (clearing the child must not rest the parent),
  -- and ignore ORPHAN departures whose move lost its from link (no real prior
  -- stay to rest from -> no visible Reports row would explain "Resting").
  SELECT max(i.impacted_at)
    INTO v_last_departure
    FROM public.pasture_move_impacts i
   WHERE i.land_area_id = p_id
     AND i.impact_kind = 'departure'
     AND EXISTS (
       SELECT 1 FROM public.pasture_move_events e
        WHERE e.id = i.move_id
          AND e.from_land_area_id IS NOT NULL
     )
     AND NOT EXISTS (
       SELECT 1
         FROM public.pasture_move_events e
         JOIN public.land_areas c ON c.id = e.from_land_area_id
        WHERE e.id = i.move_id
          AND c.parent_id = p_id
     )
     -- 158: a departure impact rests p_id only when p_id IS the departed area,
     -- or (for an overlap-derived departure) shares real positive area with the
     -- move's from area. A shared-edge neighbour of the departed area must not
     -- inherit its rest.
     AND EXISTS (
       SELECT 1 FROM public.pasture_move_events e
        WHERE e.id = i.move_id
          AND (
            e.from_land_area_id = p_id
            OR public._pasture_areas_overlap(p_id, e.from_land_area_id)
          )
     );

  -- Last touch (also gates baseline-vs-no_history below): same occupancy guards
  -- for destination/overlap touches, so a departed area does not stay "touched"
  -- only because the next destination overlaps it.
  SELECT max(i.impacted_at)
    INTO v_last_touch
    FROM public.pasture_move_impacts i
    LEFT JOIN public.pasture_move_events e ON e.id = i.move_id
   WHERE i.land_area_id = p_id
     AND i.impact_kind IN ('destination', 'overlap')
     AND e.to_land_area_id IS NOT NULL
     AND NOT (
       i.impact_kind = 'overlap'
       AND EXISTS (
         SELECT 1
           FROM public.pasture_move_impacts d
          WHERE d.move_id = i.move_id
            AND d.land_area_id = i.land_area_id
            AND d.impact_kind = 'departure'
       )
     )
     AND NOT (
       i.impact_kind = 'overlap'
       AND EXISTS (
         SELECT 1 FROM public.land_areas c
          WHERE c.id = e.to_land_area_id
            AND c.parent_id = p_id
       )
     )
     -- 158: an overlap touch counts only on positive-area overlap with the
     -- destination, so an edge-touch neighbour reads baseline, not touched.
     AND (
       i.impact_kind = 'destination'
       OR public._pasture_areas_overlap(p_id, e.to_land_area_id)
     );

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
  ELSIF COALESCE(v_baseline, true)
        -- A parent whose stored baseline flag was flipped false ONLY by child
        -- overlaps (no self destination/overlap touch, no self departure) has no
        -- grazing history of its OWN: read it as baseline, not no_history. Orphan
        -- (NULL-link) impacts and edge-touch overlaps are likewise inert, so an
        -- area whose ONLY remaining impacts are those also reads baseline.
        OR (v_last_touch IS NULL AND v_last_departure IS NULL) THEN
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
    'line_pattern', a.line_pattern,
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

NOTIFY pgrst, 'reload schema';
