// Apply mig 125 (production_legacy_events + list RPC) to TEST via exec_sql.
// Refuses the PROD project ref. Smokes use DO blocks because exec_sql returns
// void.

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

const ROOT = path.join(__dirname, '..');
const MAIN_WORKTREE = path.resolve(ROOT, '..', 'WCF-planner');
for (const file of [
  path.join(ROOT, '.env.test'),
  path.join(ROOT, '.env.test.local'),
  path.join(MAIN_WORKTREE, '.env.test'),
  path.join(MAIN_WORKTREE, '.env.test.local'),
]) {
  loadDotEnv(file);
}

const url = process.env.VITE_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
const PROD_REF = 'pzfujbjtayhkdlxiblwe';
if (!url || !key) {
  console.error('missing TEST env');
  process.exit(2);
}
if (url.includes(PROD_REF)) {
  console.error('refusing to run against PROD url');
  process.exit(2);
}

const migrationPath = path.join(ROOT, 'supabase-migrations', '125_production_legacy_events.sql');
const body = fs.readFileSync(migrationPath, 'utf8');
const {createClient} = require(path.join(ROOT, 'node_modules', '@supabase', 'supabase-js'));
const sb = createClient(url, key, {auth: {autoRefreshToken: false, persistSession: false}});

(async () => {
  console.log(`TEST url=${url}`);
  console.log(`applying 125 body (${body.length} bytes)`);
  const {error} = await sb.rpc('exec_sql', {sql: body});
  if (error) {
    console.error('exec_sql APPLY failed:', error.message || error);
    process.exit(1);
  }
  console.log('apply OK');

  const smokes = [
    {
      label: 'legacy table exists, RLS enabled, no direct anon/authenticated grants',
      sql: `DO $$ BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
                        WHERE n.nspname='public' AND c.relname='production_legacy_events' AND c.relrowsecurity)
        THEN RAISE EXCEPTION 'production_legacy_events missing or RLS off'; END IF;
        IF EXISTS (SELECT 1 FROM information_schema.role_table_grants
                    WHERE table_schema='public' AND table_name='production_legacy_events'
                          AND grantee IN ('anon','authenticated'))
        THEN RAISE EXCEPTION 'unexpected direct grants on production_legacy_events'; END IF;
      END $$;`,
    },
    {
      label: 'list RPC is SECURITY DEFINER with authenticated-only EXECUTE',
      sql: `DO $$ BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
                        WHERE n.nspname='public' AND p.proname='list_production_legacy_events' AND p.prosecdef)
        THEN RAISE EXCEPTION 'list_production_legacy_events missing or not SECURITY DEFINER'; END IF;
        IF NOT EXISTS (SELECT 1 FROM information_schema.routine_privileges
                        WHERE routine_schema='public' AND routine_name='list_production_legacy_events'
                              AND grantee='authenticated' AND privilege_type='EXECUTE')
        THEN RAISE EXCEPTION 'list_production_legacy_events missing authenticated EXECUTE'; END IF;
        IF EXISTS (SELECT 1 FROM information_schema.routine_privileges
                    WHERE routine_schema='public' AND routine_name='list_production_legacy_events'
                          AND grantee IN ('anon','PUBLIC'))
        THEN RAISE EXCEPTION 'list_production_legacy_events leaks EXECUTE to anon/PUBLIC'; END IF;
      END $$;`,
    },
    {
      label: 'list RPC excludes light users server-side',
      sql: `DO $$ BEGIN
        IF position('v_role NOT IN (''farm_team'', ''management'', ''admin'')'
                    in pg_get_functiondef('public.list_production_legacy_events(date,date)'::regprocedure)) = 0
        THEN RAISE EXCEPTION 'list_production_legacy_events is not farm-team-and-up only'; END IF;
      END $$;`,
    },
    {
      label: 'shape protects row identity and review status',
      sql: `DO $$ BEGIN
        IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                        WHERE table_schema='public' AND table_name='production_legacy_events'
                          AND column_name='source_key')
        THEN RAISE EXCEPTION 'source_key missing'; END IF;
        IF NOT EXISTS (SELECT 1 FROM pg_constraint
                        WHERE conrelid='public.production_legacy_events'::regclass
                          AND pg_get_constraintdef(oid) LIKE '%review_status%approved%pending_review%rejected%')
        THEN RAISE EXCEPTION 'review_status check missing expected states'; END IF;
      END $$;`,
    },
  ];

  for (const smoke of smokes) {
    const {error: smokeErr} = await sb.rpc('exec_sql', {sql: smoke.sql});
    if (smokeErr) {
      console.error(`SMOKE FAILED: ${smoke.label}`);
      console.error(smokeErr.message || smokeErr);
      process.exit(1);
    }
    console.log(`smoke OK: ${smoke.label}`);
  }

  await sb.rpc('exec_sql', {sql: "NOTIFY pgrst, 'reload schema';"});
  console.log('mig 125 TEST smokes complete');
})();
