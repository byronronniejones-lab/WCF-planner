// Broiler Batches filters + single-rule sort.
// Pure module: no React, no DB client (no `sb`), no browser globals. BroilerListView owns
// rendering; this file owns deterministic filter/sort behavior over the broiler
// batch records (app_store ppp-v4 shape).
//
// Right-sized for a small list (a handful to a few dozen batches): one active
// sort rule {key, dir}, a name/id text search, and a set of real-field filters
// over the planned/active/processed batches — status, breed, hatchery, brooder,
// schooner, hatch (start) date range, processing date range, and numeric ranges
// for bird count, birds arrived, to-processor count, cumulative mortality, and
// lbs produced.
//
// "Status" here is the EFFECTIVE poultry status. Callers pass a per-row
// resolver via ctx.statusOf (BroilerListView wires it to calcPoultryStatus) so
// the filter/sort agree with the badge the row renders. "lbsProduced" reads
// total feed produced via ctx.totalFeedLbsOf because feed is derived from daily
// reports the lib does not own.

export const BROILER_BATCH_STATUSES = Object.freeze(['planned', 'active', 'processed']);

export const BROILER_BATCH_FILTER_DIMENSIONS = Object.freeze([
  'textSearch',
  'status',
  'breed',
  'hatchery',
  'brooder',
  'schooner',
  'startDateRange',
  'processingDateRange',
  'birdCountRange',
  'birdsArrivedRange',
  'toProcessorRange',
  'mortalityRange',
  'lbsProducedRange',
]);

export const BROILER_BATCH_SORT_KEYS = Object.freeze([
  'batchName',
  'status',
  'startDate',
  'processingDate',
  'birdCount',
  'lbsProduced',
]);

// Default: processed batches newest-first (processing date descending). Batches
// without a processing date (planned/active) always sort last, in stable order.
export const BROILER_BATCH_DEFAULT_SORT = Object.freeze({key: 'processingDate', dir: 'desc'});

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

function numField(batch, key) {
  const v = parseFloat(batch && batch[key]);
  return Number.isFinite(v) ? v : null;
}

// A numeric-range filter is {min, max} (either bound optional). A row with no
// value is excluded whenever any bound is set — a range filter only matches rows
// that actually have a value inside it (so a processing-date range never matches
// a planned batch, etc.).
function inNumRange(value, range) {
  if (!range) return true;
  const hasMin = range.min != null && range.min !== '';
  const hasMax = range.max != null && range.max !== '';
  if (!hasMin && !hasMax) return true;
  if (value == null) return false;
  if (hasMin && value < Number(range.min)) return false;
  if (hasMax && value > Number(range.max)) return false;
  return true;
}

// A date-range filter is {after, before} (ISO yyyy-mm-dd strings, either bound
// optional). A row with no date is excluded whenever any bound is set.
function inDateRange(date, range) {
  if (!range) return true;
  const hasAfter = !!range.after;
  const hasBefore = !!range.before;
  if (!hasAfter && !hasBefore) return true;
  if (!date) return false;
  if (hasAfter && date < range.after) return false;
  if (hasBefore && date > range.before) return false;
  return true;
}

// A multi-select filter is an array of accepted values (case-insensitive). An
// empty/absent array matches everything.
function arrayMatch(filterArr, value) {
  if (!Array.isArray(filterArr) || filterArr.length === 0) return true;
  const v = (value || '').toString().toLowerCase();
  return filterArr.some((x) => (x || '').toString().toLowerCase() === v);
}

export function buildBroilerBatchPredicate(filters, ctx = {}) {
  const f = filters || {};

  return (batch) => {
    if (!batch) return false;

    if (!arrayMatch(f.status, statusFor(batch, ctx))) return false;
    if (!arrayMatch(f.breed, batch.breed)) return false;
    if (!arrayMatch(f.hatchery, batch.hatchery)) return false;
    if (!arrayMatch(f.brooder, batch.brooder)) return false;
    if (!arrayMatch(f.schooner, batch.schooner)) return false;

    if (!inDateRange(startDateFor(batch), f.startDateRange)) return false;
    if (!inDateRange((batch && batch.processingDate) || null, f.processingDateRange)) return false;

    if (!inNumRange(numField(batch, 'birdCount'), f.birdCountRange)) return false;
    if (!inNumRange(numField(batch, 'birdCountActual'), f.birdsArrivedRange)) return false;
    if (!inNumRange(numField(batch, 'totalToProcessor'), f.toProcessorRange)) return false;
    if (!inNumRange(numField(batch, 'mortalityCumulative'), f.mortalityRange)) return false;
    if (!inNumRange(totalFeedLbsFor(batch, ctx), f.lbsProducedRange)) return false;

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
      : {...BROILER_BATCH_DEFAULT_SORT};
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
    case 'processingDate': {
      // Processed batches sort by processing date; batches without one
      // (planned/active) always fall to the end, regardless of direction, so the
      // processed-history section keeps its newest-first default.
      const ad = (a && a.processingDate) || '';
      const bd = (b && b.processingDate) || '';
      if (!ad && !bd) return 0;
      if (!ad) return 1;
      if (!bd) return -1;
      return applyDir(ad.localeCompare(bd), dir);
    }
    case 'birdCount': {
      const an = numField(a, 'birdCount');
      const bn = numField(b, 'birdCount');
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

// Distinct non-empty values for a batch field (hatchery / brooder / schooner),
// sorted, for populating a multi-select filter. Pure helper over the batch list.
export function broilerDistinctFieldValues(batches, key) {
  const seen = new Set();
  const out = [];
  for (const batch of batches || []) {
    const value = batch && batch[key];
    if (value == null || value === '') continue;
    const str = String(value).trim();
    if (!str) continue;
    const lower = str.toLowerCase();
    if (seen.has(lower)) continue;
    seen.add(lower);
    out.push(str);
  }
  out.sort((a, b) => a.localeCompare(b, undefined, {sensitivity: 'base'}));
  return out;
}
