// ============================================================================
// probe_forecast_tables.mjs — TEST-ONLY mig 043 applier + table probe.
// ============================================================================
// Why this exists: the Supabase SQL Editor truncated the mig 043 paste in at
// least one operator session, leaving the three forecast tables uncreated
// despite a "Success" toast. This script applies mig 043's BODY through the
// service-role exec_sql RPC (which is itself test-only — see scripts/build_
// test_bootstrap.js). Stripping BEGIN/COMMIT is required because exec_sql is
// already inside a function-level transaction (SQLSTATE 0A000 otherwise).
//
// HARD GUARDS (defense in depth, matching tests/setup/reset.js):
//   1. WCF_TEST_DATABASE === '1' — explicit operator opt-in.
//   2. assertTestDatabase() — Supabase URL must NOT contain the prod ref.
//   3. Service-role key required (anon key would 401 on exec_sql).
//
// NEVER run against production Supabase.
// ============================================================================

import {createClient} from '@supabase/supabase-js';
import {readFileSync} from 'node:fs';
import {assertTestDatabase} from '../tests/setup/assertTestDatabase.js';

// Load env from .env.test (committable) + .env.test.local (gitignored).
const env = {};
for (const path of ['.env.test', '.env.test.local']) {
  try {
    const lines = readFileSync(path, 'utf8').split(/\r?\n/);
    for (const l of lines) {
      const m = /^([A-Z_]+)=(.*)$/.exec(l.trim());
      if (m) env[m[1]] = m[2].replace(/^"|"$/g, '');
    }
  } catch {
    /* missing file is fine */
  }
}
// Mirror the loaded values into process.env so assertTestDatabase()'s
// WCF_TEST_DATABASE check sees them. Don't overwrite already-set process.env
// (so a CI invocation with explicit env can win).
for (const k of Object.keys(env)) {
  if (process.env[k] === undefined) process.env[k] = env[k];
}

if (!env.VITE_SUPABASE_URL) {
  throw new Error('probe_forecast_tables: VITE_SUPABASE_URL missing from .env.test/.env.test.local.');
}
if (!env.SUPABASE_SERVICE_ROLE_KEY) {
  throw new Error('probe_forecast_tables: SUPABASE_SERVICE_ROLE_KEY missing from .env.test.local.');
}
assertTestDatabase(env.VITE_SUPABASE_URL);

const sb = createClient(env.VITE_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {auth: {persistSession: false}});

// Apply mig 043 body directly via exec_sql. exec_sql is itself wrapped in a
// function-level transaction so BEGIN/COMMIT inside the body is rejected
// (SQLSTATE 0A000). Strip those and re-run.
let sql = readFileSync('supabase-migrations/043_cattle_forecast.sql', 'utf8');
sql = sql.replace(/^\s*BEGIN\s*;\s*$/im, '').replace(/^\s*COMMIT\s*;\s*$/im, '');
const r = await sb.rpc('exec_sql', {sql});
if (r.error) console.log('mig 043 apply →', r.error.code, ':', r.error.message);
else console.log('mig 043 apply → ok');

await sb.rpc('exec_sql', {sql: "NOTIFY pgrst, 'reload schema'"});
await new Promise((r2) => setTimeout(r2, 2000));

for (const t of ['cattle_forecast_settings', 'cattle_forecast_heifer_includes', 'cattle_forecast_hidden']) {
  const r2 = await sb.from(t).select('*', {count: 'exact', head: true});
  console.log(t, '→', r2.error ? 'ERR ' + r2.error.code + ': ' + r2.error.message : 'count=' + r2.count);
}
