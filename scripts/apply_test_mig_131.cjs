// Apply mig 131 (Pasture Map CP7 boundary line style) to TEST via exec_sql.
// Hard PROD-ref guard. Smokes the authenticated update_land_area style path.
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

(async () => {
  if (!anonKey || !adminEmail || !adminPass) {
    console.error('missing TEST auth env (anon key / admin email / admin password)');
    process.exit(2);
  }
  console.log(`TEST url=${url}`);
  const body = fs.readFileSync(
    path.join(__dirname, '..', 'supabase-migrations', '131_pasture_map_line_style.sql'),
    'utf8',
  );
  console.log(`applying 131_pasture_map_line_style.sql (${body.length} bytes)`);
  const {error: applyErr} = await admin.rpc('exec_sql', {sql: body});
  if (applyErr) {
    console.error('exec_sql APPLY failed:', applyErr.message || applyErr);
    process.exit(1);
  }
  await admin.rpc('exec_sql', {sql: "NOTIFY pgrst, 'reload schema';"});
  await new Promise((resolve) => setTimeout(resolve, 2000));

  const id = 'style-smoke-' + Date.now();
  const {error: seedErr} = await admin.rpc('exec_sql', {
    sql: `
      DELETE FROM public.land_areas WHERE id LIKE 'style-smoke-%';
      INSERT INTO public.land_areas
        (id, kind, name, status, review_status, geometry_status, baseline_no_history, source)
      VALUES
        ('${id}', 'paddock', 'Style Smoke', 'active', 'reviewed', 'none', true, 'drawn');
    `,
  });
  if (seedErr) {
    console.error('seed failed:', seedErr.message || seedErr);
    process.exit(1);
  }

  const {error: signErr} = await authed.auth.signInWithPassword({email: adminEmail, password: adminPass});
  if (signErr) {
    console.error('signIn failed:', signErr.message || signErr);
    process.exit(1);
  }

  const {data, error} = await authed.rpc('update_land_area', {
    p_id: id,
    p_line_color: '#2563eb',
    p_line_weight: 6,
  });
  if (error) {
    console.error('update_land_area style failed:', error.message || error);
    process.exit(1);
  }
  if (!data || data.line_color !== '#2563eb' || data.line_weight !== 6) {
    console.error('unexpected style response:', JSON.stringify(data, null, 2));
    process.exit(1);
  }
  console.log('line style smoke ok:', data.id, data.line_color, data.line_weight);
})();
