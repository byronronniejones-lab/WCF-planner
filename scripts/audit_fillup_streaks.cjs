// scripts/audit_fillup_streaks.cjs
//
// Read-only. Simulates the every-fillup miss-streak feature against current
// data so we can see what operators would face on day 1 of deployment.
//
// For each ACTIVE piece of equipment, walks every prior fueling (sorted by
// reading desc, date as tiebreaker — same logic the form uses) and counts
// consecutive misses per item id. Buckets the results to make it easy to
// judge whether to ship with a backdate cutoff or without.
//
// Usage: node scripts/audit_fillup_streaks.cjs
// No flags. No writes. Pure read.

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

function readingOf(h) {
  if (h.hours_reading != null) return Number(h.hours_reading);
  if (h.km_reading != null) return Number(h.km_reading);
  return null;
}

async function main() {
  const {createClient} = require('@supabase/supabase-js');
  const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {auth:{persistSession:false}});

  const {data: eqs, error: e1} = await sb.from('equipment').select('id,slug,name,tracking_unit,every_fillup_items').eq('status','active').order('slug');
  if (e1) { console.error(e1); process.exit(1); }

  const summary = {
    total_pieces: 0,
    total_items: 0,
    items_clean:        0,  // streak 0
    items_short:        0,  // streak 1-3
    items_medium:       0,  // streak 4-9
    items_long:         0,  // streak 10+
    items_never_ticked: 0,  // never appeared in any prior every_fillup_check (likely brand-new item)
    items_no_history:   0,  // equipment has zero fuelings
  };

  console.log('=== EVERY-FILLUP STREAK AUDIT ===');
  console.log('Date:', new Date().toISOString().slice(0,10));
  console.log('Per-piece breakdown follows.\n');

  for (const eq of eqs) {
    const items = Array.isArray(eq.every_fillup_items) ? eq.every_fillup_items : [];
    if (items.length === 0) continue;
    summary.total_pieces++;

    const {data: fuelings} = await sb.from('equipment_fuelings')
      .select('date,team_member,hours_reading,km_reading,every_fillup_check')
      .eq('equipment_id', eq.id)
      .order('date', {ascending: false})
      .limit(500);

    const sorted = (fuelings || []).slice().sort((a, b) => {
      const ra = readingOf(a), rb = readingOf(b);
      if (ra != null && rb != null && ra !== rb) return rb - ra;
      return String(b.date || '').localeCompare(String(a.date || ''));
    });

    const fuelingCount = sorted.length;
    const unitShort = eq.tracking_unit === 'km' ? 'km' : 'h';

    console.log('--- ' + eq.slug + ' (' + (eq.name || '?') + ')');
    console.log('  fuelings on file:', fuelingCount, ' · every-fillup items:', items.length);

    if (fuelingCount === 0) {
      console.log('  (no history — every item starts at streak 0)');
      summary.items_no_history += items.length;
      summary.total_items += items.length;
      console.log();
      continue;
    }

    // Was the item EVER ticked in any prior fueling? (Lets us flag "never ticked.")
    const everTicked = new Set();
    for (const h of sorted) {
      const ticks = Array.isArray(h.every_fillup_check) ? h.every_fillup_check : [];
      for (const t of ticks) if (t && t.id) everTicked.add(t.id);
    }

    const rows = [];
    for (const item of items) {
      let streak = 0;
      let oldest = null;
      for (const h of sorted) {
        const ticks = Array.isArray(h.every_fillup_check) ? h.every_fillup_check : [];
        const wasTicked = ticks.some(t => t && t.id === item.id);
        if (wasTicked) break;
        streak++;
        const r = readingOf(h);
        oldest = {reading: r, name: h.team_member || null, date: h.date || null};
      }
      const neverTicked = !everTicked.has(item.id);
      rows.push({label: item.label || item.id, id: item.id, streak, oldest, neverTicked, fuelingCount});
      summary.total_items++;
      if (streak === 0)               summary.items_clean++;
      else if (neverTicked)           summary.items_never_ticked++;
      else if (streak <= 3)           summary.items_short++;
      else if (streak <= 9)           summary.items_medium++;
      else                            summary.items_long++;
    }

    // Print sorted: never-ticked first (worst noise), then long streaks, etc.
    rows.sort((a, b) => {
      if (a.neverTicked !== b.neverTicked) return a.neverTicked ? -1 : 1;
      return b.streak - a.streak;
    });
    for (const r of rows) {
      const tag = r.neverTicked
        ? `NEVER TICKED (would show streak ${r.streak} on day 1 — likely a NEW item)`
        : r.streak === 0
          ? 'clean'
          : `streak ${r.streak}`
            + (r.oldest && r.oldest.reading != null ? ` · oldest ${r.oldest.reading.toLocaleString()}${unitShort}` : '')
            + (r.oldest && r.oldest.name ? ` by ${r.oldest.name}` : '')
            + (r.oldest && r.oldest.date ? ` on ${r.oldest.date}` : '');
      const pad = r.label.padEnd(50, ' ').slice(0, 50);
      console.log('  ' + pad + ' ' + tag);
    }
    console.log();
  }

  console.log('\n=== SUMMARY ===');
  console.log('Active pieces with every-fillup items:', summary.total_pieces);
  console.log('Total items audited:                  ', summary.total_items);
  console.log('  Clean (streak 0):                   ', summary.items_clean);
  console.log('  Short streak 1-3:                   ', summary.items_short);
  console.log('  Medium streak 4-9:                  ', summary.items_medium);
  console.log('  Long streak 10+:                    ', summary.items_long);
  console.log('  Never ticked (likely new items):    ', summary.items_never_ticked);
  console.log('  No history (no fuelings yet):       ', summary.items_no_history);
  console.log('\nInterpretation:');
  console.log('  • CLEAN items would show no badge on day 1 — fine.');
  console.log('  • SHORT-streak items (1-3) are real misses — exactly the signal we want.');
  console.log('  • MEDIUM/LONG streaks may be either real chronic neglect OR items that');
  console.log('    have been routinely skipped by the team. Useful audit either way.');
  console.log("  • NEVER-TICKED items with non-zero streak almost certainly didn't exist");
  console.log('    when those fuelings were recorded — Option B (silent until first tick)');
  console.log('    would suppress these by treating "never ticked" as "no baseline yet."');
  console.log('\nIf NEVER-TICKED count is large: ship with Option B (free) to suppress them.');
  console.log('If MEDIUM/LONG counts are large: consider whether the noise is acceptable.');
  console.log('If counts are mostly CLEAN/SHORT: ship without a cutoff, no problem.');
}

main().catch(err => { console.error(err); process.exit(1); });
