// Apply mig 127 (Pasture Map CP2 draw/edit RPCs: create_land_area +
// update_land_area_geometry) to TEST via exec_sql. Hard PROD-ref guard.
// exec_sql carries no auth context, so the RPCs are proven structurally (SECDEF
// + authenticated-only EXECUTE); the append-only invariant they rely on is
// proven behaviorally by calling _land_area_add_version twice and asserting the
// old version survives. .env.test lives only in the MAIN worktree (gitignored).
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
loadDotEnv(path.join(__dirname, '..', '..', 'WCF-planner', '.env.test'));
loadDotEnv(path.join(__dirname, '..', '..', 'WCF-planner', '.env.test.local'));
loadDotEnv(path.join(__dirname, '..', '.env.test'));
loadDotEnv(path.join(__dirname, '..', '.env.test.local'));

const url = process.env.VITE_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
const PROD_REF = 'pzfujbjtayhkdlxiblwe';
if (!url || !key) {
  console.error('missing TEST env (VITE_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY)');
  process.exit(2);
}
if (url.includes(PROD_REF)) {
  console.error('refusing to run against PROD url');
  process.exit(2);
}
const file = path.join(__dirname, '..', 'supabase-migrations', '127_pasture_map_draw_edit.sql');
const body = fs.readFileSync(file, 'utf8');
const {createClient} = require(path.join(__dirname, '..', 'node_modules', '@supabase', 'supabase-js'));
const sb = createClient(url, key, {auth: {autoRefreshToken: false, persistSession: false}});

const SQUARE =
  '{"type":"Polygon","coordinates":[[[-86.44,30.84],[-86.43,30.84],[-86.43,30.85],[-86.44,30.85],[-86.44,30.84]]]}';
const SQUARE2 =
  '{"type":"Polygon","coordinates":[[[-86.42,30.84],[-86.415,30.84],[-86.415,30.845],[-86.42,30.845],[-86.42,30.84]]]}';
const BOWTIE = '{"type":"Polygon","coordinates":[[[0,0],[1,1],[1,0],[0,1],[0,0]]]}';

