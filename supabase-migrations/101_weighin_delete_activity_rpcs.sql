-- ============================================================================
-- 101_weighin_delete_activity_rpcs.sql
-- ----------------------------------------------------------------------------
-- Audit-grade transactional weigh-in DELETE RPCs for the AUTHENTICATED record
-- page (WeighInSessionPage). These replace the last direct client hard-deletes
-- of weigh-in entries and sessions on that page:
--
--   * deleteEntry did
--       sb.from('weigh_ins').delete().eq('id', e.id)
--     then a best-effort record.deleted Activity event (two non-atomic calls;
--     the delete error was not even surfaced).
--   * deleteSession did, for cattle/sheep,
--       sb.from(commentsTable).delete().eq('source','weigh_in').in('reference_id', wiIds)
--     then
--       sb.from('weigh_in_sessions').delete().eq('id', session.id)   (FK cascade
--       removes weigh_ins) plus a best-effort record.deleted event logged BEFORE
--     the delete — three separate, non-atomic client writes.
--
-- This migration moves the final deletion + comment cleanup + record.deleted
-- Activity into one transaction each, so the hard delete is both atomic and
-- audited.
--
-- Permission shape — IMPORTANT, and deliberately different from migration 100:
--   The weigh_ins / weigh_in_sessions RLS (migration 001) is
--       FOR ALL TO authenticated USING (true)
--   i.e. ANY authenticated user may delete a weigh-in entry or session; there is
--   NO admin/management gate (unlike the processing-batch pages behind mig 100).
--   To PRESERVE existing role behavior these RPCs authenticate (auth.uid()
--   required) but deliberately do NOT add a role gate — adding one would TIGHTEN
--   current behavior, which is out of scope for this audit-atomicity lane. Anon
--   has no DELETE policy today and gets no EXECUTE here.
--
--   SECURITY DEFINER is for cross-row atomicity (row + comments + Activity in one
--   transaction), NOT to broaden who may delete. REVOKE from PUBLIC/anon; GRANT
--   to authenticated.
--
-- Scope notes:
--   * The per-cow/sheep processing-batch detach reverts and the "could not
--     auto-revert, delete anyway?" confirmation stay client-side in
--     WeighInSessionPage (unchanged), exactly as the per-sheep detach loop stayed
--     client-side for migration 100. These RPCs own only the final atomic
--     deletion + audit, not the detach workflow.
--   * The broiler completed-session ppp-v4 recompute stays client-side BEFORE the
--     session RPC: it is a pre-delete guard that can ABORT the delete and mutates
--     app_store JSON (not suited to SQL). Folding it in is out of scope.
--   * delete_weigh_in_entry mirrors the old per-entry delete exactly: it does NOT
--     touch comments (the old single-entry delete never did). Orphan-comment
--     cleanup for single-entry deletes is pre-existing behavior, out of scope.
--   * The record.deleted event lives on the weighin.session entity (entity_id =
--     the session id), matching the runtime recordActivityEvent calls. After a
--     session delete the per-entity Activity read is existence-gated, but the
--     event remains in the GLOBAL activity log as the durable audit record. Full
--     tombstone/deleted-record redesign is out of scope for this checkpoint.
--
-- Return shape (jsonb):
--   delete_weigh_in_entry:
--     ok=true:  {ok, reason:'deleted', entry_id, session_id, event_id}
--     ok=false: {ok:false, reason:'bad_args'|'no_entry', entry_id?}
--   delete_weigh_in_session:
--     ok=true:  {ok, reason:'deleted', session_id, species, entries_deleted,
--               comments_deleted, event_id}
--     ok=false: {ok:false, reason:'bad_args'|'no_session', session_id?}
--
-- Apply order: TEST first (this lane), PROD after explicit lane approval.
-- ============================================================================

-- ── delete_weigh_in_entry ───────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.delete_weigh_in_entry(
  p_entry_id     text,
  p_entity_label text DEFAULT NULL,
  p_team_member  text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_caller     uuid := auth.uid();
  v_session_id text;
  v_tag        text;
  v_weight     numeric;
  v_label      text;
  v_ae_id      text;
BEGIN
  -- 1. Authenticate. Matches weigh_ins_auth_all (TO authenticated). No role gate.
  IF v_caller IS NULL THEN
    RAISE EXCEPTION 'delete_weigh_in_entry: authenticated caller required';
  END IF;

  -- 2. Validate args.
  IF p_entry_id IS NULL OR p_entry_id = '' THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'bad_args');
  END IF;

  -- 3. Load the entry (need session_id for the Activity entity + tag/weight for
  --    the audit body).
  SELECT w.session_id, w.tag, w.weight
    INTO v_session_id, v_tag, v_weight
    FROM public.weigh_ins w
    WHERE w.id = p_entry_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'no_entry', 'entry_id', p_entry_id);
  END IF;

  v_label := COALESCE(NULLIF(trim(COALESCE(p_entity_label, '')), ''), v_session_id);

  -- 4. Audit BEFORE the row is gone (record.deleted on the weighin.session
  --    entity, matching the runtime recordActivityEvent call this replaces).
  v_ae_id := 'ae-' || gen_random_uuid()::text;
  INSERT INTO public.activity_events (
    id, entity_type, entity_id, actor_profile_id, event_type, body, payload
  ) VALUES (
    v_ae_id,
    'weighin.session',
    v_session_id,
    v_caller,
    'record.deleted',
    'Deleted entry #' || COALESCE(v_tag, '?') || ' (' || COALESCE(v_weight::text, '?') || ' lb)',
    jsonb_build_object(
      'entity_label', v_label,
      'action', 'delete_entry',
      'entry_id', p_entry_id,
      'tag', v_tag,
      'weight', v_weight,
      'team_member', p_team_member
    )
  );

  -- 5. Delete the entry row (same transaction).
  DELETE FROM public.weigh_ins WHERE id = p_entry_id;

  RETURN jsonb_build_object(
    'ok', true,
    'reason', 'deleted',
    'entry_id', p_entry_id,
    'session_id', v_session_id,
    'event_id', v_ae_id
  );
