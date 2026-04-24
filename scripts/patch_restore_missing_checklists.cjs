// Insert the handful of Podio Checklist-app items that don't have a
// corresponding planner row. Happens when two Podio Checklists for the
// same piece/date/team/reading both tried to merge into the same Fuel Log
// row during import — only the last one wins, the other is dropped.
// (E.g., PS100 has two 2025-03-26 TED 380h/16gal Checklists in Podio with
// identical content; the planner ends up with only one.)
//
// Approach: walk each per-equipment Checklist dump. For every item, we
// compute the expected planner-row for the "merged" case (fuel-log item
// id via relation) AND the "standalone" case (deterministic checklist id).
// If NEITHER exists in the planner, insert a standalone row so the item
// is represented exactly once.
//
// Usage:
//   node scripts/patch_restore_missing_checklists.cjs           # preview
//   node scripts/patch_restore_missing_checklists.cjs --commit  # apply
// Idempotent. Writes NEW rows only.

const fs = require('fs');
const path = require('path');

const COMMIT = process.argv.includes('--commit');
const DUMP_DIR = path.join(__dirname, 'podio_equipment_dump');

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

// Must match import_equipment.cjs EQUIPMENT_DEFS.
const CHECKLIST_APPS = {
  '5065':       {app: 29677781, file: '29677781.5065-fueling-checklists.items.json',       tracking:'hours'},
  'ps100':      {app: 29670699, file: '29670699.ps-100-fueling-checklists.items.json',     tracking:'hours'},
  'c362':       {app: 29673167, file: '29673167.c362-fueling-checklists.items.json',       tracking:'hours'},
  'honda-atv-1':{app: 29711361, file: '29711361.1-honda-atv-fueling-checklists.items.json',tracking:'hours'},
  'honda-atv-2':{app: 29855781, file: '29855781.2-honda-atv-fueling-checklists.items.json',tracking:'hours'},
  'honda-atv-3':{app: 30126620, file: '30126620.3-honda-atv-fueling-checklists.items.json',tracking:'hours'},
  'honda-atv-4':{app: 30126621, file: '30126621.4-honda-atv-fueling-checklists.items.json',tracking:'hours'},
  'hijet-2018': {app: 30104109, file: '30104109.2018-hijet-fueling-checklists.items.json', tracking:'km'},
  'hijet-2020': {app: 30123211, file: '30123211.2020-hijet-fueling-checklists.items.json', tracking:'km'},
  'toro':       {app: 29786608, file: '29786608.toro-zero-turn-lawnmower.items.json',      tracking:'hours'},
  'ventrac':    {app: 30089562, file: '30089562.ventrac-fueling-checklists.items.json',    tracking:'hours'},
  'gehl':       {app: 30134561, file: '30134561.gehl-rt165-fueling-checklists.items.json', tracking:'hours'},
  'l328':       {app: 30473316, file: '30473316.l328-fueling-checklists.items.json',       tracking:'hours'},
  'gyro-trac':  {app: 29788050, file: '29788050.gyro-trac-fueling-checklists.items.json',  tracking:'hours'},
  'mini-ex':    {app: 29673203, file: '29673203.mini-ex-fueling-checklists.items.json',    tracking:'hours'},
};

function fieldTextValue(item, external_id) {
  const f = item.fields?.find(x => x.external_id === external_id);
  if (!f) return null;
  const v = f.values?.[0];
  return v?.value?.text || v?.value || null;
}
function fieldDateValue(item, external_id) {
  const f = item.fields?.find(x => x.external_id === external_id);
  const sd = f?.values?.[0]?.start_date;
  return sd ? sd.slice(0,10) : null;
}
function fieldNumValue(item, external_id) {
  const f = item.fields?.find(x => x.external_id === external_id);
  const v = f?.values?.[0]?.value;
  return v != null && v !== '' ? Number(v) : null;
}
function fieldCategoryValues(item, external_id) {
  const f = item.fields?.find(x => x.external_id === external_id);
  if (!f) return [];
  const activeOptionIds = new Set(((f.config?.settings?.options)||[]).filter(o=>o.status!=='deleted').map(o=>o.id));
  return (f.values||[]).filter(v=>v?.value && (activeOptionIds.size===0 || activeOptionIds.has(v.value.id))).map(v=>v.value.text).filter(Boolean);
}
function fieldAppRelations(item, external_id) {
  const f = item.fields?.find(x => x.external_id === external_id);
  if (!f) return [];
  return (f.values||[]).map(v => v.value?.item_id).filter(Boolean);
}
function stripHtml(s) { return s ? String(s).replace(/<[^>]+>/g,' ').replace(/\s+/g,' ').trim() : s; }

function deterministicFuelingId(prefix, itemId) { return `fuel-${prefix}-${itemId}`; }

