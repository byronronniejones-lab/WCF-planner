// scripts/probe_tasks_cron_function.cjs
//
// Tasks v1 Phase B HTTP probes against the deployed tasks-cron Edge Function.
// Pure HTTP — no SQL, no migrations. Safe to run against TEST or PROD.
//
// Cases (all expected to pass; failures mean the function or auth path is
// misconfigured):
//   1. POST no Authorization → 401
//   2. POST anon JWT (no x-cron-secret) + body.mode='cron' → 401
//   3. POST service-role + MISSING x-cron-secret + body.mode='cron' → 401
//   4. POST service-role + WRONG x-cron-secret + body.mode='cron' → 401
//   5. POST service-role + correct cron-secret + body.mode='cron' + probe=true → 200
//   6. POST admin user JWT + body.mode='admin' + probe=true → 200
//   7. POST anon JWT + body.mode='admin' → 401
//   8. POST admin JWT + body.mode='cron' (mismatched mode) → 401
//   9. POST service-role + cron-secret + body.mode='admin' (mismatched) → 401
//   10. POST mode missing → 400
//   11. POST mode unknown ('foo') → 400
//
// Cron secret resolution:
//   1. process.env.TASKS_CRON_SECRET if set (set this when probing PROD).
//   2. Else read from vault.decrypted_secrets via exec_sql (TEST-only path —
//      exec_sql is NOT installed in PROD).
//
// Cleanup:
//   - Successful probe runs (cases 5 + 6) write tcr-probe-* rows. On TEST
//     this script deletes them via service-role (probe rows are a deliberate
//     audit residue but local-test-only cleanup keeps the table tidy).
//     On PROD they stay as real audit per Codex Q4.
//
// Usage:
//   node scripts/probe_tasks_cron_function.cjs
//
//   # Against PROD (admin only; Ronnie supplies cron secret out-of-band):
//   TASKS_CRON_SECRET=<...> VITE_SUPABASE_URL=<prod-url> ... \
//     node scripts/probe_tasks_cron_function.cjs

const fs = require('fs');
const path = require('path');
const {createClient} = require('@supabase/supabase-js');

function loadEnv() {
  const candidates = ['.env.test.local', '.env.test', '.env.local', '.env'];
  for (const name of candidates) {
    const p = path.join(__dirname, '..', name);
    if (!fs.existsSync(p)) continue;
    for (const line of fs.readFileSync(p, 'utf8').split(/\r?\n/)) {
      const m = /^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*?)\s*$/.exec(line);
      if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
    }
  }
}
loadEnv();

const URL = process.env.VITE_SUPABASE_URL;
const ANON = process.env.VITE_SUPABASE_ANON_KEY;
const SERVICE_ROLE = process.env.SUPABASE_SERVICE_ROLE_KEY;
const ADMIN_EMAIL = process.env.VITE_TEST_ADMIN_EMAIL;
const ADMIN_PW = process.env.VITE_TEST_ADMIN_PASSWORD;

if (!URL || !ANON || !SERVICE_ROLE) {
  console.error(
    'probe_tasks_cron_function: missing VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY / SUPABASE_SERVICE_ROLE_KEY',
  );
  process.exit(1);
}

const FUNCTION_URL = `${URL.replace(/\/$/, '')}/functions/v1/tasks-cron`;
const IS_PROD = URL.includes('pzfujbjtayhkdlxiblwe');

let failures = 0;
function check(label, ok, detail) {
  if (ok) {
    console.log(`  ok  — ${label}`);
  } else {
    failures++;
    console.log(`  FAIL — ${label}${detail ? ': ' + detail : ''}`);
  }
}

function svc() {
  return createClient(URL, SERVICE_ROLE, {auth: {persistSession: false, autoRefreshToken: false}});
}