END
$fn$;

REVOKE ALL ON FUNCTION public.delete_weigh_in_entry(text, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.delete_weigh_in_entry(text, text, text) TO authenticated;

-- ── delete_weigh_in_session ─────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.delete_weigh_in_session(
  p_session_id   text,
  p_entity_label text DEFAULT NULL,
  p_team_member  text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_caller           uuid := auth.uid();
  v_species          text;
  v_label            text;
  v_entry_count      int := 0;
  v_comments_deleted int := 0;
  v_ae_id            text;
BEGIN
  -- 1. Authenticate. Matches weigh_in_sessions_auth_all (TO authenticated).
  IF v_caller IS NULL THEN
    RAISE EXCEPTION 'delete_weigh_in_session: authenticated caller required';
  END IF;

  -- 2. Validate args.
  IF p_session_id IS NULL OR p_session_id = '' THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'bad_args');
  END IF;

  -- 3. Load the session (species decides which comments table to clean).
  SELECT s.species
    INTO v_species
    FROM public.weigh_in_sessions s
    WHERE s.id = p_session_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'no_session', 'session_id', p_session_id);
  END IF;

  SELECT count(*) INTO v_entry_count
    FROM public.weigh_ins WHERE session_id = p_session_id;

  -- 4. Comment cleanup matches the old client path: cattle/sheep only, keyed by
  --    the session's weigh-in ids with source='weigh_in'. Pig/broiler weigh-ins
  --    have no comment rows, so they are skipped (as in the old code). Done while
  --    the weigh_ins rows still exist (the session delete cascades them next).
  IF v_species = 'cattle' THEN
    WITH del AS (
      DELETE FROM public.cattle_comments
        WHERE source = 'weigh_in'
          AND reference_id IN (SELECT id FROM public.weigh_ins WHERE session_id = p_session_id)
        RETURNING 1
    )
    SELECT count(*) INTO v_comments_deleted FROM del;
  ELSIF v_species = 'sheep' THEN
    WITH del AS (
      DELETE FROM public.sheep_comments
        WHERE source = 'weigh_in'
          AND reference_id IN (SELECT id FROM public.weigh_ins WHERE session_id = p_session_id)
        RETURNING 1
    )
    SELECT count(*) INTO v_comments_deleted FROM del;
  END IF;

  v_label := COALESCE(NULLIF(trim(COALESCE(p_entity_label, '')), ''), p_session_id);

  -- 5. Audit BEFORE the rows are gone (record.deleted on the weighin.session
  --    entity), matching the runtime recordActivityEvent call this replaces.
  v_ae_id := 'ae-' || gen_random_uuid()::text;
  INSERT INTO public.activity_events (
    id, entity_type, entity_id, actor_profile_id, event_type, body, payload
  ) VALUES (
    v_ae_id,
    'weighin.session',
    p_session_id,
    v_caller,
    'record.deleted',
    'Deleted session with ' || v_entry_count || ' entries',
    jsonb_build_object(
      'entity_label', v_label,
      'action', 'delete_session',
      'species', v_species,
      'entries_deleted', v_entry_count,
      'comments_deleted', v_comments_deleted,
      'team_member', p_team_member
    )
  );

  -- 6. Delete the session row (same transaction). The FK
  --    weigh_ins.session_id REFERENCES weigh_in_sessions(id) ON DELETE CASCADE
  --    removes the entry rows, preserving the old behavior.
  DELETE FROM public.weigh_in_sessions WHERE id = p_session_id;

  RETURN jsonb_build_object(
    'ok', true,
    'reason', 'deleted',
    'session_id', p_session_id,
    'species', v_species,
    'entries_deleted', v_entry_count,
    'comments_deleted', v_comments_deleted,
    'event_id', v_ae_id
  );
END
$fn$;

REVOKE ALL ON FUNCTION public.delete_weigh_in_session(text, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.delete_weigh_in_session(text, text, text) TO authenticated;

-- ── Reload PostgREST schema cache ───────────────────────────────────────────

NOTIFY pgrst, 'reload schema';

-- ============================================================================
-- End of 101_weighin_delete_activity_rpcs.sql
-- ============================================================================
