// scripts/recon_tasks_rls.cjs
//
// Tasks v1 Phase A RLS recon. Verifies that migrations 036 + 037 + 038
// produced the policy shape the rev-5 plan packet locked.
//
// Codex blocker (rev 4): RLS recon must use real anon + authenticated
// clients, NOT service-role. Service-role bypasses RLS by design and would
// pass any policy check, proving nothing about the actual contract.
//
// Codex blockers (Phase A pre-commit review):
//   1. Mig 038's task-photos bucket must be probed too — the recon used
//      to skip storage entirely. Now probes bucket existence + per-role
//      INSERT/SELECT/sign/UPDATE/DELETE.
//   2. Failed runs must not poison subsequent runs. Pre-clean phase removes
//      any leftover recon-* rows + storage objects before setup runs, and
//      cleanup is wrapped in a finally-style block so probe failures still
//      tear down state.
//   3. Test admin profile is upserted with role='admin' during setup — fresh
//      test projects often have the auth user but not the profiles row.
//
// Probe matrix (5 callers × 3 tables + 1 helper RPC + storage):
//
//   | Caller                    | task_templates | task_instances (own) | task_instances (other) | task_cron_runs | is_admin()       |
//   |---------------------------|----------------|----------------------|------------------------|----------------|------------------|
//   | anon                      | 0 rows         | 0 rows               | 0 rows                 | 0 rows         | not admin        |
//   | farm_team (assignee-self) | 0 rows         | 1 row                | 0 rows                 | 0 rows         | false            |
//   | farm_team (non-assignee)  | 0 rows         | 0 rows               | 0 rows                 | 0 rows         | false            |
//   | admin                     | >=1 row        | >=1 row              | >=1 row                | (>=0)          | true             |
//   | service-role              | bypass         | bypass               | bypass                 | bypass         | n/a              |
//
//   Anon "not admin" check accepts EITHER an error from the rpc OR
//   data===false OR data===null. We deliberately don't REVOKE EXECUTE
//   from anon (Supabase quirk causes PostgREST schema-cache errors that
//   cascade into Auth signin failures). The actual security boundary for
//   anon is `auth.uid()` returning NULL inside the function body — the
//   EXISTS lookup never matches, so anon always sees false. See mig 037
//   comment block on the GRANT/REVOKE strategy.
//
//   Storage probes (task-photos bucket from mig 038):
//   | Caller        | getBucket | upload     | read | createSignedUrl | update     | delete     |
//   |---------------|-----------|------------|------|-----------------|------------|------------|
//   | service-role  | exists, public=false (proves migration applied)                            |
//   | anon          | n/a       | denied     | denied | denied        | n/a        | n/a        |
//   | authenticated | n/a       | allowed    | allowed | allowed       | denied     | denied     |
//
// Setup (service-role only):
//   1. Pre-clean: delete any recon-* rows from task_instances + task_templates,
//      and any objects under recon-* paths in task-photos bucket. Idempotent;
//      first-run no-op. Recovers from poisoned state on subsequent runs.
//   2. Resolve test admin auth user; upsert profiles row with role='admin'.
//   3. Mint two temp test users (recon-tasks-assignee@/non-assignee@) with
//      role='farm_team' profile rows.
//   4. Insert one task_instances row assigned to assignee-fixture.
//   5. Insert one task_templates row (active=false).
//
// Probes (anon-key + per-user signed-in clients):
//   - For each caller: SELECT each target table and call is_admin().
//   - For storage: per-role bucket / object operations.
//
// Cleanup (service-role, runs even on probe failure):
//   - DELETE any recon-* rows from task_instances + task_templates.
//   - Remove any recon storage objects from task-photos bucket.
//   - admin.auth.admin.deleteUser for both temp users.
//
// Usage:
//   - Apply migs 036 + 037 + 038 to the test DB first (Supabase SQL Editor).
//   - Ensure .env.test has VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY,
//     SUPABASE_SERVICE_ROLE_KEY, VITE_TEST_ADMIN_EMAIL, VITE_TEST_ADMIN_PASSWORD.
//   - node scripts/recon_tasks_rls.cjs
//
// Exit codes:
//   - 0 if every probe matches expectation.
//   - 1 if any probe fails OR setup/cleanup errors.

const fs = require('fs');
const path = require('path');
const {createClient} = require('@supabase/supabase-js');

