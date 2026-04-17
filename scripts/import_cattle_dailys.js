// scripts/import_cattle_dailys.js
//
// Phase 3 of cattle data migration: Podio "Cattle Daily's" -> cattle_dailys.
// Also seeds cattle_feed_inputs for the 10 hay types + 2 pellets if missing.
//
// Usage:
//   node scripts/import_cattle_dailys.js              # preview, writes nothing
//   node scripts/import_cattle_dailys.js --commit     # applies to Supabase
//
// Idempotent: deterministic IDs + upsert on conflict, safe to rerun.
//
// What gets imported per row:
//   date, team_member, herd, fence_voltage, water_checked, issues (None -> null),
//   feeds jsonb (one entry per populated hay slot + pellets), source='podio_import'
// What gets skipped:
//   rows with no Date, rows in OTHER cattle group, strict duplicates (keep one)
//   DM Needed / Protein % / NFC % / Waste % / cost aggregates (app recomputes)
//   mortality_count stays 0 -- narrative preserved in issues

const fs = require('fs'); const path = require('path'); const crypto = require('crypto');
const XLSX = require('xlsx');

const XLSX_PATH = "c:/Users/Ronni/OneDrive/Desktop/Cattle upload from Podio/Cattle Daily's - All Cattle Daily's.xlsx";

function loadEnv() {
  const p = path.join(__dirname, '.env');
  if (!fs.existsSync(p)) return;
  for (const line of fs.readFileSync(p, 'utf8').split(/\r?\n/)) {
    const m = /^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*?)\s*$/.exec(line);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
}
const shortHash = s => crypto.createHash('sha1').update(s).digest('hex').slice(0, 12);

const HERD_MAP = { BULLS:'bulls', FINISHERS:'finishers', MOMMAS:'mommas' };
// OTHER is deliberately dropped (Ronnie's call; 4 rows, edge cases)

function isoDate(v) {
  if (!(v instanceof Date) || isNaN(v.getTime())) return null;
  return v.getFullYear() + '-' + String(v.getMonth()+1).padStart(2,'0') + '-' + String(v.getDate()).padStart(2,'0');
}
function num(v) {
  if (v == null || v === '') return 0;
  const s = String(v).replace(/[$,]/g,'').trim();
  const n = parseFloat(s);
  return Number.isFinite(n) ? n : 0;
}
function str(v) {
  if (v == null) return null;
  const s = String(v).trim();
  return s === '' ? null : s;
}

// ---------- Build the feed-inputs seed list from the xlsx ----------
function analyseFeedInputs(rows) {
  // hay: label -> { sumDM, sumProtein, sumNFC, sumBales, samples }
  const hay = new Map();
  for (const r of rows) {
    for (const i of [1,2,3]) {
      const label = str(r[`Hay Type #${i}`]);
      if (!label) continue;
      const dm = num(r[`DM - Hay Type #${i}`] || r[`DM - Hay Type #${i} `]);
      if (dm <= 0) continue;
      const p = num(r[`Lbs Protein Hay Type #${i}`]);
      const n = num(r[`Lbs NFC Hay Type #${i}`]);
      const bales = num(r[`Bales of Hay Type #${i}`] || r[`Bales of Hay Type #${i} `]);
      const s = hay.get(label) || { sumDM:0, sumProtein:0, sumNFC:0, sumBales:0, samples:0 };
      s.sumDM += dm; s.sumProtein += p; s.sumNFC += n; s.sumBales += bales; s.samples++;
      hay.set(label, s);
    }
  }
  const hayInputs = [...hay.entries()].map(([label, s]) => ({
    id: 'feed-' + shortHash('hay|'+label),
    name: label,
    category: 'hay',
    unit: 'bale',
    unit_weight_lbs: s.sumBales > 0 ? Math.round(s.sumDM / s.sumBales) : null,  // DM per bale (approx; moisture not known)
    protein_pct: s.sumDM > 0 ? Math.round(s.sumProtein / s.sumDM * 1000)/10 : null,
    nfc_pct: s.sumDM > 0 ? Math.round(s.sumNFC / s.sumDM * 1000)/10 : null,
    moisture_pct: null,   // Ronnie fills in admin
    cost_per_unit: null,  // Ronnie fills in admin
    herd_scope: [],
    status: 'active',
  }));

  // pellets: compute from per-row Lbs Protein / Lbs of X ratios
  const pellets = { citrus: { sumQty:0, sumP:0, sumN:0 }, alfalfa: { sumQty:0, sumP:0, sumN:0 } };
  for (const r of rows) {
    const c = num(r['Lbs of Citrus Pellets']);
    if (c > 0) { pellets.citrus.sumQty += c; pellets.citrus.sumP += num(r['Lbs Protein - Citrus Pellets']); pellets.citrus.sumN += num(r['Lbs NFC - Citrus Pellets']); }
    const a = num(r['Lbs of Alfalfa Pellets']);
    if (a > 0) { pellets.alfalfa.sumQty += a; pellets.alfalfa.sumP += num(r['Lbs Protein - Alfalfa Pellets']); pellets.alfalfa.sumN += num(r['Lbs NFC - Alfalfa Pellets']); }
  }
  const pelletInputs = [];
  if (pellets.citrus.sumQty > 0) pelletInputs.push({
    id: 'feed-' + shortHash('pellet|CITRUS PELLETS'),
    name: 'CITRUS PELLETS', category:'pellet', unit:'lb', unit_weight_lbs: 1,
    protein_pct: Math.round(pellets.citrus.sumP / pellets.citrus.sumQty * 1000)/10,
    nfc_pct: Math.round(pellets.citrus.sumN / pellets.citrus.sumQty * 1000)/10,
    moisture_pct: null, cost_per_unit: null, herd_scope: [], status: 'active',
  });
  if (pellets.alfalfa.sumQty > 0) pelletInputs.push({
    id: 'feed-' + shortHash('pellet|ALFALFA PELLETS'),
    name: 'ALFALFA PELLETS', category:'pellet', unit:'lb', unit_weight_lbs: 1,
    protein_pct: Math.round(pellets.alfalfa.sumP / pellets.alfalfa.sumQty * 1000)/10,
    nfc_pct: Math.round(pellets.alfalfa.sumN / pellets.alfalfa.sumQty * 1000)/10,
    moisture_pct: null, cost_per_unit: null, herd_scope: [], status: 'active',
  });
  return [...hayInputs, ...pelletInputs];
}

