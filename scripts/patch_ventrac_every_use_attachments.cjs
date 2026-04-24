// Add the 3 "Every Use" attachment checklists to Ventrac's
// equipment.attachment_checklists JSONB:
//   - Tough Cut -- Every Use (5 tasks)
//   - AERO-Vator -- Every Use (5 tasks)
//   - Landscape Rake -- Every Use (3 tasks)
//
// These are per-session checks (no hour milestone). Stored with
// hours_or_km: 0 to fit the existing schema; the /fueling webform renders
// "0" as "Every Use".
//
// import_equipment.cjs was dropping these because its interval regex
// required an hours/km number — that's fixed going forward, this patch
// backfills the existing Ventrac row.
//
// Usage:
//   node scripts/patch_ventrac_every_use_attachments.cjs           # preview
//   node scripts/patch_ventrac_every_use_attachments.cjs --commit  # apply
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

function slug(s) {
  return String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 50);
}

const EVERY_USE_ATTACHMENTS = [
  {
    name: 'Tough Cut',
    hours_or_km: 0,
    kind: 'hours',
    label: 'Tough Cut -- Every Use',
    tasks: [
      'REMOVE DECK COVER. SET ASIDE',
      'BLOW OUT DECK & REMOVE ALL DEBRIS FROM AROUND PULLEYS',
      'CHECK BELTS FOR WEAR',
      'FLIP UP DECK & CLEAN ANY OVERLY BUILT UP DEBRIS',
      'INSPECT BLADES - SHARPEN AS NEEDED',
    ],
    help_text: 'To flip the deck up: 1. Both hitch arm pins have to be removed. 2. Remove deck cover and set aside. 3. Remove pin from belt tension handle and rotate 180 degrees. 4. Raise the deck to highest position and then use the smaller hydraulic arm to tilt the deck up all the way. 5. Reverse actions 1-4 when done under the deck. Ensure to pin belt tensioner handle over the top of the red lever that goes over the top of the hydraulic arm.',
  },
  {
    name: 'AERO-Vator',
    hours_or_km: 0,
    kind: 'hours',
    label: 'AERO-Vator -- Every Use',
    tasks: [
      'SPRAY Blaster Multi-Max ON EACH OF THE 4 BEARINGS IN THE SEED BOX - LIGHTLY COAT',
      'INSPECT TINES',
      'LOOK FOR MISSING, LOOSE OR WORN COMPONENTS OR NUTS/BOLTS',
      'INSPECT PTO BELT',
      'ENSURE TINE ASSEMBLY STOPS WHEN DECK IS RAISED, IF IT DOESNT THEN TRIPLE DRIVE BELT NEEDS ADJUSTING.',
    ],
    help_text: 'When attaching/detaching the AERA-Vator the Clutch Handle (left side of unit) should have the pin in the lockout position. Place pin in the upper frame hole for storage when in operation.',
  },
  {
    name: 'Landscape Rake',
    hours_or_km: 0,
    kind: 'hours',
    label: 'Landscape Rake -- Every Use',
    tasks: [
      'CHECK TIRE PRESSURE - 18-20 PSI',
      'INSPECT FOR LOOSE, WORN OR MISSING COMPONENTS',
      'CHECK RAKE TINES FOR DAMAGE. MAKE SURE THEY ARE TIGHT AND NOT BENT',
    ],
    help_text: null,
  },
];

(async () => {
  const {data: eq} = await sb.from('equipment').select('id,slug,name,attachment_checklists').eq('slug','ventrac').maybeSingle();
  if (!eq) { console.error('ventrac not found in equipment table'); process.exit(1); }

  const existing = Array.isArray(eq.attachment_checklists) ? eq.attachment_checklists : [];
  const existingKeys = new Set(existing.map(a => `${(a.name||'').trim().toLowerCase()}:${a.kind}:${a.hours_or_km}`));

  const next = existing.slice();
  const additions = [];
  for (const att of EVERY_USE_ATTACHMENTS) {
    const k = `${att.name.toLowerCase()}:${att.kind}:${att.hours_or_km}`;
    if (existingKeys.has(k)) { console.log(`  · ${att.label} already present — skipping`); continue; }
    const withTaskIds = {
      ...att,
      tasks: att.tasks.map(t => ({id: slug(t), label: t})),
    };
    next.push(withTaskIds);
    additions.push(att);
  }

  if (additions.length === 0) {
    console.log('\nNothing to add — all 3 Every Use attachments already in planner.');
    return;
  }

  console.log(`\n${additions.length} new attachment(s) will be added to Ventrac:`);
  for (const a of additions) console.log(`  + ${a.label} (${a.tasks.length} tasks)${a.help_text?' [with help_text]':''}`);

  if (!COMMIT) {
    console.log('\nPreview only — rerun with --commit to apply.');
    return;
  }

  const {error} = await sb.from('equipment').update({attachment_checklists: next}).eq('id', eq.id);
  if (error) { console.error('Update failed:', error.message); process.exit(1); }
  console.log(`\n✓ ventrac.attachment_checklists updated — now has ${next.length} entries.`);
})().catch(e => { console.error(e); process.exit(1); });
