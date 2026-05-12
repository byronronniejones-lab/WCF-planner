const XLSX = require('xlsx');
const wb = XLSX.readFile(
  "c:/Users/Ronni/OneDrive/Desktop/Cattle upload from Podio/Cattle Daily's - All Cattle Daily's.xlsx",
  {cellDates: true},
);
console.log('Sheets:', wb.SheetNames);
const ws = wb.Sheets[wb.SheetNames[0]];
const rows = XLSX.utils.sheet_to_json(ws, {defval: null});
console.log(`Rows: ${rows.length}`);
console.log('Columns:', Object.keys(rows[0] || {}));

// Fill stats per column
const fill = {};
for (const r of rows) {
  for (const [k, v] of Object.entries(r)) {
    if (v != null && String(v).trim() !== '') fill[k] = (fill[k] || 0) + 1;
  }
}
console.log('\nPopulated counts per column:');
Object.entries(fill)
  .sort((a, b) => b[1] - a[1])
  .forEach(([k, n]) => console.log(`  ${n.toString().padStart(4)}  ${k}`));

console.log('\nFirst 3 rows (full):');
rows.slice(0, 3).forEach((r, i) => {
  console.log(`--- row ${i + 1} ---`);
  for (const [k, v] of Object.entries(r)) {
    if (v != null && String(v).trim() !== '') {
      console.log(`  ${k}: ${String(v).slice(0, 100)}`);
    }
  }
});

// Distinct values for short-enum-looking columns
console.log('\nDistinct values for small-domain columns:');
for (const col of Object.keys(rows[0] || {})) {
  const vals = new Set();
  for (const r of rows) {
    const v = r[col];
    if (v == null) continue;
    if (v instanceof Date) continue;
    const s = String(v).trim();
    if (s === '') continue;
    if (s.length > 80) continue;
    vals.add(s);
  }
  if (vals.size > 0 && vals.size <= 20) {
    console.log(`  ${col} (${vals.size} distinct):`);
    [...vals]
      .sort()
      .slice(0, 20)
      .forEach((v) => console.log(`    - ${v}`));
  }
}