// ---------- Build a single row's feeds jsonb ----------
function buildFeedsJsonb(r, feedIdMap) {
  const out = [];
  for (const i of [1,2,3]) {
    const label = str(r[`Hay Type #${i}`]);
    if (!label) continue;
    const bales = num(r[`Bales of Hay Type #${i}`] || r[`Bales of Hay Type #${i} `]);
    const dm = num(r[`DM - Hay Type #${i}`] || r[`DM - Hay Type #${i} `]);
    if (bales <= 0 && dm <= 0) continue;
    const p = num(r[`Lbs Protein Hay Type #${i}`]);
    const n = num(r[`Lbs NFC Hay Type #${i}`]);
    out.push({
      feed_input_id: feedIdMap['hay|'+label],
      feed_name: label,
      category: 'hay',
      qty: bales,
      unit: 'bale',
      lbs_as_fed: dm,  // DM approximation; moisture unknown for historical
      is_creep: false,
      nutrition_snapshot: {
        moisture_pct: null,
        protein_pct: dm > 0 ? Math.round(p/dm * 1000)/10 : null,
        nfc_pct: dm > 0 ? Math.round(n/dm * 1000)/10 : null,
      },
    });
  }
  const citrus = num(r['Lbs of Citrus Pellets']);
  if (citrus > 0) {
    const p = num(r['Lbs Protein - Citrus Pellets']);
    const n = num(r['Lbs NFC - Citrus Pellets']);
    out.push({
      feed_input_id: feedIdMap['pellet|CITRUS PELLETS'],
      feed_name: 'CITRUS PELLETS', category: 'pellet',
      qty: citrus, unit: 'lb', lbs_as_fed: citrus, is_creep: false,
      nutrition_snapshot: {
        moisture_pct: null,
        protein_pct: citrus > 0 ? Math.round(p/citrus * 1000)/10 : null,
        nfc_pct: citrus > 0 ? Math.round(n/citrus * 1000)/10 : null,
      },
    });
  }
  const alfalfa = num(r['Lbs of Alfalfa Pellets']);
  if (alfalfa > 0) {
    const p = num(r['Lbs Protein - Alfalfa Pellets']);
    const n = num(r['Lbs NFC - Alfalfa Pellets']);
    out.push({
      feed_input_id: feedIdMap['pellet|ALFALFA PELLETS'],
      feed_name: 'ALFALFA PELLETS', category: 'pellet',
      qty: alfalfa, unit: 'lb', lbs_as_fed: alfalfa, is_creep: false,
      nutrition_snapshot: {
        moisture_pct: null,
        protein_pct: alfalfa > 0 ? Math.round(p/alfalfa * 1000)/10 : null,
        nfc_pct: alfalfa > 0 ? Math.round(n/alfalfa * 1000)/10 : null,
      },
    });
  }
  return out;
}

