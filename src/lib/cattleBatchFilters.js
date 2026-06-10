// Cattle processing-batch filters + sort.
// Pure module: no React, no DB client (no `sb`), no browser globals.
// CattleBatchesView owns rendering + data loading; this file owns deterministic
// filter/sort behavior for the processing-batch pipeline (scheduled / active /
// processed).
//
// Right-sized for a small list (a handful to a few dozen rows): a single
// active sort rule {key, dir} and a flat set of high-value dimensions — NOT
// the multi-rule, multi-group chip machinery of cattleHerdFilters.
//
// Rows are the enriched batch rows the view already builds for export
// (status, name, planned_process_date, actual_process_date, animal_count,
// yield_pct). The predicate/comparator read those ACTUAL fields directly so
// filter + sort + CSV/print all agree on one shape.

export const CATTLE_BATCH_STATUS_KEYS = Object.freeze(['scheduled', 'active', 'complete']);

export const CATTLE_BATCH_FILTER_DIMENSIONS = Object.freeze([
  'textSearch',
  'status',
  'plannedDateRange',
  'animalCountRange',
]);

export const CATTLE_BATCH_SORT_KEYS = Object.freeze(['batchName', 'status', 'plannedDate', 'animalCount', 'yieldPct']);

// Pipeline order for the status sort key — mirrors the view's section order
// (scheduled → active → processed). 'complete' is the stored value the UI
// surfaces as "Processed".
const STATUS_ORDER = ['scheduled', 'active', 'complete'];

function animalCountOf(row) {
  const n = Number(row && row.animal_count);
  return Number.isFinite(n) ? n : 0;
}

function yieldPctOf(row) {
  if (!row || row.yield_pct == null || row.yield_pct === '') return null;
  const n = Number(row.yield_pct);
  return Number.isFinite(n) ? n : null;
}

// Effective pipeline date for a batch: actual process date wins, then the
// planned/scheduled date. Used by the plannedDate range filter + sort so a
// scheduled row (planned only) and a processed row (actual) are comparable.
function pipelineDateOf(row) {
  if (!row) return null;
  return row.actual_process_date || row.planned_process_date || null;
}

export function buildCattleBatchPredicate(filters, _ctx = {}) {
  const f = filters || {};

  return (row) => {
    if (!row) return false;

    if (Array.isArray(f.status) && f.status.length > 0) {
      if (!f.status.includes(row.status)) return false;
    }

    if (f.plannedDateRange && (f.plannedDateRange.after || f.plannedDateRange.before)) {
      const d = pipelineDateOf(row);
      if (!d) return false;
      if (f.plannedDateRange.after && d < f.plannedDateRange.after) return false;
      if (f.plannedDateRange.before && d > f.plannedDateRange.before) return false;
    }

    if (f.animalCountRange && (f.animalCountRange.min != null || f.animalCountRange.max != null)) {
      const count = animalCountOf(row);
      if (f.animalCountRange.min != null && count < f.animalCountRange.min) return false;
      if (f.animalCountRange.max != null && count > f.animalCountRange.max) return false;
    }

    if (typeof f.textSearch === 'string' && f.textSearch.trim()) {
      const q = f.textSearch.toLowerCase().trim();
      const fields = [row.name, row.id, row.status, row.notes].map((x) => (x || '').toString().toLowerCase());
      if (!fields.some((x) => x.includes(q))) return false;
    }

    return true;
  };
}

export function buildCattleBatchComparator(sortRule, _ctx = {}) {
  const rule = sortRule && sortRule.key && CATTLE_BATCH_SORT_KEYS.includes(sortRule.key) ? sortRule : null;

  return (a, b) => {
    if (!rule) return 0;
    const dir = rule.dir === 'desc' ? 'desc' : 'asc';
    return compareByKey(rule.key, a, b, dir);
  };
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
      // Numeric-aware compare so batch names like "C-26-2" / "C-26-10" order
      // sensibly without inventing a parse.
      return applyDir(av.localeCompare(bv, undefined, {numeric: true}), dir);
    }
    case 'status': {
      const ai = STATUS_ORDER.indexOf(a.status);
      const bi = STATUS_ORDER.indexOf(b.status);
      return applyDir((ai < 0 ? 999 : ai) - (bi < 0 ? 999 : bi), dir);
    }
    case 'plannedDate': {
      const ad = pipelineDateOf(a);
      const bd = pipelineDateOf(b);
      // Missing date sorts to the end regardless of direction.
      if (!ad && !bd) return 0;
      if (!ad) return 1;
      if (!bd) return -1;
      return applyDir(ad.localeCompare(bd), dir);
    }
    case 'animalCount':
      return applyDir(animalCountOf(a) - animalCountOf(b), dir);
    case 'yieldPct': {
      const av = yieldPctOf(a);
      const bv = yieldPctOf(b);
      // Missing yield (scheduled/active with no hanging weight) sorts to the
      // end regardless of direction.
      if (av == null && bv == null) return 0;
      if (av == null) return 1;
      if (bv == null) return -1;
      return applyDir(av - bv, dir);
    }
    default:
      return 0;
  }
}