(async () => {
  const {data: eqs} = await sb.from('equipment').select('id,slug');
  const eqBySlug = new Map(eqs.map(e => [e.slug, e]));

  // Pull planner's full podio_item_id set once.
  const plannerIds = new Set();
  for (let from = 0; ; from += 1000) {
    const {data} = await sb.from('equipment_fuelings').select('podio_item_id,id').not('podio_item_id','is',null).range(from, from+999);
    if (!data || data.length === 0) break;
    for (const r of data) plannerIds.add(String(r.podio_item_id));
    if (data.length < 1000) break;
  }
  console.log(`Planner has ${plannerIds.size} rows with a podio_item_id.`);

  const toInsert = [];
  const tally = {};
  for (const [slug, def] of Object.entries(CHECKLIST_APPS)) {
    const eq = eqBySlug.get(slug);
    if (!eq) continue;
    const fp = path.join(DUMP_DIR, def.file);
    if (!fs.existsSync(fp)) continue;
    const items = JSON.parse(fs.readFileSync(fp,'utf8'));

    for (const item of items) {
      const relatedLogIds = fieldAppRelations(item, 'fuel-log-app').concat(fieldAppRelations(item, 'fuel-log'));
      // Planner represents this Checklist if either:
      //  (a) the related Fuel Log item_id appears as a planner row's podio_item_id (merged), OR
      //  (b) the Checklist's own item_id appears as a planner row's podio_item_id (standalone).
      const representedByLogRow = relatedLogIds.some(id => plannerIds.has(String(id)));
      const representedByStandalone = plannerIds.has(String(item.item_id));
      if (representedByLogRow || representedByStandalone) continue;

      // Build a new standalone row.
      const dateRaw = fieldDateValue(item, 'date') || (item.created_on ? item.created_on.slice(0,10) : null);
      if (!dateRaw) continue;

      const fillupRaw = fieldCategoryValues(item, 'every-fuel-fill-up-checklist');
      const fillupLabels = fillupRaw.length > 0 ? fillupRaw : fieldCategoryValues(item, 'every-fuel-fill-up');
      const fillupTicks = fillupLabels.map(v => ({id: v.toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'').slice(0,40), label: v, ok: true}));

      const completions = [];
      if (item.fields) {
        for (const f of item.fields) {
          if (f.type !== 'category') continue;
          if (f.status === 'deleted') continue;
          if (f.external_id === 'every-fuel-fill-up-checklist' || f.external_id === 'every-fuel-fill-up') continue;
          const lbl = f.label || '';
          if (!/hour|km|first\s*\d|initial\s*\d|every\s+(use|session)/i.test(lbl)) continue;
          const activeOpts = new Set(((f.config?.settings?.options)||[]).filter(o=>o.status!=='deleted').map(o=>o.id));
          const ticked = (f.values||[]).filter(v=>v?.value && (activeOpts.size===0||activeOpts.has(v.value.id))).map(v=>v.value.text).filter(Boolean);
          if (ticked.length === 0) continue;
          const total = ((f.config?.settings?.options)||[]).filter(o=>o.status!=='deleted').length;
          const itemsCompleted = ticked.map(t=>t.toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'').slice(0,50));
          // Simple interval parse
          const upLabel = lbl.toUpperCase();
          const everyUse = /\bEVERY\s+(USE|SESSION)\b/i.test(upLabel);
          let values = [];
          let kind = upLabel.includes('KM') ? 'km' : 'hours';
          if (everyUse) { values = [0]; kind = 'hours'; }
          else {
            const firstEvery = /FIRST\s+(\d+)[^&]*(?:&|AND)\s*EVERY\s+(\d+)/i.exec(upLabel);
            if (firstEvery) values = [Number(firstEvery[2])];
            else { const nums = [...upLabel.matchAll(/(\d{1,3}(?:,\d{3})+|\d+)/g)].map(m=>Number(m[1].replace(/,/g,''))).filter(n=>n>0); values = nums; }
          }
          if (values.length === 0) continue;
          for (const val of values) {
            completions.push({interval: val, kind, label: lbl.trim(), completed_at: dateRaw, items_completed: itemsCompleted, total_tasks: total});
          }
        }
      }

      const hoursKm = fieldNumValue(item, 'hours') || fieldNumValue(item, 'km');
      const gallons = fieldNumValue(item, 'gallons') || fieldNumValue(item, 'gallons-of-diesel') || fieldNumValue(item, 'gallons-of-gasoline');
      const row = {
        id: deterministicFuelingId('checklist_' + slug.replace(/-/g,'_'), item.item_id),
        podio_item_id: item.item_id,
        podio_source_app: 'checklist_' + slug.replace(/-/g,'_'),
        equipment_id: eq.id,
        date: dateRaw,
        team_member: fieldTextValue(item, 'team-member'),
        fuel_type: null,
        gallons: gallons,
        fuel_cost_per_gal: null,
        hours_reading: def.tracking === 'hours' ? hoursKm : null,
        km_reading:    def.tracking === 'km'    ? hoursKm : null,
        every_fillup_check: fillupTicks,
        service_intervals_completed: completions,
        comments: stripHtml(fieldTextValue(item, 'issues-comments')),
        source: 'podio_import',
        def_gallons: null,
      };
      toInsert.push({slug, row, related: relatedLogIds, item_id: item.item_id});
      tally[slug] = (tally[slug]||0) + 1;
    }
  }

  console.log(`\n${toInsert.length} missing Checklist row(s) to insert:`);
  for (const [s, n] of Object.entries(tally).sort((a,b)=>b[1]-a[1])) console.log(`  ${s.padEnd(16)} +${n}`);
  for (const x of toInsert.slice(0, 20)) console.log(`  · ${x.slug.padEnd(16)} date=${x.row.date} team=${x.row.team_member} hrs=${x.row.hours_reading||x.row.km_reading} gal=${x.row.gallons||'—'} podio=${x.item_id} related=${x.related.join(',')}`);

  if (toInsert.length === 0) { console.log('\nNothing to insert.'); return; }
  if (!COMMIT) { console.log('\nPreview only — rerun with --commit to insert.'); return; }

  console.log('\nInserting...');
  const rows = toInsert.map(x => x.row);
  for (let i = 0; i < rows.length; i += 500) {
    const chunk = rows.slice(i, i+500);
    const {error} = await sb.from('equipment_fuelings').upsert(chunk, {onConflict:'id'});
    if (error) { console.error('  ✗ chunk', i, error.message); continue; }
    process.stdout.write(`\r  ${Math.min(i+500, rows.length)}/${rows.length}`);
  }
  console.log(`\n✓ inserted ${rows.length} rows.`);
})().catch(e => { console.error(e); process.exit(1); });
