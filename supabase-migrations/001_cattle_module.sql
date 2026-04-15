-- ============================================================================
-- Cattle Module — Phase 1, 2, 3 schema
-- ============================================================================
-- Apply via Supabase SQL Editor. Idempotent (uses IF NOT EXISTS / OR REPLACE).
-- Design reference: CATTLE_DESIGN.md at repo root.
--
-- Conventions matched to existing schema:
-- - `id` is a client-generated text primary key (see existing pig_dailys pattern).
-- - Timestamps default to now() in UTC.
-- - JSONB where structure is flexible (nutrition snapshots, ingredient lists).
-- - Dailys / weigh-ins tables allow anon INSERT (public webforms) but restrict
--   UPDATE/DELETE/SELECT to authenticated users.
-- - Config tables (feed inputs, nutrition targets) allow anon SELECT so the
--   public webforms can read feed lists, but only authenticated can write.
-- ============================================================================


-- ===== 3.1  cattle_feed_inputs ===============================================
CREATE TABLE IF NOT EXISTS cattle_feed_inputs (
  id                  text PRIMARY KEY,
  name                text NOT NULL,
  category            text NOT NULL CHECK (category IN ('hay','pellet','liquid','mineral','other')),
  unit                text NOT NULL CHECK (unit IN ('bale','lb','tub','bag')),
  unit_weight_lbs     numeric,
  cost_per_unit       numeric,
  freight_per_truck   numeric,
  units_per_truck     int,
  moisture_pct        numeric,
  nfc_pct             numeric,
  protein_pct         numeric,
  status              text NOT NULL DEFAULT 'active' CHECK (status IN ('active','inactive')),
  herd_scope          text[] NOT NULL DEFAULT ARRAY[]::text[],
  notes               text,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_cattle_feed_inputs_status ON cattle_feed_inputs(status);
CREATE INDEX IF NOT EXISTS idx_cattle_feed_inputs_category ON cattle_feed_inputs(category);

ALTER TABLE cattle_feed_inputs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS feed_inputs_anon_select ON cattle_feed_inputs;
CREATE POLICY feed_inputs_anon_select ON cattle_feed_inputs FOR SELECT USING (true);

DROP POLICY IF EXISTS feed_inputs_auth_write ON cattle_feed_inputs;
CREATE POLICY feed_inputs_auth_write ON cattle_feed_inputs FOR ALL
  TO authenticated USING (true) WITH CHECK (true);


-- ===== 3.2  cattle_feed_tests ================================================
CREATE TABLE IF NOT EXISTS cattle_feed_tests (
  id                  text PRIMARY KEY,
  feed_input_id       text NOT NULL REFERENCES cattle_feed_inputs(id) ON DELETE CASCADE,
  effective_date      date NOT NULL,
  moisture_pct        numeric,
  nfc_pct             numeric,
  protein_pct         numeric,
  bale_weight_lbs     numeric,
  pdf_path            text,
  pdf_file_name       text,
  notes               text,
  uploaded_by         text,
  uploaded_at         timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_cattle_feed_tests_feed ON cattle_feed_tests(feed_input_id, effective_date DESC);

ALTER TABLE cattle_feed_tests ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS feed_tests_anon_select ON cattle_feed_tests;
CREATE POLICY feed_tests_anon_select ON cattle_feed_tests FOR SELECT USING (true);

DROP POLICY IF EXISTS feed_tests_auth_write ON cattle_feed_tests;
CREATE POLICY feed_tests_auth_write ON cattle_feed_tests FOR ALL
  TO authenticated USING (true) WITH CHECK (true);


-- ===== 3.3  cattle_nutrition_targets =========================================
CREATE TABLE IF NOT EXISTS cattle_nutrition_targets (
  herd                    text PRIMARY KEY CHECK (herd IN ('mommas','backgrounders','finishers','bulls')),
  target_dm_pct_body      numeric NOT NULL DEFAULT 2.5,
  target_cp_pct_dm        numeric NOT NULL DEFAULT 10,
  target_nfc_pct_dm       numeric NOT NULL DEFAULT 30,
  fallback_cow_weight_lbs numeric NOT NULL DEFAULT 1200,
  notes                   text,
  updated_at              timestamptz NOT NULL DEFAULT now()
);

-- Seed starter values (see CATTLE_DESIGN.md §3.3)
INSERT INTO cattle_nutrition_targets (herd, target_dm_pct_body, target_cp_pct_dm, target_nfc_pct_dm, fallback_cow_weight_lbs)
VALUES
  ('mommas',        2.5, 10, 30, 1200),
  ('backgrounders', 2.5, 13, 40,  650),
  ('finishers',     2.8, 12, 50, 1100),
  ('bulls',         2.0, 10, 25, 1800)
ON CONFLICT (herd) DO NOTHING;

ALTER TABLE cattle_nutrition_targets ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS nutrition_targets_anon_select ON cattle_nutrition_targets;
CREATE POLICY nutrition_targets_anon_select ON cattle_nutrition_targets FOR SELECT USING (true);

DROP POLICY IF EXISTS nutrition_targets_auth_write ON cattle_nutrition_targets;
CREATE POLICY nutrition_targets_auth_write ON cattle_nutrition_targets FOR ALL
  TO authenticated USING (true) WITH CHECK (true);


-- ===== 3.4  cattle_dailys ====================================================
CREATE TABLE IF NOT EXISTS cattle_dailys (
  id                  text PRIMARY KEY,
  submitted_at        timestamptz NOT NULL DEFAULT now(),
  date                date NOT NULL,
  team_member         text,
  herd                text NOT NULL CHECK (herd IN ('mommas','backgrounders','finishers','bulls','processed','deceased','sold')),
  feeds               jsonb NOT NULL DEFAULT '[]'::jsonb,
  minerals            jsonb NOT NULL DEFAULT '[]'::jsonb,
  fence_voltage       numeric,
  water_checked       boolean,
  mortality_count     int NOT NULL DEFAULT 0,
  mortality_reason    text,
  issues              text,
  source              text,
  created_at          timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_cattle_dailys_date ON cattle_dailys(date DESC);
CREATE INDEX IF NOT EXISTS idx_cattle_dailys_herd ON cattle_dailys(herd);
CREATE INDEX IF NOT EXISTS idx_cattle_dailys_source ON cattle_dailys(source);

ALTER TABLE cattle_dailys ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS cattle_dailys_anon_insert ON cattle_dailys;
CREATE POLICY cattle_dailys_anon_insert ON cattle_dailys FOR INSERT WITH CHECK (true);

DROP POLICY IF EXISTS cattle_dailys_auth_all ON cattle_dailys;
CREATE POLICY cattle_dailys_auth_all ON cattle_dailys FOR ALL
  TO authenticated USING (true) WITH CHECK (true);


-- ===== 3.5  weigh_in_sessions + weigh_ins ====================================
CREATE TABLE IF NOT EXISTS weigh_in_sessions (
  id                  text PRIMARY KEY,
  date                date NOT NULL,
  team_member         text,
  species             text NOT NULL CHECK (species IN ('cattle','pig','broiler')),
  herd                text,
  batch_id            text,
  broiler_week        int CHECK (broiler_week IN (4,6)),
  status              text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','complete')),
  started_at          timestamptz NOT NULL DEFAULT now(),
  completed_at        timestamptz,
  notes               text
);

CREATE INDEX IF NOT EXISTS idx_weigh_in_sessions_species_status ON weigh_in_sessions(species, status);
CREATE INDEX IF NOT EXISTS idx_weigh_in_sessions_date ON weigh_in_sessions(date DESC);

ALTER TABLE weigh_in_sessions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS weigh_in_sessions_anon_rw ON weigh_in_sessions;
-- Public webforms need INSERT and UPDATE (resume a draft). No DELETE for anon.
CREATE POLICY weigh_in_sessions_anon_insert ON weigh_in_sessions FOR INSERT WITH CHECK (true);
CREATE POLICY weigh_in_sessions_anon_update ON weigh_in_sessions FOR UPDATE USING (true) WITH CHECK (true);
CREATE POLICY weigh_in_sessions_anon_select ON weigh_in_sessions FOR SELECT USING (true);

DROP POLICY IF EXISTS weigh_in_sessions_auth_all ON weigh_in_sessions;
CREATE POLICY weigh_in_sessions_auth_all ON weigh_in_sessions FOR ALL
  TO authenticated USING (true) WITH CHECK (true);


CREATE TABLE IF NOT EXISTS weigh_ins (
  id                  text PRIMARY KEY,
  session_id          text NOT NULL REFERENCES weigh_in_sessions(id) ON DELETE CASCADE,
  tag                 text,
  weight              numeric NOT NULL,
  note                text,
  new_tag_flag        boolean NOT NULL DEFAULT false,
  entered_at          timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_weigh_ins_session ON weigh_ins(session_id);
CREATE INDEX IF NOT EXISTS idx_weigh_ins_tag ON weigh_ins(tag);

ALTER TABLE weigh_ins ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS weigh_ins_anon_insert ON weigh_ins;
CREATE POLICY weigh_ins_anon_insert ON weigh_ins FOR INSERT WITH CHECK (true);

DROP POLICY IF EXISTS weigh_ins_anon_select ON weigh_ins;
CREATE POLICY weigh_ins_anon_select ON weigh_ins FOR SELECT USING (true);

DROP POLICY IF EXISTS weigh_ins_anon_update ON weigh_ins;
CREATE POLICY weigh_ins_anon_update ON weigh_ins FOR UPDATE USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS weigh_ins_auth_all ON weigh_ins;
CREATE POLICY weigh_ins_auth_all ON weigh_ins FOR ALL
  TO authenticated USING (true) WITH CHECK (true);


-- ===== 3.6  cattle (Directory) ===============================================
CREATE TABLE IF NOT EXISTS cattle (
  id                        text PRIMARY KEY,
  tag                       text,                 -- nullable for unweaned calves
  pic_path                  text,
  purchase_tag_id           text,
  sex                       text CHECK (sex IN ('cow','heifer','bull','steer')),
  herd                      text NOT NULL CHECK (herd IN ('mommas','backgrounders','finishers','bulls','processed','deceased','sold')),
  breed                     text,
  breeding_blacklist        boolean NOT NULL DEFAULT false,
  breeding_blacklist_reason text,
  pct_wagyu                 int CHECK (pct_wagyu BETWEEN 0 AND 100),
  origin                    text,
  birth_date                date,
  purchase_date             date,
  receiving_weight          numeric,
  purchase_amount           numeric,
  dam_tag                   text,
  sire_tag                  text,
  sire_reg_num              text,
  registration_num          text,
  dna_test_pdf_path         text,
  maternal_issue_flag       boolean NOT NULL DEFAULT false,
  maternal_issue_desc       text,
  processing_batch_id       text,
  hanging_weight            numeric,
  carcass_yield_pct         numeric,
  sale_date                 date,
  sale_amount               numeric,
  death_date                date,
  death_reason              text,
  notes                     text,
  archived                  boolean NOT NULL DEFAULT false,
  created_at                timestamptz NOT NULL DEFAULT now(),
  updated_at                timestamptz NOT NULL DEFAULT now()
);

-- Tag unique only when present. Allows multiple untagged calves simultaneously.
CREATE UNIQUE INDEX IF NOT EXISTS idx_cattle_tag_unique ON cattle(tag) WHERE tag IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_cattle_herd ON cattle(herd);
CREATE INDEX IF NOT EXISTS idx_cattle_dam ON cattle(dam_tag);
CREATE INDEX IF NOT EXISTS idx_cattle_processing_batch ON cattle(processing_batch_id);

ALTER TABLE cattle ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS cattle_anon_select ON cattle;
-- Public weigh-in webform needs to read tag lists. SELECT only — no anon writes.
CREATE POLICY cattle_anon_select ON cattle FOR SELECT USING (true);

DROP POLICY IF EXISTS cattle_auth_all ON cattle;
CREATE POLICY cattle_auth_all ON cattle FOR ALL
  TO authenticated USING (true) WITH CHECK (true);


-- ===== 3.7  cattle_calving_records ===========================================
CREATE TABLE IF NOT EXISTS cattle_calving_records (
  id                  text PRIMARY KEY,
  dam_tag             text NOT NULL,
  calving_date        date NOT NULL,
  calf_tag            text,
  calf_id             text REFERENCES cattle(id) ON DELETE SET NULL,
  sire_tag            text,
  cycle_id            text,
  total_born          int NOT NULL DEFAULT 0,
  deaths              int NOT NULL DEFAULT 0,
  complications_flag  boolean NOT NULL DEFAULT false,
  complications_desc  text,
  notes               text,
  created_at          timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_calving_dam ON cattle_calving_records(dam_tag);
CREATE INDEX IF NOT EXISTS idx_calving_cycle ON cattle_calving_records(cycle_id);
CREATE INDEX IF NOT EXISTS idx_calving_date ON cattle_calving_records(calving_date DESC);

ALTER TABLE cattle_calving_records ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS calving_auth_all ON cattle_calving_records;
CREATE POLICY calving_auth_all ON cattle_calving_records FOR ALL
  TO authenticated USING (true) WITH CHECK (true);


-- ===== 3.8  cattle_breeding_cycles ===========================================
CREATE TABLE IF NOT EXISTS cattle_breeding_cycles (
  id                    text PRIMARY KEY,
  herd                  text NOT NULL,
  bull_exposure_start   date NOT NULL,
  bull_tags             text,
  cow_tags              text,
  notes                 text,
  created_at            timestamptz NOT NULL DEFAULT now()
);

-- Downstream dates (bull_exposure_end, preg_check_date, calving_window_start/end, weaning_date)
-- are computed client-side from bull_exposure_start + constants (65d, 30d, 9mo, 65d, 7mo).
-- See CATTLE_DESIGN.md §3.8. Stored here only if user overrides.

CREATE INDEX IF NOT EXISTS idx_breeding_cycles_start ON cattle_breeding_cycles(bull_exposure_start DESC);
CREATE INDEX IF NOT EXISTS idx_breeding_cycles_herd ON cattle_breeding_cycles(herd);

ALTER TABLE cattle_breeding_cycles ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS breeding_cycles_auth_all ON cattle_breeding_cycles;
CREATE POLICY breeding_cycles_auth_all ON cattle_breeding_cycles FOR ALL
  TO authenticated USING (true) WITH CHECK (true);


-- ===== 3.9  cattle_processing_batches ========================================
CREATE TABLE IF NOT EXISTS cattle_processing_batches (
  id                      text PRIMARY KEY,
  name                    text NOT NULL UNIQUE,
  planned_process_date    date,
  actual_process_date     date,
  total_hanging_weight    numeric,
  processing_cost         numeric,
  documents               jsonb NOT NULL DEFAULT '[]'::jsonb,
  notes                   text,
  status                  text NOT NULL DEFAULT 'planned' CHECK (status IN ('planned','complete')),
  created_at              timestamptz NOT NULL DEFAULT now(),
  updated_at              timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_processing_batches_status ON cattle_processing_batches(status);

ALTER TABLE cattle_processing_batches ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS processing_batches_auth_all ON cattle_processing_batches;
CREATE POLICY processing_batches_auth_all ON cattle_processing_batches FOR ALL
  TO authenticated USING (true) WITH CHECK (true);

-- Back-reference FK from cattle → processing batches (added here so table ordering works)
ALTER TABLE cattle
  DROP CONSTRAINT IF EXISTS cattle_processing_batch_fk;
ALTER TABLE cattle
  ADD CONSTRAINT cattle_processing_batch_fk
  FOREIGN KEY (processing_batch_id) REFERENCES cattle_processing_batches(id) ON DELETE SET NULL;


-- ===== 3.10  cattle_transfers ================================================
CREATE TABLE IF NOT EXISTS cattle_transfers (
  id                  text PRIMARY KEY,
  cattle_id           text NOT NULL REFERENCES cattle(id) ON DELETE CASCADE,
  from_herd           text,
  to_herd             text NOT NULL,
  reason              text NOT NULL,  -- manual | processing_batch | death | sale | weaned_from_mom | etc.
  reference_id        text,
  team_member         text,
  transferred_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_cattle_transfers_cow ON cattle_transfers(cattle_id, transferred_at DESC);

ALTER TABLE cattle_transfers ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS cattle_transfers_auth_insert ON cattle_transfers;
CREATE POLICY cattle_transfers_auth_insert ON cattle_transfers FOR INSERT
  TO authenticated WITH CHECK (true);

DROP POLICY IF EXISTS cattle_transfers_auth_select ON cattle_transfers;
CREATE POLICY cattle_transfers_auth_select ON cattle_transfers FOR SELECT
  TO authenticated USING (true);

-- No UPDATE/DELETE policies — audit log is append-only.


-- ===== 3.11  Storage buckets =================================================
-- Run these via Supabase Studio → Storage UI or the storage API since bucket
-- creation via SQL requires the storage extension. Included here for reference:
--
--   INSERT INTO storage.buckets (id, name, public)
--   VALUES
--     ('cattle-feed-pdfs', 'cattle-feed-pdfs', true),
--     ('cattle-directory-docs', 'cattle-directory-docs', true)
--   ON CONFLICT (id) DO NOTHING;
--
-- Then add storage policies to allow authenticated uploads/deletes and public reads,
-- matching the existing `batch-documents` bucket configuration.


-- ===== updated_at auto-touch triggers ========================================
CREATE OR REPLACE FUNCTION cattle_touch_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS cattle_feed_inputs_touch ON cattle_feed_inputs;
CREATE TRIGGER cattle_feed_inputs_touch BEFORE UPDATE ON cattle_feed_inputs
  FOR EACH ROW EXECUTE FUNCTION cattle_touch_updated_at();

DROP TRIGGER IF EXISTS cattle_touch ON cattle;
CREATE TRIGGER cattle_touch BEFORE UPDATE ON cattle
  FOR EACH ROW EXECUTE FUNCTION cattle_touch_updated_at();

DROP TRIGGER IF EXISTS cattle_processing_batches_touch ON cattle_processing_batches;
CREATE TRIGGER cattle_processing_batches_touch BEFORE UPDATE ON cattle_processing_batches
  FOR EACH ROW EXECUTE FUNCTION cattle_touch_updated_at();


-- ===== Seed: initial feed inputs =============================================
-- These can be created via the admin UI once built, but seeding here so the
-- webform dropdowns have something to show immediately after migration.
-- Nutrition values come from the Dairy One test PDFs on file as of 2025-08.
-- Costs are placeholders — admin should set real values in the Feed panel.

INSERT INTO cattle_feed_inputs
  (id, name, category, unit, unit_weight_lbs, moisture_pct, nfc_pct, protein_pct, herd_scope)
VALUES
  ('rye-baleage',        'Rye Baleage',         'hay',     'bale', 1500,  50.5, 17.7, 16.6, ARRAY['mommas','backgrounders','finishers','bulls']),
  ('alfalfa-hay',        'Alfalfa Hay',         'hay',     'bale', NULL,  NULL, NULL, NULL, ARRAY['mommas','backgrounders','finishers','bulls']),
  ('clover-hay',         'Clover Hay',          'hay',     'bale', NULL,  NULL, NULL, NULL, ARRAY['mommas','backgrounders','finishers','bulls']),
  ('alfalfa-pellets',    'Alfalfa Pellets',     'pellet',  'lb',   1,     NULL, NULL, NULL, ARRAY['bulls','mommas']),
  ('citrus-pellets',     'Citrus Pellets',      'pellet',  'lb',   1,     7.7,  58.6, 6.7,  ARRAY['backgrounders','finishers','mommas']),
  ('molasses',           'Molasses',            'liquid',  'tub',  2975,  NULL, NULL, NULL, ARRAY['mommas','finishers']),
  ('sugar',              'Sugar',               'other',   'lb',   1,     NULL, NULL, NULL, ARRAY['mommas']),
  ('salt',               'Salt',                'mineral', 'lb',   1,     NULL, NULL, NULL, ARRAY['mommas','backgrounders','finishers','bulls']),
  ('bicarb',             'Bicarb',              'mineral', 'lb',   1,     NULL, NULL, NULL, ARRAY['mommas','backgrounders','finishers','bulls']),
  ('conditioner',        'Conditioner',         'mineral', 'lb',   1,     NULL, NULL, NULL, ARRAY['mommas','backgrounders','finishers','bulls']),
  ('calcium',            'Calcium',             'mineral', 'lb',   1,     NULL, NULL, NULL, ARRAY['mommas','backgrounders','finishers','bulls']),
  ('biochar',            'Biochar',             'mineral', 'lb',   1,     NULL, NULL, NULL, ARRAY['mommas','backgrounders','finishers','bulls']),
  ('colostrum',          'Colostrum Supplement','mineral', 'lb',   1,     NULL, NULL, NULL, ARRAY['mommas','backgrounders','finishers','bulls'])
ON CONFLICT (id) DO NOTHING;


-- ============================================================================
-- END cattle module migration
-- ============================================================================
