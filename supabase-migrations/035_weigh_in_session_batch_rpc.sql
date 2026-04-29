-- ============================================================================
-- Migration 035: submit_weigh_in_session_batch RPC (Phase 1C-C precursor)
-- ----------------------------------------------------------------------------
-- DB-only build. Adds a SECURITY DEFINER RPC that lets future offline-queue
-- code create one weigh_in_sessions parent + N weigh_ins children
-- atomically per operator submission. NO runtime form code is wired in
-- this migration; that's a future build with its own scope packet.
--
-- v1 allowlist (enforced inside the function via RAISE):
--   - species ∈ {'pig', 'broiler'}     -- cattle/sheep deferred
--   - status  = 'draft'                  -- completion stays online-only
--
-- Why no parent table (unlike mig 034's daily_submissions):
--   weigh_in_sessions already IS the natural parent. It existed since
--   mig 001 and got `client_submission_id` added by mig 030 with a
--   non-partial unique index — exactly the dedup contract the queue
--   needs. weigh_ins inherits via the existing `session_id` FK.
--
-- Child csid contract (Codex amendment, locked):
--   weigh_ins rows written by this RPC have client_submission_id = NULL.
--   The parent row's csid is the only idempotency key. Critical: do NOT
--   write the parent's csid to children — mig 030's unique index on
--   weigh_ins.client_submission_id would 23505 on entry #2 of any
--   multi-entry session if the parent's csid bled through.
--
--   Why NULL is safe: the RPC is atomic at the parent level. The
--   ON CONFLICT DO NOTHING + fallback SELECT branch short-circuits
--   replay BEFORE the FOR loop runs — children are never re-inserted on
--   a replay. Per-entry deterministic csids would only matter for
--   partial-child replay (e.g., adding entries to an existing session
--   post-creation), which is OUT OF SCOPE for v1.
--
--   AddFeed (mig 034) uses the same NULL-on-children rule. See
--   PROJECT.md §7.
--
-- Validation contract (RAISE before any insert; clear messages, not
-- generic constraint errors):
--   - client_submission_id required
--   - id required
--   - species in allowlist
--   - status = 'draft'
--   - date required
--   - team_member required (matches current public WeighIns UX —
--     operator picks team member before any session can start)
--   - entries_in non-empty (zero-entry sessions rejected so an
--     accidental offline submit can't create empty draft sessions)
--   - broiler_week:
--       species='broiler' → required, must be 4 or 6 (matches table
--                           CHECK; explicit RAISE is clearer than the
--                           generic constraint failure)
--       species='pig'     → ignored / coerced to NULL on insert
--
-- Side-effect columns NOT written by this RPC (deliberate — they're
-- runtime concerns that need their own design):
--   - weigh_ins.transferred_to_breeding / transfer_breeder_id /
--     feed_allocation_lbs        (pig Transfer-to-Breeding flow)
--   - weigh_ins.prior_herd_or_flock        (cattle/sheep processor flow)
--   - weigh_ins.send_to_processor /
--     target_processing_batch_id           (cattle/sheep processor flow)
--   - weigh_ins.sent_to_trip_id             (pig Send-to-Trip flow)
--   These stay NULL on RPC-written entries. Future runtime cutover
--   that needs them must extend the RPC + tests, NOT bypass it.
--
-- Tagged dollar-quote $weigh_in_session_batch$ so the test bootstrap's
-- exec_sql() — itself defined with plain $$ — can EXECUTE this migration
-- without nested-quote collisions (lesson from mig 034).
--
-- Idempotent: CREATE OR REPLACE FUNCTION; safe to re-run.
-- ============================================================================

BEGIN;

CREATE OR REPLACE FUNCTION public.submit_weigh_in_session_batch(
  parent_in   jsonb,
  entries_in  jsonb
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $weigh_in_session_batch$
DECLARE
  v_csid           text;
  v_id             text;
  v_species        text;
  v_status         text;
  v_date           text;
  v_team_member    text;
  v_broiler_week   text;
  v_broiler_week_i int;
  v_inserted       text;
  v_existing_id    text;
  v_existing_count int;
  v_entry          jsonb;
  v_entry_count    int := 0;
BEGIN
  v_csid         := parent_in ->> 'client_submission_id';
  v_id           := parent_in ->> 'id';
  v_species      := parent_in ->> 'species';
  v_status       := coalesce(parent_in ->> 'status', 'draft');
  v_date         := parent_in ->> 'date';
  v_team_member  := parent_in ->> 'team_member';
  v_broiler_week := parent_in ->> 'broiler_week';

  -- Identity / parent-shape validation.
  IF v_csid IS NULL OR v_csid = '' THEN
    RAISE EXCEPTION 'submit_weigh_in_session_batch: client_submission_id required';
  END IF;
  IF v_id IS NULL OR v_id = '' THEN
    RAISE EXCEPTION 'submit_weigh_in_session_batch: parent id required';
  END IF;

  -- v1 allowlist: pig + broiler only. cattle/sheep deferred.
  IF v_species NOT IN ('pig', 'broiler') THEN
    RAISE EXCEPTION
      'submit_weigh_in_session_batch: v1 species allowlist is pig|broiler; got %',
      v_species;
  END IF;
  -- v1 status: draft only. Completion stays online-only.
  IF v_status <> 'draft' THEN
    RAISE EXCEPTION
      'submit_weigh_in_session_batch: v1 status must be draft; got %',
      v_status;
  END IF;

  -- Required-field validation. Match current public WeighIns UX: date +
  -- team_member must be picked before any session can start.
  IF v_date IS NULL OR v_date = '' THEN
    RAISE EXCEPTION 'submit_weigh_in_session_batch: date required';
  END IF;
  IF v_team_member IS NULL OR btrim(v_team_member) = '' THEN
    RAISE EXCEPTION 'submit_weigh_in_session_batch: team_member required';
  END IF;

  -- Zero-entry rejection. Avoids accidental offline submits creating
  -- empty draft sessions on prod replay.
  IF entries_in IS NULL
     OR jsonb_typeof(entries_in) <> 'array'
     OR jsonb_array_length(entries_in) = 0 THEN
    RAISE EXCEPTION 'submit_weigh_in_session_batch: at least one entry required';
  END IF;

  -- Species-specific broiler_week handling.
  --   broiler → required and must be 4 or 6
  --   pig     → ignored (coerced to NULL on insert)
  IF v_species = 'broiler' THEN
    IF v_broiler_week IS NULL OR v_broiler_week = '' THEN
      RAISE EXCEPTION
        'submit_weigh_in_session_batch: broiler_week required for species=broiler (must be 4 or 6)';
    END IF;
    BEGIN
      v_broiler_week_i := v_broiler_week::int;
    EXCEPTION WHEN others THEN
      RAISE EXCEPTION
        'submit_weigh_in_session_batch: broiler_week must be an integer (4 or 6); got %',
        v_broiler_week;
    END;
    IF v_broiler_week_i NOT IN (4, 6) THEN
      RAISE EXCEPTION
        'submit_weigh_in_session_batch: broiler_week must be 4 or 6; got %',
        v_broiler_week_i;
    END IF;
  ELSE
    -- pig: ignore any broiler_week the caller may have sent.
    v_broiler_week_i := NULL;
  END IF;

  -- Race-safe idempotent parent insert. ON CONFLICT DO NOTHING +
  -- fallback SELECT keeps replay deterministic — no 23505 ever surfaces
  -- to the caller. Mirrors mig 034's pattern.
  INSERT INTO weigh_in_sessions (
    id,
    client_submission_id,
    date,
    team_member,
    species,
    herd,
    batch_id,
    broiler_week,
    status,
    started_at,
    notes
  ) VALUES (
    v_id,
    v_csid,
    v_date::date,
    btrim(v_team_member),
    v_species,
    parent_in ->> 'herd',
    parent_in ->> 'batch_id',
    v_broiler_week_i,
    'draft',
    coalesce((parent_in ->> 'started_at')::timestamptz, now()),
    parent_in ->> 'notes'
  )
  ON CONFLICT (client_submission_id) DO NOTHING
  RETURNING id INTO v_inserted;

  IF v_inserted IS NULL THEN
    -- Replay: existing session at this csid. Function exits BEFORE the
    -- FOR loop runs — children are never re-inserted, which is exactly
    -- why weigh_ins.client_submission_id can stay NULL on RPC writes.
    SELECT id INTO v_existing_id
      FROM weigh_in_sessions
     WHERE client_submission_id = v_csid;
    SELECT count(*) INTO v_existing_count
      FROM weigh_ins
     WHERE session_id = v_existing_id;
    RETURN jsonb_build_object(
      'session_id',        v_existing_id,
      'entry_count',       v_existing_count,
      'idempotent_replay', true
    );
  END IF;

  -- Fresh path: insert each entry with stable id + session_id link.
  -- DELIBERATELY NO client_submission_id on children — parent owns
  -- idempotency. mig 030's unique index on weigh_ins.client_submission_id
  -- would 23505 on entry #2 if the parent's csid bled through.
  -- Side-effect columns (transfer flags, processor flags, sent_to_trip_id,
  -- prior_herd_or_flock) intentionally omitted; they're runtime concerns.
  FOR v_entry IN SELECT * FROM jsonb_array_elements(entries_in) LOOP
    v_entry_count := v_entry_count + 1;
    INSERT INTO weigh_ins (
      id,
      session_id,
      tag,
      weight,
      note,
      new_tag_flag,
      entered_at
    ) VALUES (
      v_entry ->> 'id',
      v_id,
      v_entry ->> 'tag',
      (v_entry ->> 'weight')::numeric,
      v_entry ->> 'note',
      coalesce((v_entry ->> 'new_tag_flag')::boolean, false),
      coalesce((v_entry ->> 'entered_at')::timestamptz, now())
    );
  END LOOP;

  RETURN jsonb_build_object(
    'session_id',        v_id,
    'entry_count',       v_entry_count,
    'idempotent_replay', false
  );
END;
$weigh_in_session_batch$;

REVOKE ALL ON FUNCTION public.submit_weigh_in_session_batch(jsonb, jsonb) FROM public;
GRANT EXECUTE ON FUNCTION public.submit_weigh_in_session_batch(jsonb, jsonb) TO anon, authenticated;

COMMIT;
