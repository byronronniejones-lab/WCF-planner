// scripts/import_sheep.cjs
//
// Sheep data import: Podio Sheep Tracker xlsx + Sheep Daily's xlsx + 18 newly
// purchased lambs (Willie Nisewonger, $275 each, DOB 2026-01-01, KATAHDIN).
//
// Usage:
//   node scripts/import_sheep.cjs             # preview only, writes nothing
//   node scripts/import_sheep.cjs --commit    # applies to Supabase
//
// Requires scripts/.env with SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY.
//
// Idempotent: deterministic IDs + on-conflict-merge upsert. Safe to rerun.
//
// REQUIRES migration 010_sheep_weigh_in_species.sql applied first
// (extends weigh_in_sessions.species CHECK to allow 'sheep').

const fs = require('fs');
const path = require('path');
const XLSX = require('xlsx');

const TRACKER_XLSX = "c:/Users/Ronni/OneDrive/Desktop/Sheep Tracker - All Sheep Tracker.xlsx";
const DAILYS_XLSX  = "c:/Users/Ronni/OneDrive/Desktop/Sheep Daily's - ALL.xlsx";

// ───── env ───────────────────────────────────────────────────────────────────
function loadEnv() {
  const p = path.join(__dirname, '.env');
  if (!fs.existsSync(p)) return;
  for (const line of fs.readFileSync(p, 'utf8').split(/\r?\n/)) {
    const m = /^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*?)\s*$/.exec(line);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
}

// ───── mappings ──────────────────────────────────────────────────────────────
const SEX_MAP = { EWE: 'ewe', RAM: 'ram', WETHER: 'wether' };
const TRACKER_STATUS_TO_FLOCK = {
  'MAIN FLOCK': 'ewes',     // Q1 answer: all to ewes regardless of sex
  'PROCESSED':  'processed',
  'DECEASED':   'deceased',
  'SOLD':       'sold',
};
const DAILYS_GROUP_TO_FLOCK = {
  'MAIN FLOCK': 'ewes',     // Q2 answer
  'RAM FLOCK':  'rams',
  'OTHER':      'feeders',
};

// 18 new lambs — hardcoded per session decisions
const NEW_LAMBS_BREED = 'KATAHDIN';
const NEW_LAMBS_ORIGIN = 'WILLIE NISEWONGER';
const NEW_LAMBS_BIRTH = '2026-01-01';
const NEW_LAMBS_PURCHASE = '2026-04-01';
const NEW_LAMBS_AMOUNT = 275;
const NEW_RAM_COUNT = 8;
const NEW_EWE_COUNT = 10;

// ───── helpers ───────────────────────────────────────────────────────────────
const normStr = v => { if (v == null) return null; const s = String(v).trim(); return s === '' ? null : s; };
const normNum = v => {
  if (v == null || v === '') return null;
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  const cleaned = String(v).replace(/[$,\s]/g, '').replace(/[^0-9.\-]/g, '');
  if (!cleaned) return null;
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
};
function xlsxDate(v) {
  if (v == null || v === '') return null;
  if (v instanceof Date) {
    if (isNaN(v.getTime())) return null;
    const y = v.getFullYear(), m = String(v.getMonth()+1).padStart(2,'0'), d = String(v.getDate()).padStart(2,'0');
    return `${y}-${m}-${d}`;
  }
  if (typeof v === 'number') {
    const d = new Date(Math.round((v - 25569) * 86400 * 1000));
    return isNaN(d.getTime()) ? null : xlsxDate(d);
  }
  return null;
}

// Parse "M/D/YY - NN lbs" or "M/D/YY - NN" → { date: 'YYYY-MM-DD', weight: number }
function parseWeightHistoryEntry(s) {
  const m = /^\s*(\d{1,2})\/(\d{1,2})\/(\d{2,4})\s*-\s*([0-9]+(?:\.[0-9]+)?)\s*(?:lbs?)?\s*$/i.exec(s);
  if (!m) return null;
  let yy = +m[3];
  if (yy < 100) yy = 2000 + yy;  // "25" → 2025
  const mo = String(+m[1]).padStart(2, '0');
  const dy = String(+m[2]).padStart(2, '0');
  const w = Number(m[4]);
  if (!Number.isFinite(w)) return null;
  return { date: `${yy}-${mo}-${dy}`, weight: w };
}
function parseWeightHistory(raw) {
  if (!raw) return [];
  return String(raw)
    .split(/\r?\n+/)
    .map(s => s.trim())
    .filter(Boolean)
    .map(parseWeightHistoryEntry)
    .filter(Boolean);
}

