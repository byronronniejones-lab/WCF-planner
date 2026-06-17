-- ============================================================================
-- 129_pasture_map_planning_reports.sql  (Pasture Map CP4)
-- ----------------------------------------------------------------------------
-- Planned moves and reporting on top of the CP3 move ledger. Geometry and
-- animal groups remain decoupled: plans reference a target land area plus
-- animal_type/group_key/group_label, never livestock tables.
--
-- Includes:
--   * append-only-ish planned move worklist with status changes by RPC only
--   * paddock/group history report
--   * rest report
--   * stocking density / animal-days-per-acre report
--
-- NO BEGIN/COMMIT: TEST applies via exec_sql; PROD applies with psql
-- --single-transaction. Apply order: TEST first, PROD after Ronnie approval.
-- Depends on: migrations 116, 127, 128.
-- ============================================================================

CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS postgis WITH SCHEMA extensions;

CREATE TABLE IF NOT EXISTS public.pasture_planned_moves (
  id                text PRIMARY KEY,
  animal_type       text NOT NULL
                      CHECK (animal_type IN ('cattle_herd', 'sheep_flock',
                                             'breeder_pigs', 'feeder_pigs')),
  group_key         text NOT NULL,
  group_label       text NOT NULL,
  from_land_area_id text REFERENCES public.land_areas(id) ON DELETE SET NULL,
  to_land_area_id   text NOT NULL REFERENCES public.land_areas(id) ON DELETE CASCADE,
  planned_for       timestamptz NOT NULL,
  animal_count      int CHECK (animal_count IS NULL OR animal_count > 0),
  notes             text,
  status            text NOT NULL DEFAULT 'planned'
                      CHECK (status IN ('planned', 'completed', 'skipped', 'canceled')),
  completed_move_id text REFERENCES public.pasture_move_events(id) ON DELETE SET NULL,
  created_by        uuid REFERENCES public.profiles(id),
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS pasture_planned_moves_status_time_idx
  ON public.pasture_planned_moves (status, planned_for, created_at);
CREATE INDEX IF NOT EXISTS pasture_planned_moves_group_idx
  ON public.pasture_planned_moves (animal_type, group_key, planned_for);
CREATE INDEX IF NOT EXISTS pasture_planned_moves_to_area_idx
  ON public.pasture_planned_moves (to_land_area_id, planned_for);

REVOKE ALL ON TABLE public.pasture_planned_moves FROM PUBLIC, anon, authenticated;
ALTER TABLE public.pasture_planned_moves ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS pasture_planned_moves_deny_all ON public.pasture_planned_moves;
CREATE POLICY pasture_planned_moves_deny_all ON public.pasture_planned_moves
  FOR ALL USING (false);

CREATE OR REPLACE FUNCTION public._pasture_planned_move_summary(p_id text)
RETURNS jsonb
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, extensions
STABLE
AS $fn$
  SELECT jsonb_build_object(
    'id', p.id,
    'animal_type', p.animal_type,
    'group_key', p.group_key,
    'group_label', p.group_label,
    'from_land_area_id', p.from_land_area_id,
    'from_land_area_name', fa.name,
    'to_land_area_id', p.to_land_area_id,
    'to_land_area_name', ta.name,
    'planned_for', p.planned_for,
    'animal_count', p.animal_count,
    'notes', p.notes,
    'status', p.status,
    'completed_move_id', p.completed_move_id,
    'created_at', p.created_at,
    'updated_at', p.updated_at
  )
  FROM public.pasture_planned_moves p
  LEFT JOIN public.land_areas fa ON fa.id = p.from_land_area_id
  LEFT JOIN public.land_areas ta ON ta.id = p.to_land_area_id
  WHERE p.id = p_id;
$fn$;
REVOKE ALL ON FUNCTION public._pasture_planned_move_summary(text) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.list_pasture_planned_moves(
  p_status text DEFAULT 'planned',
  p_limit int DEFAULT 100
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $fn$
DECLARE
  v_caller uuid := auth.uid();
  v_role text;
  v_limit int := LEAST(GREATEST(COALESCE(p_limit, 100), 1), 500);
  v_status text := COALESCE(NULLIF(btrim(p_status), ''), 'planned');
  v_rows jsonb;
BEGIN
  IF v_caller IS NULL THEN
    RAISE EXCEPTION 'list_pasture_planned_moves: authenticated caller required';
  END IF;

  v_role := public.profile_role();
  IF v_role IS NULL OR v_role NOT IN ('farm_team', 'management', 'admin') THEN
    RAISE EXCEPTION 'PM_VALIDATION: caller role % cannot read pasture plans', COALESCE(v_role, 'null');
  END IF;

  IF v_status <> 'all' AND v_status NOT IN ('planned', 'completed', 'skipped', 'canceled') THEN
    RAISE EXCEPTION 'PM_VALIDATION: invalid planned move status %', v_status;
  END IF;

  SELECT COALESCE(jsonb_agg(public._pasture_planned_move_summary(p.id)
           ORDER BY p.planned_for, p.created_at), '[]'::jsonb)
    INTO v_rows
    FROM (
      SELECT id, planned_for, created_at
        FROM public.pasture_planned_moves
       WHERE v_status = 'all' OR status = v_status
       ORDER BY CASE WHEN status = 'planned' THEN 0 ELSE 1 END,
                planned_for,
                created_at
       LIMIT v_limit
    ) p;

  RETURN jsonb_build_object('planned_moves', v_rows);
END
$fn$;
REVOKE ALL ON FUNCTION public.list_pasture_planned_moves(text, int) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.list_pasture_planned_moves(text, int) TO authenticated;

CREATE OR REPLACE FUNCTION public.create_pasture_planned_move(
  p_plan_id         text,
  p_animal_type     text,
  p_group_key       text,
  p_group_label     text,
  p_to_land_area_id text,
  p_planned_for     timestamptz,
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
  v_to public.land_areas%ROWTYPE;
  v_from_id text;
BEGIN
  IF v_caller IS NULL THEN
    RAISE EXCEPTION 'create_pasture_planned_move: authenticated caller required';
  END IF;

  v_role := public.profile_role();
  IF v_role IS NULL OR v_role NOT IN ('farm_team', 'management', 'admin') THEN
    RAISE EXCEPTION 'PM_VALIDATION: caller role % cannot create pasture plans', COALESCE(v_role, 'null');
  END IF;

  IF p_plan_id IS NULL OR p_plan_id !~ '^[A-Za-z0-9-]+$' OR length(p_plan_id) > 100 THEN
    RAISE EXCEPTION 'PM_VALIDATION: invalid planned move id';
  END IF;
  IF EXISTS (SELECT 1 FROM public.pasture_planned_moves WHERE id = p_plan_id) THEN
    RETURN public._pasture_planned_move_summary(p_plan_id) || jsonb_build_object('replayed', true);
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
  IF p_planned_for IS NULL THEN
    RAISE EXCEPTION 'PM_VALIDATION: planned_for required';
  END IF;
  IF p_animal_count IS NOT NULL AND p_animal_count <= 0 THEN
    RAISE EXCEPTION 'PM_VALIDATION: animal_count must be positive';
  END IF;

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

  SELECT m.to_land_area_id
    INTO v_from_id
    FROM public.pasture_move_events m
   WHERE m.animal_type = p_animal_type
     AND m.group_key = btrim(p_group_key)
   ORDER BY m.moved_at DESC, m.created_at DESC
   LIMIT 1;

  INSERT INTO public.pasture_planned_moves
    (id, animal_type, group_key, group_label, from_land_area_id, to_land_area_id,
     planned_for, animal_count, notes, created_by)
  VALUES
    (p_plan_id, p_animal_type, btrim(p_group_key), btrim(p_group_label),
     v_from_id, p_to_land_area_id, p_planned_for, p_animal_count,
     NULLIF(btrim(COALESCE(p_notes, '')), ''), v_caller);

  RETURN public._pasture_planned_move_summary(p_plan_id) || jsonb_build_object('replayed', false);
END
$fn$;
REVOKE ALL ON FUNCTION public.create_pasture_planned_move(text, text, text, text, text, timestamptz, int, text)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_pasture_planned_move(text, text, text, text, text, timestamptz, int, text)
  TO authenticated;

CREATE OR REPLACE FUNCTION public.update_pasture_planned_move_status(
  p_plan_id text,
  p_status text,
  p_completed_move_id text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $fn$
DECLARE
  v_caller uuid := auth.uid();
  v_role text;
  v_status text := COALESCE(NULLIF(btrim(p_status), ''), '');
BEGIN
  IF v_caller IS NULL THEN
    RAISE EXCEPTION 'update_pasture_planned_move_status: authenticated caller required';
  END IF;

  v_role := public.profile_role();
  IF v_role IS NULL OR v_role NOT IN ('farm_team', 'management', 'admin') THEN
    RAISE EXCEPTION 'PM_VALIDATION: caller role % cannot update pasture plans', COALESCE(v_role, 'null');
  END IF;
  IF v_status NOT IN ('planned', 'completed', 'skipped', 'canceled') THEN
    RAISE EXCEPTION 'PM_VALIDATION: invalid planned move status %', COALESCE(v_status, 'null');
  END IF;
  IF p_completed_move_id IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM public.pasture_move_events WHERE id = p_completed_move_id)
  THEN
    RAISE EXCEPTION 'PM_VALIDATION: completed move % not found', p_completed_move_id;
  END IF;

  UPDATE public.pasture_planned_moves
     SET status = v_status,
         completed_move_id = CASE WHEN v_status = 'completed' THEN p_completed_move_id ELSE NULL END,
         updated_at = now()
   WHERE id = p_plan_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'PM_VALIDATION: planned move % not found', p_plan_id;
  END IF;

  RETURN public._pasture_planned_move_summary(p_plan_id);
END
$fn$;
REVOKE ALL ON FUNCTION public.update_pasture_planned_move_status(text, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.update_pasture_planned_move_status(text, text, text) TO authenticated;

CREATE OR REPLACE FUNCTION public.list_pasture_history_report(
  p_land_area_id text DEFAULT NULL,
  p_animal_type text DEFAULT NULL,
  p_group_key text DEFAULT NULL,
  p_limit int DEFAULT 200
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $fn$
DECLARE
  v_caller uuid := auth.uid();
  v_role text;
  v_limit int := LEAST(GREATEST(COALESCE(p_limit, 200), 1), 1000);
  v_rows jsonb;
BEGIN
  IF v_caller IS NULL THEN
    RAISE EXCEPTION 'list_pasture_history_report: authenticated caller required';
  END IF;

  v_role := public.profile_role();
  IF v_role IS NULL OR v_role NOT IN ('farm_team', 'management', 'admin') THEN
    RAISE EXCEPTION 'PM_VALIDATION: caller role % cannot read pasture history', COALESCE(v_role, 'null');
  END IF;

  SELECT COALESCE(jsonb_agg(row_to_json(r)::jsonb ORDER BY r.moved_at DESC, r.created_at DESC), '[]'::jsonb)
    INTO v_rows
    FROM (
      SELECT m.id,
             m.animal_type,
             m.group_key,
             m.group_label,
             m.from_land_area_id,
             fa.name AS from_land_area_name,
             m.to_land_area_id,
             ta.name AS to_land_area_name,
             m.moved_at,
             m.animal_count,
             m.notes,
             m.created_at,
             COALESCE((
               SELECT jsonb_agg(jsonb_build_object(
                 'land_area_id', i.land_area_id,
                 'land_area_name', la.name,
                 'impact_kind', i.impact_kind,
                 'impacted_at', i.impacted_at
               ) ORDER BY i.impact_kind, la.name)
               FROM public.pasture_move_impacts i
               JOIN public.land_areas la ON la.id = i.land_area_id
               WHERE i.move_id = m.id
             ), '[]'::jsonb) AS impacted_areas
        FROM public.pasture_move_events m
        LEFT JOIN public.land_areas fa ON fa.id = m.from_land_area_id
        LEFT JOIN public.land_areas ta ON ta.id = m.to_land_area_id
       WHERE (p_animal_type IS NULL OR m.animal_type = p_animal_type)
         AND (p_group_key IS NULL OR m.group_key = p_group_key)
         AND (
           p_land_area_id IS NULL
           OR m.from_land_area_id = p_land_area_id
           OR m.to_land_area_id = p_land_area_id
           OR EXISTS (
             SELECT 1 FROM public.pasture_move_impacts i
              WHERE i.move_id = m.id
                AND i.land_area_id = p_land_area_id
           )
         )
       ORDER BY m.moved_at DESC, m.created_at DESC
       LIMIT v_limit
    ) r;

  RETURN jsonb_build_object('history', v_rows);
END
$fn$;
REVOKE ALL ON FUNCTION public.list_pasture_history_report(text, text, text, int) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.list_pasture_history_report(text, text, text, int) TO authenticated;

CREATE OR REPLACE FUNCTION public.list_pasture_rest_report()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $fn$
DECLARE
  v_caller uuid := auth.uid();
  v_role text;
  v_areas jsonb;
  v_counts jsonb;
BEGIN
  IF v_caller IS NULL THEN
    RAISE EXCEPTION 'list_pasture_rest_report: authenticated caller required';
  END IF;

  v_role := public.profile_role();
  IF v_role IS NULL OR v_role NOT IN ('farm_team', 'management', 'admin') THEN
    RAISE EXCEPTION 'PM_VALIDATION: caller role % cannot read pasture rest report', COALESCE(v_role, 'null');
  END IF;

  WITH summaries AS (
    SELECT public._land_area_summary(a.id) AS s
      FROM public.land_areas a
     WHERE a.deleted_at IS NULL
       AND a.status = 'active'
       AND a.kind IN ('unclassified', 'pasture', 'paddock', 'feeder_pig_area', 'section')
  )
  SELECT COALESCE(jsonb_agg(s ORDER BY
           CASE s->>'rest_state'
             WHEN 'occupied' THEN 0
             WHEN 'resting' THEN 1
             WHEN 'rested' THEN 2
             ELSE 3
           END,
           COALESCE((s->>'rest_days')::int, 999999),
           s->>'name'), '[]'::jsonb)
    INTO v_areas
    FROM summaries;

  WITH summaries AS (
    SELECT public._land_area_summary(a.id) AS s
      FROM public.land_areas a
     WHERE a.deleted_at IS NULL
       AND a.status = 'active'
       AND a.kind IN ('unclassified', 'pasture', 'paddock', 'feeder_pig_area', 'section')
  )
  SELECT jsonb_build_object(
           'occupied', count(*) FILTER (WHERE s->>'rest_state' = 'occupied'),
           'resting', count(*) FILTER (WHERE s->>'rest_state' = 'resting'),
           'rested', count(*) FILTER (WHERE s->>'rest_state' = 'rested'),
           'baseline', count(*) FILTER (WHERE s->>'rest_state' IN ('baseline', 'no_history'))
         )
    INTO v_counts
    FROM summaries;

  RETURN jsonb_build_object('areas', v_areas, 'counts', COALESCE(v_counts, '{}'::jsonb));
END
$fn$;
REVOKE ALL ON FUNCTION public.list_pasture_rest_report() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.list_pasture_rest_report() TO authenticated;

CREATE OR REPLACE FUNCTION public.list_pasture_stocking_report(
  p_since timestamptz DEFAULT (now() - interval '365 days'),
  p_until timestamptz DEFAULT now()
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $fn$
DECLARE
  v_caller uuid := auth.uid();
  v_role text;
  v_since timestamptz := COALESCE(p_since, now() - interval '365 days');
  v_until timestamptz := COALESCE(p_until, now());
  v_rows jsonb;
BEGIN
  IF v_caller IS NULL THEN
    RAISE EXCEPTION 'list_pasture_stocking_report: authenticated caller required';
  END IF;

  v_role := public.profile_role();
  IF v_role IS NULL OR v_role NOT IN ('farm_team', 'management', 'admin') THEN
    RAISE EXCEPTION 'PM_VALIDATION: caller role % cannot read pasture stocking report', COALESCE(v_role, 'null');
  END IF;
  IF v_since >= v_until THEN
    RAISE EXCEPTION 'PM_VALIDATION: since must be before until';
  END IF;

  WITH ordered AS (
    SELECT m.*,
           LEAD(m.moved_at, 1, v_until) OVER (
             PARTITION BY m.animal_type, m.group_key
             ORDER BY m.moved_at, m.created_at, m.id
           ) AS next_moved_at
      FROM public.pasture_move_events m
     WHERE m.moved_at < v_until
  ),
  clipped AS (
    SELECT o.id,
           o.animal_type,
           o.group_key,
           o.group_label,
           o.animal_count,
           GREATEST(o.moved_at, v_since) AS start_at,
           LEAST(o.next_moved_at, v_until) AS end_at
      FROM ordered o
     WHERE o.animal_count IS NOT NULL
       AND o.next_moved_at > v_since
       AND o.moved_at < v_until
  ),
  area_days AS (
    SELECT i.land_area_id,
           c.animal_type,
           c.group_key,
           c.group_label,
           SUM(c.animal_count * GREATEST(extract(epoch from (c.end_at - c.start_at)) / 86400.0, 0)) AS animal_days
      FROM clipped c
      JOIN public.pasture_move_impacts i
        ON i.move_id = c.id
       AND i.impact_kind IN ('destination', 'overlap')
     GROUP BY i.land_area_id, c.animal_type, c.group_key, c.group_label
  ),
  rollup AS (
    SELECT la.id,
           la.name,
           la.kind,
           COALESCE(la.manual_acres, la.computed_acres) AS acres,
           SUM(ad.animal_days) AS animal_days,
           jsonb_agg(jsonb_build_object(
             'animal_type', ad.animal_type,
             'group_key', ad.group_key,
             'group_label', ad.group_label,
             'animal_days', round(ad.animal_days::numeric, 2)
           ) ORDER BY ad.animal_type, ad.group_label) AS groups
      FROM area_days ad
      JOIN public.land_areas la ON la.id = ad.land_area_id
     WHERE la.deleted_at IS NULL
     GROUP BY la.id, la.name, la.kind, COALESCE(la.manual_acres, la.computed_acres)
  )
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'land_area_id', r.id,
           'land_area_name', r.name,
           'kind', r.kind,
           'acres', r.acres,
           'animal_days', round(r.animal_days::numeric, 2),
           'animal_days_per_acre',
             CASE WHEN r.acres IS NULL OR r.acres <= 0 THEN NULL
                  ELSE round((r.animal_days / r.acres)::numeric, 2)
             END,
           'groups', r.groups
         ) ORDER BY
           CASE WHEN r.acres IS NULL OR r.acres <= 0 THEN NULL
                ELSE r.animal_days / r.acres
           END DESC NULLS LAST,
           r.name), '[]'::jsonb)
    INTO v_rows
    FROM rollup r;

  RETURN jsonb_build_object('since', v_since, 'until', v_until, 'areas', v_rows);
END
$fn$;
REVOKE ALL ON FUNCTION public.list_pasture_stocking_report(timestamptz, timestamptz) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.list_pasture_stocking_report(timestamptz, timestamptz) TO authenticated;
