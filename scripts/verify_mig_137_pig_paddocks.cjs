// Read-only verifier for migration 137 (40 permanent feeder-pig paddocks).
// Confirms the 4 pig pastures each have 10 correct permanent paddock children.
// Does NOT apply or seed anything. Service-role REST reads (bypasses RLS).
//
// Usage:
//   node scripts/verify_mig_137_pig_paddocks.cjs prod   (default)
//   node scripts/verify_mig_137_pig_paddocks.cjs test
//
// Env (read from the main worktree .env files):
//   prod -> .env.prod.local  (PROD_SERVICE_ROLE_JWT)
//   test -> .env.test / .env.test.local (VITE_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)

const fs = require('fs');
const path = require('path');
const MAIN = path.resolve(__dirname, '..');
function loadEnv(f) {
  if (!fs.existsSync(f)) return;
  for (const line of fs.readFileSync(f, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (!m) continue;
    let v = m[2].trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    if (process.env[m[1]] === undefined) process.env[m[1]] = v;
  }
}
['.env.prod.local', '.env.test', '.env.test.local'].forEach((f) => loadEnv(path.join(MAIN, f)));

const ENV = (process.argv[2] || 'prod').toLowerCase();
const PROD_REF = 'pzfujbjtayhkdlxiblwe';
let url, key;
if (ENV === 'prod') {
  url = `https://${PROD_REF}.supabase.co`;
  key = process.env.PROD_SERVICE_ROLE_JWT;
} else if (ENV === 'test') {
  url = process.env.VITE_SUPABASE_URL;
  key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (url && url.includes(PROD_REF)) {
    console.error('test env points at PROD; aborting');
    process.exit(2);
  }
} else {
  console.error("env must be 'prod' or 'test'");
  process.exit(2);
}
if (!url || !key) {
  console.error(`missing url/key for ${ENV}`);
  process.exit(2);
}

const {createClient} = require(path.join(MAIN, 'node_modules', '@supabase', 'supabase-js'));
const svc = createClient(url, key, {auth: {autoRefreshToken: false, persistSession: false}});

const PARENTS = ['Pig Pasture #1', 'Pig Pasture #2', 'Pig Pasture #3', 'Pig Pasture #4'];
let pass = 0,
  fail = 0;
const ok = (l, c, d) => {
  c ? pass++ : fail++;
  console.log(`  ${c ? 'PASS' : 'FAIL'} ${l}${d ? ' — ' + d : ''}`);
};

(async () => {
  console.log(`VERIFY mig 137 against ${ENV.toUpperCase()} (${url})`);
  const {data: areas, error} = await svc
    .from('land_areas')
    .select(
      'id,name,kind,permanence,designation,status,review_status,geometry_status,computed_acres,parent_id,deleted_at',
    )
    .is('deleted_at', null);
  if (error) {
    console.error(error.message);
    process.exit(1);
  }

  const parents = areas.filter((a) => PARENTS.includes(a.name) && a.kind === 'pasture');
  ok(
    '4 parent pig pastures present (kind=pasture, active)',
    parents.length === 4 && parents.every((p) => p.status === 'active'),
    `${parents.length}`,
  );

  const pads = areas.filter((a) => a.kind === 'paddock' && a.permanence === 'permanent' && /^[A-D]-\d/.test(a.name));
  ok('exactly 40 permanent paddocks', pads.length === 40, `${pads.length}`);
  ok(
    'all paddocks designation=feeder_pig, active, reviewed',
    pads.every((p) => p.designation === 'feeder_pig' && p.status === 'active' && p.review_status === 'reviewed'),
  );
  ok(
    'all paddocks geometry_status=valid',
    pads.every((p) => p.geometry_status === 'valid'),
  );
  ok(
    'all paddock ids deterministic la-pigpad-*',
    pads.every((p) => /^la-pigpad-[a-d]\d+$/.test(p.id)),
  );
  const names = pads.map((p) => p.name);
  ok('no duplicate paddock names', new Set(names).size === names.length);

  for (const par of parents) {
    const kids = pads.filter((p) => p.parent_id === par.id);
    const tot = kids.reduce((s, k) => s + Number(k.computed_acres || 0), 0);
    const pa = Number(par.computed_acres || 0);
    ok(
      `${par.name}: 10 children & acres≈parent`,
      kids.length === 10 && pa > 0 && Math.abs(tot - pa) / pa < 0.05,
      `kids=${kids.length} child_total=${tot.toFixed(2)} parent=${pa.toFixed(2)}`,
    );
  }

  const ids = pads.map((p) => p.id);
  if (ids.length) {
    const {data: gvs} = await svc
      .from('land_area_geometry_versions')
      .select('land_area_id,version_number')
      .in('land_area_id', ids);
    const byArea = {};
    for (const g of gvs || []) (byArea[g.land_area_id] = byArea[g.land_area_id] || []).push(g.version_number);
    const bad = Object.entries(byArea).filter(([, v]) => v.length !== 1 || Math.max(...v) !== 1);
    ok(
      'every paddock has exactly 1 geometry version (v1)',
      ids.length === Object.keys(byArea).length && bad.length === 0,
    );
  }

  console.log(`\nSUMMARY (${ENV}): ${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
