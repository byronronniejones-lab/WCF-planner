// One-off: count comment CSV rows whose item_title (tag) has no match in the cattle xlsx.
const fs = require('fs');
const path = require('path');
const XLSX = require('xlsx');

const CATTLE_XLSX  = 'c:/Users/Ronni/OneDrive/Desktop/Cattle upload from Podio/Cattle Tracker - All Cattle Tracker.xlsx';
const COMMENTS_CSV = 'c:/Users/Ronni/OneDrive/Desktop/podio_comments_29337625_2026-04-16.csv';

function parseCsv(text) {
  const rows = [];
  let row = [], field = '', inQ = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQ) {
      if (c === '"' && text[i+1] === '"') { field += '"'; i++; }
      else if (c === '"') { inQ = false; }
      else { field += c; }
    } else {
      if (c === '"') inQ = true;
      else if (c === ',') { row.push(field); field = ''; }
      else if (c === '\r') { /* skip CR */ }
      else if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; }
      else field += c;
    }
  }
  if (field.length || row.length) { row.push(field); rows.push(row); }
  return rows;
}

const wb = XLSX.readFile(CATTLE_XLSX);
const ws = wb.Sheets[wb.SheetNames[0]];
const cattleRows = XLSX.utils.sheet_to_json(ws, { defval: null });
const tagField = Object.keys(cattleRows[0]).find(k => /^tag\s*#?$/i.test(k)) || 'Tag #';
const tagSet = new Set(cattleRows.map(r => String(r[tagField] ?? '').trim()).filter(Boolean));
console.log(`Cattle xlsx rows: ${cattleRows.length}, unique tags: ${tagSet.size}, tag field detected: "${tagField}"`);

const csvText = fs.readFileSync(COMMENTS_CSV, 'utf8');
const csv = parseCsv(csvText);
const header = csv[0];
const idxTitle = header.indexOf('item_title');
const body = csv.slice(1).filter(r => r.length > 1 && (r[idxTitle] ?? '').trim() !== '');

let matched = 0, orphan = 0;
const orphanTags = new Map();
for (const r of body) {
  const t = String(r[idxTitle]).trim();
  if (tagSet.has(t)) matched++;
  else { orphan++; orphanTags.set(t, (orphanTags.get(t) || 0) + 1); }
}

console.log(`Comment rows: ${body.length}  matched: ${matched}  orphan: ${orphan}`);
console.log(`Distinct orphan tags: ${orphanTags.size}`);
if (orphanTags.size) {
  console.log('Orphan tag samples (tag → count):');
  [...orphanTags.entries()].sort((a,b) => b[1] - a[1]).slice(0, 20).forEach(([t,c]) => console.log(`  ${t}  (${c})`));
}
