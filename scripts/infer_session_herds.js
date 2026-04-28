// scripts/infer_session_herds.js
//
// One-time backfill: populate weigh_in_sessions.herd for imported cattle sessions
// by majority-tag match against the cattle table. Future sessions are always
// created with an explicit herd via the admin New Weigh-In modal, so this script
// runs once.
//
// Algorithm per session (where species='cattle' and herd IS NULL):
//   1. Load all weigh_ins for the session.
//   2. For each unique tag, resolve to a cow via cowTagSet() — current tag OR
//      old_tags[] entries where source !== 'import' (purchase tags can collide
//      with unrelated WCF tags — see PROJECT.md §13.6 #8).
//   3. Tally the cow.herd per matched tag.
//   4. Majority wins (ties: skip — will log; Ronnie said ~1% chance).
//   5. PATCH session.herd.
//
// Usage:
//   node scripts/infer_session_herds.js           # preview
//   node scripts/infer_session_herds.js --commit  # apply PATCH
//
// Idempotent: only touches sessions with herd IS NULL.

const fs = require('fs');
const path = require('path');
for (const l of fs.readFileSync(path.join(__dirname, '.env'), 'utf8').split(/\r?\n/)) {
  const m = /^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*?)\s*$/.exec(l);
  if (m) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
}
const URL = process.env.SUPABASE_URL;
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!URL || !KEY) {
  console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in scripts/.env');
  process.exit(1);
}
const H = {apikey: KEY, Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json'};

async function fetchAll(table, query) {
  let out = [];
  let from = 0;
  const page = 1000;
  while (true) {
    const r = await fetch(`${URL}/rest/v1/${table}?${query}`, {
      headers: {...H, Range: `${from}-${from + page - 1}`, 'Range-Unit': 'items'},
    });
    if (!r.ok) throw new Error(`Fetch ${table} failed: ${r.status} ${await r.text()}`);
    const rows = await r.json();
    out = out.concat(rows);
    if (rows.length < page) break;
    from += page;
  }
  return out;
}

function buildCowTagIndex(cattle) {
  // Map<tag, herd>. Skips old_tags with source='import'.
  const idx = new Map();
  for (const c of cattle) {
    if (c.tag) idx.set(String(c.tag), c.herd || null);
    if (Array.isArray(c.old_tags)) {
      for (const ot of c.old_tags) {
        if (!ot || !ot.tag || ot.source === 'import') continue;
        // Don't clobber current-tag mapping with an old-tag mapping.
        if (!idx.has(String(ot.tag))) idx.set(String(ot.tag), c.herd || null);
      }
    }
  }
  return idx;
}

function majority(tally) {
  // tally: {herd: count}. Returns {herd, count} or null on tie/empty.
  const entries = Object.entries(tally).sort((a, b) => b[1] - a[1]);
  if (entries.length === 0) return null;
  if (entries.length === 1) return {herd: entries[0][0], count: entries[0][1]};
  if (entries[0][1] === entries[1][1]) return null; // tie
  return {herd: entries[0][0], count: entries[0][1]};
}

async function main() {
  const commit = process.argv.includes('--commit');

  console.log('Loading cattle + sessions + weigh_ins...');
  const [cattle, allSessions, allWIs] = await Promise.all([
    fetchAll('cattle', 'select=id,tag,herd,old_tags'),
    fetchAll('weigh_in_sessions', 'species=eq.cattle&herd=is.null&select=id,date,species,herd,notes'),
    fetchAll('weigh_ins', 'select=id,session_id,tag'),
  ]);
  console.log(
    `  ${cattle.length} cattle, ${allSessions.length} cattle sessions with herd=null, ${allWIs.length} total weigh_ins`,
  );

  const tagIndex = buildCowTagIndex(cattle);

  const wiBySession = new Map();
  for (const w of allWIs) {
    if (!wiBySession.has(w.session_id)) wiBySession.set(w.session_id, []);
    wiBySession.get(w.session_id).push(w);
  }

  const toUpdate = [];
  const ties = [];
  const noMatch = [];

  for (const s of allSessions) {
    const wis = wiBySession.get(s.id) || [];
    const tally = {};
    let matched = 0;
    for (const w of wis) {
      if (!w.tag) continue;
      const herd = tagIndex.get(String(w.tag));
      if (!herd) continue;
      tally[herd] = (tally[herd] || 0) + 1;
      matched++;
    }
    const m = majority(tally);
    if (!m) {
      if (Object.keys(tally).length === 0) noMatch.push({session: s, entries: wis.length});
      else ties.push({session: s, tally});
      continue;
    }
    toUpdate.push({session: s, herd: m.herd, matched, total: wis.length, tally});
  }

  console.log(`\n${toUpdate.length} sessions → herd assignment found.`);
  if (noMatch.length) console.log(`${noMatch.length} sessions → no tag matches any current cow (leaving null).`);
  if (ties.length) console.log(`${ties.length} sessions → TIE, skipping.`);

  console.log('\nPreview (first 10):');
  for (const u of toUpdate.slice(0, 10)) {
    console.log(
      `  ${u.session.date}  session=${u.session.id.slice(0, 12)}  →  ${u.herd}  (${u.matched}/${u.total} tags matched, tally=${JSON.stringify(u.tally)})`,
    );
  }
  if (ties.length) {
    console.log('\nTies:');
    for (const t of ties)
      console.log(`  ${t.session.date}  session=${t.session.id.slice(0, 12)}  tally=${JSON.stringify(t.tally)}`);
  }

  if (!commit) {
    console.log('\nPreview only. Re-run with --commit to apply.');
    return;
  }
  if (toUpdate.length === 0) {
    console.log('\nNothing to update.');
    return;
  }

  console.log('\nApplying updates...');
  let ok = 0,
    fail = 0;
  for (const u of toUpdate) {
    const pr = await fetch(`${URL}/rest/v1/weigh_in_sessions?id=eq.${encodeURIComponent(u.session.id)}`, {
      method: 'PATCH',
      headers: H,
      body: JSON.stringify({herd: u.herd}),
    });
    if (pr.ok) {
      ok++;
    } else {
      fail++;
      console.error(`  FAIL: ${u.session.id}: ${pr.status} ${await pr.text()}`);
    }
  }
  console.log(`Done. ${ok} updated, ${fail} failed.`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
