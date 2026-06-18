-- ============================================================================
-- 135_pasture_map_temp_paddocks.sql  —  Pasture Map planner-group redesign, P0
-- ----------------------------------------------------------------------------
-- Adds the temp-paddock lifecycle API so the field roster redesign can let the
-- farm team create/edit/archive their OWN working temp paddocks, while keeping
-- the existing management/admin locks on permanent-area RPCs untouched.
--
-- Design decisions locked for this build (Codex/Ronnie):
--   D1  Temp paddock = kind='paddock' + permanence='temporary'. No kind='temp'.
--   D2  Narrow new SECDEF RPCs only. create_land_area / update_land_area /
--       update_land_area_geometry / delete_land_area stay as-is (mgmt/admin).
--   D3  Admin "hard delete" v1 = existing soft-delete/snapshot path
--       (deleted_at, deleted_by). Geometry rows are retained in DB for now;
--       a true geometry purge is a REQUIRED future follow-up, not dropped.
--   D4  No-history/baseline stays solid. No line-style contract change here.
--
-- Role model added by this migration:
--   create_temp_land_area          farm_team / management / admin
--   update_temp_land_area_geometry temp owner OR management / admin
--   rename_temp_land_area          temp owner OR management / admin
--   archive_land_area              temp: owner OR mgmt/admin; permanent: mgmt/admin
--   restore_land_area              same role/ownership rule as archive
--   hard_delete_land_area          admin ONLY
--
-- Occupancy guard: archive_land_area and hard_delete_land_area reject an area
-- that currently has animals attached, via the sentinel
--   PM_VALIDATION: PM_AREA_OCCUPIED
-- The client maps that sentinel to the exact UI copy
--   "Move animals out of this temp paddock before archiving it."
-- so the human sentence is NOT hardcoded server-side.
--
-- Archive uses status='retired' (restorable). Hard delete uses deleted_at.
-- Pasture Map stays farm_team / management / admin — NO light access.
--
-- Depends on: mig 116 (land_areas, _land_area_add_version, profile_role),
--             mig 127 (create_land_area shape), mig 128 (_land_area_summary,
--             pasture_move_events / pasture_move_impacts occupancy model).
-- ============================================================================

-- ── 0. _land_area_is_occupied (internal) ────────────────────────────────────
-- True when the latest move for some animal group currently lands on this area
-- (destination/overlap). Mirrors the occupancy logic in _land_area_summary so
-- archive/hard-delete and the summary agree on "occupied".

CREATE OR REPLACE FUNCTION public._land_area_is_occupied(p_id text)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, extensions
STABLE
AS $fn$
  WITH latest AS (
    SELECT DISTINCT ON (m.animal_type, m.group_key) m.id
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
  );
$fn$;
REVOKE ALL ON FUNCTION public._land_area_is_occupied(text) FROM PUBLIC, anon, authenticated;

-- ── 1. create_temp_land_area ────────────────────────────────────────────────
-- farm_team / management / admin. Mint a NEW temp paddock from a human-drawn or
-- GPS-walked closed polygon and write its first geometry version. Replay-
-- idempotent by p_id. Both Plan "Draw temp paddock" and Field "Record a track"
-- call this with a closed polygon; v1 stamps version metadata created_via=
-- 'temp_draw'. A dedicated field-track provenance value is a Field-phase
-- follow-up, not a P0 distinction.

