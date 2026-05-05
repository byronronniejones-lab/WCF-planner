-- ============================================================================
-- Migration 042: Task request photos (C3.1b)
-- ----------------------------------------------------------------------------
-- 2026-05-05. Optional one-photo-per-task uploaded at request time
-- (admin or anon submit). Separate from the task-photos bucket which is
-- locked to authenticated assignee uploads at completion (PROJECT.md §7
-- line 140 + mig 038) — that contract stays untouched.
--
-- Adds:
--   1. task_instances.request_photo_path (text, nullable). DB column
--      stores the bucket-prefixed path
--      'task-request-photos/<instance_id>/<filename>'. Historical rows
--      stay null (no backfill).
--   2. New private storage bucket `task-request-photos`.
--   3. Storage policies: explicit anon INSERT, explicit authenticated
--      INSERT (do not assume authenticated inherits anon), authenticated
--      SELECT. NO anon SELECT (signed URLs only). NO UPDATE/DELETE.
--   4. CREATE OR REPLACE on public.submit_task_instance(parent_in jsonb)
--      to accept + validate the optional request_photo_path field. The
--      existing csid validation, roster + assignee availability checks,
--      idempotency, and GRANT block all stay verbatim.
--
-- Path validation rules in the RPC:
--   prefix:    left(path, length('task-request-photos/<id>/'))
--              = 'task-request-photos/<id>/'   (NOT LIKE — _/% are
--                                              wildcards)
--   filename:  - non-empty
--              - no '/'  (position('/' IN filename) = 0)
--              - no '\\' (position(chr(92) IN filename) = 0)
--                — chr(92) is unambiguous across
--                standard_conforming_strings settings; preferred over
--                regex-with-escapes per Codex review.
--
-- Out of scope:
--   - Recurring task templates with default photos (one-time tasks
--     only — Codex amendment 4).
--   - Orphan-upload scrub job (anon uploads that never get submitted —
--     out of scope for v1; storage cost is trivial at this volume).
--   - /my-tasks (C2 lane) reads — this migration only adds the column
--     + bucket; the assignee-side display lands in C2.
--
-- Idempotent: every step uses IF NOT EXISTS / ON CONFLICT DO NOTHING /
-- DROP POLICY IF EXISTS / CREATE OR REPLACE FUNCTION.
-- ============================================================================

BEGIN;

-- ----------------------------------------------------------------------------
-- (1) Column add
-- ----------------------------------------------------------------------------
ALTER TABLE public.task_instances
  ADD COLUMN IF NOT EXISTS request_photo_path text;

-- ----------------------------------------------------------------------------
-- (2) Storage bucket — private. Mirrors the daily-photos pattern (mig 031).
-- ----------------------------------------------------------------------------
INSERT INTO storage.buckets (id, name, public)
VALUES ('task-request-photos', 'task-request-photos', false)
ON CONFLICT (id) DO NOTHING;

-- ----------------------------------------------------------------------------
-- (3) Storage policies
-- ----------------------------------------------------------------------------
-- Explicit anon INSERT (the public /webforms/tasks form uploads here).
DROP POLICY IF EXISTS task_request_photos_anon_insert ON storage.objects;
CREATE POLICY task_request_photos_anon_insert ON storage.objects
  FOR INSERT TO anon
  WITH CHECK (bucket_id = 'task-request-photos');

-- Explicit authenticated INSERT (the admin Tasks Center New Task modal
-- uploads here too). Codex review: do NOT assume authenticated inherits
-- anon — every role gets its own policy.
DROP POLICY IF EXISTS task_request_photos_auth_insert ON storage.objects;
CREATE POLICY task_request_photos_auth_insert ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'task-request-photos');

-- Authenticated SELECT only — admin-side display via signed URL.
-- DELIBERATELY NO anon SELECT: anon submitters never read uploaded
-- photos back. Signed URLs (admin context) are the only read path.
DROP POLICY IF EXISTS task_request_photos_auth_select ON storage.objects;
CREATE POLICY task_request_photos_auth_select ON storage.objects
  FOR SELECT TO authenticated
  USING (bucket_id = 'task-request-photos');

-- DELIBERATELY: no UPDATE or DELETE policies. Uploaded objects are
-- immutable once written.

-- ----------------------------------------------------------------------------
-- (4) submit_task_instance — extend with optional request_photo_path
-- ----------------------------------------------------------------------------
-- CREATE OR REPLACE preserves the prior contract verbatim (csid, title,
-- due_date, assignee_profile_id, submitted_by_team_member required;
-- roster + assignee availability validation; idempotent INSERT … ON
-- CONFLICT (client_submission_id) DO NOTHING + fallback SELECT;
-- {instance_id, idempotent_replay} return shape; SECDEF + search_path +
-- GRANT all unchanged). Adds:
--   - request_photo_path optional unpack from parent_in.
--   - prefix + filename validation (RAISE on mismatch).
--   - task_instances.request_photo_path column written on INSERT.

CREATE OR REPLACE FUNCTION public.submit_task_instance(parent_in jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $submit_task_instance$
DECLARE
  v_csid                  text;
  v_id                    text;
  v_title                 text;
  v_description           text;
  v_due_date              date;
  v_assignee              uuid;
  v_submitted_by          text;
  v_request_photo_path    text;
  v_expected_prefix       text;
  v_filename              text;
  v_inserted              text;
  v_existing_id           text;
  v_roster_data           jsonb;
  v_avail_data            jsonb;
  v_hidden_roster         jsonb;
  v_hidden_assign         jsonb;
  v_assignee_av           jsonb;
  v_roster_match          boolean := false;
  v_entry                 jsonb;
  v_entry_id              text;
  v_entry_active          text;
BEGIN
  -- ── unpack parent_in ──
  v_csid                := parent_in ->> 'client_submission_id';
  v_id                  := parent_in ->> 'id';
  v_title               := parent_in ->> 'title';
  v_description         := parent_in ->> 'description';
  v_due_date            := nullif(parent_in ->> 'due_date', '')::date;
  v_assignee            := nullif(parent_in ->> 'assignee_profile_id', '')::uuid;
  v_submitted_by        := parent_in ->> 'submitted_by_team_member';
  v_request_photo_path  := nullif(parent_in ->> 'request_photo_path', '');

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

  -- ── request_photo_path validation (optional) ──
  -- Path shape lock: 'task-request-photos/<id>/<filename>'.
  -- left(...) prefix match (NOT LIKE — _/% would wildcard); filename
  -- must be non-empty and contain no path separators.
  IF v_request_photo_path IS NOT NULL THEN
    v_expected_prefix := 'task-request-photos/' || v_id || '/';
    IF left(v_request_photo_path, length(v_expected_prefix)) <> v_expected_prefix THEN
      RAISE EXCEPTION 'submit_task_instance: request_photo_path prefix mismatch';
    END IF;
    v_filename := substring(v_request_photo_path FROM length(v_expected_prefix) + 1);
    IF v_filename IS NULL OR length(v_filename) = 0 THEN
      RAISE EXCEPTION 'submit_task_instance: request_photo_path filename empty';
    END IF;
    IF position('/' IN v_filename) > 0 OR position(chr(92) IN v_filename) > 0 THEN
      RAISE EXCEPTION 'submit_task_instance: request_photo_path filename invalid';
    END IF;
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
    client_submission_id,
    request_photo_path
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
    v_csid,
    v_request_photo_path
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
