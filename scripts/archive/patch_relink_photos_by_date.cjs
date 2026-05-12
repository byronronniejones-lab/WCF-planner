// scripts/patch_relink_photos_by_date.cjs
//
// Fixes the photo→fueling link gap caused by the dedup-then-scrub trap.
// When patch_dedup_fueling_pairs.cjs merged Fuel Log + Checklist pairs, the
// winner kept the Fuel Log's podio_item_id. Photos in Podio are attached to
// Checklist items, whose item_ids were dropped during dedup. The original
// upload script (pull_podio_equipment_photos.cjs --upload) matches by
// podio_item_id only, so 147 of 195 photo source items were orphaned.
//
// This script re-walks the photo manifest and matches each entry by
// (equipment_id, date) instead, looking up the date from the Podio dump's
// items.json files. It uploads any photo not yet in storage and APPENDS the
// URL to the matching fueling row's photos array (no overwriting of the 48
// rows already linked).
//
// Dry-run by default. Pass --commit to actually upload + patch.
//
//   node scripts/patch_relink_photos_by_date.cjs           # preview
//   node scripts/patch_relink_photos_by_date.cjs --commit  # apply

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

const COMMIT = process.argv.includes('--commit');
const DUMP_DIR = path.join(__dirname, 'podio_equipment_dump');

// Per-checklist Podio app_slug → equipment.slug. Fuel Log items resolve their
// equipment differently (via the equipment-being-fueled category field).
const APP_SLUG_TO_EQ_SLUG = {
  'ps-100-fueling-checklists': 'ps100',
  'c362-fueling-checklists': 'c362',
  '5065-fueling-checklists': '5065',
  '1-honda-atv-fueling-checklists': 'honda-atv-1',
  '2-honda-atv-fueling-checklists': 'honda-atv-2',
  '3-honda-atv-fueling-checklists': 'honda-atv-3',
  '4-honda-atv-fueling-checklists': 'honda-atv-4',
  '2018-hijet-fueling-checklists': 'hijet-2018',
  '2020-hijet-fueling-checklists': 'hijet-2020',
  'gyro-trac-fueling-checklists': 'gyro-trac',
  'toro-zero-turn-lawnmower': 'toro',
  'ventrac-fueling-checklists': 'ventrac',
  'mini-ex-fueling-checklists': 'mini-ex',
  'gehl-rt165-fueling-checklists': 'gehl',
  'l328-fueling-checklists': 'l328',
};

// Fuel Log's equipment-being-fueled category strings → equipment.slug.
// (Mirrors the FUEL_LOG_CATEGORY_MAP used in import_equipment.cjs; only the
// 15 "real piece of equipment" categories matter here. Cell / can / truck /
// other / etc. don't get fueling rows.)
const FUEL_LOG_EQUIP_CATS = {
  'JOHN DEERE TRACTOR': 'c362',
  'NEW HOLLAND TRACTOR': 'ps100',
  '5065 TRACTOR': '5065',
  'JD 5065 TRACTOR': '5065',
  'POWERSTAR 100': 'ps100',
  POWERSTAR: 'ps100',
  C362: 'c362',
  '#1 HONDA ATV': 'honda-atv-1',
  '#2 HONDA ATV': 'honda-atv-2',
  '#3 HONDA ATV': 'honda-atv-3',
  '#4 HONDA ATV': 'honda-atv-4',
  '2018 HIJET': 'hijet-2018',
  '2020 HIJET': 'hijet-2020',
  'HIJET 2018': 'hijet-2018',
  'HIJET 2020': 'hijet-2020',
  'GYRO TRAC': 'gyro-trac',
  GYROTRAC: 'gyro-trac',
  'GYRO-TRAC': 'gyro-trac',
  TORO: 'toro',
  'TORO ZERO TURN': 'toro',
  VENTRAC: 'ventrac',
  'MINI EX': 'mini-ex',
  'MINI-EX': 'mini-ex',
  'BOBCAT MINI EX': 'mini-ex',
  GEHL: 'gehl',
  'GEHL RT165': 'gehl',
  L328: 'l328',
  'NEW HOLLAND L328': 'l328',
};

