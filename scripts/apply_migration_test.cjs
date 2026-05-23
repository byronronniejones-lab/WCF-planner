// One-off: apply a migration file to the TEST Supabase project via the
// exec_sql SECDEF RPC. Reads env from .env.test + .env.test.local.
//
// Usage:
//   node scripts/apply_migration_test.cjs supabase-migrations/057_notifications.sql

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

const file = process.argv[2];
if (!file) {
  console.error('usage: node apply_migration_test.cjs <migration.sql>');
  process.exit(2);
}
const sql = fs.readFileSync(path.resolve(file), 'utf8');

const url = process.env.VITE_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error('missing VITE_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in env');
  process.exit(2);
}
// Hard guard: refuse to run against the PROD URL.
const PROD_REF = 'pzfujbjtayhkdlxiblwe';
if (url.includes(PROD_REF)) {
  console.error('refusing to run apply_migration_test against PROD URL');
  process.exit(2);
}

const {createClient} = require(path.join(__dirname, '..', 'node_modules', '@supabase', 'supabase-js'));
const sb = createClient(url, key, {auth: {autoRefreshToken: false, persistSession: false}});

(async () => {
  console.log(`TEST DB url=${url}`);
  console.log(`applying ${path.basename(file)} (${sql.length} bytes)`);
  const {error} = await sb.rpc('exec_sql', {sql});
  if (error) {
    console.error('exec_sql failed:', error.message || error);
    process.exit(1);
  }
  console.log('applied OK');

  // Post-apply verification: confirm notifications table exists + has RLS.
  const checks = [
    {
      label: 'table notifications exists',
      sql: `SELECT to_regclass('public.notifications') IS NOT NULL AS ok;`,
    },
    {
      label: 'RLS enabled on notifications',
      sql: `SELECT relrowsecurity FROM pg_class WHERE relname='notifications' AND relnamespace='public'::regnamespace;`,
    },
    {
      label: 'select policy exists',
      sql: `SELECT EXISTS(SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='notifications' AND policyname='notifications_recipient_select') AS ok;`,
    },
    {
      label: 'update policy exists',
      sql: `SELECT EXISTS(SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='notifications' AND policyname='notifications_recipient_update_read') AS ok;`,
    },
    {
      label: 'index unread exists',
      sql: `SELECT EXISTS(SELECT 1 FROM pg_indexes WHERE schemaname='public' AND tablename='notifications' AND indexname='notifications_recipient_unread_idx') AS ok;`,
    },
    {
      label: 'complete_task_instance v2 overload present',
      sql: `SELECT count(*) AS n FROM pg_proc WHERE proname='complete_task_instance' AND pronargs=3;`,
    },
  ];
  for (const c of checks) {
    const {data, error: e2} = await sb.rpc('exec_sql', {sql: `SELECT json_agg(t) FROM (${c.sql}) t;`});
    if (e2) {
      console.log(`  ${c.label}: ERROR ${e2.message}`);
    } else {
      console.log(`  ${c.label}:`, JSON.stringify(data));
    }
  }
  console.log('done');
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