// ---------- Parse + build plan ----------
function buildPlan() {
  const wb = XLSX.readFile(XLSX_PATH, { cellDates: true });
  const raw = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { defval: null });

  const feedInputs = analyseFeedInputs(raw);
  const feedIdMap = {};
  feedInputs.forEach(f => { feedIdMap[f.category+'|'+f.name] = f.id; });

  const skipped = { blankDate:0, other:0, dupes:0 };
  const dupeKeys = new Set();
  const dailys = [];
  // Sort so we keep the first occurrence of a strict duplicate deterministically
  for (const r of raw) {
    const d = isoDate(r['Date']);
    if (!d) { skipped.blankDate++; continue; }
    const rawHerd = str(r['Cattle Group']);
    const herd = HERD_MAP[rawHerd];
    if (!herd) { skipped.other++; continue; }
    const team = str(r['Team member']);
    const issuesRaw = str(r['Issues / Mortalities / Comments']);
    const issues = (!issuesRaw || issuesRaw.toLowerCase() === 'none') ? null : issuesRaw;
    const feeds = buildFeedsJsonb(r, feedIdMap);
    const voltage = num(r['Fence Voltage - KV']) || null;
    const water = str(r['Waterers checked?']);
    const water_checked = water == null ? null : (water.toUpperCase() === 'YES');

    // Strict dedup key (all material fields)
    const sKey = [d, team, herd, issues||'', voltage||'', water_checked, num(r['DM Given  ']), num(r['Hay & Pellets cost']||0), JSON.stringify(feeds)].join('|');
    if (dupeKeys.has(sKey)) { skipped.dupes++; continue; }
    dupeKeys.add(sKey);

    // Stable id (same basis as dupe key minus feeds hash size)
    const id = 'cd-imp-' + shortHash(sKey);
    dailys.push({
      id,
      submitted_at: new Date(d + 'T12:00:00Z').toISOString(),
      date: d,
      team_member: team,
      herd,
      feeds,
      minerals: [],
      fence_voltage: voltage,
      water_checked,
      mortality_count: 0,
      mortality_reason: null,
      issues,
      source: 'podio_import',
    });
  }
  return { feedInputs, dailys, skipped, totalRaw: raw.length };
}

function printPreview(plan) {
  console.log('===== CATTLE DAILYS IMPORT PREVIEW =====\n');
  console.log(`Source rows: ${plan.totalRaw}`);
  console.log(`Skipped: blank_date=${plan.skipped.blankDate}  other_group=${plan.skipped.other}  strict_dupes=${plan.skipped.dupes}`);
  console.log(`\nDailys to insert: ${plan.dailys.length}`);
  const byHerd = {};
  plan.dailys.forEach(d => byHerd[d.herd] = (byHerd[d.herd]||0) + 1);
  Object.entries(byHerd).sort().forEach(([h,n]) => console.log(`  ${h.padEnd(12)} ${n}`));

  console.log(`\nFeed inputs to upsert: ${plan.feedInputs.length}`);
  plan.feedInputs.forEach(f => {
    console.log(`  ${f.category.padEnd(7)} ${f.name.padEnd(28)} P=${f.protein_pct}%  NFC=${f.nfc_pct}%  unit=${f.unit}  unit_wt=${f.unit_weight_lbs}`);
  });

  const sample = plan.dailys[0];
  if (sample) {
    console.log('\nSample daily row:');
    console.log(`  ${sample.date} ${sample.team_member} ${sample.herd} voltage=${sample.fence_voltage} water=${sample.water_checked} issues="${sample.issues}"`);
    console.log(`  feeds: ${sample.feeds.length} entries`);
    sample.feeds.forEach(f => console.log(`    ${f.qty} ${f.unit} ${f.feed_name} (${f.category})  DM/asfed=${f.lbs_as_fed}  P=${f.nutrition_snapshot.protein_pct}%  NFC=${f.nutrition_snapshot.nfc_pct}%`));
  }
  console.log('\n(Nothing written. Rerun with --commit to apply.)');
}

async function commit(plan) {
  loadEnv();
  const URL = process.env.SUPABASE_URL, KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!URL || !KEY) { console.error('Missing SUPABASE env.'); process.exit(1); }
  const H = { apikey:KEY, Authorization:`Bearer ${KEY}`, 'Content-Type':'application/json' };

  async function upsert(table, rows, onConflict) {
    if (!rows.length) return;
    for (let i = 0; i < rows.length; i += 500) {
      const chunk = rows.slice(i, i + 500);
      const res = await fetch(`${URL}/rest/v1/${table}?on_conflict=${onConflict}`, {
        method:'POST', headers:{...H, Prefer:'resolution=merge-duplicates,return=minimal'},
        body: JSON.stringify(chunk),
      });
      if (!res.ok) throw new Error(`${table}: ${res.status} ${await res.text()}`);
      console.log(`  ${table}: +${chunk.length}`);
    }
  }

  // Feed inputs: only insert if name doesn't already exist. Otherwise we'd
  // clobber Ronnie's later-edited cost/moisture values on rerun.
  console.log('\n===== COMMIT =====');
  const existing = await fetch(`${URL}/rest/v1/cattle_feed_inputs?select=name`, { headers:H }).then(r=>r.json());
  const existingNames = new Set(existing.map(e => e.name));
  const newFeeds = plan.feedInputs.filter(f => !existingNames.has(f.name));
  const skippedFeeds = plan.feedInputs.length - newFeeds.length;
  console.log(`feed_inputs: ${newFeeds.length} new, ${skippedFeeds} already exist (leaving those untouched)`);
  await upsert('cattle_feed_inputs', newFeeds, 'id');

  await upsert('cattle_dailys', plan.dailys, 'id');
  console.log('\n\u2713 Import complete.');
}

(async () => {
  const plan = buildPlan();
  printPreview(plan);
  if (process.argv.includes('--commit')) await commit(plan);
})().catch(e => { console.error(e); process.exit(1); });
