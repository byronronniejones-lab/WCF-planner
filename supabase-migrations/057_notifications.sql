-- ============================================================================
-- 057_notifications.sql
-- ----------------------------------------------------------------------------
-- Notifications Center — in-app notification persistence + atomic insert on
-- task completion.
--
-- Scope (this lane only):
--   * One notification type: 'task_completed'. The creator/assignor of a
--     task gets one notification when SOMEONE ELSE completes their task.
--   * No notification when the completer is the creator (self-completion).
--   * No notification when the row has no created_by_profile_id (recurring
--     templates, system-rule-generated tasks, public-webform submissions
--     where the submitter is a text team_member, not a profile).
--
-- Why created_by_profile_id is the recipient (not a separate "assignor"
-- column): the existing v2 schema (mig 050 + 053) tracks who created an
-- instance via created_by_profile_id and created_by_display_name. There
-- is no separate "assignor history" — when an admin reassigns a task,
-- the original creator stays the creator. That's the most defensible
-- "who should hear about it" recipient for this lane. A future lane can
-- broaden to (creator + previous assignees + watchers) without changing
-- the table shape.
--
-- Schema:
--   public.notifications
--     id                    text PK
--     recipient_profile_id  uuid NOT NULL  -> profiles(id) ON DELETE CASCADE
--     actor_profile_id      uuid           -> profiles(id) ON DELETE SET NULL
--     type                  text NOT NULL  (CHECK in ('task_completed'))
--     task_instance_id      text           -> task_instances(id) ON DELETE CASCADE
--     title                 text NOT NULL
--     body                  text
--     read_at               timestamptz
--     created_at            timestamptz NOT NULL DEFAULT now()
--
-- RLS:
--   recipient-only SELECT and UPDATE. No INSERT/DELETE policy — only the
--   SECURITY DEFINER complete_task_instance v2 RPC and service_role
--   write rows. Recipients can UPDATE their own row but only the read_at
--   column matters in practice; the WITH CHECK keeps recipient_profile_id
--   pinned so a stray client-side UPDATE can't reassign a row.
--
-- complete_task_instance(text, text, text[]) v2:
--   CREATE OR REPLACE'd here to APPEND a notification insert after the
--   UPDATE-to-completed. The notification insert is best-effort wrapped
--   in a BEGIN/EXCEPTION block so a notification failure NEVER blocks the
--   completion itself — a worker who finishes their task shouldn't see an
--   error because notifications had a bad day. The exception path logs a
--   NOTICE and continues. Same atomic transaction either way (RAISE
--   EXCEPTION would roll back the UPDATE).
-- ============================================================================

-- ── 1. table + indexes ────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.notifications (
  id                    text PRIMARY KEY,
  recipient_profile_id  uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  actor_profile_id      uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  type                  text NOT NULL,
  task_instance_id      text REFERENCES public.task_instances(id) ON DELETE CASCADE,
  title                 text NOT NULL,
  body                  text,
  read_at               timestamptz,
  created_at            timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT notifications_type_check CHECK (type IN ('task_completed'))
);

CREATE INDEX IF NOT EXISTS notifications_recipient_created_idx
  ON public.notifications (recipient_profile_id, created_at DESC);

-- Partial index for the common "unread count + unread list" query.
CREATE INDEX IF NOT EXISTS notifications_recipient_unread_idx
  ON public.notifications (recipient_profile_id, created_at DESC)
  WHERE read_at IS NULL;

-- ── 2. RLS ────────────────────────────────────────────────────────────────

ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS notifications_recipient_select ON public.notifications;
CREATE POLICY notifications_recipient_select
  ON public.notifications FOR SELECT
  TO authenticated
  USING (recipient_profile_id = auth.uid());

DROP POLICY IF EXISTS notifications_recipient_update_read ON public.notifications;
CREATE POLICY notifications_recipient_update_read
  ON public.notifications FOR UPDATE
  TO authenticated
  USING (recipient_profile_id = auth.uid())
  WITH CHECK (recipient_profile_id = auth.uid());

