// Apply mig 104 (rename privileged equipment-fueling delete RPC) to TEST via
// exec_sql. BEGIN/COMMIT-free. Hard PROD-ref guard. After apply, verifies the
// rename: admin_delete_equipment_fueling exists (SECDEF, search_path, grants,
// role gate, FOR UPDATE idempotency); the colliding mig-102
// delete_equipment_fueling(text,text,text) is GONE; the mig-091 owner-scoped
// delete_equipment_fueling(text) SURVIVES. exec_sql returns void, so every guard
// RAISEs to surface a wrong state.
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
const file = path.join(__dirname, '..', 'supabase-migrations', '104_rename_equipment_fueling_delete_rpc.sql');
const body = fs.readFileSync(file, 'utf8');
const {createClient} = require(path.join(__dirname, '..', 'node_modules', '@supabase', 'supabase-js'));
const sb = createClient(url, key, {auth: {autoRefreshToken: false, persistSession: false}});

const NEWSIG = 'public.admin_delete_equipment_fueling(text,text,text)';

(async () => {
  console.log(`TEST url=${url}`);
  console.log(`applying 104 body (${body.length} bytes)`);
  const {error} = await sb.rpc('exec_sql', {sql: body});
  if (error) {
    console.error('exec_sql APPLY failed:', error.message || error);
    process.exit(1);
  }
  console.log('apply OK');

  const smokes = [
    {
      label: 'renamed fn exists + SECDEF + search_path=public; old 3-arg GONE; mig-091 1-arg SURVIVES',
      sql: `DO $$
DECLARE v_secdef boolean; v_cfg text[];
BEGIN
  IF to_regprocedure('${NEWSIG}') IS NULL THEN RAISE EXCEPTION 'admin_delete_equipment_fueling missing'; END IF;
  IF to_regprocedure('public.delete_equipment_fueling(text,text,text)') IS NOT NULL THEN
    RAISE EXCEPTION 'colliding delete_equipment_fueling(text,text,text) was NOT dropped';
  END IF;
  IF to_regprocedure('public.delete_equipment_fueling(text)') IS NULL THEN
    RAISE EXCEPTION 'mig-091 owner-scoped delete_equipment_fueling(text) was wrongly dropped';
  END IF;
  SELECT prosecdef, proconfig INTO v_secdef, v_cfg FROM pg_proc WHERE oid = '${NEWSIG}'::regprocedure;
  IF NOT v_secdef THEN RAISE EXCEPTION 'admin_delete_equipment_fueling not SECURITY DEFINER'; END IF;
  IF v_cfg IS NULL OR NOT ('search_path=public' = ANY(v_cfg)) THEN RAISE EXCEPTION 'search_path not public: %', v_cfg; END IF;
END $$;`,
    },
    {
      label: 'authenticated has EXECUTE on renamed fn, anon does not',
      sql: `DO $$
BEGIN
  IF NOT has_function_privilege('authenticated', '${NEWSIG}', 'EXECUTE') THEN RAISE EXCEPTION 'authenticated lacks EXECUTE'; END IF;
  IF has_function_privilege('anon', '${NEWSIG}', 'EXECUTE') THEN RAISE EXCEPTION 'anon must NOT have EXECUTE'; END IF;
END $$;`,
    },
    {
      label: 'privileged round-trip + second-delete idempotency (no duplicate audit)',
      sql: `DO $$
DECLARE v_pid uuid; v_r1 jsonb; v_r2 jsonb; v_b int; v_a int; v_cnt int;
BEGIN
  SELECT id INTO v_pid FROM public.profiles WHERE role IN ('admin','management','farm_team','equipment_tech') LIMIT 1;
  IF v_pid IS NULL THEN RAISE NOTICE 'no privileged profile; round-trip skipped'; RETURN; END IF;
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_pid::text)::text, true);
  DELETE FROM public.equipment WHERE id = '__mig104_eq__';
  INSERT INTO public.equipment(id,name,slug,category) VALUES ('__mig104_eq__','M104','__mig104_slug__','tractors');
  INSERT INTO public.equipment_fuelings(id,equipment_id,date,gallons) VALUES ('__mig104_f__','__mig104_eq__',CURRENT_DATE,7);
  v_r1 := public.admin_delete_equipment_fueling('__mig104_f__','M104','mig104');
  IF (v_r1->>'ok') <> 'true' THEN RAISE EXCEPTION 'fueling delete not ok: %', v_r1; END IF;
  SELECT count(*) INTO v_cnt FROM public.equipment_fuelings WHERE id = '__mig104_f__';
  IF v_cnt <> 0 THEN RAISE EXCEPTION 'fueling not deleted'; END IF;
  SELECT count(*) INTO v_b FROM public.activity_events WHERE entity_id = '__mig104_eq__';
  v_r2 := public.admin_delete_equipment_fueling('__mig104_f__','M104','mig104');
  IF (v_r2->>'reason') <> 'no_fueling' THEN RAISE EXCEPTION 'second delete should be no_fueling, got %', v_r2; END IF;
  SELECT count(*) INTO v_a FROM public.activity_events WHERE entity_id = '__mig104_eq__';
  IF v_a <> v_b THEN RAISE EXCEPTION 'second delete duplicated audit (% -> %)', v_b, v_a; END IF;
  DELETE FROM public.activity_events WHERE id = (v_r1->>'event_id');
  DELETE FROM public.equipment WHERE id = '__mig104_eq__';
END $$;`,
    },
    {
      label: 'role gate rejects a non-privileged authenticated caller',
      sql: `DO $$
DECLARE v_pid uuid; v_raised boolean := false;
BEGIN
  SELECT id INTO v_pid FROM public.profiles
    WHERE role IS NOT NULL AND role NOT IN ('admin','management','farm_team','equipment_tech') LIMIT 1;
  IF v_pid IS NULL THEN RAISE NOTICE 'no non-privileged profile; role-gate rejection skipped'; RETURN; END IF;
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_pid::text)::text, true);
  BEGIN PERFORM public.admin_delete_equipment_fueling('__mig104_any__', NULL, NULL);
  EXCEPTION WHEN OTHERS THEN v_raised := true; END;
  IF NOT v_raised THEN RAISE EXCEPTION 'expected role-gate rejection'; END IF;
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
