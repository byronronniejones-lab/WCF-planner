-- ============================================================================
-- 086_equipment_maintenance_idempotency.sql
-- ----------------------------------------------------------------------------
-- Duplicate protection for equipment maintenance/service events.
--
-- equipment_maintenance_events was the one equipment "report" with NO
-- duplicate protection (no client_submission_id, no unique index, no client
-- pre-check), so a double-tap / in-flight re-submit of "Add Event" inserted
-- two identical rows. Fuelings and fuel_supplies already have this protection
-- (mig 030).
--
-- This is IDEMPOTENCY, not business-uniqueness: a piece of equipment can
-- legitimately have multiple maintenance events on the same date (e.g. a
-- morning inspection + an afternoon repair), so we deliberately do NOT add a
-- (equipment_id, event_date) unique index. We only collapse re-submits that
-- carry the SAME client_submission_id (the modal mints one per open and
-- replays it on retry).
--
-- The unique index is non-partial, matching the mig 030 pattern. Postgres
-- treats NULLs as distinct, so the existing rows (client_submission_id NULL)
-- are unaffected; only client-supplied ids are enforced unique.
--
-- Apply: TEST first, then PROD (psql -v ON_ERROR_STOP=1). No data cleanup
-- needed — PROD has 0 duplicate maintenance events today (purely preventive).
-- ============================================================================

ALTER TABLE IF EXISTS public.equipment_maintenance_events
  ADD COLUMN IF NOT EXISTS client_submission_id text;

CREATE UNIQUE INDEX IF NOT EXISTS equipment_maintenance_events_client_submission_id_uq
  ON public.equipment_maintenance_events (client_submission_id);

-- Client now writes client_submission_id; refresh PostgREST's schema cache so
-- the new column is accepted on insert.
NOTIFY pgrst, 'reload schema';

-- ============================================================================
-- End of 086_equipment_maintenance_idempotency.sql
-- ============================================================================
