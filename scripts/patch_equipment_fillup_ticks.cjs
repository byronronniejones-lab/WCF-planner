// Backfill equipment_fuelings.every_fillup_check from the Podio dump.
//
// Cause: import_equipment.cjs only matched external_id='every-fuel-fill-up-checklist'
// but some apps (2018 Hijet + others) use 'every-fuel-fill-up' with no suffix,
// so ticks on those apps were silently dropped. This script re-scans every
// checklist app's items.json, extracts fillup ticks, and patches the matching
// equipment_fuelings row in Supabase.
//
// Matching rule: the checklist item either (a) has a 'fuel-log-app' /
// 'fuel-log' relation pointing at a Fuel Log item that landed in the fuelings
// table (podio_item_id = <fuel_log_id>), or (b) is standalone — in which case
// it was imported as its own fueling row with podio_item_id = <checklist_id>.
//
// Usage:
//   node scripts/patch_equipment_fillup_ticks.cjs            # preview
//   node scripts/patch_equipment_fillup_ticks.cjs --commit   # write
//
// Safe to re-run; idempotent.

const fs = require('fs');
const path = require('path');

const DUMP_DIR = path.join(__dirname, 'podio_equipment_dump');
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

function categoryTicks(item, externalIds) {
  if (!item.fields) return [];
  for (const eid of externalIds) {
    const f = item.fields.find(f => f.external_id === eid);
    if (!f || f.status === 'deleted') continue;
    const activeOptionIds = new Set(
      (f.config?.settings?.options || [])
        .filter(o => o.status !== 'deleted')
        .map(o => o.id)
    );
    const labels = (f.values || [])
      .filter(v => v && v.value && (activeOptionIds.size === 0 || activeOptionIds.has(v.value.id)))
      .map(v => (v.value && v.value.text) || null).filter(Boolean);
    if (labels.length > 0) return labels;
  }
  return [];
}

function relationIds(item, externalIds) {
  if (!item.fields) return [];
  const out = [];
  for (const eid of externalIds) {
    const f = item.fields.find(f => f.external_id === eid);
    if (!f) continue;
    for (const v of (f.values || [])) {
      if (v.value && v.value.item_id) out.push(v.value.item_id);
    }
  }
  return out;
}

(async () => {
  // Pre-load current fuelings — need podio_item_id → row-id mapping. Include
  // podio_source_app so we can update the right row when multiple exist.
  console.log('Loading equipment_fuelings from Supabase...');
  const {data: fuelRows} = await sb.from('equipment_fuelings')
    .select('id,podio_item_id,podio_source_app,equipment_id,every_fillup_check')
    .not('podio_item_id', 'is', null)
    .limit(10000);
  const fuelByPodioId = new Map(fuelRows.map(r => [r.podio_item_id, r]));
  console.log(`  ${fuelRows.length} fueling rows have podio_item_id.`);

  // Walk every checklist app (skip Fuel Log + Equipment Maintenance)
  const summary = JSON.parse(fs.readFileSync(path.join(DUMP_DIR, '_summary.json'), 'utf8'));
  const checklistApps = (summary.apps || []).filter(a =>
    a.slug !== 'fuel-log' && a.slug !== 'equipment-maintenance');

  const updates = []; // {id, every_fillup_check}
  let found = 0, matched = 0, emptyTicks = 0;

  for (const app of checklistApps) {
    const p = path.join(DUMP_DIR, `${app.app_id}.${app.slug}.items.json`);
    if (!fs.existsSync(p)) continue;
    const items = JSON.parse(fs.readFileSync(p, 'utf8'));
    let appMatches = 0, appTicks = 0;
    for (const item of items) {
      const labels = categoryTicks(item, ['every-fuel-fill-up-checklist', 'every-fuel-fill-up']);
      if (labels.length === 0) { emptyTicks++; continue; }
      appTicks++;

      const fillupTicks = labels.map(v => ({
        id: v.toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'').slice(0,40),
        label: v, ok: true,
      }));

      // Figure out which fueling row(s) to patch.
      // Prefer the Fuel Log row the checklist is related to; else the
      // standalone checklist row imported under its own podio_item_id.
      const relatedLogIds = relationIds(item, ['fuel-log-app', 'fuel-log']);
      let targetRow = null;
      for (const fid of relatedLogIds) {
        if (fuelByPodioId.has(fid)) { targetRow = fuelByPodioId.get(fid); break; }
      }
      if (!targetRow && fuelByPodioId.has(item.item_id)) {
        targetRow = fuelByPodioId.get(item.item_id);
      }
      if (!targetRow) continue;

      // Skip no-op updates to keep output tidy.
      const existing = Array.isArray(targetRow.every_fillup_check) ? targetRow.every_fillup_check : [];
      const existingIds = existing.map(x => x.id).sort().join('|');
      const nextIds = fillupTicks.map(x => x.id).sort().join('|');
      if (existingIds === nextIds && existing.length === fillupTicks.length) continue;

      updates.push({id: targetRow.id, every_fillup_check: fillupTicks, _ticks: fillupTicks.length});
      appMatches++;
      matched++;
    }
    console.log(`  [${app.name}] items=${items.length}  with-ticks=${appTicks}  patched=${appMatches}`);
    found += appTicks;
  }

  console.log(`\nTotals: ${found} checklist items had fillup ticks, ${matched} will update existing fueling rows (${emptyTicks} items had no ticks).`);

  if (!COMMIT) {
    console.log('\nPreview only — rerun with --commit to apply.');
    return;
  }
  if (updates.length === 0) { console.log('Nothing to update.'); return; }

  console.log(`\nApplying ${updates.length} updates...`);
  let done = 0;
  for (const u of updates) {
    const {error} = await sb.from('equipment_fuelings').update({every_fillup_check: u.every_fillup_check}).eq('id', u.id);
    if (error) { console.error('  ✗', u.id, error.message); continue; }
    done++;
    if (done % 100 === 0) process.stdout.write(`\r  ${done}/${updates.length}`);
  }
  console.log(`\n✓ ${done}/${updates.length} rows updated.`);
})().catch(e => { console.error(e); process.exit(1); });
