// scripts/seed_batch_cows_detail.js
//
// One-time backfill: populate cattle_processing_batches.cows_detail with a
// per-cow breakdown built from existing data.
//
// For each batch, find cows with processing_batch_id = batch.id and build:
//   [{cattle_id, tag, live_weight, hanging_weight}, ...]
//
//   live_weight    = cow's latest cattle-species weigh-in on or before
//                    batch.actual_process_date (or latest overall if no
//                    process date yet). Uses cowTagSet to span retags but
//                    excludes source='import' purchase tags (§13.6 #8).
//   hanging_weight = cow.hanging_weight (Podio-imported column)
//
// Also recomputes total_live_weight / total_hanging_weight from the sums.
//
// Usage:
//   node scripts/seed_batch_cows_detail.js           # preview
//   node scripts/seed_batch_cows_detail.js --commit  # PATCH
//
// Idempotent: safe to re-run. Overwrites cows_detail for each batch.

const fs = require('fs');
const path = require('path');
for (const l of fs.readFileSync(path.join(__dirname, '.env'), 'utf8').split(/\r?\n/)) {
  const m = /^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*?)\s*$/.exec(l);
  if (m) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
}
const URL = process.env.SUPABASE_URL;
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!URL || !KEY) {
  console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in scripts/.env');
  process.exit(1);
}
const H = {apikey: KEY, Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json'};

async function fetchAll(table, query) {
  let out = [];
  let from = 0;
  const page = 1000;
  while (true) {
    const r = await fetch(`${URL}/rest/v1/${table}?${query}`, {
      headers: {...H, Range: `${from}-${from + page - 1}`, 'Range-Unit': 'items'},
    });
    if (!r.ok) throw new Error(`Fetch ${table} failed: ${r.status} ${await r.text()}`);
    const rows = await r.json();
    out = out.concat(rows);
    if (rows.length < page) break;
    from += page;
  }
  return out;
}

function cowTagSet(cow) {
  const s = new Set();
  if (cow.tag) s.add(String(cow.tag));
  if (Array.isArray(cow.old_tags)) {
    for (const ot of cow.old_tags) {
      if (!ot || !ot.tag || ot.source === 'import') continue;
      s.add(String(ot.tag));
    }
  }
  return s;
}

async function main() {
  const commit = process.argv.includes('--commit');

  console.log('Loading batches, cattle, sessions + weigh_ins...');
  const [batches, cattle, cattleSessions, allWIs] = await Promise.all([
    fetchAll(
      'cattle_processing_batches',
      'select=id,name,actual_process_date,cows_detail,total_live_weight,total_hanging_weight',
    ),
    fetchAll('cattle', 'select=id,tag,old_tags,hanging_weight,processing_batch_id,herd'),
    fetchAll('weigh_in_sessions', 'species=eq.cattle&select=id,date'),
    fetchAll('weigh_ins', 'select=id,session_id,tag,weight,entered_at'),
  ]);
  console.log(
    `  ${batches.length} batches, ${cattle.length} cattle, ${cattleSessions.length} cattle sessions, ${allWIs.length} total weigh_ins`,
  );

  const cattleSessIds = new Set(cattleSessions.map((s) => s.id));
  const sessDateById = new Map(cattleSessions.map((s) => [s.id, s.date]));
  const cattleWIs = allWIs
    .filter((w) => cattleSessIds.has(w.session_id))
    .map((w) => ({
      ...w,
      _date: sessDateById.get(w.session_id) || (w.entered_at || '').slice(0, 10),
    }));

  function latestWeightFor(cow, cutoffDate) {
    const tags = cowTagSet(cow);
    if (tags.size === 0) return null;
    const candidates = cattleWIs
      .filter((w) => tags.has(String(w.tag)))
      .filter((w) => !cutoffDate || w._date <= cutoffDate)
      .sort(
        (a, b) =>
          (b._date || '').localeCompare(a._date || '') || (b.entered_at || '').localeCompare(a.entered_at || ''),
      );
    return candidates[0] ? parseFloat(candidates[0].weight) : null;
  }

  const plan = [];
  for (const b of batches) {
    const linked = cattle.filter((c) => c.processing_batch_id === b.id);
    const cows_detail = linked.map((c) => {
      const live = latestWeightFor(c, b.actual_process_date || null);
      const hanging = c.hanging_weight != null ? parseFloat(c.hanging_weight) : null;
      return {
        cattle_id: c.id,
        tag: c.tag || null,
        live_weight: live,
        hanging_weight: hanging,
      };
    });
    const total_live = cows_detail.reduce((s, r) => s + (parseFloat(r.live_weight) || 0), 0);
    const total_hang = cows_detail.reduce((s, r) => s + (parseFloat(r.hanging_weight) || 0), 0);
    plan.push({
      batch: b,
      cows_detail,
      total_live_weight: total_live > 0 ? Math.round(total_live * 10) / 10 : null,
      total_hanging_weight: total_hang > 0 ? Math.round(total_hang * 10) / 10 : null,
    });
  }

  console.log('\nPlan:');
  for (const p of plan) {
    const liveStr = p.total_live_weight != null ? p.total_live_weight.toLocaleString() + ' lb' : '—';
    const hangStr = p.total_hanging_weight != null ? p.total_hanging_weight.toLocaleString() + ' lb' : '—';
    console.log(
      `  ${p.batch.name.padEnd(24)}  ${p.cows_detail.length} cows  live=${liveStr.padStart(10)}  hanging=${hangStr.padStart(10)}`,
    );
    for (const c of p.cows_detail) {
      const lw = c.live_weight != null ? c.live_weight + ' lb' : '—';
      const hw = c.hanging_weight != null ? c.hanging_weight + ' lb' : '—';
      console.log(`      #${String(c.tag || '?').padEnd(6)}  live=${lw.padStart(10)}  hanging=${hw.padStart(10)}`);
    }
  }

  if (!commit) {
    console.log('\nPreview only. Re-run with --commit to apply.');
    return;
  }

  console.log('\nApplying updates...');
  let ok = 0,
    fail = 0;
  for (const p of plan) {
    const body = {
      cows_detail: p.cows_detail,
      total_live_weight: p.total_live_weight,
      total_hanging_weight: p.total_hanging_weight,
    };
    const pr = await fetch(`${URL}/rest/v1/cattle_processing_batches?id=eq.${encodeURIComponent(p.batch.id)}`, {
      method: 'PATCH',
      headers: H,
      body: JSON.stringify(body),
    });
    if (pr.ok) {
      ok++;
    } else {
      fail++;
      console.error(`  FAIL: ${p.batch.name}: ${pr.status} ${await pr.text()}`);
    }
  }
  console.log(`Done. ${ok} updated, ${fail} failed.`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