function extractDate(field) {
  if (!field || !Array.isArray(field.values) || field.values.length === 0) return null;
  const v = field.values[0];
  // Various Podio shapes — accept any.
  const raw = v.start_date || v.start || v.value || v;
  if (typeof raw === 'string') return raw.slice(0, 10);
  if (raw && typeof raw === 'object' && raw.start_date) return raw.start_date.slice(0, 10);
  return null;
}

function extractCategory(field) {
  if (!field || !Array.isArray(field.values) || field.values.length === 0) return null;
  const v = field.values[0];
  if (typeof v === 'string') return v;
  if (v && v.value && typeof v.value === 'object') return v.value.text || null;
  if (v && v.value && typeof v.value === 'string') return v.value;
  return null;
}

async function main() {
  const {createClient} = require('@supabase/supabase-js');
  const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: {persistSession: false},
  });

  // 1. Load all items.json files in the dump and build itemId → {date, app_slug, equipment_slug?}.
  const itemMeta = new Map(); // item_id → {date, app_slug, equipment_slug}
  const dumpFiles = fs.readdirSync(DUMP_DIR).filter((f) => f.endsWith('.items.json'));
  for (const fn of dumpFiles) {
    const content = JSON.parse(fs.readFileSync(path.join(DUMP_DIR, fn), 'utf8'));
    const items = content.items || content;
    if (!Array.isArray(items)) continue;
    // Filename format: <app_id>.<app-slug>.items.json
    const m = /^\d+\.([\w-]+)\.items\.json$/.exec(fn);
    const appSlug = m ? m[1] : 'unknown';
    for (const it of items) {
      const dateField = (it.fields || []).find((f) => f.external_id === 'date');
      const date = extractDate(dateField);
      let equipmentSlug = APP_SLUG_TO_EQ_SLUG[appSlug] || null;
      if (!equipmentSlug && appSlug === 'fuel-log') {
        const eqField = (it.fields || []).find((f) => f.external_id === 'equipment-being-fueled');
        const cat = extractCategory(eqField);
        if (cat) equipmentSlug = FUEL_LOG_EQUIP_CATS[cat.toUpperCase()] || null;
      }
      itemMeta.set(it.item_id, {date, app_slug: appSlug, equipment_slug: equipmentSlug});
    }
  }
  console.log('Loaded ' + itemMeta.size + ' Podio items from dump (with date+equipment metadata where available).');

  // 2. Build slug → equipment.id lookup.
  const {data: eqRows, error: eqErr} = await sb.from('equipment').select('id,slug,name');
  if (eqErr) {
    console.error(eqErr);
    process.exit(1);
  }
  const eqBySlug = new Map(eqRows.map((e) => [e.slug, e]));

  // 3. Load all fuelings keyed by (equipment_id, date) for matching.
  const {data: fRows, error: fErr} = await sb
    .from('equipment_fuelings')
    .select('id,equipment_id,date,podio_item_id,podio_source_app,photos')
    .order('date', {ascending: false})
    .limit(10000);
  if (fErr) {
    console.error(fErr);
    process.exit(1);
  }
  const fuelByKey = new Map(); // 'eq_id|date' → row (most recent first wins)
  for (const r of fRows) {
    const k = r.equipment_id + '|' + r.date;
    if (!fuelByKey.has(k)) fuelByKey.set(k, r);
  }
  console.log('Loaded ' + fRows.length + ' fueling rows (' + fuelByKey.size + ' unique by equipment+date).');

  // 4. Load + group photo manifest by item_id.
  const manifest = JSON.parse(fs.readFileSync(path.join(DUMP_DIR, '_photos_index.json'), 'utf8'));
  const entries = Array.isArray(manifest.entries || manifest)
    ? manifest.entries || manifest
    : Object.values(manifest.entries || manifest);
  const groupedByItem = new Map(); // item_id → [entries]
  for (const e of entries) {
    if (!e.item_id) continue;
    if (!groupedByItem.has(e.item_id)) groupedByItem.set(e.item_id, []);
    groupedByItem.get(e.item_id).push(e);
  }
  console.log(
    'Photo manifest: ' + entries.length + ' file entries across ' + groupedByItem.size + ' unique Podio items.',
  );

  // 5. Walk each group; resolve target fueling by (equipment, date).
  let resolvedItems = 0;
  let unresolvedItems = 0;
  let alreadyLinkedItems = 0;
  let skippedNoDate = 0;
  let skippedNoEquip = 0;
  let skippedNoFueling = 0;
  let photosUploaded = 0;
  let rowsPatched = 0;

  for (const [itemId, items] of groupedByItem) {
    const meta = itemMeta.get(itemId);
    if (!meta) {
      unresolvedItems++;
      continue;
    }
    if (!meta.date) {
      skippedNoDate++;
      continue;
    }
    if (!meta.equipment_slug) {
      skippedNoEquip++;
      continue;
    }
    const eq = eqBySlug.get(meta.equipment_slug);
    if (!eq) {
      skippedNoEquip++;
      continue;
    }
    const fueling = fuelByKey.get(eq.id + '|' + meta.date);
    if (!fueling) {
      skippedNoFueling++;
      continue;
    }
    resolvedItems++;

    // Skip if photos for these file_ids are already in fueling.photos.
    const existingFileIds = new Set((fueling.photos || []).map((p) => p.podio_file_id).filter(Boolean));
    const newFiles = items.filter((it) => !existingFileIds.has(it.file_id));
    if (newFiles.length === 0) {
      alreadyLinkedItems++;
      continue;
    }

    if (!COMMIT) {
      console.log(
        '  [DRY] ' +
          eq.slug +
          ' @ ' +
          meta.date +
          ' ← ' +
          newFiles.length +
          ' new file' +
          (newFiles.length === 1 ? '' : 's') +
          ' (item ' +
          itemId +
          ', app ' +
          meta.app_slug +
          ')',
      );
      photosUploaded += newFiles.length;
      rowsPatched++;
      continue;
    }

    // Upload each new file (or reuse existing storage path).
    const uploaded = [];
    for (const e of newFiles) {
      const localPath = path.join(__dirname, e.local_path);
      if (!fs.existsSync(localPath)) {
        console.log('  ! missing local file: ' + e.local_path);
        continue;
      }
      const content = fs.readFileSync(localPath);
      const bucketPath = 'fueling/' + eq.slug + '/' + e.file_id + '-' + path.basename(e.local_path);
      const {error: upErr} = await sb.storage.from('equipment-maintenance-docs').upload(bucketPath, content, {
        upsert: false,
        contentType: e.mime_type || 'application/octet-stream',
      });
      if (upErr && !/already exists/i.test(upErr.message || '')) {
        console.log('  ✗ upload ' + bucketPath + ': ' + upErr.message);
        continue;
      }
      const {data: pub} = sb.storage.from('equipment-maintenance-docs').getPublicUrl(bucketPath);
      uploaded.push({
        name: e.name,
        path: bucketPath,
        url: pub.publicUrl,
        uploadedAt: new Date().toISOString(),
        podio_file_id: e.file_id,
      });
      photosUploaded++;
    }
    if (uploaded.length === 0) continue;

    const merged = [...(fueling.photos || []), ...uploaded];
    const {error: patchErr} = await sb.from('equipment_fuelings').update({photos: merged}).eq('id', fueling.id);
    if (patchErr) {
      console.log('  ✗ patch ' + fueling.id + ': ' + patchErr.message);
      continue;
    }
    rowsPatched++;
    fueling.photos = merged; // keep local cache in sync if same fueling appears again
    console.log('  ✓ ' + eq.slug + ' @ ' + meta.date + ' (+' + uploaded.length + ', total ' + merged.length + ')');
  }

  console.log('\n=== SUMMARY ===');
  console.log('Items resolved to a fueling:        ' + resolvedItems);
  console.log('  Already fully linked, no-op:      ' + alreadyLinkedItems);
  console.log('  Patched (this run):               ' + rowsPatched);
  console.log('Photos uploaded (or already-stored):' + photosUploaded);
  console.log('---');
  console.log('Items skipped (no date in dump):    ' + skippedNoDate);
  console.log('Items skipped (no equipment match): ' + skippedNoEquip);
  console.log('Items skipped (no fueling match):   ' + skippedNoFueling);
  console.log('Items not found in dump:            ' + unresolvedItems);
  if (!COMMIT) console.log('\nDry-run only. Re-run with --commit to apply.');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
