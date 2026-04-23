-- ============================================================================
-- Migration 017: Equipment DEF tracking + per-fueling DEF gallons
-- ----------------------------------------------------------------------------
-- Splits DEF from fuel_type so it's a *separate* consumable on applicable
-- diesel machines (C362, PS100, Gyro-Trac, JD Gator, JD 317, JD 333, Kubota
-- RTV, Polaris Ranger). Everything else (all gas + Gehl / L328 / 5065 / Mini
-- Ex on the diesel side) does NOT take DEF, so the field stays hidden for
-- those on the webform.
--
-- fuel_type stays on equipment (hardcoded per piece, not inferred).
--
-- Apply AFTER migration 016 and its import. Re-run scripts/import_equipment.cjs
-- --commit after to populate takes_def + cleaned service_intervals.
-- ============================================================================

ALTER TABLE equipment
  ADD COLUMN IF NOT EXISTS takes_def BOOLEAN NOT NULL DEFAULT FALSE;

ALTER TABLE equipment_fuelings
  ADD COLUMN IF NOT EXISTS def_gallons NUMERIC;
