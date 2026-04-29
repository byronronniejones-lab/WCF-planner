-- ============================================================================
-- Migration 034: daily_submissions parent table + Add Feed batch RPC
-- ----------------------------------------------------------------------------
-- Initiative C precursor: lets /addfeed insert one parent row + N child rows
-- atomically per operator submission. Required because Add Feed can produce
-- multiple `*_dailys` rows from a single submit (e.g. broiler 3 batches),
-- and the offline queue cannot model that as flat per-row inserts without
-- breaking atomicity + photo attribution.
--
-- This migration ships:
--   * daily_submissions parent table (RLS enabled; authenticated read/write;
--     no anon policies — anon reaches it ONLY via the SECURITY DEFINER RPC
--     below).
--   * daily_submission_id text column on the 5 child daily tables.
--     egg_dailys is deliberately excluded — Add Feed has no egg flow.
--   * submit_add_feed_batch(parent_in jsonb, children_in jsonb) RPC.
--     SECURITY DEFINER, EXECUTE granted to anon + authenticated.
--     Race-safe idempotency via INSERT … ON CONFLICT DO NOTHING RETURNING +
--     fallback SELECT — no 23505 ever surfaces to the caller.
--
-- Out of scope:
--   * No wiring into useOfflineSubmit / IndexedDB queue. AddFeedWebform is
--     cutover to call the RPC synchronously in this build, but offline
--     queue fan-out is the next phase.
--   * No photo capture / daily-photos bucket usage.
--   * No backfill of historical Add Feed rows with daily_submission_id.
--   * No RLS changes on the 5 child daily tables. The RPC's SECURITY
--     DEFINER context bypasses any RLS on those tables, so we don't need
--     to broaden anon policies. The hand-created RLS-disabled state of
--     pig/poultry/layer_dailys (PROJECT.md §3, §7) is preserved.
--
-- Idempotent: every statement uses IF EXISTS / IF NOT EXISTS / OR REPLACE.
-- ============================================================================

BEGIN;

-- ----------------------------------------------------------------------------
-- (1) daily_submissions parent table
-- ----------------------------------------------------------------------------
-- Slim shape: id, csid, when, what, by-whom, on-what-date, audit payload.
-- Children are the source of truth for feed-aggregation math; the `payload`
-- jsonb is operator-input audit only.

CREATE TABLE IF NOT EXISTS public.daily_submissions (
  id                    text PRIMARY KEY,
  client_submission_id  text,
  submitted_at          timestamptz NOT NULL DEFAULT now(),
  form_kind             text NOT NULL,
  program               text NOT NULL,
  source                text NOT NULL DEFAULT 'add_feed_webform',
  team_member           text,
  date                  date NOT NULL,
  payload               jsonb
);

-- Mig 030 idempotency contract: non-partial unique index, NULLS DISTINCT-
-- friendly. Multiple null csids coexist; same non-null csid is one row.
CREATE UNIQUE INDEX IF NOT EXISTS daily_submissions_client_submission_id_uq
  ON public.daily_submissions (client_submission_id);

-- Time-window scans (admin browse + future queue replay window).
CREATE INDEX IF NOT EXISTS daily_submissions_date_idx
  ON public.daily_submissions (date DESC);
CREATE INDEX IF NOT EXISTS daily_submissions_form_program_idx
  ON public.daily_submissions (form_kind, program);

ALTER TABLE public.daily_submissions ENABLE ROW LEVEL SECURITY;

-- Authenticated read for admin browsing.
DROP POLICY IF EXISTS daily_submissions_auth_select ON public.daily_submissions;
CREATE POLICY daily_submissions_auth_select ON public.daily_submissions
  FOR SELECT TO authenticated USING (true);

-- Authenticated write for admin scripts / cleanup.
DROP POLICY IF EXISTS daily_submissions_auth_all ON public.daily_submissions;
CREATE POLICY daily_submissions_auth_all ON public.daily_submissions
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- DELIBERATELY: no anon SELECT/INSERT/UPDATE/DELETE policies. Anon reaches
-- daily_submissions ONLY through the SECURITY DEFINER RPC below.

