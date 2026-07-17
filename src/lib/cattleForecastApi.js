// Cattle Forecast — Supabase read/write wrappers.
//
// Pure math + state shape lives in src/lib/cattleForecast.js; this module
// owns the side-effectful loads + writes against the three forecast tables
// (mig 043) plus the helpers for converting in-memory state back into the
// row shape expected on disk.
//
// All functions throw on Supabase error so callers handle failure with the
// same try/catch pattern used elsewhere in the cattle module. The view
// layer surfaces error messages to the operator.

import {todayCentralISO} from './dateUtils.js';
import {loadCattleWeighInsCached} from './cattleCache.js';
import {buildForecast, dateToMonthKey, projectPlannedRoster} from './cattleForecast.js';

const SETTINGS_PK = 'global';

// ── settings ─────────────────────────────────────────────────────────────────

// Returns the in-memory shape consumed by buildForecast({...settings}).
// Maps DB column names to the camelCase keys the helper expects, applying
// safe defaults for nulls / unset columns.
function settingsRowToState(row) {
  if (!row) return null;
  return {
    displayMin: row.display_weight_min,
    displayMax: row.display_weight_max,
    fallbackAdg: parseFloat(row.fallback_adg_lb_per_day),
    birthWeight: parseFloat(row.birth_weight_lb),
    horizonYears: row.horizon_years,
    monthlyCapacity: row.monthly_capacity,
    includedHerds: Array.isArray(row.included_herds) ? row.included_herds : [],
    updatedAt: row.updated_at,
    updatedBy: row.updated_by,
  };
}

// State → row shape for upsert (only writeable columns).
function settingsStateToRow(state, updatedBy) {
  return {
    id: SETTINGS_PK,
    display_weight_min: state.displayMin,
    display_weight_max: state.displayMax,
    fallback_adg_lb_per_day: state.fallbackAdg,
    birth_weight_lb: state.birthWeight,
    horizon_years: state.horizonYears,
    monthly_capacity:
      state.monthlyCapacity != null && state.monthlyCapacity !== '' ? parseInt(state.monthlyCapacity, 10) : null,
    included_herds: Array.isArray(state.includedHerds) ? state.includedHerds : [],
    updated_at: new Date().toISOString(),
    updated_by: updatedBy || null,
  };
}

export async function loadForecastSettings(sb) {
  const r = await sb.from('cattle_forecast_settings').select('*').eq('id', SETTINGS_PK).maybeSingle();
  if (r.error) throw new Error('loadForecastSettings: ' + r.error.message);
  return (
    settingsRowToState(r.data) ||
    settingsRowToState({
      display_weight_min: 1200,
      display_weight_max: 1500,
      fallback_adg_lb_per_day: 1.18,
      birth_weight_lb: 64,
      horizon_years: 3,
      monthly_capacity: null,
      included_herds: ['finishers', 'backgrounders'],
    })
  );
}

export async function saveForecastSettings(sb, state, {updatedBy} = {}) {
  const row = settingsStateToRow(state, updatedBy);
  const r = await sb.from('cattle_forecast_settings').upsert(row, {onConflict: 'id'});
  if (r.error) throw new Error('saveForecastSettings: ' + r.error.message);
}

// ── heifer includes ──────────────────────────────────────────────────────────

export async function loadHeiferIncludes(sb) {
  const r = await sb.from('cattle_forecast_heifer_includes').select('cattle_id');
  if (r.error) throw new Error('loadHeiferIncludes: ' + r.error.message);
  return new Set((r.data || []).map((row) => row.cattle_id));
}

// Replace the entire set on Confirm Selections. Empty set is a valid save.
// Implementation: compute additions (in `next` minus current) and removals
// (in current minus `next`); apply both. Avoids deleting + re-inserting the
// rows that didn't change (preserves included_at + included_by audit).
export async function saveHeiferIncludes(sb, nextSet, {includedBy} = {}) {
  const cur = await loadHeiferIncludes(sb);
  const next = nextSet instanceof Set ? nextSet : new Set(nextSet || []);
  const toAdd = [...next].filter((id) => !cur.has(id));
  const toRemove = [...cur].filter((id) => !next.has(id));
  if (toAdd.length > 0) {
    const rows = toAdd.map((id) => ({
      cattle_id: id,
      included_at: new Date().toISOString(),
      included_by: includedBy || null,
    }));
    const r = await sb.from('cattle_forecast_heifer_includes').insert(rows);
    if (r.error) throw new Error('saveHeiferIncludes (insert): ' + r.error.message);
  }
  if (toRemove.length > 0) {
    const r = await sb.from('cattle_forecast_heifer_includes').delete().in('cattle_id', toRemove);
    if (r.error) throw new Error('saveHeiferIncludes (delete): ' + r.error.message);
  }
}

// ── per-cow per-month hidden ──────────────────────────────────────────────────

export async function loadHidden(sb) {
  const r = await sb.from('cattle_forecast_hidden').select('cattle_id, month_key, hidden_at, hidden_by');
  if (r.error) throw new Error('loadHidden: ' + r.error.message);
  return r.data || [];
}

export async function addHidden(sb, {cattleId, monthKey, hiddenBy}) {
  const r = await sb.from('cattle_forecast_hidden').insert({
    cattle_id: cattleId,
    month_key: monthKey,
    hidden_at: new Date().toISOString(),
    hidden_by: hiddenBy || null,
  });
  if (r.error) throw new Error('addHidden: ' + r.error.message);
}

