// Apply mig 158 (Pasture Map positive-area overlap impacts) to TEST via exec_sql,
// then behaviorally verify the FP4C1/FP4E2 false-resting bug pattern with REAL
// 4326 polygons that only SHARE AN EDGE (zero-area touch) vs a real positive-area
// overlap.
//
// Read-side (pre-existing false impacts become inert, no data cleanup):
//   move 1: cattle group moves INTO D1  (old code also stamped an overlap on the
//           edge-touch neighbour C1)
//   move 2: same group moves D1 -> E1   (old code stamped a departure on C1 from
//           move 1's C1 overlap, and an overlap on the edge-touch neighbour E2 of
//           E1, plus a real overlap on OVER which genuinely overlaps E1)
//   After 158:  D1 = resting, E1 = occupied, C1 = baseline, E2 = baseline,
//               OVER = occupied (real overlap still counts).
//
// Write-side (the RPC no longer stamps edge-touch overlaps):
//   record_pasture_move into E1 stamps destination E1 + overlap OVER, and NO
//   overlap on the edge-touch neighbour E2.
//
// Feeder-pig conflict:
//   an edge-touch neighbour does NOT conflict; a real positive overlap DOES.
//
// Hard PROD-ref guard. Cleans up every synthetic row.
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
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const anonKey = process.env.VITE_SUPABASE_ANON_KEY;
const adminEmail = process.env.VITE_TEST_ADMIN_EMAIL;
const adminPassword = process.env.VITE_TEST_ADMIN_PASSWORD;
const PROD_REF = 'pzfujbjtayhkdlxiblwe';

if (!url || !serviceKey || !anonKey || !adminEmail || !adminPassword) {
  console.error('missing TEST env (url / service key / anon key / admin email+password)');
  process.exit(2);
}
if (url.includes(PROD_REF)) {
  console.error('refusing to run against PROD url');
  process.exit(2);
}

const {createClient} = require(path.join(__dirname, '..', 'node_modules', '@supabase', 'supabase-js'));
const service = createClient(url, serviceKey, {auth: {autoRefreshToken: false, persistSession: false}});
const authed = createClient(url, anonKey, {auth: {autoRefreshToken: false, persistSession: false}});

// ---- synthetic ids (hyphen-only so record_pasture_move accepts move ids) -----
const A = {
  D1: 'la-mig158-d1',
  C1: 'la-mig158-c1',
  E1: 'la-mig158-e1',
  E2: 'la-mig158-e2',
  OVER: 'la-mig158-over',
  FA: 'la-mig158-fa',
  FB: 'la-mig158-fb',
  FC: 'la-mig158-fc',
  FD: 'la-mig158-fd',
};
const AREA_IDS = Object.values(A);

const READ_GROUP = 'mig158-read';
const MOVE_1 = 'pmv-mig158-into-d1';
const MOVE_2 = 'pmv-mig158-d1-to-e1';
const WRITE_MOVE = 'pmv-mig158-write-e1';
const FEED = {
  FA: 'pmv-mig158-feed-a',
  FB: 'pmv-mig158-feed-b',
  FC: 'pmv-mig158-feed-c',
  FD: 'pmv-mig158-feed-d',
};
const MOVE_IDS = [MOVE_1, MOVE_2, WRITE_MOVE, ...Object.values(FEED)];

// ---- geometry: unit boxes; identical shared coords => exact zero-area edges ---
// Read-side band lat [30.800, 30.801]; feeder band lat [30.810, 30.811].
function box(lonMin, lonMax, latMin, latMax) {
  return JSON.stringify({
    type: 'Polygon',
    coordinates: [
      [
        [lonMin, latMin],
        [lonMax, latMin],
        [lonMax, latMax],
        [lonMin, latMax],
        [lonMin, latMin],
      ],
    ],
  });
}
const GEOM = {
  // read-side
  [A.C1]: box(-86.401, -86.4, 30.8, 30.801), // edge-touch D1 at lon -86.400
  [A.D1]: box(-86.4, -86.399, 30.8, 30.801),
  [A.E1]: box(-86.397, -86.396, 30.8, 30.801), // gap from D1 -> disjoint
  [A.E2]: box(-86.396, -86.395, 30.8, 30.801), // edge-touch E1 at lon -86.396
  [A.OVER]: box(-86.3968, -86.3963, 30.8, 30.801), // strictly inside E1 -> positive
  // feeder
  [A.FA]: box(-86.4, -86.399, 30.81, 30.811),
  [A.FB]: box(-86.399, -86.398, 30.81, 30.811), // edge-touch FA -> no conflict
  [A.FC]: box(-86.39, -86.389, 30.81, 30.811),
  [A.FD]: box(-86.3895, -86.389, 30.81, 30.811), // inside FC -> positive -> conflict
};

