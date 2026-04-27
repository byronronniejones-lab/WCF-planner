-- ============================================================================
-- Migration 027: weigh_ins.prior_herd_or_flock
-- ----------------------------------------------------------------------------
-- Adds the revert anchor for the bidirectional send_to_processor flow.
-- Stamped at attach time with the animal's herd (cattle) or flock (sheep)
-- BEFORE the move to 'processed', and ONLY when transitioning non-processed
-- → processed (so multi-batch reattach doesn't capture 'processed' as the
-- "prior" state).
--
-- Read at detach time when the flag is cleared, an entry is deleted, a
-- session is deleted, or a batch is deleted, so we can return the animal
-- to where it was. If the column is null on a row, the detach helper
-- falls back to the matching cattle_transfers / sheep_transfers audit row;
-- if neither is available, the detach is BLOCKED with an admin-visible
-- warning rather than silently guessing.
--
-- Single column, single species-agnostic name (cattle calls them herds,
-- sheep calls them flocks). RLS is unchanged — the existing weigh_ins
-- policies already cover SELECT/INSERT/UPDATE for this table.
--
-- Safe to re-run.
-- ============================================================================

ALTER TABLE weigh_ins ADD COLUMN IF NOT EXISTS prior_herd_or_flock TEXT;

COMMENT ON COLUMN weigh_ins.prior_herd_or_flock IS
  'Herd (cattle) or flock (sheep) the animal occupied immediately before being attached to a processing batch via send_to_processor. Stamped only on non-processed→processed transitions. Read by the detach helper to revert the animal when the flag is cleared.';