// ───── parse inputs ──────────────────────────────────────────────────────────
function parseTracker() {
  const wb = XLSX.readFile(TRACKER_XLSX, { cellDates: true });
  const rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { defval: null });
  return rows
    .filter(r => normStr(r['Tag #']))
    .map(r => ({
      tag:              normStr(r['Tag #']),
      sex_raw:          normStr(r['Sex']),
      status_raw:       normStr(r['Status']),
      breed:            normStr(r['Breed']),
      origin:           normStr(r['Origin']),
      birth_date:       xlsxDate(r['Birth Date']),
      purchase_date:    xlsxDate(r['Purchase Date']),
      purchase_amount:  normNum(r['Purchase Amount - amount']),  // §15.5 split-column trap
      dam_tag:          normStr(r['Dam']),
      sire_tag:         normStr(r['Sire']),
      weight_history:   normStr(r['Weight History w/ Date']),
    }));
}
function parseDailys() {
  const wb = XLSX.readFile(DAILYS_XLSX, { cellDates: true });
  const rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { defval: null });
  return rows.map((r, idx) => ({
    _rowindex:           idx + 2,  // xlsx row number (1-based + header)
    date:                xlsxDate(r['Date']),
    team_member:         normStr(r['Team member']),
    group_raw:           normStr(r['Sheep Group']),
    bales_of_hay:        normNum(r['Bales of hay']),
    lbs_of_alfalfa:      normNum(r['Lbs of Alfalfa']),
    minerals_given_raw:  normStr(r['Minerals given?']),
    minerals_pct_eaten:  normNum(r['% of Minerals Eaten ']),
    fence_voltage_kv:    normNum(r['Fence Voltage in KV']),
    waterers_raw:        normStr(r['Waterers working?']),
    comments:            normStr(r['Issues / Mortalities / Comments']),
  }));
}