function loadEnv() {
  // Priority order matches Vite's convention: .env.test.local (gitignored,
  // holds secrets) wins over .env.test (committed, base). First-match-wins
  // semantics via the !process.env[k] guard.
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
    'recon_tasks_rls: missing one of VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY / SUPABASE_SERVICE_ROLE_KEY / VITE_TEST_ADMIN_EMAIL / VITE_TEST_ADMIN_PASSWORD',
  );
  process.exit(1);
}

// Sentinel: refuse to run against prod.
if (URL.includes('pzfujbjtayhkdlxiblwe')) {
  console.error('recon_tasks_rls: VITE_SUPABASE_URL points at the prod project. This script only runs against test.');
  process.exit(1);
}

const ASSIGNEE_EMAIL = 'recon-tasks-assignee@wcfplanner.test';
const NON_ASSIGNEE_EMAIL = 'recon-tasks-non-assignee@wcfplanner.test';
const TEMP_PASSWORD = 'recon-tasks-' + Math.random().toString(36).slice(2, 14);

const SEED_TEMPLATE_ID = 'recon-tmpl-' + Date.now().toString(36);
const SEED_INSTANCE_ID = 'recon-inst-' + Date.now().toString(36);
const BUCKET = 'task-photos';
// Storage probe path prefix; pre-clean wipes anything under this prefix.
const PROBE_STORAGE_PREFIX = 'recon';

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
function anon() {
  return createClient(URL, ANON, {auth: {persistSession: false, autoRefreshToken: false}});
}
async function signedInClient(email, password) {
  const c = createClient(URL, ANON, {auth: {persistSession: false, autoRefreshToken: false}});
  const {error} = await c.auth.signInWithPassword({email, password});
  if (error) throw new Error(`signInWithPassword ${email}: ${error.message}`);
  return c;
}

// ── Setup helpers ───────────────────────────────────────────────────────────

async function ensureAdminProfile(adminSb) {
  // Resolve the test admin auth user id, then upsert profiles row with role='admin'.
  // Codex Phase-A blocker fix: recon used to assume the row already existed.
  const {data, error} = await adminSb.auth.admin.listUsers({page: 1, perPage: 200});
  if (error) throw new Error(`listUsers: ${error.message}`);
  const adminUser = data.users.find((u) => u.email === ADMIN_EMAIL);
  if (!adminUser) throw new Error(`test admin ${ADMIN_EMAIL} not found in auth.users`);
  const {error: upErr} = await adminSb.from('profiles').upsert(
    {
      id: adminUser.id,
      email: ADMIN_EMAIL,
      role: 'admin',
      full_name: ADMIN_EMAIL.split('@')[0],
    },
    {onConflict: 'id'},
  );
  if (upErr) throw new Error(`profiles upsert admin: ${upErr.message}`);
  return adminUser.id;
}

async function ensureTempUser(adminSb, email, role) {
  const {data: created, error: createErr} = await adminSb.auth.admin.createUser({
    email,
    password: TEMP_PASSWORD,
    email_confirm: true,
  });
  let userId;
  if (createErr) {
    if (!/already.*registered|exists/i.test(createErr.message)) {
      throw new Error(`createUser ${email}: ${createErr.message}`);
    }
    const {data, error} = await adminSb.auth.admin.listUsers({page: 1, perPage: 200});
    if (error) throw new Error(`listUsers: ${error.message}`);
    const found = data.users.find((u) => u.email === email);
    if (!found) throw new Error(`temp user ${email} not found after create-collision`);
    userId = found.id;
    const {error: pwErr} = await adminSb.auth.admin.updateUserById(userId, {password: TEMP_PASSWORD});
    if (pwErr) throw new Error(`updateUserById ${email}: ${pwErr.message}`);
  } else {
    userId = created.user.id;
  }
  const {error: upErr} = await adminSb
    .from('profiles')
    .upsert({id: userId, email, role, full_name: email.split('@')[0]}, {onConflict: 'id'});
  if (upErr) throw new Error(`profiles upsert ${email}: ${upErr.message}`);
  return userId;
}

