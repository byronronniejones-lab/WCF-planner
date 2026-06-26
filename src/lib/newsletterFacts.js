// ============================================================================
// newsletterFacts — Monthly Newsletter fact detectors (CP-B).
// ----------------------------------------------------------------------------
// Pure ESM. NO imports. NO Node/Deno APIs. NO `Date` use (the reporting period
// is passed in as 'YYYY-MM-DD' strings, and ISO date strings sort
// lexicographically, so all windowing is plain string/number math). This keeps
// the module deterministic and identically runnable in vitest (Node) and the
// newsletter-harvest Edge Function (Deno).
//
// Source-of-truth for the detector algorithm. A byte-identical copy lives at
//   supabase/functions/_shared/newsletterFacts.js
// (the Edge Function imports the shared copy via Deno's relative ESM
// resolution). Drift is locked by tests/static/newsletter_shared_parity.test.js.
//
// CONTRACT — detectNewsletterFacts(input) -> Fact[]
//   input = {
//     period:           { yearMonth, start, end },   // 'YYYY-MM' + two 'YYYY-MM-DD'
//     broilerBatches:   [...],   // app_store 'ppp-v4'
//     pigFeederGroups:  [...],   // app_store 'ppp-feeders-v1'
//     pigFarrowings:    [...],   // app_store 'ppp-farrowing-v1'
//     cattleHerds:      [...],   // optional
//     sheepFlocks:      [...],   // optional
//     layerProduction:  [...],   // optional egg-collection records
//   }
//   Fact = {
//     detectorKey, program, title, summary, metricValue, displayValue,
//     sourceRefs:[...], comparison:{}, confidence:'high'|'medium'|'low',
//     evidence:{...},
//   }
//
// EDITORIAL BOUNDARY (locked by the Monthly Newsletter contract):
//   The newsletter is fact-based POSITIVE PR. Detectors emit ONLY good-news,
//   evidence-backed accomplishments. They NEVER read or emit finances or
//   mortalities. assertNoForbiddenFacts() is a defense-in-depth final filter:
//   any candidate whose text trips the finance/mortality denylist is dropped
//   (the DB ingest RPC re-checks the same boundary).
// ============================================================================

// ── Finance / mortality boundary (defense in depth) ─────────────────────────
// Matches whole words so "processed" / "production" are NOT caught while
// "mortality" / "price" are. Processing & production are accomplishments and
// stay allowed; sales/prices/costs (finance) and deaths (mortality) are out.
const FORBIDDEN_FACT_RE =
  /\b(?:mortalit(?:y|ies)|died|death|deaths|dead|deceased|perished|cull|culled|culls|loss|losses|price|priced|pricing|cost|costs|revenue|profit|profits|income|expense|expenses|dollar|dollars|sale|sales|sold|invoice|invoiced|paid|payment|earnings)\b/i;

export function isForbiddenFact(fact) {
  if (!fact || typeof fact !== 'object') return true;
  const haystack = `${fact.title || ''} ${fact.summary || ''} ${fact.displayValue || ''} ${fact.program || ''} ${fact.detectorKey || ''}`;
  return FORBIDDEN_FACT_RE.test(haystack) || /\$/.test(haystack);
}

// ── Small pure helpers ──────────────────────────────────────────────────────

function str(v) {
  if (v == null) return '';
  return String(v).trim();
}

function firstNum(obj, keys) {
  if (!obj || typeof obj !== 'object') return 0;
  for (const k of keys) {
    if (obj[k] != null && Number.isFinite(Number(obj[k]))) return Number(obj[k]);
  }
  return 0;
}

function firstStr(obj, keys) {
  if (!obj || typeof obj !== 'object') return '';
  for (const k of keys) {
    const s = str(obj[k]);
    if (s) return s;
  }
  return '';
}

// Normalize any value to a 'YYYY-MM-DD' string (or '' if not a date).
function isoDay(v) {
  const s = str(v).slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : '';
}

// Inclusive period membership using lexical compare on ISO day strings.
function inPeriod(dateStr, period) {
  const d = isoDay(dateStr);
  if (!d || !period) return false;
  return d >= str(period.start) && d <= str(period.end);
}

function asArray(v) {
  return Array.isArray(v) ? v : [];
}

