// Sheep Batches (processing batches) filters + sorts.
// Pure module: no React, no Supabase, no browser globals. SheepBatchesView owns
// rendering + data loading; this file owns deterministic filter/sort behavior.
//
// Right-sized for a small list (a handful to a few dozen batches): a single
// active sort rule {key, dir} and a flat set of filter dimensions — NOT the
// multi-rule / multi-group chip machinery the cattle-herds animal list needs.
//
// Predicate + comparator operate on the AUGMENTED batch row the view feeds to
// render/export: the persisted sheep_processing_batches columns (name, status,
// planned_process_date, actual_process_date, notes) plus the per-batch derived
// fields animal_count / total_live_weight / total_hanging_weight / yield_pct.

export const SHEEP_BATCH_STATUS_KEYS = Object.freeze(['planned', 'complete']);

export const SHEEP_BATCH_SORT_KEYS = Object.freeze(['batchName', 'status', 'plannedDate', 'animalCount', 'yieldPct']);

export const SHEEP_BATCH_FILTER_DIMENSIONS = Object.freeze([
  'textSearch',
  'status',
  'plannedDateRange',
  'animalCountRange',
]);

const STATUS_ORDER = ['planned', 'complete'];

function normalizeStatus(row) {
  return row && row.status ? row.status : 'planned';
}

function animalCountOf(row) {
  // Prefer the augmented animal_count; fall back to the raw sheep_detail length
  // for un-augmented rows. Guard null/'' before Number() (Number(null) === 0).
  const raw = row ? row.animal_count : null;
  if (raw != null && raw !== '') {
    const n = Number(raw);
    if (Number.isFinite(n)) return n;
  }
  return Array.isArray(row && row.sheep_detail) ? row.sheep_detail.length : 0;
}

function yieldPctOf(row) {
  // yield_pct is null when a batch has no live+hanging weights yet — treat that
  // (and undefined / '') as missing so it sorts to the end, NOT as 0. Number(null)
  // coerces to 0, so guard the empties before coercing.
  const raw = row ? row.yield_pct : null;
  if (raw == null || raw === '') return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

export function buildSheepBatchPredicate(filters, ctx = {}) {
  const f = filters || {};
  // ctx is accepted for parity with the house pattern (todayMs, etc.); the
  // batch list filters are self-contained on the augmented row today.
  void ctx;

  return (row) => {
    if (!row) return false;

    if (Array.isArray(f.status) && f.status.length > 0 && !f.status.includes(normalizeStatus(row))) return false;

    if (f.plannedDateRange && (f.plannedDateRange.after || f.plannedDateRange.before)) {
      const d = row.planned_process_date;
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
      const fields = [row.name, row.id, row.notes].map((x) => (x == null ? '' : String(x).toLowerCase()));
      if (!fields.some((x) => x.includes(q))) return false;
    }

    return true;
  };
}

export function buildSheepBatchComparator(sortRule, ctx = {}) {
  void ctx;
  const rule =
    sortRule && sortRule.key && SHEEP_BATCH_SORT_KEYS.includes(sortRule.key)
      ? sortRule
      : {key: 'plannedDate', dir: 'desc'};
  const dir = rule.dir === 'desc' ? 'desc' : 'asc';
  return (a, b) => compareByKey(rule.key, a, b, dir);
}

function applyDir(cmp, dir) {
  return dir === 'desc' ? -cmp : cmp;
}

function compareByKey(key, a, b, dir) {
  switch (key) {
    case 'batchName': {
      const an = (a.name || '').trim();
      const bn = (b.name || '').trim();
      if (!an && !bn) return 0;
      if (!an) return 1;
      if (!bn) return -1;
      return applyDir(an.localeCompare(bn, undefined, {numeric: true}), dir);
    }
    case 'status': {
      const ai = STATUS_ORDER.indexOf(normalizeStatus(a));
      const bi = STATUS_ORDER.indexOf(normalizeStatus(b));
      return applyDir((ai < 0 ? 999 : ai) - (bi < 0 ? 999 : bi), dir);
    }
    case 'plannedDate': {
      const ad = a.planned_process_date || null;
      const bd = b.planned_process_date || null;
      if (!ad && !bd) return 0;
      if (!ad) return 1;
      if (!bd) return -1;
      return applyDir(ad.localeCompare(bd), dir);
    }
    case 'animalCount':
      return applyDir(animalCountOf(a) - animalCountOf(b), dir);
    case 'yieldPct': {
      const ay = yieldPctOf(a);
      const by = yieldPctOf(b);
      if (ay == null && by == null) return 0;
      if (ay == null) return 1;
      if (by == null) return -1;
      return applyDir(ay - by, dir);
    }
    default:
      return 0;
  }
}
