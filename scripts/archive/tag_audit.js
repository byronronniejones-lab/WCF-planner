const XLSX = require('xlsx');
const wb = XLSX.readFile(
  'c:/Users/Ronni/OneDrive/Desktop/Cattle upload from Podio/Cattle Tracker - All Cattle Tracker.xlsx',
);
const rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], {defval: null});
const tagKey = Object.keys(rows[0]).find((k) => /^tag\s*#?$/i.test(k));
const statusKey = Object.keys(rows[0]).find((k) => /^status$/i.test(k));

let blank = 0;
const byTag = new Map();
for (const r of rows) {
  const t = String(r[tagKey] ?? '').trim();
  if (!t) {
    blank++;
    continue;
  }
  if (!byTag.has(t)) byTag.set(t, []);
  byTag.get(t).push(r[statusKey]);
}
const dupes = [...byTag.entries()].filter(([, v]) => v.length > 1);
console.log(`Total rows: ${rows.length}`);
console.log(`Blank tag rows: ${blank}`);
console.log(`Unique tags: ${byTag.size}`);
console.log(`Tags with duplicates: ${dupes.length}`);
console.log(`Duplicate-row total: ${dupes.reduce((s, [, v]) => s + v.length, 0)}`);
console.log('\nTop 30 duplicate tags (tag → statuses):');
dupes
  .sort((a, b) => b[1].length - a[1].length)
  .slice(0, 30)
  .forEach(([t, statuses]) => {
    console.log(`  ${t}: ${statuses.join(' | ')}`);
  });
