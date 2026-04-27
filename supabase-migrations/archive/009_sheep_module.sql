-- ============================================================================
-- Migration 009: sheep module — Phase 1 schema
-- ----------------------------------------------------------------------------
-- Mirrors the cattle module shape (sheep, *_breeds, *_origins, *_dailys,
-- *_lambing_records, *_comments) with sheep-specific differences:
--
--   * Flocks: rams / ewes / feeders + outcomes processed/deceased/sold
--     (mapping rule from import: sex=EWE→ewes, RAM→rams, WETHER→feeders).
--   * Sex CHECK: ewe / ram / wether (no LAMB rank — lambs become one of
--     these at weaning).
--   * sheep_dailys carries sheep-specific fields: bales_of_hay,
--     lbs_of_alfalfa, minerals_given + pct_eaten, fence_voltage_kv,
--     waterers_working — matches the existing Podio Sheep Daily's shape.
--   * Lambing records mirror cattle_calving_records.
--
-- Reuses the existing weigh_in_sessions + weigh_ins tables with
-- species='sheep' — no dedicated weigh-in tables needed.
--
-- Deferred to Phase 2: sheep_nutrition_targets, sheep_processing_batches,
-- sheep_breeding_cycles, sheep_feed_inputs.
--
-- Apply via Supabase SQL Editor.
-- ============================================================================


-- ===== 1. sheep (directory) =================================================
CREATE TABLE IF NOT EXISTS sheep (
  id                        text PRIMARY KEY,
  tag                       text,
  pic_path                  text,
  sex                       text CHECK (sex IN ('ewe','ram','wether')),
  flock                     text NOT NULL CHECK (flock IN ('rams','ewes','feeders','processed','deceased','sold')),
  breed                     text,
  breeding_blacklist        boolean NOT NULL DEFAULT false,
  origin                    text,
  birth_date                date,
  purchase_date             date,
  purchase_amount           numeric,
  dam_tag                   text,
  dam_reg_num               text,
  sire_tag                  text,
  sire_reg_num              text,
  registration_num          text,
  breeding_status           text,
  maternal_issue_flag       boolean NOT NULL DEFAULT false,
  maternal_issue_desc       text,
  processing_batch_id       text,
  hanging_weight            numeric,
  carcass_yield_pct         numeric,
  sale_date                 date,
  sale_amount               numeric,
  death_date                date,
  death_reason              text,
  archived                  boolean NOT NULL DEFAULT false,
  old_tags                  jsonb   NOT NULL DEFAULT '[]'::jsonb,
  created_at                timestamptz NOT NULL DEFAULT now(),
  updated_at                timestamptz NOT NULL DEFAULT now()
);

-- Tag unique only among active flocks (matches cattle pattern from mig 004).
-- Outcome flocks can share a tag with an active animal historically.
CREATE UNIQUE INDEX IF NOT EXISTS idx_sheep_tag_active_unique
  ON sheep(tag)
  WHERE tag IS NOT NULL
    AND flock IN ('rams','ewes','feeders');
CREATE INDEX IF NOT EXISTS idx_sheep_flock ON sheep(flock);
CREATE INDEX IF NOT EXISTS idx_sheep_dam ON sheep(dam_tag);

ALTER TABLE sheep ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS sheep_anon_select ON sheep;
CREATE POLICY sheep_anon_select ON sheep FOR SELECT USING (true);
DROP POLICY IF EXISTS sheep_auth_all ON sheep;
CREATE POLICY sheep_auth_all ON sheep FOR ALL TO authenticated USING (true) WITH CHECK (true);


