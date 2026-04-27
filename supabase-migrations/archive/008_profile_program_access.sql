-- ============================================================================
-- Migration 008: per-user program access list
-- ----------------------------------------------------------------------------
-- profiles.program_access controls which animal programs a non-admin user
-- can see in the sub-nav and home tiles.
--
--   NULL or empty array  = full access (default for existing users)
--   ['cattle','broiler'] = visible only inside those programs
--
-- Admin role bypasses this check entirely (still sees everything).
--
-- Apply via Supabase SQL Editor.
-- ============================================================================

ALTER TABLE profiles ADD COLUMN IF NOT EXISTS program_access text[] DEFAULT NULL;
