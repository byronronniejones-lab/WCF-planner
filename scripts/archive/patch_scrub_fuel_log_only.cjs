// HARD-DELETE every equipment_fuelings row that originated purely from the
// Podio Fuel Log app (podio_source_app='fuel_log' — never had a matching
// Checklist-app entry). Ronnie's call 2026-04-24: those "naked" Fuel Log
// entries aren't real fuelings in his workflow. Clean slate going forward.
//
// Does NOT touch merged rows (fuel_log+checklist_*) or checklist-only rows
// — those have Checklist data and stay.
//
// Usage:
//   node scripts/patch_scrub_fuel_log_only.cjs           # preview
//   node scripts/patch_scrub_fuel_log_only.cjs --commit  # DELETE (irreversible)
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
const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: {persistSession: false},
});

(async () => {
  const rows = [];
  for (let from = 0; ; from += 1000) {
    const {data, error} = await sb
      .from('equipment_fuelings')
      .select('id,equipment_id,date,gallons')
      .eq('podio_source_app', 'fuel_log')
      .range(from, from + 999);
    if (error) {
      console.error('Query failed:', error.message);
      process.exit(1);
    }
    rows.push(...(data || []));
    if (!data || data.length < 1000) break;
  }

  const totalGal = rows.reduce((s, r) => s + (Number(r.gallons) || 0), 0);
  console.log(`Rows to DELETE: ${rows.length}`);
  console.log(`Gallons lost:   ${Math.round(totalGal).toLocaleString()}`);

  // Per-equipment breakdown so we can eyeball damage before committing.
  const {data: eqs} = await sb.from('equipment').select('id,slug');
  const bySlug = new Map(eqs.map((e) => [e.id, e.slug]));
  const tally = {};
  for (const r of rows) {
    const s = bySlug.get(r.equipment_id) || '?';
    tally[s] = tally[s] || {n: 0, gal: 0};
    tally[s].n++;
    tally[s].gal += Number(r.gallons) || 0;
  }
  console.log('\nPer piece:');
  for (const [s, t] of Object.entries(tally).sort((a, b) => b[1].n - a[1].n)) {
    console.log(
      '  ' +
        s.padEnd(18) +
        String(t.n).padStart(4) +
        ' rows · ' +
        Math.round(t.gal).toLocaleString().padStart(6) +
        ' gal',
    );
  }

  if (rows.length === 0) {
    console.log('\nNothing to delete.');
    return;
  }

  if (!COMMIT) {
    console.log('\nPreview only — rerun with --commit to HARD DELETE these rows. Not reversible.');
    return;
  }

  console.log('\nDeleting...');
  const ids = rows.map((r) => r.id);
  let done = 0;
  for (let i = 0; i < ids.length; i += 500) {
    const chunk = ids.slice(i, i + 500);
    const {error} = await sb.from('equipment_fuelings').delete().in('id', chunk);
    if (error) {
      console.error('  ✗ chunk', i, error.message);
      continue;
    }
    done += chunk.length;
    process.stdout.write(`\r  ${done}/${ids.length}`);
  }
  console.log(`\n✓ deleted ${done} rows.`);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
