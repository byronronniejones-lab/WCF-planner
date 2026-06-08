// Apply mig 100 (processing-batch lifecycle RPCs) to TEST via exec_sql. The
// migration is BEGIN/COMMIT-free, so no transaction-wrapper stripping is needed.
// Hard PROD-ref guard. After apply, smokes the two RPCs structurally (exists,
// SECDEF, search_path, grants/anon-deny) and behaviorally (seed → call → row
// gone + audit written → self-cleanup). exec_sql returns void, so every guard
// RAISEs to surface a wrong state as an error.
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
const file = path.join(__dirname, '..', 'supabase-migrations', '100_processing_batch_lifecycle_rpcs.sql');
const body = fs.readFileSync(file, 'utf8');
const {createClient} = require(path.join(__dirname, '..', 'node_modules', '@supabase', 'supabase-js'));
const sb = createClient(url, key, {auth: {autoRefreshToken: false, persistSession: false}});

const CSIG = 'public.unschedule_cattle_processing_batch(text,text)';
const SSIG = 'public.delete_sheep_processing_batch(text,text)';

(async () => {
  console.log(`TEST url=${url}`);
  console.log(`applying 100 body (${body.length} bytes)`);
  const {error} = await sb.rpc('exec_sql', {sql: body});
  if (error) {
    console.error('exec_sql APPLY failed:', error.message || error);
    process.exit(1);
  }
  console.log('apply OK');

  const smokes = [
    {
      label: 'both functions exist',
      sql: `DO $$ BEGIN PERFORM '${CSIG}'::regprocedure; PERFORM '${SSIG}'::regprocedure; END $$;`,
    },
    {
      label: 'both SECURITY DEFINER + search_path=public',
      sql: `DO $$
DECLARE r record;
BEGIN
  FOR r IN SELECT oid, proname, prosecdef, proconfig FROM pg_proc
           WHERE oid IN ('${CSIG}'::regprocedure, '${SSIG}'::regprocedure) LOOP
    IF NOT r.prosecdef THEN RAISE EXCEPTION '% is not SECURITY DEFINER', r.proname; END IF;
    IF r.proconfig IS NULL OR NOT ('search_path=public' = ANY(r.proconfig)) THEN
      RAISE EXCEPTION '% search_path not public: %', r.proname, r.proconfig;
    END IF;
  END LOOP;
END $$;`,
    },
    {
      label: 'authenticated has EXECUTE, anon does not',
      sql: `DO $$
BEGIN
  IF NOT has_function_privilege('authenticated', '${CSIG}', 'EXECUTE') THEN RAISE EXCEPTION 'authenticated lacks EXECUTE on unschedule'; END IF;
  IF NOT has_function_privilege('authenticated', '${SSIG}', 'EXECUTE') THEN RAISE EXCEPTION 'authenticated lacks EXECUTE on delete_sheep'; END IF;
  IF has_function_privilege('anon', '${CSIG}', 'EXECUTE') THEN RAISE EXCEPTION 'anon must NOT have EXECUTE on unschedule'; END IF;
  IF has_function_privilege('anon', '${SSIG}', 'EXECUTE') THEN RAISE EXCEPTION 'anon must NOT have EXECUTE on delete_sheep'; END IF;
END $$;`,
    },
    {
      label: 'cattle round-trip (scheduled → unschedule → gone + audit)',
      sql: `DO $$
DECLARE v_pid uuid; v_res jsonb; v_cnt int; v_evt int;
BEGIN
  SELECT id INTO v_pid FROM public.profiles WHERE role IN ('admin','management') LIMIT 1;
  IF v_pid IS NULL THEN RAISE NOTICE 'no admin/management profile; cattle round-trip skipped'; RETURN; END IF;
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_pid::text)::text, true);
  DELETE FROM public.cattle_processing_batches WHERE id = '__mig100_cprobe__';
  INSERT INTO public.cattle_processing_batches(id, name, status)
    VALUES ('__mig100_cprobe__', '__mig100_cprobe__', 'scheduled');
  v_res := public.unschedule_cattle_processing_batch('__mig100_cprobe__', 'mig100-probe');
  IF (v_res->>'ok') <> 'true' THEN RAISE EXCEPTION 'cattle unschedule not ok: %', v_res; END IF;
  SELECT count(*) INTO v_cnt FROM public.cattle_processing_batches WHERE id = '__mig100_cprobe__';
  IF v_cnt <> 0 THEN RAISE EXCEPTION 'cattle batch row not deleted'; END IF;
  SELECT count(*) INTO v_evt FROM public.activity_events
    WHERE id = (v_res->>'event_id') AND entity_type = 'cattle.processing' AND event_type = 'record.deleted';
  IF v_evt <> 1 THEN RAISE EXCEPTION 'cattle record.deleted audit missing'; END IF;
  DELETE FROM public.activity_events WHERE id = (v_res->>'event_id');
END $$;`,
    },
    {
      label: 'cattle not_scheduled guard (active batch is refused, not deleted)',
      sql: `DO $$
DECLARE v_pid uuid; v_res jsonb; v_cnt int;
BEGIN
  SELECT id INTO v_pid FROM public.profiles WHERE role IN ('admin','management') LIMIT 1;
  IF v_pid IS NULL THEN RAISE NOTICE 'no admin/management profile; not_scheduled guard skipped'; RETURN; END IF;
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_pid::text)::text, true);
  DELETE FROM public.cattle_processing_batches WHERE id = '__mig100_cactive__';
  INSERT INTO public.cattle_processing_batches(id, name, status)
    VALUES ('__mig100_cactive__', '__mig100_cactive__', 'active');
  v_res := public.unschedule_cattle_processing_batch('__mig100_cactive__', 'mig100-probe');
  IF (v_res->>'ok') <> 'false' OR (v_res->>'reason') <> 'not_scheduled' THEN
    RAISE EXCEPTION 'expected not_scheduled refusal, got %', v_res;
  END IF;
  SELECT count(*) INTO v_cnt FROM public.cattle_processing_batches WHERE id = '__mig100_cactive__';
  IF v_cnt <> 1 THEN RAISE EXCEPTION 'active batch should NOT have been deleted'; END IF;
  DELETE FROM public.cattle_processing_batches WHERE id = '__mig100_cactive__';
END $$;`,
    },
    {
      // Note: this seeds a batch with no attached sheep, so it exercises the
      // delete + record.deleted audit path. The straggler-clear UPDATE in the
      // RPC is a 0-row no-op here; its logic is covered by source review (the
      // WHERE processing_batch_id = p_batch_id clause).
      label: 'sheep round-trip (seed → delete → row gone + record.deleted audit)',
      sql: `DO $$
DECLARE v_pid uuid; v_res jsonb; v_cnt int; v_evt int;
BEGIN
  SELECT id INTO v_pid FROM public.profiles WHERE role IN ('admin','management') LIMIT 1;
  IF v_pid IS NULL THEN RAISE NOTICE 'no admin/management profile; sheep round-trip skipped'; RETURN; END IF;
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_pid::text)::text, true);
  DELETE FROM public.sheep_processing_batches WHERE id = '__mig100_sprobe__';
  INSERT INTO public.sheep_processing_batches(id, name, status)
    VALUES ('__mig100_sprobe__', '__mig100_sprobe__', 'planned');
  v_res := public.delete_sheep_processing_batch('__mig100_sprobe__', 'mig100-probe');
  IF (v_res->>'ok') <> 'true' THEN RAISE EXCEPTION 'sheep delete not ok: %', v_res; END IF;
  SELECT count(*) INTO v_cnt FROM public.sheep_processing_batches WHERE id = '__mig100_sprobe__';
  IF v_cnt <> 0 THEN RAISE EXCEPTION 'sheep batch row not deleted'; END IF;
  SELECT count(*) INTO v_evt FROM public.activity_events
    WHERE id = (v_res->>'event_id') AND entity_type = 'sheep.processing' AND event_type = 'record.deleted';
  IF v_evt <> 1 THEN RAISE EXCEPTION 'sheep record.deleted audit missing'; END IF;
  DELETE FROM public.activity_events WHERE id = (v_res->>'event_id');
END $$;`,
    },
    {
      label: 'no_batch path for a missing id',
      sql: `DO $$
DECLARE v_pid uuid; v_res jsonb;
BEGIN
  SELECT id INTO v_pid FROM public.profiles WHERE role IN ('admin','management') LIMIT 1;
  IF v_pid IS NULL THEN RAISE NOTICE 'no admin/management profile; no_batch path skipped'; RETURN; END IF;
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_pid::text)::text, true);
  v_res := public.delete_sheep_processing_batch('__mig100_missing__', 'mig100-probe');
  IF (v_res->>'reason') <> 'no_batch' THEN RAISE EXCEPTION 'expected no_batch, got %', v_res; END IF;
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
