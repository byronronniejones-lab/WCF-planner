// Merges duplicate equipment_fuelings row pairs that were created when
// Podio's Fuel Log app and the per-equipment Checklist app entries weren't
// linked during import (or the link pointed to an item we didn't have).
//
// Symptom: each fueling appears TWICE on /equipment/<slug> — once with
// gallons (from Fuel Log) and once without (from the checklist app). The
// checklist-app row is the one that carries the ticked items + photos, so
// the expansion on the "visible" Fuel Log row appears empty.
//
// Fix: group by (equipment_id, date, reading, team_member). If any group
// has ≥2 rows, pick the one that carries the most data (prefer non-null
// gallons + any checklist/photo content) as the winner. Merge into winner:
//   - every_fillup_check  (non-empty)
//   - service_intervals_completed (non-empty)
//   - photos              (non-empty)
//   - gallons / def_gallons / comments — fill only if winner is null
// Then DELETE the losers.
//
// Keys: for matching we use equipment_id + date + reading (hours OR km) +
// normalized team_member. We tolerate null team_member.
//
// Usage:
//   node scripts/patch_dedup_fueling_pairs.cjs           # preview
//   node scripts/patch_dedup_fueling_pairs.cjs --commit  # apply
// Idempotent — safe to re-run.

const fs = require('fs');
const path = require('path');

const COMMIT = process.argv.includes('--commit');
const ONLY_SLUG = (() => {
  const i = process.argv.indexOf('--slug');
  return i > 0 ? process.argv[i + 1] : null;
})();

function loadEnv() {
  const p = path.join(__dirname, '.env');
  if (!fs.existsSync(p)) return;
  for (const line of fs.readFileSync(p, 'utf8').split(/\r?\n/)) {
    const m = /^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*?)\s*$/.exec(line);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
}
loadEnv();

const {createClient} = require('@supabase/supabase-js');
const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {auth:{persistSession:false}});

function normTeam(t) { return (t || '').trim().toLowerCase(); }
function isEmptyArr(x) { return !Array.isArray(x) || x.length === 0; }

function mergeScore(r) {
  // Higher score = more likely to be the "good" row we keep.
  let s = 0;
  if (r.gallons != null) s += 10;
  if (!isEmptyArr(r.every_fillup_check)) s += 5;
  if (!isEmptyArr(r.service_intervals_completed)) s += 5;
  if (!isEmptyArr(r.photos)) s += 3;
  if (r.podio_source_app && r.podio_source_app.startsWith('fuel_log')) s += 2;
  return s;
}

