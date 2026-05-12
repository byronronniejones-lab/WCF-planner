// Compare planner's Ventrac attachment_checklists JSONB against what's in
// Podio — BOTH the published webform (captured in _webforms_snapshot_2026-04-24
// for Tough Cut + AERO-Vator) AND the Podio dump which also has Landscape Rake
// (exists in the app but isn't ticked on to display on the webform).
//
// Printing a per-attachment diff. Does NOT patch.

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

function parseAttachmentLabel(lbl) {
  // "Tough Cut -- Every 50 Hours" / "AERO-Vator -- Every Use" / "Landscape Rake -- Every 50 Hours"
  const m = /^(.+?)\s*--\s*Every\s+(\d+|Use)\s*(Hours?|Km)?/i.exec((lbl || '').trim());
  if (!m) return null;
  const name = m[1].trim();
  const rawNum = m[2];
  const kind = m[3] && /km/i.test(m[3]) ? 'km' : 'hours';
  // "Every Use" — we map this to "hours_or_km: 0" as a sentinel for per-use
  const hours_or_km = /^use$/i.test(rawNum) ? 0 : Number(rawNum);
  return {name, hours_or_km, kind};
}

function norm(s) {
  return (s || '').trim().replace(/\s+/g, ' ');
}

(async () => {
  const {data: eq} = await sb.from('equipment').select('*').eq('slug', 'ventrac').maybeSingle();
  if (!eq) {
    console.log('No ventrac equipment row.');
    process.exit(0);
  }

  const planner = Array.isArray(eq.attachment_checklists) ? eq.attachment_checklists : [];
  console.log(`\n═══ Planner's Ventrac attachment_checklists (${planner.length} entries) ═══`);
  for (const a of planner) {
    console.log(
      `  ${a.name} · ${a.kind} · ${a.hours_or_km === 0 ? 'Every Use' : 'Every ' + a.hours_or_km + a.kind.charAt(0)} — ${(a.tasks || []).length} tasks${a.help_text ? ' [has help]' : ''}`,
    );
  }

  // ── Source of truth 1: Podio WEBFORM snapshot (Tough Cut + AERO-Vator only, since Landscape Rake isn't published) ──
  const snap = JSON.parse(
    fs.readFileSync(path.join(__dirname, 'podio_equipment_dump', '_webforms_snapshot_2026-04-24.json'), 'utf8'),
  );
  const webformAtts = (snap.forms.ventrac.fields || [])
    .filter((f) => f.attachment)
    .map((f) => {
      const p = parseAttachmentLabel(f.label);
      return {...p, label: f.label, options: f.options || [], help: f.help || ''};
    });
  console.log(`\n═══ Podio WEBFORM attachments (${webformAtts.length} entries, from 2026-04-24 fetch) ═══`);
  for (const a of webformAtts) {
    console.log(
      `  ${a.name} · ${a.kind} · ${a.hours_or_km === 0 ? 'Every Use' : 'Every ' + a.hours_or_km + a.kind.charAt(0)} — ${a.options.length} tasks${a.help ? ' [has help]' : ''}`,
    );
  }

  // ── Source of truth 2: Podio DUMP (includes Landscape Rake even though unpublished) ──
  const dumpConfig = JSON.parse(
    fs.readFileSync(
      path.join(__dirname, 'podio_equipment_dump', '30089562.ventrac-fueling-checklists.config.json'),
      'utf8',
    ),
  );
  const dumpAtts = [];
  for (const f of dumpConfig.fields || []) {
    if (f.type !== 'category' || f.status === 'deleted') continue;
    const p = parseAttachmentLabel(f.label);
    if (!p) continue; // not an attachment-style field
    const options = ((f.config && f.config.settings && f.config.settings.options) || [])
      .filter((o) => o.status !== 'deleted')
      .map((o) => o.text);
    dumpAtts.push({...p, label: f.label, options, help: f.description || ''});
  }
  console.log(`\n═══ Podio DUMP attachments (${dumpAtts.length} entries — includes unpublished Landscape Rake) ═══`);
  for (const a of dumpAtts) {
    console.log(
      `  ${a.name} · ${a.kind} · ${a.hours_or_km === 0 ? 'Every Use' : 'Every ' + a.hours_or_km + a.kind.charAt(0)} — ${a.options.length} tasks${a.help ? ' [has help]' : ''}`,
    );
  }

  // ── Diffs: planner vs DUMP (the most complete source, as Ronnie wants all 3 attachments) ──
  console.log(`\n═══ DIFFS: planner vs Podio DUMP ═══`);
  const diffs = [];
  for (const dump of dumpAtts) {
    const key = dump.name + ':' + dump.kind + ':' + dump.hours_or_km;
    const pl = planner.find(
      (a) => norm(a.name) === norm(dump.name) && a.kind === dump.kind && a.hours_or_km === dump.hours_or_km,
    );
    if (!pl) {
      diffs.push({kind: 'missing_from_planner', dump});
      continue;
    }
    const dOpts = dump.options.map(norm);
    const pOpts = (pl.tasks || []).map((t) => norm(t.label));
    const missing = dOpts.filter((o) => !pOpts.includes(o));
    const extra = pOpts.filter((o) => !dOpts.includes(o));
    if (missing.length || extra.length) diffs.push({kind: 'tasks_differ', dump, pl, missing, extra});
    const pHelp = norm(pl.help_text || '');
    const dHelp = norm(dump.help);
    if (pHelp !== dHelp)
      diffs.push({kind: 'help_differ', dump, pl, podio_help: dump.help, planner_help: pl.help_text || ''});
  }
  for (const pl of planner) {
    const match = dumpAtts.find(
      (a) => norm(a.name) === norm(pl.name) && a.kind === pl.kind && a.hours_or_km === pl.hours_or_km,
    );
    if (!match) diffs.push({kind: 'extra_in_planner', pl});
  }

  if (diffs.length === 0) {
    console.log('  ✓ planner matches Podio dump exactly');
  } else {
    for (const d of diffs) {
      if (d.kind === 'missing_from_planner') {
        console.log(`\n  ✗ MISSING from planner: "${d.dump.label}"`);
        console.log(`      Podio has ${d.dump.options.length} tasks${d.dump.help ? ' + help text' : ''}:`);
        for (const o of d.dump.options) console.log('        - ' + o);
      } else if (d.kind === 'tasks_differ') {
        console.log(`\n  ≠ "${d.dump.label}" tasks differ`);
        if (d.missing.length) {
          console.log('      MISSING from planner:');
          for (const o of d.missing) console.log('        - ' + o);
        }
        if (d.extra.length) {
          console.log('      EXTRA in planner:');
          for (const o of d.extra) console.log('        - ' + o);
        }
      } else if (d.kind === 'help_differ') {
        console.log(`\n  ≠ "${d.dump.label}" help_text differs`);
        console.log(`      PODIO  : ${d.podio_help || '(none)'}`);
        console.log(`      PLANNER: ${d.planner_help || '(none)'}`);
      } else if (d.kind === 'extra_in_planner') {
        console.log(
          `\n  + EXTRA in planner (not in Podio dump): "${d.pl.name} · ${d.pl.hours_or_km === 0 ? 'Every Use' : 'Every ' + d.pl.hours_or_km + d.pl.kind.charAt(0)}"`,
        );
      }
    }
  }

  // ── Cross-check: webform vs dump (so Ronnie can see what's currently hidden on webform) ──
  console.log(`\n═══ What's in dump but NOT on published webform (currently hidden) ═══`);
  for (const dump of dumpAtts) {
    const onWebform = webformAtts.find((a) => norm(a.name) === norm(dump.name) && a.hours_or_km === dump.hours_or_km);
    if (!onWebform) console.log(`  · "${dump.label}" (${dump.options.length} tasks)`);
  }
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
