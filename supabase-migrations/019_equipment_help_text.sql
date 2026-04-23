-- Podio field-level help text for the Every-Fillup checklist. Examples:
--   Honda ATVs: "Tire Pressure: 4.4 psi recommended."
--   Ventrac: "Lugnut torque: 120 ft-lbs."
-- Per-interval help_text is stored inside each service_intervals entry
-- (JSONB), so only this top-level fillup one needs a dedicated column.
ALTER TABLE equipment
  ADD COLUMN IF NOT EXISTS every_fillup_help TEXT;
