// One-off audit for two things at once:
//
// A. Verify Podio-imported rows actually got their checklist ticks + photos
//    migrated. We inspect a known row (2018 Hijet 2026-02-24) that Podio
//    showed as fully-ticked with 4 attached photos.
//
// B. Audit every_fillup_items across all active equipment. Every piece
//    (except ATVs + Toro) must carry a "Check Oil"-style item. Print which
//    do/don't so we can patch.
//
// Read-only. Safe to run anytime.

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

const {createClient} = require('@supabase/supabase-js');
const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: {persistSession: false},
});

(async () => {
  // A) Verify Hijet 2018 entry for 2026-02-24
  console.log('═══ A. 2018 Hijet 2026-02-24 row check ═══');
  const {data: hijet} = await sb.from('equipment').select('id,slug,name').eq('slug', 'hijet-2018').maybeSingle();
  if (!hijet) {
    console.log('  No equipment row with slug=hijet-2018 — check slug map.');
  } else {
    const {data: rows} = await sb
      .from('equipment_fuelings')
      .select(
        'id,date,km_reading,hours_reading,team_member,every_fillup_check,service_intervals_completed,photos,podio_item_id,podio_source_app,comments',
      )
      .eq('equipment_id', hijet.id)
      .eq('date', '2026-02-24');
    if (!rows || rows.length === 0) {
      console.log('  No fueling row on 2026-02-24 for 2018 Hijet.');
    } else {
      for (const r of rows) {
        console.log(`  Row id=${r.id.slice(0, 40)}  podio_item_id=${r.podio_item_id}  source=${r.podio_source_app}`);
        console.log(
          `    team=${r.team_member}  reading=${r.km_reading || r.hours_reading}  comments=${(r.comments || '').slice(0, 60)}`,
        );
        console.log(
          `    every_fillup_check: ${Array.isArray(r.every_fillup_check) ? r.every_fillup_check.length : '(not array)'} items`,
        );
        if (Array.isArray(r.every_fillup_check)) {
          for (const c of r.every_fillup_check) console.log(`      · ${c.label}`);
        }
        console.log(
          `    service_intervals_completed: ${Array.isArray(r.service_intervals_completed) ? r.service_intervals_completed.length : '(not array)'} entries`,
        );
        if (Array.isArray(r.service_intervals_completed)) {
          for (const c of r.service_intervals_completed) {
            console.log(
              `      · ${c.interval}${c.kind.charAt(0)} — ${Array.isArray(c.items_completed) ? c.items_completed.length : 0}/${c.total_tasks || '?'} ticked`,
            );
          }
        }
        console.log(`    photos: ${Array.isArray(r.photos) ? r.photos.length : '(none)'} attached`);
      }
    }
  }

  // Broader: how many rows total have service_intervals_completed populated vs empty?
  console.log('\n═══ A2. Overall tick-import stats ═══');
  const {data: allRows, count} = await sb
    .from('equipment_fuelings')
    .select('id,service_intervals_completed,every_fillup_check,podio_source_app', {count: 'exact'})
    .eq('source', 'podio_import')
    .limit(5000);
  let rowsWithSvc = 0,
    rowsWithFillup = 0;
  const bySource = {};
  for (const r of allRows || []) {
    const hasSvc = Array.isArray(r.service_intervals_completed) && r.service_intervals_completed.length > 0;
    const hasFillup = Array.isArray(r.every_fillup_check) && r.every_fillup_check.length > 0;
    if (hasSvc) rowsWithSvc++;
    if (hasFillup) rowsWithFillup++;
    const src = r.podio_source_app || '(null)';
    if (!bySource[src]) bySource[src] = {total: 0, withFillup: 0, withSvc: 0};
    bySource[src].total++;
    if (hasFillup) bySource[src].withFillup++;
    if (hasSvc) bySource[src].withSvc++;
  }
  console.log(`  Podio-imported rows: ${(allRows || []).length} (total in table: ${count})`);
  console.log(`  With every_fillup_check: ${rowsWithFillup}`);
  console.log(`  With service_intervals_completed: ${rowsWithSvc}`);
  console.log('  By source app:');
  for (const [src, s] of Object.entries(bySource).sort((a, b) => b[1].total - a[1].total)) {
    console.log(
      `    ${src.padEnd(45)}  total=${String(s.total).padStart(4)}  fillup=${String(s.withFillup).padStart(4)}  svc=${String(s.withSvc).padStart(4)}`,
    );
  }

  // B) Audit every_fillup_items for Check Oil across active equipment
  console.log('\n═══ B. every_fillup_items Check Oil audit ═══');
  const {data: eqs} = await sb
    .from('equipment')
    .select('slug,name,category,every_fillup_items')
    .eq('status', 'active')
    .order('category')
    .order('name');
  const missing = [];
  for (const eq of eqs || []) {
    const items = Array.isArray(eq.every_fillup_items) ? eq.every_fillup_items : [];
    const hasCheckOil = items.some((it) => /oil/i.test(it.label || ''));
    const exempt = eq.category === 'atvs' || eq.slug === 'toro';
    const marker = hasCheckOil ? '✓' : exempt ? '·' : '✗';
    const note = exempt && !hasCheckOil ? ' (exempt)' : !hasCheckOil && !exempt ? ' MISSING' : '';
    console.log(
      `  ${marker} ${eq.category.padEnd(10)} ${eq.slug.padEnd(18)} ${eq.name.padEnd(30)} items=${items.length}${note}`,
    );
    if (!hasCheckOil && !exempt) {
      missing.push({slug: eq.slug, name: eq.name, itemsPreview: items.map((i) => i.label).join(' | ')});
    }
  }
  console.log(`\n  Pieces missing Check Oil (non-exempt): ${missing.length}`);
  for (const m of missing) {
    console.log(`    ${m.slug}: current items = [${m.itemsPreview}]`);
  }

  process.exit(0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
