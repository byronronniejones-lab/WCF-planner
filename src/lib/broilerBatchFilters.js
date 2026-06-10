// Broiler Batches filters + single-rule sort.
// Pure module: no React, no DB client (no `sb`), no browser globals. BroilerListView owns
// rendering; this file owns deterministic filter/sort behavior over the broiler
// batch records (app_store ppp-v4 shape).
//
// Right-sized for a small list (a handful to a few dozen batches): one active
// sort rule {key, dir}, a name/id text search, a status filter over the real
// planned/active/processed statuses, plus breed + start-date-range filters.
//
// "Status" here is the EFFECTIVE poultry status. Callers pass a per-row
// resolver via ctx.statusOf (BroilerListView wires it to calcPoultryStatus) so
// the filter/sort agree with the badge the row renders. "lbsProduced" sorts by
// total feed produced; callers supply it via ctx.totalFeedLbsOf because feed is
// derived from daily reports the lib does not own.

export const BROILER_BATCH_STATUSES = Object.freeze(['planned', 'active', 'processed']);

export const BROILER_BATCH_FILTER_DIMENSIONS = Object.freeze(['status', 'breed', 'startDateRange', 'textSearch']);

export const BROILER_BATCH_SORT_KEYS = Object.freeze(['batchName', 'status', 'startDate', 'birdCount', 'lbsProduced']);

const STATUS_ORDER = ['planned', 'active', 'processed'];

function statusFor(batch, ctx) {
  if (ctx && typeof ctx.statusOf === 'function') return ctx.statusOf(batch);
  return (batch && batch.status) || '';
}

function totalFeedLbsFor(batch, ctx) {
  if (ctx && typeof ctx.totalFeedLbsOf === 'function') {
    const v = ctx.totalFeedLbsOf(batch);
    return Number.isFinite(v) ? v : null;
  }
  return null;
}

function startDateFor(batch) {
  // Broiler batches anchor on the hatch date — there is no separate start_date
  // field. Hatch day is brooder-in (day 0), so it is the batch's start.
  return (batch && batch.hatchDate) || null;
}

export function buildBroilerBatchPredicate(filters, ctx = {}) {
  const f = filters || {};

  return (batch) => {
    if (!batch) return false;

    if (Array.isArray(f.status) && f.status.length > 0) {
      if (!f.status.includes(statusFor(batch, ctx))) return false;
    }

    if (Array.isArray(f.breed) && f.breed.length > 0) {
      const breed = (batch.breed || '').toLowerCase();
      if (!f.breed.some((b) => (b || '').toLowerCase() === breed)) return false;
    }

    if (f.startDateRange && (f.startDateRange.after || f.startDateRange.before)) {
      const start = startDateFor(batch);
      if (!start) return false;
      if (f.startDateRange.after && start < f.startDateRange.after) return false;
      if (f.startDateRange.before && start > f.startDateRange.before) return false;
    }

    if (typeof f.textSearch === 'string' && f.textSearch.trim()) {
      const q = f.textSearch.toLowerCase().trim();
      const fields = [batch.name, batch.breed, batch.hatchery, batch.schooner, batch.brooder].map((x) =>
        (x || '').toString().toLowerCase(),
      );
      if (!fields.some((x) => x.includes(q))) return false;
    }

    return true;
  };
}

export function buildBroilerBatchComparator(sortRule, ctx = {}) {
  const rule =
    sortRule && sortRule.key && BROILER_BATCH_SORT_KEYS.includes(sortRule.key)
      ? sortRule
      : {key: 'batchName', dir: 'asc'};
  const dir = rule.dir === 'desc' ? 'desc' : 'asc';

  return (a, b) => compareByKey(rule.key, a, b, dir, ctx);
}

function applyDir(cmp, dir) {
  return dir === 'desc' ? -cmp : cmp;
}

function compareByKey(key, a, b, dir, ctx) {
  switch (key) {
    case 'batchName': {
      const an = (a.name || '').trim();
      const bn = (b.name || '').trim();
      if (!an && !bn) return 0;
      if (!an) return 1;
      if (!bn) return -1;
      // Natural-ish compare so B-26-2 sorts before B-26-10.
      return applyDir(an.localeCompare(bn, undefined, {numeric: true, sensitivity: 'base'}), dir);
    }
    case 'status': {
      const ai = STATUS_ORDER.indexOf(statusFor(a, ctx));
      const bi = STATUS_ORDER.indexOf(statusFor(b, ctx));
      return applyDir((ai < 0 ? 999 : ai) - (bi < 0 ? 999 : bi), dir);
    }
    case 'startDate': {
      const ad = startDateFor(a);
      const bd = startDateFor(b);
      if (!ad && !bd) return 0;
      if (!ad) return 1;
      if (!bd) return -1;
      return applyDir(ad.localeCompare(bd), dir);
    }
    case 'birdCount': {
      const av = parseFloat(a.birdCount);
      const bv = parseFloat(b.birdCount);
      const an = Number.isFinite(av) ? av : null;
      const bn = Number.isFinite(bv) ? bv : null;
      if (an == null && bn == null) return 0;
      if (an == null) return 1;
      if (bn == null) return -1;
      return applyDir(an - bn, dir);
    }
    case 'lbsProduced': {
      const av = totalFeedLbsFor(a, ctx);
      const bv = totalFeedLbsFor(b, ctx);
      if (av == null && bv == null) return 0;
      if (av == null) return 1;
      if (bv == null) return -1;
      return applyDir(av - bv, dir);
    }
    default:
      return 0;
  }
}

// Breed dropdown options = active breed codes (the four known breed styles) plus
// any distinct breed code observed on the batches, so legacy/historical codes
// still surface. Returns [{code, label}] sorted by label.
export function broilerBreedFilterOptions(observedFromBatches, breedLabelFn) {
  const labelFor = typeof breedLabelFn === 'function' ? breedLabelFn : (code) => code || '';
  const seen = new Set();
  const out = [];
  for (const code of ['CC', 'WR', 'FR', 'CY']) {
    seen.add(code.toLowerCase());
    out.push({code, label: labelFor(code)});
  }
  for (const value of observedFromBatches || []) {
    if (!value) continue;
    const key = String(value).toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({code: value, label: labelFor(value)});
  }
  out.sort((a, b) => a.label.localeCompare(b.label));
  return out;
}
