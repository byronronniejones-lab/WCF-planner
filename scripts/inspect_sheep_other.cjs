const XLSX = require('xlsx');
const wb = XLSX.readFile("c:/Users/Ronni/OneDrive/Desktop/Sheep Daily's - ALL.xlsx", {cellDates: true});
const rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], {defval: null});

const byGroup = {};
for (const r of rows) {
  const g = r['Sheep Group'] || '(null)';
  byGroup[g] = (byGroup[g] || 0) + 1;
}
console.log('Sheep Group counts:', byGroup);

const otherRows = rows.filter((r) => r['Sheep Group'] === 'OTHER');
console.log(`\nOTHER rows: ${otherRows.length}`);
console.log(
  'Date range:',
  otherRows
    .map((r) => r.Date)
    .filter(Boolean)
    .map((d) => (d instanceof Date ? d.toISOString().slice(0, 10) : d))
    .sort(),
);
console.log('\nFirst 10 OTHER rows:');
otherRows.slice(0, 10).forEach((r, i) => {
  console.log(`--- ${i + 1} ---`);
  for (const [k, v] of Object.entries(r))
    if (v != null && String(v).trim() !== '')
      console.log(`  ${k}: ${v instanceof Date ? v.toISOString().slice(0, 10) : String(v).slice(0, 80)}`);
});

// Also: check rows with null Date
const noDate = rows.filter((r) => !r.Date);
console.log(`\nRows with null Date: ${noDate.length}`);
noDate.forEach((r, i) => {
  console.log(`--- noDate ${i + 1} ---`);
  for (const [k, v] of Object.entries(r))
    if (v != null && String(v).trim() !== '')
      console.log(`  ${k}: ${v instanceof Date ? v.toISOString().slice(0, 10) : String(v).slice(0, 80)}`);
});

// Also: parse one Weight History w/ Date string from the tracker to understand format
const wb2 = XLSX.readFile('c:/Users/Ronni/OneDrive/Desktop/Sheep Tracker - All Sheep Tracker.xlsx', {cellDates: true});
const trackerRows = XLSX.utils.sheet_to_json(wb2.Sheets[wb2.SheetNames[0]], {defval: null});
console.log('\nWeight History w/ Date — first 5 non-empty samples:');
trackerRows
  .filter((r) => r['Weight History w/ Date'])
  .slice(0, 5)
  .forEach((r, i) => {
    console.log(`  Tag ${r['Tag #']}: ${String(r['Weight History w/ Date']).slice(0, 200)}`);
  });
console.log('\nLambs column — first 5 non-empty samples:');
trackerRows
  .filter((r) => r.Lambs)
  .slice(0, 5)
  .forEach((r) => {
    console.log(`  Tag ${r['Tag #']} (Sex=${r.Sex}): ${String(r.Lambs).replace(/\n/g, ' / ')}`);
  });
