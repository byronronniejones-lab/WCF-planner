// Apply mig 128 prerequisite + mig 129 (Pasture Map CP4 planning/reports) to
// TEST via exec_sql. Hard PROD-ref guard. Smokes the authenticated RPC path:
// create two areas, create/use/complete a planned move, then read history/rest/
// stocking reports.
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
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const anonKey = process.env.VITE_SUPABASE_ANON_KEY;
const adminEmail = process.env.VITE_TEST_ADMIN_EMAIL;
const adminPass = process.env.VITE_TEST_ADMIN_PASSWORD;
const PROD_REF = 'pzfujbjtayhkdlxiblwe';

if (!url || !serviceKey) {
  console.error('missing TEST env (VITE_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY)');
  process.exit(2);
}
if (url.includes(PROD_REF)) {
  console.error('refusing to run against PROD url');
  process.exit(2);
}

const {createClient} = require(path.join(__dirname, '..', 'node_modules', '@supabase', 'supabase-js'));
const sb = createClient(url, serviceKey, {auth: {autoRefreshToken: false, persistSession: false}});

function migration(n) {
  return fs.readFileSync(path.join(__dirname, '..', 'supabase-migrations', n), 'utf8');
}

const SQUARE_A = {
  type: 'Polygon',
  coordinates: [
    [
      [-86.44, 30.84],
      [-86.435, 30.84],
      [-86.435, 30.845],
      [-86.44, 30.845],
      [-86.44, 30.84],
    ],
  ],
};
const SQUARE_B = {
  type: 'Polygon',
  coordinates: [
    [
      [-86.43, 30.84],
      [-86.425, 30.84],
      [-86.425, 30.845],
      [-86.43, 30.845],
      [-86.43, 30.84],
    ],
  ],
};