async function deleteTempUser(adminSb, email) {
  const {data, error} = await adminSb.auth.admin.listUsers({page: 1, perPage: 200});
  if (error) {
    console.log(`  cleanup-warn — listUsers: ${error.message}`);
    return;
  }
  const found = data.users.find((u) => u.email === email);
  if (!found) return;
  await adminSb.from('profiles').delete().eq('id', found.id);
  const {error: delErr} = await adminSb.auth.admin.deleteUser(found.id);
  if (delErr) console.log(`  cleanup-warn — deleteUser ${email}: ${delErr.message}`);
}

// ── Pre-clean ───────────────────────────────────────────────────────────────
// Removes recon-* rows + recon-* storage objects from prior runs. Recovers
// from poisoned state where a previous run aborted before cleanup. Idempotent.

async function preClean(adminSb) {
  // Delete recon-* task_instances. id LIKE 'recon-%' covers SEED_INSTANCE_ID
  // pattern from any historical run.
  const inst = await adminSb.from('task_instances').delete().like('id', 'recon-%');
  if (inst.error) console.log(`  pre-clean warn — task_instances: ${inst.error.message}`);
  // Delete recon-* task_templates. ON DELETE RESTRICT on task_instances.template_id
  // would block this if any non-recon child references a recon template — but recon
  // templates have no real consumers, so this is safe.
  const tmpl = await adminSb.from('task_templates').delete().like('id', 'recon-%');
  if (tmpl.error) console.log(`  pre-clean warn — task_templates: ${tmpl.error.message}`);
  // Wipe recon-* storage objects under task-photos. Bucket missing or list error
  // is non-fatal — storage probes will surface that as a probe failure with a
  // clear message.
  try {
    const {data: items, error} = await adminSb.storage.from(BUCKET).list(PROBE_STORAGE_PREFIX);
    if (!error && Array.isArray(items) && items.length > 0) {
      const paths = items.map((x) => `${PROBE_STORAGE_PREFIX}/${x.name}`);
      await adminSb.storage.from(BUCKET).remove(paths);
    }
  } catch (e) {
    console.log(`  pre-clean warn — storage list/remove: ${e.message}`);
  }
}

// ── Cleanup (always runs in finally) ────────────────────────────────────────

async function cleanup(adminSb) {
  console.log('## Cleanup\n');
  try {
    const inst = await adminSb.from('task_instances').delete().like('id', 'recon-%');
    if (inst.error) console.log(`  cleanup-warn — task_instances: ${inst.error.message}`);
    else console.log('  ok  — deleted recon task_instances rows');
  } catch (e) {
    console.log(`  cleanup-warn — task_instances: ${e.message}`);
  }
  try {
    const tmpl = await adminSb.from('task_templates').delete().like('id', 'recon-%');
    if (tmpl.error) console.log(`  cleanup-warn — task_templates: ${tmpl.error.message}`);
    else console.log('  ok  — deleted recon task_templates rows');
  } catch (e) {
    console.log(`  cleanup-warn — task_templates: ${e.message}`);
  }
  try {
    const {data: items, error} = await adminSb.storage.from(BUCKET).list(PROBE_STORAGE_PREFIX);
    if (!error && Array.isArray(items) && items.length > 0) {
      const paths = items.map((x) => `${PROBE_STORAGE_PREFIX}/${x.name}`);
      await adminSb.storage.from(BUCKET).remove(paths);
      console.log(`  ok  — removed ${paths.length} recon storage object(s)`);
    } else {
      console.log('  ok  — no recon storage objects to remove');
    }
  } catch (e) {
    console.log(`  cleanup-warn — storage cleanup: ${e.message}`);
  }
  try {
    await deleteTempUser(adminSb, ASSIGNEE_EMAIL);
    console.log(`  ok  — deleted temp user ${ASSIGNEE_EMAIL}`);
    await deleteTempUser(adminSb, NON_ASSIGNEE_EMAIL);
    console.log(`  ok  — deleted temp user ${NON_ASSIGNEE_EMAIL}`);
  } catch (e) {
    console.log(`  cleanup-warn — temp user delete: ${e.message}`);
  }
  console.log();
}

// ── Probes ──────────────────────────────────────────────────────────────────

async function countTable(sb, table) {
  const {data, error} = await sb.from(table).select('id');
  if (error) {
    return {count: 0, errorCode: error.code || error.status || 'err', errorMsg: error.message};
  }
  return {count: (data || []).length};
}

