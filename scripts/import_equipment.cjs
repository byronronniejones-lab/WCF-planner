// scripts/import_equipment.cjs
//
// Equipment module data import: reads scripts/podio_equipment_dump/ and loads
// Supabase with three tables' worth of data:
//   * equipment                    (20 rows, from "Equipment Maintenance" app)
//   * equipment_fuelings           (Fuel Log app + 15 checklist apps, deduped)
//
// Maintenance events + photos are NOT imported here — they'll be backfilled
// by a follow-up pull_podio_equipment_photos.cjs when Ronnie runs a fresh
// Podio pull with the file endpoint included.
//
// Usage:
//   node scripts/import_equipment.cjs            # preview only, writes nothing
//   node scripts/import_equipment.cjs --commit   # applies to Supabase
//
// Requires scripts/.env with SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY.
// Idempotent: deterministic IDs (`eq-<slug>` / `fuel-<podio_item_id>`).
//
// REQUIRES migration 016_equipment_module.sql applied first.

const fs = require('fs');
const path = require('path');

const DUMP_DIR = path.join(__dirname, 'podio_equipment_dump');
const COMMIT = process.argv.includes('--commit');

// ───── env ───────────────────────────────────────────────────────────────────
function loadEnv() {
  const p = path.join(__dirname, '.env');
  if (!fs.existsSync(p)) return;
  for (const line of fs.readFileSync(p, 'utf8').split(/\r?\n/)) {
    const m = /^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*?)\s*$/.exec(line);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
}
loadEnv();

const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_KEY  = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (COMMIT && (!SUPABASE_URL || !SERVICE_KEY)) {
  console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in scripts/.env');
  process.exit(1);
}

let sb = null;
if (COMMIT) {
  const {createClient} = require('@supabase/supabase-js');
  sb = createClient(SUPABASE_URL, SERVICE_KEY, {auth:{persistSession:false}});
}

