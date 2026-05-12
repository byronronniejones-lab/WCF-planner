const fs = require('fs'),
  path = require('path');
for (const l of fs.readFileSync(path.join(__dirname, '.env'), 'utf8').split(/\r?\n/)) {
  const m = /^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*?)\s*$/.exec(l);
  if (m) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
}
const URL = process.env.SUPABASE_URL,
  KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const H = {apikey: KEY, Authorization: `Bearer ${KEY}`};
async function fetchAll(qs) {
  let all = [],
    from = 0;
  while (true) {
    const r = await fetch(`${URL}/rest/v1/${qs}&limit=1000&offset=${from}`, {headers: H});
    const d = await r.json();
    all = all.concat(d);
    if (d.length < 1000) break;
    from += 1000;
  }
  return all;
}

(async () => {
  const cattle = await fetchAll('cattle?select=id,tag,herd,old_tags&');
  const weighIns = await fetchAll('weigh_ins?select=tag,weight,entered_at&');

  // For each cow, find latest weigh-in by tag or old_tags
  const cowTags = (c) => {
    const s = new Set();
    if (c.tag) s.add(c.tag);
    if (Array.isArray(c.old_tags)) c.old_tags.forEach((ot) => ot && ot.tag && s.add(ot.tag));
    return s;
  };
  // Build tag -> sorted-by-entered_at-desc list
  const byTag = new Map();
  for (const w of weighIns) {
    if (!w.tag) continue;
    if (!byTag.has(w.tag)) byTag.set(w.tag, []);
    byTag.get(w.tag).push(w);
  }
  for (const list of byTag.values()) list.sort((a, b) => (b.entered_at || '').localeCompare(a.entered_at || ''));

  const herdTotals = {};
  const herdCounts = {};
  const herdMissingWeight = {};
  const allMissing = [];
  for (const c of cattle) {
    const tags = cowTags(c);
    let latest = null;
    for (const t of tags) {
      const list = byTag.get(t);
      if (list && list.length) {
        if (!latest || list[0].entered_at > latest.entered_at) latest = list[0];
      }
    }
    herdCounts[c.herd] = (herdCounts[c.herd] || 0) + 1;
    if (latest) {
      herdTotals[c.herd] = (herdTotals[c.herd] || 0) + parseFloat(latest.weight);
    } else {
      herdMissingWeight[c.herd] = (herdMissingWeight[c.herd] || 0) + 1;
      allMissing.push(c);
    }
  }

  console.log('Cattle counts by herd:');
  Object.entries(herdCounts)
    .sort()
    .forEach(([h, n]) => console.log(`  ${h.padEnd(16)} ${n}`));
  console.log('\nCattle with NO weigh-in, by herd:');
  Object.entries(herdMissingWeight)
    .sort()
    .forEach(([h, n]) => console.log(`  ${h.padEnd(16)} ${n}`));
  console.log('\nTotal live weight per herd (from latest weigh-in):');
  let grand = 0;
  Object.entries(herdTotals)
    .sort()
    .forEach(([h, w]) => {
      console.log(`  ${h.padEnd(16)} ${Math.round(w).toLocaleString()} lb`);
      grand += w;
    });
  console.log(`  ${'TOTAL'.padEnd(16)} ${Math.round(grand).toLocaleString()} lb`);

  console.log('\n\nExpected from Podio:');
  console.log('  mommas    82,823 lb');
  console.log('  finishers 44,809 lb');
  console.log('  TOTAL    127,632 lb');

  console.log('\n\nAll active-herd cows missing a weigh-in:');
  const active = allMissing.filter((c) => ['mommas', 'backgrounders', 'finishers', 'bulls'].includes(c.herd));
  active.forEach((c) =>
    console.log(
      `  #${c.tag || '(no tag)'}  herd=${c.herd}  old_tags=${JSON.stringify((c.old_tags || []).map((t) => t.tag))}`,
    ),
  );
})();
