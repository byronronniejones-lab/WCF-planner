// One-off: apply mig 135 (temp-paddock lifecycle) to the TEST Supabase project
// via the exec_sql SECDEF RPC, then verify the RPCs BEHAVIORALLY through
// authenticated PostgREST calls (exec_sql returns void, so the catalog cannot be
// read back through it). Covers create/rename/redraw/archive/restore/hard-delete
// + occupancy block + invalid-polygon reject + anon reject.
//
// Env is read from the MAIN worktree (.env files are gitignored and not copied
// into parallel worktrees).
//
// Usage: node scripts/apply_test_mig_135.cjs

const fs = require('fs');
const path = require('path');

const MAIN_WORKTREE = 'C:/Users/Ronni/WCF-planner';
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
loadDotEnv(path.join(MAIN_WORKTREE, '.env.test'));
loadDotEnv(path.join(MAIN_WORKTREE, '.env.test.local'));

const url = process.env.VITE_SUPABASE_URL;
const anonKey = process.env.VITE_SUPABASE_ANON_KEY;
const svcKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const adminEmail = process.env.VITE_TEST_ADMIN_EMAIL;
const adminPassword = process.env.VITE_TEST_ADMIN_PASSWORD;
if (!url || !anonKey || !svcKey || !adminEmail || !adminPassword) {
  console.error(
    'missing env (need VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY, VITE_TEST_ADMIN_EMAIL/PASSWORD)',
  );
  process.exit(2);
}
const PROD_REF = 'pzfujbjtayhkdlxiblwe';
if (url.includes(PROD_REF)) {
  console.error('refusing to run against PROD URL');
  process.exit(2);
}

const {createClient} = require(path.join(__dirname, '..', 'node_modules', '@supabase', 'supabase-js'));
const svc = createClient(url, svcKey, {auth: {autoRefreshToken: false, persistSession: false}});

const MIG = path.resolve(__dirname, '..', 'supabase-migrations', '135_pasture_map_temp_paddocks.sql');

// Small valid square near the farm (lon,lat), and a self-intersecting bowtie.
const sq = (dx = 0) => ({
  type: 'Polygon',
  coordinates: [
    [
      [-86.437 + dx, 30.8415],
      [-86.436 + dx, 30.8415],
      [-86.436 + dx, 30.842],
      [-86.437 + dx, 30.842],
      [-86.437 + dx, 30.8415],
    ],
  ],
});
const bowtie = {
  type: 'Polygon',
  coordinates: [
    [
      [-86.437, 30.8415],
      [-86.436, 30.842],
      [-86.436, 30.8415],
      [-86.437, 30.842],
      [-86.437, 30.8415],
    ],
  ],
};

let pass = 0;
let fail = 0;
function ok(label, cond, detail) {
  if (cond) {
    pass++;
    console.log(`  PASS ${label}` + (detail ? ` — ${detail}` : ''));
  } else {
    fail++;
    console.log(`  FAIL ${label}` + (detail ? ` — ${detail}` : ''));
  }
}
async function expectThrow(label, fn, needle) {
  try {
    await fn();
    fail++;
    console.log(`  FAIL ${label} — expected error, got success`);
  } catch (e) {
    const msg = e.message || String(e);
    ok(label, !needle || msg.includes(needle), msg);
  }
}

