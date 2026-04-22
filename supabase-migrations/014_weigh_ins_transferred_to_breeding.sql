-- ============================================================================
-- Migration 014: weigh_ins.transferred_to_breeding + transfer_breeder_id +
--                feed_allocation_lbs
-- ----------------------------------------------------------------------------
-- Tracks pig weigh-in entries that were transferred from a feeder batch into
-- the breeders registry (e.g. final-trip day, pick the heaviest gilts and
-- promote them to sows). Mirrors the sent_to_trip pattern from migration 006.
--
--   transferred_to_breeding  bool   true once admin completed the transfer.
--   transfer_breeder_id      text   the new breeders-registry id (in
--                                   app_store.ppp-breeders-v1) so the row can
--                                   link back to her sow profile.
--   feed_allocation_lbs      numeric  feed credited to this pig (computed as
--                                     weight × FCR at transfer time). The
--                                     parent feeder batch's
--                                     feedAllocatedToTransfers running total
--                                     is incremented by the same amount so
--                                     batch displays subtract her share from
--                                     remaining-pig math.
--
-- Without this migration the LivestockWeighInsView transfer flow falls back
-- to writing a "[transferred_to_breeding ...]" marker into the note field.
-- Run this and the badge surfaces properly.
-- ============================================================================

ALTER TABLE weigh_ins ADD COLUMN IF NOT EXISTS transferred_to_breeding BOOLEAN DEFAULT FALSE;
ALTER TABLE weigh_ins ADD COLUMN IF NOT EXISTS transfer_breeder_id     TEXT;
ALTER TABLE weigh_ins ADD COLUMN IF NOT EXISTS feed_allocation_lbs     NUMERIC;

CREATE INDEX IF NOT EXISTS idx_weigh_ins_transferred_to_breeding
  ON weigh_ins (transfer_breeder_id) WHERE transferred_to_breeding = TRUE;