(async () => {
  const {data: eqs} = await sb.from('equipment').select('id,slug,name');
  const slugById = new Map(eqs.map(e => [e.id, e.slug]));
  const filterSlugId = ONLY_SLUG ? eqs.find(e => e.slug === ONLY_SLUG)?.id : null;
  if (ONLY_SLUG && !filterSlugId) { console.error(`No equipment with slug=${ONLY_SLUG}`); process.exit(1); }

  console.log('Loading fuelings (paginated)...');
  const rows = [];
  const PAGE = 1000;
  for (let from = 0; ; from += PAGE) {
    let q = sb.from('equipment_fuelings').select('*').order('date', {ascending:false}).range(from, from + PAGE - 1);
    if (filterSlugId) q = q.eq('equipment_id', filterSlugId);
    const {data, error} = await q;
    if (error) { console.error(error); process.exit(1); }
    rows.push(...(data || []));
    if (!data || data.length < PAGE) break;
  }
  console.log(`  ${rows.length} rows loaded.`);

  // Bucket by (equipment_id | date | reading | team).
  const groups = new Map();
  for (const r of rows) {
    const reading = r.hours_reading != null ? Math.round(Number(r.hours_reading)) :
                    r.km_reading    != null ? Math.round(Number(r.km_reading))    : null;
    const key = [r.equipment_id, r.date || '', reading == null ? 'null' : reading, normTeam(r.team_member)].join('|');
    const arr = groups.get(key) || []; arr.push(r); groups.set(key, arr);
  }

  let totalDupes = 0;
  const mergePlans = []; // {winner, losers, merged}
  for (const [key, arr] of groups) {
    if (arr.length < 2) continue;
    totalDupes += arr.length;
    // Pick winner by mergeScore; ties broken by id (stable).
    arr.sort((a, b) => mergeScore(b) - mergeScore(a) || a.id.localeCompare(b.id));
    const winner = arr[0];
    const losers = arr.slice(1);
    const merged = {
      every_fillup_check: winner.every_fillup_check,
      service_intervals_completed: winner.service_intervals_completed,
      photos: winner.photos,
      gallons: winner.gallons,
      def_gallons: winner.def_gallons,
      comments: winner.comments,
      fuel_type: winner.fuel_type,
    };
    for (const l of losers) {
      if (isEmptyArr(merged.every_fillup_check) && !isEmptyArr(l.every_fillup_check)) merged.every_fillup_check = l.every_fillup_check;
      if (isEmptyArr(merged.service_intervals_completed) && !isEmptyArr(l.service_intervals_completed)) merged.service_intervals_completed = l.service_intervals_completed;
      if (isEmptyArr(merged.photos) && !isEmptyArr(l.photos)) merged.photos = l.photos;
      if (merged.gallons == null && l.gallons != null) merged.gallons = l.gallons;
      if (merged.def_gallons == null && l.def_gallons != null) merged.def_gallons = l.def_gallons;
      if (!merged.comments && l.comments) merged.comments = l.comments;
      if (!merged.fuel_type && l.fuel_type) merged.fuel_type = l.fuel_type;
    }
    mergePlans.push({winner, losers, merged, key});
  }

  console.log(`\n${mergePlans.length} duplicate group(s) found (${totalDupes} rows).`);
  const bySlug = new Map();
  for (const p of mergePlans) {
    const s = slugById.get(p.winner.equipment_id) || '(unknown)';
    const c = bySlug.get(s) || {groups:0, loserRows:0}; c.groups++; c.loserRows += p.losers.length; bySlug.set(s, c);
  }
  for (const [slug, c] of [...bySlug.entries()].sort((a,b)=>b[1].groups-a[1].groups)) {
    console.log(`  ${slug.padEnd(20)} ${c.groups} group(s) · ${c.loserRows} row(s) to delete`);
  }

  if (mergePlans.length === 0) { console.log('\nNo dedup needed.'); return; }

  // Sample one group for preview
  const sample = mergePlans[0];
  console.log('\nSample group (' + (slugById.get(sample.winner.equipment_id) || '?') + '):');
  console.log('  key:', sample.key);
  for (const r of [sample.winner, ...sample.losers]) {
    console.log(`    ${r === sample.winner ? '★ KEEP ' : '  drop '} id=${r.id.slice(0,28).padEnd(28)} src=${(r.podio_source_app||'').padEnd(35)} gal=${r.gallons==null?'—':r.gallons} ticks=${(r.every_fillup_check||[]).length} svc=${(r.service_intervals_completed||[]).length} photos=${(r.photos||[]).length}`);
  }
  console.log('  → merged: gallons='+sample.merged.gallons+' ticks='+(sample.merged.every_fillup_check||[]).length+' svc='+(sample.merged.service_intervals_completed||[]).length+' photos='+(sample.merged.photos||[]).length);

  if (!COMMIT) {
    console.log('\nPreview only — rerun with --commit to apply.');
    return;
  }

  console.log('\nApplying...');
  let mergesDone = 0, deletesDone = 0, errs = 0;
  for (const p of mergePlans) {
    const {error: uErr} = await sb.from('equipment_fuelings').update(p.merged).eq('id', p.winner.id);
    if (uErr) { console.error('  ✗ merge into', p.winner.id, ':', uErr.message); errs++; continue; }
    mergesDone++;
    for (const l of p.losers) {
      const {error: dErr} = await sb.from('equipment_fuelings').delete().eq('id', l.id);
      if (dErr) { console.error('  ✗ delete', l.id, ':', dErr.message); errs++; continue; }
      deletesDone++;
    }
    if (mergesDone % 50 === 0) process.stdout.write(`\r  ${mergesDone}/${mergePlans.length} groups`);
  }
  console.log(`\n✓ merged ${mergesDone} winners, deleted ${deletesDone} losers${errs ? ', ' + errs + ' errors' : ''}.`);
})().catch(e => { console.error(e); process.exit(1); });