(async () => {
  console.log(`TEST DB url=${url}`);

  // 1) Apply (idempotent: CREATE OR REPLACE / REVOKE / GRANT; no BEGIN/COMMIT).
  const sql = fs.readFileSync(MIG, 'utf8');
  const {error: applyErr} = await svc.rpc('exec_sql', {sql});
  if (applyErr) {
    console.error('exec_sql apply FAILED:', applyErr.message || applyErr);
    process.exit(1);
  }
  console.log(`applied 135 (${sql.length} bytes) OK`);

  // exec_sql returns void (cannot read catalog/SELECT back through it), so the
  // RPCs are verified BEHAVIORALLY below via authenticated PostgREST calls.
  // Reload PostgREST's schema cache so the new functions are routable.
  await svc.rpc('exec_sql', {sql: "NOTIFY pgrst, 'reload schema';"});
  await new Promise((r) => setTimeout(r, 4000));
  console.log('PostgREST schema cache reloaded\n');

  // 3) Behavioral (admin-authenticated session -> auth.uid() + admin role).
  console.log('\nBEHAVIORAL (admin):');
  const usr = createClient(url, anonKey, {auth: {autoRefreshToken: false, persistSession: false}});
  const {error: signErr} = await usr.auth.signInWithPassword({email: adminEmail, password: adminPassword});
  if (signErr) {
    console.error('admin sign-in FAILED:', signErr.message);
    process.exit(1);
  }
  const stamp = Date.now();
  const id1 = `la-t135-${stamp}-a`;
  const id2 = `la-t135-${stamp}-b`;
  const grpKey = `t135grp-${stamp}`;

  // create_temp_land_area
  const {data: c1, error: e1} = await usr.rpc('create_temp_land_area', {
    p_id: id1,
    p_name: 'Temp - test',
    p_polygon_geojson: sq(0),
    p_source: 'drawn',
  });
  ok(
    'create_temp_land_area returns area',
    !e1 && c1 && c1.id === id1,
    e1
      ? e1.message
      : `kind=${c1 && c1.kind} perm=${c1 && c1.permanence} status=${c1 && c1.status} gstatus=${c1 && c1.geometry_status} acres=${c1 && c1.computed_acres}`,
  );
  if (c1) {
    ok('  -> kind=paddock', c1.kind === 'paddock');
    ok('  -> permanence=temporary', c1.permanence === 'temporary');
    ok('  -> status=active', c1.status === 'active');
    ok('  -> geometry_status=valid', c1.geometry_status === 'valid');
    ok('  -> computed_acres > 0', Number(c1.computed_acres) > 0, String(c1.computed_acres));
  }

  // replay idempotency
  const {data: cReplay} = await usr.rpc('create_temp_land_area', {
    p_id: id1,
    p_name: 'Temp - test',
    p_polygon_geojson: sq(0),
    p_source: 'drawn',
  });
  ok('create replay is idempotent', cReplay && cReplay.replayed === true);

  // invalid polygon rejected
  await expectThrow(
    'invalid (self-intersecting) polygon rejected',
    () =>
      usr
        .rpc('create_temp_land_area', {p_id: `${id1}-bad`, p_name: 'bad', p_polygon_geojson: bowtie})
        .then(({error}) => {
          if (error) throw new Error(error.message);
        }),
    'self-intersecting',
  );

  // rename
  const {data: rn, error: rnErr} = await usr.rpc('rename_temp_land_area', {p_id: id1, p_name: 'Temp - renamed'});
  ok(
    'rename_temp_land_area updates name',
    !rnErr && rn && rn.name === 'Temp - renamed',
    rnErr ? rnErr.message : rn && rn.name,
  );

  // redraw -> new version number
  const {data: rd, error: rdErr} = await usr.rpc('update_temp_land_area_geometry', {
    p_id: id1,
    p_polygon_geojson: sq(0.0005),
  });
  ok(
    'update_temp_land_area_geometry appends version',
    !rdErr && rd && rd.current_version && rd.current_version.version_number >= 2,
    rdErr ? rdErr.message : rd && rd.current_version && `v${rd.current_version.version_number}`,
  );

  // occupancy: record a move with destination id1, then archive must block
  const {error: mvErr} = await usr.rpc('record_pasture_move', {
    p_move_id: `pmv-t135-${stamp}-1`,
    p_animal_type: 'cattle_herd',
    p_group_key: grpKey,
    p_group_label: 'T135 Herd',
    p_to_land_area_id: id1,
    p_moved_at: new Date().toISOString(),
    p_animal_count: 10,
    p_notes: null,
  });
  ok('record_pasture_move onto temp ok', !mvErr, mvErr && mvErr.message);
  await expectThrow(
    'archive blocked when occupied (PM_AREA_OCCUPIED)',
    () =>
      usr.rpc('archive_land_area', {p_id: id1}).then(({error}) => {
        if (error) throw new Error(error.message);
      }),
    'PM_AREA_OCCUPIED',
  );
  await expectThrow(
    'hard delete blocked when occupied (PM_AREA_OCCUPIED)',
    () =>
      usr.rpc('hard_delete_land_area', {p_id: id1}).then(({error}) => {
        if (error) throw new Error(error.message);
      }),
    'PM_AREA_OCCUPIED',
  );

  // move group away to id2 -> id1 no longer occupied
  await usr.rpc('create_temp_land_area', {p_id: id2, p_name: 'Temp - sink', p_polygon_geojson: sq(0.002)});
  const {error: mv2Err} = await usr.rpc('record_pasture_move', {
    p_move_id: `pmv-t135-${stamp}-2`,
    p_animal_type: 'cattle_herd',
    p_group_key: grpKey,
    p_group_label: 'T135 Herd',
    p_to_land_area_id: id2,
    p_moved_at: new Date(Date.now() + 1000).toISOString(),
    p_animal_count: 10,
    p_notes: null,
  });
  ok('record move away ok', !mv2Err, mv2Err && mv2Err.message);

  // archive (now unoccupied) -> retired
  const {data: ar, error: arErr} = await usr.rpc('archive_land_area', {p_id: id1});
  ok('archive_land_area -> retired', !arErr && ar && ar.status === 'retired', arErr ? arErr.message : ar && ar.status);

  // restore -> active
  const {data: rs, error: rsErr} = await usr.rpc('restore_land_area', {p_id: id1});
  ok('restore_land_area -> active', !rsErr && rs && rs.status === 'active', rsErr ? rsErr.message : rs && rs.status);

  // hard delete -> gone from list_land_areas(false)
  const {data: hd, error: hdErr} = await usr.rpc('hard_delete_land_area', {p_id: id1});
  ok(
    'hard_delete_land_area -> deleted',
    !hdErr && hd && hd.deleted === true,
    hdErr ? hdErr.message : JSON.stringify(hd),
  );
  const {data: listed, error: lErr} = await usr.rpc('list_land_areas', {p_include_deleted: false});
  const stillThere = listed && listed.land_areas && listed.land_areas.some((a) => a.id === id1);
  ok('hard-deleted area is excluded from list_land_areas(false)', !lErr && !stillThere, lErr && lErr.message);

  // 4) anon reject (no session)
  console.log('\nNEGATIVE (anon, no session):');
  const anon = createClient(url, anonKey, {auth: {autoRefreshToken: false, persistSession: false}});
  await expectThrow('anon create_temp_land_area rejected', () =>
    anon
      .rpc('create_temp_land_area', {p_id: `la-anon-${stamp}`, p_name: 'x', p_polygon_geojson: sq(0)})
      .then(({error}) => {
        if (error) throw new Error(error.message);
      }),
  );

  console.log(`\nSUMMARY: ${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
