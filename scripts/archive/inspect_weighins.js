const XLSX = require('xlsx');
const wb = XLSX.readFile('c:/Users/Ronni/OneDrive/Desktop/Cattle upload from Podio/Weigh Ins - All Weigh Ins.xlsx', {
  cellDates: true,
});
console.log('Sheets:', wb.SheetNames);
const ws = wb.Sheets[wb.SheetNames[0]];
const rows = XLSX.utils.sheet_to_json(ws, {defval: null});
console.log(`Rows: ${rows.length}`);
console.log('Columns:', Object.keys(rows[0] || {}));
console.log('\nFirst 5 rows:');
rows.slice(0, 5).forEach((r, i) => {
  console.log(`--- ${i + 1} ---`);
  for (const [k, v] of Object.entries(r)) {
    if (v != null && String(v).trim() !== '') {
      console.log(`  ${k}: ${String(v).slice(0, 80)}`);
    }
  }
});
console.log('\nLast 2 rows:');
rows.slice(-2).forEach((r, i) => {
  console.log(`--- ${rows.length - 1 + i} ---`);
  for (const [k, v] of Object.entries(r)) {
    if (v != null && String(v).trim() !== '') {
      console.log(`  ${k}: ${String(v).slice(0, 80)}`);
    }
  }
});