async function callIsAdmin(sb) {
  const {data, error} = await sb.rpc('is_admin');
  return {data, error};
}

async function probe(label, sb, expectations) {
  console.log(`## ${label}\n`);
  const tmpl = await countTable(sb, 'task_templates');
  check(
    `task_templates count = ${expectations.templates}`,
    tmpl.count === expectations.templates,
    `got count=${tmpl.count}${tmpl.errorMsg ? ' err=' + tmpl.errorMsg : ''}`,
  );

  const inst = await countTable(sb, 'task_instances');
  check(
    `task_instances count = ${expectations.instances}`,
    inst.count === expectations.instances,
    `got count=${inst.count}${inst.errorMsg ? ' err=' + inst.errorMsg : ''}`,
  );

  const cron = await countTable(sb, 'task_cron_runs');
  check(
    `task_cron_runs count = ${expectations.cron_runs}`,
    cron.count === expectations.cron_runs,
    `got count=${cron.count}${cron.errorMsg ? ' err=' + cron.errorMsg : ''}`,
  );

  if (expectations.is_admin !== undefined) {
    const r = await callIsAdmin(sb);
    if (expectations.is_admin === 'denied') {
      // Anon's actual security boundary: auth.uid() is NULL → function
      // returns false. Either an error (if grants ever get tightened) OR
      // data=false (current Supabase default-privilege state) is a valid
      // denial signal. We deliberately DO NOT REVOKE EXECUTE FROM anon —
      // doing so causes PostgREST to return schema-cache errors that
      // cascade into Supabase Auth signin failures. See mig 037 comment
      // block on the GRANT/REVOKE block for the full rationale.
      const denied = !!r.error || r.data === null || r.data === false;
      check(
        'is_admin() denies admin status to anon',
        denied,
        r.error ? `err=${r.error.message}` : `data=${JSON.stringify(r.data)}`,
      );
    } else {
      check(
        `is_admin() returns ${expectations.is_admin}`,
        r.data === expectations.is_admin,
        r.error ? `err=${r.error.message}` : `data=${JSON.stringify(r.data)}`,
      );
    }
  }
  console.log();
}

// ── Storage probes ──────────────────────────────────────────────────────────
// Verifies mig 038's task-photos bucket per the locked policy shape:
//   - private (public=false)
//   - anon: zero access
//   - authenticated: INSERT + SELECT + sign allowed; UPDATE + DELETE denied

function tinyJpegBytes() {
  // Smallest valid-ish JPEG body. Storage doesn't validate format here; we just
  // need bytes the supabase-js client will upload.
  return new Uint8Array([0xff, 0xd8, 0xff, 0xd9]);
}

