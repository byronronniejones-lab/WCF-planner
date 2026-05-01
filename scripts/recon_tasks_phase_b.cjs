// scripts/recon_tasks_phase_b.cjs
//
// Tasks v1 Phase B recon. Verifies that migration 039 + the deployed
// tasks-cron Edge Function produced the contract Codex approved in plan rev 3.
//
// Prereqs (in order):
//   1. .env.test.local has VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY,
//      SUPABASE_SERVICE_ROLE_KEY, VITE_TEST_ADMIN_EMAIL, VITE_TEST_ADMIN_PASSWORD.
//   2. Vault secrets provisioned on TEST: TASKS_CRON_FUNCTION_URL,
//      TASKS_CRON_SECRET, TASKS_CRON_SERVICE_ROLE_KEY.
//   3. tasks-cron Edge Function deployed: supabase functions deploy tasks-cron
//      --project-ref <test>. SUPABASE_SERVICE_ROLE_KEY + TASKS_CRON_SECRET env
//      vars provisioned on the function.
//   4. Migration 039 applied via Supabase SQL Editor.
//
// Use exec_sql (test-only) for catalog and Vault reads since pg_constraint,
// pg_extension, pg_proc, vault.decrypted_secrets, cron.job, and
// net._http_response are NOT exposed via PostgREST `.from()`. PROD recon is
// manual SQL Editor only — no exec_sql installed there.
//
// Usage:
//   node scripts/recon_tasks_phase_b.cjs

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

if (!URL || !ANON || !SERVICE_ROLE || !ADMIN_EMAIL || !ADMIN_PW) {
  console.error(
    'recon_tasks_phase_b: missing env (VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY / ' +
      'SUPABASE_SERVICE_ROLE_KEY / VITE_TEST_ADMIN_EMAIL / VITE_TEST_ADMIN_PASSWORD)',
  );
  process.exit(1);
}

if (URL.includes('pzfujbjtayhkdlxiblwe')) {
  console.error('recon_tasks_phase_b: VITE_SUPABASE_URL points at the prod project. This script is TEST-only.');
  process.exit(1);
}

const FUNCTION_URL = `${URL.replace(/\/$/, '')}/functions/v1/tasks-cron`;
const RECON_TEMPLATE_PREFIX = 'recon-tmpl-';
const RECON_INSTANCE_PREFIX = 'recon-inst-';
const PROBE_AUDIT_PREFIX = 'tcr-probe-';

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

// exec_sql is void-only (matches the test-bootstrap helper at the bottom of
// scripts/build_test_bootstrap.js). To ferry SELECT results back we INSERT
// into a recon-owned scratch table, then read it via supabase-js. Cleaner
// than minting a per-query helper function. Scratch table is dropped in
// cleanup.
const SCRATCH_TABLE = 'recon_tasks_phase_b_scratch';

async function ensureScratchTable(adminSb) {
  await adminSb.rpc('exec_sql', {
    sql: `CREATE TABLE IF NOT EXISTS public.${SCRATCH_TABLE} (k text, v jsonb);`,
  });
  await adminSb.rpc('exec_sql', {sql: `TRUNCATE public.${SCRATCH_TABLE};`});
  // PostgREST caches the schema; new tables aren't visible to .from() until
  // the cache reloads. NOTIFY+delay forces refresh so subsequent reads work.
  await adminSb.rpc('exec_sql', {sql: `NOTIFY pgrst, 'reload schema';`});
  await new Promise((r) => setTimeout(r, 1500));
}

async function selectScalar(adminSb, sql) {
  // Wraps the query in an INSERT INTO scratch-table SELECT … then reads back.
  // For single-row results.
  await adminSb.rpc('exec_sql', {sql: `TRUNCATE public.${SCRATCH_TABLE};`});
  const {error} = await adminSb.rpc('exec_sql', {
    sql: `INSERT INTO public.${SCRATCH_TABLE}(k, v) SELECT 'r', to_jsonb(t) FROM (${sql}) t;`,
  });
  if (error) return {error};
  const {data, error: rErr} = await adminSb.from(SCRATCH_TABLE).select('v');
  if (rErr) return {error: rErr};
  return {rows: data.map((r) => r.v)};
}

async function dropScratchTable(adminSb) {
  await adminSb.rpc('exec_sql', {sql: `DROP TABLE IF EXISTS public.${SCRATCH_TABLE};`});
}

