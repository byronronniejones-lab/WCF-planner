// scripts/inspect_equipment_state.cjs
//
// Read-only: shows how the DB state lines up for each piece of equipment.
// Prints service_intervals (from the re-seed), the most-recent full and
// partial completions per interval, and flags completions whose stored
// total_tasks doesn't match the re-seeded task count (stale).

const fs = require('fs');
const path = require('path');

function loadEnv() {
  const p = path.join(__dirname, '.env');
  if (!fs.existsSync(p)) return;
  for (const line of fs.readFileSync(p, 'utf8').split(/\r?\n/)) {
    const m = /^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*?)\s*$/.exec(line);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
}
loadEnv();

async function main() {
  const {createClient} = require('@supabase/supabase-js');
  const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: {persistSession: false},
  });

  const {data: eqs} = await sb
    .from('equipment')
    .select(
      'id,slug,name,current_hours,current_km,tracking_unit,service_intervals,every_fillup_items,every_fillup_help,fuel_gallons_help,operator_notes',
    )
    .order('slug');
  for (const eq of eqs) {
    const ivs = eq.service_intervals || [];
    const reading = eq.tracking_unit === 'km' ? eq.current_km : eq.current_hours;
    console.log('\n=== ' + eq.slug + '  (' + eq.name + ')  ' + (reading || '?') + ' ' + eq.tracking_unit);
    console.log(
      '   intervals: ' +
        ivs
          .map((i) => `${i.hours_or_km}${i.kind[0]}(${(i.tasks || []).length}t${i.help_text ? ',help' : ''})`)
          .join(', '),
    );
    console.log(
      '   fillup: ' + (eq.every_fillup_items || []).length + ' items' + (eq.every_fillup_help ? ' (has help)' : ''),
    );
    if (eq.fuel_gallons_help) console.log('   gallons-help: ' + eq.fuel_gallons_help.slice(0, 80));
    if (eq.operator_notes) console.log('   operator-notes: ' + eq.operator_notes.slice(0, 80).replace(/\n/g, ' '));

    // Pull the last few fueling rows with completions to check for stale total_tasks.
    const {data: fuelings} = await sb
      .from('equipment_fuelings')
      .select('date,hours_reading,km_reading,service_intervals_completed')
      .eq('equipment_id', eq.id)
      .not('service_intervals_completed', 'is', null)
      .order('date', {ascending: false})
      .limit(200);
    const staleByIvl = new Map();
    let staleCount = 0;
    for (const r of fuelings || []) {
      for (const c of r.service_intervals_completed || []) {
        const iv = ivs.find((x) => x.hours_or_km === c.interval && x.kind === c.kind);
        const currTotal = iv ? (iv.tasks || []).length : null;
        if (currTotal != null && c.total_tasks != null && currTotal !== c.total_tasks) {
          staleCount++;
          const k = c.kind + ':' + c.interval;
          if (!staleByIvl.has(k)) staleByIvl.set(k, {storedTotal: c.total_tasks, currTotal, count: 0});
          staleByIvl.get(k).count++;
        }
        if (iv == null && c.interval) {
          // Completion references an interval no longer in service_intervals.
          const k2 = 'DROPPED:' + c.kind + ':' + c.interval;
          if (!staleByIvl.has(k2)) staleByIvl.set(k2, {storedTotal: c.total_tasks, currTotal: null, count: 0});
          staleByIvl.get(k2).count++;
        }
      }
    }
    if (staleCount === 0 && staleByIvl.size === 0) continue;
    for (const [k, v] of staleByIvl.entries()) {
      console.log(
        '   STALE  ' +
          k +
          ' — stored total_tasks=' +
          v.storedTotal +
          ' vs current=' +
          (v.currTotal ?? '(interval DROPPED)') +
          '  across ' +
          v.count +
          ' rows',
      );
    }
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