const BROILER_COUNT_KEYS = [
  'birdsOnFarm',
  'currentCount',
  'count',
  'birdCount',
  'birds',
  'placed',
  'quantity',
  'headCount',
];
const BROILER_PROCESSED_KEYS = ['processedCount', 'birdsProcessed', 'processed', 'dressedCount', 'count', 'quantity'];
const PIG_HEAD_KEYS = ['headCount', 'currentCount', 'count', 'pigsOnFarm', 'head', 'quantity'];
// Born-alive ONLY. We never fall back to totalBorn/litterSize, which include
// stillborn — publishing those as "piglets born alive" would be a mortality leak.
const PIG_BORN_ALIVE_KEYS = ['bornAlive', 'liveBorn', 'liveBirths', 'pigletsBornAlive', 'alive'];
const CATTLE_HEAD_KEYS = ['headCount', 'currentCount', 'count', 'head', 'animals', 'quantity'];
const SHEEP_HEAD_KEYS = ['headCount', 'currentCount', 'count', 'head', 'animals', 'quantity'];

function isBroilerActive(batch) {
  const status = firstStr(batch, ['status']).toLowerCase();
  if (status === 'processed' || status === 'inactive' || status === 'removed' || status === 'archived') return false;
  return true;
}

function pluralBirds(n) {
  return `${n} bird${n === 1 ? '' : 's'}`;
}

// ── Detectors ───────────────────────────────────────────────────────────────
// Each returns a Fact or null. A null means "no positive, evidence-backed story
// this month" (insufficient data, zero metric, etc.) and is dropped.

export function detectBroilerOnFarm(input) {
  const batches = asArray(input.broilerBatches).filter(isBroilerActive);
  let total = 0;
  const ids = [];
  for (const b of batches) {
    const c = firstNum(b, BROILER_COUNT_KEYS);
    if (c > 0) {
      total += c;
      ids.push(firstStr(b, ['name', 'batchName', 'id']));
    }
  }
  if (total <= 0) return null;
  return {
    detectorKey: 'broiler_on_farm',
    program: 'broiler',
    title: 'Broilers on the farm',
    summary: `${pluralBirds(total)} across ${ids.length} active flock${ids.length === 1 ? '' : 's'} at month end.`,
    metricValue: total,
    displayValue: pluralBirds(total),
    sourceRefs: [{module: 'ppp-v4', ids}],
    comparison: {},
    confidence: 'high',
    evidence: {flockCount: ids.length, totalBirds: total, flocks: ids},
  };
}

export function detectBroilerProcessed(input) {
  const batches = asArray(input.broilerBatches);
  let total = 0;
  const flocks = [];
  for (const b of batches) {
    const pd = isoDay(firstStr(b, ['processingDate', 'processing_date', 'processedDate']));
    if (!pd || !inPeriod(pd, input.period)) continue;
    const c = firstNum(b, BROILER_PROCESSED_KEYS);
    if (c > 0) {
      total += c;
      flocks.push({name: firstStr(b, ['name', 'batchName', 'id']), count: c, date: pd});
    }
  }
  if (total <= 0) return null;
  return {
    detectorKey: 'broiler_processed',
    program: 'broiler',
    title: 'Broilers brought to processing',
    summary: `${pluralBirds(total)} processed across ${flocks.length} flock${flocks.length === 1 ? '' : 's'} this month.`,
    metricValue: total,
    displayValue: pluralBirds(total),
    sourceRefs: [{module: 'ppp-v4', ids: flocks.map((f) => f.name)}],
    comparison: {},
    confidence: 'high',
    evidence: {totalBirds: total, flocks},
  };
}

function isPigGroupActive(group) {
  const status = firstStr(group, ['status']).toLowerCase();
  return status !== 'processed' && status !== 'inactive' && status !== 'removed' && status !== 'archived';
}

export function detectPigsOnFarm(input) {
  const groups = asArray(input.pigFeederGroups).filter(isPigGroupActive);
  let total = 0;
  const ids = [];
  for (const g of groups) {
    const subs = asArray(g.subBatches).filter(isPigGroupActive);
    if (subs.length > 0) {
      for (const s of subs) {
        const c = firstNum(s, PIG_HEAD_KEYS);
        if (c > 0) {
          total += c;
          ids.push(firstStr(s, ['name', 'id']) || firstStr(g, ['batchName', 'id']));
        }
      }
    } else {
      const c = firstNum(g, PIG_HEAD_KEYS);
      if (c > 0) {
        total += c;
        ids.push(firstStr(g, ['batchName', 'id']));
      }
    }
  }
  if (total <= 0) return null;
  return {
    detectorKey: 'pig_on_farm',
    program: 'pig',
    title: 'Pigs on the farm',
    summary: `${total} pig${total === 1 ? '' : 's'} on the farm across ${ids.length} group${ids.length === 1 ? '' : 's'} at month end.`,
    metricValue: total,
    displayValue: `${total} pig${total === 1 ? '' : 's'}`,
    sourceRefs: [{module: 'ppp-feeders-v1', ids}],
    comparison: {},
    confidence: 'high',
    evidence: {groupCount: ids.length, totalPigs: total, groups: ids},
  };
}