-- ----------------------------------------------------------------------------
-- (2) daily_submission_id child linkage on the 5 daily tables
-- ----------------------------------------------------------------------------
-- Soft pointer (no FK) — three of these tables are hand-created in prod and
-- lack a managed schema lifecycle (PROJECT.md §3). The RPC enforces
-- referential integrity by always setting a valid id at insert time.
-- egg_dailys deliberately excluded; Add Feed never wrote there.

ALTER TABLE IF EXISTS public.pig_dailys
  ADD COLUMN IF NOT EXISTS daily_submission_id text;
ALTER TABLE IF EXISTS public.poultry_dailys
  ADD COLUMN IF NOT EXISTS daily_submission_id text;
ALTER TABLE IF EXISTS public.layer_dailys
  ADD COLUMN IF NOT EXISTS daily_submission_id text;
ALTER TABLE IF EXISTS public.cattle_dailys
  ADD COLUMN IF NOT EXISTS daily_submission_id text;
ALTER TABLE IF EXISTS public.sheep_dailys
  ADD COLUMN IF NOT EXISTS daily_submission_id text;

CREATE INDEX IF NOT EXISTS pig_dailys_submission_idx
  ON public.pig_dailys (daily_submission_id);
CREATE INDEX IF NOT EXISTS poultry_dailys_submission_idx
  ON public.poultry_dailys (daily_submission_id);
CREATE INDEX IF NOT EXISTS layer_dailys_submission_idx
  ON public.layer_dailys (daily_submission_id);
CREATE INDEX IF NOT EXISTS cattle_dailys_submission_idx
  ON public.cattle_dailys (daily_submission_id);
CREATE INDEX IF NOT EXISTS sheep_dailys_submission_idx
  ON public.sheep_dailys (daily_submission_id);

-- ----------------------------------------------------------------------------
-- (3) submit_add_feed_batch RPC
-- ----------------------------------------------------------------------------
-- Atomic parent + N children. Race-safe idempotency. Anon EXECUTE.
--
-- Inputs:
--   parent_in   jsonb — {id, client_submission_id, submitted_at?, program,
--                        team_member?, date, source?, payload?}
--                        program ∈ {pig, broiler, layer, cattle, sheep}
--                        (broiler routes to poultry_dailys; the user/app key
--                        is broiler, not poultry — matches AddFeedWebform.)
--   children_in jsonb — JSON array of child rows. Each child's shape mirrors
--                       the corresponding *_dailys table's existing column
--                       set; per-program required fields enforced by the
--                       branch's INSERT.
--
-- Output:
--   jsonb {parent_id, child_count, idempotent_replay}
--     parent_id:          the daily_submissions.id (always populated)
--     child_count:        number of child rows inserted (or counted, on replay)
--     idempotent_replay:  true if this csid had already landed; the call
--                         was a no-op
--
-- Idempotency:
--   The INSERT INTO daily_submissions … ON CONFLICT (client_submission_id)
--   DO NOTHING RETURNING id pattern gives deterministic single-row commit.
--   Two concurrent callers with the same csid: one wins (RETURNING returns
--   the new id), the other gets DO NOTHING (RETURNING empty). The losing
--   caller falls through to a SELECT and returns the winner's parent_id.
--   No 23505 ever surfaces to the caller — that's the §7 contract.
--
--   The SQL ON CONFLICT path runs INSIDE this SECURITY DEFINER function,
--   which executes as the function owner (postgres / table owner). The
--   §7 "anon webforms cannot use ON CONFLICT" rule applies to PostgREST
--   .upsert() from supabase-js as anon — that path needs anon SELECT on
--   the conflict-target column, which anon lacks on these tables. Inside
--   the function the conflict path is fine.
--
-- Children:
--   Each child is INSERTed with `daily_submission_id = <parent id>` and
--   the column set already used by AddFeedWebform.jsx for that program.
--   Critically, child rows DO NOT carry their own client_submission_id —
--   the parent owns idempotency. If multi-child Add Feed (e.g. broiler 3
--   batches) wrote the parent's csid to every child, the unique index on
--   each child table's client_submission_id (mig 030) would 23505 on
--   insert #2. Children carry NULL csid. Locked in PROJECT.md §7.
--
-- Atomicity:
--   The function body is one implicit transaction. Any RAISE EXCEPTION
--   (validation failure, type cast error, missing column, etc.) rolls
--   back the parent + every child inserted before the failure. All-or-
--   none — Codex's stated requirement.

