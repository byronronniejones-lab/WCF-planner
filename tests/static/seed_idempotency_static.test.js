import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {describe, it, expect} from 'vitest';

// ── Suite-Wide Seed Idempotency CP1 ──────────────────────────────────────────
// The highest-risk fixed-ID Playwright scenario seeds must use upsert, not
// plain insert, so a shared-DB worker-restart race (Playwright spawns a fresh
// worker after any failure, which can land a stale row after the new worker's
// TRUNCATE) cannot trip duplicate-primary-key errors. upsert(onConflict:'id')
// overwrites any stale row into the exact intended state; ignoreDuplicates
// would leave a stale row's wrong columns in place, so it is NOT allowed.

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..', '..');

const SEED_FILES = [
  'tests/scenarios/cattle_processor_seed.js',
  'tests/scenarios/sheep_processor_seed.js',
  'tests/scenarios/cattle_herd_filters_seed.js',
  'tests/scenarios/cattle_soft_delete_seed.js',
  'tests/scenarios/admin_broiler_session_meta_seed.js',
  'tests/scenarios/broiler_timeline_seed.js',
  'tests/scenarios/fuel_reconcile_seed.js',
  'tests/scenarios/home_dashboard_equipment_seed.js',
  'tests/scenarios/p2601_seed.js',
];

describe('processor scenario seeds are idempotent (upsert, not insert)', () => {
  for (const rel of SEED_FILES) {
    const src = fs.readFileSync(path.join(ROOT, rel), 'utf8');

    it(`${rel} contains no plain .insert( calls`, () => {
      expect(src).not.toMatch(/\.insert\(/);
    });

    it(`${rel} writes rows via upsert(..., {onConflict: 'id'})`, () => {
      expect(src).toMatch(/\.upsert\(/);
      expect(src).toMatch(/onConflict:\s*'id'/);
    });

    it(`${rel} does not rely on ignoreDuplicates`, () => {
      expect(src).not.toMatch(/ignoreDuplicates/);
    });
  }
});

// ── CP2 fix — upsert payloads must clear known mutable stale state ────────────
// upsert only resets columns present in the payload; omitted nullable/mutable
// columns survive from a stale worker row. The seeds whose specs mutate those
// columns (soft-delete / restore, batch attachment, session completion, notes)
// must therefore seed the reset values explicitly so a re-seed produces the
// exact intended starting state, not a half-stale hybrid.
describe('CP2: upsert payloads reset known mutable stale columns', () => {
  const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

  for (const rel of ['tests/scenarios/cattle_soft_delete_seed.js', 'tests/scenarios/cattle_herd_filters_seed.js']) {
    const src = read(rel);
    it(`${rel} explicitly resets soft-delete + attachment columns on seeded cattle`, () => {
      expect(src).toMatch(/deleted_at:\s*null/);
      expect(src).toMatch(/deleted_by:\s*null/);
      expect(src).toMatch(/processing_batch_id:\s*null/);
    });
  }

  it('admin_broiler_session_meta_seed.js resets completed_at + notes on seeded sessions', () => {
    const src = read('tests/scenarios/admin_broiler_session_meta_seed.js');
    expect(src).toMatch(/completed_at:\s*null/);
    expect(src).toMatch(/notes:\s*null/);
  });
});

// ── CP3: fuel / equipment / pig seeds — unique slug + mutable-column resets ───
describe('CP3: upsert payloads reset known mutable stale columns', () => {
  const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

  it('home_dashboard_equipment_seed.js derives a UNIQUE per-kind slug from id (not a shared slug)', () => {
    const src = read('tests/scenarios/home_dashboard_equipment_seed.js');
    // equipment.slug is UNIQUE; a shared slug would 23505 under upsert-on-id.
    expect(src).toMatch(/const slug = id/);
    expect(src).not.toMatch(/'eq-attention-test'/);
  });

  it('home_dashboard_equipment_seed.js resets attention-trigger + fueling columns', () => {
    const src = read('tests/scenarios/home_dashboard_equipment_seed.js');
    expect(src).toMatch(/warranty_expiration:\s*null/);
    expect(src).toMatch(/service_intervals:\s*\[\]/);
    expect(src).toMatch(/every_fillup_items:\s*\[\]/);
    expect(src).toMatch(/service_intervals_completed:\s*\[\]/);
    expect(src).toMatch(/photos:\s*\[\]/);
  });

  it('fuel_reconcile_seed.js resets fueling + bill mutable columns', () => {
    const src = read('tests/scenarios/fuel_reconcile_seed.js');
    expect(src).toMatch(/parsed_data:\s*null/);
    expect(src).toMatch(/photos:\s*\[\]/);
    expect(src).toMatch(/podio_source_app:\s*null/);
    expect(src).toMatch(/client_submission_id:\s*null/);
  });

  it('p2601_seed.js resets pig Send-to-Trip / breeding / soft-delete columns', () => {
    const src = read('tests/scenarios/p2601_seed.js');
    expect(src).toMatch(/sent_to_trip_id:\s*null/);
    expect(src).toMatch(/sent_to_group_id:\s*null/);
    expect(src).toMatch(/transferred_to_breeding:\s*false/);
    expect(src).toMatch(/completed_at:\s*null/);
    expect(src).toMatch(/deleted_at:\s*null/);
  });
});