// ───── equipment app_id → slug / category / tracking_unit / parent ──────────
// Maps each Podio per-equipment checklist app to the target equipment row.
// slug is what the URL uses (/equipment/<slug>, /fueling/<slug>); category
// drives the public hub clusters; tracking_unit flags Hijets as km-based.
// Per-piece hardcoded: fuel_type (diesel|gasoline|null) and takes_def (bool).
// Ronnie's call 2026-04-23:
//   Gas (no DEF): Hijets, Honda ATVs, Toro, Ventrac
//   Diesel no DEF: 5065, Gehl, L328, Mini Ex
//   Diesel + DEF: C362, PS100, Gyro-Trac, JD Gator, JD 317, JD 333,
//                 Kubota RTV, Polaris Ranger
//   No fuel at all: Great Plains Drill (implement)
const EQUIPMENT_DEFS = [
  // TRACTORS
  {slug:'5065',       category:'tractors',  tracking_unit:'hours', fuel_type:'diesel',   takes_def:false, checklist_app:29677781, match_name:/5065/i},
  {slug:'ps100',      category:'tractors',  tracking_unit:'hours', fuel_type:'diesel',   takes_def:true,  checklist_app:29670699, match_name:/powerstar/i},
  {slug:'great-plains-drill', category:'tractors', tracking_unit:'hours', fuel_type:null, takes_def:false, checklist_app:null, match_name:/great\s*plains|no.?till\s*drill/i},
  // ATVs (Honda Foreman Rubicons).
  {slug:'honda-atv-1',category:'atvs',      tracking_unit:'hours', fuel_type:'gasoline', takes_def:false, checklist_app:29711361, match_name:/#\s*1[\s-]+honda/i},
  {slug:'honda-atv-2',category:'atvs',      tracking_unit:'hours', fuel_type:'gasoline', takes_def:false, checklist_app:29855781, match_name:/#\s*2[\s-]+honda/i},
  {slug:'honda-atv-3',category:'atvs',      tracking_unit:'hours', fuel_type:'gasoline', takes_def:false, checklist_app:30126620, match_name:/#\s*3[\s-]+honda/i},
  {slug:'honda-atv-4',category:'atvs',      tracking_unit:'hours', fuel_type:'gasoline', takes_def:false, checklist_app:30126621, match_name:/#\s*4[\s-]+honda/i},
  // HIJETS + other UTVs
  {slug:'hijet-2018', category:'hijets',    tracking_unit:'km',    fuel_type:'gasoline', takes_def:false, checklist_app:30104109, match_name:/2018.*hijet/i},
  {slug:'hijet-2020', category:'hijets',    tracking_unit:'km',    fuel_type:'gasoline', takes_def:false, checklist_app:30123211, match_name:/2020.*hijet/i},
  {slug:'jd-gator',   category:'hijets',    tracking_unit:'hours', fuel_type:'diesel',   takes_def:true,  checklist_app:null,     match_name:/gator\s*xuv|john\s*deere.*gator/i, archived:true},
  {slug:'kubota-rtv', category:'hijets',    tracking_unit:'hours', fuel_type:'diesel',   takes_def:true,  checklist_app:null,     match_name:/kubota|rtv-?x/i, archived:true},
  // MOWERS
  {slug:'toro',       category:'mowers',    tracking_unit:'hours', fuel_type:'gasoline', takes_def:false, checklist_app:29786608, match_name:/toro/i},
  {slug:'ventrac',    category:'mowers',    tracking_unit:'hours', fuel_type:'gasoline', takes_def:false, checklist_app:30089562, match_name:/ventrac/i},
  // SKIDSTEERS (+ compact loaders)
  {slug:'gehl',       category:'skidsteers',tracking_unit:'hours', fuel_type:'diesel',   takes_def:false, checklist_app:30134561, match_name:/gehl/i},
  {slug:'l328',       category:'skidsteers',tracking_unit:'hours', fuel_type:'diesel',   takes_def:false, checklist_app:30473316, match_name:/l\s*328|new\s*holland\s*l328/i},
  {slug:'jd-317',     category:'skidsteers',tracking_unit:'hours', fuel_type:'diesel',   takes_def:true,  checklist_app:null,     match_name:/john\s*deere\s*317|jd\s*317/i, archived:true},
  {slug:'jd-333',     category:'skidsteers',tracking_unit:'hours', fuel_type:'diesel',   takes_def:true,  checklist_app:null,     match_name:/john\s*deere\s*333|jd\s*333/i, archived:true},
  // FORESTRY
  {slug:'gyro-trac',  category:'forestry',  tracking_unit:'hours', fuel_type:'diesel',   takes_def:true,  checklist_app:29788050, match_name:/gyro/i},
  {slug:'c362',       category:'forestry',  tracking_unit:'hours', fuel_type:'diesel',   takes_def:true,  checklist_app:29673167, match_name:/c362|c\s*362/i},
  {slug:'mini-ex',    category:'forestry',  tracking_unit:'hours', fuel_type:'diesel',   takes_def:false, checklist_app:29673203, match_name:/mini.*ex|bobcat.*mini/i},
];

// Category + slug used when Fuel Log entries reference a category that doesn't
// uniquely resolve to a specific piece (e.g. "JOHN DEERE TRACTOR"). We make a
// best-effort guess; unresolved rows get logged and skipped.
const FUEL_LOG_CATEGORY_MAP = {
  // Tractors
  'JOHN DEERE TRACTOR': '5065',        // Ronnie's historical category; modern fleet has one JD tractor (5065)
  '5065 JOHN DEERE': '5065',
  'POWERSTAR 100': 'ps100',
  'PS 100': 'ps100',
  'NEW HOLLAND TRACTOR': 'ps100',      // generic NH tractor → PS100 (C362 is a compact track loader, logged under its own name)
  // Forestry
  'C362': 'c362',
  'GYRO-TRAC': 'gyro-trac',
  'GYROTRAC': 'gyro-trac',
  'MINI EX': 'mini-ex',
  'MINI-EX': 'mini-ex',
  'BOBCAT MINI EXCAVATOR': 'mini-ex',
  // Mowers
  'TORO ZERO TURN': 'toro',
  'TORO': 'toro',
  'ZERO TURN MOWER': 'toro',           // generic ZT → Toro (we only have one)
  'VENTRAC': 'ventrac',
  // Skidsteers
  'GEHL': 'gehl',
  'GEHL RT165': 'gehl',
  'L328': 'l328',
  'NEW HOLLAND L328': 'l328',
  'JOHN DEERE 317': 'jd-317',
  'JD 317': 'jd-317',
  'JOHN DEERE 333': 'jd-333',
  'JD 333': 'jd-333',
  // UTVs / Hijets / Gator / Kubota / Polaris
  '2018 HIJET': 'hijet-2018',
  '2020 HIJET': 'hijet-2020',
  'HIJET': null,                       // ambiguous 2018 vs 2020 — log + skip
  '#1 HONDA ATV': 'honda-atv-1',
  '#2 HONDA ATV': 'honda-atv-2',
  '#3 HONDA ATV': 'honda-atv-3',
  '#4 HONDA ATV': 'honda-atv-4',
  'HONDA ATV': null,
  'JOHN DEERE DIESEL SXS': 'jd-gator', // 2023 JD Gator XUV865M is diesel
  'JOHN DEERE GAS SXS': 'jd-gator',    // older Gator variant; still mapping to the JD Gator piece
  'JOHN DEERE GATOR': 'jd-gator',
  'KUBOTA RTV': 'kubota-rtv',
  'KUBOTA': 'kubota-rtv',
  'KUBOTA SXS': 'kubota-rtv',
  '317': 'jd-317',                     // older shorthand for JD 317
  '333': 'jd-333',
  'POLARIS RANGER 4 SEATER': 'polaris-ranger',
  'POLARIS RANGER': 'polaris-ranger',
  'POLARIS': 'polaris-ranger',
  // Skip / non-equipment
  'FUEL TRUCK FUEL CELL': null,        // fueling the bulk storage tank, not a specific piece
  'FUEL CELL': null,
  'OTHER': null,                       // unknown; skip rather than pick a random piece
};

// Equipment that shows up in Fuel Log but has no row in the Equipment
// Maintenance Podio app — synthesized here so their fuelings have a target.
// Admin can edit / retire later via the normal Fleet UI.
const SYNTHETIC_EQUIPMENT = [
  {slug:'polaris-ranger', name:'Polaris Ranger 4-Seater', category:'hijets', tracking_unit:'hours', fuel_type:'diesel', takes_def:true, archived:true},
];

// ───── helpers ───────────────────────────────────────────────────────────────
function loadJson(file) {
  const p = path.join(DUMP_DIR, file);
  return JSON.parse(fs.readFileSync(p, 'utf8'));
}
function findField(item, external_id) {
  if (!item.fields) return null;
  return item.fields.find(f => f.external_id === external_id);
}
function fieldTextValue(item, external_id) {
  const f = findField(item, external_id);
  if (!f || !f.values || f.values.length === 0) return null;
  const v = f.values[0];
  if (typeof v.value === 'string') return v.value.trim() || null;
  if (v.value && typeof v.value === 'object' && v.value.text) return v.value.text.trim() || null;
  return null;
}
function fieldNumValue(item, external_id) {
  const t = fieldTextValue(item, external_id);
  if (t == null) return null;
  const n = parseFloat(t);
  return Number.isFinite(n) ? n : null;
}
function fieldDateValue(item, external_id) {
  const f = findField(item, external_id);
  if (!f || !f.values || f.values.length === 0) return null;
  const v = f.values[0];
  if (v.start_date) return v.start_date;
  if (v.start) return String(v.start).slice(0, 10);
  return null;
}
function fieldCategoryValues(item, external_id) {
  const f = findField(item, external_id);
  if (!f || !f.values) return [];
  return f.values.map(v => {
    if (v.value && typeof v.value === 'object' && v.value.text) return v.value.text.trim();
    if (typeof v.value === 'string') return v.value.trim();
    return null;
  }).filter(Boolean);
}
function fieldAppRelations(item, external_id) {
  const f = findField(item, external_id);
  if (!f || !f.values) return [];
  return f.values.map(v => (v.value && v.value.item_id) ? v.value.item_id : null).filter(Boolean);
}
function normFuelType(s) {
  if (!s) return null;
  const u = String(s).toUpperCase().trim();
  if (u.includes('DIESEL')) return 'diesel';
  if (u.includes('GASOLINE') || u === 'GAS') return 'gasoline';
  if (u.includes('DEF')) return 'def';
  return null;
}
function deterministicFuelingId(podioSourceApp, podioItemId) {
  return 'fuel-' + podioSourceApp + '-' + podioItemId;
}
function parseIntervalLabel(label) {
  // Podio checklist categories look like: "100 HOURS", "500 / 600 HOURS",
  // "2000 HOURS", "INITIAL 50 HOURS", "200 KM", "5,000 KM", etc.
  // Returns {kind:'hours'|'km', values:[50,100,...], label:original}
  if (!label) return null;
  const up = label.toUpperCase();
  const kind = up.includes('KM') ? 'km' : 'hours';
  // Extract integers, stripping commas and treating "/ 600" as separate numbers.
  const nums = [];
  for (const m of up.matchAll(/(\d{1,3}(?:,\d{3})+|\d+)/g)) {
    const n = parseInt(m[1].replace(/,/g, ''), 10);
    if (Number.isFinite(n) && n > 0) nums.push(n);
  }
  if (nums.length === 0) return null;
  return {kind, values: nums, label: label.trim()};
}

// ───── build equipment rows ──────────────────────────────────────────────────
function buildEquipmentRows() {
  const items = loadJson('29670695.equipment-maintenance.items.json');
  const rows = [];
  const unmatched = [];

  for (const item of items) {
    const name = fieldTextValue(item, 'title');
    if (!name) continue;

    // Match this item to one of our EQUIPMENT_DEFS by name regex.
    const defMatch = EQUIPMENT_DEFS.find(d => d.match_name.test(name));
    if (!defMatch) {
      unmatched.push({podio_item_id: item.item_id, name});
      continue;
    }

    const currentUnits = fieldNumValue(item, 'current-hours');
    const row = {
      id: 'eq-' + defMatch.slug,
      podio_item_id: item.item_id,
      name: name,
      slug: defMatch.slug,
      category: defMatch.category,
      parent_equipment_id: null,
      status: defMatch.archived ? 'retired' : 'active',
      serial_number: fieldTextValue(item, 'serial-number'),
      fuel_type: defMatch.fuel_type || null,
      takes_def: !!defMatch.takes_def,
      fuel_tank_gal: fieldNumValue(item, 'fuel-tank-capacity-in-gallons'),
      def_tank_gal: fieldNumValue(item, 'def-tank-capacity-in-gallons'),
      tracking_unit: defMatch.tracking_unit,
      current_hours: defMatch.tracking_unit === 'hours' ? currentUnits : null,
      current_km:    defMatch.tracking_unit === 'km'    ? currentUnits : null,
      engine_oil: fieldTextValue(item, 'engine-oil'),
      oil_filter: fieldTextValue(item, 'oil-filter'),
      hydraulic_oil: fieldTextValue(item, 'hydraulic-oil'),
      hydraulic_filter: fieldTextValue(item, 'hydraulic-filter'),
      coolant: fieldTextValue(item, 'coolant'),
      brake_fluid: fieldTextValue(item, 'brake-fluid'),
      fuel_filter: fieldTextValue(item, 'fuel-filter'),
      def_filter: fieldTextValue(item, 'def-filter'),
      gearbox_drive_oil: fieldTextValue(item, 'gearbox-drive-oil'),
      air_filters: fieldTextValue(item, 'cabin-air-filters'),
      warranty_description: fieldTextValue(item, 'warranty-description'),
      warranty_expiration: fieldDateValue(item, 'warranty-expirtion'),
      service_intervals: [],        // seeded below from checklist-app field options
      every_fillup_items: [],       // seeded below
      notes: null,
    };
    rows.push(row);
  }

  // Synthesize equipment that only shows up in Fuel Log (Polaris, etc.).
  for (const syn of SYNTHETIC_EQUIPMENT) {
    if (rows.some(r => r.slug === syn.slug)) continue;
    rows.push({
      id: 'eq-' + syn.slug,
      podio_item_id: null,
      name: syn.name,
      slug: syn.slug,
      category: syn.category,
      parent_equipment_id: null,
      status: syn.archived ? 'retired' : 'active',
      serial_number: null,
      fuel_type: syn.fuel_type || null,
      takes_def: !!syn.takes_def,
      fuel_tank_gal: null,
      def_tank_gal: null,
      tracking_unit: syn.tracking_unit,
      current_hours: null,
      current_km: null,
      engine_oil: null, oil_filter: null, hydraulic_oil: null, hydraulic_filter: null,
      coolant: null, brake_fluid: null, fuel_filter: null, def_filter: null,
      gearbox_drive_oil: null, air_filters: null,
      warranty_description: null, warranty_expiration: null,
      service_intervals: [],
      every_fillup_items: [],
      notes: 'Synthesized from Fuel Log references (not in Podio Equipment Maintenance).',
    });
  }

  return {rows, unmatched};
}

// ───── seed service_intervals + every_fillup_items per equipment ────────────
function seedIntervalsForEquipment(eqRows) {
  // Load each checklist app's config and extract the category options that
  // represent service-interval checkpoints. The generic
  // 'every-fuel-fill-up-checklist' field holds every-fillup items.
  for (const def of EQUIPMENT_DEFS) {
    const eq = eqRows.find(r => r.slug === def.slug);
    if (!eq) continue;
    const configFile = `${def.checklist_app}.${checklistSlug(def.checklist_app)}.config.json`;
    const configPath = path.join(DUMP_DIR, configFile);
    if (!fs.existsSync(configPath)) continue;
    const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));

    const fillup = (config.fields || []).find(f =>
      f.external_id === 'every-fuel-fill-up-checklist' ||
      f.external_id === 'every-fuel-fillup-checklist' ||
      /every.*fillup|every.*fill.*up/i.test(f.label || '')
    );
    if (fillup && fillup.config && fillup.config.settings && Array.isArray(fillup.config.settings.options)) {
      eq.every_fillup_items = fillup.config.settings.options.map(o => ({
        id: o.text ? o.text.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) : String(o.id),
        label: o.text || '',
      })).filter(x => x.label);
    }

    // Each category field on the checklist app represents ONE service
    // interval. Its LABEL ("Every 100 hours checklist") carries the number;
    // its options are just the tasks to perform at that interval.
    // DON'T parse option texts — they're full of incidental numbers like
    // torque values and tire pressures that aren't intervals.
    const intervals = [];
    for (const f of (config.fields || [])) {
      if (f.type !== 'category') continue;
      if (f.external_id === 'every-fuel-fill-up-checklist') continue;
      const lbl = f.label || '';
      if (!/hour|km|first\s*\d|initial\s*\d/i.test(lbl)) continue;
      const parsed = parseIntervalLabel(lbl);
      if (!parsed) continue;
      for (const v of parsed.values) {
        intervals.push({hours_or_km: v, kind: parsed.kind, label: lbl.trim()});
      }
    }
    // Dedup by hours_or_km + kind. Sort ascending.
    const seen = new Set();
    eq.service_intervals = intervals
      .filter(iv => {
        const k = iv.kind + ':' + iv.hours_or_km;
        if (seen.has(k)) return false;
        seen.add(k);
        return true;
      })
      .sort((a, b) => a.hours_or_km - b.hours_or_km);
  }
}

function checklistSlug(appId) {
  // Find the slug used in the dump filename from EQUIPMENT_DEFS.
  const entries = fs.readdirSync(DUMP_DIR);
  const hit = entries.find(e => e.startsWith(`${appId}.`) && e.endsWith('.config.json'));
  if (!hit) return '';
  return hit.slice((String(appId) + '.').length, -('.config.json'.length));
}

// ───── build fueling rows (Fuel Log + 15 checklist apps, deduped) ──────────
function buildFuelingRows(eqRows, unresolvedLog) {
  const rows = [];
  const podioIdToSlug = new Map();

  // 1. Fuel Log app → one row per item
  const fuelLog = loadJson('29645966.fuel-log.items.json');
  for (const item of fuelLog) {
    const fuelCategory = fieldCategoryValues(item, 'type-of-fuel')[0]
                       || fieldTextValue(item, 'type-of-fuel');
    const eqCategory = fieldCategoryValues(item, 'equipment-being-fueled')[0]
                     || fieldTextValue(item, 'equipment-being-fueled');
    const slug = eqCategory ? FUEL_LOG_CATEGORY_MAP[eqCategory.toUpperCase()] : null;
    if (!slug) {
      unresolvedLog.push({podio_item_id: item.item_id, eqCategory, reason:'no equipment mapping'});
      continue;
    }
    const eq = eqRows.find(r => r.slug === slug);
    if (!eq) { unresolvedLog.push({podio_item_id: item.item_id, eqCategory, reason:'equipment not in registry'}); continue; }

    const dateRaw = fieldDateValue(item, 'date') || (item.created_on ? item.created_on.slice(0, 10) : null);
    if (!dateRaw) continue;

    const gallons = fieldNumValue(item, 'gallons');
    const reading = fieldNumValue(item, 'mileage-hours');
    rows.push({
      id: deterministicFuelingId('fuel_log', item.item_id),
      podio_item_id: item.item_id,
      podio_source_app: 'fuel_log',
      equipment_id: eq.id,
      date: dateRaw,
      team_member: fieldTextValue(item, 'your-name'),
      fuel_type: normFuelType(fuelCategory),
      gallons: gallons,
      hours_reading: eq.tracking_unit === 'hours' ? reading : null,
      km_reading:    eq.tracking_unit === 'km'    ? reading : null,
      every_fillup_check: [],
      service_intervals_completed: [],
      comments: fieldTextValue(item, 'comments'),
      source: 'podio_import',
      fuel_cost_per_gal: null,
    });
    podioIdToSlug.set(item.item_id, slug);
  }

  // 2. 15 checklist apps → one row per item, merged with Fuel Log if same
  //    entry exists (checklist references its Fuel Log row via an app-relation
  //    field). We dedup by prefering the Fuel Log id when the checklist's
  //    related Fuel Log item is in our byPodioId set.
  const logByPodio = new Map(rows.map(r => [r.podio_item_id, r]));

  for (const def of EQUIPMENT_DEFS) {
    const itemsFile = `${def.checklist_app}.${checklistSlug(def.checklist_app)}.items.json`;
    const p = path.join(DUMP_DIR, itemsFile);
    if (!fs.existsSync(p)) continue;
    const eq = eqRows.find(r => r.slug === def.slug);
    if (!eq) continue;
    const items = JSON.parse(fs.readFileSync(p, 'utf8'));

    for (const item of items) {
      const relatedLogIds = fieldAppRelations(item, 'fuel-log-app').concat(
                              fieldAppRelations(item, 'fuel-log'));
      // Build the per-fillup check list
      const fillupTicks = fieldCategoryValues(item, 'every-fuel-fill-up-checklist').map(v => ({
        id: v.toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'').slice(0,40),
        label: v, ok: true,
      }));
      // Build service_intervals_completed from all category fields with HOUR/KM
      // in their label that have any ticked value on this item.
      const completions = [];
      if (item.fields) {
        for (const f of item.fields) {
          if (f.type !== 'category') continue;
          const lblU = (f.label || '').toUpperCase();
          if (!/HOUR|KM|FIRST\s*\d|INITIAL\s*\d/.test(lblU)) continue;
          if (f.external_id === 'every-fuel-fill-up-checklist') continue;
          const ticked = (f.values || []).map(v => (v.value && v.value.text) || null).filter(Boolean);
          for (const lb of ticked) {
            const parsed = parseIntervalLabel(lb);
            if (!parsed) continue;
            for (const val of parsed.values) {
              completions.push({interval: val, kind: parsed.kind, label: lb, completed_at: fieldDateValue(item, 'date') || (item.created_on ? item.created_on.slice(0,10) : null)});
            }
          }
        }
      }

      const dateRaw = fieldDateValue(item, 'date') || (item.created_on ? item.created_on.slice(0,10) : null);
      const relatedLogRow = relatedLogIds.map(id => logByPodio.get(id)).find(Boolean);

      if (relatedLogRow) {
        // Merge into existing Fuel Log row
        relatedLogRow.every_fillup_check = fillupTicks;
        relatedLogRow.service_intervals_completed = completions;
        relatedLogRow.podio_source_app = 'fuel_log+checklist_' + def.slug.replace(/-/g,'_');
      } else {
        // No matching Fuel Log row — this checklist is standalone.
        if (!dateRaw) continue;
        const hoursKm = fieldNumValue(item, 'hours') || fieldNumValue(item, 'km');
        const gallons = fieldNumValue(item, 'gallons');
        rows.push({
          id: deterministicFuelingId('checklist_' + def.slug.replace(/-/g,'_'), item.item_id),
          podio_item_id: item.item_id,
          podio_source_app: 'checklist_' + def.slug.replace(/-/g,'_'),
          equipment_id: eq.id,
          date: dateRaw,
          team_member: fieldTextValue(item, 'team-member'),
          fuel_type: null,
          gallons: gallons,
          fuel_cost_per_gal: null,
          hours_reading: eq.tracking_unit === 'hours' ? hoursKm : null,
          km_reading:    eq.tracking_unit === 'km'    ? hoursKm : null,
          every_fillup_check: fillupTicks,
          service_intervals_completed: completions,
          comments: fieldTextValue(item, 'issues-comments'),
          source: 'podio_import',
        });
      }
    }
  }

  return rows;
}

