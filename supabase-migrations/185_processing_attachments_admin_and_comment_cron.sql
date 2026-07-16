-- ============================================================================
-- 185_processing_attachments_admin_and_comment_cron.sql
-- ----------------------------------------------------------------------------
-- Processing attachments gain a NEW two-phase ADMIN-ONLY delete contract, and
-- Asana COMMENT import gains an independent comments-only automation flag +
-- the pg_cron invocation contract (schedule NOT activated).
--
-- 1. UPLOAD IS UNCHANGED (Ronnie decision 2026-07-16): the mig-166 operational
--    INSERT policy and operational add_processing_attachment stay exactly
--    as-is (farm_team/management/admin, append-only 'native/' namespace). The
--    mig-163 operational SELECT policy (signed-URL reads) also stays as-is.
--    Only DELETION is admin-only.
--
-- 2. DELETE — a NEW two-phase, retry-safe, admin-only contract (applies to
--    native AND Asana-imported attachments):
--      phase 1  request_processing_attachment_delete(p_id) locks + validates
--               the row, stamps delete_requested_at/_by, and returns the exact
--               bucket/path the client must remove;
--      phase 2  the AUTHENTICATED ADMIN removes the Storage object through the
--               narrow processing_attachments_admin_delete policy — admin role
--               + an attachment row in the requested-delete state for THAT
--               exact object path (checked via the SECURITY DEFINER helper
--               _processing_attachment_delete_ok, because the metadata table
--               is deny-all/no-grant for authenticated);
--      phase 3  finalize_processing_attachment_delete(p_id, p_ok, p_error):
--               ok=true  → tombstone (deleted_at/_by), scrub the exact
--                          bucket+path entry from every linked
--                          comments.attachments JSON on the record, truthful
--                          Activity;
--               ok=false → REOPEN (clear the request stamps), record the
--                          failure (delete_error + truthful Activity) without
--                          ever claiming deletion.
--      • Tombstone rows are KEPT — asana_attachment_gid stays populated, so
--        the Edge importer's stored-gid skip (attachment_backfill) and the
--        record_processing_comment_media gid checks keep refusing to
--        resurrect deleted files. Repeated request/finalize calls are
--        idempotent ({replayed:true} once deleted).
--      • get_processing_record: reissued (178 base, byte-preserved) with ONE
--        delta — successfully deleted tombstones are excluded from the
--        attachments array.
--      • record_processing_comment_media: reissued (173 base) with tombstone
--        guards — deleted gids are excluded from new/enriched comment
--        attachment metadata and can never re-enrich the attachment index.
--
-- 3. COMMENTS-ONLY AUTOMATION (one-way, text comments only):
--      • processing_asana_sync_settings.asana_comments_import_enabled —
--        boolean, DEFAULT FALSE. Stays false until the separately-gated PROD
--        activation. Read by the Edge fn: cron mode pins action=sync_comments
--        and that single action is allowed when EITHER asana_sync_enabled OR
--        asana_comments_import_enabled is true; every other Asana action stays
--        behind the existing global cutover gate.
--      • set_asana_comments_import_enabled(boolean) — admin toggle, mirrors
--        set_asana_sync_enabled.
--      • invoke_processing_asana_cron() — the pg_cron/pg_net/Vault invocation
--        contract (mirrors invoke_newsletter_cron/invoke_tasks_cron): reads
--        PROCESSING_ASANA_CRON_FUNCTION_URL / PROCESSING_ASANA_CRON_SECRET /
--        PROCESSING_ASANA_CRON_SERVICE_ROLE_KEY from Vault AT CALL TIME and
--        POSTs {mode:'cron'}. NO schedule is created by this migration and no
--        Vault secret is written — activation (Vault provisioning + hourly
--        cron.schedule) is a separate, Ronnie-gated rollout step (see GATE
--        block at the end).
--
-- Error class: deterministic failures use 'PROCESSING_VALIDATION:'.
-- NO BEGIN/COMMIT (TEST applies via exec_sql; PROD via psql --single-transaction).
-- Depends on: 156 (tables/settings), 163 (bucket + SELECT policy), 164
-- (_processing_emit_activity), 173 (comment-media recorder), 178
-- (get_processing_record base). Mig 166's upload policy/RPC are untouched.
-- ============================================================================

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ── 1. Two-phase delete: lifecycle columns ────────────────────────────────────
ALTER TABLE public.processing_attachments
  ADD COLUMN IF NOT EXISTS delete_requested_at timestamptz,
  ADD COLUMN IF NOT EXISTS delete_requested_by uuid REFERENCES public.profiles(id),
  ADD COLUMN IF NOT EXISTS deleted_at          timestamptz,
  ADD COLUMN IF NOT EXISTS deleted_by          uuid REFERENCES public.profiles(id),
  ADD COLUMN IF NOT EXISTS delete_error        text;

