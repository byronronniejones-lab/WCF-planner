// Consolidate cattle weigh_in_sessions so there's exactly one session per date.
// For each date with multiple sessions, pick a canonical session, move all its
// weigh_ins rows to the canonical session_id, and delete the other sessions.
//
// Preference for canonical session, per date:
//   1. Any "wsess-imp-YYYY-MM-DD" (the Podio mass-weigh-in session)
//   2. Else the session with the most weigh_ins
//   3. Else arbitrary (first by id)
//
// Usage:
//   node scripts/merge_sessions_by_date.js           # preview only
//   node scripts/merge_sessions_by_date.js --commit  # apply

const fs = require('fs');
const path = require('path');
for (const l of fs.readFileSync(path.join(__dirname, '.env'), 'utf8').split(/\r?\n/)) {
  const m = /^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*?)\s*$/.exec(l);
  if (m) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
}

const URL = process.env.SUPABASE_URL;
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
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
  const sessions = await fetchAll(
    'weigh_in_sessions?select=id,date,herd,species,notes,status,started_at&species=eq.cattle&',
  );
  const weighIns = await fetchAll('weigh_ins?select=id,session_id&');
  const countBySess = {};
  for (const w of weighIns) countBySess[w.session_id] = (countBySess[w.session_id] || 0) + 1;

  const byDate = new Map();
  for (const s of sessions) {
    if (!byDate.has(s.date)) byDate.set(s.date, []);
    byDate.get(s.date).push(s);
  }

  // Plan merges
  const plans = [];
  for (const [date, group] of byDate) {
    if (group.length < 2) continue;
    // pick canonical
    const imp = group.find((s) => (s.id || '').startsWith('wsess-imp-'));
    let canonical;
    if (imp) canonical = imp;
    else {
      canonical = [...group].sort(
        (a, b) => (countBySess[b.id] || 0) - (countBySess[a.id] || 0) || a.id.localeCompare(b.id),
      )[0];
    }
    const obsolete = group.filter((s) => s.id !== canonical.id);
    plans.push({date, canonical, obsolete, totalEntries: group.reduce((s, x) => s + (countBySess[x.id] || 0), 0)});
  }
  plans.sort((a, b) => b.date.localeCompare(a.date));

  const totalSessionsBefore = sessions.length;
  const sessionsToDelete = plans.reduce((s, p) => s + p.obsolete.length, 0);
  const totalSessionsAfter = totalSessionsBefore - sessionsToDelete;

  console.log('===== SESSION MERGE PREVIEW =====');
  console.log(`Cattle sessions currently: ${totalSessionsBefore}`);
  console.log(`Unique dates: ${byDate.size}`);
  console.log(`Dates with multiple sessions: ${plans.length}`);
  console.log(`Obsolete sessions to delete: ${sessionsToDelete}`);
  console.log(`Cattle sessions after merge: ${totalSessionsAfter}`);
  console.log('\nSample merges (top 10 by date desc):');
  plans.slice(0, 10).forEach((p) => {
    console.log(
      `  ${p.date}  keep ${p.canonical.id}  merge ${p.obsolete.length} others  (${p.totalEntries} entries total)`,
    );
  });

  if (!process.argv.includes('--commit')) {
    console.log('\n(Nothing written. Rerun with --commit to apply.)');
    return;
  }

  console.log('\n===== COMMIT =====');
  let sessUpdated = 0,
    weighUpdated = 0,
    sessDeleted = 0;
  for (const p of plans) {
    // 1. Repoint all weigh_ins from obsolete sessions to the canonical one
    for (const obs of p.obsolete) {
      const res = await fetch(`${URL}/rest/v1/weigh_ins?session_id=eq.${encodeURIComponent(obs.id)}`, {
        method: 'PATCH',
        headers: {...H, Prefer: 'return=minimal'},
        body: JSON.stringify({session_id: p.canonical.id}),
      });
      if (!res.ok) throw new Error(`PATCH weigh_ins failed: ${res.status} ${await res.text()}`);
      weighUpdated += countBySess[obs.id] || 0;
    }
    // 2. Delete the obsolete sessions
    for (const obs of p.obsolete) {
      const res = await fetch(`${URL}/rest/v1/weigh_in_sessions?id=eq.${encodeURIComponent(obs.id)}`, {
        method: 'DELETE',
        headers: {...H, Prefer: 'return=minimal'},
      });
      if (!res.ok) throw new Error(`DELETE session failed: ${res.status} ${await res.text()}`);
      sessDeleted++;
    }
    // 3. Normalise the canonical session: herd=null (mixed), notes reflects merge
    const res = await fetch(`${URL}/rest/v1/weigh_in_sessions?id=eq.${encodeURIComponent(p.canonical.id)}`, {
      method: 'PATCH',
      headers: {...H, Prefer: 'return=minimal'},
      body: JSON.stringify({
        herd: null,
        notes:
          p.canonical.notes && p.canonical.notes.includes('merged')
            ? p.canonical.notes
            : `${p.canonical.notes || 'Imported from Podio'} \u00b7 merged ${p.obsolete.length + 1} sessions`,
      }),
    });
    if (!res.ok) throw new Error(`PATCH canonical failed: ${res.status} ${await res.text()}`);
    sessUpdated++;
  }
  console.log(`weigh_ins repointed: ${weighUpdated}`);
  console.log(`canonical sessions updated: ${sessUpdated}`);
  console.log(`sessions deleted: ${sessDeleted}`);
  console.log('\u2713 Merge complete.');
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
