// ============================================================================
// newsletterHarvestShape — DB-row → detector-input shaping (CP-C autopilot).
// ----------------------------------------------------------------------------
// Pure ESM. NO imports. NO Node/Deno APIs. NO `Date` use (period windowing is
// the detectors' job; this module only reshapes already-queried rows). Runs
// identically in vitest (Node) and the newsletter-harvest Edge Function (Deno).
//
// Source-of-truth copy lives at src/lib; a byte-identical copy lives at
//   supabase/functions/_shared/newsletterHarvestShape.js
// Drift is locked by tests/static/newsletter_shared_parity.test.js.
//
// WHY THIS MODULE EXISTS: the Edge Function runs the service-role SQL (the
// per-source WHERE filters), but the *transforms* that are easy to get subtly
// wrong — born-alive subtraction (the mortality boundary), egg-group summing,
// herd/flock grouping, and source-coverage classification — are pure and live
// here so they are fully unit-tested in Node, not only exercised post-deploy.
//
// MORTALITY BOUNDARY (load-bearing): births are reported BORN-ALIVE ONLY.
// shapeBirths computes max(0, total_born - deaths) and DROPS any record with no
// surviving young, so a positive-PR newsletter can never imply a death. This is
// the cattle/sheep parallel to the pig detector's born-alive-only rule.
// ============================================================================

function num(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function str(v) {
  if (v == null) return '';
  return String(v).trim();
}

function asArray(v) {
  return Array.isArray(v) ? v : [];
}

// Surviving young from a birth/calving/lambing row. Never negative; deaths are
// subtracted so stillborn/perinatal loss is never counted as a live birth.
export function bornAlive(totalBorn, deaths) {
  return Math.max(0, num(totalBorn) - num(deaths));
}

// Group already-active head rows by their herd/flock field into the
// [{name, headCount}] shape detectCattleOnFarm / detectSheepOnFarm expect. Each
// row is one animal (head). Rows are pre-filtered by the Edge Function SQL to
// exclude archived/deleted/sold/dead/processed animals, so this is a pure tally.
export function shapeHeadCounts(rows, groupField) {
  const counts = new Map();
  for (const r of asArray(rows)) {
    const key = str(r && r[groupField]) || 'unknown';
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  const out = [];
  for (const [name, headCount] of counts) out.push({name, headCount});
  return out;
}

// Map calving/lambing rows to the births detector shape, BORN-ALIVE ONLY.
// opts: { dateField, totalField='total_born', deathsField='deaths', damField='dam_tag' }
// Records with zero surviving young are dropped entirely.
export function shapeBirths(rows, opts) {
  const o = opts || {};
  const dateField = o.dateField || 'date';
  const totalField = o.totalField || 'total_born';
  const deathsField = o.deathsField || 'deaths';
  const damField = o.damField || 'dam_tag';
  const out = [];
  for (const r of asArray(rows)) {
    if (!r || typeof r !== 'object') continue;
    const alive = bornAlive(r[totalField], r[deathsField]);
    if (alive <= 0) continue; // born-alive only — never surface a loss
    out.push({date: str(r[dateField]), count: alive, dam: str(r[damField])});
  }
  return out;
}

// Sum the four egg-collection group columns per daily row into the
// [{date, eggs}] shape detectLayerEggs expects. Mirrors productionApi's
// egg_dailys read (group1..4_count, deleted_at filtered upstream).
export function shapeEggDailys(rows) {
  const out = [];
  for (const r of asArray(rows)) {
    if (!r || typeof r !== 'object') continue;
    const eggs = num(r.group1_count) + num(r.group2_count) + num(r.group3_count) + num(r.group4_count);
    out.push({date: str(r.date), eggs});
  }
  return out;
}

// Pasture move events → [{date, animalType, groupLabel, count, toAreaId}].
// Moves with no destination area (orphaned after an area delete, mig 149) are
// dropped — they are not a real "moved the herd to X" story.
export function shapePastureMoves(rows) {
  const out = [];
  for (const r of asArray(rows)) {
    if (!r || typeof r !== 'object') continue;
    if (r.to_land_area_id == null) continue;
    out.push({
      date: str(r.moved_at).slice(0, 10),
      animalType: str(r.animal_type),
      groupLabel: str(r.group_label) || str(r.group_key),
      count: num(r.animal_count),
      toAreaId: str(r.to_land_area_id),
    });
  }
  return out;
}

// Daily submissions → [{date, program, teamMember}].
export function shapeDailySubmissions(rows) {
  const out = [];
  for (const r of asArray(rows)) {
    if (!r || typeof r !== 'object') continue;
    out.push({date: str(r.date), program: str(r.program), teamMember: str(r.team_member)});
  }
  return out;
}

// Completed task rows → [{date, title, designation, fromRecurring, submissionSource}].
// The detector decides which are "notable"; this is a pure reshape.
export function shapeCompletedTasks(rows) {
  const out = [];
  for (const r of asArray(rows)) {
    if (!r || typeof r !== 'object') continue;
    out.push({
      date: str(r.completed_at).slice(0, 10),
      title: str(r.title),
      designation: str(r.designation),
      fromRecurring: r.from_recurring_template === true,
      submissionSource: str(r.submission_source),
    });
  }
  return out;
}

// Processing batches → [{date, name, hangingWeightLbs}]. NEVER carries cost or
// any finance field (the finance/mortality denylist would drop it anyway, but we
// don't even read those columns). Used for a yield/production accomplishment.
export function shapeProcessingBatches(rows) {
  const out = [];
  for (const r of asArray(rows)) {
    if (!r || typeof r !== 'object') continue;
    out.push({
      date: str(r.actual_process_date),
      name: str(r.name),
      hangingWeightLbs: num(r.total_hanging_weight),
    });
  }
  return out;
}

// ── Source coverage classification ──────────────────────────────────────────
// One honest entry per source the harvest tried to scan. status:
//   scanned     — source available, produced ≥1 fact (count = factCount)
//   empty       — source available, no notable data this period (count = rowCount)
//   unavailable — source not present (missing app_store key / missing relation)
//   error       — the scan threw (detail carries the message)
export function coverageEntry(key, label, info) {
  const i = info || {};
  if (i.error) {
    return {key, label, status: 'error', count: 0, detail: String(i.error).slice(0, 200)};
  }
  if (i.available === false) {
    return {key, label, status: 'unavailable', count: 0, detail: i.detail || 'source not available'};
  }
  // "scanned" when the source returned rows (or produced facts); else "empty".
  const n = num(i.factCount) || num(i.rowCount);
  if (n > 0) {
    return {key, label, status: 'scanned', count: n, detail: i.detail || ''};
  }
  return {key, label, status: 'empty', count: 0, detail: i.detail || 'nothing notable this period'};
}
