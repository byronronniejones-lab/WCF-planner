// scripts/patch_equipment_intervals.cjs
//
// Re-seed service_intervals + every_fillup_items from the Podio config dumps,
// filtering OUT Podio's status='deleted' fields/options. These deleted entries
// are stale template cruft (e.g., 300/600/1200-hour *tractor* intervals left
// inside the Honda ATV app config when the ATV app was cloned from a tractor
// template). Podio hides them on the published webform but ships them over
// the API, which fooled the original seeder.
//
// Does NOT touch:
//   • equipment_fuelings (history)
//   • reading counts (current_hours / current_km)
//   • help text columns (every_fillup_help / fuel_gallons_help / operator_notes)
//
// Completions attribute via {kind, hours_or_km} pairs, so as long as the
// interval values match, existing completions still line up after the re-seed.
//
// Usage:
//   node scripts/patch_equipment_intervals.cjs            # preview
//   node scripts/patch_equipment_intervals.cjs --commit   # write to Supabase

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

// Keep in sync with EQUIPMENT_DEFS in import_equipment.cjs.
const SLUG_TO_APP = {
  5065: 29677781,
  ps100: 29670699,
  'honda-atv-1': 29711361,
  'honda-atv-2': 29855781,
  'honda-atv-3': 30126620,
  'honda-atv-4': 30126621,
  'hijet-2018': 30104109,
  'hijet-2020': 30123211,
  toro: 29786608,
  ventrac: 30089562,
  gehl: 30134561,
  l328: 30473316,
  'mini-ex': 29673203,
  'gyro-trac': 29788050,
  c362: 29673167,
};

function decodeEntities(s) {
  if (!s) return s;
  return String(s)
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(parseInt(n, 10)));
}

function configPathForApp(appId) {
  const entries = fs.readdirSync(DUMP_DIR);
  const hit = entries.find((e) => e.startsWith(`${appId}.`) && e.endsWith('.config.json'));
  return hit ? path.join(DUMP_DIR, hit) : null;
}

function parseIntervalLabel(label) {
  if (!label) return null;
  const up = label.toUpperCase();
  const kind = up.includes('KM') ? 'km' : 'hours';
  // "FIRST 75 & EVERY 500 HOURS" → only 500 is a recurring interval.
  const firstEvery = /FIRST\s+(\d{1,3}(?:,\d{3})+|\d+)\s*[&+]?\s*EVERY\s+(\d{1,3}(?:,\d{3})+|\d+)/i.exec(up);
  if (firstEvery) {
    return {kind, values: [parseInt(firstEvery[2].replace(/,/g, ''), 10)], label};
  }
  const nums = [];
  for (const m of up.matchAll(/(\d{1,3}(?:,\d{3})+|\d+)/g)) {
    const n = parseInt(m[1].replace(/,/g, ''), 10);
    if (Number.isFinite(n) && n > 0) nums.push(n);
  }
  if (nums.length === 0) return null;
  return {kind, values: nums, label};
}

function slugify(text, max) {
  return (text || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, max);
}

// Attachment-checklist fields have labels like "Tough Cut -- Every 50 Hours" —
// they belong to an attachment, not the base machine. Detect by the '--' or
// '—' separator in the label.
function isAttachmentLabel(lbl) {
  return /\s--\s|\s—\s/.test(lbl);
}

