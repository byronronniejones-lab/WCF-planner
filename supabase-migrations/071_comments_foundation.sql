-- ============================================================================
-- 071_comments_foundation.sql
-- ----------------------------------------------------------------------------
-- Reusable Comments layer for operational record pages. Separate from the
-- Activity layer (activity_events). Comments are user discussion; Activity
-- is system/audit events. Posting/editing/deleting comments does NOT create
-- Activity log entries.
--
-- 1. comments + comment_edits tables.
-- 2. Notifications: add comment_entity_type/id/label + comment_id columns,
--    widen type CHECK, update list_recent_notifications to resolve both
--    activity-event and comment-based notifications.
-- 3. SECDEF RPCs: list_comments, count_comments, post_comment, edit_comment,
--    delete_comment, list_comment_edits.
-- 4. Storage: comment-photos bucket created via Dashboard (not SQL).
--
-- Mention validation: p_mentions[] is authoritative (per mig 060 contract).
-- Body is plain @DisplayName text; UUIDs never appear in body. Server
-- validates: profile exists, active, max 10, caller can comment, no
-- self-mentions (self-mentions REJECT, not silently skip).
--
-- Apply order: TEST first, PROD after lane approval.
-- ============================================================================

-- ── 1. comments table ──────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.comments (
  id                 text PRIMARY KEY,
  entity_type        text NOT NULL,
  entity_id          text NOT NULL,
  author_profile_id  uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  body               text NOT NULL,
  mentions           uuid[] DEFAULT ARRAY[]::uuid[],
  attachments        jsonb DEFAULT '[]'::jsonb,
  edited_at          timestamptz,
  deleted_at         timestamptz,
  deleted_by         uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at         timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS comments_entity_idx
  ON public.comments (entity_type, entity_id, created_at DESC);

CREATE INDEX IF NOT EXISTS comments_author_idx
  ON public.comments (author_profile_id);

REVOKE ALL ON TABLE public.comments FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON TABLE public.comments TO authenticated;

ALTER TABLE public.comments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS comments_deny_all ON public.comments;
CREATE POLICY comments_deny_all ON public.comments
  FOR ALL USING (false);

-- ── 2. comment_edits table ─────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.comment_edits (
  id                   text PRIMARY KEY,
  comment_id           text NOT NULL REFERENCES public.comments(id) ON DELETE CASCADE,
  previous_body        text NOT NULL,
  previous_attachments jsonb DEFAULT '[]'::jsonb,
  edited_by            uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  edited_at            timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS comment_edits_comment_idx
  ON public.comment_edits (comment_id, edited_at DESC);

REVOKE ALL ON TABLE public.comment_edits FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT ON TABLE public.comment_edits TO authenticated;

ALTER TABLE public.comment_edits ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS comment_edits_deny_all ON public.comment_edits;
CREATE POLICY comment_edits_deny_all ON public.comment_edits
  FOR ALL USING (false);

-- ── 3. Notifications: add comment routing columns + widen type ─────────────
-- Existing mention notifications route via activity_event_id → activity_events
-- join. Comment mentions have no activity_event. Add direct entity columns
-- and comment_id so list_recent_notifications can resolve both paths.

ALTER TABLE public.notifications
  ADD COLUMN IF NOT EXISTS comment_entity_type  text,
  ADD COLUMN IF NOT EXISTS comment_entity_id    text,
  ADD COLUMN IF NOT EXISTS comment_entity_label text,
  ADD COLUMN IF NOT EXISTS comment_id           text;

ALTER TABLE public.notifications DROP CONSTRAINT IF EXISTS notifications_type_check;
ALTER TABLE public.notifications
  ADD CONSTRAINT notifications_type_check
  CHECK (type IN ('task_completed', 'mention', 'comment_mention'));

-- Drop + recreate list_recent_notifications because the return type changes
-- (adds comment_id column). CREATE OR REPLACE cannot change return types.
DROP FUNCTION IF EXISTS public.list_recent_notifications(int);
CREATE OR REPLACE FUNCTION public.list_recent_notifications(
  p_limit int DEFAULT 20
) RETURNS TABLE (
  id                    text,
  recipient_profile_id  uuid,
  actor_profile_id      uuid,
  type                  text,
  task_instance_id      text,
  activity_event_id     text,
  title                 text,
  body                  text,
  read_at               timestamptz,
  created_at            timestamptz,
  activity_entity_type  text,
  activity_entity_id    text,
  activity_entity_label text,
  comment_id            text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
STABLE
AS $fn$
DECLARE
  v_caller uuid := auth.uid();
  v_limit int := LEAST(GREATEST(COALESCE(p_limit, 20), 1), 100);
BEGIN
  IF v_caller IS NULL THEN
    RAISE EXCEPTION 'list_recent_notifications: authenticated caller required';
  END IF;

  RETURN QUERY
    SELECT
      n.id,
      n.recipient_profile_id,
      n.actor_profile_id,
      n.type,
      n.task_instance_id,
      n.activity_event_id,
      n.title,
      n.body,
      n.read_at,
      n.created_at,
      CASE
        WHEN n.type = 'comment_mention'
             AND n.comment_entity_type IS NOT NULL
             AND public._activity_can_read(n.comment_entity_type, n.comment_entity_id)
          THEN n.comment_entity_type
        WHEN ae.id IS NOT NULL AND public._activity_can_read(ae.entity_type, ae.entity_id)
          THEN ae.entity_type
        ELSE NULL
      END AS activity_entity_type,
      CASE
        WHEN n.type = 'comment_mention'
             AND n.comment_entity_type IS NOT NULL
             AND public._activity_can_read(n.comment_entity_type, n.comment_entity_id)
          THEN n.comment_entity_id
        WHEN ae.id IS NOT NULL AND public._activity_can_read(ae.entity_type, ae.entity_id)
          THEN ae.entity_id
        ELSE NULL
      END AS activity_entity_id,
      CASE
        WHEN n.type = 'comment_mention'
             AND n.comment_entity_type IS NOT NULL
             AND public._activity_can_read(n.comment_entity_type, n.comment_entity_id)
          THEN n.comment_entity_label
        WHEN ae.id IS NOT NULL AND public._activity_can_read(ae.entity_type, ae.entity_id)
          THEN (ae.payload->>'entity_label')::text
        ELSE NULL
      END AS activity_entity_label,
      CASE
        WHEN n.type = 'comment_mention'
             AND n.comment_entity_type IS NOT NULL
             AND public._activity_can_read(n.comment_entity_type, n.comment_entity_id)
          THEN n.comment_id
        ELSE NULL
      END AS comment_id
    FROM public.notifications n
    LEFT JOIN public.activity_events ae ON ae.id = n.activity_event_id
    WHERE n.recipient_profile_id = v_caller
    ORDER BY n.created_at DESC
    LIMIT v_limit;
END
$fn$;

REVOKE ALL ON FUNCTION public.list_recent_notifications(int) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.list_recent_notifications(int) TO authenticated;

-- ── 4. Storage bucket ──────────────────────────────────────────────────────
-- The comment-photos private bucket must be created via Supabase Dashboard
-- or service_role INSERT into storage.buckets (same as daily-photos,
-- task-photos). Bucket config: private, authenticated INSERT + SELECT,
-- signed URLs for reads. This migration does not create the bucket.

-- ── 5. list_comments RPC ───────────────────────────────────────────────────
-- Non-admin deleted rows return NULL body and empty attachments (fix #3).

CREATE OR REPLACE FUNCTION public.list_comments(
  p_entity_type text,
  p_entity_id   text,
  p_limit       int DEFAULT 50
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_caller uuid := auth.uid();
  v_role   text;
  v_result jsonb;
BEGIN
  IF v_caller IS NULL THEN
    RAISE EXCEPTION 'list_comments: authenticated caller required';
  END IF;
  v_role := public.profile_role();
  IF v_role IS NULL OR v_role = 'inactive' THEN
    RAISE EXCEPTION 'list_comments: caller role % cannot read', COALESCE(v_role, 'null');
  END IF;
  IF NOT public._activity_can_read(p_entity_type, p_entity_id) THEN
    RAISE EXCEPTION 'list_comments: not permitted for entity_type=%', p_entity_type;
  END IF;

  SELECT COALESCE(jsonb_agg(row_to_json(r) ORDER BY r.created_at DESC), '[]'::jsonb)
  INTO v_result
  FROM (
    SELECT
      c.id,
      c.entity_type,
      c.entity_id,
      c.author_profile_id,
      COALESCE(p.full_name, 'Unknown user') AS author_display_name,
      CASE WHEN c.deleted_at IS NOT NULL AND v_role <> 'admin'
           THEN NULL ELSE c.body END AS body,
      CASE WHEN c.deleted_at IS NOT NULL AND v_role <> 'admin'
           THEN ARRAY[]::uuid[] ELSE c.mentions END AS mentions,
      CASE WHEN c.deleted_at IS NOT NULL AND v_role <> 'admin'
           THEN ARRAY[]::text[]
           ELSE (SELECT array_agg(COALESCE(mp.full_name, 'Unknown') ORDER BY m.ord)
                 FROM unnest(c.mentions) WITH ORDINALITY AS m(uid, ord)
                 LEFT JOIN public.profiles mp ON mp.id = m.uid)
      END AS mentioned_profile_names,
      CASE WHEN c.deleted_at IS NOT NULL AND v_role <> 'admin'
           THEN '[]'::jsonb ELSE c.attachments END AS attachments,
      c.edited_at,
      c.deleted_at,
      c.created_at
    FROM public.comments c
    LEFT JOIN public.profiles p ON p.id = c.author_profile_id
    WHERE c.entity_type = p_entity_type
      AND c.entity_id = p_entity_id
    ORDER BY c.created_at DESC
    LIMIT GREATEST(p_limit, 1)
  ) r;

  RETURN v_result;
END
$fn$;

REVOKE ALL ON FUNCTION public.list_comments(text, text, int) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.list_comments(text, text, int) TO authenticated;

-- ── 6. count_comments RPC ──────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.count_comments(
  p_entity_type text,
  p_entity_id   text
) RETURNS int
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
STABLE
AS $fn$
DECLARE
  v_caller uuid := auth.uid();
BEGIN
  IF v_caller IS NULL THEN RETURN 0; END IF;
  IF NOT public._activity_can_read(p_entity_type, p_entity_id) THEN RETURN 0; END IF;
  RETURN (
    SELECT count(*)::int FROM public.comments
    WHERE entity_type = p_entity_type AND entity_id = p_entity_id AND deleted_at IS NULL
  );
END
$fn$;

REVOKE ALL ON FUNCTION public.count_comments(text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.count_comments(text, text) TO authenticated;

-- ── 7. post_comment RPC ────────────────────────────────────────────────────
-- p_mentions[] is authoritative (no _extract_mention_uuids body validation).
-- Self-mention REJECTS (not silently skip). Validates: profile exists,
-- active, max 10, caller can comment, not self.
-- Attachment validation: array, max 5 items, each must have path field.

CREATE OR REPLACE FUNCTION public.post_comment(
  p_entity_type  text,
  p_entity_id    text,
  p_body         text,
  p_entity_label text DEFAULT NULL,
  p_mentions     uuid[] DEFAULT ARRAY[]::uuid[],
  p_attachments  jsonb DEFAULT '[]'::jsonb
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_caller     uuid := auth.uid();
  v_role       text;
  v_comment_id text;
  v_actor_name text;
  v_label      text;
  v_m          uuid;
  v_n_mentions int;
  v_mention_role text;
  v_notif_id   text;
  v_notif_title text;
  v_notif_body text;
  v_n_attach   int;
  i            int;
BEGIN
  IF v_caller IS NULL THEN
    RAISE EXCEPTION 'post_comment: authenticated caller required';
  END IF;
  IF p_body IS NULL OR length(trim(p_body)) = 0 THEN
    RAISE EXCEPTION 'post_comment: body required (non-empty)';
  END IF;
  IF length(p_body) > 4000 THEN
    RAISE EXCEPTION 'post_comment: body too long (% chars; max 4000)', length(p_body);
  END IF;

  v_role := public.profile_role();
  IF v_role IS NULL OR v_role = 'inactive' THEN
    RAISE EXCEPTION 'post_comment: caller role % cannot post', COALESCE(v_role, 'null');
  END IF;
  IF NOT public._activity_can_write(p_entity_type, p_entity_id) THEN
    RAISE EXCEPTION 'post_comment: not permitted for entity_type=%', p_entity_type;
  END IF;

  -- Validate attachments: array, max 5, each item must have path/name/mime
  IF jsonb_typeof(p_attachments) <> 'array' THEN
    RAISE EXCEPTION 'post_comment: attachments must be a JSON array';
  END IF;
  v_n_attach := jsonb_array_length(p_attachments);
  IF v_n_attach > 5 THEN
    RAISE EXCEPTION 'post_comment: too many attachments (% > 5)', v_n_attach;
  END IF;
  FOR i IN 0 .. v_n_attach - 1 LOOP
    IF (p_attachments->i->>'path') IS NULL OR length(p_attachments->i->>'path') = 0 THEN
      RAISE EXCEPTION 'post_comment: attachment[%] missing path', i;
    END IF;
    IF NOT starts_with(p_attachments->i->>'path', p_entity_type || '/' || p_entity_id || '/') THEN
      RAISE EXCEPTION 'post_comment: attachment[%] path not scoped to entity', i;
    END IF;
    IF (p_attachments->i->>'name') IS NULL THEN
      RAISE EXCEPTION 'post_comment: attachment[%] missing name', i;
    END IF;
    IF (p_attachments->i->>'mime') IS NULL THEN
      RAISE EXCEPTION 'post_comment: attachment[%] missing mime', i;
    END IF;
  END LOOP;

  -- Validate mentions
  v_n_mentions := COALESCE(array_length(p_mentions, 1), 0);
  IF v_n_mentions > 10 THEN
    RAISE EXCEPTION 'post_comment: too many mentions (% > 10)', v_n_mentions;
  END IF;
  IF v_n_mentions > 0 THEN
    FOREACH v_m IN ARRAY p_mentions LOOP
      IF v_m = v_caller THEN
        RAISE EXCEPTION 'post_comment: cannot mention yourself';
      END IF;
      SELECT role INTO v_mention_role FROM public.profiles WHERE id = v_m;
      IF v_mention_role IS NULL THEN
        RAISE EXCEPTION 'post_comment: mentioned profile % not found', v_m;
      END IF;
      IF v_mention_role = 'inactive' THEN
        RAISE EXCEPTION 'post_comment: mentioned profile % is inactive', v_m;
      END IF;
    END LOOP;
  END IF;

  SELECT COALESCE(full_name, '') INTO v_actor_name
    FROM public.profiles WHERE id = v_caller;
  IF v_actor_name IS NULL OR length(trim(v_actor_name)) = 0 THEN
    v_actor_name := 'Someone';
  END IF;

  v_label := COALESCE(NULLIF(trim(COALESCE(p_entity_label, '')), ''), p_entity_id);
  v_comment_id := 'cmt-' || gen_random_uuid()::text;

  INSERT INTO public.comments
    (id, entity_type, entity_id, author_profile_id, body, mentions, attachments, created_at)
  VALUES
    (v_comment_id, p_entity_type, p_entity_id, v_caller, p_body, p_mentions, p_attachments, now());

  -- Fan out mention notifications
  IF v_n_mentions > 0 THEN
    FOREACH v_m IN ARRAY p_mentions LOOP
      v_notif_id := 'ntf-' || gen_random_uuid()::text;
      v_notif_title := v_actor_name || ' mentioned you in a comment on ' || v_label;
      v_notif_body := left(p_body, 200);

      INSERT INTO public.notifications
        (id, recipient_profile_id, actor_profile_id, type,
         comment_entity_type, comment_entity_id, comment_entity_label,
         comment_id, title, body, created_at)
      VALUES
        (v_notif_id, v_m, v_caller, 'comment_mention',
         p_entity_type, p_entity_id, v_label,
         v_comment_id, v_notif_title, v_notif_body, now());
    END LOOP;
  END IF;

  RETURN jsonb_build_object('ok', true, 'comment_id', v_comment_id);
END
$fn$;

REVOKE ALL ON FUNCTION public.post_comment(text, text, text, text, uuid[], jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.post_comment(text, text, text, text, uuid[], jsonb) TO authenticated;

-- ── 8. edit_comment RPC ────────────────────────────────────────────────────
-- Fixes: SELECTs mentions into v_row. Validates caller role + entity access.
-- Self-mention rejects. No _extract_mention_uuids. Attachment validation.

CREATE OR REPLACE FUNCTION public.edit_comment(
  p_comment_id   text,
  p_body         text,
  p_mentions     uuid[] DEFAULT ARRAY[]::uuid[],
  p_attachments  jsonb DEFAULT '[]'::jsonb
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_caller     uuid := auth.uid();
  v_role       text;
  v_row        record;
  v_m          uuid;
  v_n_mentions int;
  v_mention_role text;
  v_edit_id    text;
  v_actor_name text;
  v_label      text;
  v_already    boolean;
  v_notif_id   text;
  v_notif_title text;
  v_notif_body text;
  v_n_attach   int;
  i            int;
BEGIN
  IF v_caller IS NULL THEN
    RAISE EXCEPTION 'edit_comment: authenticated caller required';
  END IF;
  IF p_body IS NULL OR length(trim(p_body)) = 0 THEN
    RAISE EXCEPTION 'edit_comment: body required (non-empty)';
  END IF;
  IF length(p_body) > 4000 THEN
    RAISE EXCEPTION 'edit_comment: body too long';
  END IF;

  v_role := public.profile_role();
  IF v_role IS NULL OR v_role = 'inactive' THEN
    RAISE EXCEPTION 'edit_comment: caller role % cannot edit', COALESCE(v_role, 'null');
  END IF;

  SELECT id, entity_type, entity_id, author_profile_id, body, mentions, attachments, deleted_at
    INTO v_row
    FROM public.comments
    WHERE id = p_comment_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'edit_comment: comment % not found', p_comment_id;
  END IF;
  IF v_row.deleted_at IS NOT NULL THEN
    RAISE EXCEPTION 'edit_comment: comment % is deleted', p_comment_id;
  END IF;
  IF v_row.author_profile_id IS DISTINCT FROM v_caller THEN
    RAISE EXCEPTION 'edit_comment: only the author may edit';
  END IF;
  IF NOT public._activity_can_write(v_row.entity_type, v_row.entity_id) THEN
    RAISE EXCEPTION 'edit_comment: not permitted for entity';
  END IF;

  -- Validate attachments: array, max 5, each item must have path/name/mime
  IF jsonb_typeof(p_attachments) <> 'array' THEN
    RAISE EXCEPTION 'edit_comment: attachments must be a JSON array';
  END IF;
  v_n_attach := jsonb_array_length(p_attachments);
  IF v_n_attach > 5 THEN
    RAISE EXCEPTION 'edit_comment: too many attachments (% > 5)', v_n_attach;
  END IF;
  FOR i IN 0 .. v_n_attach - 1 LOOP
    IF (p_attachments->i->>'path') IS NULL OR length(p_attachments->i->>'path') = 0 THEN
      RAISE EXCEPTION 'edit_comment: attachment[%] missing path', i;
    END IF;
    IF NOT starts_with(p_attachments->i->>'path', v_row.entity_type || '/' || v_row.entity_id || '/') THEN
      RAISE EXCEPTION 'edit_comment: attachment[%] path not scoped to entity', i;
    END IF;
    IF (p_attachments->i->>'name') IS NULL THEN
      RAISE EXCEPTION 'edit_comment: attachment[%] missing name', i;
    END IF;
    IF (p_attachments->i->>'mime') IS NULL THEN
      RAISE EXCEPTION 'edit_comment: attachment[%] missing mime', i;
    END IF;
  END LOOP;

  -- Validate mentions
  v_n_mentions := COALESCE(array_length(p_mentions, 1), 0);
  IF v_n_mentions > 10 THEN
    RAISE EXCEPTION 'edit_comment: too many mentions';
  END IF;
  IF v_n_mentions > 0 THEN
    FOREACH v_m IN ARRAY p_mentions LOOP
      IF v_m = v_caller THEN
        RAISE EXCEPTION 'edit_comment: cannot mention yourself';
      END IF;
      SELECT role INTO v_mention_role FROM public.profiles WHERE id = v_m;
      IF v_mention_role IS NULL THEN
        RAISE EXCEPTION 'edit_comment: mentioned profile % not found', v_m;
      END IF;
      IF v_mention_role = 'inactive' THEN
        RAISE EXCEPTION 'edit_comment: mentioned profile % is inactive', v_m;
      END IF;
    END LOOP;
  END IF;

  -- Save previous version to edit history
  v_edit_id := 'cedit-' || gen_random_uuid()::text;
  INSERT INTO public.comment_edits
    (id, comment_id, previous_body, previous_attachments, edited_by, edited_at)
  VALUES
    (v_edit_id, p_comment_id, v_row.body, v_row.attachments, v_caller, now());

  UPDATE public.comments
    SET body = p_body,
        mentions = p_mentions,
        attachments = p_attachments,
        edited_at = now()
    WHERE id = p_comment_id;

  -- Fan out notifications for NEW mentions only
  IF v_n_mentions > 0 THEN
    SELECT COALESCE(full_name, '') INTO v_actor_name
      FROM public.profiles WHERE id = v_caller;
    IF v_actor_name IS NULL OR length(trim(v_actor_name)) = 0 THEN
      v_actor_name := 'Someone';
    END IF;
    v_label := COALESCE(NULLIF(trim(COALESCE(v_row.entity_id, '')), ''), p_comment_id);

    FOREACH v_m IN ARRAY p_mentions LOOP
      SELECT (v_m = ANY(v_row.mentions)) INTO v_already;
      IF v_already THEN CONTINUE; END IF;

      v_notif_id := 'ntf-' || gen_random_uuid()::text;
      v_notif_title := v_actor_name || ' mentioned you in a comment on ' || v_label;
      v_notif_body := left(p_body, 200);
      INSERT INTO public.notifications
        (id, recipient_profile_id, actor_profile_id, type,
         comment_entity_type, comment_entity_id, comment_entity_label,
         comment_id, title, body, created_at)
      VALUES
        (v_notif_id, v_m, v_caller, 'comment_mention',
         v_row.entity_type, v_row.entity_id, v_label,
         p_comment_id, v_notif_title, v_notif_body, now());
    END LOOP;
  END IF;

  RETURN jsonb_build_object('ok', true, 'comment_id', p_comment_id);
END
$fn$;

REVOKE ALL ON FUNCTION public.edit_comment(text, text, uuid[], jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.edit_comment(text, text, uuid[], jsonb) TO authenticated;

-- ── 9. delete_comment RPC ──────────────────────────────────────────────────
-- Validates caller role is active + entity access, not just author/admin.

CREATE OR REPLACE FUNCTION public.delete_comment(
  p_comment_id text
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_caller uuid := auth.uid();
  v_role   text;
  v_row    record;
BEGIN
  IF v_caller IS NULL THEN
    RAISE EXCEPTION 'delete_comment: authenticated caller required';
  END IF;

  v_role := public.profile_role();
  IF v_role IS NULL OR v_role = 'inactive' THEN
    RAISE EXCEPTION 'delete_comment: caller role % cannot delete', COALESCE(v_role, 'null');
  END IF;

  SELECT id, entity_type, entity_id, author_profile_id, deleted_at
    INTO v_row
    FROM public.comments
    WHERE id = p_comment_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'delete_comment: comment % not found', p_comment_id;
  END IF;
  IF v_row.deleted_at IS NOT NULL THEN
    RAISE EXCEPTION 'delete_comment: comment % already deleted', p_comment_id;
  END IF;

  IF NOT public._activity_can_write(v_row.entity_type, v_row.entity_id) THEN
    RAISE EXCEPTION 'delete_comment: not permitted for entity';
  END IF;

  IF v_row.author_profile_id IS DISTINCT FROM v_caller AND v_role <> 'admin' THEN
    RAISE EXCEPTION 'delete_comment: only author or admin may delete';
  END IF;

  UPDATE public.comments
    SET deleted_at = now(),
        deleted_by = v_caller
    WHERE id = p_comment_id;

  RETURN jsonb_build_object('ok', true, 'comment_id', p_comment_id);
END
$fn$;

REVOKE ALL ON FUNCTION public.delete_comment(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.delete_comment(text) TO authenticated;

-- ── 10. list_comment_edits RPC ─────────────────────────────────────────────
-- Non-admin cannot view edit history of deleted comments.

CREATE OR REPLACE FUNCTION public.list_comment_edits(
  p_comment_id text
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_caller  uuid := auth.uid();
  v_role    text;
  v_comment record;
  v_result  jsonb;
BEGIN
  IF v_caller IS NULL THEN
    RAISE EXCEPTION 'list_comment_edits: authenticated caller required';
  END IF;

  v_role := public.profile_role();
  IF v_role IS NULL OR v_role = 'inactive' THEN
    RAISE EXCEPTION 'list_comment_edits: caller role % cannot read', COALESCE(v_role, 'null');
  END IF;

  SELECT id, entity_type, entity_id, deleted_at
    INTO v_comment
    FROM public.comments
    WHERE id = p_comment_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'list_comment_edits: comment % not found', p_comment_id;
  END IF;

  IF NOT public._activity_can_read(v_comment.entity_type, v_comment.entity_id) THEN
    RAISE EXCEPTION 'list_comment_edits: not permitted';
  END IF;

  -- Non-admin cannot view deleted comment edit history
  IF v_comment.deleted_at IS NOT NULL AND v_role <> 'admin' THEN
    RETURN '[]'::jsonb;
  END IF;

  SELECT COALESCE(jsonb_agg(row_to_json(r) ORDER BY r.edited_at DESC), '[]'::jsonb)
  INTO v_result
  FROM (
    SELECT
      ce.id, ce.comment_id, ce.previous_body, ce.previous_attachments,
      ce.edited_by, COALESCE(p.full_name, 'Unknown user') AS editor_display_name,
      ce.edited_at
    FROM public.comment_edits ce
    LEFT JOIN public.profiles p ON p.id = ce.edited_by
    WHERE ce.comment_id = p_comment_id
    ORDER BY ce.edited_at DESC
  ) r;

  RETURN v_result;
END
$fn$;

REVOKE ALL ON FUNCTION public.list_comment_edits(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.list_comment_edits(text) TO authenticated;

-- ── 11. list_comment_mentionable_profiles RPC ──────────────────────────────
-- Returns active profiles (id + full_name only) for the mention picker.
-- No role, email, or other sensitive fields exposed.

CREATE OR REPLACE FUNCTION public.list_comment_mentionable_profiles()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
STABLE
AS $fn$
DECLARE
  v_caller uuid := auth.uid();
  v_role   text;
  v_result jsonb;
BEGIN
  IF v_caller IS NULL THEN
    RAISE EXCEPTION 'list_comment_mentionable_profiles: authenticated caller required';
  END IF;
  v_role := public.profile_role();
  IF v_role IS NULL OR v_role = 'inactive' THEN
    RAISE EXCEPTION 'list_comment_mentionable_profiles: caller role % cannot read', COALESCE(v_role, 'null');
  END IF;

  SELECT COALESCE(jsonb_agg(row_to_json(r) ORDER BY r.full_name), '[]'::jsonb)
  INTO v_result
  FROM (
    SELECT p.id, p.full_name
    FROM public.profiles p
    WHERE p.role IS NOT NULL
      AND p.role <> 'inactive'
      AND p.full_name IS NOT NULL
      AND length(trim(p.full_name)) > 0
    ORDER BY p.full_name
  ) r;

  RETURN v_result;
END
$fn$;

REVOKE ALL ON FUNCTION public.list_comment_mentionable_profiles() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.list_comment_mentionable_profiles() TO authenticated;

NOTIFY pgrst, 'reload schema';

-- ============================================================================
-- End of 071_comments_foundation.sql
-- ============================================================================
