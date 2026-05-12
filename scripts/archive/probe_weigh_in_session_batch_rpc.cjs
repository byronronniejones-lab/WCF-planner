// Pre-deploy probe — verifies that submit_weigh_in_session_batch (mig 035)
// is deployed and reachable via anon EXECUTE before any runtime cutover.
//
// What it does:
//   1. Reads VITE_SUPABASE_URL + VITE_SUPABASE_ANON_KEY from process.env.
//   2. Calls sb.rpc('submit_weigh_in_session_batch', {parent_in: {}, entries_in: []})
//      using an anon supabase-js client.
//   3. Expects error.code === 'P0001' and message containing
//      "client_submission_id required" — the function exists, anon EXECUTE
//      grant works, and the validation RAISE fires before any DB write.
//   4. If instead PGRST202 / "Could not find the function" or any other
//      response shape comes back, exits non-zero with a clear hint.
//
// No rows are inserted: mig 035's first validation check (RAISE EXCEPTION on
// missing client_submission_id) fires before the parent INSERT statement.
// Also locked by tests/weigh_in_session_batch_rpc.spec.js Test 9 + Test 11.
//
// Codex review v2 #6 — runtime deploy gate. Documentation alone is not
// sufficient evidence that mig 035 is applied to a given environment.
//
// Usage:
//   VITE_SUPABASE_URL=https://… VITE_SUPABASE_ANON_KEY=… \
//     node scripts/probe_weigh_in_session_batch_rpc.cjs
//
// Or after `source .env` / per-env shell setup that exports those vars.

const {createClient} = require('@supabase/supabase-js');

(async () => {
  const url = process.env.VITE_SUPABASE_URL;
  const key = process.env.VITE_SUPABASE_ANON_KEY;
  if (!url || !key) {
    console.error('probe_weigh_in_session_batch_rpc: missing env');
    console.error('Required: VITE_SUPABASE_URL + VITE_SUPABASE_ANON_KEY');
    console.error('Tip: source .env (or .env.test) before running, or export inline.');
    process.exitCode = 1;
    return;
  }

  const sb = createClient(url, key, {
    auth: {autoRefreshToken: false, persistSession: false},
  });

  console.log(`Probing ${url} ...`);
  let res;
  try {
    res = await sb.rpc('submit_weigh_in_session_batch', {
      parent_in: {},
      entries_in: [],
    });
  } catch (e) {
    console.error('FAIL — RPC threw synchronously:');
    console.error(e);
    process.exitCode = 1;
    return;
  }

  const {data, error} = res;

  // process.exitCode + return (instead of process.exit) avoids the
  // Windows libuv "UV_HANDLE_CLOSING" assertion that fires when
  // supabase-js's keepalive fetch handles haven't finished tearing down
  // before a forced exit. Node drains the event loop naturally and the
  // process exits with the chosen code.
  if (!error) {
    console.error('FAIL — RPC returned data without error. The function exists but');
    console.error('did not raise on empty payload, which means mig 035 contract drift.');
    console.error('data:', data);
    process.exitCode = 1;
    return;
  }

  // PGRST202 = "Could not find the function in the schema cache" → mig 035
  // not deployed (or schema cache stale; pgrst NOTIFY reload usually fixes
  // staleness, but the deploy script handles that).
  if (error.code === 'PGRST202' || /could not find the function/i.test(String(error.message))) {
    console.error('FAIL — submit_weigh_in_session_batch is not deployed.');
    console.error('Apply mig 035 (supabase-migrations/035_weigh_in_session_batch_rpc.sql)');
    console.error('to this environment before the runtime cutover.');
    console.error('error:', error);
    process.exitCode = 1;
    return;
  }

  if (error.code !== 'P0001') {
    console.error('FAIL — unexpected error code. Expected P0001 (validation RAISE).');
    console.error('error:', error);
    process.exitCode = 1;
    return;
  }

  if (!/client_submission_id required/i.test(String(error.message))) {
    console.error('FAIL — P0001 fired but message does not match expected validation.');
    console.error('Expected: "...client_submission_id required..."');
    console.error('Got:     ', error.message);
    process.exitCode = 1;
    return;
  }

  console.log('OK — submit_weigh_in_session_batch is deployed.');
  console.log(`     P0001 with "${error.message}" returned as expected.`);
  // Default exit code 0; Node drains and exits.
})().catch((e) => {
  console.error('FAIL — unhandled error:');
  console.error(e);
  process.exitCode = 1;
});
