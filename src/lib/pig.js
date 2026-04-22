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

// Phase colors per group (light=earlier phases, dark=later phases)
export const PIG_GROUP_COLORS = {
  "1": {boar:"#B5D4F4", paddock:"#85B7EB", farrowing:"#378ADD", weaning:"#185FA5", gilt:"#0C447C", boarGrow:"#042C53"},
  "2": {boar:"#F4C0D1", paddock:"#ED93B1", farrowing:"#D4537E", weaning:"#993556", gilt:"#72243E", boarGrow:"#4B1528"},
  "3": {boar:"#C0DD97", paddock:"#97C459", farrowing:"#639922", weaning:"#3B6D11", gilt:"#27500A", boarGrow:"#173404"},
};
export const PIG_GROUP_TEXT = {"1":"#E6F1FB","2":"#FBEAF0","3":"#EAF3DE"};

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
