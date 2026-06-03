import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {describe, it, expect} from 'vitest';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..', '..');

const mig086 = fs.readFileSync(
  path.join(ROOT, 'supabase-migrations/086_equipment_maintenance_idempotency.sql'),
  'utf8',
);
const mig086Sql = mig086.replace(/--[^\n]*/g, ''); // strip comments for code-only assertions
const modal = fs.readFileSync(path.join(ROOT, 'src/equipment/EquipmentMaintenanceModal.jsx'), 'utf8');

describe('mig 086 — equipment maintenance idempotency', () => {
  it('adds a client_submission_id column to equipment_maintenance_events', () => {
    expect(mig086).toMatch(
      /ALTER TABLE IF EXISTS public\.equipment_maintenance_events\s+ADD COLUMN IF NOT EXISTS client_submission_id text/,
    );
  });

  it('creates a unique index on client_submission_id (idempotency, not date-uniqueness)', () => {
    expect(mig086).toMatch(
      /CREATE UNIQUE INDEX IF NOT EXISTS equipment_maintenance_events_client_submission_id_uq[\s\S]*?ON public\.equipment_maintenance_events \(client_submission_id\)/,
    );
    // Must NOT impose business date-uniqueness — multiple same-day events are legitimate.
    expect(mig086Sql).not.toMatch(/\(equipment_id,\s*event_date\)/);
  });

  it('reloads the PostgREST schema cache (client now writes the new column)', () => {
    expect(mig086).toContain("NOTIFY pgrst, 'reload schema'");
  });

  it('contains no transaction-control statements (applied via psql -1 / exec_sql-safe)', () => {
    expect(mig086).not.toMatch(/^\s*BEGIN\s*;/im);
    expect(mig086).not.toMatch(/^\s*COMMIT\s*;/im);
  });
});

describe('EquipmentMaintenanceModal — idempotent insert', () => {
  it('mints a stable client_submission_id per modal instance', () => {
    expect(modal).toContain("from '../lib/clientSubmissionId.js'");
    expect(modal).toMatch(/useRef\(newClientSubmissionId\(\)\)/);
  });

  it('sends client_submission_id on the new-event insert', () => {
    expect(modal).toMatch(/\.insert\(\{id, client_submission_id: csidRef\.current, \.\.\.rec\}\)/);
  });

  it('treats a duplicate client_submission_id as already-saved, not an error', () => {
    expect(modal).toMatch(/'23505'[\s\S]*?client_submission_id[\s\S]*?onSaved\(\)/);
  });
});
