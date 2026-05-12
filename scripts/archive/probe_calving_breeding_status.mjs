// ============================================================================
// probe_calving_breeding_status.mjs — TEST-ONLY mig 044 applier.
// ============================================================================
// Applies supabase-migrations/044_cattle_calving_breeding_status.sql to the
// TEST database via the service-role exec_sql RPC. Mig 044 extends mig 032's
// trigger to also flip breeding_status PREGNANT → OPEN on calving insert and
// to backfill existing pregnant cows that already have calving records.
//
// Same guard pattern as probe_forecast_tables.mjs: WCF_TEST_DATABASE=1 +
// assertTestDatabase() + service-role key. NEVER run against production.
// ============================================================================

import {createClient} from '@supabase/supabase-js';
import {readFileSync} from 'node:fs';
import {assertTestDatabase} from '../tests/setup/assertTestDatabase.js';

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
for (const k of Object.keys(env)) {
  if (process.env[k] === undefined) process.env[k] = env[k];
}

if (!env.VITE_SUPABASE_URL) {
  throw new Error('probe_calving_breeding_status: VITE_SUPABASE_URL missing from .env.test/.env.test.local.');
}
if (!env.SUPABASE_SERVICE_ROLE_KEY) {
  throw new Error('probe_calving_breeding_status: SUPABASE_SERVICE_ROLE_KEY missing from .env.test.local.');
}
assertTestDatabase(env.VITE_SUPABASE_URL);

const sb = createClient(env.VITE_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {auth: {persistSession: false}});

let sql = readFileSync('supabase-migrations/044_cattle_calving_breeding_status.sql', 'utf8');
sql = sql.replace(/^\s*BEGIN\s*;\s*$/im, '').replace(/^\s*COMMIT\s*;\s*$/im, '');
const r = await sb.rpc('exec_sql', {sql});
if (r.error) console.log('mig 044 apply →', r.error.code, ':', r.error.message);
else console.log('mig 044 apply → ok');

await sb.rpc('exec_sql', {sql: "NOTIFY pgrst, 'reload schema'"});
await new Promise((r2) => setTimeout(r2, 2000));
console.log('mig 044 → trigger function replaced + backfill executed.');
