const fs = require('fs'),
  path = require('path');
for (const l of fs.readFileSync(path.join(__dirname, '.env'), 'utf8').split(/\r?\n/)) {
  const m = /^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*?)\s*$/.exec(l);
  if (m) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
}
const URL = process.env.SUPABASE_URL,
  KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const H = {apikey: KEY, Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json'};
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
  // Get all weigh_ins marked as receiving-weight imports + their session dates
  const weighIns = await fetchAll('weigh_ins?select=id,session_id,entered_at,note&note=like.Receiving weight*&');
  const sessionIds = [...new Set(weighIns.map((w) => w.session_id))];
  console.log(`Receiving-weight rows: ${weighIns.length} across ${sessionIds.length} sessions.`);

  // Fetch each session's date
  const sessions = await fetchAll(
    `weigh_in_sessions?select=id,date&id=in.(${sessionIds.map((s) => `"${s}"`).join(',')})&`,
  );
  const sessDate = new Map(sessions.map((s) => [s.id, s.date]));

  if (!process.argv.includes('--commit')) {
    console.log('\nSample (first 10):');
    weighIns.slice(0, 10).forEach((w) => {
      const d = sessDate.get(w.session_id);
      console.log(
        `  ${w.id}  session_date=${d}  current_entered_at=${(w.entered_at || '').slice(0, 19)}  -> ${d}T12:00:00Z`,
      );
    });
    console.log(`\nPreview only. Rerun with --commit to update ${weighIns.length} rows.`);
    return;
  }

  // PATCH each row individually (PostgREST can't do SET x = other_table.y in one shot)
  let n = 0;
  for (const w of weighIns) {
    const d = sessDate.get(w.session_id);
    if (!d) continue;
    const isoTarget = `${d}T12:00:00+00:00`;
    const r = await fetch(`${URL}/rest/v1/weigh_ins?id=eq.${encodeURIComponent(w.id)}`, {
      method: 'PATCH',
      headers: {...H, Prefer: 'return=minimal'},
      body: JSON.stringify({entered_at: isoTarget}),
    });
    if (!r.ok) throw new Error(`${w.id}: ${await r.text()}`);
    n++;
    if (n % 50 === 0) console.log(`  updated ${n}/${weighIns.length}`);
  }
  console.log(`\nDone: updated ${n} rows.`);
})();
