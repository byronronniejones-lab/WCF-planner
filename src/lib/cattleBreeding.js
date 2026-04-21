// Cattle breeding timeline helpers. Verbatim extract from main.jsx.
import { addDays, toISO } from './dateUtils.js';
import {
  CATTLE_BULL_EXPOSURE_DAYS,
  CATTLE_PREG_CHECK_OFFSET_DAYS,
  CATTLE_GESTATION_DAYS,
  CATTLE_CALVING_WINDOW_DAYS,
  CATTLE_NURSING_DAYS,
} from './cattle.js';

export function calcCattleBreedingTimeline(exposureStart) {
  if(!exposureStart) return null;
  const d0 = new Date(exposureStart+'T12:00:00');
  const exposureEnd    = toISO(addDays(d0, CATTLE_BULL_EXPOSURE_DAYS - 1));
  const pregCheckDate  = toISO(addDays(d0, CATTLE_BULL_EXPOSURE_DAYS - 1 + CATTLE_PREG_CHECK_OFFSET_DAYS));
  const calvingStart   = toISO(addDays(d0, CATTLE_GESTATION_DAYS));
  const calvingEnd     = toISO(addDays(d0, CATTLE_GESTATION_DAYS + CATTLE_CALVING_WINDOW_DAYS - 1));
  const weaningDate    = toISO(addDays(d0, CATTLE_GESTATION_DAYS + CATTLE_NURSING_DAYS - 1));
  return { exposureStart, exposureEnd, pregCheckDate, calvingStart, calvingEnd, weaningDate };
}

// Per-year global sequence map for cattle cycles. Format: "YY-NN".
// Parallels buildCycleSeqMap for pigs but keyed off bull_exposure_start.
export function buildCattleCycleSeqMap(cycles) {
  const seqMap = {};
  const dated = (cycles||[]).filter(c => c && c.id && c.bull_exposure_start);
  const sorted = [...dated].sort((a,b) => {
    if(a.bull_exposure_start !== b.bull_exposure_start) return a.bull_exposure_start.localeCompare(b.bull_exposure_start);
    return String(a.id).localeCompare(String(b.id));
  });
  const yearCounts = {};
  sorted.forEach(c => {
    const yr = c.bull_exposure_start.slice(2,4);
    yearCounts[yr] = (yearCounts[yr]||0) + 1;
    seqMap[c.id] = yr + '-' + String(yearCounts[yr]).padStart(2,'0');
  });
  return seqMap;
}
export function cattleCycleLabel(cycle, seqMap) {
  if(!cycle) return '';
  const suffix = seqMap && seqMap[cycle.id];
  return 'Cattle Cycle' + (suffix ? ' ' + suffix : '');
}

// ── AUTO-STATUS HELPERS ──────────────────────────────────────────────────
