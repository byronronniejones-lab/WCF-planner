// scripts/patch_equipment_help_text.cjs
//
// One-shot: read each Podio checklist app's config dump, extract the field-level
// description text (torque specs, tire pressures, gap specs, etc.) and patch
// it onto the existing equipment rows in Supabase:
//   • service_intervals[].help_text         (per-interval)
//   • every_fillup_help                     (top-level, for every-fillup section)
//
// Does NOT touch reading counts, intervals list, fillup items, completions.
// Safe to re-run — idempotent on help_text content.
//
// Requires migration 019_equipment_help_text.sql applied first.
//
// Usage:
//   node scripts/patch_equipment_help_text.cjs            # preview
//   node scripts/patch_equipment_help_text.cjs --commit   # write to Supabase

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

// Slug ↔ checklist app id map. Keep in sync with EQUIPMENT_DEFS in
// import_equipment.cjs. Only slugs with a Podio checklist app are listed.
const SLUG_TO_APP = {
  '5065':        29677781,
  'ps100':       29670699,
  'honda-atv-1': 29711361,
  'honda-atv-2': 29855781,
  'honda-atv-3': 30126620,
  'honda-atv-4': 30126621,
  'hijet-2018':  30104109,
  'hijet-2020':  30123211,
  'toro':        29786608,
  'ventrac':     30089562,
  'gehl':        30134561,
  'l328':        30473316,
  'mini-ex':     29673203,
  'gyro-trac':   29788050,
  'c362':        29673167,
};

function configPathForApp(appId) {
  const entries = fs.readdirSync(DUMP_DIR);
  const hit = entries.find(e => e.startsWith(`${appId}.`) && e.endsWith('.config.json'));
  return hit ? path.join(DUMP_DIR, hit) : null;
}

function parseIntervalLabel(label) {
  if (!label) return null;
  const up = label.toUpperCase();
  const kind = up.includes('KM') ? 'km' : 'hours';
  const nums = [];
  for (const m of up.matchAll(/(\d{1,3}(?:,\d{3})+|\d+)/g)) {
    const n = parseInt(m[1].replace(/,/g, ''), 10);
    if (Number.isFinite(n) && n > 0) nums.push(n);
  }
  if (nums.length === 0) return null;
  return {kind, values: nums, label};
}

function decodeEntities(s) {
  if (!s) return s;
  return String(s)
    .replace(/&quot;/g, '"').replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(parseInt(n, 10)));
}
function cleanHelp(s) {
  const d = decodeEntities(s || '').trim();
  return d || null;
}

function collectFromConfig(configPath) {
  const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  // Every-fillup field help text
  const fillup = (config.fields || []).find(f =>
    f.external_id === 'every-fuel-fill-up-checklist' ||
    f.external_id === 'every-fuel-fillup-checklist' ||
    /every.*fillup|every.*fill.*up/i.test(f.label || '')
  );
  const every_fillup_help = fillup
    ? cleanHelp(fillup.config?.description || fillup.description)
    : null;
  // Per-interval help text, keyed by `${kind}:${hours_or_km}`.
  const intervalHelp = new Map();
  for (const f of (config.fields || [])) {
    if (f.type !== 'category') continue;
    if (f.external_id === 'every-fuel-fill-up-checklist') continue;
    const lbl = f.label || '';
    if (!/hour|km|first\s*\d|initial\s*\d/i.test(lbl)) continue;
    const parsed = parseIntervalLabel(lbl);
    if (!parsed) continue;
    const help = cleanHelp(f.config?.description || f.description);
    if (!help) continue;
    for (const v of parsed.values) {
      intervalHelp.set(`${parsed.kind}:${v}`, help);
    }
  }
  return {every_fillup_help, intervalHelp};
}

async function main() {
  const patches = [];
  for (const [slug, appId] of Object.entries(SLUG_TO_APP)) {
    const configPath = configPathForApp(appId);
    if (!configPath) {
      console.log(`  · ${slug.padEnd(14)} — no config dump, skip`);
      continue;
    }
    const {every_fillup_help, intervalHelp} = collectFromConfig(configPath);
    patches.push({slug, every_fillup_help, intervalHelp});
    const n = intervalHelp.size;
    console.log(`  · ${slug.padEnd(14)} fillup=${every_fillup_help ? 'Y' : '—'}  intervals-with-help=${n}`);
    if (every_fillup_help) console.log(`      fillup: "${every_fillup_help}"`);
    for (const [k, v] of intervalHelp) console.log(`      ${k}: "${v}"`);
  }

  if (!COMMIT) {
    console.log('\n(preview only — re-run with --commit to write)');
    return;
  }

  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SERVICE_KEY  = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!SUPABASE_URL || !SERVICE_KEY) {
    console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in scripts/.env');
    process.exit(1);
  }
  const {createClient} = require('@supabase/supabase-js');
  const sb = createClient(SUPABASE_URL, SERVICE_KEY, {auth:{persistSession:false}});

  let updated = 0;
  for (const p of patches) {
    const id = 'eq-' + p.slug;
    const {data: eq, error: eqErr} = await sb.from('equipment')
      .select('id, service_intervals, every_fillup_help')
      .eq('id', id)
      .maybeSingle();
    if (eqErr) { console.error(`  ! ${p.slug}: select failed`, eqErr.message); continue; }
    if (!eq) { console.error(`  ! ${p.slug}: row ${id} not found in Supabase`); continue; }

    const intervals = Array.isArray(eq.service_intervals) ? eq.service_intervals : [];
    const nextIntervals = intervals.map(iv => {
      const key = `${iv.kind}:${iv.hours_or_km}`;
      const help = p.intervalHelp.get(key);
      if (!help) return iv;
      return {...iv, help_text: help};
    });

    const {error: upErr} = await sb.from('equipment')
      .update({
        service_intervals: nextIntervals,
        every_fillup_help: p.every_fillup_help,
      })
      .eq('id', id);
    if (upErr) { console.error(`  ! ${p.slug}: update failed`, upErr.message); continue; }
    updated++;
    console.log(`  ✓ ${p.slug} patched`);
  }
  console.log(`\nDone. ${updated}/${patches.length} rows updated.`);
}

main().catch(e => { console.error(e); process.exit(1); });
