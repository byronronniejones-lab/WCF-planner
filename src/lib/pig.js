// ============================================================================
// src/lib/pig.js  —  pig breeding domain constants + helpers
// ----------------------------------------------------------------------------
// Lifted out of main.jsx as prep for Round 6 pig view extractions (pigsHome,
// breeding, pigbatches, farrowing, sows). Pure module-scope; no React, no
// App closure state.
// ============================================================================
import { toISO, addDays, todayISO } from './dateUtils.js';

// ── PIG BREEDING CONSTANTS ─────────────────────────────────────────────────
export const BOAR_EXPOSURE_DAYS  = 45;
export const GESTATION_DAYS      = 116; // days from first exposure to first possible farrowing
export const WEANING_DAYS        = 42;  // 6 weeks
export const GROW_OUT_DAYS       = 183; // 6 months

export const PIG_GROUPS = ["1","2","3"];
export const BREEDING_STATUSES = ["planned","active","completed"];

// Colors per group: one base shade for the whole cycle, with a lighter
// shade for Gilts grow-out and a darker shade for Boars grow-out. All
// three groups stay inside the pig program's blue family (no purple per
// project rules) — Group 1 is sky, Group 2 is the core pig blue, and
// Group 3 is slate. Mirrors the broiler per-batch single-color treatment.
export const PIG_GROUP_COLORS = {
  "1": {boar:"#0EA5E9", paddock:"#0EA5E9", farrowing:"#0EA5E9", weaning:"#0EA5E9", gilt:"#7DD3FC", boarGrow:"#075985"},
  "2": {boar:"#2563EB", paddock:"#2563EB", farrowing:"#2563EB", weaning:"#2563EB", gilt:"#93C5FD", boarGrow:"#1E3A8A"},
  "3": {boar:"#475569", paddock:"#475569", farrowing:"#475569", weaning:"#475569", gilt:"#94A3B8", boarGrow:"#1E293B"},
};
export const PIG_GROUP_TEXT = {"1":"#E0F2FE","2":"#DBEAFE","3":"#F1F5F9"};

// getReadableText now lives in lib/styles.js so every program can use it.
// Re-export here for back-compat with existing pig view imports.
export { getReadableText } from './styles.js';

export const PHASE_LABELS = ["Boar Exposure","Exp. Paddock","Farrowing","Weaning","Gilt Grow-out","Male Grow-out"];

export function calcBreedingTimeline(exposureStart) {
  if (!exposureStart) return null;
  const d0 = new Date(exposureStart+"T12:00:00");
  const boarEnd        = toISO(addDays(d0, BOAR_EXPOSURE_DAYS - 1));
  // Paddock starts day AFTER last boar exposure day, ends day before first possible farrowing
  const paddockStart   = toISO(addDays(d0, BOAR_EXPOSURE_DAYS));
  const paddockEnd     = toISO(addDays(d0, GESTATION_DAYS - 1));
  const farrowingStart = toISO(addDays(d0, GESTATION_DAYS));
  const farrowingEnd   = toISO(addDays(d0, BOAR_EXPOSURE_DAYS - 1 + GESTATION_DAYS));
  const weaningStart   = toISO(addDays(d0, BOAR_EXPOSURE_DAYS + GESTATION_DAYS));
  const weaningEnd     = toISO(addDays(d0, BOAR_EXPOSURE_DAYS + GESTATION_DAYS + WEANING_DAYS - 1));
  const growStart      = toISO(addDays(d0, BOAR_EXPOSURE_DAYS + GESTATION_DAYS + WEANING_DAYS));
  const growEnd        = toISO(addDays(d0, BOAR_EXPOSURE_DAYS + GESTATION_DAYS + WEANING_DAYS + GROW_OUT_DAYS - 1));
  return { boarStart:exposureStart, boarEnd, paddockStart, paddockEnd,
    farrowingStart, farrowingEnd, weaningStart, weaningEnd, growStart, growEnd };
}

// ── BREEDING CYCLE LABELS ────────────────────────────────────────────────
// Auto-generate per-year global sequence number for breeding cycles.
// Format: "Group N - YY-NN" (e.g. "Group 1 - 25-01").
// NN resets each year; first cycle to start in any year gets 01, then 02, etc.
// regardless of which group it's in.
export function buildCycleSeqMap(cycles) {
  const seqMap = {};
  const dated = (cycles||[]).filter(c=>c&&c.id&&c.exposureStart);
  const sorted = [...dated].sort((a,b)=>{
    if(a.exposureStart!==b.exposureStart) return a.exposureStart.localeCompare(b.exposureStart);
    return String(a.id).localeCompare(String(b.id));
  });
  const yearCounts = {};
  sorted.forEach(c=>{
    const yr = c.exposureStart.slice(2,4); // '2025' -> '25'
    yearCounts[yr] = (yearCounts[yr]||0) + 1;
    seqMap[c.id] = yr + '-' + String(yearCounts[yr]).padStart(2,'0');
  });
  return seqMap;
}
export function cycleLabel(cycle, seqMap) {
  if(!cycle) return '';
  // customSuffix (when set by admin) overrides the auto year-sequence code.
  const autoSuffix = seqMap && seqMap[cycle.id];
  const suffix = (cycle.customSuffix && String(cycle.customSuffix).trim()) || autoSuffix;
  return 'Group ' + cycle.group + (suffix ? ' - ' + suffix : '');
}

export function calcCycleStatus(cycle) {
  if(!cycle.exposureStart) return cycle.status||'planned';
  const today = todayISO();
  const tl = calcBreedingTimeline(cycle.exposureStart);
  if(!tl) return 'planned';
  if(today < cycle.exposureStart) return 'planned';
  if(today > tl.growEnd) return 'completed';
  return 'active';
}
