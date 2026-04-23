-- Podio stashed some help text on non-checklist fields:
--   Toro "Gallons of Gasoline" field → "Use 2.5 oz of Toro fuel conditioner…"
--   Gyro-Trac Date field description → rotor bearings / radiator fins /
--     tracks that need attention MORE often than fuel fill-ups (between-fillup
--     maintenance guidance).
-- Previous parser only scanned category fields; these two slipped through.
ALTER TABLE equipment
  ADD COLUMN IF NOT EXISTS fuel_gallons_help TEXT,
  ADD COLUMN IF NOT EXISTS operator_notes    TEXT;