async function readCronSecret() {
  if (process.env.TASKS_CRON_SECRET) return process.env.TASKS_CRON_SECRET;
  if (IS_PROD) {
    throw new Error(
      'probe_tasks_cron_function: PROD probes require TASKS_CRON_SECRET in env. Read it from PROD Vault via SQL Editor and pass via env.',
    );
  }
  // TEST-only path: read via exec_sql.
  const adminSb = svc();
  const {error: tErr} = await adminSb.rpc('exec_sql', {
    sql: 'CREATE TABLE IF NOT EXISTS public._probe_scratch (k text, v jsonb);',
  });
  if (tErr) throw new Error(`scratch create: ${tErr.message}`);
  await adminSb.rpc('exec_sql', {sql: 'TRUNCATE public._probe_scratch;'});
  // PostgREST schema-cache reload (NOTIFY+delay) so .from() can see the table.
  await adminSb.rpc('exec_sql', {sql: `NOTIFY pgrst, 'reload schema';`});
  await new Promise((r) => setTimeout(r, 1500));
  await adminSb.rpc('exec_sql', {
    sql: `INSERT INTO public._probe_scratch(k, v) SELECT 'r', to_jsonb(t) FROM (
            SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name='TASKS_CRON_SECRET'
          ) t;`,
  });
  const {data, error} = await adminSb.from('_probe_scratch').select('v');
  if (error) throw new Error(`scratch read: ${error.message}`);
  await adminSb.rpc('exec_sql', {sql: 'DROP TABLE public._probe_scratch;'});
  if (!data.length) throw new Error('TASKS_CRON_SECRET not present in TEST Vault');
  return data[0].v.decrypted_secret;
}

async function getAdminUserJWT() {
  if (!ADMIN_EMAIL || !ADMIN_PW) {
    if (IS_PROD) {
      // PROD probes can run without admin creds — auth-only negative paths still cover.
      console.log(
        '  warn — VITE_TEST_ADMIN_EMAIL / VITE_TEST_ADMIN_PASSWORD not set; admin-mode probes skipped (PROD)',
      );
      return null;
    }
    // TEST mode requires the admin probes (Codex amendment: gate cannot pass
    // green without case 6 + 8). Fail loudly instead of silently skipping.
    throw new Error(
      'probe_tasks_cron_function: TEST mode requires VITE_TEST_ADMIN_EMAIL + VITE_TEST_ADMIN_PASSWORD to exercise admin-mode probes (cases 6, 8). Set them in .env.test.local.',
    );
  }
  const c = createClient(URL, ANON, {auth: {persistSession: false, autoRefreshToken: false}});
  const {data, error} = await c.auth.signInWithPassword({email: ADMIN_EMAIL, password: ADMIN_PW});
  if (error) throw new Error(`admin signin: ${error.message}`);
  return data.session.access_token;
}

async function postFn({authorization, cronSecret, body}) {
  const headers = {'Content-Type': 'application/json'};
  if (authorization) headers['Authorization'] = authorization;
  if (cronSecret !== undefined) headers['x-cron-secret'] = cronSecret;
  return fetch(FUNCTION_URL, {method: 'POST', headers, body: JSON.stringify(body)});
}

