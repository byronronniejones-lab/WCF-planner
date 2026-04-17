// scripts/fix_feed_herd_scope.js
//
// One-time fix: the 12 cattle_feed_inputs rows seeded by import_cattle_dailys.js
// were created with herd_scope = []. The CattleDailysView edit modal filters feed
// options by herd, so feeds with empty scope never render as dropdown options —
// the <select> shows "Select feed..." even when the jsonb has a valid feed_input_id.
//
// This script populates herd_scope = ["mommas","backgrounders","finishers","bulls"]
// for every feed currently scoped to an empty array. Pre-existing feeds with real
// scopes are untouched.
//
// Usage:
//   node scripts/fix_feed_herd_scope.js           # preview
//   node scripts/fix_feed_herd_scope.js --commit  # apply PATCH
//
// Idempotent: safe to re-run.

const fs = require('fs'); const path = require('path');
for (const l of fs.readFileSync(path.join(__dirname,'.env'),'utf8').split(/\r?\n/)) {
  const m = /^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*?)\s*$/.exec(l);
  if (m) process.env[m[1]] = m[2].replace(/^["']|["']$/g,'');
}
const URL = process.env.SUPABASE_URL;
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!URL || !KEY) { console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in scripts/.env'); process.exit(1); }
const H = { apikey: KEY, Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' };

const ACTIVE_HERDS = ['mommas','backgrounders','finishers','bulls'];

async function main() {
  const commit = process.argv.includes('--commit');

  const res = await fetch(`${URL}/rest/v1/cattle_feed_inputs?select=id,name,category,herd_scope`, { headers: H });
  if (!res.ok) { console.error('Fetch failed:', res.status, await res.text()); process.exit(1); }
  const rows = await res.json();

  const needsFix = rows.filter(r => !Array.isArray(r.herd_scope) || r.herd_scope.length === 0);

  console.log(`Found ${rows.length} total feed inputs.`);
  console.log(`${needsFix.length} have empty herd_scope and will be updated:\n`);
  for (const r of needsFix) {
    console.log(`  [${r.category}] ${r.name}  →  ${JSON.stringify(ACTIVE_HERDS)}`);
  }
  const unchanged = rows.filter(r => Array.isArray(r.herd_scope) && r.herd_scope.length > 0);
  if (unchanged.length > 0) {
    console.log(`\n${unchanged.length} untouched (already scoped):`);
    for (const r of unchanged) {
      console.log(`  [${r.category}] ${r.name}  scope=${JSON.stringify(r.herd_scope)}`);
    }
  }

  if (!commit) { console.log('\nPreview only. Re-run with --commit to apply.'); return; }
  if (needsFix.length === 0) { console.log('\nNothing to update.'); return; }

  console.log('\nApplying updates...');
  let ok = 0, fail = 0;
  for (const r of needsFix) {
    const pr = await fetch(`${URL}/rest/v1/cattle_feed_inputs?id=eq.${encodeURIComponent(r.id)}`, {
      method: 'PATCH', headers: H,
      body: JSON.stringify({ herd_scope: ACTIVE_HERDS }),
    });
    if (pr.ok) { ok++; } else { fail++; console.error(`  FAIL: ${r.name}: ${pr.status} ${await pr.text()}`); }
  }
  console.log(`Done. ${ok} updated, ${fail} failed.`);
}

main().catch(e => { console.error(e); process.exit(1); });
