-- ============================================================================
-- Migration 028: sheep_processing_batches
-- ----------------------------------------------------------------------------
-- Mirror of cattle_processing_batches (archive/001_cattle_module.sql §3.9 +
-- archive/005_batch_cows_detail.sql) for sheep. Establishes the sheep
-- equivalent of the Send-to-Processor flow:
--
--   1. Admin creates an empty batch shell on /sheep/batches.
--   2. Operator flags finisher (or 'feeders'-flock) sheep weigh-in entries
--      with send_to_processor=true on the public webform.
--   3. On session complete, SheepSendToProcessorModal asks which planned
--      batch to attach to (or "+ New").
--   4. Each sheep moves to flock='processed', sheep.processing_batch_id is
--      stamped, weigh_ins.target_processing_batch_id + prior_herd_or_flock
--      are stamped (the latter from migration 027).
--
-- Detach (clear flag, delete entry, delete session, delete batch) reverses
-- this via the same fallback hierarchy as cattle:
--   1. weigh_ins.prior_herd_or_flock
--   2. latest sheep_transfers row (migration 029)
--   3. block with admin warning
--
-- The sheep.processing_batch_id column already exists (migration 009 line
-- 47, plain text, no FK). This migration creates the target table and
-- adds the FK so dangling references aren't possible.
--
-- Safe to re-run.
-- ============================================================================

CREATE TABLE IF NOT EXISTS sheep_processing_batches (
  id                      text PRIMARY KEY,
  name                    text NOT NULL UNIQUE,
  planned_process_date    date,
  actual_process_date     date,
  total_live_weight       numeric,
  total_hanging_weight    numeric,
  processing_cost         numeric,
  documents               jsonb NOT NULL DEFAULT '[]'::jsonb,
  notes                   text,
  status                  text NOT NULL DEFAULT 'planned' CHECK (status IN ('planned','complete')),
  -- Per-sheep breakdown:
  --   [{sheep_id, tag, live_weight, hanging_weight}]
  -- Sums roll up into total_live_weight / total_hanging_weight at write time.
  sheep_detail            jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at              timestamptz NOT NULL DEFAULT now(),
  updated_at              timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_sheep_processing_batches_status
  ON sheep_processing_batches(status);

ALTER TABLE sheep_processing_batches ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS sheep_processing_batches_auth_all ON sheep_processing_batches;
CREATE POLICY sheep_processing_batches_auth_all ON sheep_processing_batches FOR ALL
  TO authenticated USING (true) WITH CHECK (true);

-- Back-reference FK from sheep → processing batches. The column already
-- exists from migration 009 — this just constrains it now that the target
-- table is real.
ALTER TABLE sheep
  DROP CONSTRAINT IF EXISTS sheep_processing_batch_fk;
ALTER TABLE sheep
  ADD CONSTRAINT sheep_processing_batch_fk
  FOREIGN KEY (processing_batch_id) REFERENCES sheep_processing_batches(id) ON DELETE SET NULL;

-- Reuse the cattle module's generic updated_at trigger function (defined in
-- archive/001_cattle_module.sql §3.11 / "updated_at auto-touch triggers").
-- The function only touches NEW.updated_at — table-agnostic.
DROP TRIGGER IF EXISTS sheep_processing_batches_touch ON sheep_processing_batches;
CREATE TRIGGER sheep_processing_batches_touch BEFORE UPDATE ON sheep_processing_batches
  FOR EACH ROW EXECUTE FUNCTION cattle_touch_updated_at();

COMMENT ON COLUMN sheep_processing_batches.sheep_detail IS
  'Per-sheep breakdown: [{sheep_id, tag, live_weight, hanging_weight}]. Sums roll up into total_live_weight / total_hanging_weight at write time.';
