// Apply migration 180 to TEST and prove that advisory geometric impacts cannot
// change a paddock's direct occupancy/rest/history clock.
//
// This script is intentionally rerunnable and disposable-row-only. It never
// resets shared TEST data. Run only with an exclusive TEST window.
const fs = require('fs');
const path = require('path');

function loadDotEnv(file) {
  if (!fs.existsSync(file)) return;
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (!match) continue;
    let value = match[2].trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (process.env[match[1]] === undefined) process.env[match[1]] = value;
  }
}

loadDotEnv(path.join(__dirname, '..', '.env.test'));
loadDotEnv(path.join(__dirname, '..', '.env.test.local'));
// Fresh worktrees do not carry ignored credentials.
loadDotEnv(path.join(__dirname, '..', '..', 'WCF-planner', '.env.test'));
loadDotEnv(path.join(__dirname, '..', '..', 'WCF-planner', '.env.test.local'));

const url = process.env.VITE_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const anonKey = process.env.VITE_SUPABASE_ANON_KEY;
const adminEmail = process.env.VITE_TEST_ADMIN_EMAIL;
const adminPassword = process.env.VITE_TEST_ADMIN_PASSWORD;
const PROD_REF = 'pzfujbjtayhkdlxiblwe';

if (!url || !serviceKey || !anonKey || !adminEmail || !adminPassword) {
  console.error('missing TEST env');
  process.exit(2);
}
if (process.env.WCF_TEST_DATABASE !== '1' || url.includes(PROD_REF)) {
  console.error('refusing to run without WCF_TEST_DATABASE=1 on a non-PROD URL');
  process.exit(2);
}

const {createClient} = require(path.join(__dirname, '..', 'node_modules', '@supabase', 'supabase-js'));
const service = createClient(url, serviceKey, {auth: {autoRefreshToken: false, persistSession: false}});
const authed = createClient(url, anonKey, {auth: {autoRefreshToken: false, persistSession: false}});

const AREA = {
  D2: 'la-mig180-d2',
  D3: 'la-mig180-d3',
  X: 'la-mig180-x',
  Y: 'la-mig180-y',
};
const AREA_IDS = Object.values(AREA);
const MOVE = {
  D2_IN: 'pmv-mig180-d2-in',
  D2_OUT: 'pmv-mig180-d2-out',
  LATER_MOVE: 'pmv-mig180-later-move',
  D3_IN: 'pmv-mig180-d3-in',
  D3_OUT: 'pmv-mig180-d3-out',
  Y_CURRENT: 'pmv-mig180-y-current',
};
const MOVE_IDS = Object.values(MOVE);

function fail(message) {
  throw new Error(message);
}

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

// D3 and Y intentionally overlap so D3 keeps an advisory current overlap row.
const GEOM = {
  [AREA.D2]: box(-86.5, -86.499, 30.8, 30.801),
  [AREA.D3]: box(-86.498, -86.497, 30.8, 30.801),
  [AREA.X]: box(-86.496, -86.495, 30.8, 30.801),
  [AREA.Y]: box(-86.4975, -86.4965, 30.8, 30.801),
};

async function cleanup() {
  const errors = [];
  const impact = await service.from('pasture_move_impacts').delete().in('move_id', MOVE_IDS);
  if (impact.error) errors.push(`delete impacts: ${impact.error.message}`);
  const moves = await service.from('pasture_move_events').delete().in('id', MOVE_IDS);
  if (moves.error) errors.push(`delete moves: ${moves.error.message}`);
  const areas = await service.from('land_areas').delete().in('id', AREA_IDS);
  if (areas.error) errors.push(`delete areas: ${areas.error.message}`);
  if (errors.length) fail(`cleanup failed:\n- ${errors.join('\n- ')}`);
}

