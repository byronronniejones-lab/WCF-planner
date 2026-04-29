import {test, expect} from './fixtures.js';
import {createClient} from '@supabase/supabase-js';

// ============================================================================
// Initiative C Phase 1B dedup spec — client_submission_id idempotency
// ============================================================================
// Locks two layers of the idempotency contract:
//
//   A. Schema layer (service-role): the unique index on
//      fuel_supplies.client_submission_id correctly rejects duplicate keys
//      under both raw INSERT and PostgREST upsert. Locks the mig 030
//      contract regardless of replay surface.
//
//   B. Anon layer (the path the hook actually takes in production):
//      anon INSERT with a duplicate csid raises 23505 referencing the
//      client_submission_id constraint. The hook (useOfflineSubmit.js)
//      treats this exact error shape as 'synced'. Locking the error code
//      AND the constraint-name fragment guards against future schema
//      drift (e.g. someone renames the index without updating the regex).
//
//      Anon CANNOT use upsert + onConflict — PostgREST's ON CONFLICT path
//      requires SELECT privilege on the conflict target column, and the
//      public webform RLS only grants anon INSERT. This is documented
//      inline in useOfflineSubmit.js + locked here as a regression test.
//
// 4 tests:
//   1  service-role upsert: same csid → 1 row + ignoreDuplicates returns []
//   2  service-role distinct csids → distinct rows
//   3  service-role legacy nulls coexist (NULLS DISTINCT lock for mig 030)
//   4  ANON insert: duplicate csid raises 23505 with client_submission_id
//      in the message. Anon's upsert path is also confirmed to fail with
//      RLS — locks the negative case.
// ============================================================================

const baseRecord = {
  date: '2026-04-29',
  gallons: 12.5,
  fuel_type: 'diesel',
  destination: 'gas_can',
  team_member: 'BMAN',
  notes: null,
  source: 'webform',
};

function recWithCsid(csid, overrides = {}) {
  return {
    id: `fs-${csid}`,
    client_submission_id: csid,
    ...baseRecord,
    ...overrides,
  };
}

// --------------------------------------------------------------------------
// Test 1 — service-role upsert: same csid → 1 row
// --------------------------------------------------------------------------
test('service-role upsert with same csid collapses to one row', async ({supabaseAdmin, resetDb}) => {
  await resetDb();
  const csid = 'csid-dedup-001';

  const r1 = await supabaseAdmin
    .from('fuel_supplies')
    .upsert(recWithCsid(csid), {onConflict: 'client_submission_id', ignoreDuplicates: true})
    .select();
  expect(r1.error).toBeNull();

  const r2 = await supabaseAdmin
    .from('fuel_supplies')
    .upsert(recWithCsid(csid, {gallons: 999}), {onConflict: 'client_submission_id', ignoreDuplicates: true})
    .select();
  expect(r2.error).toBeNull();
  // ignoreDuplicates returns 0 rows on a no-op.
  expect(Array.isArray(r2.data)).toBe(true);
  expect(r2.data).toHaveLength(0);

  const {data, error} = await supabaseAdmin.from('fuel_supplies').select('*').eq('client_submission_id', csid);
  expect(error).toBeNull();
  expect(data).toHaveLength(1);
  expect(data[0].gallons).toBe(12.5); // first write wins
});

// --------------------------------------------------------------------------
// Test 2 — distinct csids → distinct rows (negative lock)
// --------------------------------------------------------------------------
test('different csids produce distinct rows (uniqueness not short-circuited)', async ({supabaseAdmin, resetDb}) => {
  await resetDb();

  const a = await supabaseAdmin
    .from('fuel_supplies')
    .upsert(recWithCsid('csid-A'), {onConflict: 'client_submission_id', ignoreDuplicates: true})
    .select();
  expect(a.error).toBeNull();

  const b = await supabaseAdmin
    .from('fuel_supplies')
    .upsert(recWithCsid('csid-B'), {onConflict: 'client_submission_id', ignoreDuplicates: true})
    .select();
  expect(b.error).toBeNull();

  const {data, error} = await supabaseAdmin
    .from('fuel_supplies')
    .select('client_submission_id')
    .in('client_submission_id', ['csid-A', 'csid-B']);
  expect(error).toBeNull();
  expect(data.map((r) => r.client_submission_id).sort()).toEqual(['csid-A', 'csid-B']);
});

// --------------------------------------------------------------------------
// Test 3 — multiple null csids coexist (NULLS DISTINCT — locks why the
// index was made non-partial in migration 030)
// --------------------------------------------------------------------------
test('legacy null client_submission_ids do NOT trigger uniqueness conflict', async ({supabaseAdmin, resetDb}) => {
  await resetDb();

  const a = await supabaseAdmin.from('fuel_supplies').insert({
    id: 'fs-legacy-1',
    ...baseRecord,
  });
  expect(a.error).toBeNull();

  const b = await supabaseAdmin.from('fuel_supplies').insert({
    id: 'fs-legacy-2',
    ...baseRecord,
  });
  expect(b.error).toBeNull();

  const {data, error} = await supabaseAdmin.from('fuel_supplies').select('id, client_submission_id');
  expect(error).toBeNull();
  expect(data).toHaveLength(2);
  expect(data.every((r) => r.client_submission_id === null)).toBe(true);
});

// --------------------------------------------------------------------------
// Test 4 — ANON insert dedup path (locks the production hook contract)
// --------------------------------------------------------------------------
test('anon insert duplicate raises 23505 referencing client_submission_id', async ({supabaseAdmin, resetDb}) => {
  await resetDb();
  const csid = 'csid-anon-dup';
  const url = process.env.VITE_SUPABASE_URL;
  const anonKey = process.env.VITE_SUPABASE_ANON_KEY;
  const anon = createClient(url, anonKey, {auth: {autoRefreshToken: false, persistSession: false}});

  // First anon insert: succeeds.
  const r1 = await anon.from('fuel_supplies').insert(recWithCsid(csid));
  expect(r1.error).toBeNull();

  // Second anon insert with same csid: raises 23505 + the constraint name
  // fragment the hook regex matches.
  const r2 = await anon.from('fuel_supplies').insert(recWithCsid(csid, {id: `${recWithCsid(csid).id}-b`}));
  expect(r2.error).not.toBeNull();
  expect(String(r2.error.code)).toBe('23505');
  expect(r2.error.message).toMatch(/client_submission_id/i);

  // Confirm only one row landed.
  const {data, error} = await supabaseAdmin.from('fuel_supplies').select('*').eq('client_submission_id', csid);
  expect(error).toBeNull();
  expect(data).toHaveLength(1);

  // Negative lock: anon CANNOT use upsert + onConflict (RLS denies because
  // PostgREST's ON CONFLICT path requires SELECT privilege on the conflict
  // target). Locks the design decision in useOfflineSubmit.js.
  const r3 = await anon
    .from('fuel_supplies')
    .upsert(recWithCsid('csid-anon-upsert'), {onConflict: 'client_submission_id', ignoreDuplicates: true});
  expect(r3.error).not.toBeNull();
  expect(String(r3.error.code)).toBe('42501');
});
