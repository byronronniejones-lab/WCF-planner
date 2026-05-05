-- ============================================================================
-- Migration 041: Tasks public-webform RPCs (C3)
-- ----------------------------------------------------------------------------
-- 2026-05-05. Anon-callable RPCs for /webforms/tasks:
--
--   1. public.list_eligible_assignees() — returns id + full_name from profiles
--      where role != 'inactive'. Anon-callable. NO role/email leak.
--
--   2. public.submit_task_instance(parent_in jsonb) — inserts one
--      task_instances row with template_id NULL and submission_source
--      'public_webform'. Idempotent by client_submission_id (mig 034 pattern).
--      Validates submitted_by_team_member against the visible-roster filter
--      for 'tasks-public' (webform_config.team_availability +
--      webform_config.team_roster) and assignee_profile_id against eligible
--      profiles minus webform_config.tasks_public_assignee_availability.
--
-- Storage shapes (locked):
--   webform_config.team_roster.data
--     [{id: '<roster-id>', name: '<display>', active?: false (legacy)}, ...]
--     — soft-deleted entries have active:false; normalizeRoster drops them
--       on read. The RPC drops them too.
--
--   webform_config.team_availability.data
--     {forms: {'tasks-public': {hiddenIds: ['<roster-id>', ...]}, ...}}
--
--   webform_config.tasks_public_assignee_availability.data
--     {hiddenProfileIds: ['<profile uuid>', ...]}
--     Roster IDs and profile UUIDs MUST NOT mix in the same hiddenIds.
--
-- Out of scope:
--   - No new RLS policies. anon reaches task_instances ONLY via this RPC.
--   - No new tables. mig 036 already shipped task_instances + the unique
--     constraint on client_submission_id (which gives ON CONFLICT-DO NOTHING
--     idempotency).
--
-- Idempotent: every statement uses CREATE OR REPLACE / IF EXISTS.
-- ============================================================================

BEGIN;

-- ----------------------------------------------------------------------------
-- (1) public.list_eligible_assignees() — anon-callable assignee list
-- ----------------------------------------------------------------------------
-- Returns ONLY id + full_name. Role and email are not selected — the public
-- form has no business knowing either. Anon-callable; the SECURITY DEFINER
-- context lets it read profiles even though anon RLS does not.
CREATE OR REPLACE FUNCTION public.list_eligible_assignees()
RETURNS TABLE(id uuid, full_name text)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $list_eligible_assignees$
  SELECT p.id, p.full_name
    FROM public.profiles p
   WHERE coalesce(p.role, '') <> 'inactive'
   ORDER BY p.full_name NULLS LAST, p.id;
$list_eligible_assignees$;

REVOKE ALL ON FUNCTION public.list_eligible_assignees() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.list_eligible_assignees() TO anon, authenticated;