async function storageProbes({adminSb, anonSb, assigneeSb}) {
  console.log('## Storage Probe: task-photos bucket\n');

  // 1. Service-role: bucket exists + private.
  try {
    const {data, error} = await adminSb.storage.getBucket(BUCKET);
    check(`bucket "${BUCKET}" exists (service-role)`, !error && !!data, error ? error.message : 'no data');
    check(`bucket "${BUCKET}" public=false`, data && data.public === false, `got public=${data && data.public}`);
  } catch (e) {
    check(`bucket "${BUCKET}" exists (service-role)`, false, e.message);
  }

  // 2. Anon: upload denied.
  const anonPath = `${PROBE_STORAGE_PREFIX}/anon-${Date.now()}.jpg`;
  try {
    const {error} = await anonSb.storage.from(BUCKET).upload(anonPath, tinyJpegBytes(), {
      contentType: 'image/jpeg',
      upsert: false,
    });
    check('anon upload denied', !!error, error ? `(rejected: ${error.message})` : 'unexpectedly succeeded');
  } catch (e) {
    check('anon upload denied', true, `(threw: ${e.message})`);
  }

  // 3. Authenticated (assignee): upload allowed.
  const authPath = `${PROBE_STORAGE_PREFIX}/auth-${Date.now()}.jpg`;
  let authUploaded = false;
  try {
    const {error} = await assigneeSb.storage.from(BUCKET).upload(authPath, tinyJpegBytes(), {
      contentType: 'image/jpeg',
      upsert: false,
    });
    check('authenticated upload allowed', !error, error ? `err=${error.message}` : '');
    authUploaded = !error;
  } catch (e) {
    check('authenticated upload allowed', false, e.message);
  }

  if (authUploaded) {
    // 4. Authenticated read (download).
    try {
      const {data, error} = await assigneeSb.storage.from(BUCKET).download(authPath);
      check('authenticated download allowed', !error && !!data, error ? error.message : 'no data');
    } catch (e) {
      check('authenticated download allowed', false, e.message);
    }

    // 5. Authenticated createSignedUrl.
    try {
      const {data, error} = await assigneeSb.storage.from(BUCKET).createSignedUrl(authPath, 60);
      check(
        'authenticated createSignedUrl allowed',
        !error && data && !!data.signedUrl,
        error ? error.message : 'no url',
      );
    } catch (e) {
      check('authenticated createSignedUrl allowed', false, e.message);
    }

    // 6. Anon createSignedUrl denied.
    try {
      const {data, error} = await anonSb.storage.from(BUCKET).createSignedUrl(authPath, 60);
      check(
        'anon createSignedUrl denied',
        !!error || !data || !data.signedUrl,
        error ? `(rejected: ${error.message})` : 'unexpectedly produced signedUrl',
      );
    } catch (e) {
      check('anon createSignedUrl denied', true, `(threw: ${e.message})`);
    }

    // 7. Anon download denied.
    try {
      const {data, error} = await anonSb.storage.from(BUCKET).download(authPath);
      check(
        'anon download denied',
        !!error || !data,
        error ? `(rejected: ${error.message})` : 'unexpectedly returned data',
      );
    } catch (e) {
      check('anon download denied', true, `(threw: ${e.message})`);
    }

    // 8. Authenticated UPDATE (replace) denied — no UPDATE policy on the bucket.
    // upsert:true on existing path triggers the UPDATE code path.
    try {
      const {error} = await assigneeSb.storage.from(BUCKET).upload(authPath, tinyJpegBytes(), {
        contentType: 'image/jpeg',
        upsert: true,
      });
      check(
        'authenticated update (overwrite) denied',
        !!error,
        error ? `(rejected: ${error.message})` : 'unexpectedly succeeded',
      );
    } catch (e) {
      check('authenticated update (overwrite) denied', true, `(threw: ${e.message})`);
    }

    // 9. Authenticated DELETE denied — no DELETE policy on the bucket.
    try {
      const {data, error} = await assigneeSb.storage.from(BUCKET).remove([authPath]);
      // Storage REST may return success-shape with the deleted object listed,
      // OR an error. Either error OR an empty `data` array means the request
      // was rejected at the policy level.
      const denied = !!error || !Array.isArray(data) || data.length === 0;
      check(
        'authenticated delete denied',
        denied,
        error ? `(rejected: ${error.message})` : `data=${JSON.stringify(data)}`,
      );
    } catch (e) {
      check('authenticated delete denied', true, `(threw: ${e.message})`);
    }
  }

  console.log();
}

// ── Main ────────────────────────────────────────────────────────────────────

