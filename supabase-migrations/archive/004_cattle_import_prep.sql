-- ============================================================================
-- Migration 004: Cattle import prep
-- ----------------------------------------------------------------------------
-- Adds dropdown tables, the breeding_status column, widens the comment source
-- CHECK to accept 'import', relaxes the tag-unique index to active herds only,
-- and drops four now-deprecated cattle columns.
--
-- Safe to run on the current production schema: all drops target columns that
-- are either empty (no cattle loaded yet) or superseded by comment/weigh-in
-- models. Reviewed against PROJECT.md §3 + DECISIONS.md 2026-04-15.
-- ============================================================================


-- ============================================================================
-- PART A — Additive / widening (non-destructive)
-- ============================================================================

-- ---- 1. cattle_breeds --------------------------------------------------------
CREATE TABLE IF NOT EXISTS cattle_breeds (
  id         text PRIMARY KEY,
  label      text NOT NULL UNIQUE,
  active     boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE cattle_breeds ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS cattle_breeds_auth_all ON cattle_breeds;
CREATE POLICY cattle_breeds_auth_all ON cattle_breeds FOR ALL
  TO authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS cattle_breeds_anon_select ON cattle_breeds;
CREATE POLICY cattle_breeds_anon_select ON cattle_breeds FOR SELECT
  TO anon USING (true);


-- ---- 2. cattle_origins -------------------------------------------------------
CREATE TABLE IF NOT EXISTS cattle_origins (
  id         text PRIMARY KEY,
  label      text NOT NULL UNIQUE,
  active     boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE cattle_origins ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS cattle_origins_auth_all ON cattle_origins;
CREATE POLICY cattle_origins_auth_all ON cattle_origins FOR ALL
  TO authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS cattle_origins_anon_select ON cattle_origins;
CREATE POLICY cattle_origins_anon_select ON cattle_origins FOR SELECT
  TO anon USING (true);


-- ---- 3. cattle.breeding_status (Open / Pregnant / N/A, cow+heifer only in UI)
ALTER TABLE cattle ADD COLUMN IF NOT EXISTS breeding_status text;


-- ---- 4. Extend cattle_comments.source to allow 'import' ---------------------
ALTER TABLE cattle_comments DROP CONSTRAINT IF EXISTS cattle_comments_source_check;
ALTER TABLE cattle_comments ADD CONSTRAINT cattle_comments_source_check
  CHECK (source IN ('manual','weigh_in','daily_report','calving','import'));


-- ---- 5. Relax tag-unique index to active herds only -------------------------
-- Historical tag reuse: two SOLD/PROCESSED/DECEASED cows can share a tag.
-- Active cows (mommas/backgrounders/finishers/bulls) still have enforced
-- uniqueness so weigh-in tag lookups keep working.
DROP INDEX IF EXISTS idx_cattle_tag_unique;
CREATE UNIQUE INDEX IF NOT EXISTS idx_cattle_tag_active_unique
  ON cattle(tag)
  WHERE tag IS NOT NULL
    AND herd IN ('mommas','backgrounders','finishers','bulls');


-- ============================================================================
-- PART B — Destructive (drops four deprecated columns)
-- ============================================================================
-- Pre-conditions confirmed 2026-04-16:
--   - No cattle rows loaded yet, so no data to preserve.
--   - breeding_blacklist_reason: superseded by pinned Breeding Blacklist card.
--   - sire_reg_num: consolidated into cattle.sire_tag.
--   - receiving_weight: moved into weigh_ins (seeded on purchase_date).
--   - notes: superseded by cattle_comments timeline.
-- ============================================================================

ALTER TABLE cattle DROP COLUMN IF EXISTS breeding_blacklist_reason;
ALTER TABLE cattle DROP COLUMN IF EXISTS sire_reg_num;
ALTER TABLE cattle DROP COLUMN IF EXISTS receiving_weight;
ALTER TABLE cattle DROP COLUMN IF EXISTS notes;