// ───── build plan ────────────────────────────────────────────────────────────
function buildPlan(trackerRows, dailysRows) {
  const warnings = [];

  // ── origins: just seed Willie Nisewonger (other 5 already in mig 009)
  const origins = [{
    id: 'origin-willie-nisewonger',
    label: NEW_LAMBS_ORIGIN,
    active: true,
  }];

  // ── sheep records (Step B: 67 Podio + Step C: 18 new lambs)
  const sheep = [];

  for (const r of trackerRows) {
    const sex = SEX_MAP[String(r.sex_raw || '').toUpperCase()] || null;
    const flock = TRACKER_STATUS_TO_FLOCK[r.status_raw] || 'ewes';
    if (!TRACKER_STATUS_TO_FLOCK[r.status_raw] && r.status_raw) {
      warnings.push(`Tag ${r.tag}: unknown status "${r.status_raw}" → flock=ewes (default)`);
    }
    if (!sex && r.sex_raw) {
      warnings.push(`Tag ${r.tag}: unknown sex "${r.sex_raw}" → null`);
    }
    sheep.push({
      id:               `sheep-podio-${r.tag}`,
      tag:              r.tag,
      sex,
      flock,
      breed:            r.breed,
      origin:           r.origin,
      birth_date:       r.birth_date,
      purchase_date:    r.purchase_date,
      purchase_amount:  r.purchase_amount,
      dam_tag:          r.dam_tag,
      sire_tag:         r.sire_tag,
      old_tags:         [],
    });
  }

  // 18 new lambs: 8 rams (RAM 001..RAM 008), 10 ewes (EWE 001..EWE 010)
  // Key set must match the Podio sheep objects above — include dam_tag/sire_tag=null.
  for (let i = 1; i <= NEW_RAM_COUNT; i++) {
    const tag = `RAM ${String(i).padStart(3, '0')}`;
    sheep.push({
      id:               `sheep-new-RAM-${String(i).padStart(3, '0')}`,
      tag,
      sex:              'ram',
      flock:            'ewes',
      breed:            NEW_LAMBS_BREED,
      origin:           NEW_LAMBS_ORIGIN,
      birth_date:       NEW_LAMBS_BIRTH,
      purchase_date:    NEW_LAMBS_PURCHASE,
      purchase_amount:  NEW_LAMBS_AMOUNT,
      dam_tag:          null,
      sire_tag:         null,
      old_tags:         [],
    });
  }
  for (let i = 1; i <= NEW_EWE_COUNT; i++) {
    const tag = `EWE ${String(i).padStart(3, '0')}`;
    sheep.push({
      id:               `sheep-new-EWE-${String(i).padStart(3, '0')}`,
      tag,
      sex:              'ewe',
      flock:            'ewes',
      breed:            NEW_LAMBS_BREED,
      origin:           NEW_LAMBS_ORIGIN,
      birth_date:       NEW_LAMBS_BIRTH,
      purchase_date:    NEW_LAMBS_PURCHASE,
      purchase_amount:  NEW_LAMBS_AMOUNT,
      dam_tag:          null,
      sire_tag:         null,
      old_tags:         [],
    });
  }

  // ── lambing records (Step D: synthesize from Dam + Birth Date on lamb rows)
  const lambing = [];
  const trackerByTag = new Map(trackerRows.map(r => [r.tag, r]));
  for (const r of trackerRows) {
    if (!r.dam_tag || !r.birth_date) continue;
    if (!trackerByTag.has(r.dam_tag)) {
      warnings.push(`Lamb ${r.tag}: dam tag "${r.dam_tag}" not found in tracker — lambing record still created`);
    }
    lambing.push({
      id:                 `lamb-${r.tag}`,
      dam_tag:            r.dam_tag,
      lambing_date:       r.birth_date,
      lamb_tag:           r.tag,
      lamb_id:            `sheep-podio-${r.tag}`,
      sire_tag:           null,
      total_born:         1,
      deaths:             0,
      complications_flag: false,
      notes:              'imported from sheep tracker (synthesized)',
    });
  }

  // ── historical weigh-ins (Step E: most-recent entry per sheep with parseable history)
  const weighSessions = [];
  const weighIns = [];
  const seenSession = new Set();
  let unparseableCount = 0;
  const unparseableSamples = [];

  for (const r of trackerRows) {
    if (!r.weight_history) continue;
    const entries = parseWeightHistory(r.weight_history);
    if (entries.length === 0) {
      unparseableCount++;
      if (unparseableSamples.length < 5) {
        unparseableSamples.push(`Tag ${r.tag}: ${String(r.weight_history).slice(0, 80)}`);
      }
      continue;
    }
    // pick the most recent entry by date
    entries.sort((a, b) => a.date.localeCompare(b.date));
    const latest = entries[entries.length - 1];

    const sessionId = `wsess-imp-sheep-${latest.date}`;
    if (!seenSession.has(sessionId)) {
      seenSession.add(sessionId);
      weighSessions.push({
        id:           sessionId,
        date:         latest.date,
        team_member:  'Import',
        species:      'sheep',
        herd:         null,  // historical — flock not recorded per-session in xlsx
        status:       'complete',
        started_at:   `${latest.date}T12:00:00Z`,
        completed_at: `${latest.date}T12:00:00Z`,
        notes:        'Podio import — historical weight (most recent entry)',
      });
    }
    weighIns.push({
      id:         `wi-imp-sheep-${r.tag}-${latest.date}`,
      session_id: sessionId,
      tag:        r.tag,
      weight:     latest.weight,
      note:       'Imported from Podio Weight History',
    });
  }

  // ── sheep_dailys (Step F)
  const dailys = [];
  const skippedDailys = [];
  const seenDailyId = new Map();  // for collision detection

  for (const r of dailysRows) {
    if (!r.date) {
      skippedDailys.push({ rowindex: r._rowindex, reason: 'null date', team: r.team_member, group: r.group_raw });
      continue;
    }
    const flock = DAILYS_GROUP_TO_FLOCK[r.group_raw];
    if (!flock) {
      skippedDailys.push({ rowindex: r._rowindex, reason: `unknown group "${r.group_raw}"`, team: r.team_member, date: r.date });
      continue;
    }
    const team = r.team_member || 'UNKNOWN';
    let id = `sdaily-podio-${r.date}-${team}`;
    let n = seenDailyId.get(id) || 0;
    seenDailyId.set(id, n + 1);
    if (n > 0) id = `${id}-${n}`;

    dailys.push({
      id,
      date:               r.date,
      team_member:        r.team_member,
      flock,
      bales_of_hay:       r.bales_of_hay,
      lbs_of_alfalfa:     r.lbs_of_alfalfa,
      minerals_given:     r.minerals_given_raw == null ? null : (r.minerals_given_raw.toUpperCase() === 'YES'),
      minerals_pct_eaten: r.minerals_pct_eaten,
      fence_voltage_kv:   r.fence_voltage_kv,
      waterers_working:   r.waterers_raw == null ? null : (r.waterers_raw.toUpperCase() === 'YES'),
      mortality_count:    0,
      comments:           r.comments,
      source:             'podio_import',
      submitted_at:       `${r.date}T12:00:00Z`,
    });
  }

  // ── unmatched dam refs (informational)
  const allTags = new Set(trackerRows.map(r => r.tag));
  // also include the new lambs' tags (but they have no dams in this import)
  const unmatchedRefs = [];
  for (const r of trackerRows) {
    if (r.dam_tag && !allTags.has(r.dam_tag)) unmatchedRefs.push({ lamb: r.tag, dam: r.dam_tag });
  }

  return {
    origins, sheep, lambing, weighSessions, weighIns, dailys,
    skippedDailys, unmatchedRefs, warnings,
    weightHistoryUnparseable: { count: unparseableCount, samples: unparseableSamples },
  };
}