function die(msg) {
  console.error('FAIL:', msg);
  process.exit(1);
}

async function cleanup() {
  await service.from('pasture_move_impacts').delete().in('move_id', MOVE_IDS);
  await service.from('pasture_move_events').delete().in('id', MOVE_IDS);
  await service.from('land_areas').delete().in('id', AREA_IDS);
}

async function seedAreas() {
  const rows = AREA_IDS.map(
    (id) => `(
      '${id}', 'paddock', 'Mig158 ${id}', 'permanent', 'active', 'reviewed', 'valid',
      false, 1.0, 'drawn',
      extensions.ST_Multi(extensions.ST_SetSRID(extensions.ST_GeomFromGeoJSON('${GEOM[id]}'), 4326))
    )`,
  );
  const sql = `
    INSERT INTO public.land_areas
      (id, kind, name, permanence, status, review_status, geometry_status,
       baseline_no_history, manual_acres, source, raw_geometry)
    VALUES
      ${rows.join(',\n      ')}
    ON CONFLICT (id) DO UPDATE SET
      raw_geometry = EXCLUDED.raw_geometry,
      geometry_status = 'valid',
      status = 'active',
      deleted_at = NULL,
      baseline_no_history = false;
  `;
  const {error} = await service.rpc('exec_sql', {sql});
  if (error) die('seed geometry failed: ' + (error.message || error));
}

async function listArea(areaId) {
  const {data, error} = await authed.rpc('list_land_areas', {p_include_deleted: false});
  if (error) die('list_land_areas failed: ' + (error.message || error));
  const row = (data && data.land_areas ? data.land_areas : []).find((a) => a.id === areaId);
  if (!row) die('area not found in list_land_areas: ' + areaId);
  return row;
}

async function recordMove(opts) {
  return authed.rpc('record_pasture_move', {
    p_move_id: opts.moveId,
    p_animal_type: opts.animalType,
    p_group_key: opts.groupKey,
    p_group_label: opts.groupLabel,
    p_to_land_area_id: opts.toAreaId,
    p_moved_at: opts.movedAt || new Date().toISOString(),
    p_animal_count: opts.count || 10,
  });
}

