-- Fuel bills + reconciliation. Admin enters / parses actual fuel-supplier
-- invoices (Home Oil etc.) so the planner can reconcile bill gallons against
-- fuel_supplies rows month by month.
--
-- Two tables (header + lines):
--   • fuel_bills       — one row per invoice (date, supplier, totals, PDF path)
--   • fuel_bill_lines  — one row per fuel-type line within an invoice
--
-- Tax handling: per-line tax is allocated proportionally by net gallons at
-- parse time and stored as effective_per_gal. Pre-tax fields (unit_price,
-- line_subtotal) are also stored so accountants can rebuild the breakdown
-- if needed.
--
-- Reconciliation grouping is by delivery_date month — that lines up with
-- when the operator logged the supply at /fueling/supply.
--
-- PDF storage: new admin-only `fuel-bills` bucket (authenticated read/write,
-- no anon) — these invoices contain financial info so they shouldn't share
-- the public-anon-write equipment-maintenance-docs bucket.

CREATE TABLE IF NOT EXISTS fuel_bills (
  id              TEXT PRIMARY KEY,
  supplier        TEXT,
  invoice_number  TEXT,
  invoice_date    DATE,
  delivery_date   DATE,
  bol_number      TEXT,
  subtotal        NUMERIC,                 -- pre-tax fuel cost
  tax_total       NUMERIC,                 -- itemized taxes from the bill
  total           NUMERIC NOT NULL,        -- bottom line invoice total
  pdf_path        TEXT,                    -- supabase storage path under fuel-bills/
  parsed_data     JSONB,                   -- raw parser output (for re-extract / audit)
  notes           TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_fuel_bills_invoice_date  ON fuel_bills (invoice_date DESC);
CREATE INDEX IF NOT EXISTS idx_fuel_bills_delivery_date ON fuel_bills (delivery_date DESC);
CREATE INDEX IF NOT EXISTS idx_fuel_bills_supplier      ON fuel_bills (supplier);

CREATE TABLE IF NOT EXISTS fuel_bill_lines (
  id                  TEXT PRIMARY KEY,
  bill_id             TEXT NOT NULL REFERENCES fuel_bills(id) ON DELETE CASCADE,
  description         TEXT,                -- raw line label, e.g. 'Nonethanol 87'
  fuel_type           TEXT,                -- canonical: 'gasoline' | 'diesel' | 'def'
  gross_units         NUMERIC,
  net_units           NUMERIC,             -- gallons (basis = Net on Home Oil format)
  unit_price          NUMERIC,             -- pre-tax $/gal as printed on bill
  line_subtotal       NUMERIC,             -- net_units * unit_price
  allocated_tax       NUMERIC,             -- proportional share of bill tax_total
  line_total          NUMERIC,             -- line_subtotal + allocated_tax (= effective $)
  effective_per_gal   NUMERIC,             -- line_total / net_units (all-in $/gal)
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_fuel_bill_lines_bill ON fuel_bill_lines (bill_id);
CREATE INDEX IF NOT EXISTS idx_fuel_bill_lines_type ON fuel_bill_lines (fuel_type);

-- RLS: admin-only access. No anon. Authenticated users (farm_team / management
-- / admin) can read; only admin should be writing. RLS doesn't differentiate
-- by role here — we restrict writes at the app layer (bills tab is in /admin
-- which is already admin-gated).
ALTER TABLE fuel_bills      ENABLE ROW LEVEL SECURITY;
ALTER TABLE fuel_bill_lines ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS fuel_bills_auth_select ON fuel_bills;
CREATE POLICY fuel_bills_auth_select ON fuel_bills FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS fuel_bills_auth_insert ON fuel_bills;
CREATE POLICY fuel_bills_auth_insert ON fuel_bills FOR INSERT TO authenticated WITH CHECK (true);
DROP POLICY IF EXISTS fuel_bills_auth_update ON fuel_bills;
CREATE POLICY fuel_bills_auth_update ON fuel_bills FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS fuel_bills_auth_delete ON fuel_bills;
CREATE POLICY fuel_bills_auth_delete ON fuel_bills FOR DELETE TO authenticated USING (true);

DROP POLICY IF EXISTS fuel_bill_lines_auth_select ON fuel_bill_lines;
CREATE POLICY fuel_bill_lines_auth_select ON fuel_bill_lines FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS fuel_bill_lines_auth_insert ON fuel_bill_lines;
CREATE POLICY fuel_bill_lines_auth_insert ON fuel_bill_lines FOR INSERT TO authenticated WITH CHECK (true);
DROP POLICY IF EXISTS fuel_bill_lines_auth_update ON fuel_bill_lines;
CREATE POLICY fuel_bill_lines_auth_update ON fuel_bill_lines FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS fuel_bill_lines_auth_delete ON fuel_bill_lines;
CREATE POLICY fuel_bill_lines_auth_delete ON fuel_bill_lines FOR DELETE TO authenticated USING (true);

-- Storage bucket: admin-only fuel-bills.
-- public=false means no anon read; authenticated users only.
INSERT INTO storage.buckets (id, name, public)
VALUES ('fuel-bills', 'fuel-bills', false)
ON CONFLICT (id) DO NOTHING;

DROP POLICY IF EXISTS fuel_bills_storage_read ON storage.objects;
CREATE POLICY fuel_bills_storage_read ON storage.objects
  FOR SELECT TO authenticated
  USING (bucket_id = 'fuel-bills');
DROP POLICY IF EXISTS fuel_bills_storage_write ON storage.objects;
CREATE POLICY fuel_bills_storage_write ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'fuel-bills');
DROP POLICY IF EXISTS fuel_bills_storage_update ON storage.objects;
CREATE POLICY fuel_bills_storage_update ON storage.objects
  FOR UPDATE TO authenticated
  USING (bucket_id = 'fuel-bills');
DROP POLICY IF EXISTS fuel_bills_storage_delete ON storage.objects;
CREATE POLICY fuel_bills_storage_delete ON storage.objects
  FOR DELETE TO authenticated
  USING (bucket_id = 'fuel-bills');
