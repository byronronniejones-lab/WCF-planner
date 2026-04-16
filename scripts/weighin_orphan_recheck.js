const XLSX = require('xlsx');
const fs = require('fs'); const path = require('path');
const p = path.join(__dirname, '.env');
for (const line of fs.readFileSync(p, 'utf8').split(/\r?\n/)) {
  const m = /^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*?)\s*$/.exec(line);
  if (m) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
}

const wb = XLSX.readFile('c:/Users/Ronni/OneDrive/Desktop/Cattle upload from Podio/Weigh Ins - All Weigh Ins.xlsx', { cellDates: true });
const rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { defval: null });

// Show 5 examples where Tag # != Cow
console.log('Sample rows where Tag # != Cow:');
let count = 0;
for (const r of rows) {
  const t = String(r['Tag #']||'').trim();
  const c = String(r['Cow']||'').trim();
  if (t && c && t !== c) {
    if (count < 8) {
      console.log(`  Tag #=${t}  Cow=${c}  Date=${r['Date'] ? r['Date'].toISOString().slice(0,10) : '?'}  Weight=${r['Weight']}`);
      count++;
    }
  }
}

(async () => {
  const URL = process.env.SUPABASE_URL, KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const res = await fetch(`${URL}/rest/v1/cattle?select=id,tag,herd,old_tags`, {
    headers: { apikey: KEY, Authorization: `Bearer ${KEY}` }
  });
  const cattle = await res.json();
  const tagToCows = new Map();
  const oldTagToCows = new Map();
  for (const c of cattle) {
    if (c.tag) {
      if (!tagToCows.has(c.tag)) tagToCows.set(c.tag, []);
      tagToCows.get(c.tag).push(c);
    }
    if (Array.isArray(c.old_tags)) {
      for (const entry of c.old_tags) {
        if (entry && entry.tag) {
          if (!oldTagToCows.has(entry.tag)) oldTagToCows.set(entry.tag, []);
          oldTagToCows.get(entry.tag).push(c);
        }
      }
    }
  }

  // Resolve: try Tag #, then Cow, then old_tags
  let resolvedByCurrentTag = 0, resolvedByCowField = 0, resolvedByOldTag = 0, unresolved = 0;
  const unresolvedSet = new Map();
  for (const r of rows) {
    const t = String(r['Tag #']||'').trim();
    const c = String(r['Cow']||'').trim();
    if (tagToCows.has(t)) { resolvedByCurrentTag++; continue; }
    if (c && c !== t && tagToCows.has(c)) { resolvedByCowField++; continue; }
    if (oldTagToCows.has(t)) { resolvedByOldTag++; continue; }
    if (c && c !== t && oldTagToCows.has(c)) { resolvedByOldTag++; continue; }
    unresolved++;
    unresolvedSet.set(t, (unresolvedSet.get(t)||0) + 1);
  }
  console.log(`\nRow-level match results:`);
  console.log(`  Matched by Tag # directly: ${resolvedByCurrentTag}`);
  console.log(`  Matched by Cow field (current tag differs from Tag #): ${resolvedByCowField}`);
  console.log(`  Matched via old_tags: ${resolvedByOldTag}`);
  console.log(`  UNRESOLVED: ${unresolved} rows across ${unresolvedSet.size} distinct tags`);
  if (unresolvedSet.size) {
    console.log('  Unresolved tag → row count:');
    [...unresolvedSet.entries()].sort((a,b) => b[1]-a[1]).forEach(([t,n]) => console.log(`    ${t}: ${n}`));
  }

  // Also: for each date, how many distinct herds?
  const dateToHerds = {};
  for (const r of rows) {
    const t = String(r['Tag #']||'').trim();
    const cC = String(r['Cow']||'').trim();
    let cow = tagToCows.get(t)?.[0] || tagToCows.get(cC)?.[0] || oldTagToCows.get(t)?.[0] || oldTagToCows.get(cC)?.[0];
    if (!cow) continue;
    const d = r['Date'] ? r['Date'].toISOString().slice(0,10) : null;
    if (!d) continue;
    if (!dateToHerds[d]) dateToHerds[d] = new Set();
    dateToHerds[d].add(cow.herd);
  }
  const herdCounts = Object.values(dateToHerds).map(s => s.size);
  const sessionTotal = herdCounts.reduce((a,b) => a+b, 0);
  const avg = (sessionTotal / herdCounts.length).toFixed(2);
  console.log(`\nSessions if grouped by (date, herd): ${sessionTotal} sessions across ${herdCounts.length} dates (avg ${avg} herds/date)`);
})();
