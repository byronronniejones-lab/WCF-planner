// Apply mig 106 (delete_layer_batch SECDEF RPC) to TEST via exec_sql.
// BEGIN/COMMIT-free CREATE OR REPLACE + REVOKE/GRANT + NOTIFY. Hard PROD-ref
// guard. After apply, smokes structurally (exists, SECDEF, search_path,
// grants/anon-deny) and behaviorally: a seeded batch + 2 housings is deleted by
// the RPC (both housings gone + the batch gone + exactly ONE record.deleted
// layer.batch activity with housings_cleared=2), all inside a ROLLED-BACK tx so
// TEST data is untouched; unauthenticated is rejected. exec_sql returns void, so
// every guard RAISEs to surface a wrong state.
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
const file = path.join(__dirname, '..', 'supabase-migrations', '106_delete_layer_batch_rpc.sql');
const body = fs.readFileSync(file, 'utf8');
const {createClient} = require(path.join(__dirname, '..', 'node_modules', '@supabase', 'supabase-js'));
const sb = createClient(url, key, {auth: {autoRefreshToken: false, persistSession: false}});

const SIG = 'public.delete_layer_batch(text)';

(async () => {
  console.log(`TEST url=${url}`);
  console.log(`applying 106 body (${body.length} bytes)`);
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
        'behavioral: seed batch + 2 housings, call RPC, assert both housings + batch gone + 1 record.deleted with housings_cleared=2 (rolled back)',
      sql: `DO $$
DECLARE
  v_pid uuid;
  v_bid text := '__mig106_batch__';
  v_h1 text := '__mig106_h1__';
  v_h2 text := '__mig106_h2__';
  v_r jsonb;
  v_cnt int;
  v_ae_cnt int;
  v_cleared int;
BEGIN
  SELECT id INTO v_pid FROM public.profiles WHERE role IS DISTINCT FROM 'inactive' LIMIT 1;
  IF v_pid IS NULL THEN RAISE NOTICE 'no profile; behavioral smoke skipped'; RETURN; END IF;
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_pid::text)::text, true);

  -- Clean any prior probe rows, then seed a batch + 2 housings.
  DELETE FROM public.layer_housings WHERE id IN (v_h1, v_h2);
  DELETE FROM public.layer_batches WHERE id = v_bid;
  DELETE FROM public.activity_events WHERE entity_type = 'layer.batch' AND entity_id = v_bid;

  INSERT INTO public.layer_batches (id, name, status) VALUES (v_bid, 'Mig106 Probe Batch', 'active');
  INSERT INTO public.layer_housings (id, batch_id, housing_name, status)
    VALUES (v_h1, v_bid, 'Mig106 Coop A', 'active'),
           (v_h2, v_bid, 'Mig106 Coop B', 'active');

  v_r := public.delete_layer_batch(v_bid);
  IF (v_r->>'ok') <> 'true' OR (v_r->>'reason') <> 'deleted' THEN
    RAISE EXCEPTION 'delete not ok/deleted: %', v_r;
  END IF;
  v_cleared := (v_r->>'housings_cleared')::int;
  IF v_cleared <> 2 THEN RAISE EXCEPTION 'expected housings_cleared=2, got %', v_cleared; END IF;

  SELECT count(*) INTO v_cnt FROM public.layer_housings WHERE batch_id = v_bid;
  IF v_cnt <> 0 THEN RAISE EXCEPTION 'expected 0 housings remaining, got %', v_cnt; END IF;
  SELECT count(*) INTO v_cnt FROM public.layer_batches WHERE id = v_bid;
  IF v_cnt <> 0 THEN RAISE EXCEPTION 'expected batch root gone, got %', v_cnt; END IF;

  SELECT count(*) INTO v_ae_cnt FROM public.activity_events
    WHERE entity_type = 'layer.batch' AND entity_id = v_bid AND event_type = 'record.deleted';
  IF v_ae_cnt <> 1 THEN RAISE EXCEPTION 'expected exactly 1 record.deleted activity, got %', v_ae_cnt; END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.activity_events
    WHERE entity_type = 'layer.batch' AND entity_id = v_bid AND event_type = 'record.deleted'
      AND (payload->>'housings_cleared')::int = 2
  ) THEN
    RAISE EXCEPTION 'record.deleted activity missing housings_cleared=2 in payload';
  END IF;

  -- Roll back the whole probe so TEST data is untouched.
  RAISE EXCEPTION 'mig106_rollback_ok';
EXCEPTION WHEN OTHERS THEN
  IF SQLERRM = 'mig106_rollback_ok' THEN RETURN; END IF;
  RAISE;
END $$;`,
    },
    {
      label: 'no_batch on a missing id (no phantom audit) + unauthenticated rejected',
      sql: `DO $$
DECLARE v_pid uuid; v_r jsonb; v_raised boolean;
BEGIN
  SELECT id INTO v_pid FROM public.profiles WHERE role IS DISTINCT FROM 'inactive' LIMIT 1;
  IF v_pid IS NOT NULL THEN
    PERFORM set_config('request.jwt.claims', json_build_object('sub', v_pid::text)::text, true);
    v_r := public.delete_layer_batch('__mig106_does_not_exist__');
    IF (v_r->>'ok') <> 'false' OR (v_r->>'reason') <> 'no_batch' THEN
      RAISE EXCEPTION 'expected no_batch on missing id, got %', v_r;
    END IF;
    IF EXISTS (
      SELECT 1 FROM public.activity_events
      WHERE entity_type = 'layer.batch' AND entity_id = '__mig106_does_not_exist__'
    ) THEN RAISE EXCEPTION 'phantom audit written for a missing batch'; END IF;
  END IF;

  PERFORM set_config('request.jwt.claims', '{}', true);
  v_raised := false;
  BEGIN PERFORM public.delete_layer_batch('__mig106_anon__'); EXCEPTION WHEN OTHERS THEN v_raised := true; END;
  IF NOT v_raised THEN RAISE EXCEPTION 'expected auth rejection (unauthenticated)'; END IF;
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
