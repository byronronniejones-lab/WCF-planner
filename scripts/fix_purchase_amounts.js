// scripts/fix_purchase_amounts.js
//
// One-off fix: the original import_cattle.js used a number parser that
// couldn't handle Podio's currency-formatted strings ("$ 1,523.50"), so
// every row with a dollar-formatted Purchase Amount imported as null.
// 163 cows ended up with purchase_date but no purchase_amount.
//
// This script re-reads the cattle tracker xlsx, strips $ and commas,
// and PATCHes cattle.purchase_amount for every cow currently missing it.
//
// Matching strategy (in order):
//   1. cattle.tag === xlsx Tag#                  (primary — never-retagged cows)
//   2. cattle.old_tags[].tag where source = 'weigh_in'  (post-import retags)
//
// purchase_tag_id / source='import' old_tags are the SELLING-FARM tag and
// intentionally excluded — those don't identify WCF cows.
//
// Usage:
//   node scripts/fix_purchase_amounts.js           # preview
//   node scripts/fix_purchase_amounts.js --commit  # apply PATCH
//
// Only updates cows where purchase_amount IS NULL OR = 0, so safe to re-run
// and won't clobber amounts that were set manually or through a re-import.

const fs = require('fs'); const path = require('path');
for (const l of fs.readFileSync(path.join(__dirname,'.env'),'utf8').split(/\r?\n/)) {
  const m = /^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*?)\s*$/.exec(l);
  if (m) process.env[m[1]] = m[2].replace(/^["']|["']$/g,'');
}
const URL = process.env.SUPABASE_URL;
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!URL || !KEY) { console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in scripts/.env'); process.exit(1); }
const H = { apikey: KEY, Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' };

const XLSX = require('xlsx');
const XLSX_PATH = 'c:/Users/Ronni/OneDrive/Desktop/Cattle upload from Podio/Cattle Tracker - All Cattle Tracker.xlsx';

function parseAmount(v) {
  if (v == null || v === '') return null;
  if (typeof v === 'number') return Number.isFinite(v) && v > 0 ? v : null;
  // Strip $, commas, spaces, and any non-numeric characters except . and -
  const cleaned = String(v).replace(/[$,\s]/g, '').replace(/[^0-9.-]/g, '');
  if (!cleaned) return null;
  const n = Number(cleaned);
  return Number.isFinite(n) && n > 0 ? n : null;
}
function normStr(v) {
  if (v == null) return null;
  const s = String(v).trim();
  return s === '' ? null : s;
}

async function fetchAll(table, query) {
  let out = []; let from = 0; const page = 1000;
  while (true) {
    const r = await fetch(`${URL}/rest/v1/${table}?${query}`, { headers: { ...H, Range: `${from}-${from+page-1}`, 'Range-Unit': 'items' } });
    if (!r.ok) throw new Error(`Fetch ${table} failed: ${r.status} ${await r.text()}`);
    const rows = await r.json();
    out = out.concat(rows);
    if (rows.length < page) break;
    from += page;
  }
  return out;
}

function buildCowIndex(cattle) {
  // Map<tag_string, cow>. Prefer current-tag matches; fall back to weigh_in-sourced old_tags.
  const primary = new Map();
  const secondary = new Map();
  for (const c of cattle) {
    if (c.tag) primary.set(String(c.tag), c);
    if (Array.isArray(c.old_tags)) {
      for (const ot of c.old_tags) {
        if (!ot || !ot.tag) continue;
        // Skip purchase-farm tags entirely — they're not WCF identifiers.
        if (ot.source === 'import') continue;
        const k = String(ot.tag);
        if (!primary.has(k) && !secondary.has(k)) secondary.set(k, c);
      }
    }
  }
  return { primary, secondary };
}

async function main() {
  const commit = process.argv.includes('--commit');

  console.log('Reading xlsx...');
  const wb = XLSX.readFile(XLSX_PATH, { cellDates: true });
  const raw = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { defval: null });
  console.log(`  ${raw.length} rows in xlsx`);

  // Podio exports Purchase Amount as two columns: "Purchase Amount - amount"
  // and "Purchase Amount - currency". Original importer read the non-existent
  // combined "Purchase Amount" field, so every row imported as null.
  const xlsxRows = raw
    .map(r => ({
      tag: normStr(r['Tag #']),
      amount_raw: r['Purchase Amount - amount'],
      amount: parseAmount(r['Purchase Amount - amount']),
    }))
    .filter(r => r.tag && r.amount != null);
  console.log(`  ${xlsxRows.length} rows have tag + parseable purchase amount`);

  console.log('Loading cattle...');
  const cattle = await fetchAll('cattle', 'select=id,tag,old_tags,purchase_amount,purchase_date,herd');
  console.log(`  ${cattle.length} cattle in DB`);

  const { primary, secondary } = buildCowIndex(cattle);

  const toUpdate = [];
  const alreadySet = [];
  const unmatched = [];
  for (const r of xlsxRows) {
    const cow = primary.get(r.tag) || secondary.get(r.tag);
    if (!cow) { unmatched.push(r); continue; }
    const existing = parseFloat(cow.purchase_amount) || 0;
    if (existing > 0) { alreadySet.push({ cow, existing, xlsx: r.amount }); continue; }
    toUpdate.push({ cow, amount: r.amount, source_tag: r.tag, matched_via: primary.has(r.tag) ? 'current' : 'old_tag' });
  }

  console.log(`\nPlan:`);
  console.log(`  ${toUpdate.length}  to update (currently null/0)`);
  console.log(`  ${alreadySet.length}  already set — skipping`);
  console.log(`  ${unmatched.length}  xlsx rows with no matching cow`);

  if (toUpdate.length > 0) {
    console.log(`\nSample (first 15):`);
    for (const u of toUpdate.slice(0, 15)) {
      console.log(`  #${u.cow.tag.padEnd(5)}  $${u.amount.toFixed(2).padStart(10)}  [${u.matched_via}]  ${u.cow.herd}`);
    }
    if (toUpdate.length > 15) console.log(`  ... and ${toUpdate.length - 15} more`);
  }
  if (alreadySet.length > 0) {
    const mismatches = alreadySet.filter(a => Math.abs(a.existing - a.xlsx) > 0.5);
    if (mismatches.length > 0) {
      console.log(`\n${mismatches.length} cows have an existing amount that differs from the xlsx (not overwriting):`);
      for (const m of mismatches.slice(0, 10)) {
        console.log(`  #${m.cow.tag.padEnd(5)}  DB=$${m.existing}  xlsx=$${m.xlsx}`);
      }
    }
  }
  if (unmatched.length > 0) {
    console.log(`\nUnmatched xlsx rows (no cow with matching tag):`);
    for (const u of unmatched.slice(0, 20)) {
      console.log(`  Tag#${u.tag.padEnd(6)}  $${u.amount}  (raw: ${JSON.stringify(u.amount_raw)})`);
    }
    if (unmatched.length > 20) console.log(`  ... and ${unmatched.length - 20} more`);
  }

  if (!commit) { console.log('\nPreview only. Re-run with --commit to apply.'); return; }
  if (toUpdate.length === 0) { console.log('\nNothing to update.'); return; }

  console.log(`\nApplying ${toUpdate.length} PATCHes...`);
  let ok = 0, fail = 0;
  for (const u of toUpdate) {
    const pr = await fetch(`${URL}/rest/v1/cattle?id=eq.${encodeURIComponent(u.cow.id)}`, {
      method: 'PATCH', headers: H,
      body: JSON.stringify({ purchase_amount: u.amount }),
    });
    if (pr.ok) { ok++; } else { fail++; console.error(`  FAIL: #${u.cow.tag}: ${pr.status} ${await pr.text()}`); }
  }
  console.log(`Done. ${ok} updated, ${fail} failed.`);
}

main().catch(e => { console.error(e); process.exit(1); });
