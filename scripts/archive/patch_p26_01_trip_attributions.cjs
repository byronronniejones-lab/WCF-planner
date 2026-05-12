// scripts/patch_p26_01_trip_attributions.cjs
//
// One-off: stamp subAttributions on the 4 P-26-01 processing trips so the
// pig-batches view's ledger-derived "current" math has structured per-sub
// attribution. The 02/27, 03/24, 04/03 trips pre-date Send-to-Trip and
// only had the sub split in trip notes free-text; 04/22 was already
// structured via weigh_ins.sent_to_trip_id but stamping the trip too
// makes the read path uniform.
//
// Hard-coded mapping (per Ronnie 2026-04-27):
//   2026-02-27 → P-26-01B (BOARS) × 5
//   2026-03-24 → P-26-01A (GILTS) × 5
//   2026-04-03 → P-26-01A × 7 + P-26-01B × 3
//   2026-04-22 → P-26-01A × 2 + P-26-01B × 2
//
// Usage:
//   node scripts/patch_p26_01_trip_attributions.cjs           (dry run)
//   node scripts/patch_p26_01_trip_attributions.cjs --commit  (write)

const fs = require('fs');
const path = require('path');

function loadEnv() {
  const p = path.join(__dirname, '.env');
  if (!fs.existsSync(p)) return;
  for (const line of fs.readFileSync(p, 'utf8').split(/\r?\n/)) {
    const m = /^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*?)\s*$/.exec(line);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
}
loadEnv();

const COMMIT = process.argv.includes('--commit');
const TARGET_BATCH = 'P-26-01';

// Date → list of {subName, count}
const ATTRIBUTIONS = {
  '2026-02-27': [{subName: 'P-26-01B (BOARS)', count: 5}],
  '2026-03-24': [{subName: 'P-26-01A (GILTS)', count: 5}],
  '2026-04-03': [
    {subName: 'P-26-01A (GILTS)', count: 7},
    {subName: 'P-26-01B (BOARS)', count: 3},
  ],
  '2026-04-22': [
    {subName: 'P-26-01A (GILTS)', count: 2},
    {subName: 'P-26-01B (BOARS)', count: 2},
  ],
};

async function main() {
  const {createClient} = require('@supabase/supabase-js');
  const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: {persistSession: false},
  });

  const f = await sb.from('app_store').select('data').eq('key', 'ppp-feeders-v1').maybeSingle();
  if (f.error) {
    console.error('feeders read error:', f.error);
    process.exit(1);
  }
  const groups = f.data && Array.isArray(f.data.data) ? f.data.data : [];
  const gIdx = groups.findIndex((x) => x.batchName === TARGET_BATCH);
  if (gIdx < 0) {
    console.error('Batch', TARGET_BATCH, 'not found.');
    process.exit(2);
  }
  const g = groups[gIdx];
  const subs = g.subBatches || [];
  const subByName = {};
  for (const s of subs) subByName[s.name] = s.id;

  const newTrips = (g.processingTrips || []).map((t) => {
    const att = ATTRIBUTIONS[t.date];
    if (!att) return t;
    const subAttributions = [];
    for (const a of att) {
      const sb = subs.find((s) => s.name === a.subName);
      if (!sb) {
        console.warn('  ⚠ sub not found by name: ' + a.subName + ' for trip ' + t.date + ' — skipping that line');
        continue;
      }
      const isBoars = (parseInt(sb.boarCount) || 0) > 0 && (parseInt(sb.giltCount) || 0) === 0;
      subAttributions.push({subId: sb.id, subBatchName: sb.name, sex: isBoars ? 'Boars' : 'Gilts', count: a.count});
    }
    return {...t, subAttributions};
  });

  console.log('='.repeat(60));
  console.log('Patch plan for', TARGET_BATCH, COMMIT ? '(COMMIT)' : '(dry-run)');
  console.log('='.repeat(60));
  for (let i = 0; i < newTrips.length; i++) {
    const t = newTrips[i];
    console.log('  [' + t.date + '] pigCount=' + (t.pigCount || 0));
    const atts = t.subAttributions || [];
    if (atts.length === 0) {
      console.log('    (no attribution change)');
      continue;
    }
    let sum = 0;
    for (const a of atts) {
      const subName = subs.find((s) => s.id === a.subId)?.name || '(unknown)';
      console.log('    → ' + subName + ' × ' + a.count);
      sum += a.count;
    }
    if (sum !== (parseInt(t.pigCount) || 0)) {
      console.warn('    ⚠ sum-of-attributions (' + sum + ') ≠ trip.pigCount (' + t.pigCount + ')');
    }
  }
  console.log('');

  if (!COMMIT) {
    console.log('Dry-run only. Re-run with --commit to write.');
    return;
  }
  groups[gIdx] = {...g, processingTrips: newTrips};
  const w = await sb.from('app_store').upsert({key: 'ppp-feeders-v1', data: groups}, {onConflict: 'key'});
  if (w.error) {
    console.error('write error:', w.error);
    process.exit(1);
  }
  console.log('Patched.');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
