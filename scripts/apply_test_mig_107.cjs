// Apply mig 107 (delete_fuel_bill SECDEF RPC) to TEST via exec_sql.
// BEGIN/COMMIT-free CREATE OR REPLACE + REVOKE/GRANT + NOTIFY. Hard PROD-ref
// guard. After apply, smokes structurally (exists, SECDEF, search_path,
// grants/anon-deny) and behaviorally: seed a fuel bill + 2 lines, call the RPC
// as an admin caller, assert the bill + its lines are gone and a record.deleted
// equipment.item activity row was written (then roll the probe back); assert a
// non-admin (non-eligible) caller is rejected with the bill left intact.
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
const file = path.join(__dirname, '..', 'supabase-migrations', '107_delete_fuel_bill_rpc.sql');
const body = fs.readFileSync(file, 'utf8');
const {createClient} = require(path.join(__dirname, '..', 'node_modules', '@supabase', 'supabase-js'));
const sb = createClient(url, key, {auth: {autoRefreshToken: false, persistSession: false}});

const SIG = 'public.delete_fuel_bill(text)';

(async () => {
  console.log(`TEST url=${url}`);
  console.log(`applying 107 body (${body.length} bytes)`);
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
      label: 'admin caller deletes bill + cascaded lines + writes record.deleted activity (rolled back)',
      sql: `DO $$
DECLARE
  v_admin uuid; v_bill text := '__mig107_bill__'; v_r jsonb;
  v_lines int; v_ae int;
BEGIN
  SELECT id INTO v_admin FROM public.profiles WHERE role = 'admin' LIMIT 1;
  IF v_admin IS NULL THEN RAISE NOTICE 'no admin profile; admin-delete smoke skipped'; RETURN; END IF;

  -- Clean any prior probe rows, then seed a bill + 2 lines.
  DELETE FROM public.fuel_bills WHERE id = v_bill;
  INSERT INTO public.fuel_bills (id, supplier, invoice_number, delivery_date, total)
    VALUES (v_bill, 'MIG107 Supplier', 'INV-MIG107', CURRENT_DATE, 123.45);
  INSERT INTO public.fuel_bill_lines (id, bill_id, fuel_type, net_units, line_total)
    VALUES ('__mig107_l1__', v_bill, 'diesel', 100, 80.00),
           ('__mig107_l2__', v_bill, 'gasoline', 50, 43.45);

  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_admin::text)::text, true);
  v_r := public.delete_fuel_bill(v_bill);
  IF (v_r->>'ok') <> 'true' OR (v_r->>'reason') <> 'deleted' THEN
    RAISE EXCEPTION 'admin delete not ok/deleted: %', v_r;
  END IF;
  IF (v_r->>'lines_deleted') <> '2' THEN RAISE EXCEPTION 'expected lines_deleted=2, got %', v_r; END IF;

  -- Bill root gone.
  IF EXISTS (SELECT 1 FROM public.fuel_bills WHERE id = v_bill) THEN
    RAISE EXCEPTION 'bill row not deleted';
  END IF;
  -- Lines cascaded away.
  SELECT count(*) INTO v_lines FROM public.fuel_bill_lines WHERE bill_id = v_bill;
  IF v_lines <> 0 THEN RAISE EXCEPTION 'expected 0 cascaded lines, got %', v_lines; END IF;
  -- One record.deleted equipment.item activity row written, scoped to the bill id.
  SELECT count(*) INTO v_ae FROM public.activity_events
    WHERE entity_type = 'equipment.item' AND entity_id = v_bill AND event_type = 'record.deleted';
  IF v_ae <> 1 THEN RAISE EXCEPTION 'expected 1 record.deleted activity row, got %', v_ae; END IF;

  -- Roll the probe back: drop the activity row we just wrote (the bill/lines are
  -- already gone via the RPC). The reset is best-effort cleanup of probe state.
  DELETE FROM public.activity_events WHERE entity_id = v_bill;
END $$;`,
    },
    {
      label: 'non-admin caller rejected + bill left intact; unauthenticated rejected',
      sql: `DO $$
DECLARE v_nonadmin uuid; v_bill text := '__mig107_bill2__'; v_raised boolean;
BEGIN
  -- Unauthenticated rejected.
  PERFORM set_config('request.jwt.claims', '{}', true);
  v_raised := false;
  BEGIN PERFORM public.delete_fuel_bill('__nope__'); EXCEPTION WHEN OTHERS THEN v_raised := true; END;
  IF NOT v_raised THEN RAISE EXCEPTION 'expected auth rejection (unauthenticated)'; END IF;

  SELECT id INTO v_nonadmin FROM public.profiles WHERE role IS DISTINCT FROM 'admin' AND role IS DISTINCT FROM 'inactive' LIMIT 1;
  IF v_nonadmin IS NULL THEN RAISE NOTICE 'no non-admin profile; non-admin-reject smoke skipped'; RETURN; END IF;

  DELETE FROM public.fuel_bills WHERE id = v_bill;
  INSERT INTO public.fuel_bills (id, supplier, total) VALUES (v_bill, 'MIG107 NonAdmin', 9.99);

  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_nonadmin::text)::text, true);
  v_raised := false;
  BEGIN PERFORM public.delete_fuel_bill(v_bill); EXCEPTION WHEN OTHERS THEN v_raised := true; END;
  IF NOT v_raised THEN
    DELETE FROM public.fuel_bills WHERE id = v_bill;
    RAISE EXCEPTION 'expected non-admin role rejection';
  END IF;
  -- Bill must still be present (rejected before any delete).
  IF NOT EXISTS (SELECT 1 FROM public.fuel_bills WHERE id = v_bill) THEN
    RAISE EXCEPTION 'non-admin reject must NOT delete the bill';
  END IF;
  -- Clean up the probe bill.
  DELETE FROM public.fuel_bills WHERE id = v_bill;
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
