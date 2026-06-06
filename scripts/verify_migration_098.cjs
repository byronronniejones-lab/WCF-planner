// Verify migration 098 on the TEST Supabase project via exec_sql DO-block
// assertions (each RAISEs on failure, so a clean run == verified — this works
// even though exec_sql returns void and cannot return SELECT rows).
// Reads env from .env.test + .env.test.local. TEST-only (hard PROD guard).
//
// Usage:
//   node scripts/verify_migration_098.cjs

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
const PROD_REF = 'pzfujbjtayhkdlxiblwe';
if (url.includes(PROD_REF)) {
  console.error('refusing to run verify_migration_098 against PROD URL');
  process.exit(2);
}

const {createClient} = require(path.join(__dirname, '..', 'node_modules', '@supabase', 'supabase-js'));
const sb = createClient(url, key, {auth: {autoRefreshToken: false, persistSession: false}});

const checks = [
  {
    label: 'retired roster webform_config keys are gone',
    sql: `DO $$ BEGIN
      IF EXISTS (SELECT 1 FROM public.webform_config
                  WHERE key IN ('team_roster','team_members','team_availability',
                                'per_form_team_members','weighins_team_members'))
      THEN RAISE EXCEPTION 'roster webform_config keys still present'; END IF;
    END $$;`,
  },
  {
    label: 'equipment.team_members column dropped',
    sql: `DO $$ BEGIN
      IF EXISTS (SELECT 1 FROM information_schema.columns
                  WHERE table_schema='public' AND table_name='equipment'
                        AND column_name='team_members')
      THEN RAISE EXCEPTION 'equipment.team_members column still exists'; END IF;
    END $$;`,
  },
];

(async () => {
  console.log(`TEST DB url=${url}`);
  let allOk = true;
  for (const c of checks) {
    const {error} = await sb.rpc('exec_sql', {sql: c.sql});
    if (error) {
      allOk = false;
      console.log(`  FAIL  ${c.label}: ${error.message || error}`);
    } else {
      console.log(`  PASS  ${c.label}`);
    }
  }
  console.log(allOk ? 'verify 098: ALL PASS' : 'verify 098: FAILURES');
  process.exit(allOk ? 0 : 1);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
