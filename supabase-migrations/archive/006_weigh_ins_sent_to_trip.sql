-- ============================================================================
-- Migration 006: weigh_ins.sent_to_trip_id + sent_to_group_id
-- ----------------------------------------------------------------------------
-- Tracks which pig weigh-in entries have been sent to a processing trip, so
-- admins can partial-select entries from a session and ship them to a trip
-- stored in app_store.ppp-feeders-v1 (feeder groups → processingTrips[]).
--
-- Why two fields: trips are identified only by id within a feeder group.
-- Keeping the group id alongside the trip id means we don't have to scan all
-- groups to look up what a trip belongs to.
--
-- Set on INSERT from the admin Send-to-Trip flow. Cleared (to null) if an
-- entry is removed from a trip.
--
-- A row with sent_to_trip_id IS NOT NULL is protected from the grid-save
-- wipe-and-rewrite so its trip assignment survives re-edits of the session.
-- ============================================================================

ALTER TABLE weigh_ins ADD COLUMN IF NOT EXISTS sent_to_trip_id  TEXT;
ALTER TABLE weigh_ins ADD COLUMN IF NOT EXISTS sent_to_group_id TEXT;

CREATE INDEX IF NOT EXISTS idx_weigh_ins_sent_to_trip
  ON weigh_ins (sent_to_trip_id) WHERE sent_to_trip_id IS NOT NULL;
