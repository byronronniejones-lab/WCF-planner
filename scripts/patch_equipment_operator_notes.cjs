// Populate equipment.operator_notes with the verbatim TOP descriptive text
// from each Podio webform. Pulled via WebFetch 2026-04-24 with a tight
// extraction prompt (after earlier fetches were summarizing).
//
// Usage:
//   node scripts/patch_equipment_operator_notes.cjs           # preview
//   node scripts/patch_equipment_operator_notes.cjs --commit  # apply
//
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

// Verbatim TOP text from the Podio webform for each piece. "Podio" page-
// title prefix stripped. Multi-line content flattened with spaces since the
// webform renders it as flowing paragraph text.
const OPERATOR_NOTES = {
  '5065':       '2016 JOHN DEERE 5065 FUELING CHECKLIST. 18.8 GALLON FUEL TANK.',
  'ps100':      '2023 NEW HOLLAND POWERSTAR 100 FUELING CHECKLIST. 19.8 GALLON FUEL TANK -- 2.8 GALLON DEF TANK.',
  'honda-atv-1':'#1 - 2024 HONDA ATV FUELING CHECKLIST. 3.88 GALLON FUEL TANK. 5 BARS ON FUEL GAUGE. THE FIRST 4 BARS ARE .5 GALLON EACH. WHEN YOU REACH THE LAST BAR YOU HAVE 1.8 GALLONS LEFT OR ALMOST 1/2 TANK. WHEN "LO FUEL" SHOWS ON SCREEN YOU HAVE 1.2 GAL LEFT.',
  'honda-atv-2':'#2 - 2024 HONDA ATV FUELING CHECKLIST. 3.88 GALLON FUEL TANK. 5 BARS ON FUEL GAUGE. THE FIRST 4 BARS ARE .5 GALLON EACH. WHEN YOU REACH THE LAST BAR YOU HAVE 1.8 GALLONS LEFT OR ALMOST 1/2 TANK. WHEN "LO FUEL" SHOWS ON SCREEN YOU HAVE 1.2 GAL LEFT.',
  'honda-atv-3':'#3 - 2024 HONDA ATV FUELING CHECKLIST. 3.88 GALLON FUEL TANK. 5 BARS ON FUEL GAUGE. THE FIRST 4 BARS ARE .5 GALLON EACH. WHEN YOU REACH THE LAST BAR YOU HAVE 1.8 GALLONS LEFT OR ALMOST 1/2 TANK. WHEN "LO FUEL" SHOWS ON SCREEN YOU HAVE 1.2 GAL LEFT.',
  'honda-atv-4':'#4 - 2024 HONDA ATV FUELING CHECKLIST. 3.88 GALLON FUEL TANK. 5 BARS ON FUEL GAUGE. THE FIRST 4 BARS ARE .5 GALLON EACH. WHEN YOU REACH THE LAST BAR YOU HAVE 1.8 GALLONS LEFT OR ALMOST 1/2 TANK. WHEN "LO FUEL" SHOWS ON SCREEN YOU HAVE 1.2 GAL LEFT.',
  'hijet-2018': 'White 2018 Hijet Fueling Checklist. Engine oil - 3.6 Qts of 5w 30. Fuel Tank - 9 Gal.',
  'hijet-2020': 'Gray 2020 Hijet Fueling Checklist. Engine oil - 3.6 Qts of 5w 30. Fuel Tank - 9 Gal.',
  'toro':       '2022 TORO TITAN MAX MOWER. 2 QT ENGINE OIL CAPACITY.',
  'ventrac':    '2024 VENTRAC 4520N FUELING CHECKLIST. 6 GALLON FUEL TANK -- 3.6 QT ENGINE OIL -- 7 QUARTS COOLANT.',
  'gehl':       '2024 GEHL RT165 FUELING CHECKLIST.',
  'l328':       '2025 NEW HOLLAND L328 FUELING CHECKLIST. 25.5 GALLON FUEL TANK -- 9 QT ENGINE OIL.',
  'gyro-trac':  '2022 GYRO-TRAC GT16XPSV FUELING CHECKLIST. 62 GAL FUEL TANK -- 10 GAL DEF TANK -- 5.5 GAL COOLANT: 60/40 OR 3 GAL TO 2.5 GAL ETHYLENE GLYCOL TO WATER. NOTE: There are items that need to be addressed that are more frequent than fuel fill ups: Rotor bearings (1 Zerk each side) must be greased with 1 shot of grease every 4 hours. Radiator fins may need to be cleaned off. Tracks may need to be cleaned.',
  'c362':       '2023 NEW HOLLAND C362 FUELING CHECKLIST. 30.8 GALLON FUEL TANK -- 3.3 GALLON DEF TANK.',
  'mini-ex':    '2011 MINI EX FUELING CHECKLIST.',
};

(async () => {
  const {data: eqs} = await sb.from('equipment').select('id,slug,name,operator_notes').in('slug', Object.keys(OPERATOR_NOTES));
  const byslug = new Map(eqs.map(e => [e.slug, e]));

  const updates = [];
  for (const [slug, text] of Object.entries(OPERATOR_NOTES)) {
    const eq = byslug.get(slug);
    if (!eq) { console.log(`  ✗ ${slug} not in equipment table`); continue; }
    const current = (eq.operator_notes || '').trim();
    const next = text.trim();
    if (current === next) { console.log(`  · ${slug}: already matches`); continue; }
    updates.push({id: eq.id, slug, current, next});
  }

  console.log(`\n${updates.length} piece(s) will be patched:`);
  for (const u of updates) {
    console.log(`\n  ${u.slug}:`);
    console.log(`    FROM: ${u.current.slice(0,120) || '(empty)'}${u.current.length>120?'...':''}`);
    console.log(`    TO:   ${u.next.slice(0,120)}${u.next.length>120?'...':''}`);
  }

  if (!COMMIT) {
    console.log('\nPreview only — rerun with --commit to apply.');
    return;
  }
  if (updates.length === 0) { console.log('\nNothing to update.'); return; }

  console.log('\nApplying...');
  for (const u of updates) {
    const {error} = await sb.from('equipment').update({operator_notes: u.next}).eq('id', u.id);
    if (error) console.error(`  ✗ ${u.slug}: ${error.message}`);
    else console.log(`  ✓ ${u.slug}`);
  }
})().catch(e => { console.error(e); process.exit(1); });
