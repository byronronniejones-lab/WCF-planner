const XLSX = require('xlsx');
const wb = XLSX.readFile(
  'c:/Users/Ronni/OneDrive/Desktop/Cattle upload from Podio/Cattle Tracker - All Cattle Tracker.xlsx',
);
const rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], {defval: null});
const tagKey = Object.keys(rows[0]).find((k) => /^tag\s*#?$/i.test(k));

const blanks = rows.filter((r) => !String(r[tagKey] ?? '').trim());
console.log(`Blank-tag rows: ${blanks.length}`);

let rowsWithAnyData = 0;
const colCounts = {};
for (const r of blanks) {
  let populated = false;
  for (const [k, v] of Object.entries(r)) {
    if (k === tagKey) continue;
    if (v != null && String(v).trim() !== '') {
      populated = true;
      colCounts[k] = (colCounts[k] || 0) + 1;
    }
  }
  if (populated) rowsWithAnyData++;
}
console.log(`Blank-tag rows that have ANY other data: ${rowsWithAnyData}`);
console.log('Column populations across blank-tag rows:');
Object.entries(colCounts)
  .sort((a, b) => b[1] - a[1])
  .forEach(([k, c]) => console.log(`  ${k}: ${c}`));

console.log('\nFirst 3 blank-tag rows with data (if any):');
blanks
  .filter((r) => Object.entries(r).some(([k, v]) => k !== tagKey && v != null && String(v).trim() !== ''))
  .slice(0, 3)
  .forEach((r, i) => {
    console.log(`--- row ${i + 1} ---`);
    Object.entries(r).forEach(([k, v]) => {
      if (v != null && String(v).trim() !== '') console.log(`  ${k}: ${String(v).slice(0, 80)}`);
    });
  });