export async function removeHidden(sb, {cattleId, monthKey}) {
  const r = await sb.from('cattle_forecast_hidden').delete().eq('cattle_id', cattleId).eq('month_key', monthKey);
  if (r.error) throw new Error('removeHidden: ' + r.error.message);
}

// ── shared forecast bundle + projected-roster loader ─────────────────────────

// Load every input buildForecast needs, in one place, for the surfaces that
// don't already hold them (cattle batch record page, forecast-only batch
// detail, Processing Drawer cattle Source details). FAIL-CLOSED: any read
// error throws — callers must render an explicit unavailable state instead
// of projecting from partial inputs (a missing hidden/includes/settings read
// would silently change cohort membership).
export async function loadCattleForecastBundle(sb) {
  const [cattleR, weighIns, settings, includes, hidden, batchesR] = await Promise.all([
    sb.from('cattle').select('*').is('deleted_at', null),
    // throwOnError: a raced/errored weigh-ins read must fail this loader —
    // the soft [] fallback would silently project every cow from its DOB
    // fallback (fabricated weights) instead of real weigh-in anchors.
    loadCattleWeighInsCached(sb, {throwOnError: true}),
    loadForecastSettings(sb),
    loadHeiferIncludes(sb),
    loadHidden(sb),
    sb.from('cattle_processing_batches').select('*'),
  ]);
  if (cattleR.error) throw new Error('loadCattleForecastBundle (cattle): ' + cattleR.error.message);
  if (batchesR.error) throw new Error('loadCattleForecastBundle (batches): ' + batchesR.error.message);
  const batches = batchesR.data || [];
  return {
    cattle: cattleR.data || [],
    weighIns: weighIns || [],
    settings,
    includes,
    hidden,
    batches,
    realBatches: batches.filter((b) => b.status === 'active' || b.status === 'complete'),
    scheduledBatches: batches.filter((b) => b.status === 'scheduled'),
  };
}

// Build the forecast from a loaded bundle. Thin composition helper so every
// caller passes the SAME partitioned inputs (no surface can accidentally
// leak scheduled rows into realBatches or vice versa).
export function forecastFromBundle(bundle, {todayMs = Date.now()} = {}) {
  return buildForecast({
    cattle: bundle.cattle,
    weighIns: bundle.weighIns,
    settings: bundle.settings,
    includes: bundle.includes,
    hidden: bundle.hidden,
    realBatches: bundle.realBatches,
    scheduledBatches: bundle.scheduledBatches,
    todayMs,
  });
}

// Projected roster for one PERSISTED scheduled batch, resolved through the
// canonical forecast math (buildForecast → projectPlannedRoster). Used by the
// cattle batch record page and the Processing Drawer so both render the exact
// rows/totals the consolidated Planned list shows. Returns:
//   {ok:true, batch, monthKey, roster, sequenceName}   — roster from
//       projectPlannedRoster; sequenceName is the reconciliation-derived
//       display name (may differ from the stored name until the management
//       reconcile pass lands; stored name is authoritative for the record).
//   {ok:false, reason, batch?}                          — fail-closed.
export async function loadProjectedRosterForScheduledBatch(sb, batchId, {todayMs = Date.now()} = {}) {
  const bundle = await loadCattleForecastBundle(sb);
  const batch = bundle.batches.find((b) => b && b.id === batchId) || null;
  if (!batch) return {ok: false, reason: 'batch_not_found'};
  if (batch.status !== 'scheduled') return {ok: false, reason: 'not_scheduled', batch};
  const monthKey = dateToMonthKey(batch.planned_process_date);
  if (!monthKey) return {ok: false, reason: 'no_planned_date', batch};
  const forecast = forecastFromBundle(bundle, {todayMs});
  const roster = projectPlannedRoster(forecast, monthKey);
  if (!roster.ok) return {ok: false, reason: roster.reason, batch};
  const enriched = (forecast.scheduledBatches || []).find((s) => s && s.id === batchId) || null;
  return {ok: true, batch, monthKey, roster, sequenceName: enriched ? enriched.name : batch.name};
}

// ── batch state-machine helpers ───────────────────────────────────────────────

// Mark an active batch complete. Caller is responsible for verifying every
// cow has hanging_weight > 0 (use batchHasAllHangingWeights from the pure
// helper). actual_process_date resolves to the caller-supplied date when
// truthy, otherwise today in America/Chicago — never null, so the
// Processed section always renders a date.
export async function markBatchComplete(sb, batchId, {processedDate} = {}) {
  const update = {
    status: 'complete',
    actual_process_date: processedDate || todayCentralISO(),
  };
  const r = await sb.from('cattle_processing_batches').update(update).eq('id', batchId);
  if (r.error) throw new Error('markBatchComplete: ' + r.error.message);
}

// Reopen a complete batch back to active. Keeps existing cows_detail +
// hanging weights; admin can edit them. Does NOT clear actual_process_date.
export async function reopenBatch(sb, batchId) {
  const r = await sb.from('cattle_processing_batches').update({status: 'active'}).eq('id', batchId);
  if (r.error) throw new Error('reopenBatch: ' + r.error.message);
}
