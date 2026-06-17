// Apply mig 130 (Pasture Map CP6 field GPS tracks) to TEST via exec_sql.
// Hard PROD-ref guard. Smokes the authenticated RPC path with a LineString
// field track that lands as an outline_candidate.
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
const admin = createClient(url, serviceKey, {auth: {autoRefreshToken: false, persistSession: false}});
const authed = createClient(url, anonKey, {auth: {autoRefreshToken: false, persistSession: false}});

const TRACK = {
  type: 'LineString',
  coordinates: [
    [-86.44, 30.84],
    [-86.439, 30.84],
    [-86.439, 30.841],
  ],
};

(async () => {
  if (!anonKey || !adminEmail || !adminPass) {
    console.error('missing TEST auth env (anon key / admin email / admin password)');
    process.exit(2);
  }
  console.log(`TEST url=${url}`);
  const body = fs.readFileSync(
    path.join(__dirname, '..', 'supabase-migrations', '130_pasture_map_field_tracks.sql'),
    'utf8',
  );
  console.log(`applying 130_pasture_map_field_tracks.sql (${body.length} bytes)`);
  const {error: applyErr} = await admin.rpc('exec_sql', {sql: body});
  if (applyErr) {
    console.error('exec_sql APPLY failed:', applyErr.message || applyErr);
    process.exit(1);
  }
  await admin.rpc('exec_sql', {sql: "NOTIFY pgrst, 'reload schema';"});
  await new Promise((resolve) => setTimeout(resolve, 2000));

  const {error: cleanErr} = await admin.rpc('exec_sql', {
    sql: "DELETE FROM public.land_areas WHERE id LIKE 'track-smoke-%';",
  });
  if (cleanErr) {
    console.error('cleanup failed:', cleanErr.message || cleanErr);
    process.exit(1);
  }

  const {error: signErr} = await authed.auth.signInWithPassword({email: adminEmail, password: adminPass});
  if (signErr) {
    console.error('signIn failed:', signErr.message || signErr);
    process.exit(1);
  }

  const id = 'track-smoke-' + Date.now();
  const {data, error} = await authed.rpc('create_land_area_track', {
    p_id: id,
    p_name: 'Track Smoke',
    p_line_geojson: TRACK,
    p_source: 'drawn',
  });
  if (error) {
    console.error('create_land_area_track failed:', error.message || error);
    process.exit(1);
  }
  if (!data || data.kind !== 'outline_candidate' || data.geometry_status !== 'outline_candidate') {
    console.error('unexpected track response:', JSON.stringify(data, null, 2));
    process.exit(1);
  }
  console.log('track smoke ok:', data.id, data.kind, data.raw_geometry && data.raw_geometry.type);
})();
