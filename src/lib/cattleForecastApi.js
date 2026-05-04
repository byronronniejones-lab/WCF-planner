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

// ── batch state-machine helpers ───────────────────────────────────────────────

// Mark an active batch complete. Caller is responsible for verifying every
// cow has hanging_weight > 0 (use batchHasAllHangingWeights from the pure
// helper). actual_process_date is set to weigh_in_sessions.date when the
// batch was created via Send-to-Processor; manual completion uses the
// caller-supplied date or today.
export async function markBatchComplete(sb, batchId, {processedDate} = {}) {
  const update = {status: 'complete'};
  if (processedDate && !update.actual_process_date) {
    update.actual_process_date = processedDate;
  }
  const r = await sb.from('cattle_processing_batches').update(update).eq('id', batchId);
  if (r.error) throw new Error('markBatchComplete: ' + r.error.message);
}

// Reopen a complete batch back to active. Keeps existing cows_detail +
// hanging weights; admin can edit them. Does NOT clear actual_process_date.
export async function reopenBatch(sb, batchId) {
  const r = await sb.from('cattle_processing_batches').update({status: 'active'}).eq('id', batchId);
  if (r.error) throw new Error('reopenBatch: ' + r.error.message);
}
