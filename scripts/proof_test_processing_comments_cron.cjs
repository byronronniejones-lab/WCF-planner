// TEST proof for the comments-only cron contract of processing-asana-sync.
// GATED: requires the UPDATED Edge function deployed to TEST (deploy approval)
// and the two PROCESSING_ASANA_CRON_* values exported in the shell (they are
// minted at activation time; this script never prints them).
//
//   PROCESSING_ASANA_CRON_SECRET=...  PROCESSING_ASANA_CRON_SERVICE_ROLE_KEY=... \
//     node scripts/proof_test_processing_comments_cron.cjs
//
// Proves, in order:
//   1. cron auth fails closed (401) without/with wrong secrets.
//   2. with BOTH flags false → 423 and the response action is sync_comments
//      (cron pinning: the recurring path can never name a wider action).
//   3. with ONLY asana_comments_import_enabled=true → the gate opens for the
//      pinned comments action; the response is either a completed comments run
//      (counts.commentsFound present; NO reconcile/plannerRows keys — proof no
//      sync_once behavior ran) or the truthful 503 ASANA_ACCESS_TOKEN fail-
//      closed if TEST has no token.
//   4. when a real run completed: a second run inserts 0 (idempotent) and both
//      runs are bracketed in processing_asana_sync_runs as action=sync_comments.
//   5. settings are restored to their pre-proof values in finally.
//
// TEST-only. Never touches PROD; never prints secrets.

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

const url = (process.env.VITE_SUPABASE_URL || '').replace(/\/$/, '');
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const PROD_REF = 'pzfujbjtayhkdlxiblwe';
const CRON_SECRET = process.env.PROCESSING_ASANA_CRON_SECRET;
const CRON_JWT = process.env.PROCESSING_ASANA_CRON_SERVICE_ROLE_KEY;
if (process.env.WCF_TEST_DATABASE !== '1' || !url || url.includes(PROD_REF) || !serviceKey) {
  console.error('refusing: TEST env required (WCF_TEST_DATABASE=1, non-PROD URL, service key)');
  process.exit(2);
}
if (!CRON_SECRET || !CRON_JWT) {
  console.error(
    'GATED: export PROCESSING_ASANA_CRON_SECRET + PROCESSING_ASANA_CRON_SERVICE_ROLE_KEY (activation-time values).',
  );
  process.exit(2);
}

const {createClient} = require(path.join(__dirname, '..', 'node_modules', '@supabase', 'supabase-js'));
const service = createClient(url, serviceKey, {auth: {autoRefreshToken: false, persistSession: false}});

let checks = 0;
function ok(cond, label, detail) {
  checks += 1;
  if (!cond) throw new Error(`FAIL [${label}]${detail ? `: ${detail}` : ''}`);
  console.log(`ok ${checks}. ${label}`);
}

async function execSql(sql, label) {
  const {error} = await service.rpc('exec_sql', {sql});
  if (error) throw new Error(`${label}: ${error.message || String(error)}`);
}

async function cronPost(headers) {
  const res = await fetch(`${url}/functions/v1/processing-asana-sync`, {
    method: 'POST',
    headers: {'Content-Type': 'application/json', ...headers},
    body: JSON.stringify({mode: 'cron', action: 'sync_once'}), // action must be IGNORED
  });
  const text = await res.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch (_e) {
    json = null;
  }
  return {status: res.status, json};
}

(async () => {
  const before = await service
    .from('processing_asana_sync_settings')
    .select('asana_sync_enabled, asana_comments_import_enabled')
    .eq('id', 'singleton')
    .single();
  if (before.error) throw new Error(`read settings: ${before.error.message}`);
  try {
    // 1. auth fails closed
    const noAuth = await cronPost({});
    ok(noAuth.status === 401, 'cron without credentials → 401');
    const badAuth = await cronPost({Authorization: 'Bearer nope', 'x-cron-secret': 'nope'});
    ok(badAuth.status === 401, 'cron with wrong credentials → 401');

    const goodHeaders = {Authorization: `Bearer ${CRON_JWT}`, 'x-cron-secret': CRON_SECRET};

    // 2. both flags false → 423, action pinned to sync_comments
    await execSql(
      "UPDATE public.processing_asana_sync_settings SET asana_sync_enabled=false, asana_comments_import_enabled=false WHERE id='singleton';",
      'flags off',
    );
    const locked = await cronPost(goodHeaders);
    ok(locked.status === 423, 'both flags false → 423 (fail closed)', `status ${locked.status}`);
    ok(locked.json && locked.json.action === 'sync_comments', 'cron response action is PINNED to sync_comments');
    ok(
      /comments import is locked/.test((locked.json && locked.json.error) || ''),
      'locked message names the comments gate',
    );

    // 3. comments flag alone opens the gate for the pinned action
    await execSql(
      "UPDATE public.processing_asana_sync_settings SET asana_comments_import_enabled=true WHERE id='singleton';",
      'comments flag on',
    );
    const run1 = await cronPost(goodHeaders);
    ok(run1.json && run1.json.action !== 'sync_once', 'no response ever names sync_once');
    if (run1.status === 503) {
      ok(run1.json && run1.json.asanaConfigured === false, 'no TEST Asana token → truthful 503 fail-closed');
      console.log('NOTE: TEST has no ASANA_ACCESS_TOKEN — live import legs run at PROD activation instead.');
    } else {
      ok(
        run1.status === 200 && run1.json && run1.json.ok === true,
        'comments-only cron run completed',
        JSON.stringify(run1.json).slice(0, 300),
      );
      ok(run1.json.action === 'sync_comments', 'completed run action is sync_comments');
      const counts1 = run1.json.counts || {};
      ok(
        counts1.reconcile === undefined && counts1.plannerRows === undefined,
        'counts carry NO sync_once/planner keys',
      );
      ok(typeof counts1.commentsFound === 'number', 'counts.commentsFound present');
      // 4. idempotent second run
      const run2 = await cronPost(goodHeaders);
      ok(run2.status === 200 && run2.json.ok === true, 'second run completed');
      ok(
        (run2.json.counts || {}).inserted === 0,
        'second run inserted 0 (idempotent)',
        JSON.stringify(run2.json.counts),
      );
      const runs = await service
        .from('processing_asana_sync_runs')
        .select('action, status')
        .in('id', [run1.json.runId, run2.json.runId].filter(Boolean));
      ok(
        !runs.error &&
          runs.data.length === 2 &&
          runs.data.every((r) => r.action === 'sync_comments' && r.status === 'ok'),
        'both runs bracketed as action=sync_comments in processing_asana_sync_runs',
      );
    }

    console.log(`\nALL ${checks} CHECKS PASSED — comments-only cron contract proven on TEST`);
  } finally {
    const restore = await service
      .from('processing_asana_sync_settings')
      .update({
        asana_sync_enabled: before.data.asana_sync_enabled,
        asana_comments_import_enabled: before.data.asana_comments_import_enabled,
      })
      .eq('id', 'singleton');
    console.log(restore.error ? `settings restore FAILED: ${restore.error.message}` : 'settings restored');
    if (restore.error) process.exitCode = 1;
  }
})().catch((e) => {
  console.error(e && e.message ? e.message : e);
  process.exitCode = 1;
});
