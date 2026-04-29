// Applier for migration 030 (offline queue schema contracts) against the
// test Supabase project. Reads .env.test + .env.test.local and uses
// service_role + public.exec_sql to run the SQL. Idempotent (the
// migration itself guards with IF NOT EXISTS).
//
// LIMITATION — migration 031 (daily-photos bucket) is NOT applied here.
// 031 wraps its policy creation in DO blocks containing IF NOT EXISTS
// subqueries, and Postgres refuses to EXECUTE those constructs from
// inside the exec_sql function body ("syntax error at or near 'IF'"
// during EXECUTE binding). Apply 031 manually via the Supabase SQL
// Editor against the test project, or via the standard test-bootstrap
// regen + paste flow (scripts/build_test_bootstrap.js) when convenient.
// Phase 1B (FuelSupply canary) does not need the daily-photos bucket;
// Phase 2 will need it before photo capture wires up.
//
// Usage: node scripts/apply_test_offline_migrations.cjs

const fs = require('fs');
const path = require('path');

function loadEnvFile(p) {
  if (!fs.existsSync(p)) return;
  const text = fs.readFileSync(p, 'utf8');
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq < 0) continue;
    const k = trimmed.slice(0, eq).trim();
    let v = trimmed.slice(eq + 1).trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
      v = v.slice(1, -1);
    }
    process.env[k] = v;
  }
}

loadEnvFile(path.resolve(__dirname, '..', '.env.test'));
loadEnvFile(path.resolve(__dirname, '..', '.env.test.local'));

const {createClient} = require('@supabase/supabase-js');

(async () => {
  const url = process.env.VITE_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    console.error('Missing VITE_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
    process.exit(1);
  }
  if (process.env.WCF_TEST_DATABASE !== '1') {
    console.error('Refusing — WCF_TEST_DATABASE must be 1');
    process.exit(1);
  }
  if (url.includes('pzfujbjtayhkdlxiblwe')) {
    console.error('Refusing — URL matches PROD project ref');
    process.exit(1);
  }

  const sb = createClient(url, key, {auth: {autoRefreshToken: false, persistSession: false}});

  // Only 030 — see file header for why 031 is skipped.
  const file = '030_offline_queue_contracts.sql';
  const sqlPath = path.resolve(__dirname, '..', 'supabase-migrations', file);
  let sql = fs.readFileSync(sqlPath, 'utf8');
  // exec_sql() runs the SQL inside a function body; PostgreSQL refuses
  // EXECUTE of BEGIN/COMMIT in that context. Strip the outer transaction
  // boundary — the RPC call is itself a single statement.
  sql = sql.replace(/^\s*BEGIN\s*;?\s*$/gim, '').replace(/^\s*COMMIT\s*;?\s*$/gim, '');
  process.stdout.write(`applying ${file} ... `);
  const {error} = await sb.rpc('exec_sql', {sql});
  if (error) {
    console.error('FAILED');
    console.error(error);
    process.exit(1);
  }
  console.log('OK');
  console.log('NOTE: 031_daily_photos_bucket.sql was NOT applied — see file header.');
  console.log('done.');
})();