// ── Setup ───────────────────────────────────────────────────────────────────

async function preClean(adminSb) {
  await adminSb.from('task_instances').delete().like('id', `${RECON_INSTANCE_PREFIX}%`);
  await adminSb.from('task_instances').delete().like('template_id', `${RECON_TEMPLATE_PREFIX}%`);
  await adminSb.from('task_templates').delete().like('id', `${RECON_TEMPLATE_PREFIX}%`);
  await adminSb.from('task_cron_runs').delete().like('id', `${PROBE_AUDIT_PREFIX}%`);
}

async function getAdminProfileId(adminSb) {
  const {data, error} = await adminSb.from('profiles').select('id').eq('email', ADMIN_EMAIL).maybeSingle();
  if (error) throw new Error(`profiles lookup: ${error.message}`);
  if (!data) throw new Error(`profiles row missing for ${ADMIN_EMAIL} — recon_tasks_rls.cjs setup needed first`);
  return data.id;
}

function todayISO() {
  const d = new Date();
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(d.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${dd}`;
}

function shiftISO(iso, days) {
  const [y, m, d] = iso.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + days));
  return `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, '0')}-${String(dt.getUTCDate()).padStart(2, '0')}`;
}

async function seedTemplate(adminSb, fields) {
  const id = `${RECON_TEMPLATE_PREFIX}${fields.tag}-${Date.now().toString(36)}`;
  const adminId = await getAdminProfileId(adminSb);
  const row = {
    id,
    title: fields.title || `recon ${fields.tag}`,
    description: null,
    assignee_profile_id: adminId,
    recurrence: fields.recurrence,
    recurrence_interval: fields.recurrence_interval || 1,
    first_due_date: fields.first_due_date,
    active: fields.active === undefined ? true : fields.active,
  };
  const {error} = await adminSb.from('task_templates').insert(row);
  if (error) throw new Error(`seed template ${fields.tag}: ${error.message}`);
  return row;
}

// Read TASKS_CRON_SECRET from Vault for the e2e probe's cron-auth header.
async function readVaultSecret(adminSb, name) {
  const r = await selectScalar(adminSb, `SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = '${name}'`);
  if (r.error) throw new Error(`vault read ${name}: ${r.error.message}`);
  if (!r.rows.length) return null;
  return r.rows[0].decrypted_secret;
}

async function invokeCronMode(cronSecret) {
  return fetch(FUNCTION_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${SERVICE_ROLE}`,
      'x-cron-secret': cronSecret,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({mode: 'cron'}),
  });
}

// ── Probes ──────────────────────────────────────────────────────────────────

