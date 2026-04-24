-- Two related changes to fuel tracking:
--
-- 1. equipment_fuelings.suppressed — soft-delete flag. Rows with a
--    podio_source_app='fuel_log' (no matching per-equipment checklist entry)
--    were "naked" Fuel Log adds that Ronnie considers legacy noise. Setting
--    suppressed=true hides them from /equipment history + consumption
--    aggregates but keeps the row for audit. Reversible by clearing the flag.
--
-- 2. fuel_supplies table — tracks FUEL COMING ONTO THE FARM (portable fuel
--    cell deliveries, fuel-truck fills, gas cans filled at the pump, etc.).
--    Separate from equipment_fuelings so supply events never count as usage.
--    Operators log via a dedicated /fuel-supply webform.
--
-- Destination enum: 'cell' (the portable fuel cell dispenses to multiple
-- pieces), 'gas_can' (shop gas cans), 'farm_truck' (the farm pickup), 'direct'
-- (delivered straight to a piece — rare), 'other'.

ALTER TABLE equipment_fuelings
  ADD COLUMN IF NOT EXISTS suppressed BOOLEAN NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS idx_equipment_fuelings_suppressed
  ON equipment_fuelings (equipment_id, suppressed);

CREATE TABLE IF NOT EXISTS fuel_supplies (
  id             TEXT PRIMARY KEY,
  date           DATE NOT NULL,
  gallons        NUMERIC NOT NULL CHECK (gallons > 0),
  fuel_type      TEXT,
  supplier       TEXT,
  cost_per_gal   NUMERIC,
  total_cost     NUMERIC,
  destination    TEXT NOT NULL DEFAULT 'cell',
  team_member    TEXT,
  notes          TEXT,
  source         TEXT,               -- 'webform' | 'manual' | 'import'
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_fuel_supplies_date ON fuel_supplies (date DESC);
CREATE INDEX IF NOT EXISTS idx_fuel_supplies_destination ON fuel_supplies (destination);

-- Public anon access for the /fuel-supply webform to insert. Admin role
-- can read/edit/delete. Mirror the RLS pattern already in place for
-- equipment_fuelings (public insert, authenticated read).
ALTER TABLE fuel_supplies ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS fuel_supplies_public_insert ON fuel_supplies;
CREATE POLICY fuel_supplies_public_insert ON fuel_supplies FOR INSERT TO anon WITH CHECK (true);

DROP POLICY IF EXISTS fuel_supplies_auth_select ON fuel_supplies;
CREATE POLICY fuel_supplies_auth_select ON fuel_supplies FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS fuel_supplies_auth_update ON fuel_supplies;
CREATE POLICY fuel_supplies_auth_update ON fuel_supplies FOR UPDATE TO authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS fuel_supplies_auth_delete ON fuel_supplies;
CREATE POLICY fuel_supplies_auth_delete ON fuel_supplies FOR DELETE TO authenticated USING (true);
