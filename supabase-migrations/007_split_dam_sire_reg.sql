-- ============================================================================
-- Migration 007: split dam/sire reg # from tag # + seed two new breeds
-- ----------------------------------------------------------------------------
-- Re-introduces the dedicated reg # columns that 004 dropped (sire_reg_num),
-- and adds the dam counterpart for symmetry. The cow's own registration_num
-- column (cattle.registration_num, untouched) stays as-is.
--
-- Also seeds AKAUSHI-ANGUS CROSS and RED ANGUS in cattle_breeds, plus the
-- two origin labels needed for the New Momma Planner Import (A-Z FEEDERS,
-- WRIGHT FARMS). All inserts are idempotent.
--
-- Apply via Supabase SQL Editor before running the first bulk import.
-- ============================================================================

-- 1. Reg # columns ------------------------------------------------------------
ALTER TABLE cattle ADD COLUMN IF NOT EXISTS dam_reg_num  text;
ALTER TABLE cattle ADD COLUMN IF NOT EXISTS sire_reg_num text;

-- 2. New breeds ---------------------------------------------------------------
INSERT INTO cattle_breeds (id, label, active) VALUES
  ('breed-akaushi-angus-cross', 'AKAUSHI-ANGUS CROSS', true),
  ('breed-red-angus',           'RED ANGUS',           true)
ON CONFLICT (label) DO NOTHING;

-- 3. New origins for the upcoming import --------------------------------------
INSERT INTO cattle_origins (id, label, active) VALUES
  ('origin-a-z-feeders', 'A-Z FEEDERS',  true),
  ('origin-wright-farms','WRIGHT FARMS', true)
ON CONFLICT (label) DO NOTHING;