-- ----------------------------------------------------------------------------
-- (2) public.submit_task_instance(parent_in jsonb)
-- ----------------------------------------------------------------------------
-- Anon-callable submit path for /webforms/tasks. Validates assignor +
-- assignee against the admin's availability config, then inserts one
-- task_instances row idempotent-by-csid. Returns
-- {instance_id, idempotent_replay}.
--
-- Tagged dollar-quote ($submit_task_instance$) so the test bootstrap's
-- exec_sql() can EXECUTE this migration without nested-quote collisions.
CREATE OR REPLACE FUNCTION public.submit_task_instance(parent_in jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $submit_task_instance$
DECLARE
  v_csid          text;
  v_id            text;
  v_title         text;
  v_description   text;
  v_due_date      date;
  v_assignee      uuid;
  v_submitted_by  text;
  v_inserted      text;
  v_existing_id   text;
  v_roster_data   jsonb;
  v_avail_data    jsonb;
  v_hidden_roster jsonb;
  v_hidden_assign jsonb;
  v_assignee_av   jsonb;
  v_roster_match  boolean := false;
  v_entry         jsonb;
  v_entry_id      text;
  v_entry_active  text;
BEGIN
  -- ── unpack parent_in ──
  v_csid          := parent_in ->> 'client_submission_id';
  v_id            := parent_in ->> 'id';
  v_title         := parent_in ->> 'title';
  v_description   := parent_in ->> 'description';
  v_due_date      := nullif(parent_in ->> 'due_date', '')::date;
  v_assignee      := nullif(parent_in ->> 'assignee_profile_id', '')::uuid;
  v_submitted_by  := parent_in ->> 'submitted_by_team_member';

  -- ── required-field validation ──
  IF v_csid IS NULL OR v_csid = '' THEN
    RAISE EXCEPTION 'submit_task_instance: client_submission_id required';
  END IF;
  IF v_id IS NULL OR v_id = '' THEN
    RAISE EXCEPTION 'submit_task_instance: id required';
  END IF;
  IF v_title IS NULL OR length(trim(v_title)) = 0 THEN
    RAISE EXCEPTION 'submit_task_instance: title required';
  END IF;
  IF v_due_date IS NULL THEN
    RAISE EXCEPTION 'submit_task_instance: due_date required';
  END IF;
  IF v_assignee IS NULL THEN
    RAISE EXCEPTION 'submit_task_instance: assignee_profile_id required';
  END IF;
  IF v_submitted_by IS NULL OR length(trim(v_submitted_by)) = 0 THEN
    RAISE EXCEPTION 'submit_task_instance: submitted_by_team_member required';
  END IF;

  -- ── load admin config (read once; nullable rows allowed) ──
  SELECT data INTO v_roster_data
    FROM webform_config WHERE key = 'team_roster';
  SELECT data INTO v_avail_data
    FROM webform_config WHERE key = 'team_availability';
  SELECT data INTO v_assignee_av
    FROM webform_config WHERE key = 'tasks_public_assignee_availability';

  v_hidden_roster := coalesce(v_avail_data #> '{forms,tasks-public,hiddenIds}', '[]'::jsonb);
  v_hidden_assign := coalesce(v_assignee_av -> 'hiddenProfileIds', '[]'::jsonb);

  -- ── submitted_by validation ──
  -- Walk the roster array; submitted_by must match an entry whose
  -- active flag is not literally false AND whose roster id is NOT in
  -- the tasks-public hiddenIds list.
  IF v_roster_data IS NOT NULL AND jsonb_typeof(v_roster_data) = 'array' THEN
    FOR v_entry IN SELECT * FROM jsonb_array_elements(v_roster_data)
    LOOP
      v_entry_id     := v_entry ->> 'id';
      v_entry_active := coalesce(v_entry ->> 'active', 'true');
      IF (v_entry ->> 'name') = v_submitted_by
         AND v_entry_active <> 'false'
         AND v_entry_id IS NOT NULL
         AND NOT v_hidden_roster @> to_jsonb(v_entry_id) THEN
        v_roster_match := true;
        EXIT;
      END IF;
    END LOOP;
  END IF;
  IF NOT v_roster_match THEN
    RAISE EXCEPTION 'submit_task_instance: submitted_by_team_member not allowed';
  END IF;

  -- ── assignee validation ──
  -- Profile must exist with role != 'inactive' AND not be in the
  -- hidden-profile-ids list.
  IF v_hidden_assign @> to_jsonb(v_assignee::text) THEN
    RAISE EXCEPTION 'submit_task_instance: assignee not allowed';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.profiles
     WHERE id = v_assignee
       AND coalesce(role, '') <> 'inactive'
  ) THEN
    RAISE EXCEPTION 'submit_task_instance: assignee not eligible';
  END IF;

  -- ── race-safe idempotent insert ──
  INSERT INTO public.task_instances (
    id,
    template_id,
    assignee_profile_id,
    due_date,
    title,
    description,
    submitted_by_team_member,
    submission_source,
    status,
    client_submission_id
  ) VALUES (
    v_id,
    NULL,
    v_assignee,
    v_due_date,
    trim(v_title),
    nullif(trim(coalesce(v_description, '')), ''),
    trim(v_submitted_by),
    'public_webform',
    'open',
    v_csid
  )
  ON CONFLICT (client_submission_id) DO NOTHING
  RETURNING id INTO v_inserted;

  IF v_inserted IS NULL THEN
    -- Replay: parent already exists. Return the existing instance id.
    SELECT id INTO v_existing_id
      FROM public.task_instances
     WHERE client_submission_id = v_csid;
    RETURN jsonb_build_object('instance_id', v_existing_id, 'idempotent_replay', true);
  END IF;

  RETURN jsonb_build_object('instance_id', v_inserted, 'idempotent_replay', false);
END;
$submit_task_instance$;

REVOKE ALL ON FUNCTION public.submit_task_instance(jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.submit_task_instance(jsonb) TO anon, authenticated;

COMMIT;