(async () => {
  console.log(`TEST url=${url}`);

  const {error: signErr} = await authed.auth.signInWithPassword({email: adminEmail, password: adminPassword});
  if (signErr) die('admin signIn failed: ' + (signErr.message || signErr));

  await cleanup();
  await seedAreas();

  // ---- Phase A: simulate PRE-158 false impacts (old ST_Intersects code) -------
  const movedInAt = new Date(Date.now() - 6 * 86400_000).toISOString();
  const movedOutAt = new Date(Date.now() - 3 * 86400_000).toISOString();

  const {error: mErr} = await service.from('pasture_move_events').insert([
    {
      id: MOVE_1,
      animal_type: 'cattle_herd',
      group_key: READ_GROUP,
      group_label: 'Mig158 Read Group',
      from_land_area_id: null,
      to_land_area_id: A.D1,
      moved_at: movedInAt,
      animal_count: 12,
    },
    {
      id: MOVE_2,
      animal_type: 'cattle_herd',
      group_key: READ_GROUP,
      group_label: 'Mig158 Read Group',
      from_land_area_id: A.D1,
      to_land_area_id: A.E1,
      moved_at: movedOutAt,
      animal_count: 12,
    },
  ]);
  if (mErr) die('read-side move insert failed: ' + (mErr.message || mErr));

  const {error: iErr} = await service.from('pasture_move_impacts').insert([
    // move 1 into D1: real destination + FALSE edge-touch overlap on C1
    {move_id: MOVE_1, land_area_id: A.D1, impact_kind: 'destination', impacted_at: movedInAt},
    {move_id: MOVE_1, land_area_id: A.C1, impact_kind: 'overlap', impacted_at: movedInAt},
    // move 2 D1 -> E1: real destination E1, real departure D1, FALSE departure C1
    // (derived from move 1's C1 overlap), FALSE edge-touch overlap E2, REAL
    // positive overlap OVER.
    {move_id: MOVE_2, land_area_id: A.E1, impact_kind: 'destination', impacted_at: movedOutAt},
    {move_id: MOVE_2, land_area_id: A.D1, impact_kind: 'departure', impacted_at: movedOutAt},
    {move_id: MOVE_2, land_area_id: A.C1, impact_kind: 'departure', impacted_at: movedOutAt},
    {move_id: MOVE_2, land_area_id: A.E2, impact_kind: 'overlap', impacted_at: movedOutAt},
    {move_id: MOVE_2, land_area_id: A.OVER, impact_kind: 'overlap', impacted_at: movedOutAt},
  ]);
  if (iErr) die('read-side impact insert failed: ' + (iErr.message || iErr));

  for (const id of [A.D1, A.C1, A.E1, A.E2, A.OVER]) {
    const b = await listArea(id);
    console.log(
      `  [pre-158] ${id} rest_state=${b.rest_state}, occ=${b.current_occupancy_count}, rest_days=${b.rest_days}`,
    );
  }

  // ---- apply 158 -------------------------------------------------------------
  const body = fs.readFileSync(
    path.join(__dirname, '..', 'supabase-migrations', '158_pasture_map_positive_overlap_impacts.sql'),
    'utf8',
  );
  console.log(`applying 158_pasture_map_positive_overlap_impacts.sql (${body.length} bytes)`);
  const {error: applyErr} = await service.rpc('exec_sql', {sql: body});
  if (applyErr) die('exec_sql APPLY failed: ' + (applyErr.message || applyErr));
  await new Promise((resolve) => setTimeout(resolve, 2500));

  // ---- verify read-side ------------------------------------------------------
  const d1 = await listArea(A.D1);
  const e1 = await listArea(A.E1);
  const c1 = await listArea(A.C1);
  const e2 = await listArea(A.E2);
  const over = await listArea(A.OVER);
  for (const [id, r] of [
    [A.D1, d1],
    [A.C1, c1],
    [A.E1, e1],
    [A.E2, e2],
    [A.OVER, over],
  ]) {
    console.log(
      `  [post-158] ${id} rest_state=${r.rest_state}, occ=${r.current_occupancy_count}, rest_days=${r.rest_days}`,
    );
  }

  if (d1.rest_state !== 'resting') die(`D1 (old destination) should read resting, got ${d1.rest_state}`);
  if (Number(d1.rest_days) < 2) die(`D1 should have >= 2 rest days, got ${d1.rest_days}`);
  if (Number(d1.current_occupancy_count || 0) !== 0)
    die(`D1 should have no occupants, got ${d1.current_occupancy_count}`);

  if (e1.rest_state !== 'occupied') die(`E1 (new destination) should read occupied, got ${e1.rest_state}`);
  if (Number(e1.current_occupancy_count || 0) < 1) die(`E1 should have an occupant, got ${e1.current_occupancy_count}`);

  if (c1.rest_state !== 'baseline') die(`C1 (edge-touch neighbour of D1) should read baseline, got ${c1.rest_state}`);
  if (c1.last_moved_out_at) die(`C1 should have no last_moved_out_at, got ${c1.last_moved_out_at}`);
  if (Number(c1.current_occupancy_count || 0) !== 0)
    die(`C1 should have no occupants, got ${c1.current_occupancy_count}`);

  if (e2.rest_state !== 'baseline') die(`E2 (edge-touch neighbour of E1) should read baseline, got ${e2.rest_state}`);
  if (Number(e2.current_occupancy_count || 0) !== 0)
    die(`E2 should have no occupants, got ${e2.current_occupancy_count}`);

  if (over.rest_state !== 'occupied')
    die(`OVER (real positive overlap of E1) should stay occupied, got ${over.rest_state}`);
  if (Number(over.current_occupancy_count || 0) < 1)
    die(`OVER should keep its overlap occupant, got ${over.current_occupancy_count}`);

  console.log(
    '  [ok] edge-touch neighbours read baseline; departed area rests; new destination + real overlap occupied',
  );

  // ---- verify write-side: RPC stamps no edge-touch overlap -------------------
  const {error: wErr} = await recordMove({
    moveId: WRITE_MOVE,
    animalType: 'cattle_herd',
    groupKey: 'mig158-write',
    groupLabel: 'Mig158 Write Group',
    toAreaId: A.E1,
    count: 9,
  });
  if (wErr) die('write-side record_pasture_move failed: ' + (wErr.message || wErr));

  const {data: wImpacts, error: wiErr} = await service
    .from('pasture_move_impacts')
    .select('land_area_id, impact_kind')
    .eq('move_id', WRITE_MOVE);
  if (wiErr) die('write-side impact read failed: ' + (wiErr.message || wiErr));
  const has = (areaId, kind) => wImpacts.some((r) => r.land_area_id === areaId && r.impact_kind === kind);
  const touches = (areaId) => wImpacts.some((r) => r.land_area_id === areaId);
  if (!has(A.E1, 'destination')) die('write move should stamp destination on E1');
  if (!has(A.OVER, 'overlap')) die('write move should stamp a real positive overlap on OVER');
  if (touches(A.E2)) die('write move must NOT stamp any impact on the edge-touch neighbour E2');
  if (touches(A.C1) || touches(A.D1)) die('write move must not touch disjoint areas C1/D1');
  console.log('  [ok] record_pasture_move stamped destination E1 + overlap OVER, and NO edge-touch overlap on E2');

  // ---- verify feeder-pig conflict: edge-touch OK, positive overlap conflicts --
  const {error: faErr} = await recordMove({
    moveId: FEED.FA,
    animalType: 'feeder_pigs',
    groupKey: 'mig158-feed-a',
    groupLabel: 'Mig158 Feeder A',
    toAreaId: A.FA,
    count: 20,
  });
  if (faErr) die('feeder A into FA should succeed: ' + (faErr.message || faErr));

  const {error: fbErr} = await recordMove({
    moveId: FEED.FB,
    animalType: 'feeder_pigs',
    groupKey: 'mig158-feed-b',
    groupLabel: 'Mig158 Feeder B',
    toAreaId: A.FB,
    count: 20,
  });
  if (fbErr) {
    die('feeder B into the EDGE-TOUCH neighbour FB should NOT conflict, got: ' + (fbErr.message || fbErr));
  }
  console.log('  [ok] feeder move into an edge-touch neighbour did not conflict');

  const {error: fcErr} = await recordMove({
    moveId: FEED.FC,
    animalType: 'feeder_pigs',
    groupKey: 'mig158-feed-c',
    groupLabel: 'Mig158 Feeder C',
    toAreaId: A.FC,
    count: 20,
  });
  if (fcErr) die('feeder C into FC should succeed: ' + (fcErr.message || fcErr));

  const {error: fdErr} = await recordMove({
    moveId: FEED.FD,
    animalType: 'feeder_pigs',
    groupKey: 'mig158-feed-d',
    groupLabel: 'Mig158 Feeder D',
    toAreaId: A.FD,
    count: 20,
  });
  if (!fdErr) die('feeder D into a REAL positive overlap of FC should conflict, but it succeeded');
  if (!/feeder pig area already occupied/i.test(fdErr.message || String(fdErr))) {
    die('feeder D conflict wrong error: ' + (fdErr.message || fdErr));
  }
  console.log('  [ok] feeder move into a real positive overlap conflicted as expected');

  await cleanup();
  console.log('mig158 verify: ALL CHECKS PASSED');
  process.exit(0);
})().catch(async (e) => {
  try {
    await cleanup();
  } catch {
    /* best effort */
  }
  console.error('FAIL (exception):', e && (e.message || e));
  process.exit(1);
});
