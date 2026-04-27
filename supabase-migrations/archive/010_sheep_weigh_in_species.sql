-- ============================================================================
-- Migration 010: extend weigh_in_sessions.species CHECK to include 'sheep'.
-- ----------------------------------------------------------------------------
-- Migration 009 introduced the sheep module and stated weigh-ins would reuse
-- the existing weigh_in_sessions + weigh_ins tables with species='sheep'.
-- The CHECK constraint on weigh_in_sessions.species was never extended, so
-- inserting a sheep weigh-in session currently fails with a CHECK violation.
--
-- This migration drops and recreates the constraint to add 'sheep'. Existing
-- rows are unaffected (cattle/pig/broiler still permitted).
--
-- Apply via Supabase SQL Editor.
-- ============================================================================

ALTER TABLE weigh_in_sessions
  DROP CONSTRAINT IF EXISTS weigh_in_sessions_species_check;

ALTER TABLE weigh_in_sessions
  ADD CONSTRAINT weigh_in_sessions_species_check
  CHECK (species IN ('cattle','pig','broiler','sheep'));
