-- ============================================================================
-- Migration 015: weigh_ins.send_to_processor + target_processing_batch_id
-- ----------------------------------------------------------------------------
-- Tracks which cattle weigh-in entries (finishers only, enforced in UI) have
-- been flagged during a session as "going to the processor." Mirrors the
-- pig sent_to_trip pattern from migration 006.
--
--   send_to_processor            bool   true once the team ticks the
--                                       "-> Processor" checkbox on the entry.
--                                       Set during weighing on the webform
--                                       or admin weigh-ins tab; persists across
--                                       reload/device so draft sessions can be
--                                       resumed without losing the flag.
--   target_processing_batch_id   text   the cattle_processing_batches.id the
--                                       entry was assigned to when the session
--                                       was completed (resolved via the Send-
--                                       to-Processor modal at Complete time).
--                                       Nullable until Complete; audit-only
--                                       after that. The authoritative join
--                                       remains cattle.processing_batch_id on
--                                       the cow row + batch.cows_detail.
--
-- No action without this migration: the UI reads these columns defensively,
-- so missing columns just mean the checkbox never persists a tick. Running
-- the migration enables the full flow.
-- ============================================================================

ALTER TABLE weigh_ins ADD COLUMN IF NOT EXISTS send_to_processor          BOOLEAN DEFAULT FALSE;
ALTER TABLE weigh_ins ADD COLUMN IF NOT EXISTS target_processing_batch_id TEXT;

CREATE INDEX IF NOT EXISTS idx_weigh_ins_send_to_processor
  ON weigh_ins (target_processing_batch_id) WHERE send_to_processor = TRUE;
