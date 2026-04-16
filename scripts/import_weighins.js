// scripts/import_weighins.js
//
// Phase 2 of cattle data migration: Podio weigh-ins → weigh_in_sessions + weigh_ins.
// One session per weigh-in date (herd=null, team_member='Import'),
// one weigh_ins row per xlsx row (tag = historical Tag #, weight, date).
//
// Usage:
//   node scripts/import_weighins.js              # preview only, writes nothing
//   node scripts/import_weighins.js --commit     # applies to Supabase
//
// Idempotent: deterministic IDs + upsert-on-conflict, safe to rerun.

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const XLSX = require('xlsx');

const WEIGHINS_XLSX = 'c:/Users/Ronni/OneDrive/Desktop/Cattle upload from Podio/Weigh Ins - All Weigh Ins.xlsx';

function loadEnv() {
  const p = path.join(__dirname, '.env');
  if (!fs.existsSync(p)) return;
  for (const line of fs.readFileSync(p, 'utf8').split(/\r?\n/)) {
    const m = /^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*?)\s*$/.exec(line);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
}

const shortHash = s => crypto.createHash('sha1').update(s).digest('hex').slice(0, 12);

function xlsxDate(v) {
  if (v instanceof Date && !isNaN(v.getTime())) {
    const y = v.getFullYear(), m = String(v.getMonth()+1).padStart(2,'0'), d = String(v.getDate()).padStart(2,'0');
    return `${y}-${m}-${d}`;
  }
  return null;
}

function parseRows() {
  const wb = XLSX.readFile(WEIGHINS_XLSX, { cellDates: true });
  const rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { defval: null });
  const out = [];
  const skipped = { blankTag: 0, blankDate: 0, blankWeight: 0 };
  for (const r of rows) {
    const tag = String(r['Tag #'] ?? '').trim();
    const dateISO = xlsxDate(r['Date']);
    const weight = Number(r['Weight']);
    if (!tag) { skipped.blankTag++; continue; }
    if (!dateISO) { skipped.blankDate++; continue; }
    if (!Number.isFinite(weight) || weight <= 0) { skipped.blankWeight++; continue; }
    out.push({ tag, dateISO, weight, createdBy: r['Created by'] || null });
  }
  return { rows: out, skipped, totalRaw: rows.length };
}

function buildPlan({ rows }) {
  // Sessions: one per date
  const sessionsByDate = new Map();
  for (const r of rows) {
    if (!sessionsByDate.has(r.dateISO)) {
      sessionsByDate.set(r.dateISO, {
        id: 'wsess-imp-' + r.dateISO,
        date: r.dateISO,
        team_member: 'Import',
        species: 'cattle',
        herd: null,
        status: 'complete',
        notes: 'Imported from Podio',
      });
    }
  }
  const sessions = [...sessionsByDate.values()].sort((a,b) => a.date.localeCompare(b.date));

  // Weigh-in rows: one per xlsx row, deterministic id = hash(date|tag|weight|ordinalIfDupe)
  // We count dupes per (date,tag,weight) so two identical rows on the same day both keep IDs.
  const seen = new Map();
  const weighIns = rows.map(r => {
    const base = `${r.dateISO}|${r.tag}|${r.weight}`;
    const n = (seen.get(base) || 0) + 1;
    seen.set(base, n);
    return {
      id: 'win-pimp-' + shortHash(base + '|' + n),
      session_id: 'wsess-imp-' + r.dateISO,
      tag: r.tag,
      weight: r.weight,
      note: null,
      new_tag_flag: false,
      entered_at: new Date(r.dateISO + 'T12:00:00Z').toISOString(),
    };
  });

  return { sessions, weighIns };
}

function printPreview({ totalRaw, skipped, sessions, weighIns }) {
  console.log('===== WEIGH-IN IMPORT PREVIEW =====\n');
  console.log(`Source rows: ${totalRaw}`);
  console.log(`Skipped: blank_tag=${skipped.blankTag}  blank_date=${skipped.blankDate}  blank_weight=${skipped.blankWeight}`);
  console.log(`\nSessions to create: ${sessions.length} (one per unique date)`);
  console.log(`Weigh-in rows to insert: ${weighIns.length}`);
  const dateRange = sessions.length ? `${sessions[0].date} \u2192 ${sessions[sessions.length-1].date}` : '\u2014';
  console.log(`Date range: ${dateRange}`);
  // Sample: largest sessions
  const count = {};
  weighIns.forEach(w => count[w.session_id] = (count[w.session_id]||0) + 1);
  const top = Object.entries(count).sort((a,b) => b[1]-a[1]).slice(0, 8);
  console.log('\nBusiest sessions:');
  top.forEach(([sid, n]) => console.log(`  ${sid.replace('wsess-imp-','')}  ${n} weigh-ins`));
  console.log('\n(Nothing written. Rerun with --commit to apply.)');
}

async function commit({ sessions, weighIns }) {
  loadEnv();
  const URL = process.env.SUPABASE_URL;
  const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!URL || !KEY) { console.error('Missing SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY.'); process.exit(1); }

  async function bulkInsert(table, rows) {
    if (!rows.length) return;
    for (let i = 0; i < rows.length; i += 500) {
      const chunk = rows.slice(i, i + 500);
      const res = await fetch(`${URL}/rest/v1/${table}?on_conflict=id`, {
        method: 'POST',
        headers: {
          apikey: KEY, Authorization: `Bearer ${KEY}`,
          'Content-Type': 'application/json',
          Prefer: 'resolution=merge-duplicates,return=minimal',
        },
        body: JSON.stringify(chunk),
      });
      if (!res.ok) throw new Error(`${table} insert failed: HTTP ${res.status} \u2014 ${await res.text()}`);
      console.log(`  ${table}: +${chunk.length}`);
    }
  }

  console.log('\n===== COMMIT =====');
  await bulkInsert('weigh_in_sessions', sessions);
  await bulkInsert('weigh_ins', weighIns);
  console.log('\n\u2713 Weigh-in import complete.');
}

(async () => {
  const parsed = parseRows();
  const plan = buildPlan(parsed);
  printPreview({ totalRaw: parsed.totalRaw, skipped: parsed.skipped, ...plan });
  if (process.argv.includes('--commit')) await commit(plan);
})().catch(e => { console.error(e); process.exit(1); });