async function schemaProbes(adminSb) {
  console.log('## Schema asserts (mig 039 contract)\n');

  // requires_photo dropped on both tables.
  const tplCols = await selectScalar(
    adminSb,
    `SELECT column_name FROM information_schema.columns
      WHERE table_schema='public' AND table_name='task_templates' AND column_name='requires_photo'`,
  );
  check('task_templates.requires_photo dropped', !tplCols.error && tplCols.rows.length === 0);

  const instCols = await selectScalar(
    adminSb,
    `SELECT column_name FROM information_schema.columns
      WHERE table_schema='public' AND table_name='task_instances' AND column_name='requires_photo'`,
  );
  check('task_instances.requires_photo dropped', !instCols.error && instCols.rows.length === 0);

  // completion_photo_path STILL exists (kept dormant per Codex).
  const photoPath = await selectScalar(
    adminSb,
    `SELECT column_name FROM information_schema.columns
      WHERE table_schema='public' AND table_name='task_instances' AND column_name='completion_photo_path'`,
  );
  check('task_instances.completion_photo_path retained (dormant)', !photoPath.error && photoPath.rows.length === 1);

  // Recurrence enum CHECK includes 'quarterly'. Narrowed to the exact
  // constraint name (Codex blocker: broad ILIKE '%recurrence%' matched both
  // the enum CHECK and the recurrence_interval >= 1 CHECK).
  const checkDef = await selectScalar(
    adminSb,
    `SELECT pg_get_constraintdef(oid) AS def FROM pg_constraint
      WHERE conrelid = 'public.task_templates'::regclass
        AND contype = 'c'
        AND conname = 'task_templates_recurrence_check'`,
  );
  const checkOk =
    !checkDef.error &&
    checkDef.rows.length === 1 &&
    /quarterly/.test(checkDef.rows[0].def) &&
    /once/.test(checkDef.rows[0].def);
  check(
    "recurrence enum CHECK includes 'quarterly' and 'once'",
    checkOk,
    checkDef.rows && checkDef.rows.length ? `def=${checkDef.rows[0].def}` : 'no row',
  );

  // recurrence_interval >= 1 invariant — must remain untouched after mig 039
  // (Codex blocker companion: confirm the interval check survives).
  const intervalCheck = await selectScalar(
    adminSb,
    `SELECT pg_get_constraintdef(oid) AS def FROM pg_constraint
      WHERE conrelid = 'public.task_templates'::regclass
        AND contype = 'c'
        AND conname = 'task_templates_recurrence_interval_check'`,
  );
  const intervalOk =
    !intervalCheck.error &&
    intervalCheck.rows.length === 1 &&
    /recurrence_interval/.test(intervalCheck.rows[0].def) &&
    />=\s*1/.test(intervalCheck.rows[0].def);
  check(
    'recurrence_interval CHECK >= 1 retained intact',
    intervalOk,
    intervalCheck.rows && intervalCheck.rows.length ? `def=${intervalCheck.rows[0].def}` : 'no row',
  );

  // Required extensions.
  for (const ext of ['pg_cron', 'pg_net', 'pgcrypto']) {
    const r = await selectScalar(adminSb, `SELECT extname FROM pg_extension WHERE extname='${ext}'`);
    check(`extension ${ext} installed`, !r.error && r.rows.length === 1);
  }

  // Vault secrets present + non-empty.
  for (const secret of ['TASKS_CRON_FUNCTION_URL', 'TASKS_CRON_SECRET', 'TASKS_CRON_SERVICE_ROLE_KEY']) {
    const r = await selectScalar(
      adminSb,
      `SELECT length(decrypted_secret) AS len FROM vault.decrypted_secrets WHERE name = '${secret}'`,
    );
    const ok = !r.error && r.rows.length === 1 && Number(r.rows[0].len) > 0;
    check(
      `vault secret ${secret} present + non-empty`,
      ok,
      r.rows && r.rows.length ? `len=${r.rows[0].len}` : 'no row',
    );
  }

  // Helper functions exist with SECURITY DEFINER.
  const fns = await selectScalar(
    adminSb,
    `SELECT proname, prosecdef FROM pg_proc
      WHERE pronamespace = 'public'::regnamespace
        AND proname IN ('invoke_tasks_cron','generate_task_instances')
      ORDER BY proname`,
  );
  const fnRows = (fns.rows || []).map((r) => ({name: r.proname, secdef: r.prosecdef}));
  check(
    'public.invoke_tasks_cron exists + SECURITY DEFINER',
    fnRows.find((f) => f.name === 'invoke_tasks_cron')?.secdef === true,
  );
  check(
    'public.generate_task_instances exists + SECURITY DEFINER',
    fnRows.find((f) => f.name === 'generate_task_instances')?.secdef === true,
  );

  // generate_task_instances has EXECUTE for service_role; NOT for anon/authenticated.
  for (const role of ['service_role']) {
    const r = await selectScalar(
      adminSb,
      `SELECT has_function_privilege('${role}', 'public.generate_task_instances(text, date[])', 'EXECUTE') AS yes`,
    );
    check(
      `generate_task_instances EXECUTE granted to ${role}`,
      !r.error && r.rows[0]?.yes === true,
      r.error ? r.error.message : `yes=${r.rows[0]?.yes}`,
    );
  }
  for (const role of ['anon', 'authenticated']) {
    const r = await selectScalar(
      adminSb,
      `SELECT has_function_privilege('${role}', 'public.generate_task_instances(text, date[])', 'EXECUTE') AS yes`,
    );
    check(
      `generate_task_instances EXECUTE NOT granted to ${role}`,
      !r.error && r.rows[0]?.yes === false,
      r.error ? r.error.message : `yes=${r.rows[0]?.yes}`,
    );
  }

  // Cron job registered.
  const cronJob = await selectScalar(
    adminSb,
    `SELECT jobname, schedule, active FROM cron.job WHERE jobname='tasks-cron-daily'`,
  );
  const cronOk =
    !cronJob.error && cronJob.rows.length === 1 && cronJob.rows[0].schedule === '0 4 * * *' && cronJob.rows[0].active;
  check("cron.job 'tasks-cron-daily' registered at '0 4 * * *' active", cronOk, JSON.stringify(cronJob.rows));

  // No weekly-summary slot (Phase F-only).
  const weekly = await selectScalar(adminSb, `SELECT count(*) AS n FROM cron.job WHERE jobname='tasks-cron-weekly'`);
  check("no 'tasks-cron-weekly' schedule registered (Phase F-only)", !weekly.error && Number(weekly.rows[0].n) === 0);
  console.log();
}