async function main() {
  console.log('━━━ Tasks v1 Phase B probe ━━━\n');
  console.log(`URL:      ${URL}`);
  console.log(`Function: ${FUNCTION_URL}`);
  console.log(`Mode:     ${IS_PROD ? 'PROD' : 'TEST'}\n`);

  const cronSecret = await readCronSecret();
  const adminJWT = await getAdminUserJWT();
  console.log();

  console.log('## HTTP auth probes\n');

  // 1. No Authorization → 401.
  const r1 = await postFn({body: {mode: 'cron'}});
  check(`(1) no Authorization → 401 (got ${r1.status})`, r1.status === 401);

  // 2. Anon JWT (no x-cron-secret) → 401.
  const r2 = await postFn({authorization: `Bearer ${ANON}`, body: {mode: 'cron'}});
  check(`(2) anon JWT cron-mode no secret → 401 (got ${r2.status})`, r2.status === 401);

  // 3. Service-role + missing x-cron-secret → 401.
  const r3 = await postFn({authorization: `Bearer ${SERVICE_ROLE}`, body: {mode: 'cron'}});
  check(`(3) service-role + missing x-cron-secret → 401 (got ${r3.status})`, r3.status === 401);

  // 4. Service-role + WRONG x-cron-secret → 401.
  const r4 = await postFn({
    authorization: `Bearer ${SERVICE_ROLE}`,
    cronSecret: 'wrong-secret-' + Math.random().toString(36).slice(2),
    body: {mode: 'cron'},
  });
  check(`(4) service-role + wrong x-cron-secret → 401 (got ${r4.status})`, r4.status === 401);

  // 5. Service-role + correct cron-secret + probe=true → 200.
  const r5 = await postFn({
    authorization: `Bearer ${SERVICE_ROLE}`,
    cronSecret,
    body: {mode: 'cron', probe: true},
  });
  check(`(5) service-role + correct cron-secret + probe → 200 (got ${r5.status})`, r5.status === 200);
  if (r5.status === 200) {
    const json = await r5.json();
    check(`(5) response carries probe:true`, json.probe === true);
  }

  // 6. Admin user JWT + admin mode + probe=true → 200.
  if (adminJWT) {
    const r6 = await postFn({
      authorization: `Bearer ${adminJWT}`,
      body: {mode: 'admin', probe: true},
    });
    check(`(6) admin JWT admin-mode probe → 200 (got ${r6.status})`, r6.status === 200);
    if (r6.status === 200) {
      const json = await r6.json();
      check(`(6) response carries probe:true + run_mode:'admin'`, json.probe === true && json.run_mode === 'admin');
    }
  }

  // 7. Anon JWT + admin mode → 401 (rpc('is_admin') returns false for anon).
  const r7 = await postFn({authorization: `Bearer ${ANON}`, body: {mode: 'admin'}});
  check(`(7) anon JWT admin-mode → 401 (got ${r7.status})`, r7.status === 401);

  // 8. Admin JWT + cron mode (mismatch) → 401.
  if (adminJWT) {
    const r8 = await postFn({
      authorization: `Bearer ${adminJWT}`,
      cronSecret,
      body: {mode: 'cron'},
    });
    check(`(8) admin JWT cron-mode (mismatched) → 401 (got ${r8.status})`, r8.status === 401);
  }

  // 9. Service-role + cron-secret + admin mode (mismatch) → 401.
  const r9 = await postFn({
    authorization: `Bearer ${SERVICE_ROLE}`,
    cronSecret,
    body: {mode: 'admin'},
  });
  check(`(9) service-role + cron-secret admin-mode (mismatched) → 401 (got ${r9.status})`, r9.status === 401);

  // 10. mode missing → 400.
  const r10 = await postFn({authorization: `Bearer ${SERVICE_ROLE}`, cronSecret, body: {}});
  check(`(10) mode missing → 400 (got ${r10.status})`, r10.status === 400);

  // 11. mode unknown → 400.
  const r11 = await postFn({authorization: `Bearer ${SERVICE_ROLE}`, cronSecret, body: {mode: 'foo'}});
  check(`(11) mode unknown → 400 (got ${r11.status})`, r11.status === 400);
  console.log();

  // Cleanup tcr-probe-* rows on TEST. PROD keeps them as real audit (Codex Q4).
  if (!IS_PROD) {
    console.log('## Cleanup (TEST tcr-probe-* rows)\n');
    const adminSb = svc();
    const {error} = await adminSb.from('task_cron_runs').delete().like('id', 'tcr-probe-%');
    if (error) {
      console.log(`  cleanup-warn — ${error.message}`);
    } else {
      console.log('  ok  — tcr-probe-* rows removed');
    }
    console.log();
  } else {
    console.log('## Cleanup\n  skipped (PROD probe rows stay as real audit per Codex Q4)\n');
  }

  if (failures === 0) {
    console.log('━━━ probe green ━━━');
    process.exit(0);
  } else {
    console.log(`━━━ probe FAILED with ${failures} failure(s) ━━━`);
    process.exit(1);
  }
}

main().catch((e) => {
  console.error('probe_tasks_cron_function: unhandled error:', e.message || e);
  process.exit(1);
});
