// One-off: NOTIFY PostgREST to reload its schema cache after a runtime
// migration apply. Without this, anon clients see stale schema (the
// service-role bypasses the cache so it doesn't notice). Used after
// scripts/apply_test_offline_migrations.cjs only — remove once Phase 1B
// lands and the test bootstrap is fully resynced.

const fs = require('fs');
const path = require('path');

function loadEnvFile(p) {
  if (!fs.existsSync(p)) return;
  for (const line of fs.readFileSync(p, 'utf8').split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith('#')) continue;
    const eq = t.indexOf('=');
    if (eq < 0) continue;
    process.env[t.slice(0, eq).trim()] = t.slice(eq + 1).trim();
  }
}

loadEnvFile(path.resolve(__dirname, '..', '.env.test'));
loadEnvFile(path.resolve(__dirname, '..', '.env.test.local'));

const {createClient} = require('@supabase/supabase-js');

(async () => {
  const sb = createClient(process.env.VITE_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
  const {error} = await sb.rpc('exec_sql', {sql: "NOTIFY pgrst, 'reload schema';"});
  console.log(error ? 'fail: ' + JSON.stringify(error) : 'schema reload notified');
})();
