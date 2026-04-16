const XLSX = require('xlsx');

function loadEnv() {
  const fs = require('fs'); const path = require('path');
  const p = path.join(__dirname, '.env');
  if (!fs.existsSync(p)) return;
  for (const line of fs.readFileSync(p, 'utf8').split(/\r?\n/)) {
    const m = /^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*?)\s*$/.exec(line);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
}
loadEnv();

const wb = XLSX.readFile('c:/Users/Ronni/OneDrive/Desktop/Cattle upload from Podio/Weigh Ins - All Weigh Ins.xlsx', { cellDates: true });
const rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { defval: null });

const tags = new Set();
const dates = new Set();
const creators = new Set();
let tagCowDivergence = 0;
let rowsWithTags = 0;
let blankTag = 0, blankDate = 0, blankWeight = 0;
const dateCounts = {};
for (const r of rows) {
  const t = String(r['Tag #'] ?? '').trim();
  const c = String(r['Cow'] ?? '').trim();
  if (t !== c) tagCowDivergence++;
  if (!t) blankTag++;
  if (!r['Date']) blankDate++;
  if (r['Weight'] == null || r['Weight'] === '') blankWeight++;
  if (r['Tags'] != null && String(r['Tags']).trim() !== '') rowsWithTags++;
  if (t) tags.add(t);
  if (r['Date']) {
    const d = r['Date'] instanceof Date ? r['Date'].toISOString().slice(0,10) : String(r['Date']).slice(0,10);
    dates.add(d);
    dateCounts[d] = (dateCounts[d] || 0) + 1;
  }
  if (r['Created by']) creators.add(String(r['Created by']).trim());
}
console.log(`Total rows: ${rows.length}`);
console.log(`Blank tags: ${blankTag}  Blank dates: ${blankDate}  Blank weights: ${blankWeight}`);
console.log(`Tag# vs Cow divergence: ${tagCowDivergence}  (0 means Cow is always same as Tag #)`);
console.log(`Rows where "Tags" column has content: ${rowsWithTags}`);
console.log(`Unique weigh-in dates: ${dates.size}`);
console.log(`Unique tags: ${tags.size}`);
console.log(`\n"Created by" distinct values: ${creators.size}`);
[...creators].sort().forEach(c => console.log(`  ${c}`));

// Match tags against the cattle table in Supabase
const URL = process.env.SUPABASE_URL, KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (URL && KEY) {
  (async () => {
    const res = await fetch(`${URL}/rest/v1/cattle?select=tag,herd`, {
      headers: { apikey: KEY, Authorization: `Bearer ${KEY}` }
    });
    const cattle = await res.json();
    const cattleTags = new Set(cattle.filter(c => c.tag).map(c => c.tag));
    const orphans = [...tags].filter(t => !cattleTags.has(t));
    console.log(`\nCattle rows in DB: ${cattle.length}`);
    console.log(`Tags in weigh-ins with NO matching cow: ${orphans.length}`);
    if (orphans.length) {
      console.log('Orphan tag samples:', orphans.slice(0, 20).join(', '));
    }
    // Top 20 busiest weigh-in dates
    const topDates = Object.entries(dateCounts).sort((a,b) => b[1]-a[1]).slice(0, 10);
    console.log(`\nTop 10 busiest weigh-in dates:`);
    topDates.forEach(([d, n]) => console.log(`  ${d}: ${n} rows`));
  })();
} else {
  console.log('\n(No Supabase creds in .env — skipping orphan tag match)');
}
