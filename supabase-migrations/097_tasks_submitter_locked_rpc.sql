-- ============================================================================
-- 097_tasks_submitter_locked_rpc.sql
-- ----------------------------------------------------------------------------
-- Phase 2 (light-forms identity): the public Tasks webform is now login-
-- required and stamps submitted_by from the signed-in user (LockedSubmitter),
-- so the roster-membership validation in submit_task_instance (mig 041) is
-- obsolete. This CREATE OR REPLACE:
--   * requires an authenticated caller (auth.uid() not null),
--   * DROPS the team_roster / team_availability 'submitted_by not allowed'
--     check (the team roster is being retired in Phase 3),
--   * revokes anon EXECUTE (the form is authenticated-only now).
-- Assignee validation (eligible profiles minus tasks_public_assignee_
-- availability) and the idempotent insert are unchanged from mig 041.
--
-- Backward compatible with the still-live roster frontend: a roster-picked
-- name submitted by an authenticated caller passes (no validation), so this
-- can be applied to PROD before the locked-submitter frontend deploys.
--
-- Apply order: TEST first, PROD after explicit approval.
-- ============================================================================

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
  v_assignee_av   jsonb;
  v_hidden_assign jsonb;
BEGIN
  -- Authenticated only — the public Tasks form is login-required (Light role).
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'submit_task_instance: not authenticated';
  END IF;

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

  -- submitted_by is the signed-in user's display name (LockedSubmitter); no
  -- roster-membership check. Assignee is still validated against eligible
  -- profiles minus the admin's hidden-profile list.
  SELECT data INTO v_assignee_av
    FROM webform_config WHERE key = 'tasks_public_assignee_availability';
  v_hidden_assign := coalesce(v_assignee_av -> 'hiddenProfileIds', '[]'::jsonb);

  -- ── assignee validation ──
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

REVOKE ALL ON FUNCTION public.submit_task_instance(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.submit_task_instance(jsonb) TO authenticated;

NOTIFY pgrst, 'reload schema';

-- ============================================================================
-- End of 097_tasks_submitter_locked_rpc.sql
-- ============================================================================