-- Exact-path lookup used by the Storage DELETE policy helper.
CREATE INDEX IF NOT EXISTS processing_attachments_delete_pending_idx
  ON public.processing_attachments (storage_path)
  WHERE delete_requested_at IS NOT NULL AND deleted_at IS NULL;

-- ── 2. Phase-1 RPC: request (lock, validate, stamp, return the exact path) ───
CREATE OR REPLACE FUNCTION public.request_processing_attachment_delete(p_id text)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $fn$
DECLARE
  v_caller uuid := auth.uid();
  v_role   text;
  v_row    public.processing_attachments;
BEGIN
  IF v_caller IS NULL THEN
    RAISE EXCEPTION 'request_processing_attachment_delete: authenticated caller required';
  END IF;
  v_role := public.profile_role();
  IF v_role IS NULL OR v_role <> 'admin' THEN
    RAISE EXCEPTION 'PROCESSING_VALIDATION: caller role % cannot delete attachments', COALESCE(v_role, 'null');
  END IF;

  SELECT * INTO v_row FROM public.processing_attachments WHERE id = p_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'PROCESSING_VALIDATION: attachment not found';
  END IF;
  -- Already fully deleted → idempotent replay, nothing to remove.
  IF v_row.deleted_at IS NOT NULL THEN
    RETURN jsonb_build_object('id', v_row.id, 'status', 'already_deleted', 'replayed', true);
  END IF;

  -- (Re)stamp the request — a retry after a failed/crashed storage removal
  -- simply refreshes the pending window; the object path never changes.
  UPDATE public.processing_attachments
     SET delete_requested_at = now(), delete_requested_by = v_caller
   WHERE id = v_row.id;

  RETURN jsonb_build_object(
    'id', v_row.id,
    'status', 'requested',
    'bucket', 'processing-attachments',
    'storage_path', v_row.storage_path,
    'filename', v_row.filename);
END
$fn$;
REVOKE ALL ON FUNCTION public.request_processing_attachment_delete(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.request_processing_attachment_delete(text) TO authenticated;

-- ── 3. Storage DELETE policy (narrow: admin + requested-delete row + path) ───
-- The metadata table is deny-all/no-grant for authenticated, so the policy
-- checks the requested-delete state through a SECURITY DEFINER helper. The
-- helper is deliberately name-exact: an admin session can remove ONLY an
-- object whose attachment row is in the pending-delete state for that path.
CREATE OR REPLACE FUNCTION public._processing_attachment_delete_ok(p_name text)
RETURNS boolean
LANGUAGE sql SECURITY DEFINER SET search_path = public STABLE
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.processing_attachments a
     WHERE a.storage_path = p_name
       AND a.delete_requested_at IS NOT NULL
       AND a.deleted_at IS NULL
  )
$$;
REVOKE ALL ON FUNCTION public._processing_attachment_delete_ok(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public._processing_attachment_delete_ok(text) TO authenticated;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'storage'
      AND tablename = 'objects'
      AND policyname = 'processing_attachments_admin_delete'
  ) THEN
    CREATE POLICY processing_attachments_admin_delete ON storage.objects
      FOR DELETE TO authenticated
      USING (
        bucket_id = 'processing-attachments'
        AND public.profile_role() = 'admin'
        AND public._processing_attachment_delete_ok(name)
      );
  END IF;
END $$;

