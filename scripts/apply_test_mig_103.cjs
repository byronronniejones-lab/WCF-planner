// Apply mig 103 (weigh-in delete FOR UPDATE hardening) to TEST via exec_sql.
// BEGIN/COMMIT-free CREATE OR REPLACE of the two mig-101 RPCs. Hard PROD-ref
// guard. After apply, smokes structurally (exists, SECDEF, search_path,
// grants/anon-deny) and behaviorally: round-trips still work; the second delete
// of the same id returns no_entry/no_session and writes NO duplicate audit (the
// idempotency the FOR UPDATE fix enforces). exec_sql returns void, so every
// guard RAISEs to surface a wrong state.
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
const file = path.join(__dirname, '..', 'supabase-migrations', '103_weighin_delete_for_update_hardening.sql');
const body = fs.readFileSync(file, 'utf8');
const {createClient} = require(path.join(__dirname, '..', 'node_modules', '@supabase', 'supabase-js'));
const sb = createClient(url, key, {auth: {autoRefreshToken: false, persistSession: false}});

const ESIG = 'public.delete_weigh_in_entry(text,text,text)';
const SSIG = 'public.delete_weigh_in_session(text,text,text)';

(async () => {
  console.log(`TEST url=${url}`);
  console.log(`applying 103 body (${body.length} bytes)`);
  const {error} = await sb.rpc('exec_sql', {sql: body});
  if (error) {
    console.error('exec_sql APPLY failed:', error.message || error);
    process.exit(1);
  }
  console.log('apply OK');

  const smokes = [
    {
      label: 'both functions still exist + SECDEF + search_path=public',
      sql: `DO $$
DECLARE r record;
BEGIN
  PERFORM '${ESIG}'::regprocedure; PERFORM '${SSIG}'::regprocedure;
  FOR r IN SELECT proname, prosecdef, proconfig FROM pg_proc
           WHERE oid IN ('${ESIG}'::regprocedure, '${SSIG}'::regprocedure) LOOP
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
  IF NOT has_function_privilege('authenticated', '${ESIG}', 'EXECUTE') THEN RAISE EXCEPTION 'authenticated lacks EXECUTE on delete_weigh_in_entry'; END IF;
  IF NOT has_function_privilege('authenticated', '${SSIG}', 'EXECUTE') THEN RAISE EXCEPTION 'authenticated lacks EXECUTE on delete_weigh_in_session'; END IF;
  IF has_function_privilege('anon', '${ESIG}', 'EXECUTE') THEN RAISE EXCEPTION 'anon must NOT have EXECUTE on delete_weigh_in_entry'; END IF;
  IF has_function_privilege('anon', '${SSIG}', 'EXECUTE') THEN RAISE EXCEPTION 'anon must NOT have EXECUTE on delete_weigh_in_session'; END IF;
END $$;`,
    },
    {
      label: 'entry: round-trip ok + second delete is no_entry with no duplicate audit',
      sql: `DO $$
DECLARE v_pid uuid; v_r1 jsonb; v_r2 jsonb; v_before int; v_after int; v_cnt int;
BEGIN
  SELECT id INTO v_pid FROM public.profiles LIMIT 1;
  IF v_pid IS NULL THEN RAISE NOTICE 'no profile; entry idempotency skipped'; RETURN; END IF;
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_pid::text)::text, true);
  DELETE FROM public.weigh_in_sessions WHERE id = '__mig103_es__';
  INSERT INTO public.weigh_in_sessions(id, date, species, status) VALUES ('__mig103_es__', CURRENT_DATE, 'cattle', 'draft');
  INSERT INTO public.weigh_ins(id, session_id, tag, weight) VALUES ('__mig103_ee__', '__mig103_es__', 'T1', 50);
  v_r1 := public.delete_weigh_in_entry('__mig103_ee__', '2026 probe', 'mig103');
  IF (v_r1->>'ok') <> 'true' THEN RAISE EXCEPTION 'first entry delete not ok: %', v_r1; END IF;
  SELECT count(*) INTO v_cnt FROM public.weigh_ins WHERE id = '__mig103_ee__';
  IF v_cnt <> 0 THEN RAISE EXCEPTION 'entry not deleted'; END IF;
  SELECT count(*) INTO v_before FROM public.activity_events WHERE entity_id = '__mig103_es__';
  v_r2 := public.delete_weigh_in_entry('__mig103_ee__', '2026 probe', 'mig103');
  IF (v_r2->>'reason') <> 'no_entry' THEN RAISE EXCEPTION 'second entry delete should be no_entry, got %', v_r2; END IF;
  SELECT count(*) INTO v_after FROM public.activity_events WHERE entity_id = '__mig103_es__';
  IF v_after <> v_before THEN RAISE EXCEPTION 'second entry delete duplicated audit (% -> %)', v_before, v_after; END IF;
  DELETE FROM public.activity_events WHERE id = (v_r1->>'event_id');
  DELETE FROM public.weigh_in_sessions WHERE id = '__mig103_es__';
END $$;`,
    },
    {
      label: 'session: round-trip ok + second delete is no_session with no duplicate audit',
      sql: `DO $$
DECLARE v_pid uuid; v_r1 jsonb; v_r2 jsonb; v_before int; v_after int; v_cnt int;
BEGIN
  SELECT id INTO v_pid FROM public.profiles LIMIT 1;
  IF v_pid IS NULL THEN RAISE NOTICE 'no profile; session idempotency skipped'; RETURN; END IF;
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_pid::text)::text, true);
  DELETE FROM public.weigh_in_sessions WHERE id = '__mig103_ss__';
  INSERT INTO public.weigh_in_sessions(id, date, species, status) VALUES ('__mig103_ss__', CURRENT_DATE, 'cattle', 'draft');
  INSERT INTO public.weigh_ins(id, session_id, tag, weight) VALUES ('__mig103_s1__', '__mig103_ss__', 'A', 80);
  v_r1 := public.delete_weigh_in_session('__mig103_ss__', '2026 probe', 'mig103');
  IF (v_r1->>'ok') <> 'true' THEN RAISE EXCEPTION 'first session delete not ok: %', v_r1; END IF;
  SELECT count(*) INTO v_cnt FROM public.weigh_in_sessions WHERE id = '__mig103_ss__';
  IF v_cnt <> 0 THEN RAISE EXCEPTION 'session not deleted'; END IF;
  SELECT count(*) INTO v_before FROM public.activity_events WHERE entity_id = '__mig103_ss__';
  v_r2 := public.delete_weigh_in_session('__mig103_ss__', '2026 probe', 'mig103');
  IF (v_r2->>'reason') <> 'no_session' THEN RAISE EXCEPTION 'second session delete should be no_session, got %', v_r2; END IF;
  SELECT count(*) INTO v_after FROM public.activity_events WHERE entity_id = '__mig103_ss__';
  IF v_after <> v_before THEN RAISE EXCEPTION 'second session delete duplicated audit (% -> %)', v_before, v_after; END IF;
  DELETE FROM public.activity_events WHERE id = (v_r1->>'event_id');
  DELETE FROM public.weigh_in_sessions WHERE id = '__mig103_ss__';
END $$;`,
    },
    {
      label: 'unauthenticated caller still rejected',
      sql: `DO $$
DECLARE v_raised boolean := false;
BEGIN
  PERFORM set_config('request.jwt.claims', '{}', true);
  BEGIN PERFORM public.delete_weigh_in_entry('__x__', NULL, NULL); EXCEPTION WHEN OTHERS THEN v_raised := true; END;
  IF NOT v_raised THEN RAISE EXCEPTION 'expected auth rejection (entry)'; END IF;
  v_raised := false;
  BEGIN PERFORM public.delete_weigh_in_session('__x__', NULL, NULL); EXCEPTION WHEN OTHERS THEN v_raised := true; END;
  IF NOT v_raised THEN RAISE EXCEPTION 'expected auth rejection (session)'; END IF;
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