async function run() {
  console.log('━━━ Tasks v1 Phase A RLS recon ━━━\n');
  console.log(`URL: ${URL}\n`);

  const adminSb = svc();

  // Pre-clean BEFORE setup. Recovers from a prior poisoned run; idempotent
  // first-time no-op.
  console.log('## Pre-clean\n');
  await preClean(adminSb);
  console.log('  ok  — pre-clean pass complete\n');

  let setupOk = false;
  try {
    // ── Setup ──────────────────────────────────────────────────────────────
    console.log('## Setup\n');
    const adminUserId = await ensureAdminProfile(adminSb);
    console.log(`  ok  — test admin profile upserted as role=admin (${ADMIN_EMAIL} / ${adminUserId})`);

    const assigneeId = await ensureTempUser(adminSb, ASSIGNEE_EMAIL, 'farm_team');
    console.log(`  ok  — assignee temp user ${ASSIGNEE_EMAIL} (${assigneeId})`);
    const nonAssigneeId = await ensureTempUser(adminSb, NON_ASSIGNEE_EMAIL, 'farm_team');
    console.log(`  ok  — non-assignee temp user ${NON_ASSIGNEE_EMAIL} (${nonAssigneeId})`);

    const today = new Date().toISOString().slice(0, 10);
    const {error: tErr} = await adminSb.from('task_templates').insert({
      id: SEED_TEMPLATE_ID,
      title: 'recon template (do not enable)',
      assignee_profile_id: assigneeId,
      recurrence: 'once',
      first_due_date: today,
      active: false,
    });
    if (tErr) throw new Error(`task_templates insert: ${tErr.message}`);
    console.log(`  ok  — seeded task_templates row ${SEED_TEMPLATE_ID}`);

    const {error: iErr} = await adminSb.from('task_instances').insert({
      id: SEED_INSTANCE_ID,
      template_id: null,
      assignee_profile_id: assigneeId,
      due_date: today,
      title: 'recon instance',
      submission_source: 'admin_manual',
      status: 'open',
    });
    if (iErr) throw new Error(`task_instances insert: ${iErr.message}`);
    console.log(`  ok  — seeded task_instances row ${SEED_INSTANCE_ID}\n`);
    setupOk = true;

    // ── Probes ─────────────────────────────────────────────────────────────
    const anonSb = anon();
    await probe('Probe 1: anon (anon-key client, no signIn)', anonSb, {
      templates: 0,
      instances: 0,
      cron_runs: 0,
      is_admin: 'denied',
    });

    const assigneeSb = await signedInClient(ASSIGNEE_EMAIL, TEMP_PASSWORD);
    await probe('Probe 2: farm_team (assignee-self, signed in as ' + ASSIGNEE_EMAIL + ')', assigneeSb, {
      templates: 0,
      instances: 1,
      cron_runs: 0,
      is_admin: false,
    });

    const nonAssigneeSb = await signedInClient(NON_ASSIGNEE_EMAIL, TEMP_PASSWORD);
    await probe('Probe 3: farm_team (non-assignee, signed in as ' + NON_ASSIGNEE_EMAIL + ')', nonAssigneeSb, {
      templates: 0,
      instances: 0,
      cron_runs: 0,
      is_admin: false,
    });

    const adminSignedIn = await signedInClient(ADMIN_EMAIL, ADMIN_PW);
    console.log('## Probe 4: admin (signed in as ' + ADMIN_EMAIL + ')\n');
    const aTmpl = await countTable(adminSignedIn, 'task_templates');
    check('task_templates count >= 1 for admin', aTmpl.count >= 1, `got count=${aTmpl.count}`);
    const aInst = await countTable(adminSignedIn, 'task_instances');
    check('task_instances count >= 1 for admin', aInst.count >= 1, `got count=${aInst.count}`);
    const aCron = await countTable(adminSignedIn, 'task_cron_runs');
    check(
      'task_cron_runs reachable by admin (count >= 0)',
      aCron.count >= 0,
      `got count=${aCron.count}${aCron.errorMsg ? ' err=' + aCron.errorMsg : ''}`,
    );
    const aIs = await callIsAdmin(adminSignedIn);
    check(
      'is_admin() returns true for admin',
      aIs.data === true,
      aIs.error ? `err=${aIs.error.message}` : `data=${JSON.stringify(aIs.data)}`,
    );
    console.log();

    // Service-role bypass sanity (informational; does NOT prove RLS).
    console.log('## Probe 5: service-role (informational — bypasses RLS)\n');
    const sTmpl = await countTable(adminSb, 'task_templates');
    check('service-role sees task_templates rows', sTmpl.count >= 1, `got count=${sTmpl.count}`);
    const sInst = await countTable(adminSb, 'task_instances');
    check('service-role sees task_instances rows', sInst.count >= 1, `got count=${sInst.count}`);
    console.log();

    // Storage probes.
    await storageProbes({adminSb, anonSb, assigneeSb});
  } catch (e) {
    failures++;
    console.error(`\nFATAL during setup/probes: ${e.message}`);
    if (!setupOk) {
      console.error('(probes did not run; cleanup will still attempt to remove any partial state)');
    }
  } finally {
    // Cleanup ALWAYS runs, even if probes threw. Recovers state for the next run.
    await cleanup(adminSb);
  }

  // ── Summary ────────────────────────────────────────────────────────────────
  if (failures === 0) {
    console.log('━━━ recon green ━━━');
    process.exit(0);
  } else {
    console.log(`━━━ recon FAILED with ${failures} probe failure(s) ━━━`);
    process.exit(1);
  }
}

run().catch((e) => {
  console.error('recon_tasks_rls: unhandled error:', e);
  process.exit(1);
});
