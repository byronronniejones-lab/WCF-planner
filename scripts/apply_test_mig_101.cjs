// Apply mig 101 (weigh-in delete + Activity RPCs) to TEST via exec_sql. The
// migration is BEGIN/COMMIT-free, so no transaction-wrapper stripping is needed.
// Hard PROD-ref guard. After apply, smokes the two RPCs structurally (exists,
// SECDEF, search_path, grants/anon-deny) and behaviorally (auth-required
// rejection; entry seed → delete → row gone + audit; session seed w/ comment →
// delete → session+entries+comment gone + audit; bad_args/no_entry/no_session).
// exec_sql returns void, so every guard RAISEs to surface a wrong state.
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
const file = path.join(__dirname, '..', 'supabase-migrations', '101_weighin_delete_activity_rpcs.sql');
const body = fs.readFileSync(file, 'utf8');
const {createClient} = require(path.join(__dirname, '..', 'node_modules', '@supabase', 'supabase-js'));
const sb = createClient(url, key, {auth: {autoRefreshToken: false, persistSession: false}});

const ESIG = 'public.delete_weigh_in_entry(text,text,text)';
const SSIG = 'public.delete_weigh_in_session(text,text,text)';

(async () => {
  console.log(`TEST url=${url}`);
  console.log(`applying 101 body (${body.length} bytes)`);
  const {error} = await sb.rpc('exec_sql', {sql: body});
  if (error) {
    console.error('exec_sql APPLY failed:', error.message || error);
    process.exit(1);
  }
  console.log('apply OK');

  const smokes = [
    {
      label: 'both functions exist',
      sql: `DO $$ BEGIN PERFORM '${ESIG}'::regprocedure; PERFORM '${SSIG}'::regprocedure; END $$;`,
    },
    {
      label: 'both SECURITY DEFINER + search_path=public',
      sql: `DO $$
DECLARE r record;
BEGIN
  FOR r IN SELECT oid, proname, prosecdef, proconfig FROM pg_proc
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
      label: 'unauthenticated caller is rejected (auth.uid() null → RAISE)',
      sql: `DO $$
DECLARE v_raised boolean := false;
BEGIN
  PERFORM set_config('request.jwt.claims', '{}', true);
  BEGIN
    PERFORM public.delete_weigh_in_entry('__mig101_x__', NULL, NULL);
  EXCEPTION WHEN OTHERS THEN
    v_raised := true;
  END;
  IF NOT v_raised THEN RAISE EXCEPTION 'expected auth rejection for unauthenticated entry delete'; END IF;
  v_raised := false;
  BEGIN
    PERFORM public.delete_weigh_in_session('__mig101_x__', NULL, NULL);
  EXCEPTION WHEN OTHERS THEN
    v_raised := true;
  END;
  IF NOT v_raised THEN RAISE EXCEPTION 'expected auth rejection for unauthenticated session delete'; END IF;
END $$;`,
    },
    {
      // No role gate: ANY profile (whatever role) must succeed, matching the
      // weigh_ins_auth_all RLS this replaces.
      label: 'entry round-trip (seed → delete → row gone + record.deleted audit)',
      sql: `DO $$
DECLARE v_pid uuid; v_res jsonb; v_cnt int; v_evt int;
BEGIN
  SELECT id INTO v_pid FROM public.profiles LIMIT 1;
  IF v_pid IS NULL THEN RAISE NOTICE 'no profile; entry round-trip skipped'; RETURN; END IF;
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_pid::text)::text, true);
  DELETE FROM public.weigh_in_sessions WHERE id = '__mig101_esess__';
  INSERT INTO public.weigh_in_sessions(id, date, species, status)
    VALUES ('__mig101_esess__', CURRENT_DATE, 'cattle', 'draft');
  INSERT INTO public.weigh_ins(id, session_id, tag, weight)
    VALUES ('__mig101_eentry__', '__mig101_esess__', 'T1', 123);
  v_res := public.delete_weigh_in_entry('__mig101_eentry__', '2026 · Mommas', 'mig101-probe');
  IF (v_res->>'ok') <> 'true' THEN RAISE EXCEPTION 'entry delete not ok: %', v_res; END IF;
  SELECT count(*) INTO v_cnt FROM public.weigh_ins WHERE id = '__mig101_eentry__';
  IF v_cnt <> 0 THEN RAISE EXCEPTION 'entry row not deleted'; END IF;
  SELECT count(*) INTO v_evt FROM public.activity_events
    WHERE id = (v_res->>'event_id') AND entity_type = 'weighin.session'
      AND entity_id = '__mig101_esess__' AND event_type = 'record.deleted';
  IF v_evt <> 1 THEN RAISE EXCEPTION 'entry record.deleted audit missing'; END IF;
  DELETE FROM public.activity_events WHERE id = (v_res->>'event_id');
  DELETE FROM public.weigh_in_sessions WHERE id = '__mig101_esess__';
END $$;`,
    },
    {
      label: 'session round-trip (seed session+entries+weigh-in comment → delete → all gone + audit)',
      sql: `DO $$
DECLARE v_pid uuid; v_res jsonb; v_sess int; v_ent int; v_cm int; v_evt int;
BEGIN
  SELECT id INTO v_pid FROM public.profiles LIMIT 1;
  IF v_pid IS NULL THEN RAISE NOTICE 'no profile; session round-trip skipped'; RETURN; END IF;
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_pid::text)::text, true);
  DELETE FROM public.weigh_in_sessions WHERE id = '__mig101_ssess__';
  DELETE FROM public.cattle_comments WHERE id = '__mig101_scm__';
  INSERT INTO public.weigh_in_sessions(id, date, species, status)
    VALUES ('__mig101_ssess__', CURRENT_DATE, 'cattle', 'draft');
  INSERT INTO public.weigh_ins(id, session_id, tag, weight)
    VALUES ('__mig101_sent1__', '__mig101_ssess__', 'A', 100),
           ('__mig101_sent2__', '__mig101_ssess__', 'B', 200);
  INSERT INTO public.cattle_comments(id, comment, source, reference_id)
    VALUES ('__mig101_scm__', 'probe', 'weigh_in', '__mig101_sent1__');
  v_res := public.delete_weigh_in_session('__mig101_ssess__', '2026 · Mommas', 'mig101-probe');
  IF (v_res->>'ok') <> 'true' THEN RAISE EXCEPTION 'session delete not ok: %', v_res; END IF;
  IF (v_res->>'entries_deleted') <> '2' THEN RAISE EXCEPTION 'expected entries_deleted=2, got %', v_res; END IF;
  IF (v_res->>'comments_deleted') <> '1' THEN RAISE EXCEPTION 'expected comments_deleted=1, got %', v_res; END IF;
  SELECT count(*) INTO v_sess FROM public.weigh_in_sessions WHERE id = '__mig101_ssess__';
  IF v_sess <> 0 THEN RAISE EXCEPTION 'session row not deleted'; END IF;
  SELECT count(*) INTO v_ent FROM public.weigh_ins WHERE session_id = '__mig101_ssess__';
  IF v_ent <> 0 THEN RAISE EXCEPTION 'entries not cascade-deleted'; END IF;
  SELECT count(*) INTO v_cm FROM public.cattle_comments WHERE id = '__mig101_scm__';
  IF v_cm <> 0 THEN RAISE EXCEPTION 'weigh-in comment not deleted'; END IF;
  SELECT count(*) INTO v_evt FROM public.activity_events
    WHERE id = (v_res->>'event_id') AND entity_type = 'weighin.session' AND event_type = 'record.deleted';
  IF v_evt <> 1 THEN RAISE EXCEPTION 'session record.deleted audit missing'; END IF;
  DELETE FROM public.activity_events WHERE id = (v_res->>'event_id');
END $$;`,
    },
    {
      label: 'bad_args / no_entry / no_session business-rule paths',
      sql: `DO $$
DECLARE v_pid uuid; v_r1 jsonb; v_r2 jsonb; v_r3 jsonb;
BEGIN
  SELECT id INTO v_pid FROM public.profiles LIMIT 1;
  IF v_pid IS NULL THEN RAISE NOTICE 'no profile; arg-guard paths skipped'; RETURN; END IF;
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_pid::text)::text, true);
  v_r1 := public.delete_weigh_in_entry('', NULL, NULL);
  IF (v_r1->>'reason') <> 'bad_args' THEN RAISE EXCEPTION 'expected bad_args (entry), got %', v_r1; END IF;
  v_r2 := public.delete_weigh_in_entry('__mig101_missing__', NULL, NULL);
  IF (v_r2->>'reason') <> 'no_entry' THEN RAISE EXCEPTION 'expected no_entry, got %', v_r2; END IF;
  v_r3 := public.delete_weigh_in_session('__mig101_missing__', NULL, NULL);
  IF (v_r3->>'reason') <> 'no_session' THEN RAISE EXCEPTION 'expected no_session, got %', v_r3; END IF;
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