// ───── infer fuel_type on equipment rows from associated fuelings ───────────
function inferFuelTypes(eqRows, fuelingRows) {
  const counts = new Map(); // eq.id → {diesel:n, gasoline:n, def:n}
  for (const r of fuelingRows) {
    if (!r.fuel_type) continue;
    const m = counts.get(r.equipment_id) || {};
    m[r.fuel_type] = (m[r.fuel_type] || 0) + 1;
    counts.set(r.equipment_id, m);
  }
  for (const eq of eqRows) {
    const m = counts.get(eq.id);
    if (!m) continue;
    let best = null, bestN = 0;
    for (const [ft, n] of Object.entries(m)) if (n > bestN) { best = ft; bestN = n; }
    if (best) eq.fuel_type = best;
  }
}

// ───── derive latest hours/km on equipment from fuelings ────────────────────
function deriveCurrentReading(eqRows, fuelingRows) {
  const byEq = new Map();
  for (const r of fuelingRows) {
    if (!r.equipment_id) continue;
    const existing = byEq.get(r.equipment_id);
    if (!existing || (r.date || '') > (existing.date || '')) byEq.set(r.equipment_id, r);
  }
  for (const eq of eqRows) {
    const latest = byEq.get(eq.id);
    if (!latest) continue;
    if (eq.tracking_unit === 'hours' && latest.hours_reading != null) eq.current_hours = latest.hours_reading;
    if (eq.tracking_unit === 'km'    && latest.km_reading    != null) eq.current_km    = latest.km_reading;
  }
}