-- ── 4. Phase-3 RPC: finalize (truthful terminal outcome, idempotent) ─────────
CREATE OR REPLACE FUNCTION public.finalize_processing_attachment_delete(
  p_id text, p_ok boolean, p_error text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $fn$
DECLARE
  v_caller uuid := auth.uid();
  v_role   text;
  v_row    public.processing_attachments;
BEGIN
  IF v_caller IS NULL THEN
    RAISE EXCEPTION 'finalize_processing_attachment_delete: authenticated caller required';
  END IF;
  v_role := public.profile_role();
  IF v_role IS NULL OR v_role <> 'admin' THEN
    RAISE EXCEPTION 'PROCESSING_VALIDATION: caller role % cannot delete attachments', COALESCE(v_role, 'null');
  END IF;

  SELECT * INTO v_row FROM public.processing_attachments WHERE id = p_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'PROCESSING_VALIDATION: attachment not found';
  END IF;
  -- Already tombstoned → idempotent replay for BOTH outcomes: the delete has
  -- already been finalized; a late failure report cannot un-delete it.
  IF v_row.deleted_at IS NOT NULL THEN
    RETURN jsonb_build_object('id', v_row.id, 'status', 'already_deleted', 'replayed', true);
  END IF;
  IF v_row.delete_requested_at IS NULL THEN
    RAISE EXCEPTION 'PROCESSING_VALIDATION: no pending delete request for this attachment';
  END IF;

  IF COALESCE(p_ok, false) THEN
    -- SUCCESS: tombstone the row (gid retained so imports can never resurrect
    -- the file), scrub the exact bucket+path entry from every comment on this
    -- record, and emit truthful Activity.
    UPDATE public.processing_attachments
       SET deleted_at = now(), deleted_by = v_caller, delete_error = NULL
     WHERE id = v_row.id;

    -- COALESCE both keys: an entry with a missing bucket/path must be KEPT
    -- (NULL would silently drop it from the aggregate), only the exact
    -- bucket+path match is scrubbed.
    UPDATE public.comments c
       SET attachments = COALESCE(
             (SELECT jsonb_agg(e)
                FROM jsonb_array_elements(COALESCE(c.attachments, '[]'::jsonb)) AS e
               WHERE NOT (COALESCE(e->>'bucket', '') = 'processing-attachments'
                          AND COALESCE(e->>'path', '') = v_row.storage_path)),
             '[]'::jsonb)
     WHERE c.entity_type = 'processing.record'
       AND c.entity_id = v_row.record_id
       AND EXISTS (
             SELECT 1 FROM jsonb_array_elements(COALESCE(c.attachments, '[]'::jsonb)) AS e
              WHERE e->>'bucket' = 'processing-attachments'
                AND e->>'path' = v_row.storage_path);

    PERFORM public._processing_emit_activity(
      v_row.record_id, 'field.updated', 'Deleted attachment: ' || v_row.filename,
      jsonb_build_object(
        'action', 'delete_attachment',
        'attachment_id', v_row.id,
        'asana_attachment_gid', v_row.asana_attachment_gid));

    RETURN jsonb_build_object('id', v_row.id, 'status', 'deleted', 'replayed', false);
  END IF;

  -- FAILURE: reopen the attachment (it is still live in Storage) and record
  -- the truthful failed outcome — never claim deletion.
  UPDATE public.processing_attachments
     SET delete_requested_at = NULL,
         delete_requested_by = NULL,
         delete_error = left(COALESCE(NULLIF(btrim(COALESCE(p_error, '')), ''), 'storage delete failed'), 500)
   WHERE id = v_row.id;

  PERFORM public._processing_emit_activity(
    v_row.record_id, 'field.updated', 'Attachment delete failed: ' || v_row.filename,
    jsonb_build_object(
      'action', 'delete_attachment_failed',
      'attachment_id', v_row.id,
      'error', left(COALESCE(p_error, 'storage delete failed'), 200)));

  RETURN jsonb_build_object('id', v_row.id, 'status', 'reopened', 'replayed', false);
END
$fn$;
REVOKE ALL ON FUNCTION public.finalize_processing_attachment_delete(text, boolean, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.finalize_processing_attachment_delete(text, boolean, text) TO authenticated;

-- ── 5. get_processing_record: exclude deleted tombstones (178 base) ──────────
-- Byte-preserved from mig 178 except the attachments aggregate gains
-- `AND a.deleted_at IS NULL`.
CREATE OR REPLACE FUNCTION public.get_processing_record(p_id text)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public STABLE
AS $fn$
DECLARE
  v_row  public.processing_records;
  v_rec  jsonb;
  v_src  jsonb;
  v_subs jsonb;
  v_atts jsonb;
  v_blockers text[];
BEGIN
  PERFORM public._processing_require_operational();
  SELECT * INTO v_row FROM public.processing_records WHERE id = p_id;
  IF NOT FOUND THEN
    RETURN NULL;
  END IF;
  v_src := public._processing_source_projection(v_row);
  v_rec := to_jsonb(v_row) || jsonb_build_object(
    'title', public._processing_current_title(v_row, v_src),
    'effective_status', public._processing_effective_status(v_row),
    'source', v_src,
    'live_count', public._processing_live_source_count(v_row),
    'animals', public._processing_animal_detail(v_row));

  SELECT COALESCE(jsonb_agg(to_jsonb(s) ORDER BY s.sort_order, s.created_at), '[]'::jsonb)
    INTO v_subs FROM public.processing_subtasks s WHERE s.record_id = p_id;
  SELECT COALESCE(jsonb_agg(to_jsonb(a) ORDER BY a.created_at DESC), '[]'::jsonb)
    INTO v_atts FROM public.processing_attachments a
   WHERE a.record_id = p_id AND a.deleted_at IS NULL;
  v_blockers := public._processing_completion_blockers(p_id);
  RETURN jsonb_build_object('record', v_rec, 'subtasks', v_subs, 'attachments', v_atts,
                            'completion_blockers', to_jsonb(v_blockers));
END
$fn$;
REVOKE ALL ON FUNCTION public.get_processing_record(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_processing_record(text) TO authenticated;

-- ── 6. record_processing_comment_media: tombstone guards (173 base) ──────────
-- Two deltas vs 173, both delete-contract guards:
--   (a) metadata built for the carrying comment EXCLUDES tombstoned gids (and
--       a comment is never created/enriched when every offered file is
--       tombstoned);
--   (b) the attachment-index loop SKIPS tombstoned gids — a deleted file can
--       never be re-enriched or re-linked.
CREATE OR REPLACE FUNCTION public.record_processing_comment_media(p_row jsonb)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $fn$
DECLARE
  v_story_gid   text := p_row->>'asana_comment_gid';
  v_rec_id      text;
  v_comment_id  text;
  v_existing    record;
  v_mentions    uuid[] := ARRAY[]::uuid[];
  v_m           jsonb;
  v_meta        jsonb;
  v_att_gid     text;
  v_att_id      text;
  v_att_row     record;
  v_metas_json  jsonb := '[]'::jsonb;
  v_comment_action text;
  v_atts_inserted  int := 0;
  v_atts_enriched  int := 0;
  v_atts_tombstoned int := 0;
  v_is_image    boolean;
BEGIN
  IF v_story_gid IS NULL OR btrim(v_story_gid) = '' THEN
    RAISE EXCEPTION 'PROCESSING_VALIDATION: asana_comment_gid (story gid) required';
  END IF;
  IF jsonb_typeof(COALESCE(p_row->'attachments', 'null'::jsonb)) <> 'array'
     OR jsonb_array_length(p_row->'attachments') = 0 THEN
    RAISE EXCEPTION 'PROCESSING_VALIDATION: comment media requires at least one attachment';
  END IF;

  SELECT processing_record_id INTO v_rec_id
    FROM public.processing_asana_links
   WHERE asana_gid = p_row->>'parent_asana_gid' AND processing_record_id IS NOT NULL;
  IF v_rec_id IS NULL THEN
    -- Diagnostic payload on purpose: the importer logs this verbatim, so a bad
    -- parent gid is identifiable without a round trip.
    RAISE EXCEPTION 'PROCESSING_VALIDATION: parent record not linked for comment media (parent_asana_gid=%)',
      COALESCE(p_row->>'parent_asana_gid', '<null>');
  END IF;

  -- Display-only mentions (real profiles only; import path never notifies).
  IF jsonb_typeof(COALESCE(p_row->'mentions', 'null'::jsonb)) = 'array' THEN
    FOR v_m IN SELECT e FROM jsonb_array_elements(p_row->'mentions') AS e LOOP
      IF jsonb_typeof(v_m) = 'string'
         AND (v_m #>> '{}') ~* '^[0-9a-f]{8}-([0-9a-f]{4}-){3}[0-9a-f]{12}$'
         AND EXISTS (SELECT 1 FROM public.profiles WHERE id = (v_m #>> '{}')::uuid) THEN
        v_mentions := array_append(v_mentions, (v_m #>> '{}')::uuid);
      END IF;
    END LOOP;
  END IF;

  -- The shared CommentsSection attachment metadata (bucket PINNED server-side —
  -- client metadata can never point elsewhere). Tombstoned gids (delete
  -- contract, this migration) are EXCLUDED — a deleted file never re-enters a
  -- comment's attachment list.
  FOR v_meta IN SELECT e FROM jsonb_array_elements(p_row->'attachments') AS e LOOP
    IF v_meta->>'asana_attachment_gid' IS NULL OR NULLIF(btrim(COALESCE(v_meta->>'storage_path', '')), '') IS NULL THEN
      RAISE EXCEPTION 'PROCESSING_VALIDATION: attachment metadata needs asana_attachment_gid + storage_path';
    END IF;
    IF EXISTS (SELECT 1 FROM public.processing_attachments t
                WHERE t.asana_attachment_gid = v_meta->>'asana_attachment_gid'
                  AND t.deleted_at IS NOT NULL) THEN
      v_atts_tombstoned := v_atts_tombstoned + 1;
      CONTINUE;
    END IF;
    v_is_image := COALESCE(v_meta->>'content_type', '') ILIKE 'image/%'
                  OR (v_meta->>'filename') ~* '\.(jpe?g|png|gif|webp|heic)$';
    v_metas_json := v_metas_json || jsonb_build_array(jsonb_build_object(
      'bucket', 'processing-attachments',
      'path', v_meta->>'storage_path',
      'name', COALESCE(v_meta->>'filename', 'attachment'),
      'mime', v_meta->>'content_type',
      'size_bytes', (v_meta->>'size_bytes')::bigint,
      'is_image', v_is_image,
      'captured_at', COALESCE(v_meta->>'original_created_at', p_row->>'created_at')
    ));
  END LOOP;

  -- Every offered file is tombstoned → nothing to carry. Never (re)create or
  -- enrich a comment for deleted media.
  IF jsonb_array_length(v_metas_json) = 0 THEN
    RETURN jsonb_build_object(
      'comment_id', NULL,
      'comment_action', 'skipped_deleted',
      'attachments_inserted', 0,
      'attachments_enriched', 0,
      'attachments_tombstoned', v_atts_tombstoned);
  END IF;

  -- Comment: create or reuse by the story gid. Reuse ONLY enriches an empty
  -- attachments list — body/author/timestamps/mentions of the stored row are
  -- immutable here (sync_comments/165 own text + mention backfill).
  SELECT id, entity_type, entity_id, source, is_imported, attachments
    INTO v_existing
    FROM public.comments
   WHERE asana_comment_gid = v_story_gid;
  IF FOUND THEN
    IF v_existing.entity_type IS DISTINCT FROM 'processing.record'
       OR v_existing.entity_id IS DISTINCT FROM v_rec_id
       OR v_existing.source IS DISTINCT FROM 'asana'
       OR v_existing.is_imported IS DISTINCT FROM true THEN
      RAISE EXCEPTION
        'PROCESSING_VALIDATION: asana_comment_gid % already belongs to a different comment/record',
        v_story_gid;
    END IF;
    v_comment_id := v_existing.id;
    IF jsonb_array_length(COALESCE(v_existing.attachments, '[]'::jsonb)) = 0 THEN
      UPDATE public.comments SET attachments = v_metas_json WHERE id = v_comment_id;
      v_comment_action := 'enriched';
    ELSE
      v_comment_action := 'reused';
    END IF;
  ELSE
    v_comment_id := COALESCE(p_row->>'id', 'cmt-' || gen_random_uuid()::text);
    INSERT INTO public.comments
      (id, entity_type, entity_id, author_profile_id, body, mentions, attachments,
       source, is_imported, original_author_name, asana_comment_gid, created_at)
    VALUES (
      v_comment_id, 'processing.record', v_rec_id, NULL,
      COALESCE(p_row->>'body', ''), v_mentions, v_metas_json,
      'asana', true, p_row->>'original_author_name', v_story_gid,
      COALESCE((p_row->>'created_at')::timestamptz, now())
    );
    v_comment_action := 'inserted';
  END IF;

  -- Attachment index rows: skip-or-enrich by asana_attachment_gid (idempotent;
  -- an attachment_backfill-created row gains its conversational provenance).
  -- Tombstoned rows are skipped OUTRIGHT — deletion is terminal.
  FOR v_meta IN SELECT e FROM jsonb_array_elements(p_row->'attachments') AS e LOOP
    v_att_gid := v_meta->>'asana_attachment_gid';
    SELECT id, record_id, asana_story_gid, comment_id, original_author_name, deleted_at
      INTO v_att_row
      FROM public.processing_attachments WHERE asana_attachment_gid = v_att_gid;
    IF FOUND THEN
      IF v_att_row.deleted_at IS NOT NULL THEN
        CONTINUE; -- tombstone: never re-enrich or re-link a deleted file
      END IF;
      IF v_att_row.record_id <> v_rec_id
         OR (v_att_row.comment_id IS NOT NULL AND v_att_row.comment_id <> v_comment_id)
         OR (v_att_row.asana_story_gid IS NOT NULL AND v_att_row.asana_story_gid <> v_story_gid) THEN
        RAISE EXCEPTION
          'PROCESSING_VALIDATION: asana_attachment_gid % has conflicting record/comment provenance',
          v_att_gid;
      END IF;
      IF v_att_row.comment_id IS NULL
         OR v_att_row.asana_story_gid IS NULL
         OR v_att_row.original_author_name IS NULL THEN
        UPDATE public.processing_attachments SET
          asana_story_gid      = COALESCE(asana_story_gid, v_story_gid),
          original_author_name = COALESCE(original_author_name, p_row->>'original_author_name'),
          comment_id           = COALESCE(comment_id, v_comment_id)
        WHERE id = v_att_row.id;
        v_atts_enriched := v_atts_enriched + 1;
      END IF;
      CONTINUE;
    END IF;
    v_att_id := 'pat-' || gen_random_uuid()::text;
    INSERT INTO public.processing_attachments
      (id, record_id, filename, content_type, size_bytes, storage_path, asana_attachment_gid,
       source_url, original_created_at, asana_story_gid, original_author_name, comment_id, created_by)
    VALUES (
      v_att_id, v_rec_id, COALESCE(v_meta->>'filename', 'attachment'), v_meta->>'content_type',
      (v_meta->>'size_bytes')::bigint, v_meta->>'storage_path', v_att_gid,
      v_meta->>'source_url', (v_meta->>'original_created_at')::timestamptz,
      v_story_gid, p_row->>'original_author_name', v_comment_id, public._processing_import_actor()
    );
    v_atts_inserted := v_atts_inserted + 1;
  END LOOP;

  RETURN jsonb_build_object(
    'comment_id', v_comment_id,
    'comment_action', v_comment_action,
    'attachments_inserted', v_atts_inserted,
    'attachments_enriched', v_atts_enriched,
    'attachments_tombstoned', v_atts_tombstoned
  );
END
$fn$;
REVOKE ALL ON FUNCTION public.record_processing_comment_media(jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_processing_comment_media(jsonb) TO service_role;

-- ── 7. Comments-only automation flag (default OFF until the PROD gate) ───────
ALTER TABLE public.processing_asana_sync_settings
  ADD COLUMN IF NOT EXISTS asana_comments_import_enabled boolean NOT NULL DEFAULT false;

CREATE OR REPLACE FUNCTION public.set_asana_comments_import_enabled(p_enabled boolean)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $fn$
DECLARE v_role text;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'set_asana_comments_import_enabled: authenticated caller required'; END IF;
  v_role := public.profile_role();
  IF v_role IS NULL OR v_role <> 'admin' THEN
    RAISE EXCEPTION 'PROCESSING_VALIDATION: caller role % cannot change sync mode', COALESCE(v_role,'null');
  END IF;
  UPDATE public.processing_asana_sync_settings
     SET asana_comments_import_enabled = COALESCE(p_enabled, false), updated_by = auth.uid(), updated_at = now()
   WHERE id = 'singleton';
  RETURN jsonb_build_object('ok', true, 'asana_comments_import_enabled', COALESCE(p_enabled, false));
END
$fn$;
REVOKE ALL ON FUNCTION public.set_asana_comments_import_enabled(boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_asana_comments_import_enabled(boolean) TO authenticated;

-- ── 8. invoke_processing_asana_cron (Vault read + http_post; NOT scheduled) ─
-- Mirrors mig 146 invoke_newsletter_cron: one auditable helper that reads the
-- three processing cron secrets from Vault AT CALL TIME (no apply-time
-- preflight — TEST apply succeeds before the secrets exist) and POSTs
-- {mode:'cron'} to the Edge Function. The Edge fn pins cron mode to
-- sync_comments (comments-only) — see the Edge contract in this lane.
CREATE OR REPLACE FUNCTION public.invoke_processing_asana_cron()
RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_url    text;
  v_secret text;
  v_jwt    text;
  v_req_id bigint;
BEGIN
  -- Trim at call time: paste-deploy of a Vault secret often picks up a trailing
  -- newline/space, which would corrupt the Bearer header. NULLIF(btrim(...),'')
  -- also collapses a whitespace-only secret to NULL so the guard below fires.
  SELECT NULLIF(btrim(decrypted_secret), '') INTO v_url
    FROM vault.decrypted_secrets WHERE name = 'PROCESSING_ASANA_CRON_FUNCTION_URL';
  SELECT NULLIF(btrim(decrypted_secret), '') INTO v_secret
    FROM vault.decrypted_secrets WHERE name = 'PROCESSING_ASANA_CRON_SECRET';
  SELECT NULLIF(btrim(decrypted_secret), '') INTO v_jwt
    FROM vault.decrypted_secrets WHERE name = 'PROCESSING_ASANA_CRON_SERVICE_ROLE_KEY';
  IF v_url IS NULL OR v_secret IS NULL OR v_jwt IS NULL THEN
    RAISE EXCEPTION 'invoke_processing_asana_cron: vault secret(s) missing/empty';
  END IF;
  SELECT net.http_post(
    url     := v_url,
    headers := jsonb_build_object(
                 'Authorization', 'Bearer ' || v_jwt,
                 'x-cron-secret', v_secret,
                 'Content-Type',  'application/json'
               ),
    body    := jsonb_build_object('mode','cron')
  ) INTO v_req_id;
  RETURN v_req_id;
END
$fn$;
REVOKE ALL ON FUNCTION public.invoke_processing_asana_cron() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.invoke_processing_asana_cron() TO postgres;

-- ----------------------------------------------------------------------------
-- GATE — hourly comments-only cron schedule (NOT executed by this migration)
-- ----------------------------------------------------------------------------
-- Activation is a separate, Ronnie-approved rollout step that runs AFTER:
--   (a) the updated processing-asana-sync Edge Function is deployed (cron mode
--       pinned to sync_comments),
--   (b) the three PROCESSING_ASANA_CRON_* Vault secrets exist, and
--   (c) asana_comments_import_enabled has been switched on through its own
--       gate (set_asana_comments_import_enabled / approved SQL).
-- Run this once, manually, at that point (hourly at :07 to avoid the top-of-
-- hour thundering herd shared with other schedules):
--
--   DO $sched$
--   BEGIN
--     IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'processing-asana-comments-hourly') THEN
--       PERFORM cron.unschedule('processing-asana-comments-hourly');
--     END IF;
--   END $sched$;
--   SELECT cron.schedule('processing-asana-comments-hourly', '7 * * * *',
--                        $cron$ SELECT public.invoke_processing_asana_cron(); $cron$);
-- ----------------------------------------------------------------------------

NOTIFY pgrst, 'reload schema';

-- ============================================================================
-- End of 185_processing_attachments_admin_and_comment_cron.sql
-- ============================================================================