async function endToEndProbes(adminSb, cronSecret) {
  console.log('## End-to-end generator probes (function HTTP path)\n');
  const today = todayISO();

  // Probe 1 — Daily template, first_due_date today-2: expects 6 inserts.
  const t1 = await seedTemplate(adminSb, {
    tag: 'daily',
    recurrence: 'daily',
    first_due_date: shiftISO(today, -2),
  });
  let r1 = await invokeCronMode(cronSecret);
  check(`daily template invocation HTTP 200 (got ${r1.status})`, r1.status === 200);
  if (r1.status === 200) {
    const json = await r1.json();
    check(
      `daily template generated 6 instances (today-2..today+3) [first run; got ${json.generated_count}]`,
      json.generated_count === 6,
      `generated=${json.generated_count} skipped=${json.skipped_count}`,
    );
    const {data: rows} = await adminSb.from('task_instances').select('due_date').eq('template_id', t1.id);
    check('6 task_instances rows present for daily template', rows && rows.length === 6, `count=${rows?.length}`);
  }

  // Re-invoke: expect 0 generated.
  let r1b = await invokeCronMode(cronSecret);
  if (r1b.status === 200) {
    const json = await r1b.json();
    // Note: generated_count is across ALL active templates, not just t1. We
    // need to check the template-specific count via DB read.
    const {data: rows2} = await adminSb.from('task_instances').select('id').eq('template_id', t1.id);
    check(
      'second invocation: daily template still has 6 rows (idempotent)',
      rows2 && rows2.length === 6,
      `count=${rows2?.length}, json.generated_count=${json.generated_count}`,
    );
  }

  // Probe 2 — Cap behavior: first_due_date today-200, daily.
  // BEFORE seeding, deactivate t1 so the cap probe's invocation doesn't touch it.
  await adminSb.from('task_templates').update({active: false}).eq('id', t1.id);
  const t2 = await seedTemplate(adminSb, {
    tag: 'cap',
    recurrence: 'daily',
    first_due_date: shiftISO(today, -200),
  });
  let r2 = await invokeCronMode(cronSecret);
  if (r2.status === 200) {
    const json = await r2.json();
    const capRow = (json.cap_exceeded || []).find((c) => c.template_id === t2.id);
    check('cap probe: cap_exceeded entry recorded for the overflowing template', !!capRow, JSON.stringify(json));
    if (capRow) {
      check('cap probe: capped_at = 90', capRow.capped_at === 90);
      check('cap probe: horizon_size > 90', capRow.horizon_size > 90);
    }
    const {data: rows} = await adminSb.from('task_instances').select('id').eq('template_id', t2.id);
    check('cap probe: NO instances inserted (skip-and-audit)', rows && rows.length === 0, `count=${rows?.length}`);
  }

  // Probe 3 — Quarterly anchored: first_due_date today-95 → 2 occurrences within today+3.
  await adminSb.from('task_templates').update({active: false}).eq('id', t2.id);
  const t3 = await seedTemplate(adminSb, {
    tag: 'qtr',
    recurrence: 'quarterly',
    first_due_date: shiftISO(today, -95),
  });
  let r3 = await invokeCronMode(cronSecret);
  if (r3.status === 200) {
    const {data: rows} = await adminSb.from('task_instances').select('due_date').eq('template_id', t3.id);
    // first_due_date and first_due_date + 3 months — both should be ≤ today+3.
    check('quarterly probe: at least 1 instance generated', rows && rows.length >= 1, `count=${rows?.length}`);
    check(
      'quarterly probe: first instance is first_due_date',
      rows && String(rows[0].due_date).slice(0, 10) === t3.first_due_date,
    );
  }

  // Probe 4 — Inactive template: 0 inserted.
  await adminSb.from('task_templates').update({active: false}).eq('id', t3.id);
  const t4 = await seedTemplate(adminSb, {
    tag: 'inactive',
    recurrence: 'daily',
    first_due_date: today,
    active: false,
  });
  let r4 = await invokeCronMode(cronSecret);
  if (r4.status === 200) {
    const {data: rows} = await adminSb.from('task_instances').select('id').eq('template_id', t4.id);
    check('inactive probe: 0 instances generated', rows && rows.length === 0, `count=${rows?.length}`);
  }
  console.log();
}

