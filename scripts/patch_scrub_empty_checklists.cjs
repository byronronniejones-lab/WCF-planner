// DELETE equipment_fuelings rows that carry ZERO checklist evidence —
// every_fillup_check is empty AND service_intervals_completed is empty.
// These are the "fuel was logged but no checklist done" entries Ronnie
// considers legacy noise in his new workflow (every real fueling includes
// a checklist).
//
// Safer than the earlier podio_source_app='fuel_log' scrub because it
// doesn't rely on the import-time source label (which doesn't reflect
// post-dedup merges). A row counts as "real" if it carries ANY ticked
// items or service completions — keep. If it's naked (no ticks anywhere),
// delete.
//
// Usage:
//   node scripts/patch_scrub_empty_checklists.cjs           # preview
//   node scripts/patch_scrub_empty_checklists.cjs --commit  # DELETE (irreversible)
// Idempotent.

const fs = require('fs');
const path = require('path');

const COMMIT = process.argv.includes('--commit');

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

function isEmpty(x) { return !Array.isArray(x) || x.length === 0; }

(async () => {
  const rows = [];
  for (let from = 0; ; from += 1000) {
    const {data, error} = await sb.from('equipment_fuelings')
      .select('id,equipment_id,date,gallons,team_member,every_fillup_check,service_intervals_completed,podio_source_app,comments')
      .range(from, from + 999);
    if (error) { console.error(error); process.exit(1); }
    rows.push(...(data || []));
    if (!data || data.length < 1000) break;
  }

  const {data: eqs} = await sb.from('equipment').select('id,slug');
  const slugById = new Map(eqs.map(e => [e.id, e.slug]));

  const toDelete = rows.filter(r => isEmpty(r.every_fillup_check) && isEmpty(r.service_intervals_completed));
  const totalGal = toDelete.reduce((s, r) => s + (Number(r.gallons) || 0), 0);

  console.log(`Total rows scanned: ${rows.length}`);
  console.log(`Rows with no checklist content (to DELETE): ${toDelete.length} (${Math.round(totalGal).toLocaleString()} gal)`);

  const tally = {};
  for (const r of toDelete) {
    const s = slugById.get(r.equipment_id) || '?';
    tally[s] = tally[s] || {n:0, gal:0};
    tally[s].n++; tally[s].gal += Number(r.gallons) || 0;
  }
  console.log('\nPer piece:');
  for (const [s, t] of Object.entries(tally).sort((a,b)=>b[1].n-a[1].n)) {
    console.log('  '+s.padEnd(18)+String(t.n).padStart(4)+' rows · '+Math.round(t.gal).toLocaleString().padStart(6)+' gal');
  }

  if (toDelete.length === 0) { console.log('\nNothing to delete.'); return; }

  if (!COMMIT) {
    console.log('\nPreview only — rerun with --commit to HARD DELETE. Not reversible.');
    return;
  }

  console.log('\nDeleting...');
  const ids = toDelete.map(r => r.id);
  let done = 0;
  for (let i = 0; i < ids.length; i += 500) {
    const chunk = ids.slice(i, i + 500);
    const {error} = await sb.from('equipment_fuelings').delete().in('id', chunk);
    if (error) { console.error('  ✗ chunk', i, error.message); continue; }
    done += chunk.length;
    process.stdout.write(`\r  ${done}/${ids.length}`);
  }
  console.log(`\n✓ deleted ${done} rows.`);
})().catch(e => { console.error(e); process.exit(1); });