async function seed() {
  const areaRows = AREA_IDS.map(
    (id) => `(
      '${id}', 'paddock', 'Mig180 ${id}', 'permanent', 'active', 'reviewed', 'valid',
      false, 1.0, 'drawn',
      extensions.ST_Multi(extensions.ST_SetSRID(extensions.ST_GeomFromGeoJSON('${GEOM[id]}'), 4326))
    )`,
  );
  const sql = `
    INSERT INTO public.land_areas
      (id, kind, name, permanence, status, review_status, geometry_status,
       baseline_no_history, manual_acres, source, raw_geometry)
    VALUES ${areaRows.join(',')};

    INSERT INTO public.pasture_move_events
      (id, animal_type, group_key, group_label, from_land_area_id,
       to_land_area_id, moved_at, animal_count)
    VALUES
      ('${MOVE.D2_IN}', 'cattle_herd', 'mig180-d2', 'Mig180 D2 herd', NULL,
       '${AREA.D2}', now() - interval '15 days', 10),
      ('${MOVE.D2_OUT}', 'cattle_herd', 'mig180-d2', 'Mig180 D2 herd', '${AREA.D2}',
       '${AREA.X}', now() - interval '12 days', 10),
      ('${MOVE.LATER_MOVE}', 'cattle_herd', 'mig180-d2', 'Mig180 D2 herd', '${AREA.X}',
       '${AREA.Y}', now() - interval '8 days', 10),
      ('${MOVE.D3_IN}', 'cattle_herd', 'mig180-d3', 'Mig180 D3 herd', NULL,
       '${AREA.D3}', now() - interval '20 days', 11),
      ('${MOVE.D3_OUT}', 'cattle_herd', 'mig180-d3', 'Mig180 D3 herd', '${AREA.D3}',
       '${AREA.X}', now() - interval '15 days', 11),
      ('${MOVE.Y_CURRENT}', 'cattle_herd', 'mig180-current', 'Mig180 Current herd', NULL,
       '${AREA.Y}', now() - interval '1 day', 12);

    INSERT INTO public.pasture_move_impacts
      (move_id, land_area_id, impact_kind, impacted_at)
    VALUES
      ('${MOVE.D2_IN}', '${AREA.D2}', 'destination', now() - interval '15 days'),
      ('${MOVE.D2_OUT}', '${AREA.D2}', 'departure', now() - interval '12 days'),
      ('${MOVE.D2_OUT}', '${AREA.X}', 'destination', now() - interval '12 days'),
      -- This is the FP4D2 defect shape: an unrelated later move carries an
      -- overlap-derived departure for D2 and must not restart its clock.
      ('${MOVE.LATER_MOVE}', '${AREA.D2}', 'departure', now() - interval '8 days'),
      ('${MOVE.LATER_MOVE}', '${AREA.X}', 'departure', now() - interval '8 days'),
      ('${MOVE.LATER_MOVE}', '${AREA.Y}', 'destination', now() - interval '8 days'),
      ('${MOVE.D3_IN}', '${AREA.D3}', 'destination', now() - interval '20 days'),
      ('${MOVE.D3_OUT}', '${AREA.D3}', 'departure', now() - interval '15 days'),
      ('${MOVE.D3_OUT}', '${AREA.X}', 'destination', now() - interval '15 days'),
      ('${MOVE.Y_CURRENT}', '${AREA.Y}', 'destination', now() - interval '1 day'),
      -- This is the FP4D3 defect shape: a current overlap remains advisory.
      ('${MOVE.Y_CURRENT}', '${AREA.D3}', 'overlap', now() - interval '1 day');
  `;
  const result = await service.rpc('exec_sql', {sql});
  if (result.error) fail(`seed failed: ${result.error.message}`);
}

async function listArea(id) {
  const result = await authed.rpc('list_land_areas', {p_include_deleted: false});
  if (result.error) fail(`list_land_areas: ${result.error.message}`);
  const row = (result.data?.land_areas || []).find((area) => area.id === id);
  if (!row) fail(`missing area ${id}`);
  return row;
}

