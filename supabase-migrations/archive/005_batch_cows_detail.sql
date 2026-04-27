-- ============================================================================
-- Migration 005: cattle_processing_batches.cows_detail
-- ----------------------------------------------------------------------------
-- Adds a per-cow breakdown jsonb column to processing batches so each cow's
-- live weight, hanging weight, and computed yield can be tracked individually
-- alongside the batch-level rollups.
--
-- Shape per array entry:
--   {
--     cattle_id:      text,    -- FK to cattle.id
--     tag:            text,    -- cow's tag at batch time (denormalized for display)
--     live_weight:    number|null,  -- per-cow live weight in lbs
--     hanging_weight: number|null,  -- per-cow hanging weight in lbs
--   }
--
-- Batch-level totals (total_live_weight, total_hanging_weight) continue to
-- live on the parent row — they're computed from cows_detail sums at write time.
--
-- Seeded from existing data by scripts/seed_batch_cows_detail.js:
--   * live_weight  ← cow's latest weigh-in on or before actual_process_date
--   * hanging_weight ← cow.hanging_weight (legacy column from the Podio import)
-- ============================================================================

ALTER TABLE cattle_processing_batches
  ADD COLUMN IF NOT EXISTS cows_detail jsonb NOT NULL DEFAULT '[]'::jsonb;

-- Add total_live_weight column (total_hanging_weight already exists).
ALTER TABLE cattle_processing_batches
  ADD COLUMN IF NOT EXISTS total_live_weight numeric;

COMMENT ON COLUMN cattle_processing_batches.cows_detail IS
  'Per-cow breakdown: [{cattle_id, tag, live_weight, hanging_weight}]. Sums roll up into total_live_weight / total_hanging_weight.';
