-- ============================================================================
-- Migration 016: Equipment module
-- ----------------------------------------------------------------------------
-- Three new tables + profiles.role extension + maintenance-photos storage
-- bucket + RLS policies. Replaces the Podio "WCF - Equipment" workspace
-- (17 apps: Equipment Maintenance master + Fuel Log + 15 per-equipment
-- fueling checklists) with a normalized schema that works for both the
-- admin UI at /equipment/* and the public /fueling/* webforms.
--
-- Apply BEFORE running scripts/import_equipment.cjs.
--
-- Summary:
--   equipment                      — master registry (20+ rows)
--   equipment_fuelings             — every fill-up + service-interval tick
--                                    (replaces Fuel Log + 15 checklist apps)
--   equipment_maintenance_events   — repairs / inspections / notes, with
--                                    photos uploaded to the maintenance
--                                    docs Storage bucket
--   profiles.role                  — new 'equipment_tech' role value
--   storage.buckets                — 'equipment-maintenance-docs' bucket
-- ============================================================================

-- Equipment master registry ---------------------------------------------------
CREATE TABLE IF NOT EXISTS equipment (
  id                      TEXT PRIMARY KEY,
  podio_item_id           BIGINT UNIQUE,
  name                    TEXT NOT NULL,
  slug                    TEXT UNIQUE NOT NULL,      -- e.g. 'c362', 'honda-atv-1'
  category                TEXT NOT NULL,             -- 'tractors'|'atvs'|'hijets'|'mowers'|'skidsteers'|'forestry'
  parent_equipment_id     TEXT REFERENCES equipment(id) ON DELETE SET NULL,
  status                  TEXT NOT NULL DEFAULT 'active',  -- 'active'|'retired'|'in-shop'
  serial_number           TEXT,
  fuel_type               TEXT,                      -- 'diesel'|'gasoline'|'def'
  fuel_tank_gal           NUMERIC,
  def_tank_gal            NUMERIC,
  tracking_unit           TEXT NOT NULL DEFAULT 'hours' CHECK (tracking_unit IN ('hours','km')),
  current_hours           NUMERIC,
  current_km              NUMERIC,
  -- Fluid / filter spec values. Free text matches Podio's original schema.
  engine_oil              TEXT,
  oil_filter              TEXT,
  hydraulic_oil           TEXT,
  hydraulic_filter        TEXT,
  coolant                 TEXT,
  brake_fluid             TEXT,
  fuel_filter             TEXT,
  def_filter              TEXT,
  gearbox_drive_oil       TEXT,
  air_filters             TEXT,
  warranty_description    TEXT,
  warranty_expiration     DATE,
  -- [{hours_or_km:50,label:'50hr check',kind:'hours'},{hours_or_km:100,label:'100hr check',kind:'hours'},...]
  -- Seeded from the Podio checklist categories for each equipment. Admin
  -- can add/edit via the admin panel. Drives the service-due calculator.
  service_intervals       JSONB NOT NULL DEFAULT '[]'::jsonb,
  -- [{id:'oil',label:'Oil level OK'},{id:'water',label:'Water level OK'}] — the
  -- visual checks the team does at every fuel fill-up. Seeded per equipment.
  every_fillup_items      JSONB NOT NULL DEFAULT '[]'::jsonb,
  notes                   TEXT,
  created_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at              TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_equipment_category ON equipment(category);
CREATE INDEX IF NOT EXISTS idx_equipment_status ON equipment(status);
CREATE INDEX IF NOT EXISTS idx_equipment_parent ON equipment(parent_equipment_id) WHERE parent_equipment_id IS NOT NULL;

-- Equipment fueling + checklist log ------------------------------------------
CREATE TABLE IF NOT EXISTS equipment_fuelings (
  id                         TEXT PRIMARY KEY,
  podio_item_id              BIGINT,
  podio_source_app           TEXT,                   -- 'fuel_log'|'checklist_ps100'|'checklist_c362'|...
  equipment_id               TEXT NOT NULL REFERENCES equipment(id) ON DELETE CASCADE,
  date                       DATE NOT NULL,
  team_member                TEXT,
  fuel_type                  TEXT,                   -- 'diesel'|'gasoline'|'def'|null (for check-only entries)
  gallons                    NUMERIC,
  fuel_cost_per_gal          NUMERIC,                -- nullable; backfilled from future bill-parser
  hours_reading              NUMERIC,
  km_reading                 NUMERIC,
  -- Array of visual-check results: [{id:'oil',ok:true},{id:'water',ok:false,note:'low'}]
  every_fillup_check         JSONB NOT NULL DEFAULT '[]'::jsonb,
  -- Intervals ticked on this entry: [{interval:500,kind:'hours',label:'500hr check',completed_at:'2026-04-21'}]
  service_intervals_completed JSONB NOT NULL DEFAULT '[]'::jsonb,
  comments                   TEXT,
  source                     TEXT,                   -- 'fuel_log_webform'|'checklist_webform'|'admin_add'|'podio_import'
  submitted_at               TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_equipment_fuelings_eq_date ON equipment_fuelings(equipment_id, date DESC);
CREATE INDEX IF NOT EXISTS idx_equipment_fuelings_podio ON equipment_fuelings(podio_item_id) WHERE podio_item_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_equipment_fuelings_date ON equipment_fuelings(date DESC);

-- Equipment maintenance events (ad-hoc repairs / service / inspections) -------
CREATE TABLE IF NOT EXISTS equipment_maintenance_events (
  id                 TEXT PRIMARY KEY,
  equipment_id       TEXT NOT NULL REFERENCES equipment(id) ON DELETE CASCADE,
  event_date         DATE NOT NULL,
  event_type         TEXT CHECK (event_type IN ('repair','service','inspection','other')),
  title              TEXT,
  description        TEXT,
  cost               NUMERIC,
  hours_at_event     NUMERIC,
  -- [{name:'receipt.jpg',url:'https://.../receipt.jpg',uploadedAt:'2026-04-23T10:00:00Z'}]
  photos             JSONB NOT NULL DEFAULT '[]'::jsonb,
  team_member        TEXT,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_equipment_maintenance_eq_date ON equipment_maintenance_events(equipment_id, event_date DESC);

-- profiles.role: add 'equipment_tech' to the allowed values -------------------
-- Existing roles: farm_team / management / admin / inactive. New: equipment_tech.
DO $$
BEGIN
  -- The CHECK constraint name varies by environment; catch either.
  BEGIN
    ALTER TABLE profiles DROP CONSTRAINT IF EXISTS profiles_role_check;
  EXCEPTION WHEN undefined_object THEN NULL;
  END;
END$$;

ALTER TABLE profiles
  ADD CONSTRAINT profiles_role_check
  CHECK (role IN ('farm_team','management','admin','inactive','equipment_tech'));

-- Storage bucket for maintenance-event photos --------------------------------
-- Public-readable so photo URLs can be served directly; only authenticated
-- users can write. Mirrors how 'batch-documents' is configured.
INSERT INTO storage.buckets (id, name, public)
VALUES ('equipment-maintenance-docs', 'equipment-maintenance-docs', true)
ON CONFLICT (id) DO NOTHING;

-- RLS --- authenticated users can read/write equipment tables. Anon can
-- insert fueling entries (the public /fueling webform). No anon DELETE / UPDATE
-- on any equipment table.
ALTER TABLE equipment                     ENABLE ROW LEVEL SECURITY;
ALTER TABLE equipment_fuelings            ENABLE ROW LEVEL SECURITY;
ALTER TABLE equipment_maintenance_events  ENABLE ROW LEVEL SECURITY;

-- equipment: authenticated all-access
DROP POLICY IF EXISTS equipment_auth_all ON equipment;
CREATE POLICY equipment_auth_all ON equipment
  FOR ALL TO authenticated USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS equipment_anon_read ON equipment;
CREATE POLICY equipment_anon_read ON equipment
  FOR SELECT TO anon USING (true);

-- equipment_fuelings: authenticated all-access + anon insert (for webform)
DROP POLICY IF EXISTS equipment_fuelings_auth_all ON equipment_fuelings;
CREATE POLICY equipment_fuelings_auth_all ON equipment_fuelings
  FOR ALL TO authenticated USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS equipment_fuelings_anon_read ON equipment_fuelings;
CREATE POLICY equipment_fuelings_anon_read ON equipment_fuelings
  FOR SELECT TO anon USING (true);
DROP POLICY IF EXISTS equipment_fuelings_anon_insert ON equipment_fuelings;
CREATE POLICY equipment_fuelings_anon_insert ON equipment_fuelings
  FOR INSERT TO anon WITH CHECK (true);

-- equipment_maintenance_events: authenticated only (these include photos + cost)
DROP POLICY IF EXISTS equipment_maintenance_auth_all ON equipment_maintenance_events;
CREATE POLICY equipment_maintenance_auth_all ON equipment_maintenance_events
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- Storage bucket policies: authenticated can upload, anon can read (photos
-- are public-served). No anon write.
DROP POLICY IF EXISTS equipment_docs_read ON storage.objects;
CREATE POLICY equipment_docs_read ON storage.objects
  FOR SELECT TO anon, authenticated
  USING (bucket_id = 'equipment-maintenance-docs');
DROP POLICY IF EXISTS equipment_docs_write ON storage.objects;
CREATE POLICY equipment_docs_write ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'equipment-maintenance-docs');
DROP POLICY IF EXISTS equipment_docs_update ON storage.objects;
CREATE POLICY equipment_docs_update ON storage.objects
  FOR UPDATE TO authenticated
  USING (bucket_id = 'equipment-maintenance-docs');
DROP POLICY IF EXISTS equipment_docs_delete ON storage.objects;
CREATE POLICY equipment_docs_delete ON storage.objects
  FOR DELETE TO authenticated
  USING (bucket_id = 'equipment-maintenance-docs');