// Build clean service_intervals + every_fillup_items + attachment_checklists
// from a single config.
function rebuildFromConfig(configPath) {
  const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));

  // Every-fillup field
  const fillup = (config.fields || []).find(
    (f) =>
      f.status !== 'deleted' &&
      (f.external_id === 'every-fuel-fill-up-checklist' ||
        f.external_id === 'every-fuel-fillup-checklist' ||
        /every.*fillup|every.*fill.*up/i.test(f.label || '')),
  );
  let every_fillup_items = [];
  if (fillup && fillup.config?.settings?.options) {
    every_fillup_items = fillup.config.settings.options
      .filter((o) => o.status !== 'deleted')
      .map((o) => ({
        id: slugify(o.text, 40) || String(o.id),
        label: o.text || '',
      }))
      .filter((x) => x.label);
  }

  // Per-interval fields + tasks. Attachment-prefixed fields get bucketed
  // separately so they don't collide on (kind,value) with the main intervals.
  const intervalsRaw = [];
  const attachmentRaw = [];
  for (const f of config.fields || []) {
    if (f.type !== 'category') continue;
    if (f.status === 'deleted') continue;
    if (f.external_id === 'every-fuel-fill-up-checklist') continue;
    const lbl = f.label || '';
    if (!/hour|km|first\s*\d|initial\s*\d/i.test(lbl)) continue;
    const parsed = parseIntervalLabel(lbl);
    if (!parsed) continue;
    const tasks = (f.config?.settings?.options || [])
      .filter((o) => o.status !== 'deleted')
      .map((o) => ({
        id: slugify(o.text, 50) || String(o.id),
        label: (o.text || '').trim(),
      }))
      .filter((t) => t.label);
    const help_text = decodeEntities((f.config?.description || f.description || '').trim()) || null;
    if (isAttachmentLabel(lbl)) {
      const attachmentName = lbl.split(/\s--\s|\s—\s/)[0].trim();
      for (const v of parsed.values) {
        attachmentRaw.push({
          name: attachmentName,
          hours_or_km: v,
          kind: parsed.kind,
          label: lbl.trim(),
          tasks,
          help_text,
        });
      }
    } else {
      for (const v of parsed.values) {
        intervalsRaw.push({hours_or_km: v, kind: parsed.kind, label: lbl.trim(), tasks, help_text});
      }
    }
  }
  // Dedup on (kind,value). First-one-wins by source order.
  const seen = new Set();
  const service_intervals = intervalsRaw
    .filter((iv) => {
      const k = iv.kind + ':' + iv.hours_or_km;
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    })
    .sort((a, b) => a.hours_or_km - b.hours_or_km);

  // Attachments keyed on (name,kind,value). Sort by name then ascending interval.
  const aseen = new Set();
  const attachment_checklists = attachmentRaw
    .filter((a) => {
      const k = a.name + ':' + a.kind + ':' + a.hours_or_km;
      if (aseen.has(k)) return false;
      aseen.add(k);
      return true;
    })
    .sort((a, b) => a.name.localeCompare(b.name) || a.hours_or_km - b.hours_or_km);

  return {service_intervals, every_fillup_items, attachment_checklists};
}

async function main() {
  const plans = [];
  for (const [slug, appId] of Object.entries(SLUG_TO_APP)) {
    const configPath = configPathForApp(appId);
    if (!configPath) {
      console.log(`  · ${slug.padEnd(14)} — no config, skip`);
      continue;
    }
    const {service_intervals, every_fillup_items, attachment_checklists} = rebuildFromConfig(configPath);
    const ivSummary = service_intervals
      .map((iv) => `${iv.hours_or_km}${iv.kind === 'km' ? 'km' : 'h'}(${iv.tasks.length}t)`)
      .join(', ');
    const attSummary = attachment_checklists.length
      ? '  attachments=[' +
        attachment_checklists.map((a) => `${a.name}@${a.hours_or_km}${a.kind[0]}(${a.tasks.length}t)`).join(', ') +
        ']'
      : '';
    console.log(`  · ${slug.padEnd(14)} fillup=${every_fillup_items.length}  intervals=[${ivSummary}]${attSummary}`);
    plans.push({slug, service_intervals, every_fillup_items, attachment_checklists});
  }

  if (!COMMIT) {
    console.log('\n(preview only — re-run with --commit to write)');
    return;
  }

  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!SUPABASE_URL || !SERVICE_KEY) {
    console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in scripts/.env');
    process.exit(1);
  }
  const {createClient} = require('@supabase/supabase-js');
  const sb = createClient(SUPABASE_URL, SERVICE_KEY, {auth: {persistSession: false}});

  let updated = 0;
  for (const p of plans) {
    const id = 'eq-' + p.slug;
    const {error} = await sb
      .from('equipment')
      .update({
        service_intervals: p.service_intervals,
        every_fillup_items: p.every_fillup_items,
        attachment_checklists: p.attachment_checklists,
      })
      .eq('id', id);
    if (error) {
      console.error(`  ! ${p.slug}: update failed`, error.message);
      continue;
    }
    updated++;
    console.log(`  ✓ ${p.slug} re-seeded`);
  }
  console.log(
    `\nDone. ${updated}/${plans.length} rows re-seeded. Completions preserved (they attribute by kind+value).`,
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