// ───── preview ───────────────────────────────────────────────────────────────
function printPreview(plan) {
  const byFlock = {};
  for (const s of plan.sheep) byFlock[s.flock] = (byFlock[s.flock] || 0) + 1;

  console.log('===== SHEEP IMPORT PREVIEW =====\n');

  console.log(`Origins to seed: ${plan.origins.length}`);
  plan.origins.forEach(o => console.log(`  ${o.label}`));

  console.log(`\nSheep records: ${plan.sheep.length} (67 Podio + ${NEW_RAM_COUNT + NEW_EWE_COUNT} new lambs)`);
  Object.entries(byFlock).sort().forEach(([f, n]) => console.log(`  ${f.padEnd(12)} ${n}`));

  console.log(`\nNew lambs (sample of first + last):`);
  const newOnes = plan.sheep.filter(s => s.id.startsWith('sheep-new-'));
  newOnes.slice(0, 2).forEach(s => console.log(`  ${s.id.padEnd(28)} tag="${s.tag}" sex=${s.sex} flock=${s.flock}`));
  console.log(`  ...`);
  newOnes.slice(-2).forEach(s => console.log(`  ${s.id.padEnd(28)} tag="${s.tag}" sex=${s.sex} flock=${s.flock}`));

  console.log(`\nLambing records (synthesized): ${plan.lambing.length}`);
  plan.lambing.slice(0, 5).forEach(l => console.log(`  ${l.id.padEnd(14)} dam=${l.dam_tag} → lamb=${l.lamb_tag} (${l.lambing_date})`));
  if (plan.lambing.length > 5) console.log(`  ... and ${plan.lambing.length - 5} more`);

  console.log(`\nHistorical weigh-in sessions: ${plan.weighSessions.length} (one per unique date)`);
  plan.weighSessions.slice(0, 5).forEach(s => console.log(`  ${s.id} (${s.date})`));
  if (plan.weighSessions.length > 5) console.log(`  ... and ${plan.weighSessions.length - 5} more`);

  console.log(`\nHistorical weigh-ins: ${plan.weighIns.length}`);
  plan.weighIns.slice(0, 5).forEach(w => console.log(`  tag=${w.tag.padEnd(6)} weight=${w.weight} (session ${w.session_id})`));
  if (plan.weighIns.length > 5) console.log(`  ... and ${plan.weighIns.length - 5} more`);

  if (plan.weightHistoryUnparseable.count > 0) {
    console.log(`\nUnparseable Weight History entries: ${plan.weightHistoryUnparseable.count} sheep`);
    plan.weightHistoryUnparseable.samples.forEach(s => console.log(`  ${s}`));
  }

  console.log(`\nSheep dailys: ${plan.dailys.length}`);
  const byDailyFlock = {};
  for (const d of plan.dailys) byDailyFlock[d.flock] = (byDailyFlock[d.flock] || 0) + 1;
  Object.entries(byDailyFlock).sort().forEach(([f, n]) => console.log(`  ${f.padEnd(12)} ${n}`));

  if (plan.skippedDailys.length > 0) {
    console.log(`\nSkipped dailys rows: ${plan.skippedDailys.length}`);
    plan.skippedDailys.forEach(s => console.log(`  xlsx row ${s.rowindex}: ${s.reason} (team=${s.team || '-'}, date=${s.date || '-'}, group=${s.group || '-'})`));
  }

  if (plan.unmatchedRefs.length > 0) {
    console.log(`\nUnmatched dam references: ${plan.unmatchedRefs.length}`);
    plan.unmatchedRefs.slice(0, 10).forEach(u => console.log(`  lamb=${u.lamb} → dam=${u.dam} (not in tracker)`));
    if (plan.unmatchedRefs.length > 10) console.log(`  ... and ${plan.unmatchedRefs.length - 10} more`);
  }

  if (plan.warnings.length > 0) {
    console.log(`\nWarnings: ${plan.warnings.length}`);
    plan.warnings.slice(0, 20).forEach(w => console.log(`  ${w}`));
    if (plan.warnings.length > 20) console.log(`  ... and ${plan.warnings.length - 20} more`);
  }

  console.log('\n(Nothing written. Rerun with --commit to apply.)');
}

