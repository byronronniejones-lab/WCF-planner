// Cattle weigh-ins module-level cache. Verbatim extract from main.jsx.
import {wcfSelectAll} from './pagination.js';

// ── Cattle weigh_ins cache ──────────────────────────────────────────────────
// Each cattle sub-view (Home / Herds / Batches / Weigh-Ins) needs the full
// species-scoped weigh_ins list. Fetching ~2k rows across 3 paginated round-
// trips PER view every time the user navigates is wasteful. Module-level
// cache with a short TTL lets sub-tab navigation reuse the data.
// Invalidate after any write (tag reconcile, session delete, etc.) to stay
// correct. Sorted descending by entered_at so .find() returns the latest match.
let _cattleWeighInsCache = null;
let _cattleWeighInsCacheAt = 0;
const CATTLE_WEIGH_INS_TTL_MS = 30000; // 30s — fresh enough for nav, short enough to catch recent writes
// opts.throwOnError (default false): when true, a HARD read failure on either
// query — the sessions list or any weigh_ins page — throws instead of silently
// resolving to []. The cold-boot Cattle Forecast loader passes this so a
// raced/errored read routes through its bounded retry + recoverable-notice path
// rather than poisoning the page with a fake-empty payload (0 finish
// candidates until reload). A failed read is NEVER cached, so the next call
// (post-invalidate) re-reads fresh. Default callers keep the legacy soft
// contract: return the last-good cache or [], never throw. A genuinely empty
// farm (no cattle weigh-in sessions) still settles to [] with no throw under
// either mode — that is a legitimate empty, not a failure.
export async function loadCattleWeighInsCached(sb, opts = {}) {
  const throwOnError = !!opts.throwOnError;
  if (_cattleWeighInsCache && Date.now() - _cattleWeighInsCacheAt < CATTLE_WEIGH_INS_TTL_MS) {
    return _cattleWeighInsCache;
  }
  const sR = await sb.from('weigh_in_sessions').select('id').eq('species', 'cattle');
  if (sR.error) {
    // Do NOT cache a failed sessions read — let the next call retry fresh.
    if (throwOnError) throw new Error('loadCattleWeighInsCached sessions: ' + (sR.error.message || sR.error));
    return _cattleWeighInsCache || [];
  }
  const ids = (sR.data || []).map((s) => s.id);
  if (ids.length === 0) {
    _cattleWeighInsCache = [];
    _cattleWeighInsCacheAt = Date.now();
    return _cattleWeighInsCache;
  }
  // Observe a page-read error through the build closure WITHOUT changing the
  // wcfSelectAll contract (it intentionally swallows errors and returns the
  // rows gathered so far). A partial/errored page must not be cached as truth.
  let pageError = null;
  const rows = await wcfSelectAll(async (f, t) => {
    const res = await sb.from('weigh_ins').select('*').in('session_id', ids).range(f, t);
    if (res.error) pageError = res.error;
    return res;
  });
  if (pageError) {
    if (throwOnError) throw new Error('loadCattleWeighInsCached weigh_ins: ' + (pageError.message || pageError));
    return _cattleWeighInsCache || rows;
  }
  rows.sort((a, b) => (b.entered_at || '').localeCompare(a.entered_at || ''));
  _cattleWeighInsCache = rows;
  _cattleWeighInsCacheAt = Date.now();
  return _cattleWeighInsCache;
}
export function invalidateCattleWeighInsCache() {
  _cattleWeighInsCache = null;
  _cattleWeighInsCacheAt = 0;
}