export function detectPigFarrowings(input) {
  const records = asArray(input.pigFarrowings);
  let litters = 0;
  let piglets = 0;
  // Only present a piglet total when EVERY in-period litter has an explicit
  // born-alive count. If any litter lacks it, a partial sum would misrepresent
  // the month, so we report litters only at medium confidence and omit totals.
  let allHaveBornAlive = true;
  const evidence = [];
  for (const r of records) {
    const fd = isoDay(firstStr(r, ['farrowingDate', 'farrowing_date', 'date']));
    if (!fd || !inPeriod(fd, input.period)) continue;
    litters += 1;
    const alive = firstNum(r, PIG_BORN_ALIVE_KEYS); // explicit born-alive ONLY; never totalBorn
    if (alive > 0) piglets += alive;
    else allHaveBornAlive = false;
    evidence.push({group: firstStr(r, ['group', 'sow', 'id']), date: fd, bornAlive: alive});
  }
  if (litters <= 0) return null;
  const showPiglets = allHaveBornAlive && piglets > 0;
  return {
    detectorKey: 'pig_farrowings',
    program: 'pig',
    title: 'New litters farrowed',
    summary: showPiglets
      ? `${piglets} piglet${piglets === 1 ? '' : 's'} born across ${litters} litter${litters === 1 ? '' : 's'} this month.`
      : `${litters} litter${litters === 1 ? '' : 's'} farrowed this month.`,
    metricValue: showPiglets ? piglets : litters,
    displayValue: showPiglets
      ? `${piglets} piglet${piglets === 1 ? '' : 's'} · ${litters} litter${litters === 1 ? '' : 's'}`
      : `${litters} litter${litters === 1 ? '' : 's'}`,
    sourceRefs: [{module: 'ppp-farrowing-v1', ids: evidence.map((e) => e.group)}],
    comparison: {},
    confidence: showPiglets ? 'high' : 'medium',
    evidence: {litters, piglets: showPiglets ? piglets : null, records: evidence},
  };
}

function herdHead(herd, keys) {
  return firstNum(herd, keys);
}

export function detectCattleOnFarm(input) {
  const herds = asArray(input.cattleHerds);
  let total = 0;
  const ids = [];
  for (const h of herds) {
    const c = herdHead(h, CATTLE_HEAD_KEYS);
    if (c > 0) {
      total += c;
      ids.push(firstStr(h, ['name', 'herd', 'id']));
    }
  }
  if (total <= 0) return null;
  return {
    detectorKey: 'cattle_on_farm',
    program: 'cattle',
    title: 'Cattle on the farm',
    summary: `${total} head of cattle across ${ids.length} herd${ids.length === 1 ? '' : 's'} at month end.`,
    metricValue: total,
    displayValue: `${total} head`,
    sourceRefs: [{module: 'cattle_herds', ids}],
    comparison: {},
    confidence: 'high',
    evidence: {herdCount: ids.length, totalHead: total, herds: ids},
  };
}

export function detectCattleBirths(input) {
  const births = asArray(input.cattleBirths);
  let calves = 0;
  const evidence = [];
  for (const b of births) {
    const bd = isoDay(firstStr(b, ['birthDate', 'birth_date', 'date', 'calvedDate']));
    if (!bd || !inPeriod(bd, input.period)) continue;
    const n = firstNum(b, ['count', 'calves', 'quantity']) || 1;
    calves += n;
    evidence.push({dam: firstStr(b, ['dam', 'cow', 'herd', 'id']), date: bd, count: n});
  }
  if (calves <= 0) return null;
  return {
    detectorKey: 'cattle_births',
    program: 'cattle',
    title: 'Calves born',
    summary: `${calves} calf${calves === 1 ? '' : 'ves'} born this month.`,
    metricValue: calves,
    displayValue: `${calves} calf${calves === 1 ? '' : 'ves'}`,
    sourceRefs: [{module: 'cattle_births', ids: evidence.map((e) => e.dam)}],
    comparison: {},
    confidence: 'high',
    evidence: {calves, records: evidence},
  };
}