// ───── main ─────────────────────────────────────────────────────────────────
(async () => {
  console.log('=== Equipment import ===');
  console.log('Mode:', COMMIT ? 'COMMIT — will write to Supabase' : 'PREVIEW — no writes');
  console.log('Dump dir:', DUMP_DIR);

  const {rows: eqRows, unmatched} = buildEquipmentRows();
  console.log(`\n[1/4] Built ${eqRows.length} equipment rows; ${unmatched.length} unmatched:`);
  unmatched.forEach(u => console.log('  ✗', u.podio_item_id, u.name));

  seedIntervalsForEquipment(eqRows);
  console.log('[2/4] Seeded service_intervals + every_fillup_items from checklist app configs');
  eqRows.forEach(eq => {
    const iv = (eq.service_intervals || []).map(i => i.hours_or_km+i.kind.charAt(0)).join(', ');
    console.log(`  • ${eq.slug.padEnd(16)} intervals=[${iv}] fillup=${(eq.every_fillup_items||[]).length}`);
  });

  const unresolvedLog = [];
  const fuelingRows = buildFuelingRows(eqRows, unresolvedLog);
  console.log(`\n[3/4] Built ${fuelingRows.length} fueling rows; ${unresolvedLog.length} unresolved Fuel Log entries:`);
  unresolvedLog.slice(0, 20).forEach(u => console.log('  ✗', u.podio_item_id, u.eqCategory, '-', u.reason));

  inferFuelTypes(eqRows, fuelingRows);
  deriveCurrentReading(eqRows, fuelingRows);

  // Summary
  const bySlug = new Map();
  fuelingRows.forEach(r => {
    const eq = eqRows.find(e => e.id === r.equipment_id);
    const slug = eq ? eq.slug : '?';
    bySlug.set(slug, (bySlug.get(slug) || 0) + 1);
  });
  console.log('\n[4/4] Fueling rows by equipment:');
  for (const eq of eqRows) {
    console.log(`  • ${eq.slug.padEnd(16)} ${eq.fuel_type||'?'.padEnd(9)} ${eq.tracking_unit==='hours'?(eq.current_hours||'?')+'h':(eq.current_km||'?')+'km'}  ${(bySlug.get(eq.slug)||0)} fuelings`);
  }

  if (!COMMIT) {
    console.log('\nPreview only. Rerun with --commit to write.');
    return;
  }

  console.log('\n── Writing to Supabase ──');
  // Upsert equipment by id
  {
    const {error} = await sb.from('equipment').upsert(eqRows, {onConflict:'id'});
    if (error) { console.error('Equipment upsert failed:', error); process.exit(1); }
    console.log(`✓ ${eqRows.length} equipment rows upserted`);
  }
  // Batch-insert fuelings in chunks of 500
  for (let i=0; i<fuelingRows.length; i+=500) {
    const chunk = fuelingRows.slice(i, i+500);
    const {error} = await sb.from('equipment_fuelings').upsert(chunk, {onConflict:'id'});
    if (error) { console.error(`Fueling upsert (chunk ${i}) failed:`, error); process.exit(1); }
    process.stdout.write(`\r  fuelings: ${Math.min(i+500, fuelingRows.length)}/${fuelingRows.length}`);
  }
  console.log(`\n✓ ${fuelingRows.length} fueling rows upserted`);

  console.log('\n=== Done ===');
})();
