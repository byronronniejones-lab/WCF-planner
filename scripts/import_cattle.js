// scripts/import_cattle.js
//
// Phase 1 of cattle data migration: Cattle Tracker (xlsx) + comments (CSV).
// Weigh-ins and dailys are separate phases.
//
// Usage:
//   node scripts/import_cattle.js              # preview only, writes nothing
//   node scripts/import_cattle.js --commit     # applies to Supabase
//
// Requires scripts/.env with:
//   SUPABASE_URL=https://pzfujbjtayhkdlxiblwe.supabase.co
//   SUPABASE_SERVICE_ROLE_KEY=<from Supabase dashboard ▸ Project Settings ▸ API>
//
// Idempotent: all inserts use deterministic IDs and upsert on conflict,
// so reruns (e.g. after a partial failure) are safe.

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const XLSX = require('xlsx');

const CATTLE_XLSX  = 'c:/Users/Ronni/OneDrive/Desktop/Cattle upload from Podio/Cattle Tracker - All Cattle Tracker.xlsx';
const COMMENTS_CSV = 'c:/Users/Ronni/OneDrive/Desktop/podio_comments_29337625_2026-04-16.csv';

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
const STATUS_TO_HERD = {
  'FINISHING HERD':'finishers','MOMMA HERD':'mommas','BULLS':'bulls',
  'DECEASED':'deceased','PROCESSED':'processed','SOLD':'sold',
};
const SEX_MAP = { COW:'cow', HEIFER:'heifer', STEER:'steer', BULL:'bull' };
const OUTCOME_HERDS = new Set(['processed','deceased','sold']);

// ───── helpers ───────────────────────────────────────────────────────────────
const shortHash = s => crypto.createHash('sha1').update(s).digest('hex').slice(0, 12);
const normStr = v => { if (v == null) return null; const s = String(v).trim(); return s === '' ? null : s; };
const normNum = v => { if (v == null || v === '') return null; const n = Number(v); return Number.isFinite(n) ? n : null; };
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
function commentDate(s) {
  const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})\s+(\d{1,2}):(\d{2})/.exec(s || '');
  if (!m) return null;
  return new Date(Date.UTC(+m[3], +m[1]-1, +m[2], +m[4], +m[5])).toISOString();
}
function parseCsv(text) {
  const rows = []; let row = [], field = '', inQ = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQ) {
      if (c === '"' && text[i+1] === '"') { field += '"'; i++; }
      else if (c === '"') inQ = false;
      else field += c;
    } else {
      if (c === '"') inQ = true;
      else if (c === ',') { row.push(field); field = ''; }
      else if (c === '\r') {}
      else if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; }
      else field += c;
    }
  }
  if (field.length || row.length) { row.push(field); rows.push(row); }
  return rows;
}

// ───── parse inputs ──────────────────────────────────────────────────────────
function parseCattle() {
  const wb = XLSX.readFile(CATTLE_XLSX, { cellDates: true });
  const rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { defval: null });
  return rows
    .filter(r => normStr(r['Tag #']))
    .map(r => ({
      tag:               normStr(r['Tag #']),
      purchase_tag_id:   normStr(r['Purchase Tag ID']),
      sex:               SEX_MAP[String(r['Sex'] || '').trim().toUpperCase()] || null,
      status_raw:        normStr(r['Status']),
      breed:             normStr(r['Breed']),
      blacklist:         String(r['Breeding Blacklist'] || '').trim().toUpperCase() === 'BAD MOMMA',
      pct_wagyu:         normNum(r['% Wagyu']),
      origin:            normStr(r['Origin']),
      birth_date:        xlsxDate(r['Birth Date']),
      purchase_date:     xlsxDate(r['Purchase Date']),
      receiving_weight:  normNum(r['Receiving Weight']),
      purchase_amount:   normNum(r['Purchase Amount']),
      breeding_status:   normStr(r['Breeding Status']),
      sire_tag:          normStr(r['Sire']),
      dam_tag:           normStr(r['Dam']),
      hanging_weight:    normNum(r['Hanging Weight']),
      processing_date:   xlsxDate(r['Processing Date']),
      carcass_yield_pct: normNum(r['Carcass Yield %']),
    }));
}
function parseComments() {
  const csv = parseCsv(fs.readFileSync(COMMENTS_CSV, 'utf8'));
  const h = csv[0];
  const iTitle = h.indexOf('item_title'), iText = h.indexOf('comment_text'), iCr = h.indexOf('created_on');
  return csv.slice(1)
    .filter(r => r.length > 1 && normStr(r[iTitle]) && normStr(r[iText]))
    .map(r => ({ tag: normStr(r[iTitle]), comment: r[iText], created_at: commentDate(r[iCr]) }));
}

