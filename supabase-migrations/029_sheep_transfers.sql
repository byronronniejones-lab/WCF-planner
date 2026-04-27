-- ============================================================================
-- Migration 029: sheep_transfers
-- ----------------------------------------------------------------------------
-- Append-only audit log for flock movements. Mirrors cattle_transfers
-- (archive/001_cattle_module.sql §3.10) for sheep. Used by:
--
--   * SheepFlocksView.transferSheep — manual flock changes by admin
--   * SheepSendToProcessorModal — attach event when a sheep moves to
--     flock='processed' via the Send-to-Processor flow
--   * detachSheepFromBatch (Phase 2 lib helper) — reversal events
--     (reason='processing_batch_undo') when the flag is cleared
--
-- Append-only means there's no UPDATE/DELETE policy. To "fix" a bad audit
-- entry, write a new corrective row with reason='manual' explaining the
-- correction.
--
-- Detach helper's fallback-hierarchy step #2 reads this table when
-- weigh_ins.prior_herd_or_flock is null on a row — it walks the most
-- recent matching audit entry to find the from_flock to revert to.
--
-- Safe to re-run.
-- ============================================================================

CREATE TABLE IF NOT EXISTS sheep_transfers (
  id                  text PRIMARY KEY,
  sheep_id            text NOT NULL REFERENCES sheep(id) ON DELETE CASCADE,
  from_flock          text,
  to_flock            text NOT NULL,
  reason              text NOT NULL,
    -- 'manual' | 'processing_batch' | 'processing_batch_undo' | future...
  reference_id        text,
    -- batch id when reason references a processing batch
  team_member         text,
  transferred_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_sheep_transfers_sheep
  ON sheep_transfers(sheep_id, transferred_at DESC);
CREATE INDEX IF NOT EXISTS idx_sheep_transfers_ref
  ON sheep_transfers(reference_id) WHERE reference_id IS NOT NULL;

ALTER TABLE sheep_transfers ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS sheep_transfers_auth_insert ON sheep_transfers;
CREATE POLICY sheep_transfers_auth_insert ON sheep_transfers FOR INSERT
  TO authenticated WITH CHECK (true);

DROP POLICY IF EXISTS sheep_transfers_auth_select ON sheep_transfers;
CREATE POLICY sheep_transfers_auth_select ON sheep_transfers FOR SELECT
  TO authenticated USING (true);

-- No UPDATE/DELETE policies — audit log is append-only.
