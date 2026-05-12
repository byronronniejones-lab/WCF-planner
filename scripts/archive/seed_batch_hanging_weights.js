// scripts/seed_batch_hanging_weights.js
//
// For each cattle_processing_batches row, sum the hanging_weight of all cows
// linked via processing_batch_id and write the total to total_hanging_weight.
// Carcass yield is display-only (computed per-cow), so we don't seed that.
//
// Usage:
//   node scripts/seed_batch_hanging_weights.js           # preview only
//   node scripts/seed_batch_hanging_weights.js --commit  # apply PATCH

const fs = require('fs');
const path = require('path');
for (const l of fs.readFileSync(path.join(__dirname, '.env'), 'utf8').split(/\r?\n/)) {
  const m = /^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*?)\s*$/.exec(l);
  if (m) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
}
const URL = process.env.SUPABASE_URL,
  KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const H = {apikey: KEY, Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json'};

async function fetchAll(qs) {
  let all = [],
    from = 0;
  while (true) {
    const r = await fetch(`${URL}/rest/v1/${qs}&limit=1000&offset=${from}`, {headers: H});
    const d = await r.json();
    all = all.concat(d);
    if (d.length < 1000) break;
    from += 1000;
  }
  return all;
}

(async () => {
  const batches = await fetchAll('cattle_processing_batches?select=id,name,total_hanging_weight&');
  const cattle = await fetchAll(
    'cattle?select=id,tag,processing_batch_id,hanging_weight&processing_batch_id=not.is.null&',
  );
  const sums = new Map();
  for (const c of cattle) {
    const hw = parseFloat(c.hanging_weight);
    if (!Number.isFinite(hw) || hw <= 0) continue;
    sums.set(c.processing_batch_id, (sums.get(c.processing_batch_id) || 0) + hw);
  }

  console.log('===== BATCH HANGING-WEIGHT SEED PREVIEW =====\n');
  const plans = [];
  for (const b of batches) {
    const newTotal = sums.get(b.id) || 0;
    if (newTotal === 0) continue;
    const oldTotal = parseFloat(b.total_hanging_weight) || 0;
    if (Math.abs(newTotal - oldTotal) < 0.01) continue; // no change needed
    plans.push({id: b.id, name: b.name, oldTotal, newTotal});
  }
  plans.forEach((p) =>
    console.log(`  ${p.name.padEnd(22)} ${p.oldTotal} \u2192 ${Math.round(p.newTotal * 10) / 10} lb`),
  );
  console.log(`\nBatches to update: ${plans.length}`);

  if (!process.argv.includes('--commit')) {
    console.log('\n(Preview only. Rerun with --commit to apply.)');
    return;
  }

  for (const p of plans) {
    const res = await fetch(`${URL}/rest/v1/cattle_processing_batches?id=eq.${encodeURIComponent(p.id)}`, {
      method: 'PATCH',
      headers: {...H, Prefer: 'return=minimal'},
      body: JSON.stringify({total_hanging_weight: Math.round(p.newTotal * 100) / 100}),
    });
    if (!res.ok) throw new Error(`${p.id}: ${res.status} ${await res.text()}`);
    console.log(`  \u2713 ${p.name}`);
  }
  console.log('\n\u2713 Done.');
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
