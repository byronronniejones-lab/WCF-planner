// Apply mig 108 (delete_feed_input SECDEF RPC) to TEST via exec_sql.
// BEGIN/COMMIT-free CREATE OR REPLACE + REVOKE/GRANT + NOTIFY. Hard PROD-ref
// guard. After apply, smokes structurally (exists, SECDEF, search_path,
// grants/anon-deny) and behaviorally: seed a feed input + 2 tests, call the RPC
// as an authenticated caller, assert the feed + its tests are gone and ONE
// record.deleted cattle.forecast activity row was written on the
// 'cattle-forecast' singleton stream (then roll the probe back); assert an
// unauthenticated caller is rejected and a stale/no-input id returns no_input
// without writing. exec_sql returns void, so every guard RAISEs to surface a
// wrong state.
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
const PROD_REF = 'pzfujbjtayhkdlxiblwe';
if (!url || !key) {
  console.error('missing TEST env');
  process.exit(2);
}
if (url.includes(PROD_REF)) {
  console.error('refusing to run against PROD url');
  process.exit(2);
}
const file = path.join(__dirname, '..', 'supabase-migrations', '108_delete_feed_input_rpc.sql');
const body = fs.readFileSync(file, 'utf8');
const {createClient} = require(path.join(__dirname, '..', 'node_modules', '@supabase', 'supabase-js'));
const sb = createClient(url, key, {auth: {autoRefreshToken: false, persistSession: false}});

const SIG = 'public.delete_feed_input(text)';

