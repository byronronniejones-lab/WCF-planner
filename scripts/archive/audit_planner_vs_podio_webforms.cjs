// Compare planner equipment config against the Podio webform snapshot
// (scripts/podio_equipment_dump/_webforms_snapshot_2026-04-24.json).
//
// Reports differences in:
//   - operator_notes (TOP description)        vs  form.top
//   - every_fillup_items (labels)              vs  form.fields["Every fuel fill up checklist"].options
//   - every_fillup_help                        vs  form.fields["Every fuel fill up checklist"].help
//   - fuel_gallons_help                        vs  form.fields["Gallons of ..."].help
//   - service_intervals[N].label + tasks       vs  form.fields["Every N hour/km checklist"].{label,options}
//   - service_intervals[N].help_text           vs  form.fields["Every N hour/km checklist"].help
//
// Does NOT patch. Prints a per-piece diff report. Ronnie reviews, decides
// what to fix, then we write patch script(s).

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

const snapshot = JSON.parse(
  fs.readFileSync(path.join(__dirname, 'podio_equipment_dump', '_webforms_snapshot_2026-04-24.json'), 'utf8'),
);

// Parse "Every 50 hours checklist" / "Every 1000 KM checklist" / "First 75 & Every 500 hours" → {value, kind}
function parseIntervalLabel(lbl) {
  if (!lbl) return null;
  // "First X & Every Y ..." → Y only
  const firstEvery = /first\s+\d+\s*(?:hours?|hrs?|km)?\s*(?:&|and)\s*every\s+(\d{1,6})\s*(hour|hr|km)/i.exec(lbl);
  if (firstEvery) return {value: Number(firstEvery[1]), kind: /km/i.test(firstEvery[2]) ? 'km' : 'hours'};
  // "Every N hours/hr/km [checklist]"
  const every = /every\s+([\d,]+)\s*(hour|hr|km)/i.exec(lbl);
  if (every) return {value: Number(every[1].replace(/,/g, '')), kind: /km/i.test(every[2]) ? 'km' : 'hours'};
  return null;
}

function norm(s) {
  return (s || '').trim().replace(/\s+/g, ' ');
}

