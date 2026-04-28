import { createClient } from '@supabase/supabase-js';
import { assertTestDatabase } from './assertTestDatabase.js';

// ============================================================================
// Truncate test-owned tables. Called from per-spec beforeAll to reset state.
// ============================================================================
// HARD GUARDS (defense in depth):
//   1. assertTestDatabase() — refuses unless WCF_TEST_DATABASE=1 AND URL
//      doesn't match prod project ref.
//   2. Hardcoded TEST_OWNED_TABLES whitelist below — schema introspection
//      explicitly avoided. A new table cannot be truncated until added here.
//   3. Service role key required (not the anon key) — only set in
//      .env.test.local on a developer machine.
//
// TRUNCATE is executed via the public.exec_sql(text) function defined in the
// test project (see Phase A1 instructions). The function is SECURITY DEFINER
// + revoked from anon/authenticated/public so only service_role can call it.
// ============================================================================

const TEST_OWNED_TABLES = [
  // Children (FK to other test-owned tables) — truncate first via CASCADE.
  'cattle_comments',
  'cattle_calving_records',
  'cattle_feed_tests',
  'cattle_feed_inputs',
  'cattle_transfers',
  'sheep_lambing_records',
  'sheep_transfers',
  'weigh_ins',
  'weigh_in_sessions',
  'cattle_processing_batches',
  'sheep_processing_batches',
  'fuel_bill_lines',
  'fuel_bills',
  'equipment_maintenance_events',
  'equipment_fuelings',
  'fuel_supplies',
  // Parents.
  'cattle',
  'sheep',
  'cattle_dailys',
  'sheep_dailys',
  'pig_dailys',
  'poultry_dailys',
  'layer_dailys',
  'egg_dailys',
  'layer_housings',
  'layer_batches',
  'equipment',
  'app_store',
  'webform_config',
];
// NOT truncated:
//   profiles    — would orphan the test admin user; reseed manually if needed
//   auth.users  — never touched
//   storage.*   — buckets handled separately if/when a spec needs them

let cachedAdminClient = null;

export function getTestAdminClient() {
  if (cachedAdminClient) return cachedAdminClient;
  const url = process.env.VITE_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error(
      'getTestAdminClient: VITE_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY ' +
      'required in .env.test.local for test reset/seed operations.'
    );
  }
  assertTestDatabase(url);
  cachedAdminClient = createClient(url, key, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  return cachedAdminClient;
}

// Storage cleanup. Codex A8a originally suggested
//   DELETE FROM storage.objects WHERE bucket_id = 'fuel-bills'
// via exec_sql, but Supabase blocks direct DELETE on storage tables —
// the API returns "Direct deletion from storage tables is not allowed.
// Use the Storage API instead." So we recurse through the bucket and
// .remove() the file paths via the Storage API. Best-effort (warns on
// failure rather than aborting reset) since storage cruft is harmless
// across runs and shouldn't block other tests on transient issues.
async function cleanupFuelBillsStorage(client) {
  try {
    const top = await client.storage.from('fuel-bills').list();
    if (top.error || !top.data?.length) return;
    // Production layout is `fb-{id}/{filename}.pdf`. Recurse one level.
    for (const dir of top.data) {
      const inner = await client.storage.from('fuel-bills').list(dir.name);
      if (inner.data?.length) {
        const paths = inner.data.map((f) => `${dir.name}/${f.name}`);
        await client.storage.from('fuel-bills').remove(paths);
      }
    }
  } catch (e) {
    console.warn(`cleanupFuelBillsStorage: ${e.message || e} (tolerating)`);
  }
}

export async function resetTestDatabase() {
  assertTestDatabase(process.env.VITE_SUPABASE_URL || '');
  const client = getTestAdminClient();
  const tables = TEST_OWNED_TABLES.map((t) => `public."${t}"`).join(', ');
  const { error } = await client.rpc('exec_sql', {
    sql: `TRUNCATE TABLE ${tables} RESTART IDENTITY CASCADE;`,
  });
  if (error) {
    throw new Error(`resetTestDatabase: TRUNCATE failed: ${error.message}`);
  }
  await cleanupFuelBillsStorage(client);
}

export const _TEST_OWNED_TABLES = TEST_OWNED_TABLES;
