// Same as herd_weights_audit.js but scopes weigh_ins to cattle-species sessions.
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
  const sessCattle = await fetchAll('weigh_in_sessions?select=id&species=eq.cattle&');
  const sessIds = new Set(sessCattle.map((s) => s.id));
  const allW = await fetchAll('weigh_ins?select=tag,weight,entered_at,session_id&');
  const weighIns = allW.filter((w) => sessIds.has(w.session_id));

  const byTag = new Map();
  for (const w of weighIns) {
    if (!w.tag) continue;
    if (!byTag.has(w.tag)) byTag.set(w.tag, []);
    byTag.get(w.tag).push(w);
  }
  for (const l of byTag.values()) l.sort((a, b) => (b.entered_at || '').localeCompare(a.entered_at || ''));

  const herdT = {},
    herdC = {};
  for (const c of cattle) {
    const tags = new Set([c.tag, ...(c.old_tags || []).map((t) => t.tag)].filter(Boolean));
    let latest = null;
    for (const t of tags) {
      const l = byTag.get(t);
      if (l && l.length) {
        if (!latest || l[0].entered_at > latest.entered_at) latest = l[0];
      }
    }
    herdC[c.herd] = (herdC[c.herd] || 0) + 1;
    if (latest) herdT[c.herd] = (herdT[c.herd] || 0) + parseFloat(latest.weight);
  }
  console.log('Cattle-species-scoped latest weights:');
  Object.entries(herdT)
    .sort()
    .forEach(([h, w]) => console.log(`  ${h.padEnd(16)} ${Math.round(w).toLocaleString()} lb  (${herdC[h]} cows)`));
  const active = ['mommas', 'backgrounders', 'finishers', 'bulls'].reduce((s, h) => s + (herdT[h] || 0), 0);
  console.log(`  ACTIVE TOTAL:   ${Math.round(active).toLocaleString()} lb   (Podio: 127,632)`);
})();
