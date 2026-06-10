// Layer Batches filters + sorts.
// Pure module: no React, no Supabase, no browser globals. LayerBatchesView owns
// rendering; this file owns deterministic filter/sort behavior for the layer
// batch list (right-sized — a handful of rows, single active sort rule).
//
// Operates over the SAME shaped rows the view renders + exports: the raw
// layer_batches record (name, status, arrival_date, brooder_entry_date,
// original_count, supplier, cost_per_bird, notes) augmented with the derived
// metrics the hub already computes (current_hens, total_feed_lbs,
// total_mortality, total_dozens, feed_cost). The "start date" anchor mirrors
// the hub's display age math: brooder_entry_date when present, else
// arrival_date.

export const LAYER_BATCH_STATUS_KEYS = Object.freeze(['active', 'retired']);

export const LAYER_BATCH_FILTER_DIMENSIONS = Object.freeze([
  'textSearch',
  'status',
  'supplier',
  'startDateRange',
  'birdCountRange',
]);

export const LAYER_BATCH_SORT_KEYS = Object.freeze(['batchName', 'status', 'startDate', 'birdCount']);

const STATUS_ORDER = ['active', 'retired'];

// Start-date anchor: brooder entry wins, then arrival. Matches the hub tile's
// "months old" anchor so filter/sort agree with what the operator sees.
export function layerBatchStartDate(batch) {
  if (!batch) return null;
  return batch.brooder_entry_date || batch.arrival_date || null;
}

// Bird count = the batch's original placed count. Parsed defensively because
// the column is free-form on older rows.
export function layerBatchBirdCount(batch) {
  if (!batch) return null;
  const n = parseInt(batch.original_count, 10);
  return Number.isFinite(n) ? n : null;
}

export function buildLayerBatchPredicate(filters, _ctx = {}) {
  const f = filters || {};

  return (batch) => {
    if (!batch) return false;

    if (typeof f.status === 'string' && f.status && batch.status !== f.status) return false;

    if (typeof f.supplier === 'string' && f.supplier) {
      const supplier = (batch.supplier || '').toLowerCase();
      if (supplier !== f.supplier.toLowerCase()) return false;
    }

    if (f.startDateRange && (f.startDateRange.after || f.startDateRange.before)) {
      const start = layerBatchStartDate(batch);
      if (!start) return false;
      if (f.startDateRange.after && start < f.startDateRange.after) return false;
      if (f.startDateRange.before && start > f.startDateRange.before) return false;
    }

    if (f.birdCountRange && (f.birdCountRange.min != null || f.birdCountRange.max != null)) {
      const count = layerBatchBirdCount(batch);
      if (count == null) return false;
      if (f.birdCountRange.min != null && count < f.birdCountRange.min) return false;
      if (f.birdCountRange.max != null && count > f.birdCountRange.max) return false;
    }

    if (typeof f.textSearch === 'string' && f.textSearch.trim()) {
      const q = f.textSearch.toLowerCase().trim();
      const fields = [batch.name, batch.id, batch.supplier].map((x) => (x || '').toLowerCase());
      if (!fields.some((x) => x.includes(q))) return false;
    }

    return true;
  };
}

export function buildLayerBatchComparator(sortRule, _ctx = {}) {
  const rule = sortRule && sortRule.key && LAYER_BATCH_SORT_KEYS.includes(sortRule.key) ? sortRule : null;
  if (!rule) return () => 0;
  const dir = rule.dir === 'desc' ? 'desc' : 'asc';

  return (a, b) => compareByKey(rule.key, a || {}, b || {}, dir);
}

function applyDir(cmp, dir) {
  return dir === 'desc' ? -cmp : cmp;
}

function compareByKey(key, a, b, dir) {
  switch (key) {
    case 'batchName': {
      const av = (a.name || '').trim();
      const bv = (b.name || '').trim();
      if (!av && !bv) return 0;
      if (!av) return 1;
      if (!bv) return -1;
      return applyDir(av.localeCompare(bv, undefined, {numeric: true}), dir);
    }
    case 'status': {
      const ai = STATUS_ORDER.indexOf(a.status);
      const bi = STATUS_ORDER.indexOf(b.status);
      return applyDir((ai < 0 ? 999 : ai) - (bi < 0 ? 999 : bi), dir);
    }
    case 'startDate': {
      const av = layerBatchStartDate(a);
      const bv = layerBatchStartDate(b);
      // Missing start date sorts to the end regardless of direction.
      if (!av && !bv) return 0;
      if (!av) return 1;
      if (!bv) return -1;
      return applyDir(av.localeCompare(bv), dir);
    }
    case 'birdCount': {
      const av = layerBatchBirdCount(a);
      const bv = layerBatchBirdCount(b);
      if (av == null && bv == null) return 0;
      if (av == null) return 1;
      if (bv == null) return -1;
      return applyDir(av - bv, dir);
    }
    default:
      return 0;
  }
}
