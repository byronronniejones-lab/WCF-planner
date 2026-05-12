const fs = require('fs'),
  path = require('path');
const XLSX = require('xlsx');
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
  // Podio "Last Recorded Weight" per cow
  const wb = XLSX.readFile(
    'c:/Users/Ronni/OneDrive/Desktop/Cattle upload from Podio/Cattle Tracker - All Cattle Tracker.xlsx',
    {cellDates: true},
  );
  const rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], {defval: null});
  const podioByTag = new Map();
  for (const r of rows) {
    const tag = String(r['Tag #'] ?? '').trim();
    const lrw = r['Last Recorded Weight'];
    if (tag) podioByTag.set(tag, lrw == null || lrw === '' ? null : Number(lrw));
  }

  // Our data (same logic as the app)
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

  function ourLatest(c) {
    const tags = new Set();
    if (c.tag) tags.add(c.tag);
    (c.old_tags || []).forEach((ot) => {
      if (ot && ot.tag && ot.source !== 'import') tags.add(ot.tag);
    });
    let latest = null;
    for (const t of tags) {
      const l = byTag.get(t);
      if (l && l.length) {
        if (!latest || l[0].entered_at > latest.entered_at) latest = l[0];
      }
    }
    return latest ? parseFloat(latest.weight) : null;
  }

  for (const herd of ['mommas', 'finishers']) {
    const cows = cattle
      .filter((c) => c.herd === herd)
      .sort((a, b) => (parseFloat(a.tag) || 0) - (parseFloat(b.tag) || 0));
    const diffs = [];
    let podioSum = 0,
      ourSum = 0;
    for (const c of cows) {
      const podio = podioByTag.get(c.tag);
      const ours = ourLatest(c);
      podioSum += podio || 0;
      ourSum += ours || 0;
      if (podio == null && ours == null) continue;
      if (podio == null || ours == null || Math.abs(podio - ours) > 0.5) {
        diffs.push({tag: c.tag, podio, ours, diff: (ours || 0) - (podio || 0)});
      }
    }
    console.log(`\n===== ${herd.toUpperCase()} (${cows.length} cows) =====`);
    console.log(`Podio sum: ${Math.round(podioSum).toLocaleString()} lb`);
    console.log(`Our sum:   ${Math.round(ourSum).toLocaleString()} lb`);
    console.log(`Diff:      ${(ourSum - podioSum).toFixed(1)} lb across ${diffs.length} mismatched cows`);
    if (diffs.length) {
      console.log('Mismatches:');
      diffs.forEach((d) =>
        console.log(
          `  #${d.tag.padEnd(6)} podio=${d.podio == null ? '(blank)' : d.podio + ' lb'}  ours=${d.ours == null ? '(none)' : d.ours + ' lb'}  diff=${d.diff > 0 ? '+' : ''}${d.diff.toFixed(1)}`,
        ),
      );
    }
  }
})();
