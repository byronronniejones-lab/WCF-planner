// Apply mig 102 (equipment-log delete + Activity RPCs) to TEST via exec_sql.
// BEGIN/COMMIT-free, so no transaction-wrapper stripping. Hard PROD-ref guard.
// After apply, smokes the two RPCs structurally (exists, SECDEF, search_path,
// grants/anon-deny) and behaviorally: unauthenticated rejection; fueling
// privileged round-trip + non-privileged role-gate rejection; maintenance
// authenticated round-trip; bad_args/no_fueling/no_event. exec_sql returns void,
// so every guard RAISEs to surface a wrong state.
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
const file = path.join(__dirname, '..', 'supabase-migrations', '102_equipment_log_delete_activity_rpcs.sql');
const body = fs.readFileSync(file, 'utf8');
const {createClient} = require(path.join(__dirname, '..', 'node_modules', '@supabase', 'supabase-js'));
const sb = createClient(url, key, {auth: {autoRefreshToken: false, persistSession: false}});

const FSIG = 'public.delete_equipment_fueling(text,text,text)';
const MSIG = 'public.delete_equipment_maintenance_event(text,text,text)';

(async () => {
  console.log(`TEST url=${url}`);
  console.log(`applying 102 body (${body.length} bytes)`);
  const {error} = await sb.rpc('exec_sql', {sql: body});
  if (error) {
    console.error('exec_sql APPLY failed:', error.message || error);
    process.exit(1);
  }
  console.log('apply OK');

  const smokes = [
    {
      label: 'both functions exist',
      sql: `DO $$ BEGIN PERFORM '${FSIG}'::regprocedure; PERFORM '${MSIG}'::regprocedure; END $$;`,
    },
    {
      label: 'both SECURITY DEFINER + search_path=public',
      sql: `DO $$
DECLARE r record;
BEGIN
  FOR r IN SELECT proname, prosecdef, proconfig FROM pg_proc
           WHERE oid IN ('${FSIG}'::regprocedure, '${MSIG}'::regprocedure) LOOP
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
  IF NOT has_function_privilege('authenticated', '${FSIG}', 'EXECUTE') THEN RAISE EXCEPTION 'authenticated lacks EXECUTE on delete_equipment_fueling'; END IF;
  IF NOT has_function_privilege('authenticated', '${MSIG}', 'EXECUTE') THEN RAISE EXCEPTION 'authenticated lacks EXECUTE on delete_equipment_maintenance_event'; END IF;
  IF has_function_privilege('anon', '${FSIG}', 'EXECUTE') THEN RAISE EXCEPTION 'anon must NOT have EXECUTE on delete_equipment_fueling'; END IF;
  IF has_function_privilege('anon', '${MSIG}', 'EXECUTE') THEN RAISE EXCEPTION 'anon must NOT have EXECUTE on delete_equipment_maintenance_event'; END IF;
END $$;`,
    },
    {
      label: 'unauthenticated caller is rejected (auth.uid() null → RAISE)',
      sql: `DO $$
DECLARE v_raised boolean := false;
BEGIN
  PERFORM set_config('request.jwt.claims', '{}', true);
  BEGIN PERFORM public.delete_equipment_fueling('__mig102_x__', NULL, NULL);
  EXCEPTION WHEN OTHERS THEN v_raised := true; END;
  IF NOT v_raised THEN RAISE EXCEPTION 'expected auth rejection for unauthenticated fueling delete'; END IF;
  v_raised := false;
  BEGIN PERFORM public.delete_equipment_maintenance_event('__mig102_x__', NULL, NULL);
  EXCEPTION WHEN OTHERS THEN v_raised := true; END;
  IF NOT v_raised THEN RAISE EXCEPTION 'expected auth rejection for unauthenticated maintenance delete'; END IF;
END $$;`,
    },
    {
      label: 'fueling round-trip with privileged role (seed → delete → gone + record.deleted audit)',
      sql: `DO $$
DECLARE v_pid uuid; v_res jsonb; v_cnt int; v_evt int;
BEGIN
  SELECT id INTO v_pid FROM public.profiles WHERE role IN ('admin','management','farm_team','equipment_tech') LIMIT 1;
  IF v_pid IS NULL THEN RAISE NOTICE 'no privileged profile; fueling round-trip skipped'; RETURN; END IF;
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_pid::text)::text, true);
  DELETE FROM public.equipment WHERE id = '__mig102_eq__';
  INSERT INTO public.equipment(id, name, slug, category)
    VALUES ('__mig102_eq__', 'Mig102 Probe', '__mig102_slug__', 'tractors');
  INSERT INTO public.equipment_fuelings(id, equipment_id, date, gallons)
    VALUES ('__mig102_fuel__', '__mig102_eq__', CURRENT_DATE, 12.5);
  v_res := public.delete_equipment_fueling('__mig102_fuel__', 'Mig102 Probe', 'mig102-probe');
  IF (v_res->>'ok') <> 'true' THEN RAISE EXCEPTION 'fueling delete not ok: %', v_res; END IF;
  SELECT count(*) INTO v_cnt FROM public.equipment_fuelings WHERE id = '__mig102_fuel__';
  IF v_cnt <> 0 THEN RAISE EXCEPTION 'fueling row not deleted'; END IF;
  SELECT count(*) INTO v_evt FROM public.activity_events
    WHERE id = (v_res->>'event_id') AND entity_type = 'equipment.item'
      AND entity_id = '__mig102_eq__' AND event_type = 'record.deleted';
  IF v_evt <> 1 THEN RAISE EXCEPTION 'fueling record.deleted audit missing'; END IF;
  DELETE FROM public.activity_events WHERE id = (v_res->>'event_id');
  DELETE FROM public.equipment WHERE id = '__mig102_eq__';
END $$;`,
    },
    {
      label: 'fueling role gate rejects a non-privileged authenticated caller',
      sql: `DO $$
DECLARE v_pid uuid; v_raised boolean := false;
BEGIN
  SELECT id INTO v_pid FROM public.profiles
    WHERE role IS NOT NULL AND role NOT IN ('admin','management','farm_team','equipment_tech') LIMIT 1;
  IF v_pid IS NULL THEN RAISE NOTICE 'no non-privileged profile; fueling role-gate rejection skipped'; RETURN; END IF;
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_pid::text)::text, true);
  BEGIN PERFORM public.delete_equipment_fueling('__mig102_any__', NULL, NULL);
  EXCEPTION WHEN OTHERS THEN v_raised := true; END;
  IF NOT v_raised THEN RAISE EXCEPTION 'expected role-gate rejection for non-privileged fueling delete'; END IF;
END $$;`,
    },
    {
      label: 'maintenance round-trip with any authenticated role (seed → delete → gone + audit)',
      sql: `DO $$
DECLARE v_pid uuid; v_res jsonb; v_cnt int; v_evt int;
BEGIN
  SELECT id INTO v_pid FROM public.profiles LIMIT 1;
  IF v_pid IS NULL THEN RAISE NOTICE 'no profile; maintenance round-trip skipped'; RETURN; END IF;
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_pid::text)::text, true);
  DELETE FROM public.equipment WHERE id = '__mig102_eqm__';
  INSERT INTO public.equipment(id, name, slug, category)
    VALUES ('__mig102_eqm__', 'Mig102 ProbeM', '__mig102_slugm__', 'tractors');
  INSERT INTO public.equipment_maintenance_events(id, equipment_id, event_date, event_type, title)
    VALUES ('__mig102_me__', '__mig102_eqm__', CURRENT_DATE, 'repair', 'probe');
  v_res := public.delete_equipment_maintenance_event('__mig102_me__', 'Mig102 ProbeM', 'mig102-probe');
  IF (v_res->>'ok') <> 'true' THEN RAISE EXCEPTION 'maintenance delete not ok: %', v_res; END IF;
  SELECT count(*) INTO v_cnt FROM public.equipment_maintenance_events WHERE id = '__mig102_me__';
  IF v_cnt <> 0 THEN RAISE EXCEPTION 'maintenance row not deleted'; END IF;
  SELECT count(*) INTO v_evt FROM public.activity_events
    WHERE id = (v_res->>'event_id') AND entity_type = 'equipment.item'
      AND entity_id = '__mig102_eqm__' AND event_type = 'record.deleted';
  IF v_evt <> 1 THEN RAISE EXCEPTION 'maintenance record.deleted audit missing'; END IF;
  DELETE FROM public.activity_events WHERE id = (v_res->>'event_id');
  DELETE FROM public.equipment WHERE id = '__mig102_eqm__';
END $$;`,
    },
    {
      // Codex CP3 review: a second delete of the same id must NOT re-audit and
      // must NOT return ok. Sequential proof of the idempotency contract that
      // FOR UPDATE also enforces under true concurrency.
      label: 'second delete returns no_xxx and writes no duplicate audit',
      sql: `DO $$
DECLARE v_pid uuid; v_r1 jsonb; v_r2 jsonb; v_before int; v_after int;
BEGIN
  SELECT id INTO v_pid FROM public.profiles WHERE role IN ('admin','management','farm_team','equipment_tech') LIMIT 1;
  IF v_pid IS NULL THEN RAISE NOTICE 'no privileged profile; second-delete idempotency skipped'; RETURN; END IF;
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_pid::text)::text, true);

  -- fueling: first delete ok (+1 audit), second delete no_fueling (no new audit)
  DELETE FROM public.equipment WHERE id = '__mig102_idf__';
  INSERT INTO public.equipment(id, name, slug, category)
    VALUES ('__mig102_idf__', 'Mig102 Idem F', '__mig102_idf_slug__', 'tractors');
  INSERT INTO public.equipment_fuelings(id, equipment_id, date) VALUES ('__mig102_idff__', '__mig102_idf__', CURRENT_DATE);
  v_r1 := public.delete_equipment_fueling('__mig102_idff__', NULL, 'mig102-idem');
  IF (v_r1->>'ok') <> 'true' THEN RAISE EXCEPTION 'first fueling delete not ok: %', v_r1; END IF;
  SELECT count(*) INTO v_before FROM public.activity_events WHERE entity_id = '__mig102_idf__';
  v_r2 := public.delete_equipment_fueling('__mig102_idff__', NULL, 'mig102-idem');
  IF (v_r2->>'reason') <> 'no_fueling' THEN RAISE EXCEPTION 'second fueling delete should be no_fueling, got %', v_r2; END IF;
  SELECT count(*) INTO v_after FROM public.activity_events WHERE entity_id = '__mig102_idf__';
  IF v_after <> v_before THEN RAISE EXCEPTION 'second fueling delete duplicated audit (% -> %)', v_before, v_after; END IF;
  DELETE FROM public.activity_events WHERE id = (v_r1->>'event_id');
  DELETE FROM public.equipment WHERE id = '__mig102_idf__';

  -- maintenance: first delete ok (+1 audit), second delete no_event (no new audit)
  DELETE FROM public.equipment WHERE id = '__mig102_idm__';
  INSERT INTO public.equipment(id, name, slug, category)
    VALUES ('__mig102_idm__', 'Mig102 Idem M', '__mig102_idm_slug__', 'tractors');
  INSERT INTO public.equipment_maintenance_events(id, equipment_id, event_date) VALUES ('__mig102_idme__', '__mig102_idm__', CURRENT_DATE);
  v_r1 := public.delete_equipment_maintenance_event('__mig102_idme__', NULL, 'mig102-idem');
  IF (v_r1->>'ok') <> 'true' THEN RAISE EXCEPTION 'first maintenance delete not ok: %', v_r1; END IF;
  SELECT count(*) INTO v_before FROM public.activity_events WHERE entity_id = '__mig102_idm__';
  v_r2 := public.delete_equipment_maintenance_event('__mig102_idme__', NULL, 'mig102-idem');
  IF (v_r2->>'reason') <> 'no_event' THEN RAISE EXCEPTION 'second maintenance delete should be no_event, got %', v_r2; END IF;
  SELECT count(*) INTO v_after FROM public.activity_events WHERE entity_id = '__mig102_idm__';
  IF v_after <> v_before THEN RAISE EXCEPTION 'second maintenance delete duplicated audit (% -> %)', v_before, v_after; END IF;
  DELETE FROM public.activity_events WHERE id = (v_r1->>'event_id');
  DELETE FROM public.equipment WHERE id = '__mig102_idm__';
END $$;`,
    },
    {
      label: 'bad_args / no_fueling / no_event business-rule paths',
      sql: `DO $$
DECLARE v_pid uuid; v_r1 jsonb; v_r2 jsonb; v_r3 jsonb; v_r4 jsonb;
BEGIN
  SELECT id INTO v_pid FROM public.profiles WHERE role IN ('admin','management','farm_team','equipment_tech') LIMIT 1;
  IF v_pid IS NULL THEN RAISE NOTICE 'no privileged profile; arg-guard paths skipped'; RETURN; END IF;
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_pid::text)::text, true);
  v_r1 := public.delete_equipment_fueling('', NULL, NULL);
  IF (v_r1->>'reason') <> 'bad_args' THEN RAISE EXCEPTION 'expected bad_args (fueling), got %', v_r1; END IF;
  v_r2 := public.delete_equipment_fueling('__mig102_missing__', NULL, NULL);
  IF (v_r2->>'reason') <> 'no_fueling' THEN RAISE EXCEPTION 'expected no_fueling, got %', v_r2; END IF;
  v_r3 := public.delete_equipment_maintenance_event('', NULL, NULL);
  IF (v_r3->>'reason') <> 'bad_args' THEN RAISE EXCEPTION 'expected bad_args (maintenance), got %', v_r3; END IF;
  v_r4 := public.delete_equipment_maintenance_event('__mig102_missing__', NULL, NULL);
  IF (v_r4->>'reason') <> 'no_event' THEN RAISE EXCEPTION 'expected no_event, got %', v_r4; END IF;
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