CREATE OR REPLACE FUNCTION public.create_temp_land_area(
  p_id              text,
  p_name            text,
  p_polygon_geojson jsonb,
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
    RAISE EXCEPTION 'create_temp_land_area: authenticated caller required';
  END IF;

  v_role := public.profile_role();
  IF v_role IS NULL OR v_role NOT IN ('farm_team', 'management', 'admin') THEN
    RAISE EXCEPTION 'PM_VALIDATION: caller role % cannot create temp paddocks', COALESCE(v_role, 'null');
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
    RAISE EXCEPTION 'PM_VALIDATION: temp paddock geometry must be a polygon (got %)', v_gtype;
  END IF;
  IF NOT extensions.ST_IsValid(v_geom) THEN
    RAISE EXCEPTION 'PM_VALIDATION: temp paddock polygon is self-intersecting/invalid; fix and retry';
  END IF;

  INSERT INTO public.land_areas
    (id, kind, name, permanence, status, review_status, geometry_status,
     baseline_no_history, source, created_by)
  VALUES
    (p_id, 'paddock', btrim(p_name), 'temporary', 'active', 'reviewed', 'none',
     true, p_source, v_caller);

  PERFORM public._land_area_add_version(
    p_id, v_geom, p_source, jsonb_build_object('created_via', 'temp_draw'), v_caller);

  RETURN public._land_area_summary(p_id) || jsonb_build_object('replayed', false);
END
$fn$;
REVOKE ALL ON FUNCTION public.create_temp_land_area(text, text, jsonb, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_temp_land_area(text, text, jsonb, text) TO authenticated;

-- ── 2. update_temp_land_area_geometry ───────────────────────────────────────
-- Redraw a TEMP paddock boundary. temp owner OR management/admin. Append-only
-- (prior versions preserved). Permanent-area redraw stays on the existing
-- mgmt/admin update_land_area_geometry — this RPC refuses non-temp areas.

CREATE OR REPLACE FUNCTION public.update_temp_land_area_geometry(
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
    RAISE EXCEPTION 'update_temp_land_area_geometry: authenticated caller required';
  END IF;

  v_role := public.profile_role();
  IF v_role IS NULL OR v_role NOT IN ('farm_team', 'management', 'admin') THEN
    RAISE EXCEPTION 'PM_VALIDATION: caller role % cannot edit temp paddocks', COALESCE(v_role, 'null');
  END IF;

  SELECT * INTO v_row FROM public.land_areas WHERE id = p_id FOR UPDATE;
  IF NOT FOUND OR v_row.deleted_at IS NOT NULL THEN
    RAISE EXCEPTION 'PM_VALIDATION: land area % not found', p_id;
  END IF;
  IF v_row.permanence IS DISTINCT FROM 'temporary' THEN
    RAISE EXCEPTION 'PM_VALIDATION: % is not a temp paddock', p_id;
  END IF;
  IF v_role NOT IN ('management', 'admin') AND v_row.created_by IS DISTINCT FROM v_caller THEN
    RAISE EXCEPTION 'PM_VALIDATION: only the creator or a manager can edit this temp paddock';
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

  PERFORM public._land_area_add_version(
    p_id, v_geom, 'drawn', jsonb_build_object('edited_via', 'temp_redraw'), v_caller);

  RETURN public._land_area_summary(p_id) || jsonb_build_object('replayed', false);
END
$fn$;
REVOKE ALL ON FUNCTION public.update_temp_land_area_geometry(text, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.update_temp_land_area_geometry(text, jsonb) TO authenticated;

-- ── 3. rename_temp_land_area ────────────────────────────────────────────────
-- Rename a TEMP paddock. temp owner OR management/admin. Permanent-area rename
-- stays on the mgmt/admin update_land_area — this RPC refuses non-temp areas.

CREATE OR REPLACE FUNCTION public.rename_temp_land_area(
  p_id   text,
  p_name text
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $fn$
DECLARE
  v_caller uuid := auth.uid();
  v_role   text;
  v_row    public.land_areas%ROWTYPE;
BEGIN
  IF v_caller IS NULL THEN
    RAISE EXCEPTION 'rename_temp_land_area: authenticated caller required';
  END IF;

  v_role := public.profile_role();
  IF v_role IS NULL OR v_role NOT IN ('farm_team', 'management', 'admin') THEN
    RAISE EXCEPTION 'PM_VALIDATION: caller role % cannot rename temp paddocks', COALESCE(v_role, 'null');
  END IF;

  SELECT * INTO v_row FROM public.land_areas WHERE id = p_id FOR UPDATE;
  IF NOT FOUND OR v_row.deleted_at IS NOT NULL THEN
    RAISE EXCEPTION 'PM_VALIDATION: land area % not found', p_id;
  END IF;
  IF v_row.permanence IS DISTINCT FROM 'temporary' THEN
    RAISE EXCEPTION 'PM_VALIDATION: % is not a temp paddock', p_id;
  END IF;
  IF v_role NOT IN ('management', 'admin') AND v_row.created_by IS DISTINCT FROM v_caller THEN
    RAISE EXCEPTION 'PM_VALIDATION: only the creator or a manager can rename this temp paddock';
  END IF;

  IF p_name IS NULL OR length(btrim(p_name)) = 0 OR length(p_name) > 200 THEN
    RAISE EXCEPTION 'PM_VALIDATION: name must be 1..200 characters';
  END IF;

  UPDATE public.land_areas
     SET name = btrim(p_name), updated_at = now()
   WHERE id = p_id;

  RETURN public._land_area_summary(p_id);
END
$fn$;
REVOKE ALL ON FUNCTION public.rename_temp_land_area(text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.rename_temp_land_area(text, text) TO authenticated;

-- ── 4. archive_land_area ────────────────────────────────────────────────────
-- Archive (status='retired', restorable). Temp: creator OR mgmt/admin.
-- Permanent: mgmt/admin. Blocked when occupied (PM_AREA_OCCUPIED sentinel).

CREATE OR REPLACE FUNCTION public.archive_land_area(
  p_id text
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $fn$
DECLARE
  v_caller uuid := auth.uid();
  v_role   text;
  v_row    public.land_areas%ROWTYPE;
BEGIN
  IF v_caller IS NULL THEN
    RAISE EXCEPTION 'archive_land_area: authenticated caller required';
  END IF;

  v_role := public.profile_role();
  IF v_role IS NULL OR v_role NOT IN ('farm_team', 'management', 'admin') THEN
    RAISE EXCEPTION 'PM_VALIDATION: caller role % cannot archive land areas', COALESCE(v_role, 'null');
  END IF;

  SELECT * INTO v_row FROM public.land_areas WHERE id = p_id FOR UPDATE;
  IF NOT FOUND OR v_row.deleted_at IS NOT NULL THEN
    RAISE EXCEPTION 'PM_VALIDATION: land area % not found', p_id;
  END IF;

  -- Ownership: a temp paddock can be archived by its creator; everything else
  -- (permanent areas, other people's temp paddocks) is mgmt/admin only.
  IF v_role NOT IN ('management', 'admin') THEN
    IF v_row.permanence IS DISTINCT FROM 'temporary' OR v_row.created_by IS DISTINCT FROM v_caller THEN
      RAISE EXCEPTION 'PM_VALIDATION: caller cannot archive this area';
    END IF;
  END IF;

  IF public._land_area_is_occupied(p_id) THEN
    RAISE EXCEPTION 'PM_VALIDATION: PM_AREA_OCCUPIED';
  END IF;

  IF v_row.status <> 'retired' THEN
    UPDATE public.land_areas
       SET status = 'retired', updated_at = now()
     WHERE id = p_id;
  END IF;

  RETURN public._land_area_summary(p_id);
END
$fn$;
REVOKE ALL ON FUNCTION public.archive_land_area(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.archive_land_area(text) TO authenticated;

-- ── 5. restore_land_area ────────────────────────────────────────────────────
-- Restore (status -> 'active') an archived area. Same role/ownership rule as
-- archive_land_area.

CREATE OR REPLACE FUNCTION public.restore_land_area(
  p_id text
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $fn$
DECLARE
  v_caller uuid := auth.uid();
  v_role   text;
  v_row    public.land_areas%ROWTYPE;
BEGIN
  IF v_caller IS NULL THEN
    RAISE EXCEPTION 'restore_land_area: authenticated caller required';
  END IF;

  v_role := public.profile_role();
  IF v_role IS NULL OR v_role NOT IN ('farm_team', 'management', 'admin') THEN
    RAISE EXCEPTION 'PM_VALIDATION: caller role % cannot restore land areas', COALESCE(v_role, 'null');
  END IF;

  SELECT * INTO v_row FROM public.land_areas WHERE id = p_id FOR UPDATE;
  IF NOT FOUND OR v_row.deleted_at IS NOT NULL THEN
    RAISE EXCEPTION 'PM_VALIDATION: land area % not found', p_id;
  END IF;

  IF v_role NOT IN ('management', 'admin') THEN
    IF v_row.permanence IS DISTINCT FROM 'temporary' OR v_row.created_by IS DISTINCT FROM v_caller THEN
      RAISE EXCEPTION 'PM_VALIDATION: caller cannot restore this area';
    END IF;
  END IF;

  IF v_row.status = 'retired' THEN
    UPDATE public.land_areas
       SET status = 'active', updated_at = now()
     WHERE id = p_id;
  END IF;

  RETURN public._land_area_summary(p_id);
END
$fn$;
REVOKE ALL ON FUNCTION public.restore_land_area(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.restore_land_area(text) TO authenticated;

-- ── 6. hard_delete_land_area ────────────────────────────────────────────────
-- admin ONLY. v1 = soft-delete/snapshot path (deleted_at, deleted_by); geometry
-- rows are retained in DB (true purge is a future follow-up). Detaches children
-- (parent_id = NULL) like delete_land_area so no row points at a deleted parent.
-- Blocked when occupied (PM_AREA_OCCUPIED sentinel).

CREATE OR REPLACE FUNCTION public.hard_delete_land_area(
  p_id text
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $fn$
DECLARE
  v_caller uuid := auth.uid();
  v_role   text;
  v_row    public.land_areas%ROWTYPE;
BEGIN
  IF v_caller IS NULL THEN
    RAISE EXCEPTION 'hard_delete_land_area: authenticated caller required';
  END IF;

  v_role := public.profile_role();
  IF v_role IS NULL OR v_role <> 'admin' THEN
    RAISE EXCEPTION 'PM_VALIDATION: caller role % cannot hard delete land areas', COALESCE(v_role, 'null');
  END IF;

  SELECT * INTO v_row FROM public.land_areas WHERE id = p_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'PM_VALIDATION: land area % not found', p_id;
  END IF;
  IF v_row.deleted_at IS NOT NULL THEN
    RETURN jsonb_build_object('ok', true, 'replayed', true, 'id', p_id, 'deleted', true);
  END IF;

  IF public._land_area_is_occupied(p_id) THEN
    RAISE EXCEPTION 'PM_VALIDATION: PM_AREA_OCCUPIED';
  END IF;

  UPDATE public.land_areas SET parent_id = NULL WHERE parent_id = p_id;
  UPDATE public.land_areas
     SET deleted_at = now(), deleted_by = v_caller, updated_at = now()
   WHERE id = p_id;

  RETURN jsonb_build_object('ok', true, 'replayed', false, 'id', p_id, 'deleted', true);
END
$fn$;
REVOKE ALL ON FUNCTION public.hard_delete_land_area(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.hard_delete_land_area(text) TO authenticated;
