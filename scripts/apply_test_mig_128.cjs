// Apply mig 128 (Pasture Map CP3 move ledger / occupancy / rest) to TEST via
// exec_sql. Hard PROD-ref guard. Also smokes the real authenticated RPC path:
// create two areas, move a cattle herd from A to B, then verify A is resting
// and B is occupied through list_land_areas.
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
const body = fs.readFileSync(
  path.join(__dirname, '..', 'supabase-migrations', '128_pasture_map_move_ledger.sql'),
  'utf8',
);

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
  console.log(`applying 128 body (${body.length} bytes)`);
  const {error} = await sb.rpc('exec_sql', {sql: body});
  if (error) {
    console.error('exec_sql APPLY failed:', error.message || error);
    process.exit(1);
  }
  await sb.rpc('exec_sql', {sql: "NOTIFY pgrst, 'reload schema';"});
  console.log('apply OK; schema reload notified');
  await new Promise((resolve) => setTimeout(resolve, 1500));

  const structural = await sb.rpc('exec_sql', {
    sql: `DO $$
      DECLARE fn text;
      BEGIN
        FOREACH fn IN ARRAY ARRAY['list_pasture_moves','record_pasture_move'] LOOP
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
  const aId = 'mig128-a-' + run;
  const bId = 'mig128-b-' + run;
  try {
    for (const [id, name, geom] of [
      [aId, 'mig128 A', SQUARE_A],
      [bId, 'mig128 B', SQUARE_B],
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

    const move1 = await ua.rpc('record_pasture_move', {
      p_move_id: 'mig128-m1-' + run,
      p_animal_type: 'cattle_herd',
      p_group_key: 'mommas',
      p_group_label: 'Mommas',
      p_to_land_area_id: aId,
      p_moved_at: new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString(),
      p_animal_count: 12,
      p_notes: 'mig128 smoke first move',
    });
    if (move1.error) throw new Error('record first move: ' + move1.error.message);

    const move2 = await ua.rpc('record_pasture_move', {
      p_move_id: 'mig128-m2-' + run,
      p_animal_type: 'cattle_herd',
      p_group_key: 'mommas',
      p_group_label: 'Mommas',
      p_to_land_area_id: bId,
      p_moved_at: new Date().toISOString(),
      p_animal_count: 12,
      p_notes: 'mig128 smoke second move',
    });
    if (move2.error) throw new Error('record second move: ' + move2.error.message);

    const listed = await ua.rpc('list_land_areas', {p_include_deleted: false});
    if (listed.error) throw new Error('list_land_areas: ' + listed.error.message);
    const areas = listed.data?.land_areas || [];
    const a = areas.find((x) => x.id === aId);
    const b = areas.find((x) => x.id === bId);
    if (!a || !b) throw new Error('smoke areas missing from list_land_areas');
    if (a.rest_state !== 'resting') throw new Error(`expected A resting, got ${a.rest_state}`);
    if (b.rest_state !== 'occupied') throw new Error(`expected B occupied, got ${b.rest_state}`);
    if (!Array.isArray(b.current_occupants) || b.current_occupants[0]?.group_key !== 'mommas')
      throw new Error('B current_occupants did not include mommas');

    console.log('authed RPC smoke OK (A resting, B occupied, current occupant derived)');
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
