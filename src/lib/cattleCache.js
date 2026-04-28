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
export async function loadCattleWeighInsCached(sb) {
  if (_cattleWeighInsCache && Date.now() - _cattleWeighInsCacheAt < CATTLE_WEIGH_INS_TTL_MS) {
    return _cattleWeighInsCache;
  }
  const sR = await sb.from('weigh_in_sessions').select('id').eq('species', 'cattle');
  const ids = (sR.data || []).map((s) => s.id);
  if (ids.length === 0) {
    _cattleWeighInsCache = [];
    _cattleWeighInsCacheAt = Date.now();
    return _cattleWeighInsCache;
  }
  const rows = await wcfSelectAll((f, t) => sb.from('weigh_ins').select('*').in('session_id', ids).range(f, t));
  rows.sort((a, b) => (b.entered_at || '').localeCompare(a.entered_at || ''));
  _cattleWeighInsCache = rows;
  _cattleWeighInsCacheAt = Date.now();
  return _cattleWeighInsCache;
}
export function invalidateCattleWeighInsCache() {
  _cattleWeighInsCache = null;
  _cattleWeighInsCacheAt = 0;
}
