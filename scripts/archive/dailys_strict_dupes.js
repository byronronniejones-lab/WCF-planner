const XLSX = require('xlsx');
const rows = XLSX.utils.sheet_to_json(
  XLSX.readFile("c:/Users/Ronni/OneDrive/Desktop/Cattle upload from Podio/Cattle Daily's - All Cattle Daily's.xlsx", {
    cellDates: true,
  }).Sheets["Cattle Daily's"],
  {defval: null},
);
// Strict key: date|team|herd|issues|DM-Given|voltage
const bag = new Map();
for (const r of rows) {
  const d = r['Date'] instanceof Date ? r['Date'].toISOString().slice(0, 10) : '';
  if (!d) continue;
  const key = [
    d,
    (r['Team member'] || '').trim(),
    (r['Cattle Group'] || '').trim(),
    String(r['Issues / Mortalities / Comments'] || '').trim(),
    String(r['DM Given  '] || '').trim(),
    String(r['Fence Voltage - KV'] || '').trim(),
    String(r['Hay & Pellets cost'] || '').trim(),
  ].join('|');
  if (!bag.has(key)) bag.set(key, []);
  bag.get(key).push(r);
}
const dupeGroups = [...bag.values()].filter((v) => v.length > 1);
console.log(`Strict-match duplicate groups (all fields equal): ${dupeGroups.length}`);
const extraRows = dupeGroups.reduce((s, g) => s + (g.length - 1), 0);
console.log(`Extra rows that would be deleted if we keep one per group: ${extraRows}`);
console.log(`\nSample (first 6):`);
dupeGroups.slice(0, 6).forEach((g) => {
  const r = g[0];
  const d = r['Date'] instanceof Date ? r['Date'].toISOString().slice(0, 10) : '';
  console.log(
    `  ${d} | ${r['Team member']} | ${r['Cattle Group']} | DM=${r['DM Given  ']} | voltage=${r['Fence Voltage - KV']} | cost=${r['Hay & Pellets cost']} | issues="${String(r['Issues / Mortalities / Comments'] || '').slice(0, 40)}"  (${g.length} copies)`,
  );
});
