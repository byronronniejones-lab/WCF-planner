-- ============================================================================
-- Migration 030: offline queue schema contracts
-- ----------------------------------------------------------------------------
-- Initiative C Phase 1A — DB-only groundwork ahead of the IndexedDB queue
-- and photo-capable webform UX. NO UI / queue / service-worker changes are
-- coupled to this migration; it ships the schema contracts the queue will
-- depend on so the runtime build can land additively.
--
-- Two additions per target table:
--
--   (1) `client_submission_id text` (nullable)
--       Idempotency key (client-generated UUID/id) persisted with each
--       replayed submission. The queue worker replays via
--       `.upsert({onConflict: 'client_submission_id', ignoreDuplicates: true})`,
--       which silently no-ops when a partial-success retry hits the same key.
--       Existing rows stay null (no backfill). The supporting index is a
--       NULLABLE unique index (no WHERE predicate) so PostgREST's onConflict
--       target can match it directly — Postgres treats multiple NULLs as
--       distinct under default NULLS DISTINCT semantics, so legacy rows
--       without an id remain valid.
--
--   (2) `photos jsonb DEFAULT '[]'::jsonb` — only on the 5 daily-report
--       tables. Storage path scheme (locked in plan packet):
--           <form_kind>/<client_submission_id>/<photo_key>.jpg
--       Stored shape mirrors equipment_fuelings.photos:
--           [{name, path, mime, size_bytes, captured_at}]
--       Reads use signed URLs from the new private daily-photos bucket
--       created in migration 031 — never publicUrl. App stores paths only.
--
-- Tables in scope (per the locked plan):
--
--   client_submission_id only (no photos column):
--     - weigh_in_sessions
--     - weigh_ins
--     - equipment_fuelings
--     - fuel_supplies
--
--   client_submission_id + photos jsonb:
--     - pig_dailys
--     - poultry_dailys
--     - layer_dailys
--     - cattle_dailys
--     - sheep_dailys
--
-- Tables explicitly EXCLUDED from photos:
--     - egg_dailys (Ronnie's call: egg form will not get photo capture)
--     - fuel_supplies (anon webform; not getting photo capture in v1)
--     - weigh_in_sessions / weigh_ins (numeric-only flow)
--     - equipment_fuelings (already has its own `photos jsonb` from mig 018;
--       different storage bucket — equipment-maintenance-docs, not
--       daily-photos)
--
-- Three of the daily-report tables (pig_dailys, poultry_dailys, layer_dailys)
-- are hand-created prod tables (PROJECT.md §3) — no migration owns their
-- creation. ALTER TABLE IF EXISTS + ADD COLUMN IF NOT EXISTS keeps this
-- migration safe to apply in any order.
--
-- Safety:
--   * No backfill beyond column DEFAULT (jsonb '[]' on the photos column).
--   * Only NOT NULL constraint added: photos jsonb NOT NULL DEFAULT '[]' on
--     the 5 daily-report tables. The DEFAULT backfills existing rows so the
--     constraint can never be violated by legacy data. Mirrors the shape
--     equipment_fuelings.photos has used since migration 018.
--   * client_submission_id stays nullable on every table.
--   * No RLS changes (mig 031 handles the new bucket + its policies).
--   * No anon-role permission changes.
--
-- Idempotent: every statement uses IF EXISTS / IF NOT EXISTS so re-runs
-- are no-ops.
-- ============================================================================

BEGIN;

-- ----------------------------------------------------------------------------
-- (1) client_submission_id — 9 tables
-- ----------------------------------------------------------------------------
-- Each gets a nullable text column + a NULLABLE unique index (no WHERE
-- predicate). Postgres allows multiple NULLs in a unique index by default
-- (NULLS DISTINCT), so legacy rows without an id stay valid. The lack of
-- a partial-index predicate is intentional: PostgREST's
-- `.upsert(..., {onConflict: 'client_submission_id'})` cannot express a
-- partial-index predicate in the conflict target, so it would fail to
-- match a `WHERE client_submission_id IS NOT NULL` partial index and the
-- queue replay's idempotent upsert would error out. Plain unique index
-- gives both the duplicate-prevention guarantee and PostgREST
-- compatibility.

ALTER TABLE IF EXISTS public.pig_dailys ADD COLUMN IF NOT EXISTS client_submission_id text;
CREATE UNIQUE INDEX IF NOT EXISTS pig_dailys_client_submission_id_uq
  ON public.pig_dailys (client_submission_id);

ALTER TABLE IF EXISTS public.poultry_dailys ADD COLUMN IF NOT EXISTS client_submission_id text;
CREATE UNIQUE INDEX IF NOT EXISTS poultry_dailys_client_submission_id_uq
  ON public.poultry_dailys (client_submission_id);

ALTER TABLE IF EXISTS public.layer_dailys ADD COLUMN IF NOT EXISTS client_submission_id text;
CREATE UNIQUE INDEX IF NOT EXISTS layer_dailys_client_submission_id_uq
  ON public.layer_dailys (client_submission_id);

ALTER TABLE IF EXISTS public.cattle_dailys ADD COLUMN IF NOT EXISTS client_submission_id text;
CREATE UNIQUE INDEX IF NOT EXISTS cattle_dailys_client_submission_id_uq
  ON public.cattle_dailys (client_submission_id);

ALTER TABLE IF EXISTS public.sheep_dailys ADD COLUMN IF NOT EXISTS client_submission_id text;
CREATE UNIQUE INDEX IF NOT EXISTS sheep_dailys_client_submission_id_uq
  ON public.sheep_dailys (client_submission_id);

ALTER TABLE IF EXISTS public.weigh_in_sessions ADD COLUMN IF NOT EXISTS client_submission_id text;
CREATE UNIQUE INDEX IF NOT EXISTS weigh_in_sessions_client_submission_id_uq
  ON public.weigh_in_sessions (client_submission_id);

ALTER TABLE IF EXISTS public.weigh_ins ADD COLUMN IF NOT EXISTS client_submission_id text;
CREATE UNIQUE INDEX IF NOT EXISTS weigh_ins_client_submission_id_uq
  ON public.weigh_ins (client_submission_id);

ALTER TABLE IF EXISTS public.equipment_fuelings ADD COLUMN IF NOT EXISTS client_submission_id text;
CREATE UNIQUE INDEX IF NOT EXISTS equipment_fuelings_client_submission_id_uq
  ON public.equipment_fuelings (client_submission_id);

ALTER TABLE IF EXISTS public.fuel_supplies ADD COLUMN IF NOT EXISTS client_submission_id text;
CREATE UNIQUE INDEX IF NOT EXISTS fuel_supplies_client_submission_id_uq
  ON public.fuel_supplies (client_submission_id);

-- ----------------------------------------------------------------------------
-- (2) photos jsonb — 5 daily-report tables
-- ----------------------------------------------------------------------------
-- Default '[]'::jsonb so existing app code that reads photos[].length doesn't
-- need null-guards. Adding the column does not enable photo capture in the
-- UI; the daily-report forms keep their current shape until a future phase
-- wires the capture flow.

ALTER TABLE IF EXISTS public.pig_dailys     ADD COLUMN IF NOT EXISTS photos jsonb NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE IF EXISTS public.poultry_dailys ADD COLUMN IF NOT EXISTS photos jsonb NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE IF EXISTS public.layer_dailys   ADD COLUMN IF NOT EXISTS photos jsonb NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE IF EXISTS public.cattle_dailys  ADD COLUMN IF NOT EXISTS photos jsonb NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE IF EXISTS public.sheep_dailys   ADD COLUMN IF NOT EXISTS photos jsonb NOT NULL DEFAULT '[]'::jsonb;

-- DELIBERATELY NOT TOUCHED:
--   * public.egg_dailys     — Ronnie's call: no photo capture planned.
--   * public.fuel_supplies  — no photo capture planned.
--   * public.equipment_fuelings — already has photos jsonb from mig 018.

COMMIT;