export function detectSheepOnFarm(input) {
  const flocks = asArray(input.sheepFlocks);
  let total = 0;
  const ids = [];
  for (const f of flocks) {
    const c = herdHead(f, SHEEP_HEAD_KEYS);
    if (c > 0) {
      total += c;
      ids.push(firstStr(f, ['name', 'flock', 'id']));
    }
  }
  if (total <= 0) return null;
  return {
    detectorKey: 'sheep_on_farm',
    program: 'sheep',
    title: 'Sheep on the farm',
    summary: `${total} head of sheep across ${ids.length} flock${ids.length === 1 ? '' : 's'} at month end.`,
    metricValue: total,
    displayValue: `${total} head`,
    sourceRefs: [{module: 'sheep_flocks', ids}],
    comparison: {},
    confidence: 'high',
    evidence: {flockCount: ids.length, totalHead: total, flocks: ids},
  };
}

export function detectSheepBirths(input) {
  const births = asArray(input.sheepBirths);
  let lambs = 0;
  const evidence = [];
  for (const b of births) {
    const bd = isoDay(firstStr(b, ['birthDate', 'birth_date', 'date', 'lambedDate']));
    if (!bd || !inPeriod(bd, input.period)) continue;
    const n = firstNum(b, ['count', 'lambs', 'quantity']) || 1;
    lambs += n;
    evidence.push({ewe: firstStr(b, ['ewe', 'flock', 'id']), date: bd, count: n});
  }
  if (lambs <= 0) return null;
  return {
    detectorKey: 'sheep_births',
    program: 'sheep',
    title: 'Lambs born',
    summary: `${lambs} lamb${lambs === 1 ? '' : 's'} born this month.`,
    metricValue: lambs,
    displayValue: `${lambs} lamb${lambs === 1 ? '' : 's'}`,
    sourceRefs: [{module: 'sheep_births', ids: evidence.map((e) => e.ewe)}],
    comparison: {},
    confidence: 'high',
    evidence: {lambs, records: evidence},
  };
}

export function detectLayerEggs(input) {
  const records = asArray(input.layerProduction);
  let eggs = 0;
  let days = 0;
  for (const r of records) {
    const d = isoDay(firstStr(r, ['date', 'collectedDate', 'day']));
    if (!d || !inPeriod(d, input.period)) continue;
    const e = firstNum(r, ['eggs', 'eggCount', 'collected', 'count', 'quantity']);
    if (e > 0) {
      eggs += e;
      days += 1;
    }
  }
  if (eggs <= 0) return null;
  return {
    detectorKey: 'layer_eggs',
    program: 'layer',
    title: 'Eggs collected',
    summary: `${eggs} eggs collected across ${days} day${days === 1 ? '' : 's'} this month.`,
    metricValue: eggs,
    displayValue: `${eggs} eggs`,
    sourceRefs: [{module: 'layer_production', ids: []}],
    comparison: {},
    confidence: 'high',
    evidence: {eggs, recordedDays: days},
  };
}

// Ordered registry — the sort_order in the issue follows this order.
export const NEWSLETTER_DETECTORS = Object.freeze([
  detectCattleOnFarm,
  detectCattleBirths,
  detectSheepOnFarm,
  detectSheepBirths,
  detectPigsOnFarm,
  detectPigFarrowings,
  detectBroilerOnFarm,
  detectBroilerProcessed,
  detectLayerEggs,
]);

// Drop any candidate that trips the finance/mortality boundary. Pure filter.
export function assertNoForbiddenFacts(facts) {
  return asArray(facts).filter((f) => f && !isForbiddenFact(f));
}

// Run every detector over the input, drop nulls + forbidden, and stamp a stable
// sort order. Deterministic given the same input.
export function detectNewsletterFacts(input) {
  if (!input || typeof input !== 'object' || !input.period) return [];
  const out = [];
  for (const detect of NEWSLETTER_DETECTORS) {
    let fact = null;
    try {
      fact = detect(input);
    } catch (_e) {
      fact = null;
    }
    if (fact) out.push(fact);
  }
  const safe = assertNoForbiddenFacts(out);
  return safe.map((f, i) => ({...f, sortOrder: i}));
}
