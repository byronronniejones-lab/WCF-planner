-- ============================================================================
-- 127_pasture_map_draw_edit.sql  (Pasture Map CP2 — Draw / Edit)
-- ----------------------------------------------------------------------------
-- Adds the two SECDEF RPCs the in-app draw/edit workflow needs, on top of the
-- mig 116 land model. Both REUSE the mig 116 helpers so the CP1 invariants hold
-- unchanged:
--   _land_area_add_version(area, geom, source, raw, actor)  -> appends a NEW
--     geometry version (append-only; old versions are never mutated), forces
--     2D + MultiPolygon, recomputes GEODESIC acres, sets geometry_status='valid'.
--   _land_area_summary(id) -> the exact jsonb shape list_land_areas returns.
--
--   create_land_area:            mint a NEW land area from a drawn polygon (v1).
--   update_land_area_geometry:   append a new boundary version to an EXISTING
--                                area (edit). Manual acreage override is left
--                                untouched, so computed vs manual stay distinct.
--
-- Both are management/admin only (read stays farm_team/management/admin via the
-- mig 116 list RPC; Light excluded). Self-intersecting / non-polygon geometry is
-- rejected with ST_IsValid + ST_GeometryType (no silent ST_MakeValid). Errors
-- use the 'PM_VALIDATION:' prefix; the bare 'authenticated caller required' stays
-- UNprefixed (mig 112/115/116 convention). PostGIS is schema-qualified to the
-- extensions schema.
--
-- Out of scope (later CPs): move ledger, occupancy, rest coloring, planned
-- moves, stocking density, offline imagery, daily-report wiring.
--
-- NO BEGIN/COMMIT: TEST applies via exec_sql; PROD applies with psql
-- --single-transaction. Apply order: TEST first, PROD after Ronnie approval.
-- Depends on: mig 116 (land_areas, _land_area_add_version, _land_area_summary,
-- profile_role).
-- ============================================================================

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ── 1. create_land_area ─────────────────────────────────────────────────────
-- management/admin. Mint a new land area from a human-drawn polygon and write
-- its first geometry version. Replay-idempotent by p_id. A drawn area is
-- review_status='reviewed' (a manager deliberately drew it) and starts
-- baseline_no_history=true (no grazing history yet — CP3 owns rest).

