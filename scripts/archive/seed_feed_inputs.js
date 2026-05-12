// scripts/seed_feed_inputs.js
//
// One-time update: populate the 12 cattle_feed_inputs rows (seeded by
// import_cattle_dailys.js) with Ronnie-supplied Bale Weight, Moisture,
// Protein, and NFC values.
//
// Ronnie gave DM-per-bale + moisture, so we back-calculate as-fed bale
// weight (what the form expects) from:
//   bale_weight_as_fed = DM_per_bale / (1 - moisture / 100)
//
// Usage:
//   node scripts/seed_feed_inputs.js           # preview only
//   node scripts/seed_feed_inputs.js --commit  # apply PATCH to Supabase
//
// Does NOT touch cost_per_unit / freight_per_truck / units_per_truck.

const fs = require('fs');
const path = require('path');
for (const l of fs.readFileSync(path.join(__dirname, '.env'), 'utf8').split(/\r?\n/)) {
  const m = /^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*?)\s*$/.exec(l);
  if (m) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
}
const URL = process.env.SUPABASE_URL;
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const H = {apikey: KEY, Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json'};

// Feed specs from Ronnie. For hays: DM-per-bale, moisture %, protein %, NFC %.
// For pellets: unit is lb so bale_weight doesn't apply; we set unit_weight_lbs=1
// (each lb = 1 lb as-fed).
const HAY_SPECS = [
  {name: 'UTILITY', dm: 900, moisture: 13.2, protein: 8.0, nfc: 10.0},
  {name: 'CLOVER', dm: 717, moisture: 13.74, protein: 13.0, nfc: 27.5},
  {name: 'ALFALFA', dm: 1000, moisture: 9.5, protein: 23.0, nfc: 22.0},
  {name: 'PEANUT BALEAGE', dm: 450, moisture: 38.29, protein: 14.69, nfc: 20.0},
  {name: '1000# ALFALFA ROUND BALES', dm: 891, moisture: 15.96, protein: 22.5, nfc: 22.1},
  {name: 'BERMUDA', dm: 585, moisture: 9.0, protein: 10.0, nfc: 10.0},
  {name: 'SORGHUM BALEAGE', dm: 400, moisture: 53.2, protein: 7.2, nfc: 9.6},
  {name: 'DRY RYE', dm: 591.5, moisture: 9.0, protein: 10.6, nfc: 12.9},
  {name: 'RYE BALEAGE', dm: 717.75, moisture: 50.5, protein: 16.6, nfc: 17.7},
  {name: 'CRABGRASS', dm: 769.5, moisture: 47.5, protein: 15.0, nfc: 8.0},
];
const PELLET_SPECS = [
  {name: 'CITRUS PELLETS', moisture: 7.7, protein: 6.7, nfc: 58.6},
  {name: 'ALFALFA PELLETS', moisture: 6.0, protein: 22.0, nfc: 22.5},
];

function backCalcBaleWeight(dm, moisturePct) {
  // bale_weight = DM / (1 - moisture/100)
  const bw = dm / (1 - moisturePct / 100);
  return Math.round(bw * 100) / 100; // 2 decimal places
}

async function fetchCurrent() {
  const res = await fetch(
    `${URL}/rest/v1/cattle_feed_inputs?select=id,name,unit,unit_weight_lbs,moisture_pct,protein_pct,nfc_pct`,
    {headers: H},
  );
  if (!res.ok) throw new Error(`GET failed: ${res.status} ${await res.text()}`);
  return await res.json();
}

async function patchRow(id, body) {
  const res = await fetch(`${URL}/rest/v1/cattle_feed_inputs?id=eq.${encodeURIComponent(id)}`, {
    method: 'PATCH',
    headers: {...H, Prefer: 'return=minimal'},
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`PATCH ${id}: ${res.status} ${await res.text()}`);
}

(async () => {
  const existing = await fetchCurrent();
  const byName = new Map(existing.map((f) => [f.name, f]));

  const patches = [];
  for (const h of HAY_SPECS) {
    const found = byName.get(h.name);
    if (!found) {
      console.warn(`  (!) ${h.name} not in DB — skipped`);
      continue;
    }
    const bw = backCalcBaleWeight(h.dm, h.moisture);
    const dmComputed = Math.round(bw * (1 - h.moisture / 100) * 10) / 10;
    patches.push({
      id: found.id,
      name: h.name,
      unit: 'bale',
      set: {
        unit_weight_lbs: bw,
        moisture_pct: h.moisture,
        protein_pct: h.protein,
        nfc_pct: h.nfc,
      },
      preview: `bale=${bw} lb · moist=${h.moisture}% · P=${h.protein}% · NFC=${h.nfc}%  (DM check: ${dmComputed} \u2248 given ${h.dm})`,
    });
  }
  for (const p of PELLET_SPECS) {
    const found = byName.get(p.name);
    if (!found) {
      console.warn(`  (!) ${p.name} not in DB — skipped`);
      continue;
    }
    patches.push({
      id: found.id,
      name: p.name,
      unit: 'lb',
      set: {
        unit_weight_lbs: 1,
        moisture_pct: p.moisture,
        protein_pct: p.protein,
        nfc_pct: p.nfc,
      },
      preview: `unit=1 lb · moist=${p.moisture}% · P=${p.protein}% · NFC=${p.nfc}%`,
    });
  }

  console.log('===== SEED FEED INPUTS PREVIEW =====\n');
  for (const p of patches) {
    const cur = existing.find((e) => e.id === p.id);
    console.log(`  ${p.name.padEnd(28)}`);
    console.log(
      `    current: bale=${cur.unit_weight_lbs} · moist=${cur.moisture_pct} · P=${cur.protein_pct}% · NFC=${cur.nfc_pct}%`,
    );
    console.log(`    new    : ${p.preview}`);
  }
  console.log(`\nRows to patch: ${patches.length}`);

  if (!process.argv.includes('--commit')) {
    console.log('\n(Preview only. Rerun with --commit to apply.)');
    return;
  }
  console.log('\n===== COMMIT =====');
  for (const p of patches) {
    await patchRow(p.id, p.set);
    console.log(`  \u2713 ${p.name}`);
  }
  console.log('\n\u2713 Done.');
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