(async () => {
  console.log(`TEST url=${url}`);
  for (const file of ['128_pasture_map_move_ledger.sql', '129_pasture_map_planning_reports.sql']) {
    const body = migration(file);
    console.log(`applying ${file} (${body.length} bytes)`);
    const {error} = await sb.rpc('exec_sql', {sql: body});
    if (error) {
      console.error(`exec_sql APPLY failed for ${file}:`, error.message || error);
      process.exit(1);
    }
  }
  await sb.rpc('exec_sql', {sql: "NOTIFY pgrst, 'reload schema';"});
  console.log('apply OK; schema reload notified');
  await new Promise((resolve) => setTimeout(resolve, 1500));

  const structural = await sb.rpc('exec_sql', {
    sql: `DO $$
      DECLARE fn text;
      BEGIN
        FOREACH fn IN ARRAY ARRAY[
          'list_pasture_planned_moves',
          'create_pasture_planned_move',
          'update_pasture_planned_move_status',
          'list_pasture_history_report',
          'list_pasture_rest_report',
          'list_pasture_stocking_report'
        ] LOOP
          IF NOT EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
                          WHERE n.nspname='public' AND p.proname=fn AND p.prosecdef)
          THEN RAISE EXCEPTION '% missing or not SECURITY DEFINER', fn; END IF;
          IF NOT EXISTS (SELECT 1 FROM information_schema.routine_privileges
                          WHERE routine_schema='public' AND routine_name=fn
                                AND grantee='authenticated' AND privilege_type='EXECUTE')
          THEN RAISE EXCEPTION '% missing authenticated EXECUTE', fn; END IF;
        END LOOP;
      END $$;`,
  });
  if (structural.error) {
    console.error('structural smoke failed:', structural.error.message || structural.error);
    process.exit(1);
  }
  console.log('structural smoke OK');

  if (!anonKey || !adminEmail || !adminPass) {
    console.log('authed RPC smoke SKIPPED (missing anon key or admin creds)');
    return;
  }

  const ua = createClient(url, anonKey, {auth: {autoRefreshToken: false, persistSession: false}});
  const {error: signErr} = await ua.auth.signInWithPassword({email: adminEmail, password: adminPass});
  if (signErr) throw new Error('sign-in failed: ' + signErr.message);

  const run = String(Date.now());
  const aId = 'mig129-a-' + run;
  const bId = 'mig129-b-' + run;
  const planId = 'mig129-p-' + run;
  const move1Id = 'mig129-m1-' + run;
  const move2Id = 'mig129-m2-' + run;
  try {
    for (const [id, name, geom] of [
      [aId, 'mig129 A', SQUARE_A],
      [bId, 'mig129 B', SQUARE_B],
    ]) {
      const {error: createErr} = await ua.rpc('create_land_area', {
        p_id: id,
        p_name: name,
        p_polygon_geojson: geom,
        p_kind: 'paddock',
        p_source: 'drawn',
      });
      if (createErr) throw new Error('create_land_area ' + id + ': ' + createErr.message);
    }

    const movedAt = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString();
    const move1 = await ua.rpc('record_pasture_move', {
      p_move_id: move1Id,
      p_animal_type: 'cattle_herd',
      p_group_key: 'mommas',
      p_group_label: 'Mommas',
      p_to_land_area_id: aId,
      p_moved_at: movedAt,
      p_animal_count: 12,
      p_notes: 'mig129 smoke first move',
    });
    if (move1.error) throw new Error('record first move: ' + move1.error.message);

    const planned = await ua.rpc('create_pasture_planned_move', {
      p_plan_id: planId,
      p_animal_type: 'cattle_herd',
      p_group_key: 'mommas',
      p_group_label: 'Mommas',
      p_to_land_area_id: bId,
      p_planned_for: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
      p_animal_count: 12,
      p_notes: 'mig129 smoke plan',
    });
    if (planned.error) throw new Error('create planned move: ' + planned.error.message);

    const plans = await ua.rpc('list_pasture_planned_moves', {p_status: 'planned', p_limit: 50});
    if (plans.error) throw new Error('list planned moves: ' + plans.error.message);
    if (!plans.data?.planned_moves?.some((p) => p.id === planId)) throw new Error('planned move missing from list');

    const move2 = await ua.rpc('record_pasture_move', {
      p_move_id: move2Id,
      p_animal_type: 'cattle_herd',
      p_group_key: 'mommas',
      p_group_label: 'Mommas',
      p_to_land_area_id: bId,
      p_moved_at: new Date().toISOString(),
      p_animal_count: 12,
      p_notes: 'mig129 smoke planned move completed',
    });
    if (move2.error) throw new Error('record second move: ' + move2.error.message);

    const done = await ua.rpc('update_pasture_planned_move_status', {
      p_plan_id: planId,
      p_status: 'completed',
      p_completed_move_id: move2Id,
    });
    if (done.error) throw new Error('complete planned move: ' + done.error.message);

    const history = await ua.rpc('list_pasture_history_report', {
      p_land_area_id: bId,
      p_animal_type: null,
      p_group_key: null,
      p_limit: 50,
    });
    if (history.error) throw new Error('history report: ' + history.error.message);
    if (!history.data?.history?.some((h) => h.id === move2Id)) throw new Error('history missing completed move');

    const rest = await ua.rpc('list_pasture_rest_report');
    if (rest.error) throw new Error('rest report: ' + rest.error.message);
    if (!rest.data?.areas?.some((a) => a.id === bId && a.rest_state === 'occupied'))
      throw new Error('rest report missing occupied destination');

    const stocking = await ua.rpc('list_pasture_stocking_report', {
      p_since: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString(),
      p_until: new Date().toISOString(),
    });
    if (stocking.error) throw new Error('stocking report: ' + stocking.error.message);
    if (!stocking.data?.areas?.some((a) => a.land_area_id === aId || a.land_area_id === bId))
      throw new Error('stocking report missing smoke areas');

    console.log('authed RPC smoke OK (plans/history/rest/stocking derived)');
  } finally {
    await ua.auth.signOut();
    await sb.rpc('exec_sql', {
      sql: `DELETE FROM public.land_areas WHERE id IN ('${aId}', '${bId}');`,
    });
  }
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
