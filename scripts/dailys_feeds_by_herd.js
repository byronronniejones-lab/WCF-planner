const XLSX = require('xlsx');
const rows = XLSX.utils.sheet_to_json(
  XLSX.readFile("c:/Users/Ronni/OneDrive/Desktop/Cattle upload from Podio/Cattle Daily's - All Cattle Daily's.xlsx", {
    cellDates: true,
  }).Sheets["Cattle Daily's"],
  {defval: null},
);
const byHerd = {};
for (const r of rows) {
  const h = r['Cattle Group'];
  if (!byHerd[h]) byHerd[h] = new Set();
  ['Hay Type #1', 'Hay Type #2', 'Hay Type #3'].forEach((c) => {
    const v = r[c];
    if (v && String(v).trim()) byHerd[h].add(String(v).trim());
  });
  if (parseFloat(r['Lbs of Citrus Pellets']) > 0) byHerd[h].add('__citrus_pellets');
  if (parseFloat(r['Lbs of Alfalfa Pellets']) > 0) byHerd[h].add('__alfalfa_pellets');
}
for (const [h, s] of Object.entries(byHerd)) {
  console.log(`\n${h}:`);
  [...s].sort().forEach((v) => console.log(`  ${v}`));
}
// Compute per-hay-type nutrition averages (from DM/Protein/NFC lb ratios)
const stats = new Map();
for (const r of rows) {
  for (const i of [1, 2, 3]) {
    const label = r[`Hay Type #${i}`];
    const dm = parseFloat(r[`DM - Hay Type #${i}`] || r[`DM - Hay Type #${i} `] || 0);
    const p = parseFloat(r[`Lbs Protein Hay Type #${i}`] || 0);
    const n = parseFloat(r[`Lbs NFC Hay Type #${i}`] || 0);
    const bales = parseFloat(r[`Bales of Hay Type #${i}`] || r[`Bales of Hay Type #${i} `] || 0);
    if (!label || !String(label).trim() || dm <= 0) continue;
    const key = String(label).trim();
    if (!stats.has(key)) stats.set(key, {samples: 0, sumP: 0, sumN: 0, sumDM: 0, sumBales: 0});
    const s = stats.get(key);
    s.samples++;
    s.sumP += p;
    s.sumN += n;
    s.sumDM += dm;
    s.sumBales += bales;
  }
}
console.log('\nPer-hay-type nutrition (weighted by DM):');
[...stats.entries()].sort().forEach(([label, s]) => {
  const pPct = ((s.sumP / s.sumDM) * 100).toFixed(1);
  const nPct = ((s.sumN / s.sumDM) * 100).toFixed(1);
  const dmPerBale = s.sumBales > 0 ? Math.round(s.sumDM / s.sumBales) : '?';
  console.log(`  ${label.padEnd(28)} samples=${s.samples}  protein=${pPct}%  nfc=${nPct}%  DM/bale=${dmPerBale}lb`);
});