CREATE OR REPLACE FUNCTION public.create_land_area(
  p_id              text,
  p_name            text,
  p_polygon_geojson jsonb,
  p_kind            text DEFAULT 'unclassified',
  p_source          text DEFAULT 'drawn'
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $fn$
DECLARE
  v_caller uuid := auth.uid();
  v_role   text;
  v_geom   extensions.geometry;
  v_gtype  text;
BEGIN
  IF v_caller IS NULL THEN
    RAISE EXCEPTION 'create_land_area: authenticated caller required';
  END IF;

  v_role := public.profile_role();
  IF v_role IS NULL OR v_role NOT IN ('management', 'admin') THEN
    RAISE EXCEPTION 'PM_VALIDATION: caller role % cannot create land areas', COALESCE(v_role, 'null');
  END IF;

  IF p_id IS NULL OR p_id !~ '^[A-Za-z0-9-]+$' OR length(p_id) > 100 THEN
    RAISE EXCEPTION 'PM_VALIDATION: invalid land area id';
  END IF;

  -- Replay idempotency: a committed id returns its summary unchanged.
  IF EXISTS (SELECT 1 FROM public.land_areas WHERE id = p_id) THEN
    RETURN public._land_area_summary(p_id) || jsonb_build_object('replayed', true);
  END IF;

  IF p_name IS NULL OR length(btrim(p_name)) = 0 OR length(p_name) > 200 THEN
    RAISE EXCEPTION 'PM_VALIDATION: name must be 1..200 characters';
  END IF;
  -- A drawn area is a real closed polygon: outline_candidate (open line) and
  -- scratch are not valid create targets.
  IF p_kind NOT IN ('unclassified', 'pasture', 'feeder_pig_area', 'section', 'paddock', 'infrastructure') THEN
    RAISE EXCEPTION 'PM_VALIDATION: invalid kind % for a drawn area', COALESCE(p_kind, 'null');
  END IF;
  IF COALESCE(p_source, '') NOT IN ('drawn', 'manual') THEN
    RAISE EXCEPTION 'PM_VALIDATION: create source must be drawn/manual';
  END IF;
  IF p_polygon_geojson IS NULL OR jsonb_typeof(p_polygon_geojson) <> 'object' THEN
    RAISE EXCEPTION 'PM_VALIDATION: a GeoJSON polygon object is required';
  END IF;

  v_geom  := extensions.ST_Force2D(extensions.ST_SetSRID(
              extensions.ST_GeomFromGeoJSON(p_polygon_geojson::text), 4326));
  v_gtype := extensions.ST_GeometryType(v_geom);
  IF v_gtype NOT IN ('ST_Polygon', 'ST_MultiPolygon') THEN
    RAISE EXCEPTION 'PM_VALIDATION: drawn geometry must be a polygon (got %)', v_gtype;
  END IF;
  IF NOT extensions.ST_IsValid(v_geom) THEN
    RAISE EXCEPTION 'PM_VALIDATION: drawn polygon is self-intersecting/invalid; fix and retry';
  END IF;

  INSERT INTO public.land_areas
    (id, kind, name, status, review_status, geometry_status, baseline_no_history,
     source, created_by)
  VALUES
    (p_id, p_kind, btrim(p_name), 'active', 'reviewed', 'none', true,
     p_source, v_caller);

  PERFORM public._land_area_add_version(
    p_id, v_geom, p_source, jsonb_build_object('created_via', 'draw'), v_caller);

  RETURN public._land_area_summary(p_id) || jsonb_build_object('replayed', false);
END
$fn$;

REVOKE ALL ON FUNCTION public.create_land_area(text, text, jsonb, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_land_area(text, text, jsonb, text, text) TO authenticated;

-- ── 2. update_land_area_geometry ────────────────────────────────────────────
-- management/admin. Append a new boundary version to an existing area (edit).
-- Old versions are preserved (append-only via _land_area_add_version). Manual
-- acreage override is intentionally NOT touched here, so a manager-set acreage
-- survives a boundary edit while computed_acres refreshes underneath it.

CREATE OR REPLACE FUNCTION public.update_land_area_geometry(
  p_id              text,
  p_polygon_geojson jsonb
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $fn$
DECLARE
  v_caller uuid := auth.uid();
  v_role   text;
  v_row    public.land_areas%ROWTYPE;
  v_geom   extensions.geometry;
  v_gtype  text;
BEGIN
  IF v_caller IS NULL THEN
    RAISE EXCEPTION 'update_land_area_geometry: authenticated caller required';
  END IF;

  v_role := public.profile_role();
  IF v_role IS NULL OR v_role NOT IN ('management', 'admin') THEN
    RAISE EXCEPTION 'PM_VALIDATION: caller role % cannot edit land geometry', COALESCE(v_role, 'null');
  END IF;

  SELECT * INTO v_row FROM public.land_areas WHERE id = p_id FOR UPDATE;
  IF NOT FOUND OR v_row.deleted_at IS NOT NULL THEN
    RAISE EXCEPTION 'PM_VALIDATION: land area % not found', p_id;
  END IF;

  IF p_polygon_geojson IS NULL OR jsonb_typeof(p_polygon_geojson) <> 'object' THEN
    RAISE EXCEPTION 'PM_VALIDATION: a GeoJSON polygon object is required';
  END IF;

  v_geom  := extensions.ST_Force2D(extensions.ST_SetSRID(
              extensions.ST_GeomFromGeoJSON(p_polygon_geojson::text), 4326));
  v_gtype := extensions.ST_GeometryType(v_geom);
  IF v_gtype NOT IN ('ST_Polygon', 'ST_MultiPolygon') THEN
    RAISE EXCEPTION 'PM_VALIDATION: edited geometry must be a polygon (got %)', v_gtype;
  END IF;
  IF NOT extensions.ST_IsValid(v_geom) THEN
    RAISE EXCEPTION 'PM_VALIDATION: edited polygon is self-intersecting/invalid; fix and retry';
  END IF;

  -- The EDIT version's provenance is 'drawn' (a human edit), regardless of the
  -- area's original source: editing an imported OnX area must NOT stamp the new
  -- version as onx_kml. land_areas.source is intentionally left unchanged; the
  -- original source is kept in raw_payload for traceability.
  PERFORM public._land_area_add_version(
    p_id, v_geom, 'drawn',
    jsonb_build_object('edited_via', 'draw', 'origin_source', v_row.source), v_caller);

  RETURN public._land_area_summary(p_id);
END
$fn$;

REVOKE ALL ON FUNCTION public.update_land_area_geometry(text, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.update_land_area_geometry(text, jsonb) TO authenticated;