(async () => {
  const {data: eqs} = await sb.from('equipment').select('*').eq('status', 'active').order('category').order('name');

  for (const slug of Object.keys(snapshot.forms)) {
    const form = snapshot.forms[slug];
    const eq = eqs.find((e) => e.slug === slug);
    const diffs = [];

    if (!eq) {
      console.log(`\n═══ ${slug} — NOT FOUND in planner (status!=active?) ═══`);
      continue;
    }

    // --- TOP description → operator_notes
    const podioTop = norm(form.top);
    const planTop = norm(eq.operator_notes);
    if (podioTop !== planTop) {
      diffs.push({kind: 'operator_notes', podio: form.top, planner: eq.operator_notes || '(empty)'});
    }

    // --- Every fuel fill up items ---
    const fillupField = form.fields.find((f) => /every fuel fill up/i.test(f.label));
    if (fillupField) {
      const podioOpts = (fillupField.options || []).map(norm);
      const planItems = Array.isArray(eq.every_fillup_items) ? eq.every_fillup_items.map((x) => norm(x.label)) : [];
      const missingFromPlanner = podioOpts.filter((o) => !planItems.includes(o));
      const extraInPlanner = planItems.filter((p) => !podioOpts.includes(p));
      if (missingFromPlanner.length || extraInPlanner.length) {
        diffs.push({kind: 'every_fillup_items', missing: missingFromPlanner, extra: extraInPlanner});
      }
      // help
      const podioHelp = norm(fillupField.help || '');
      const planHelp = norm(eq.every_fillup_help || '');
      if (podioHelp !== planHelp) {
        diffs.push({
          kind: 'every_fillup_help',
          podio: fillupField.help || '(none)',
          planner: eq.every_fillup_help || '(none)',
        });
      }
    }

    // --- Gallons help ---
    const gallonsField = form.fields.find((f) => /gallons of/i.test(f.label));
    if (gallonsField) {
      const podioHelp = norm(gallonsField.help || '');
      const planHelp = norm(eq.fuel_gallons_help || '');
      if (podioHelp !== planHelp) {
        diffs.push({
          kind: 'fuel_gallons_help',
          podio: gallonsField.help || '(none)',
          planner: eq.fuel_gallons_help || '(none)',
        });
      }
    }

    // --- Service intervals ---
    const planIvs = Array.isArray(eq.service_intervals) ? eq.service_intervals : [];
    // Main-machine intervals only. Attachment intervals have labels like
    // "Tough Cut -- Every 50 Hours" — those belong in attachment_checklists,
    // not service_intervals. Skip anything with ' -- ' or an 'attachment'
    // field (marked in the snapshot).
    const podioIvs = form.fields
      .filter((f) => parseIntervalLabel(f.label))
      .filter((f) => !f.attachment && !/\s--\s/.test(f.label))
      .map((f) => ({...parseIntervalLabel(f.label), label: f.label, options: f.options || [], help: f.help || ''}));

    // Match by (kind, value)
    for (const p of podioIvs) {
      const pl = planIvs.find((i) => i.kind === p.kind && i.hours_or_km === p.value);
      if (!pl) {
        diffs.push({
          kind: 'interval_missing',
          interval: `${p.value}${p.kind}`,
          podio_label: p.label,
          podio_tasks: p.options,
        });
        continue;
      }
      // Label match
      if (norm(pl.label) !== norm(p.label)) {
        diffs.push({kind: 'interval_label', interval: `${p.value}${p.kind}`, podio: p.label, planner: pl.label});
      }
      // Tasks match
      const planTasks = (pl.tasks || []).map((t) => norm(t.label));
      const podioTasks = p.options.map(norm);
      const missingFromPlanner = podioTasks.filter((o) => !planTasks.includes(o));
      const extraInPlanner = planTasks.filter((t) => !podioTasks.includes(t));
      if (missingFromPlanner.length || extraInPlanner.length) {
        diffs.push({
          kind: 'interval_tasks',
          interval: `${p.value}${p.kind}`,
          missing: missingFromPlanner,
          extra: extraInPlanner,
        });
      }
      // Help text
      const podioHelp = norm(p.help);
      const planHelp = norm(pl.help_text || '');
      if (podioHelp !== planHelp) {
        diffs.push({
          kind: 'interval_help',
          interval: `${p.value}${p.kind}`,
          podio: p.help || '(none)',
          planner: pl.help_text || '(none)',
        });
      }
    }
    // Any planner intervals not present on Podio?
    for (const pl of planIvs) {
      const match = podioIvs.find((p) => p.kind === pl.kind && p.value === pl.hours_or_km);
      if (!match) {
        diffs.push({
          kind: 'interval_extra_in_planner',
          interval: `${pl.hours_or_km}${pl.kind}`,
          planner_label: pl.label,
        });
      }
    }

    // Print
    if (diffs.length === 0) {
      console.log(`\n═══ ${slug} — ${eq.name} ═══  ✓ exact match`);
      continue;
    }
    console.log(`\n═══ ${slug} — ${eq.name} ═══  ${diffs.length} diff(s)`);
    for (const d of diffs) {
      if (d.kind === 'operator_notes') {
        console.log(`  [operator_notes / TOP description]`);
        console.log(`    PODIO  : ${d.podio}`);
        console.log(`    PLANNER: ${d.planner}`);
      } else if (d.kind === 'every_fillup_items') {
        if (d.missing.length)
          console.log(`  [every_fillup_items] MISSING in planner: ${d.missing.map((x) => `"${x}"`).join(', ')}`);
        if (d.extra.length)
          console.log(
            `  [every_fillup_items] EXTRA in planner (not in Podio): ${d.extra.map((x) => `"${x}"`).join(', ')}`,
          );
      } else if (d.kind === 'every_fillup_help') {
        console.log(`  [every_fillup_help]`);
        console.log(`    PODIO  : ${d.podio}`);
        console.log(`    PLANNER: ${d.planner}`);
      } else if (d.kind === 'fuel_gallons_help') {
        console.log(`  [fuel_gallons_help]`);
        console.log(`    PODIO  : ${d.podio}`);
        console.log(`    PLANNER: ${d.planner}`);
      } else if (d.kind === 'interval_missing') {
        console.log(`  [interval ${d.interval}] MISSING from planner — Podio has ${d.podio_tasks.length} tasks`);
      } else if (d.kind === 'interval_label') {
        console.log(`  [interval ${d.interval}] LABEL differs`);
        console.log(`    PODIO  : ${d.podio}`);
        console.log(`    PLANNER: ${d.planner}`);
      } else if (d.kind === 'interval_tasks') {
        if (d.missing.length)
          console.log(
            `  [interval ${d.interval}] MISSING task(s) in planner: ${d.missing.map((x) => `"${x}"`).join(', ')}`,
          );
        if (d.extra.length)
          console.log(
            `  [interval ${d.interval}] EXTRA task(s) in planner (not on Podio): ${d.extra.map((x) => `"${x}"`).join(', ')}`,
          );
      } else if (d.kind === 'interval_help') {
        console.log(`  [interval ${d.interval} help_text]`);
        console.log(`    PODIO  : ${d.podio}`);
        console.log(`    PLANNER: ${d.planner}`);
      } else if (d.kind === 'interval_extra_in_planner') {
        console.log(`  [interval ${d.interval}] PRESENT in planner, NOT on Podio — label="${d.planner_label}"`);
      }
    }
  }

  process.exit(0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
