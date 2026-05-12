// One-shot applier for migration 055 against the TEST Supabase project.
// Mirrors scripts/apply_test_mig_049.cjs: reads .env.test +
// .env.test.local, refuses to run unless WCF_TEST_DATABASE=1 and the URL
// does not match the PROD project ref, strips the outer BEGIN/COMMIT
// (exec_sql cannot EXECUTE transaction boundaries from inside its function
// body), and runs the migration in a single exec_sql call.
//
// Usage: node scripts/apply_migration_055.cjs

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

  const file = '055_broiler_batch_avg_rpc.sql';
  const sqlPath = path.resolve(__dirname, '..', 'supabase-migrations', file);
  let sql = fs.readFileSync(sqlPath, 'utf8');
  // Strip outer BEGIN/COMMIT only -- they cannot be EXECUTE'd from inside
  // exec_sql's function body. Anchored to start-of-line + trailing semicolon
  // to avoid touching plpgsql BEGIN/END blocks inside the function body.
  sql = sql.replace(/^\s*BEGIN\s*;\s*$/gim, '').replace(/^\s*COMMIT\s*;\s*$/gim, '');

  process.stdout.write(`applying ${file} ... `);
  const {error} = await sb.rpc('exec_sql', {sql});
  if (error) {
    console.error('FAILED');
    console.error(error);
    process.exit(1);
  }
  console.log('OK');

  // Smoke test: function must be callable. Pass a known-bad session_id so
  // the RAISE surfaces -- that proves the function exists with the right
  // signature.
  const probe = await sb.rpc('stamp_broiler_batch_avg', {session_id_in: '__nonexistent__'});
  if (probe.error && /not found/i.test(probe.error.message || '')) {
    console.log('Smoke test passed: function exists and validates inputs.');
  } else if (probe.error) {
    console.warn('Smoke test surprise:', probe.error.message || probe.error);
  } else {
    console.warn('Smoke test surprise: probe succeeded (expected RAISE), got:', JSON.stringify(probe.data));
  }
  console.log('Migration 055 applied to TEST.');
})();
