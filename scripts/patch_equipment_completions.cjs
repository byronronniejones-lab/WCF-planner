// scripts/patch_equipment_completions.cjs
//
// Normalize historical equipment_fuelings.service_intervals_completed against
// the current (cleaned-up) equipment.service_intervals:
//
//   1. Drop completion entries whose (kind, interval) no longer exists on the
//      equipment (e.g. hijet 200km, honda 300h — template cruft).
//   2. Rewrite total_tasks to the current count of active tasks.
//   3. Filter items_completed to only IDs that match current task IDs (ticks
//      on now-deleted options become dead weight and mis-skew "7 of 19").
//
// Does NOT delete equipment_fuelings rows — only rewrites the embedded JSONB.
// Reading counts, fuel/DEF gallons, dates, comments, photos all preserved.
//
// Usage:
//   node scripts/patch_equipment_completions.cjs            # preview
//   node scripts/patch_equipment_completions.cjs --commit   # write

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

async function main() {
  const {createClient} = require('@supabase/supabase-js');
  const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {auth:{persistSession:false}});

  const {data: eqs} = await sb.from('equipment').select('id,slug,service_intervals');
  const ivByEq = new Map();
  for (const eq of eqs) {
    const m = new Map(); // key=`${kind}:${interval}` → {taskIds:Set, taskCount}
    for (const iv of (eq.service_intervals || [])) {
      const taskIds = new Set((iv.tasks || []).map(t => t.id));
      m.set(iv.kind + ':' + iv.hours_or_km, {taskIds, taskCount: taskIds.size});
    }
    ivByEq.set(eq.id, m);
  }

  let scanned = 0, rewritten = 0, droppedEntries = 0, clampedTotals = 0, filteredItems = 0;

  // Process in chunks to avoid timeouts.
  const pageSize = 500;
  let from = 0;
  while (true) {
    const {data: rows, error} = await sb.from('equipment_fuelings')
      .select('id, equipment_id, service_intervals_completed')
      .not('service_intervals_completed', 'is', null)
      .order('id')
      .range(from, from + pageSize - 1);
    if (error) { console.error(error); process.exit(1); }
    if (!rows || rows.length === 0) break;

    for (const r of rows) {
      scanned++;
      const ivMap = ivByEq.get(r.equipment_id);
      if (!ivMap) continue;
      const orig = Array.isArray(r.service_intervals_completed) ? r.service_intervals_completed : [];
      const next = [];
      let changed = false;
      for (const c of orig) {
        if (!c || !c.kind || !c.interval) { changed = true; continue; }
        const key = c.kind + ':' + c.interval;
        const iv = ivMap.get(key);
        if (!iv) { droppedEntries++; changed = true; continue; }
        const currentItems = Array.isArray(c.items_completed)
          ? c.items_completed.filter(id => iv.taskIds.has(id))
          : [];
        const didFilter = currentItems.length !== (c.items_completed || []).length;
        const didClamp  = iv.taskCount !== c.total_tasks;
        if (didFilter) filteredItems++;
        if (didClamp)  clampedTotals++;
        if (didFilter || didClamp) changed = true;
        next.push({
          ...c,
          items_completed: currentItems,
          total_tasks: iv.taskCount,
        });
      }
      if (!changed) continue;
      rewritten++;
      if (COMMIT) {
        const {error: upErr} = await sb.from('equipment_fuelings')
          .update({service_intervals_completed: next})
          .eq('id', r.id);
        if (upErr) { console.error('update failed', r.id, upErr.message); }
      }
    }

    from += pageSize;
    if (rows.length < pageSize) break;
  }

  console.log(`Scanned ${scanned} fueling rows`);
  console.log(`  ${rewritten} rows ${COMMIT ? 'rewritten' : 'would be rewritten'}`);
  console.log(`  ${droppedEntries} completion entries dropped (interval no longer exists)`);
  console.log(`  ${clampedTotals} completions had total_tasks clamped to current`);
  console.log(`  ${filteredItems} completions had items_completed filtered against current task IDs`);
  if (!COMMIT) console.log('\n(preview only — re-run with --commit to write)');
}

main().catch(e => { console.error(e); process.exit(1); });