// ───── commit ────────────────────────────────────────────────────────────────
async function commit(plan) {
  loadEnv();
  const URL = process.env.SUPABASE_URL;
  const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!URL || !KEY) {
    console.error('\nMissing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in scripts/.env.');
    process.exit(1);
  }

  async function bulkInsert(table, rows) {
    if (!rows.length) { console.log(`  ${table}: (no rows)`); return; }
    for (let i = 0; i < rows.length; i += 500) {
      const chunk = rows.slice(i, i + 500);
      const res = await fetch(`${URL}/rest/v1/${table}?on_conflict=id`, {
        method: 'POST',
        headers: {
          apikey: KEY,
          Authorization: `Bearer ${KEY}`,
          'Content-Type': 'application/json',
          Prefer: 'resolution=merge-duplicates,return=minimal',
        },
        body: JSON.stringify(chunk),
      });
      if (!res.ok) {
        const body = await res.text();
        throw new Error(`${table} insert failed: HTTP ${res.status} — ${body}`);
      }
      console.log(`  ${table}: +${chunk.length}`);
    }
  }
  // sheep_origins uses (label) as conflict target, not (id), since id is auto-determined here
  async function bulkInsertOriginsByLabel(rows) {
    if (!rows.length) return;
    const res = await fetch(`${URL}/rest/v1/sheep_origins?on_conflict=label`, {
      method: 'POST',
      headers: {
        apikey: KEY,
        Authorization: `Bearer ${KEY}`,
        'Content-Type': 'application/json',
        Prefer: 'resolution=ignore-duplicates,return=minimal',
      },
      body: JSON.stringify(rows),
    });
    if (!res.ok) throw new Error(`sheep_origins insert failed: HTTP ${res.status} — ${await res.text()}`);
    console.log(`  sheep_origins: +${rows.length} (or skipped on label conflict)`);
  }

  console.log('\n===== COMMIT =====');
  await bulkInsertOriginsByLabel(plan.origins);
  await bulkInsert('sheep', plan.sheep);
  await bulkInsert('sheep_lambing_records', plan.lambing);
  await bulkInsert('weigh_in_sessions', plan.weighSessions);
  await bulkInsert('weigh_ins', plan.weighIns);
  await bulkInsert('sheep_dailys', plan.dailys);
  console.log('\n✓ Sheep import complete.');
}

// ───── main ──────────────────────────────────────────────────────────────────
(async () => {
  const plan = buildPlan(parseTracker(), parseDailys());
  printPreview(plan);
  if (process.argv.includes('--commit')) await commit(plan);
})().catch(e => { console.error(e); process.exit(1); });
