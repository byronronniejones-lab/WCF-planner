-- ============================================================================
-- Migration 043: Cattle Forecast tab — settings + heifer-include + hidden +
--                processing-batch status enum simplification (planned -> active)
-- ----------------------------------------------------------------------------
-- DB-only build. Pairs with the new Cattle Forecast tab + reworked
-- Cattle Batches view + reworked Send-to-Processor flow. Adds:
--
--   1. Convert existing cattle_processing_batches.status='planned' rows to
--      'active'. Real DB batches going forward are only 'active' or 'complete'.
--      "Planned" batches are virtual/computed in the Forecast helper, not
--      stored. Sheep is intentionally untouched in this migration.
--   2. Replace the cattle_processing_batches_status_check CHECK constraint
--      with the new (active|complete) enum.
--   3. Create cattle_forecast_settings (singleton, keyed by id='global'):
--      target/display weight band, fallback ADG, birth-weight assumption,
--      horizon years, included-herds array.
--   4. Create cattle_forecast_heifer_includes (cattle_id PK FK to cattle):
--      explicit per-heifer inclusion list. Empty set is the default. Driven
--      by the "Include Momma Herd Heifers" modal in the Forecast view.
--   5. Create cattle_forecast_hidden (cattle_id + month_key composite PK,
--      cattle_id FK to cattle): per-cow per-month hide. Hidden cows do not
--      count in totals until unhidden or rolled forward via the helper.
--   6. RLS — match the cattle module pattern (authenticated full access).
--      Edit-permission tiering (management/admin vs farm_team) is enforced
--      in the UI, not the database, per the plan packet decision. Farm-team
--      can read all three tables for the read-only Forecast view.
--
-- DELIBERATELY NOT TOUCHED:
--   - sheep_processing_batches (status enum unchanged for sheep).
--   - cattle.old_tags shape, source-label workflow strings.
--   - cattle_transfers append-only audit policies.
--   - weigh_ins.* columns / send-to-processor flag semantics.
--   - cattle_processing_batches.cows_detail jsonb shape (still
--     [{cattle_id, tag, live_weight, hanging_weight}]).
--
-- Idempotent: every step is IF EXISTS / IF NOT EXISTS / DROP-then-create.
-- Safe to re-apply.
-- ============================================================================

BEGIN;

-- 1) Drop the old CHECK FIRST. Postgres evaluates CHECK constraints during
--    UPDATE, so the planned->active flip must happen with no CHECK in force.
--    Sheep mirror constraint stays untouched.
ALTER TABLE cattle_processing_batches
  DROP CONSTRAINT IF EXISTS cattle_processing_batches_status_check;

-- 2) Now safe to convert existing 'planned' rows to 'active'. No-op if the
--    migration has already run (the rows are already 'active').
UPDATE cattle_processing_batches
   SET status = 'active'
 WHERE status = 'planned';

-- 3) Add the new CHECK (active|complete only). Existing rows now satisfy it.
ALTER TABLE cattle_processing_batches
  ADD CONSTRAINT cattle_processing_batches_status_check
  CHECK (status IN ('active','complete'));

-- 4) Update DEFAULT so future inserts without status pick 'active'. Real
--    attaches go through the helper which sets it explicitly; this default
--    is a safety net.
ALTER TABLE cattle_processing_batches
  ALTER COLUMN status SET DEFAULT 'active';

-- 3) cattle_forecast_settings — singleton scenario controls.
CREATE TABLE IF NOT EXISTS cattle_forecast_settings (
  id                       text PRIMARY KEY DEFAULT 'global',
  display_weight_min       int     NOT NULL DEFAULT 1200,
  display_weight_max       int     NOT NULL DEFAULT 1500,
  fallback_adg_lb_per_day  numeric NOT NULL DEFAULT 1.18,
  birth_weight_lb          numeric NOT NULL DEFAULT 64,
  horizon_years            int     NOT NULL DEFAULT 3
                                   CHECK (horizon_years BETWEEN 1 AND 5),
  monthly_capacity         int,
  included_herds           text[]  NOT NULL DEFAULT
                                   ARRAY['finishers','backgrounders']::text[],
  updated_at               timestamptz NOT NULL DEFAULT now(),
  updated_by               text,
  CHECK (display_weight_min > 0 AND display_weight_max > display_weight_min)
);

-- Seed the singleton row if missing. ON CONFLICT keeps an admin-edited row.
INSERT INTO cattle_forecast_settings (id) VALUES ('global')
ON CONFLICT (id) DO NOTHING;

-- 4) cattle_forecast_heifer_includes — explicit per-heifer momma-herd inclusion.
--    Membership defaults to empty (heifers in mommas are excluded by default).
--    The "Include Momma Herd Heifers" modal in the Forecast view replaces
--    the entire row set on Confirm Selections.
CREATE TABLE IF NOT EXISTS cattle_forecast_heifer_includes (
  cattle_id   text PRIMARY KEY REFERENCES cattle(id) ON DELETE CASCADE,
  included_at timestamptz NOT NULL DEFAULT now(),
  included_by text,
  notes       text
);

-- 5) cattle_forecast_hidden — per-cow + per-month hide.
--    Composite PK so the same cow can be hidden in multiple months. Hidden
--    persists regardless of the cow's current herd; the helper applies the
--    hide unconditionally when computing month assignment.
CREATE TABLE IF NOT EXISTS cattle_forecast_hidden (
  cattle_id  text NOT NULL REFERENCES cattle(id) ON DELETE CASCADE,
  month_key  text NOT NULL CHECK (month_key ~ '^\d{4}-(0[1-9]|1[0-2])$'),
  hidden_at  timestamptz NOT NULL DEFAULT now(),
  hidden_by  text,
  PRIMARY KEY (cattle_id, month_key)
);

CREATE INDEX IF NOT EXISTS idx_cattle_forecast_hidden_month
  ON cattle_forecast_hidden(month_key);

-- 6) RLS — broad authenticated access on all three tables. Edit gates live
--    in the UI (management/admin only) per the plan packet; the database
--    grants the same surface to all authenticated cattle-program users so
--    the Forecast tab can read settings/includes/hidden for the read-only
--    farm_team view.
ALTER TABLE cattle_forecast_settings        ENABLE ROW LEVEL SECURITY;
ALTER TABLE cattle_forecast_heifer_includes ENABLE ROW LEVEL SECURITY;
ALTER TABLE cattle_forecast_hidden          ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS cfs_auth_all ON cattle_forecast_settings;
CREATE POLICY cfs_auth_all ON cattle_forecast_settings
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS cfh_auth_all ON cattle_forecast_heifer_includes;
CREATE POLICY cfh_auth_all ON cattle_forecast_heifer_includes
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS cfx_auth_all ON cattle_forecast_hidden;
CREATE POLICY cfx_auth_all ON cattle_forecast_hidden
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

COMMIT;