// ───── build plan ────────────────────────────────────────────────────────────
function buildPlan(cattleRows, commentRows) {
  const warnings = [];

  // Breeds: seed all distinct, mark inactive if no active-herd cow holds that breed
  const breedActivity = new Map();
  for (const r of cattleRows) {
    if (!r.breed) continue;
    const herd = STATUS_TO_HERD[r.status_raw];
    const activeCow = herd && !OUTCOME_HERDS.has(herd);
    const prev = breedActivity.get(r.breed) || { active: false };
    if (activeCow) prev.active = true;
    breedActivity.set(r.breed, prev);
  }
  const breeds = [...breedActivity.entries()].map(([label, a]) => ({
    id: 'breed-' + shortHash(label), label, active: a.active,
  }));

  // Origins: seed all distinct, all active=true
  const origins = [...new Set(cattleRows.map(r => r.origin).filter(Boolean))]
    .map(label => ({ id: 'origin-' + shortHash(label), label, active: true }));

  // Processing batches: group by processing_date; null-date cows with processing data → "Unknown Date"
  const batchByKey = new Map();
  for (const r of cattleRows) {
    const hasProc = r.hanging_weight != null || r.carcass_yield_pct != null || r.processing_date;
    if (!hasProc) continue;
    const key = r.processing_date || 'unknown-date';
    if (!batchByKey.has(key)) {
      batchByKey.set(key, {
        id: 'pbatch-' + shortHash(key),
        name: key === 'unknown-date' ? 'Unknown Date' : key,
        actual_process_date: r.processing_date || null,
        status: r.processing_date ? 'complete' : 'planned',
      });
    }
  }
  const batches = [...batchByKey.values()];

  // Cattle rows
  const cattle = [];
  for (const r of cattleRows) {
    const herd = STATUS_TO_HERD[r.status_raw];
    if (!herd) { warnings.push(`Tag ${r.tag}: unknown status "${r.status_raw}" → skipped`); continue; }
    const procKey = (r.hanging_weight != null || r.carcass_yield_pct != null || r.processing_date)
      ? (r.processing_date || 'unknown-date') : null;
    const old_tags = r.purchase_tag_id
      ? [{ tag: r.purchase_tag_id, changed_at: new Date().toISOString(), source: 'import' }]
      : [];
    const idBasis = [r.tag, r.status_raw, r.birth_date || '', r.purchase_date || '', r.sex || ''].join('|');
    const breeding_status = (r.sex === 'cow' || r.sex === 'heifer') ? r.breeding_status : null;
    let pct = r.pct_wagyu;
    if (pct != null) {
      if (pct > 0 && pct <= 1) pct = pct * 100;  // 0.5 → 50
      pct = Math.max(0, Math.min(100, Math.round(pct)));
    }
    cattle.push({
      id: 'cattle-' + shortHash(idBasis),
      tag: r.tag,
      herd,
      sex: r.sex,
      breed: r.breed,
      breeding_blacklist: r.blacklist,
      pct_wagyu: pct,
      origin: r.origin,
      birth_date: r.birth_date,
      purchase_date: r.purchase_date,
      purchase_amount: r.purchase_amount,
      dam_tag: r.dam_tag,
      sire_tag: r.sire_tag,
      breeding_status,
      hanging_weight: r.hanging_weight,
      carcass_yield_pct: r.carcass_yield_pct,
      processing_batch_id: procKey ? 'pbatch-' + shortHash(procKey) : null,
      old_tags,
      _receiving_weight: r.receiving_weight,   // stripped before insert; seeds weigh-in
    });
  }

  // Receiving-weight weigh-ins
  const today = new Date().toISOString().slice(0, 10);
  const weighSessions = [], weighIns = [];
  for (const c of cattle) {
    const rw = c._receiving_weight;
    if (rw == null || rw === 0) continue;
    const date = c.purchase_date || c.birth_date || today;
    const sessionId = 'wsess-rcv-' + c.id;
    weighSessions.push({
      id: sessionId, date, team_member: 'Import', species: 'cattle',
      herd: c.herd, status: 'complete', notes: 'Receiving weight (imported)',
    });
    weighIns.push({
      id: 'win-rcv-' + c.id, session_id: sessionId, tag: c.tag, weight: rw,
      note: 'Receiving weight (imported)',
    });
  }

  // Comment matching
  const tagToCows = new Map();
  for (const c of cattle) {
    if (!c.tag) continue;
    (tagToCows.get(c.tag) || tagToCows.set(c.tag, []).get(c.tag)).push(c);
  }
  const comments = [], orphans = [];
  for (const cmt of commentRows) {
    const list = tagToCows.get(cmt.tag);
    if (!list || list.length === 0) { orphans.push(cmt); continue; }
    // prefer active-herd cow when tag is duplicated across records
    const chosen = list.find(c => !OUTCOME_HERDS.has(c.herd)) || list[0];
    const basis = [chosen.id, cmt.created_at || '', cmt.comment].join('|');
    comments.push({
      id: 'cmt-imp-' + shortHash(basis),
      cattle_id: chosen.id,
      cattle_tag: cmt.tag,
      comment: cmt.comment,
      team_member: 'Import',
      source: 'import',
      created_at: cmt.created_at,
    });
  }

  // Dam/sire references that don't resolve
  const allTags = new Set([...tagToCows.keys()]);
  const unmatchedRefs = [];
  for (const c of cattle) {
    if (c.dam_tag && !allTags.has(c.dam_tag)) unmatchedRefs.push({ cow: c.tag, field: 'dam', refTag: c.dam_tag });
    if (c.sire_tag && !allTags.has(c.sire_tag)) unmatchedRefs.push({ cow: c.tag, field: 'sire', refTag: c.sire_tag });
  }

  return { breeds, origins, batches, cattle, weighSessions, weighIns, comments, orphans, unmatchedRefs, warnings };
}

