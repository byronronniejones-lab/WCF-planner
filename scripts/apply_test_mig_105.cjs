// Apply mig 105 (create_recurring_task_template SECDEF RPC) to TEST via
// exec_sql. BEGIN/COMMIT-free CREATE OR REPLACE + REVOKE/GRANT + NOTIFY. Hard
// PROD-ref guard. After apply, smokes structurally (exists, SECDEF,
// search_path, grants/anon-deny) and behaviorally: a non-light caller can
// create (created_by stamped from the CALLER, payload owner ignored, idempotent
// retry), and light + unauthenticated callers are rejected with no row leak.
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
const file = path.join(__dirname, '..', 'supabase-migrations', '105_create_recurring_task_template_rpc.sql');
const body = fs.readFileSync(file, 'utf8');
const {createClient} = require(path.join(__dirname, '..', 'node_modules', '@supabase', 'supabase-js'));
const sb = createClient(url, key, {auth: {autoRefreshToken: false, persistSession: false}});

const SIG = 'public.create_recurring_task_template(jsonb)';

(async () => {
  console.log(`TEST url=${url}`);
  console.log(`applying 105 body (${body.length} bytes)`);
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
      label: 'non-light caller creates; created_by stamped from caller (payload owner ignored); idempotent retry',
      sql: `DO $$
DECLARE v_pid uuid; v_bogus uuid; v_r1 jsonb; v_r2 jsonb; v_owner uuid; v_cnt int;
BEGIN
  SELECT id INTO v_pid FROM public.profiles WHERE role NOT IN ('light','inactive') LIMIT 1;
  IF v_pid IS NULL THEN RAISE NOTICE 'no non-light profile; success smoke skipped'; RETURN; END IF;
  SELECT id INTO v_bogus FROM public.profiles WHERE id <> v_pid AND role IS DISTINCT FROM 'inactive' LIMIT 1;
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_pid::text)::text, true);
  DELETE FROM public.task_templates WHERE id = '__mig105_t1__';
  v_r1 := public.create_recurring_task_template(jsonb_build_object(
    'id','__mig105_t1__','title','Mig105 probe','assignee_profile_id', v_pid::text,
    'recurrence','weekly','recurrence_interval','1','first_due_date', CURRENT_DATE::text,
    'active', false, 'created_by_profile_id', COALESCE(v_bogus, v_pid)::text));
  IF (v_r1->>'ok') <> 'true' OR (v_r1->>'idempotent_replay') <> 'false' THEN RAISE EXCEPTION 'create not ok/new: %', v_r1; END IF;
  SELECT created_by_profile_id INTO v_owner FROM public.task_templates WHERE id = '__mig105_t1__';
  IF v_owner IS DISTINCT FROM v_pid THEN RAISE EXCEPTION 'created_by not stamped from caller (got %, want %)', v_owner, v_pid; END IF;
  v_r2 := public.create_recurring_task_template(jsonb_build_object(
    'id','__mig105_t1__','title','Mig105 probe','assignee_profile_id', v_pid::text,
    'recurrence','weekly','recurrence_interval','1','first_due_date', CURRENT_DATE::text,'active', false));
  IF (v_r2->>'idempotent_replay') <> 'true' THEN RAISE EXCEPTION 'retry not idempotent: %', v_r2; END IF;
  SELECT count(*) INTO v_cnt FROM public.task_templates WHERE id = '__mig105_t1__';
  IF v_cnt <> 1 THEN RAISE EXCEPTION 'expected 1 template row, got %', v_cnt; END IF;
  DELETE FROM public.task_templates WHERE id = '__mig105_t1__';
END $$;`,
    },
    {
      label: 'light caller rejected + unauthenticated rejected, with no row leak',
      sql: `DO $$
DECLARE v_light uuid; v_raised boolean;
BEGIN
  PERFORM set_config('request.jwt.claims', '{}', true);
  v_raised := false;
  BEGIN PERFORM public.create_recurring_task_template(jsonb_build_object('id','__x__')); EXCEPTION WHEN OTHERS THEN v_raised := true; END;
  IF NOT v_raised THEN RAISE EXCEPTION 'expected auth rejection (unauthenticated)'; END IF;
  SELECT id INTO v_light FROM public.profiles WHERE role = 'light' LIMIT 1;
  IF v_light IS NULL THEN RAISE NOTICE 'no light profile; light-reject smoke skipped'; RETURN; END IF;
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_light::text)::text, true);
  v_raised := false;
  BEGIN PERFORM public.create_recurring_task_template(jsonb_build_object(
    'id','__mig105_light__','title','xyz','assignee_profile_id', v_light::text,
    'recurrence','weekly','first_due_date', CURRENT_DATE::text)); EXCEPTION WHEN OTHERS THEN v_raised := true; END;
  IF NOT v_raised THEN RAISE EXCEPTION 'expected light-role rejection'; END IF;
  IF EXISTS (SELECT 1 FROM public.task_templates WHERE id = '__mig105_light__') THEN
    DELETE FROM public.task_templates WHERE id = '__mig105_light__';
    RAISE EXCEPTION 'light caller leaked a template row (must not)';
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
