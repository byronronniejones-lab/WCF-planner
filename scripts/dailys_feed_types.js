const XLSX = require('xlsx');
const rows = XLSX.utils.sheet_to_json(
  XLSX.readFile("c:/Users/Ronni/OneDrive/Desktop/Cattle upload from Podio/Cattle Daily's - All Cattle Daily's.xlsx", { cellDates: true }).Sheets["Cattle Daily's"],
  { defval: null }
);
const hayTypes = new Set();
for (const r of rows) {
  ['Hay Type #1', 'Hay Type #2', 'Hay Type #3'].forEach(col => {
    const v = r[col];
    if (v != null && String(v).trim() !== '') hayTypes.add(String(v).trim());
  });
}
console.log(`Distinct hay type values across Mommas data: ${hayTypes.size}`);
[...hayTypes].sort().forEach(v => console.log(`  ${v}`));

// Citrus / alfalfa usage
const citrusRows = rows.filter(r => parseFloat(r['Lbs of Citrus Pellets'])>0).length;
const alfalfaRows = rows.filter(r => parseFloat(r['Lbs of Alfalfa Pellets'])>0).length;
console.log(`\nRows with Citrus Pellets > 0: ${citrusRows}`);
console.log(`Rows with Alfalfa Pellets > 0: ${alfalfaRows}`);

// Sample a row with actual hay data
const sample = rows.find(r => r['Hay Type #1'] && String(r['Hay Type #1']).trim() !== '');
console.log('\nSample row with hay data:');
for (const [k,v] of Object.entries(sample)) {
  if (v != null && String(v).trim() !== '' && !k.match(/^[-_.]/)) console.log(`  ${k}: ${String(v).slice(0,60)}`);
}