// ───── preview ───────────────────────────────────────────────────────────────
function printPreview(plan) {
  const byHerd = {};
  for (const c of plan.cattle) byHerd[c.herd] = (byHerd[c.herd] || 0) + 1;

  console.log('===== IMPORT PREVIEW =====\n');
  console.log(`Cattle rows: ${plan.cattle.length}`);
  Object.entries(byHerd).sort().forEach(([h, n]) => console.log(`  ${h.padEnd(16)} ${n}`));
  console.log(`\nBreeds to seed: ${plan.breeds.length}`);
  plan.breeds.forEach(b => console.log(`  ${b.active ? '[active]   ' : '[inactive] '}${b.label}`));
  console.log(`\nOrigins to seed: ${plan.origins.length}`);
  plan.origins.forEach(o => console.log(`  ${o.label}`));
  console.log(`\nProcessing batches: ${plan.batches.length}`);
  plan.batches.slice(0, 12).forEach(b => console.log(`  ${b.status.padEnd(9)} ${b.name}`));
  if (plan.batches.length > 12) console.log(`  ... and ${plan.batches.length - 12} more`);
  console.log(`\nReceiving-weight weigh-ins: ${plan.weighIns.length}`);
  console.log(`Comments matched: ${plan.comments.length}  orphaned: ${plan.orphans.length}`);
  console.log(`Unresolved dam/sire refs: ${plan.unmatchedRefs.length}`);
  if (plan.unmatchedRefs.length) {
    plan.unmatchedRefs.slice(0, 15).forEach(u => console.log(`  cow ${u.cow} → ${u.field}=${u.refTag}`));
    if (plan.unmatchedRefs.length > 15) console.log(`  ... and ${plan.unmatchedRefs.length - 15} more`);
  }
  if (plan.warnings.length) {
    console.log(`\nWarnings: ${plan.warnings.length}`);
    plan.warnings.slice(0, 20).forEach(w => console.log(`  ${w}`));
  }
  console.log('\n(Nothing written. Rerun with --commit to apply.)');
}

// ───── commit ────────────────────────────────────────────────────────────────
async function commit(plan) {
  loadEnv();
  const URL = process.env.SUPABASE_URL;
  const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!URL || !KEY) {
    console.error('\nMissing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY.');
    console.error('Put them in scripts/.env (gitignored). Service role key is in Supabase ▸ Project Settings ▸ API.');
    process.exit(1);
  }

  async function bulkInsert(table, rows) {
    if (!rows.length) return;
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

  const cattleClean = plan.cattle.map(({ _receiving_weight, ...c }) => c);

  console.log('\n===== COMMIT =====');
  await bulkInsert('cattle_breeds', plan.breeds);
  await bulkInsert('cattle_origins', plan.origins);
  await bulkInsert('cattle_processing_batches', plan.batches);
  await bulkInsert('cattle', cattleClean);
  await bulkInsert('weigh_in_sessions', plan.weighSessions);
  await bulkInsert('weigh_ins', plan.weighIns);
  await bulkInsert('cattle_comments', plan.comments);
  console.log('\n\u2713 Import complete.');
}

// ───── main ──────────────────────────────────────────────────────────────────
(async () => {
  const plan = buildPlan(parseCattle(), parseComments());
  printPreview(plan);
  if (process.argv.includes('--commit')) await commit(plan);
})().catch(e => { console.error(e); process.exit(1); });
