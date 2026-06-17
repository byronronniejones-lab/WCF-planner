-- ============================================================================
-- 130_pasture_map_field_tracks.sql  (Pasture Map CP6 - Field GPS Tracks)
-- ----------------------------------------------------------------------------
-- Adds a narrow SECDEF RPC for creating an outline_candidate from a GPS track
-- recorded in the field. This is intentionally NOT a polygon creator: field
-- tracks save as LineString raw_geometry and must still go through the existing
-- close_land_area_outline human-confirmation path before becoming a real
-- paddock/pasture boundary.
--
-- Role model:
--   create_land_area_track: farm_team / management / admin
--     farm_team can capture a track while walking/driving the farm.
--     management/admin still own close/classify/delete through existing RPCs.
--
-- Depends on: mig 116 (_land_area_summary, land_areas, profile_role).
-- ============================================================================

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE OR REPLACE FUNCTION public.create_land_area_track(
  p_id           text,
  p_name         text,
  p_line_geojson jsonb,
  p_source       text DEFAULT 'drawn'
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
    RAISE EXCEPTION 'create_land_area_track: authenticated caller required';
  END IF;

  v_role := public.profile_role();
  IF v_role IS NULL OR v_role NOT IN ('farm_team', 'management', 'admin') THEN
    RAISE EXCEPTION 'PM_VALIDATION: caller role % cannot create field tracks', COALESCE(v_role, 'null');
  END IF;

  IF p_id IS NULL OR p_id !~ '^[A-Za-z0-9-]+$' OR length(p_id) > 100 THEN
    RAISE EXCEPTION 'PM_VALIDATION: invalid track id';
  END IF;

  -- Replay idempotency: a committed id returns its summary unchanged.
  IF EXISTS (SELECT 1 FROM public.land_areas WHERE id = p_id) THEN
    RETURN public._land_area_summary(p_id) || jsonb_build_object('replayed', true);
  END IF;

  IF p_name IS NULL OR length(btrim(p_name)) = 0 OR length(p_name) > 200 THEN
    RAISE EXCEPTION 'PM_VALIDATION: name must be 1..200 characters';
  END IF;
  IF COALESCE(p_source, '') NOT IN ('drawn', 'manual') THEN
    RAISE EXCEPTION 'PM_VALIDATION: track source must be drawn/manual';
  END IF;
  IF p_line_geojson IS NULL OR jsonb_typeof(p_line_geojson) <> 'object' THEN
    RAISE EXCEPTION 'PM_VALIDATION: a GeoJSON LineString object is required';
  END IF;

  v_geom := extensions.ST_Force2D(extensions.ST_SetSRID(
              extensions.ST_GeomFromGeoJSON(p_line_geojson::text), 4326));
  v_gtype := extensions.ST_GeometryType(v_geom);
  IF v_gtype NOT IN ('ST_LineString', 'ST_MultiLineString') THEN
    RAISE EXCEPTION 'PM_VALIDATION: field track must be a line (got %)', v_gtype;
  END IF;
  IF extensions.ST_NPoints(v_geom) < 2 THEN
    RAISE EXCEPTION 'PM_VALIDATION: field track needs at least two GPS points';
  END IF;

  INSERT INTO public.land_areas
    (id, kind, name, status, review_status, geometry_status, baseline_no_history,
     raw_geometry, source, raw_notes, created_by)
  VALUES
    (p_id, 'outline_candidate', btrim(p_name), 'active', 'pending_review',
     'outline_candidate', true, v_geom, p_source, 'created_via=field_track', v_caller);

  RETURN public._land_area_summary(p_id) || jsonb_build_object('replayed', false);
END
$fn$;

REVOKE ALL ON FUNCTION public.create_land_area_track(text, text, jsonb, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_land_area_track(text, text, jsonb, text) TO authenticated;