async function moveTime(id) {
  const result = await service.from('pasture_move_events').select('moved_at').eq('id', id).single();
  if (result.error || !result.data?.moved_at) fail(`missing move ${id}: ${result.error?.message || ''}`);
  return new Date(result.data.moved_at).getTime();
}

function sameTime(actual, expected, label) {
  if (new Date(actual).getTime() !== expected)
    fail(`${label}: expected ${new Date(expected).toISOString()}, got ${actual}`);
}

(async () => {
  console.log(`TEST url=${url}`);
  const signIn = await authed.auth.signInWithPassword({email: adminEmail, password: adminPassword});
  if (signIn.error) fail(`admin sign-in: ${signIn.error.message}`);

  await cleanup();
  await seed();

  const body = fs.readFileSync(
    path.join(__dirname, '..', 'supabase-migrations', '180_pasture_direct_rest_history.sql'),
    'utf8',
  );
  const apply = await service.rpc('exec_sql', {sql: body});
  if (apply.error) fail(`migration 180 apply: ${apply.error.message}`);
  await new Promise((resolve) => setTimeout(resolve, 1500));

  const [d2, d3, y, d2Out, d3Out] = await Promise.all([
    listArea(AREA.D2),
    listArea(AREA.D3),
    listArea(AREA.Y),
    moveTime(MOVE.D2_OUT),
    moveTime(MOVE.D3_OUT),
  ]);

  if (d2.rest_state !== 'resting' || Number(d2.current_occupancy_count) !== 0) {
    fail(`D2 must rest with zero direct occupants: ${JSON.stringify(d2)}`);
  }
  sameTime(d2.last_moved_out_at, d2Out, 'D2 rest start');
  sameTime(d2.last_touched_at, d2Out, 'D2 Last grazed');
  if (Number(d2.rest_days) < 11) fail(`D2 clock was shortened: ${d2.rest_days}`);

  if (d3.rest_state !== 'resting' || Number(d3.current_occupancy_count) !== 0) {
    fail(`D3 overlap must remain resting with zero direct occupants: ${JSON.stringify(d3)}`);
  }
  sameTime(d3.last_moved_out_at, d3Out, 'D3 rest start');
  sameTime(d3.last_touched_at, d3Out, 'D3 Last grazed');
  if (Number(d3.rest_days) < 14) fail(`D3 clock was reset by overlap: ${d3.rest_days}`);
  if (!(d3.current_occupants || []).some((o) => o.impact_kind === 'overlap')) {
    fail('D3 should retain its advisory overlap occupant in current_occupants');
  }

  if (y.rest_state !== 'occupied' || Number(y.current_occupancy_count) < 1) {
    fail(`direct destination Y must remain occupied: ${JSON.stringify(y)}`);
  }

  const helperCheck = await service.rpc('exec_sql', {
    sql: `DO $$ BEGIN
      IF public._land_area_is_occupied('${AREA.D2}') THEN
        RAISE EXCEPTION 'D2 overlap/departure history must not be occupied';
      END IF;
      IF public._land_area_is_occupied('${AREA.D3}') THEN
        RAISE EXCEPTION 'D3 overlap-only current impact must not be occupied';
      END IF;
      IF NOT public._land_area_is_occupied('${AREA.Y}') THEN
        RAISE EXCEPTION 'Y direct destination must be occupied';
      END IF;
    END $$;`,
  });
  if (helperCheck.error) fail(`occupied helper proof: ${helperCheck.error.message}`);

  console.log('  [ok] direct departure owns Rest started + Last grazed');
  console.log('  [ok] current overlap remains advisory and cannot reset rest/shading');
  console.log('  [ok] direct destination remains occupied');
  await cleanup();
  console.log('migration 180 TEST proof: ALL CHECKS PASSED');
})()
  .catch((error) => {
    console.error('FAIL:', error?.message || error);
    process.exitCode = 1;
  })
  .finally(async () => {
    try {
      await cleanup();
      await authed.auth.signOut();
    } catch (error) {
      console.error('CLEANUP FAIL:', error?.message || error);
      process.exitCode = 1;
    }
  });