(async () => {
  console.log(`TEST url=${url}`);
  console.log(`applying 108 body (${body.length} bytes)`);
  const {error} = await sb.rpc('exec_sql', {sql: body});
  if (error) {
    console.error('exec_sql APPLY failed:', error.message || error);
    process.exit(1);
  }
  console.log('apply OK');

  const smokes = [
    {
      label: 'function exists + SECDEF + search_path=public',
      sql: `DO $$
DECLARE r record;
BEGIN
  PERFORM '${SIG}'::regprocedure;
  SELECT prosecdef, proconfig INTO r FROM pg_proc WHERE oid = '${SIG}'::regprocedure;
  IF NOT r.prosecdef THEN RAISE EXCEPTION 'not SECURITY DEFINER'; END IF;
  IF r.proconfig IS NULL OR NOT ('search_path=public' = ANY(r.proconfig)) THEN
    RAISE EXCEPTION 'search_path not public: %', r.proconfig;
  END IF;
END $$;`,
    },
    {
      label: 'authenticated has EXECUTE, anon does not',
      sql: `DO $$
BEGIN
  IF NOT has_function_privilege('authenticated', '${SIG}', 'EXECUTE') THEN RAISE EXCEPTION 'authenticated lacks EXECUTE'; END IF;
  IF has_function_privilege('anon', '${SIG}', 'EXECUTE') THEN RAISE EXCEPTION 'anon must NOT have EXECUTE'; END IF;
END $$;`,
    },
    {
      label:
        'authenticated caller deletes feed + cascaded tests + writes ONE record.deleted cattle.forecast activity (rolled back)',
      sql: `DO $$
DECLARE
  v_caller uuid; v_feed text := '__mig108_feed__'; v_r jsonb;
  v_tests int; v_ae int;
BEGIN
  SELECT id INTO v_caller FROM public.profiles WHERE role IS DISTINCT FROM 'inactive' LIMIT 1;
  IF v_caller IS NULL THEN RAISE NOTICE 'no eligible profile; delete smoke skipped'; RETURN; END IF;

  -- Clean any prior probe rows, then seed a feed input + 2 tests.
  DELETE FROM public.cattle_feed_inputs WHERE id = v_feed;
  INSERT INTO public.cattle_feed_inputs (id, name, category, unit, status)
    VALUES (v_feed, 'MIG108 Probe Feed', 'hay', 'bale', 'active');
  INSERT INTO public.cattle_feed_tests (id, feed_input_id, effective_date, moisture_pct)
    VALUES ('__mig108_t1__', v_feed, CURRENT_DATE, 12.3),
           ('__mig108_t2__', v_feed, CURRENT_DATE - 30, 14.5);

  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_caller::text)::text, true);
  v_r := public.delete_feed_input(v_feed);
  IF (v_r->>'ok') <> 'true' OR (v_r->>'reason') <> 'deleted' THEN
    RAISE EXCEPTION 'delete not ok/deleted: %', v_r;
  END IF;
  IF (v_r->>'tests_deleted') <> '2' THEN RAISE EXCEPTION 'expected tests_deleted=2, got %', v_r; END IF;

  -- Feed root gone.
  IF EXISTS (SELECT 1 FROM public.cattle_feed_inputs WHERE id = v_feed) THEN
    RAISE EXCEPTION 'feed input row not deleted';
  END IF;
  -- Tests cascaded away.
  SELECT count(*) INTO v_tests FROM public.cattle_feed_tests WHERE feed_input_id = v_feed;
  IF v_tests <> 0 THEN RAISE EXCEPTION 'expected 0 cascaded tests, got %', v_tests; END IF;
  -- Exactly one record.deleted cattle.forecast activity row on the singleton
  -- stream, carrying the deleted feed id in the payload.
  SELECT count(*) INTO v_ae FROM public.activity_events
    WHERE entity_type = 'cattle.forecast' AND entity_id = 'cattle-forecast'
      AND event_type = 'record.deleted' AND payload->>'feed_input_id' = v_feed;
  IF v_ae <> 1 THEN RAISE EXCEPTION 'expected 1 record.deleted feed activity row, got %', v_ae; END IF;

  -- Roll the probe back: drop the activity row we just wrote (the feed/tests are
  -- already gone via the RPC). Best-effort cleanup of probe state.
  DELETE FROM public.activity_events WHERE entity_id = 'cattle-forecast' AND payload->>'feed_input_id' = v_feed;
END $$;`,
    },
    {
      label: 'unauthenticated rejected; stale/no-input id returns no_input without writing',
      sql: `DO $$
DECLARE v_caller uuid; v_raised boolean; v_r jsonb; v_ae_before int; v_ae_after int;
BEGIN
  -- Unauthenticated rejected.
  PERFORM set_config('request.jwt.claims', '{}', true);
  v_raised := false;
  BEGIN PERFORM public.delete_feed_input('__nope__'); EXCEPTION WHEN OTHERS THEN v_raised := true; END;
  IF NOT v_raised THEN RAISE EXCEPTION 'expected auth rejection (unauthenticated)'; END IF;

  SELECT id INTO v_caller FROM public.profiles WHERE role IS DISTINCT FROM 'inactive' LIMIT 1;
  IF v_caller IS NULL THEN RAISE NOTICE 'no eligible profile; no_input smoke skipped'; RETURN; END IF;

  -- A non-existent feed id returns no_input and writes no activity row.
  SELECT count(*) INTO v_ae_before FROM public.activity_events
    WHERE entity_type = 'cattle.forecast' AND event_type = 'record.deleted';
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_caller::text)::text, true);
  v_r := public.delete_feed_input('__mig108_absent__');
  IF (v_r->>'ok') <> 'false' OR (v_r->>'reason') <> 'no_input' THEN
    RAISE EXCEPTION 'expected no_input for absent feed, got %', v_r;
  END IF;
  SELECT count(*) INTO v_ae_after FROM public.activity_events
    WHERE entity_type = 'cattle.forecast' AND event_type = 'record.deleted';
  IF v_ae_after <> v_ae_before THEN
    RAISE EXCEPTION 'no_input must NOT write an activity row (before %, after %)', v_ae_before, v_ae_after;
  END IF;

  -- A NULL/blank id returns bad_args.
  v_r := public.delete_feed_input('');
  IF (v_r->>'ok') <> 'false' OR (v_r->>'reason') <> 'bad_args' THEN
    RAISE EXCEPTION 'expected bad_args for blank id, got %', v_r;
  END IF;
END $$;`,
    },
  ];

  let allOk = true;
  for (const s of smokes) {
    const {error: e2} = await sb.rpc('exec_sql', {sql: s.sql});
    if (e2) allOk = false;
    console.log(`  smoke ${s.label}: ${e2 ? 'ERROR ' + (e2.message || e2) : 'OK'}`);
  }
  console.log(allOk ? 'done OK' : 'done WITH ERRORS');
  if (!allOk) process.exit(1);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