-- No INSERT or DELETE policy. SECURITY DEFINER RPCs and service_role are
-- the only writers; clients cannot fabricate notifications.
--
-- Column-scoped UPDATE grant: authenticated callers can ONLY update the
-- read_at column. Recipient-only RLS already blocks cross-user updates,
-- but without the column scope a recipient could rewrite their own row's
-- title / body / type / task_instance_id and pretend a notification said
-- something it didn't. The grant + policy together pin the writeable
-- surface to exactly the "mark read" action.
REVOKE ALL ON public.notifications FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.notifications TO authenticated;
GRANT UPDATE (read_at) ON public.notifications TO authenticated;
-- service_role bypasses RLS automatically.

-- ── 3. complete_task_instance v2 — add notification insert ────────────────
--
-- Same signature as mig 053. Body is identical through the completion
-- UPDATE; appends a best-effort notification insert before the return.
-- The notification insert respects the product rules:
--   * recipient = created_by_profile_id (creator/assignor)
--   * skip when created_by_profile_id IS NULL
--   * skip when caller == created_by_profile_id (self-completion)
--   * skip when the creator profile is gone (FK guard via select)

CREATE OR REPLACE FUNCTION public.complete_task_instance(
  p_instance_id text,
  p_completion_note text,
  p_completion_photo_paths text[] DEFAULT '{}'
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $complete_v2$
DECLARE
  v_caller uuid := auth.uid();
  v_admin boolean := public.is_admin();
  v_row record;
  v_completed_at timestamptz := now();
  v_first_path text;
  v_idx int;
  v_n int := COALESCE(array_length(p_completion_photo_paths, 1), 0);
  v_path text;
  v_expected_prefix text;
  v_filename text;
  -- Notification locals (added 057)
  v_notif_id text;
  v_notif_title text;
  v_notif_body text;
  v_actor_name text;
  v_task_title text;
BEGIN
  IF v_caller IS NULL THEN
    RAISE EXCEPTION 'complete_task_instance: authenticated caller required';
  END IF;
  IF p_completion_note IS NULL OR length(trim(p_completion_note)) = 0 THEN
    RAISE EXCEPTION 'complete_task_instance: completion_note required (non-empty)';
  END IF;
  IF v_n > 5 THEN
    RAISE EXCEPTION 'complete_task_instance: max 5 completion photos (% provided)', v_n;
  END IF;

  SELECT id, assignee_profile_id, status, completed_at, created_by_profile_id, title
    INTO v_row
    FROM public.task_instances
    WHERE id = p_instance_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'complete_task_instance: instance % not found', p_instance_id;
  END IF;

  -- Auth check FIRST — even an idempotent replay should not return ok to
  -- a non-assignee/non-admin caller. Codex correction #3.
  IF NOT v_admin AND v_row.assignee_profile_id IS DISTINCT FROM v_caller THEN
    RAISE EXCEPTION 'complete_task_instance: caller % is not the assignee or admin', v_caller;
  END IF;

  -- Idempotent replay path AFTER the auth check. Replay does NOT create a
  -- second notification — the row was already completed.
  IF v_row.status = 'completed' THEN
    RETURN jsonb_build_object(
      'ok', true,
      'idempotent_replay', true,
      'instance_id', p_instance_id,
      'completed_at', v_row.completed_at
    );
  END IF;

  -- Photo path validation: every path must match the expected prefix
  -- (task-photos/<row.assignee_profile_id>/<instance>/) and have a
  -- non-empty filename with no path separators.
  v_expected_prefix := 'task-photos/' || v_row.assignee_profile_id::text || '/' || p_instance_id || '/';
  IF v_n > 0 THEN
    FOR v_idx IN 1..v_n LOOP
      v_path := p_completion_photo_paths[v_idx];
      IF v_path IS NULL OR length(trim(v_path)) = 0 THEN
        RAISE EXCEPTION 'complete_task_instance: completion photo path #% is empty', v_idx;
      END IF;
      IF position(v_expected_prefix in v_path) <> 1 THEN
        RAISE EXCEPTION 'complete_task_instance: completion photo path #% must start with %', v_idx, v_expected_prefix;
      END IF;
      v_filename := substring(v_path from char_length(v_expected_prefix) + 1);
      IF v_filename IS NULL OR length(trim(v_filename)) = 0 THEN
        RAISE EXCEPTION 'complete_task_instance: completion photo path #% has empty filename', v_idx;
      END IF;
      IF position('/' in v_filename) > 0 OR position('\' in v_filename) > 0 THEN
        RAISE EXCEPTION 'complete_task_instance: completion photo path #% filename must not contain / or \', v_idx;
      END IF;
    END LOOP;
  END IF;

  v_first_path := CASE WHEN v_n > 0 THEN p_completion_photo_paths[1] ELSE NULL END;

  UPDATE public.task_instances
  SET status = 'completed',
      completed_at = v_completed_at,
      completed_by_profile_id = v_caller,
      completion_note = p_completion_note,
      completion_photo_path = COALESCE(v_first_path, completion_photo_path)
  WHERE id = p_instance_id AND status = 'open';

  IF NOT FOUND THEN
    SELECT completed_at INTO v_row.completed_at
      FROM public.task_instances
      WHERE id = p_instance_id;
    RETURN jsonb_build_object(
      'ok', true,
      'idempotent_replay', true,
      'instance_id', p_instance_id,
      'completed_at', v_row.completed_at
    );
  END IF;

  -- Mirror new photos into the sidecar. The AFTER trigger fires first on
  -- the UPDATE that wrote completion_photo_path, leaving a sort_order=0
  -- row with uploaded_by_profile_id NULL. RECLAIM that slot here so v2
  -- callers always see the actual uploader id.
  IF v_n > 0 THEN
    FOR v_idx IN 1..v_n LOOP
      v_path := p_completion_photo_paths[v_idx];
      IF v_path IS NULL OR length(trim(v_path)) = 0 THEN
        CONTINUE;
      END IF;
      INSERT INTO public.task_instance_photos
        (id, instance_id, kind, storage_path, uploaded_by_profile_id, sort_order)
      VALUES
        ('tip-' || p_instance_id || '-c' || (v_idx - 1)::text,
         p_instance_id, 'completion', v_path, v_caller, v_idx - 1)
      ON CONFLICT (instance_id, kind, sort_order) DO UPDATE
        SET storage_path = EXCLUDED.storage_path,
            uploaded_by_profile_id = EXCLUDED.uploaded_by_profile_id;
    END LOOP;
  END IF;

  -- ── Notification insert (057) ─────────────────────────────────────────
  -- Best-effort: a notification failure must NOT roll back the completion.
  -- Skip when: no creator (recurring/system/public-webform), or self-
  -- completion (caller == creator).
  BEGIN
    IF v_row.created_by_profile_id IS NOT NULL
       AND v_row.created_by_profile_id IS DISTINCT FROM v_caller THEN
      -- Resolve actor display name from profiles. We pass it inline into
      -- the notification body so the recipient view doesn't have to
      -- re-join profiles on every render.
      SELECT COALESCE(full_name, '') INTO v_actor_name
        FROM public.profiles
        WHERE id = v_caller;
      IF v_actor_name IS NULL OR length(trim(v_actor_name)) = 0 THEN
        v_actor_name := 'Someone';
      END IF;
      v_task_title := COALESCE(v_row.title, '');
      IF length(trim(v_task_title)) = 0 THEN
        v_task_title := 'a task';
      END IF;
      v_notif_id := 'ntf-' || gen_random_uuid()::text;
      v_notif_title := v_actor_name || ' completed ' || v_task_title;
      v_notif_body := p_completion_note;

      INSERT INTO public.notifications
        (id, recipient_profile_id, actor_profile_id, type, task_instance_id,
         title, body, created_at)
      VALUES
        (v_notif_id, v_row.created_by_profile_id, v_caller, 'task_completed',
         p_instance_id, v_notif_title, v_notif_body, v_completed_at);
    END IF;
  EXCEPTION WHEN OTHERS THEN
    -- Swallow notification errors. The completion itself stays committed
    -- because this BEGIN/EXCEPTION is a sub-transaction; the outer
    -- transaction continues. Log via NOTICE so it shows in DB logs.
    RAISE NOTICE 'complete_task_instance: notification insert failed: %', SQLERRM;
  END;

  RETURN jsonb_build_object(
    'ok', true,
    'idempotent_replay', false,
    'instance_id', p_instance_id,
    'completed_at', v_completed_at,
    'completed_by_profile_id', v_caller
  );
END;
$complete_v2$;

-- Grants — keep matching mig 053's pattern; CREATE OR REPLACE preserves
-- existing grants but re-state for clarity / future readers.
REVOKE ALL ON FUNCTION public.complete_task_instance(text, text, text[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.complete_task_instance(text, text, text[]) TO authenticated;

-- ============================================================================
-- End of 057_notifications.sql
-- ============================================================================
