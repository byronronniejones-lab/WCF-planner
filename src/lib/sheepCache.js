// Sheep weigh-ins module-level cache. Mirrors cattleCache.js for sheep.
// Each sheep sub-view (Home / Flocks / Batches / Weigh-Ins) needs the
// full species-scoped weigh_ins list. 30s TTL, invalidated after any
// write (tag reconcile, session delete, send-to-processor, etc.).
import {wcfSelectAll} from './pagination.js';

let _sheepWeighInsCache = null;
let _sheepWeighInsCacheAt = 0;
const SHEEP_WEIGH_INS_TTL_MS = 30000;

export async function loadSheepWeighInsCached(sb) {
  if (_sheepWeighInsCache && Date.now() - _sheepWeighInsCacheAt < SHEEP_WEIGH_INS_TTL_MS) {
    return _sheepWeighInsCache;
  }
  const sR = await sb.from('weigh_in_sessions').select('id').eq('species', 'sheep');
  const ids = (sR.data || []).map((s) => s.id);
  if (ids.length === 0) {
    _sheepWeighInsCache = [];
    _sheepWeighInsCacheAt = Date.now();
    return _sheepWeighInsCache;
  }
  const rows = await wcfSelectAll((f, t) => sb.from('weigh_ins').select('*').in('session_id', ids).range(f, t));
  rows.sort((a, b) => (b.entered_at || '').localeCompare(a.entered_at || ''));
  _sheepWeighInsCache = rows;
  _sheepWeighInsCacheAt = Date.now();
  return _sheepWeighInsCache;
}
export function invalidateSheepWeighInsCache() {
  _sheepWeighInsCache = null;
  _sheepWeighInsCacheAt = 0;
}
