-- ============================================================================
-- Migration 040: complete_task_instance RPC (Tasks v1 Phase D / C2)
-- ----------------------------------------------------------------------------
-- 2026-05-05. Logged-in assignee path for /my-tasks. Adds the long-reserved
-- complete_task_instance RPC that mig 036 (column comment) and mig 037 (RLS
-- comment + assignee SELECT-own policy) already named:
--
--   task_instances has NO assignee UPDATE policy (mig 037). Assignees can
--   READ their rows under task_instances_assignee_self_select but can't
--   directly UPDATE. They go through this SECDEF RPC instead.
--
-- Authorization (every call):
--   - auth.uid() must be non-null (anon EXECUTE is revoked; defensive RAISE).
--   - The caller must EITHER equal task_instances.assignee_profile_id OR be
--     an admin via public.is_admin(). Any other authenticated user is
--     rejected with 'forbidden'.
--
-- Race-safety (Codex C2 amendment #1):
--   The completion update uses a single atomic
--     UPDATE ... WHERE id = p_instance_id AND status = 'open' RETURNING ...
--   Two concurrent calls can't both succeed: only the first matches the
--   `status='open'` predicate. The second sees zero RETURNING rows and
--   falls into the idempotent-replay branch via a follow-up SELECT.
--
-- Idempotency:
--   Re-call on a completed row returns
--     {ok:true, idempotent_replay:true, instance_id, completed_at,
--      completed_by_profile_id, completion_photo_path}
--   Mirrors mig 034 / mig 041's "no error ever surfaces on replay" contract.
--
-- Path validation (when p_completion_photo_path is provided):
--   prefix:    'task-photos/<assignee_uid>/<instance_id>/'
--              checked via left(path, length(prefix)) = prefix
--              (NOT LIKE — _/% are wildcards)
--   filename:  - non-empty
--              - no '/' (position('/' IN filename) = 0)
--              - no '\\' (position(chr(92) IN filename) = 0)
--                — chr(92) is unambiguous across
--                standard_conforming_strings settings (Codex preferred shape).
--   The prefix uses the ROW's assignee_profile_id, NOT the caller's
--   auth.uid() — Codex C3 amendment 5: "admin completing someone else's
--   task still stores under task-photos/<assignee_uid>/<instance_id>/...".
--
-- task-photos bucket + policies (mig 038): UNCHANGED. This migration only
-- ships the RPC.
--
-- Idempotent: CREATE OR REPLACE on the function; REVOKE/GRANT re-asserted.
-- ============================================================================

BEGIN;

CREATE OR REPLACE FUNCTION public.complete_task_instance(
  p_instance_id           text,
  p_completion_photo_path text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $complete_task_instance$
DECLARE
  v_caller            uuid;
  v_assignee          uuid;
  v_status            text;
  v_existing_path     text;
  v_existing_at       timestamptz;
  v_existing_by       uuid;
  v_expected_prefix   text;
  v_filename          text;
  v_normalized_path   text;
  v_updated_at        timestamptz;
BEGIN
  v_caller := auth.uid();
  IF v_caller IS NULL THEN
    RAISE EXCEPTION 'complete_task_instance: not authenticated';
  END IF;
  IF p_instance_id IS NULL OR p_instance_id = '' THEN
    RAISE EXCEPTION 'complete_task_instance: p_instance_id required';
  END IF;

  -- ── 1. Look up the row to fetch assignee + current state. ──
  -- We need the assignee for the path prefix even on a replay, so this
  -- read happens first. The atomic update below uses status='open' as
  -- the race guard.
  SELECT assignee_profile_id, status, completion_photo_path,
         completed_at, completed_by_profile_id
    INTO v_assignee, v_status, v_existing_path,
         v_existing_at, v_existing_by
    FROM public.task_instances
   WHERE id = p_instance_id;

  IF v_assignee IS NULL THEN
    RAISE EXCEPTION 'complete_task_instance: instance not found';
  END IF;

  -- ── 2. Authorization. ──
  -- Caller is the assignee themself OR a current admin. is_admin() is the
  -- single admin-role helper (PROJECT.md §7 line 561 / mig 037).
  IF v_caller <> v_assignee AND NOT public.is_admin() THEN
    RAISE EXCEPTION 'complete_task_instance: forbidden';
  END IF;

  -- ── 3. Path-shape validation (when present). ──
  -- Validates BEFORE any update so a malformed path can't be persisted.
  -- Prefix uses the ROW's assignee, not the caller (Codex C3 amend. 5).
  v_normalized_path := nullif(p_completion_photo_path, '');
  IF v_normalized_path IS NOT NULL THEN
    v_expected_prefix := 'task-photos/' || v_assignee::text || '/' || p_instance_id || '/';
    IF left(v_normalized_path, length(v_expected_prefix)) <> v_expected_prefix THEN
      RAISE EXCEPTION 'complete_task_instance: completion_photo_path prefix mismatch';
    END IF;
    v_filename := substring(v_normalized_path FROM length(v_expected_prefix) + 1);
    IF v_filename IS NULL OR length(v_filename) = 0 THEN
      RAISE EXCEPTION 'complete_task_instance: completion_photo_path filename empty';
    END IF;
    IF position('/' IN v_filename) > 0 OR position(chr(92) IN v_filename) > 0 THEN
      RAISE EXCEPTION 'complete_task_instance: completion_photo_path filename invalid';
    END IF;
  END IF;

  -- ── 4. Idempotent fast-path: row already completed. ──
  -- Cheap escape so a replay doesn't even attempt the UPDATE.
  IF v_status = 'completed' THEN
    RETURN jsonb_build_object(
      'ok', true,
      'idempotent_replay', true,
      'instance_id', p_instance_id,
      'completed_at', v_existing_at,
      'completed_by_profile_id', v_existing_by,
      'completion_photo_path', v_existing_path
    );
  END IF;

  -- ── 5. Race-safe update. ──
  -- The status='open' predicate is the race guard: under concurrent
  -- callers, only one matches and gets RETURNING. The losing caller
  -- sees zero rows and falls into the replay branch below.
  UPDATE public.task_instances
     SET status                  = 'completed',
         completed_at            = now(),
         completed_by_profile_id = v_caller,
         completion_photo_path   = v_normalized_path
   WHERE id     = p_instance_id
     AND status = 'open'
   RETURNING completed_at INTO v_updated_at;

  IF v_updated_at IS NOT NULL THEN
    -- We won the race. Fresh completion.
    RETURN jsonb_build_object(
      'ok', true,
      'idempotent_replay', false,
      'instance_id', p_instance_id,
      'completed_at', v_updated_at,
      'completed_by_profile_id', v_caller,
      'completion_photo_path', v_normalized_path
    );
  END IF;

  -- ── 6. Lost the race (concurrent call won). ──
  -- Re-read the row's now-completed state and return idempotent_replay.
  -- This branch also covers the case where step 4's status check was
  -- 'open' but a concurrent commit completed the row between step 4
  -- and step 5.
  SELECT completion_photo_path, completed_at, completed_by_profile_id
    INTO v_existing_path, v_existing_at, v_existing_by
    FROM public.task_instances
   WHERE id = p_instance_id;

  RETURN jsonb_build_object(
    'ok', true,
    'idempotent_replay', true,
    'instance_id', p_instance_id,
    'completed_at', v_existing_at,
    'completed_by_profile_id', v_existing_by,
    'completion_photo_path', v_existing_path
  );
END;
$complete_task_instance$;

REVOKE ALL ON FUNCTION public.complete_task_instance(text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.complete_task_instance(text, text) FROM anon;
GRANT EXECUTE ON FUNCTION public.complete_task_instance(text, text) TO authenticated;

COMMIT;