async function auditLayerWalk(adminSb) {
  console.log('## Audit-layer walk (Layers 1-3)\n');

  // Layer 1: cron.job_run_details — joined to cron.job by jobid (Codex fix:
  // run_details has no jobname column).
  const layer1 = await selectScalar(
    adminSb,
    `SELECT count(*) AS n FROM cron.job_run_details rd
      JOIN cron.job j ON j.jobid = rd.jobid
      WHERE j.jobname = 'tasks-cron-daily'`,
  );
  check(
    'Layer 1 (cron.job_run_details): query path works (count >= 0)',
    !layer1.error,
    layer1.error ? layer1.error.message : `n=${layer1.rows[0].n}`,
  );

  // Layer 2: net._http_response. Schema varies by pg_net version; introspect first.
  const netCols = await selectScalar(
    adminSb,
    `SELECT column_name FROM information_schema.columns
      WHERE table_schema='net' AND table_name='_http_response'
      ORDER BY ordinal_position`,
  );
  const hasNet = !netCols.error && netCols.rows.length > 0;
  check('Layer 2 (net._http_response): table reachable', hasNet, netCols.error ? netCols.error.message : '');

  // Layer 3: task_cron_runs — function-execution audit.
  const {data: cronRuns, error: crErr} = await adminSb
    .from('task_cron_runs')
    .select('id, run_mode, generated_count, skipped_count, error_message')
    .order('ran_at', {ascending: false})
    .limit(5);
  check('Layer 3 (task_cron_runs): >= 1 row from end-to-end probes', !crErr && cronRuns && cronRuns.length >= 1);
  if (cronRuns && cronRuns.length > 0) {
    const runModes = new Set(cronRuns.map((r) => r.run_mode));
    check("Layer 3: run_mode='cron' present", runModes.has('cron'), `modes=${[...runModes].join(',')}`);
  }
  console.log();
}

async function cleanup(adminSb) {
  console.log('## Cleanup\n');
  try {
    await adminSb.from('task_instances').delete().like('template_id', `${RECON_TEMPLATE_PREFIX}%`);
    await adminSb.from('task_templates').delete().like('id', `${RECON_TEMPLATE_PREFIX}%`);
    await adminSb.from('task_cron_runs').delete().like('id', `${PROBE_AUDIT_PREFIX}%`);
    console.log('  ok  — recon-* + tcr-probe-* rows removed');
  } catch (e) {
    console.log(`  cleanup-warn — ${e.message}`);
  }
  try {
    await dropScratchTable(adminSb);
    console.log('  ok  — scratch table dropped');
  } catch (e) {
    console.log(`  cleanup-warn — scratch drop: ${e.message}`);
  }
  console.log();
}

// ── Main ────────────────────────────────────────────────────────────────────

async function run() {
  console.log('━━━ Tasks v1 Phase B recon ━━━\n');
  console.log(`URL:      ${URL}`);
  console.log(`Function: ${FUNCTION_URL}\n`);

  const adminSb = svc();

  console.log('## Pre-clean + scratch table\n');
  await ensureScratchTable(adminSb);
  await preClean(adminSb);
  console.log('  ok  — pre-clean complete\n');

  let setupOk = false;
  try {
    const cronSecret = await readVaultSecret(adminSb, 'TASKS_CRON_SECRET');
    if (!cronSecret) {
      throw new Error('TASKS_CRON_SECRET not found in vault.decrypted_secrets — provision before recon');
    }
    setupOk = true;
    await schemaProbes(adminSb);
    await endToEndProbes(adminSb, cronSecret);
    await auditLayerWalk(adminSb);
  } catch (e) {
    failures++;
    console.error(`\nFATAL during recon: ${e.message}`);
    if (!setupOk) console.error('(probes did not run; cleanup will still attempt teardown)');
  } finally {
    await cleanup(adminSb);
  }

  if (failures === 0) {
    console.log('━━━ recon green ━━━');
    process.exit(0);
  } else {
    console.log(`━━━ recon FAILED with ${failures} probe failure(s) ━━━`);
    process.exit(1);
  }
}

run().catch((e) => {
  console.error('recon_tasks_phase_b: unhandled error:', e);
  process.exit(1);
});