-- ===== 2. sheep_breeds (dropdown) ==========================================
CREATE TABLE IF NOT EXISTS sheep_breeds (
  id         text PRIMARY KEY,
  label      text NOT NULL UNIQUE,
  active     boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE sheep_breeds ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS sheep_breeds_auth_all ON sheep_breeds;
CREATE POLICY sheep_breeds_auth_all ON sheep_breeds FOR ALL TO authenticated USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS sheep_breeds_anon_select ON sheep_breeds;
CREATE POLICY sheep_breeds_anon_select ON sheep_breeds FOR SELECT TO anon USING (true);

INSERT INTO sheep_breeds (id, label, active) VALUES
  ('breed-katahdin',                     'KATAHDIN',                     true),
  ('breed-dorper',                       'DORPER',                       true),
  ('breed-gulf-coast',                   'GULF COAST',                   true),
  ('breed-dorper-cross',                 'DORPER CROSS',                 true),
  ('breed-katahdin-gulf-coast-cross',    'KATAHDIN / GULF COAST CROSS',  true)
ON CONFLICT (label) DO NOTHING;


-- ===== 3. sheep_origins (dropdown) =========================================
CREATE TABLE IF NOT EXISTS sheep_origins (
  id         text PRIMARY KEY,
  label      text NOT NULL UNIQUE,
  active     boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE sheep_origins ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS sheep_origins_auth_all ON sheep_origins;
CREATE POLICY sheep_origins_auth_all ON sheep_origins FOR ALL TO authenticated USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS sheep_origins_anon_select ON sheep_origins;
CREATE POLICY sheep_origins_anon_select ON sheep_origins FOR SELECT TO anon USING (true);

INSERT INTO sheep_origins (id, label, active) VALUES
  ('origin-born-on-farm',      'BORN ON FARM',      true),
  ('origin-david-cambell',     'DAVID CAMBELL',     true),
  ('origin-steven-macias',     'STEVEN MACIAS',     true),
  ('origin-haley-west',        'HALEY WEST',        true),
  ('origin-windlestone-ranch', 'WINDLESTONE RANCH', true)
ON CONFLICT (label) DO NOTHING;


-- ===== 4. sheep_dailys =====================================================
-- Sheep-specific daily report. Different shape from cattle_dailys: hay in
-- bales (not lbs), separate alfalfa lbs, minerals tracked yes/no + % eaten,
-- fence voltage in kV, waterers working flag. Mortality is its own int.
CREATE TABLE IF NOT EXISTS sheep_dailys (
  id                  text PRIMARY KEY,
  date                date NOT NULL,
  team_member         text,
  flock               text NOT NULL,
  bales_of_hay        numeric,
  lbs_of_alfalfa      numeric,
  minerals_given      boolean,
  minerals_pct_eaten  numeric,
  fence_voltage_kv    numeric,
  waterers_working    boolean,
  mortality_count     int,
  comments            text,
  source              text,
  submitted_at        timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_sheep_dailys_date  ON sheep_dailys(date DESC);
CREATE INDEX IF NOT EXISTS idx_sheep_dailys_flock ON sheep_dailys(flock);

ALTER TABLE sheep_dailys ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS sheep_dailys_anon_insert ON sheep_dailys;
CREATE POLICY sheep_dailys_anon_insert ON sheep_dailys FOR INSERT WITH CHECK (true);
DROP POLICY IF EXISTS sheep_dailys_anon_select ON sheep_dailys;
CREATE POLICY sheep_dailys_anon_select ON sheep_dailys FOR SELECT USING (true);
DROP POLICY IF EXISTS sheep_dailys_auth_all ON sheep_dailys;
CREATE POLICY sheep_dailys_auth_all ON sheep_dailys FOR ALL TO authenticated USING (true) WITH CHECK (true);


-- ===== 5. sheep_lambing_records ============================================
CREATE TABLE IF NOT EXISTS sheep_lambing_records (
  id                  text PRIMARY KEY,
  dam_tag             text NOT NULL,
  lambing_date        date NOT NULL,
  lamb_tag            text,
  lamb_id             text REFERENCES sheep(id) ON DELETE SET NULL,
  sire_tag            text,
  total_born          int NOT NULL DEFAULT 0,
  deaths              int NOT NULL DEFAULT 0,
  complications_flag  boolean NOT NULL DEFAULT false,
  complications_desc  text,
  notes               text,
  created_at          timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_sheep_lambing_dam  ON sheep_lambing_records(dam_tag);
CREATE INDEX IF NOT EXISTS idx_sheep_lambing_date ON sheep_lambing_records(lambing_date DESC);

ALTER TABLE sheep_lambing_records ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS sheep_lambing_auth_all ON sheep_lambing_records;
CREATE POLICY sheep_lambing_auth_all ON sheep_lambing_records FOR ALL TO authenticated USING (true) WITH CHECK (true);


-- ===== 6. sheep_comments (timeline) ========================================
CREATE TABLE IF NOT EXISTS sheep_comments (
  id              text PRIMARY KEY,
  sheep_id        text REFERENCES sheep(id) ON DELETE CASCADE,
  sheep_tag       text,
  comment         text NOT NULL,
  team_member     text,
  source          text NOT NULL CHECK (source IN ('manual','weigh_in','daily_report','lambing','import')),
  reference_id    text,
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_sheep_comments_sheep  ON sheep_comments(sheep_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_sheep_comments_tag    ON sheep_comments(sheep_tag, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_sheep_comments_source ON sheep_comments(source);

ALTER TABLE sheep_comments ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS sheep_comments_anon_insert ON sheep_comments;
CREATE POLICY sheep_comments_anon_insert ON sheep_comments FOR INSERT WITH CHECK (true);
DROP POLICY IF EXISTS sheep_comments_anon_select ON sheep_comments;
CREATE POLICY sheep_comments_anon_select ON sheep_comments FOR SELECT USING (true);
DROP POLICY IF EXISTS sheep_comments_auth_all ON sheep_comments;
CREATE POLICY sheep_comments_auth_all ON sheep_comments FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- ===== Notes ================================================================
-- Weigh-ins use the existing weigh_in_sessions + weigh_ins tables with
-- species='sheep'. No new tables needed.
--
-- Phase 2 will add:
--   * sheep_nutrition_targets (per-flock dm/cp/nfc + fallback weight)
--   * sheep_processing_batches (mirror cattle_processing_batches)
--   * sheep_breeding_cycles
