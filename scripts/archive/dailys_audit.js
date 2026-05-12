const XLSX = require('xlsx');
const rows = XLSX.utils.sheet_to_json(
  XLSX.readFile("c:/Users/Ronni/OneDrive/Desktop/Cattle upload from Podio/Cattle Daily's - All Cattle Daily's.xlsx", {
    cellDates: true,
  }).Sheets["Cattle Daily's"],
  {defval: null},
);

// Group counts
const byGroup = {};
for (const r of rows) {
  const g = r['Cattle Group'];
  byGroup[g] = (byGroup[g] || 0) + 1;
}
console.log('Rows per Cattle Group:');
Object.entries(byGroup).forEach(([k, n]) => console.log(`  ${k}: ${n}`));

// Dedup-key analysis (date + team + group)
const seen = new Map();
for (const r of rows) {
  const d = r['Date'] instanceof Date ? r['Date'].toISOString().slice(0, 10) : null;
  if (!d) continue;
  const key = d + '|' + r['Team member'] + '|' + r['Cattle Group'];
  seen.set(key, (seen.get(key) || 0) + 1);
}
const dupes = [...seen.entries()].filter(([, n]) => n > 1);
console.log(`\nDuplicate (date+team+group) keys: ${dupes.length}`);
dupes.slice(0, 10).forEach(([k, n]) => console.log(`  ${k}: ${n} rows`));

// OTHER rows
const others = rows.filter((r) => r['Cattle Group'] === 'OTHER');
console.log(`\nOTHER rows: ${others.length}`);
others.slice(0, 5).forEach((r, i) => {
  const d = r['Date'] instanceof Date ? r['Date'].toISOString().slice(0, 10) : '?';
  console.log(
    `  ${d}  team=${r['Team member']}  DM=${r['DM Given  ']}  voltage=${r['Fence Voltage - KV']}  issues="${String(r['Issues / Mortalities / Comments'] || '').slice(0, 60)}"`,
  );
});

// Blank-date rows
const blankDate = rows.filter((r) => !r['Date']);
console.log(`\nBlank-date rows: ${blankDate.length}`);
blankDate
  .slice(0, 3)
  .forEach((r) =>
    console.log(
      '  ',
      JSON.stringify(
        Object.fromEntries(Object.entries(r).filter(([, v]) => v != null && String(v).trim() !== '')),
      ).slice(0, 200),
    ),
  );

// Date range
const dates = rows
  .map((r) => r['Date'])
  .filter((x) => x instanceof Date)
  .sort((a, b) => a - b);
console.log(
  `\nDate range: ${dates[0]?.toISOString().slice(0, 10)} → ${dates[dates.length - 1]?.toISOString().slice(0, 10)}`,
);

// Mortality heuristic — how many rows have mortality keywords in issues text?
const mortRe = /\b(died|death|mortalit|cull|down)\b/i;
const mortHits = rows.filter((r) => mortRe.test(String(r['Issues / Mortalities / Comments'] || '')));
console.log(`\nRows whose Issues text matches mortality keywords: ${mortHits.length}`);

// "None"-only issues
const noneCount = rows.filter(
  (r) =>
    String(r['Issues / Mortalities / Comments'] || '')
      .trim()
      .toLowerCase() === 'none',
).length;
console.log(`Rows where issues text is literally "None": ${noneCount}`);
