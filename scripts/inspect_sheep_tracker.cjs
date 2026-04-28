const XLSX = require('xlsx');
const path = process.argv[2];
if (!path) {
  console.error('usage: node inspect_sheep_tracker.js <path>');
  process.exit(1);
}
const wb = XLSX.readFile(path, {cellDates: true});
console.log('File:', path);
console.log('Sheets:', wb.SheetNames);
const ws = wb.Sheets[wb.SheetNames[0]];
const rows = XLSX.utils.sheet_to_json(ws, {defval: null});
console.log(`Rows: ${rows.length}`);
console.log('\nColumns (in order):');
Object.keys(rows[0] || {}).forEach((k, i) => console.log(`  [${i}] ${k}`));

const fill = {};
for (const r of rows)
  for (const [k, v] of Object.entries(r)) if (v != null && String(v).trim() !== '') fill[k] = (fill[k] || 0) + 1;
console.log('\nPopulated counts per column (desc):');
Object.entries(fill)
  .sort((a, b) => b[1] - a[1])
  .forEach(([k, n]) => console.log(`  ${String(n).padStart(4)}  ${k}`));

console.log('\nFirst 5 rows (non-empty fields only):');
rows.slice(0, 5).forEach((r, i) => {
  console.log(`--- row ${i + 1} ---`);
  for (const [k, v] of Object.entries(r))
    if (v != null && String(v).trim() !== '')
      console.log(`  ${k}: ${v instanceof Date ? v.toISOString().slice(0, 10) : String(v).slice(0, 120)}`);
});

console.log('\nDistinct values for small-domain columns (≤30 unique, ≤80 chars each):');
for (const col of Object.keys(rows[0] || {})) {
  const vals = new Set();
  let bail = false;
  for (const r of rows) {
    const v = r[col];
    if (v == null) continue;
    if (v instanceof Date) {
      bail = true;
      break;
    }
    const s = String(v).trim();
    if (s === '' || s.length > 80) continue;
    vals.add(s);
    if (vals.size > 30) {
      bail = true;
      break;
    }
  }
  if (bail || vals.size === 0) continue;
  console.log(`  ${col}: [${[...vals].sort().join(' | ')}]`);
}