(async () => {
  console.log(`TEST url=${url}`);
  console.log(`applying 127 body (${body.length} bytes)`);
  const {error} = await sb.rpc('exec_sql', {sql: body});
  if (error) {
    console.error('exec_sql APPLY failed:', error.message || error);
    process.exit(1);
  }
  console.log('apply OK');

  // PostgREST must see the new functions before the UI / Playwright call them
  // via supabase.rpc(); exec_sql structural smokes do NOT prove that. Reload the
  // schema cache so create_land_area / update_land_area_geometry are visible.
  await sb.rpc('exec_sql', {sql: "NOTIFY pgrst, 'reload schema';"});
  console.log('schema reload notified');

  const smokes = [
    {
      label: 'create_land_area + update_land_area_geometry are SECDEF, authenticated-only EXECUTE',
      sql: `DO $$ DECLARE fn text; BEGIN
        FOREACH fn IN ARRAY ARRAY['create_land_area','update_land_area_geometry'] LOOP
          IF NOT EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
                          WHERE n.nspname='public' AND p.proname=fn AND p.prosecdef)
          THEN RAISE EXCEPTION '% missing or not SECURITY DEFINER', fn; END IF;
          IF NOT EXISTS (SELECT 1 FROM information_schema.routine_privileges
                          WHERE routine_schema='public' AND routine_name=fn
                                AND grantee='authenticated' AND privilege_type='EXECUTE')
          THEN RAISE EXCEPTION '% missing authenticated EXECUTE', fn; END IF;
          IF EXISTS (SELECT 1 FROM information_schema.routine_privileges
                      WHERE routine_schema='public' AND routine_name=fn AND grantee IN ('anon','PUBLIC'))
          THEN RAISE EXCEPTION '% leaks EXECUTE to anon/PUBLIC', fn; END IF;
        END LOOP;
      END $$;`,
    },
    {
      label: 'append-only: a second geometry version preserves the first (old version never mutated)',
      sql: `DO $$
      DECLARE v_profile uuid; v_cnt int; v_latest int; v_acres numeric; v_v1geom text; v_v1geom_after text;
      BEGIN
        SELECT id INTO v_profile FROM public.profiles LIMIT 1;
        DELETE FROM public.land_areas WHERE id='mig127-smoke';
        INSERT INTO public.land_areas (id, name, created_by) VALUES ('mig127-smoke','mig127 smoke',v_profile);

        PERFORM public._land_area_add_version('mig127-smoke',
          extensions.ST_SetSRID(extensions.ST_GeomFromGeoJSON('${SQUARE}'),4326),'drawn','{}'::jsonb,v_profile);
        SELECT extensions.ST_AsGeoJSON(geom) INTO v_v1geom
          FROM public.land_area_geometry_versions WHERE land_area_id='mig127-smoke' AND version_number=1;

        PERFORM public._land_area_add_version('mig127-smoke',
          extensions.ST_SetSRID(extensions.ST_GeomFromGeoJSON('${SQUARE2}'),4326),'drawn','{}'::jsonb,v_profile);

        SELECT count(*), max(version_number) INTO v_cnt, v_latest
          FROM public.land_area_geometry_versions WHERE land_area_id='mig127-smoke';
        IF v_cnt <> 2 THEN RAISE EXCEPTION 'expected 2 versions, got %', v_cnt; END IF;
        IF v_latest <> 2 THEN RAISE EXCEPTION 'latest version_number not 2: %', v_latest; END IF;

        -- v1 geometry unchanged after v2 was appended.
        SELECT extensions.ST_AsGeoJSON(geom) INTO v_v1geom_after
          FROM public.land_area_geometry_versions WHERE land_area_id='mig127-smoke' AND version_number=1;
        IF v_v1geom_after IS DISTINCT FROM v_v1geom THEN RAISE EXCEPTION 'v1 geometry was mutated'; END IF;

        SELECT computed_acres INTO v_acres FROM public.land_areas WHERE id='mig127-smoke';
        IF v_acres IS NULL OR v_acres <= 0 THEN RAISE EXCEPTION 'computed_acres not refreshed: %', v_acres; END IF;

        DELETE FROM public.land_areas WHERE id='mig127-smoke';
      END $$;`,
    },
  ];

  let allOk = true;
  for (const s of smokes) {
    const {error: e2} = await sb.rpc('exec_sql', {sql: s.sql});
    if (e2) allOk = false;
    console.log(`  smoke ${s.label}: ${e2 ? 'ERROR ' + (e2.message || e2) : 'OK'}`);
  }

  // Authenticated RPC smoke — first proof the RPCs work via PostgREST + the real
  // auth.uid()/profile_role() path (exec_sql has no auth context). Signs in as
  // the test admin with the anon key, creates + edits, then verifies version
  // history with the service client and confirms a bowtie is rejected.
  const anonKey = process.env.VITE_SUPABASE_ANON_KEY;
  const adminEmail = process.env.VITE_TEST_ADMIN_EMAIL;
  const adminPass = process.env.VITE_TEST_ADMIN_PASSWORD;
  if (!anonKey || !adminEmail || !adminPass) {
    console.log(
      '  authed RPC smoke: SKIPPED (no anon key / admin creds) — the UI Playwright will be the first authenticated RPC proof',
    );
  } else {
    const areaId =
      'mig127-auth-' + (typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : String(Date.now()));
    try {
      const ua = createClient(url, anonKey, {auth: {autoRefreshToken: false, persistSession: false}});
      const {error: signErr} = await ua.auth.signInWithPassword({email: adminEmail, password: adminPass});
      if (signErr) throw new Error('sign-in failed: ' + signErr.message);

      const {data: created, error: cErr} = await ua.rpc('create_land_area', {
        p_id: areaId,
        p_name: 'mig127 authed',
        p_polygon_geojson: JSON.parse(SQUARE),
        p_kind: 'paddock',
        p_source: 'drawn',
      });
      if (cErr) throw new Error('create_land_area: ' + cErr.message);
      if (!created || !created.current_version || !(created.computed_acres > 0))
        throw new Error('create returned no v1 / acres');

      const {data: edited, error: uErr} = await ua.rpc('update_land_area_geometry', {
        p_id: areaId,
        p_polygon_geojson: JSON.parse(SQUARE2),
      });
      if (uErr) throw new Error('update_land_area_geometry: ' + uErr.message);
      if (!edited || !edited.current_version || edited.current_version.version_number !== 2)
        throw new Error('edit did not produce v2');

      const check = await sb.rpc('exec_sql', {
        sql: `DO $$ DECLARE c int; BEGIN
          SELECT count(*) INTO c FROM public.land_area_geometry_versions WHERE land_area_id='${areaId}';
          IF c <> 2 THEN RAISE EXCEPTION 'expected 2 versions got %', c; END IF;
          IF (SELECT computed_acres FROM public.land_areas WHERE id='${areaId}') IS NULL
          THEN RAISE EXCEPTION 'computed_acres not refreshed'; END IF;
        END $$;`,
      });
      if (check.error) throw new Error('version check: ' + check.error.message);

      const {error: bErr} = await ua.rpc('create_land_area', {
        p_id: areaId + '-bow',
        p_name: 'bowtie',
        p_polygon_geojson: JSON.parse(BOWTIE),
        p_kind: 'paddock',
        p_source: 'drawn',
      });
      if (!bErr) throw new Error('bowtie polygon was NOT rejected');

      await ua.auth.signOut();
      console.log(
        '  authed RPC smoke: OK (create v1 + edit v2 + v1 preserved + acres refreshed + bowtie rejected, via real auth)',
      );
    } catch (e) {
      allOk = false;
      console.log('  authed RPC smoke: ERROR ' + (e.message || e));
    } finally {
      // Cleanup with the service client regardless of outcome.
      await sb.rpc('exec_sql', {sql: `DELETE FROM public.land_areas WHERE id IN ('${areaId}','${areaId}-bow');`});
    }
  }

  console.log(allOk ? 'done OK' : 'done WITH ERRORS');
  if (!allOk) process.exit(1);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
