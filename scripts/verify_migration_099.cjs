// Verify migration 099 on the TEST Supabase project via an exec_sql DO-block
// assertion (RAISEs if the authenticated-INSERT policy is missing). Reads env
// from .env.test + .env.test.local. TEST-only (hard PROD guard).
//
// Usage:
//   node scripts/verify_migration_099.cjs

const fs = require('fs');
const path = require('path');

function loadDotEnv(file) {
  if (!fs.existsSync(file)) return;
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (!m) continue;
    let v = m[2].trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    if (process.env[m[1]] === undefined) process.env[m[1]] = v;
  }
}
loadDotEnv(path.join(__dirname, '..', '.env.test'));
loadDotEnv(path.join(__dirname, '..', '.env.test.local'));

const url = process.env.VITE_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error('missing VITE_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in env');
  process.exit(2);
}
if (url.includes('pzfujbjtayhkdlxiblwe')) {
  console.error('refusing to run verify_migration_099 against PROD URL');
  process.exit(2);
}

const {createClient} = require(path.join(__dirname, '..', 'node_modules', '@supabase', 'supabase-js'));
const sb = createClient(url, key, {auth: {autoRefreshToken: false, persistSession: false}});

const check = {
  label: 'daily_photos_auth_insert policy exists on storage.objects',
  sql: `DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_policies
                    WHERE schemaname='storage' AND tablename='objects'
                          AND policyname='daily_photos_auth_insert')
    THEN RAISE EXCEPTION 'daily_photos_auth_insert policy missing'; END IF;
  END $$;`,
};

(async () => {
  console.log(`TEST DB url=${url}`);
  const {error} = await sb.rpc('exec_sql', {sql: check.sql});
  if (error) {
    console.log(`  FAIL  ${check.label}: ${error.message || error}`);
    process.exit(1);
  }
  console.log(`  PASS  ${check.label}`);
  console.log('verify 099: ALL PASS');
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
