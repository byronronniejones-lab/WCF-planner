-- ============================================================================
-- 103_weighin_delete_for_update_hardening.sql
-- ----------------------------------------------------------------------------
-- Concurrency hardening follow-up for the weigh-in delete RPCs shipped in
-- migration 101 (delete_weigh_in_entry / delete_weigh_in_session).
--
-- Migration 101 read the target row, inserted the record.deleted audit, then
-- DELETEd by id without locking. Two concurrent calls could both pass the read,
-- both insert an audit row, and both return ok even though the second DELETE
-- removes 0 rows (double-audit + false ok). This is the same defect Codex caught
-- in migration 102 for the equipment-log RPCs; this migration applies the same
-- SELECT ... FOR UPDATE fix to the two weigh-in RPCs.
--
-- With FOR UPDATE the target row is locked at read time: a second concurrent
-- call blocks until the first commits, then finds the row gone and returns
-- no_entry / no_session with no audit (rather than re-auditing + a false ok).
--
-- This is a pure CREATE OR REPLACE of the two functions: identical signatures,
-- permission shape (authenticated only, no role gate, anon revoked), return
-- shapes, audit bodies, comment-cleanup, and cascade behavior as migration 101 —
-- the ONLY change is `FOR UPDATE` on each function's target-row read. Grants are
-- preserved by CREATE OR REPLACE but re-stated here for parity with 101/102.
--
-- Apply order: TEST first, PROD after explicit approval (batched with 102).
-- ============================================================================

-- ── delete_weigh_in_entry (FOR UPDATE on the entry read) ─────────────────────

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

  -- 3. Load + LOCK the entry (session_id for the Activity entity + tag/weight for
  --    the audit body). FOR UPDATE makes read+audit+delete idempotent under
  --    concurrency: a second concurrent call blocks here, then finds the row gone
  --    and returns no_entry with no duplicate audit.
  SELECT w.session_id, w.tag, w.weight
    INTO v_session_id, v_tag, v_weight
    FROM public.weigh_ins w
    WHERE w.id = p_entry_id
    FOR UPDATE;
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

-- ── delete_weigh_in_session (FOR UPDATE on the session read) ─────────────────

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

  -- 3. Load + LOCK the session (species decides which comments table to clean).
  --    FOR UPDATE makes read+audit+delete idempotent under concurrency: a second
  --    concurrent call blocks here, then finds the session gone and returns
  --    no_session with no duplicate audit / no double comment-cleanup.
  SELECT s.species
    INTO v_species
    FROM public.weigh_in_sessions s
    WHERE s.id = p_session_id
    FOR UPDATE;
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
-- End of 103_weighin_delete_for_update_hardening.sql
-- ============================================================================