-- Function body uses a tagged dollar-quote ($add_feed_batch$ ... $add_feed_batch$)
-- so the test bootstrap's exec_sql() — itself defined with plain $$ — can
-- EXECUTE this migration without nested-quote collisions.
CREATE OR REPLACE FUNCTION public.submit_add_feed_batch(
  parent_in   jsonb,
  children_in jsonb
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $add_feed_batch$
DECLARE
  v_csid          text;
  v_id            text;
  v_program       text;
  v_inserted      text;
  v_existing_id   text;
  v_existing_count int;
  v_child         jsonb;
  v_child_count   int := 0;
BEGIN
  v_csid    := parent_in ->> 'client_submission_id';
  v_id      := parent_in ->> 'id';
  v_program := parent_in ->> 'program';

  IF v_csid IS NULL OR v_csid = '' THEN
    RAISE EXCEPTION 'submit_add_feed_batch: client_submission_id required';
  END IF;
  IF v_id IS NULL OR v_id = '' THEN
    RAISE EXCEPTION 'submit_add_feed_batch: parent id required';
  END IF;
  IF v_program NOT IN ('pig', 'broiler', 'layer', 'cattle', 'sheep') THEN
    RAISE EXCEPTION 'submit_add_feed_batch: invalid program %', v_program;
  END IF;

  -- Race-safe idempotent parent insert.
  INSERT INTO daily_submissions (
    id, client_submission_id, submitted_at, form_kind, program,
    source, team_member, date, payload
  ) VALUES (
    v_id,
    v_csid,
    coalesce((parent_in ->> 'submitted_at')::timestamptz, now()),
    'add_feed',
    v_program,
    coalesce(parent_in ->> 'source', 'add_feed_webform'),
    parent_in ->> 'team_member',
    (parent_in ->> 'date')::date,
    parent_in -> 'payload'
  )
  ON CONFLICT (client_submission_id) DO NOTHING
  RETURNING id INTO v_inserted;

  IF v_inserted IS NULL THEN
    -- Replay — parent already exists. Children were committed atomically
    -- with the original parent insert. Return the existing id + observed
    -- child count without re-inserting anything.
    SELECT id INTO v_existing_id
      FROM daily_submissions
     WHERE client_submission_id = v_csid;
    SELECT count(*) INTO v_existing_count FROM (
      SELECT 1 FROM pig_dailys     WHERE daily_submission_id = v_existing_id
      UNION ALL SELECT 1 FROM poultry_dailys WHERE daily_submission_id = v_existing_id
      UNION ALL SELECT 1 FROM layer_dailys   WHERE daily_submission_id = v_existing_id
      UNION ALL SELECT 1 FROM cattle_dailys  WHERE daily_submission_id = v_existing_id
      UNION ALL SELECT 1 FROM sheep_dailys   WHERE daily_submission_id = v_existing_id
    ) s;
    RETURN jsonb_build_object(
      'parent_id', v_existing_id,
      'child_count', v_existing_count,
      'idempotent_replay', true
    );
  END IF;

  -- Fresh insert. Walk the children array; per-program branch picks the
  -- child table and column set. Column lists below match the exact shapes
  -- AddFeedWebform.jsx writes today (verified pre-build):
  --
  --   pig:    id, submitted_at, date, team_member, batch_label, batch_id,
  --           feed_lbs, source            (NO feed_type — pig_dailys lacks it)
  --   broiler:id, submitted_at, date, team_member, batch_label,
  --           feed_lbs, feed_type, source (writes to poultry_dailys)
  --   layer:  id, submitted_at, date, team_member, batch_label, batch_id,
  --           feed_lbs, feed_type, source
  --   cattle: id, submitted_at, date, team_member, herd, feeds, minerals,
  --           mortality_count, source
  --   sheep:  id, submitted_at, date, team_member, flock, feeds, minerals,
  --           mortality_count, source
  --
  -- Plus daily_submission_id on every program. NEVER client_submission_id
  -- on a child row — parent owns dedup.
  FOR v_child IN SELECT * FROM jsonb_array_elements(children_in) LOOP
    v_child_count := v_child_count + 1;

    IF v_program = 'pig' THEN
      INSERT INTO pig_dailys (
        id, submitted_at, date, team_member, batch_label, batch_id,
        feed_lbs, source, daily_submission_id
      ) VALUES (
        v_child ->> 'id',
        coalesce((v_child ->> 'submitted_at')::timestamptz, now()),
        (v_child ->> 'date')::date,
        v_child ->> 'team_member',
        v_child ->> 'batch_label',
        v_child ->> 'batch_id',
        coalesce((v_child ->> 'feed_lbs')::numeric, 0),
        coalesce(v_child ->> 'source', 'add_feed_webform'),
        v_id
      );

    ELSIF v_program = 'broiler' THEN
      -- broiler routes to poultry_dailys (table name has been poultry_dailys
      -- since the early days; the app/user-facing program key is broiler).
      INSERT INTO poultry_dailys (
        id, submitted_at, date, team_member, batch_label,
        feed_lbs, feed_type, source, daily_submission_id
      ) VALUES (
        v_child ->> 'id',
        coalesce((v_child ->> 'submitted_at')::timestamptz, now()),
        (v_child ->> 'date')::date,
        v_child ->> 'team_member',
        v_child ->> 'batch_label',
        coalesce((v_child ->> 'feed_lbs')::numeric, 0),
        v_child ->> 'feed_type',
        coalesce(v_child ->> 'source', 'add_feed_webform'),
        v_id
      );

    ELSIF v_program = 'layer' THEN
      INSERT INTO layer_dailys (
        id, submitted_at, date, team_member, batch_label, batch_id,
        feed_lbs, feed_type, source, daily_submission_id
      ) VALUES (
        v_child ->> 'id',
        coalesce((v_child ->> 'submitted_at')::timestamptz, now()),
        (v_child ->> 'date')::date,
        v_child ->> 'team_member',
        v_child ->> 'batch_label',
        v_child ->> 'batch_id',
        coalesce((v_child ->> 'feed_lbs')::numeric, 0),
        v_child ->> 'feed_type',
        coalesce(v_child ->> 'source', 'add_feed_webform'),
        v_id
      );

    ELSIF v_program = 'cattle' THEN
      INSERT INTO cattle_dailys (
        id, submitted_at, date, team_member, herd, feeds, minerals,
        mortality_count, source, daily_submission_id
      ) VALUES (
        v_child ->> 'id',
        coalesce((v_child ->> 'submitted_at')::timestamptz, now()),
        (v_child ->> 'date')::date,
        v_child ->> 'team_member',
        v_child ->> 'herd',
        coalesce(v_child -> 'feeds', '[]'::jsonb),
        coalesce(v_child -> 'minerals', '[]'::jsonb),
        coalesce((v_child ->> 'mortality_count')::int, 0),
        coalesce(v_child ->> 'source', 'add_feed_webform'),
        v_id
      );

    ELSIF v_program = 'sheep' THEN
      INSERT INTO sheep_dailys (
        id, submitted_at, date, team_member, flock, feeds, minerals,
        mortality_count, source, daily_submission_id
      ) VALUES (
        v_child ->> 'id',
        coalesce((v_child ->> 'submitted_at')::timestamptz, now()),
        (v_child ->> 'date')::date,
        v_child ->> 'team_member',
        v_child ->> 'flock',
        coalesce(v_child -> 'feeds', '[]'::jsonb),
        coalesce(v_child -> 'minerals', '[]'::jsonb),
        coalesce((v_child ->> 'mortality_count')::int, 0),
        coalesce(v_child ->> 'source', 'add_feed_webform'),
        v_id
      );

    END IF;
  END LOOP;

  RETURN jsonb_build_object(
    'parent_id', v_id,
    'child_count', v_child_count,
    'idempotent_replay', false
  );
END;
$add_feed_batch$;

REVOKE ALL ON FUNCTION public.submit_add_feed_batch(jsonb, jsonb) FROM public;
GRANT EXECUTE ON FUNCTION public.submit_add_feed_batch(jsonb, jsonb) TO anon, authenticated;

COMMIT;
