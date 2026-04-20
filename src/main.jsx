// ============================================================================
// WCF Planner — main.jsx
// ============================================================================
// Phase 1.2 of the Vite migration: app source moved verbatim from the
// <script type="text/jsx-source" id="wcf-app-source"> block in index.html.
// CDN globals (React, ReactDOM, supabase) become ESM imports here. NO logic
// or JSX changes — this is a structural move only. Every line below the
// "BEGIN VERBATIM PORT" marker is byte-identical to lines 212–19342 of the
// pre-migration index.html (backed up at
// ~/OneDrive/Desktop/WCF-planner-backups/index.html.pre-vite-2026-04-19).
// ============================================================================

import React from 'react';
import { createRoot } from 'react-dom/client';

// Phase 2.0.0: foundation lib helpers extracted from this file. Importing
// here makes them available throughout the verbatim-ported app body without
// any rename or rewiring (the names `sb`, `wcfSendEmail`, `wcfSelectAll`
// are still globals in the module scope).
import { sb } from './lib/supabase.js';
import { wcfSendEmail } from './lib/email.js';
import { wcfSelectAll } from './lib/pagination.js';

// Phase 2.0.1: AuthContext owns the auth-related useState hooks. App() reads
// them via useAuth(); effects + helpers + derived values stay in App.
import { AuthProvider, useAuth } from './contexts/AuthContext.jsx';

// Phase 2.0.2: BatchesContext owns the broiler batch + edit-form hooks.
// EMPTY_FORM + thisMonday are passed in as initializers (module-scope here).
import { BatchesProvider, useBatches } from './contexts/BatchesContext.jsx';

// Phase 2.0.3: PigContext owns all pig-scoped useState hooks. INITIAL_FARROWING,
// INITIAL_BREEDERS, and the breedTlStart lazy init are threaded in as props.
import { PigProvider, usePig } from './contexts/PigContext.jsx';

// Phase 2.0.4: LayerContext owns layer-scoped useState hooks.
import { LayerProvider, useLayer } from './contexts/LayerContext.jsx';

// Phase 2.0.5: DailysRecentContext owns the recent-window dailys arrays
// across broiler/pig/layer/egg/cattle/sheep.
import { DailysRecentProvider, useDailysRecent } from './contexts/DailysRecentContext.jsx';

// Phase 2.0.6: five small contexts bundled in one commit.
import { CattleHomeProvider, useCattleHome } from './contexts/CattleHomeContext.jsx';
import { SheepHomeProvider, useSheepHome } from './contexts/SheepHomeContext.jsx';
import { WebformsConfigProvider, useWebformsConfig } from './contexts/WebformsConfigContext.jsx';
import { FeedCostsProvider, useFeedCosts } from './contexts/FeedCostsContext.jsx';
import { UIProvider, useUI } from './contexts/UIContext.jsx';

// Phase 2.1.1: leaf form-input components extracted to src/shared/.
import WcfYN from './shared/WcfYN.jsx';
import WcfToggle from './shared/WcfToggle.jsx';

// Phase 2.1.2: DeleteModal extracted to src/shared/.
import DeleteModal from './shared/DeleteModal.jsx';

// Phase 2.1.3 prep: layer-housing helpers extracted ahead of modal extractions
// so the admin modal + webform hub can import them without a circular dep on
// main.jsx. Verbatim — signatures unchanged.
import { setHousingAnchorFromReport, computeProjectedCount, computeLayerFeedCost } from './lib/layerHousing.js';

// Phase 2.1.4: Admin + livestock + cattle modals extracted verbatim.
import AdminAddReportModal from './shared/AdminAddReportModal.jsx';
import AdminNewWeighInModal from './shared/AdminNewWeighInModal.jsx';
import PigSendToTripModal from './livestock/PigSendToTripModal.jsx';
import CattleNewWeighInModal from './cattle/CattleNewWeighInModal.jsx';

// Phase 2.1.5: SetPasswordScreen + LoginScreen extracted to src/auth/.
import SetPasswordScreen from './auth/SetPasswordScreen.jsx';
import LoginScreen from './auth/LoginScreen.jsx';

// Phase 2 Round 2: single-feature dailys views + cow/sheep detail + bulk imports.
import BroilerDailysView from './broiler/BroilerDailysView.jsx';
import BroilerHomeView from './broiler/BroilerHomeView.jsx';
import BroilerTimelineView from './broiler/BroilerTimelineView.jsx';
import BroilerListView from './broiler/BroilerListView.jsx';
import PigsHomeView from './pig/PigsHomeView.jsx';
import BreedingView from './pig/BreedingView.jsx';
import FarrowingView from './pig/FarrowingView.jsx';
import SowsView from './pig/SowsView.jsx';
import PigFeedView from './pig/PigFeedView.jsx';
import PigBatchesView from './pig/PigBatchesView.jsx';
import LayerDailysView from './layer/LayerDailysView.jsx';
import EggDailysView from './layer/EggDailysView.jsx';
import PigDailysView from './pig/PigDailysView.jsx';
import CattleDailysView from './cattle/CattleDailysView.jsx';
import CattleBulkImport from './cattle/CattleBulkImport.jsx';
import SheepBulkImport from './sheep/SheepBulkImport.jsx';
import SheepDetail from './sheep/SheepDetail.jsx';
import SheepDailysView from './sheep/SheepDailysView.jsx';
import SheepWeighInsView from './sheep/SheepWeighInsView.jsx';
import CollapsibleOutcomeSections from './cattle/CollapsibleOutcomeSections.jsx';
import CowDetail from './cattle/CowDetail.jsx';

// Phase 2.3.5/2.3.6 bug-fix: LivestockWeighInsView + CattleWeighInsView
// were accidentally bundled into adjacent modal files in Round 1. Split.
import LivestockWeighInsView from './livestock/LivestockWeighInsView.jsx';
import CattleWeighInsView from './cattle/CattleWeighInsView.jsx';

// Phase 2.3 prep: helpers needed by Round 3 views extracted to src/lib/.
import { loadCattleWeighInsCached, invalidateCattleWeighInsCache } from './lib/cattleCache.js';
import { calcCattleBreedingTimeline, buildCattleCycleSeqMap, cattleCycleLabel } from './lib/cattleBreeding.js';
import { addDays, toISO, fmt, fmtS, todayISO, thisMonday } from './lib/dateUtils.js';
import { S } from './lib/styles.js';
import { DEFAULT_WEBFORMS_CONFIG } from './lib/defaults.js';
// Phase 2 Round 6 prep: broiler helpers lifted to src/lib/broiler.js so the
// BroilerHomeView extraction can import them without a main.jsx circular dep.
import { BROODER_DAYS, CC_SCHOONER, WR_SCHOONER, WEEKS_SHOWN, LEGACY_BREEDS, RESOURCES, BREED_STYLE, STATUS_STYLE, getFeedSchedule, calcBatchFeed, calcTimeline, calcPoultryStatus, calcBroilerStatsFromDailys, getBatchColor, breedLabel, isNearHoliday } from './lib/broiler.js';
import { BOAR_EXPOSURE_DAYS, GESTATION_DAYS, WEANING_DAYS, GROW_OUT_DAYS, PIG_GROUPS, BREEDING_STATUSES, PIG_GROUP_COLORS, PIG_GROUP_TEXT, PHASE_LABELS, calcBreedingTimeline, buildCycleSeqMap, cycleLabel, calcCycleStatus } from './lib/pig.js';
if (typeof window !== 'undefined') { window.invalidateCattleWeighInsCache = invalidateCattleWeighInsCache; }

// Phase 2 Round 3: bigger stateful views + UsersModal.
import UsersModal from './auth/UsersModal.jsx';
import LayersHomeView from './layer/LayersHomeView.jsx';
import LayersView from './layer/LayersView.jsx';
import CattleHomeView from './cattle/CattleHomeView.jsx';
import SheepFlocksView from './sheep/SheepFlocksView.jsx';
import SheepHomeView from './sheep/SheepHomeView.jsx';
import CattleHerdsView from './cattle/CattleHerdsView.jsx';
import CattleBreedingView from './cattle/CattleBreedingView.jsx';
import CattleBatchesView from './cattle/CattleBatchesView.jsx';

// Phase 2 Round 4: admin panels.
import FeedCostsPanel from './admin/FeedCostsPanel.jsx';
import FeedCostByMonthPanel from './admin/FeedCostByMonthPanel.jsx';
import LivestockFeedInputsPanel from './admin/LivestockFeedInputsPanel.jsx';
import NutritionTargetsPanel from './admin/NutritionTargetsPanel.jsx';

// Phase 2 Round 5: public webforms (no-auth hash-routed).
import AddFeedWebform from './webforms/AddFeedWebform.jsx';
import WeighInsWebform from './webforms/WeighInsWebform.jsx';
import WebformHub from './webforms/WebformHub.jsx';
import WebformsAdminView from './webforms/WebformsAdminView.jsx';

// ── ONE-TIME LEGACY BABEL-CACHE CLEANUP ──
// Pre-Vite versions cached compiled JSX in localStorage under wcf-babel-*
// keys (~600 KB per user). With Vite there's no in-browser transpile, so
// these are dead weight. Idempotent purge on every mount; safe to leave
// in forever even after every existing user has reloaded once.
try {
  for(let i = localStorage.length - 1; i >= 0; i--) {
    const k = localStorage.key(i);
    if(k && k.startsWith('wcf-babel-')) localStorage.removeItem(k);
  }
} catch(e) { /* localStorage disabled — fine */ }

// ── LAZY LOAD SHEETJS ──
// SheetJS (xlsx) is ~600KB minified and only used when opening processor
// reports / running bulk imports. Defer loading until first use via dynamic
// ESM import. Same window._wcfLoadXLSX API as the pre-Vite CDN-script-tag
// loader so the existing call sites (`await window._wcfLoadXLSX()` followed
// by `XLSX.X`) don't need to change.
window._wcfLoadXLSX = function() {
  if(window.XLSX) return Promise.resolve(window.XLSX);
  if(window._wcfXLSXPromise) return window._wcfXLSXPromise;
  window._wcfXLSXPromise = import('xlsx').then(m => {
    window.XLSX = m.default || m;
    return window.XLSX;
  });
  return window._wcfXLSXPromise;
};

// === BEGIN VERBATIM PORT (was index.html lines 212–19342) ===

// (Phase 2.0.0: sb client init + wcfSendEmail + wcfSelectAll definitions
// moved to src/lib/supabase.js, src/lib/email.js, src/lib/pagination.js
// respectively. They're re-imported above as module-scoped names so every
// downstream reference in the verbatim-ported body still resolves.)

// Phase 2.3 prep: cattle cache helpers moved to src/lib/cattleCache.js.

const { useState, useEffect, useCallback } = React;


// ── CONSTANTS ──────────────────────────────────────────────────────────────
const BROODER_CLEANOUT  = 3;
const SCHOONER_CLEANOUT = 4;
const STORAGE_KEY       = "ppp-data-v1";

// For monthly summary: given a batch and a calendar month (YYYY-MM),
// return {starter, grower} lbs consumed in that month
function calcBatchFeedForMonth(batch, yearMonth) {
  if (!batch.hatchDate) return {starter:0, grower:0};
  const schedule = getFeedSchedule(batch.breed);
  const [y,m] = yearMonth.split("-").map(Number);
  const monthStart = new Date(y, m-1, 1);
  const monthEnd   = new Date(y, m, 0, 23, 59, 59);
  let starter = 0, grower = 0;
  schedule.forEach((w, i) => {
    const weekStart = addDays(batch.hatchDate, i*7);
    const weekEnd   = addDays(batch.hatchDate, (i+1)*7 - 1);
    // Check overlap with month
    if (weekStart <= monthEnd && weekEnd >= monthStart) {
      // Proportion of week that falls in this month
      const overlapStart = weekStart < monthStart ? monthStart : weekStart;
      const overlapEnd   = weekEnd   > monthEnd   ? monthEnd   : weekEnd;
      const overlapDays  = (overlapEnd - overlapStart) / 86400000 + 1;
      const prop = overlapDays / 7;
      if (w.phase === "starter") starter += w.totalLbs * prop;
      else grower += w.totalLbs * prop;
    }
  });
  return { starter: Math.round(starter), grower: Math.round(grower) };
}

// ── LAYER FEED SCHEDULE ──────────────────────────────────────────────────
// Weeks 1-6: starter, Weeks 7-20: grower, Week 21+: layer feed (0.25 lbs/bird/day)
// Starter capped at 1,500 lbs per batch (same as broilers).
const LAYER_FEED_SCHEDULE = [
  {week:1,  phase:'starter', lbsPerBird:0.50},
  {week:2,  phase:'starter', lbsPerBird:1.00},
  {week:3,  phase:'starter', lbsPerBird:1.10},
  {week:4,  phase:'starter', lbsPerBird:1.20},
  {week:5,  phase:'starter', lbsPerBird:1.20},
  {week:6,  phase:'starter', lbsPerBird:1.00},
  {week:7,  phase:'grower',  lbsPerBird:0.60},
  {week:8,  phase:'grower',  lbsPerBird:0.65},
  {week:9,  phase:'grower',  lbsPerBird:0.70},
  {week:10, phase:'grower',  lbsPerBird:0.75},
  {week:11, phase:'grower',  lbsPerBird:0.80},
  {week:12, phase:'grower',  lbsPerBird:0.80},
  {week:13, phase:'grower',  lbsPerBird:0.85},
  {week:14, phase:'grower',  lbsPerBird:0.85},
  {week:15, phase:'grower',  lbsPerBird:0.90},
  {week:16, phase:'grower',  lbsPerBird:0.90},
  {week:17, phase:'grower',  lbsPerBird:0.95},
  {week:18, phase:'grower',  lbsPerBird:0.95},
  {week:19, phase:'grower',  lbsPerBird:1.00},
  {week:20, phase:'grower',  lbsPerBird:1.00},
];
const LAYER_FEED_PER_DAY = 0.25; // lbs/bird/day on layer feed (week 21+)

// For a layer batch + month, return {starter, grower, layer} lbs projected.
// Uses brooder_entry_date as day 0, original_count for starter/grower phases,
// computeProjectedCount for layer phase hen count.
function calcLayerFeedForMonth(batch, housings, layerDailys, yearMonth) {
  const startDate = batch.brooder_entry_date || batch.arrival_date;
  if(!startDate) return {starter:0, grower:0, layer:0};
  const birdCount = parseInt(batch.original_count) || 0;
  if(birdCount <= 0) return {starter:0, grower:0, layer:0};
  const [y,m] = yearMonth.split('-').map(Number);
  const monthStart = new Date(y, m-1, 1);
  const monthEnd = new Date(y, m, 0, 23, 59, 59);
  let starter = 0, grower = 0, layer = 0;
  // Weeks 1-20: starter/grower from schedule
  LAYER_FEED_SCHEDULE.forEach(function(w, i){
    const weekStart = addDays(startDate, i*7);
    const weekEnd = addDays(startDate, (i+1)*7 - 1);
    if(weekStart <= monthEnd && weekEnd >= monthStart){
      const overlapStart = weekStart < monthStart ? monthStart : weekStart;
      const overlapEnd = weekEnd > monthEnd ? monthEnd : weekEnd;
      const overlapDays = (overlapEnd - overlapStart) / 86400000 + 1;
      const prop = overlapDays / 7;
      const lbs = w.lbsPerBird * birdCount * prop;
      if(w.phase === 'starter') starter += lbs;
      else grower += lbs;
    }
  });
  // Week 21+: layer feed at 0.25 lbs/bird/day using projected hen count
  var layerStart = addDays(startDate, 20*7); // day 140
  if(layerStart <= monthEnd){
    var lStart = layerStart < monthStart ? monthStart : layerStart;
    var lEnd = monthEnd;
    var lDays = Math.max(0, (lEnd - lStart) / 86400000 + 1);
    if(lDays > 0){
      // Use projected hen count from active housings for this batch
      var batchHousings = (housings||[]).filter(function(h){return h.batch_id===batch.id && h.status==='active';});
      var hens = 0;
      if(batchHousings.length > 0){
        batchHousings.forEach(function(h){
          var proj = computeProjectedCount(h, layerDailys);
          hens += proj ? proj.projected : (parseInt(h.current_count)||0);
        });
      } else {
        hens = birdCount; // fallback if no housings yet
      }
      layer += hens * LAYER_FEED_PER_DAY * lDays;
    }
  }
  return {starter:Math.round(starter), grower:Math.round(grower), layer:Math.round(layer)};
}

const CC_HATCHERIES = ["So Big Farms","Meyer Hatchery","Welp Hatchery","Myers Poultry"];
const WR_HATCHERIES = ["Freedom Ranger Hatchery"];
// Merged list — used for new/active batches now that any hatchery may supply any breed.
// (Kept CC_HATCHERIES and WR_HATCHERIES above for any legacy reference, but the form
// itself reads ALL_HATCHERIES.)
const ALL_HATCHERIES = ["So Big Farms","Meyer Hatchery","Welp Hatchery","Myers Poultry","Freedom Ranger Hatchery"];
// Legacy hatcheries — only shown when admin toggles "Show legacy" on a processed batch
const LEGACY_HATCHERIES = ["VALLEY FARMS","CREDO FARMS","CACKLE"];
// Legacy breeds — same gating. Both come from Freedom Ranger Hatchery historically
// but the breed↔hatchery dropdown is now decoupled, so any combination is possible.
const SCHOONERS     = ["1","2&3","4&5","6&6A","7&7A"];
const BROODERS      = ["1","2","3"];
const STATUSES      = ["planned","active","processed"];




// ── CATTLE CONSTANTS ───────────────────────────────────────────────────────
// See CATTLE_DESIGN.md for full module design.
const CATTLE_HERDS         = ['mommas','backgrounders','finishers','bulls'];
const CATTLE_OUTCOMES      = ['processed','deceased','sold'];
const CATTLE_ALL_HERDS     = [...CATTLE_HERDS, ...CATTLE_OUTCOMES];

const CATTLE_HERD_LABELS = {
  mommas:'Mommas', backgrounders:'Backgrounders', finishers:'Finishers', bulls:'Bulls',
  processed:'Processed', deceased:'Deceased', sold:'Sold'
};

// Red family palette (matches program palette committed in 524b4c2).
// No purple anywhere. Bulls is wine/deep red; outcomes are neutral.
const CATTLE_HERD_COLORS = {
  mommas:        {bg:'#fef2f2', bd:'#fca5a5', tx:'#991b1b', bar:'#dc2626'},   // red (primary)
  backgrounders: {bg:'#ffedd5', bd:'#fdba74', tx:'#9a3412', bar:'#ea580c'},   // orange
  finishers:     {bg:'#fff1f2', bd:'#fda4af', tx:'#9f1239', bar:'#e11d48'},   // rose
  bulls:         {bg:'#fee2e2', bd:'#fca5a5', tx:'#7f1d1d', bar:'#991b1b'},   // wine
  processed:     {bg:'#f3f4f6', bd:'#d1d5db', tx:'#374151', bar:'#6b7280'},
  deceased:      {bg:'#f9fafb', bd:'#e5e7eb', tx:'#6b7280', bar:'#9ca3af'},
  sold:          {bg:'#eff6ff', bd:'#bfdbfe', tx:'#1e40af', bar:'#2563eb'},
};

// ── CATTLE BREEDING CONSTANTS ──────────────────────────────────────────────
const CATTLE_BULL_EXPOSURE_DAYS     = 65;
const CATTLE_PREG_CHECK_OFFSET_DAYS = 30;   // days after bull_exposure_end
const CATTLE_GESTATION_DAYS         = 274;  // ~9 months
const CATTLE_CALVING_WINDOW_DAYS    = 65;
const CATTLE_NURSING_DAYS           = 213;  // ~7 months

// Given a bull exposure start date, return the full cycle timeline.
// All dates ISO strings. Returns null if start not provided.
// Phase 2.3 prep: cattle breeding helpers moved to src/lib/cattleBreeding.js.


const INITIAL_BREEDERS = [{"id": "podio-1", "tag": "1", "sex": "Boar", "group": "", "status": "Boar Group", "breed": "Berkshire", "origin": "Corey Davis", "birthDate": "2023-01-15", "lastWeight": "393", "purchaseDate": "2023-04-15", "purchaseAmount": "750", "notes": "", "archived": false}, {"id": "podio-2", "tag": "2", "sex": "Sow", "group": "2", "status": "Sow Group", "breed": "Berkshire", "origin": "Corey Davis", "birthDate": "2022-02-01", "lastWeight": "444", "purchaseDate": "2022-04-01", "purchaseAmount": "750", "notes": "", "archived": false}, {"id": "podio-3", "tag": "3", "sex": "Sow", "group": "1", "status": "Sow Group", "breed": "Berkshire", "origin": "Corey Davis", "birthDate": "2023-02-15", "lastWeight": "285", "purchaseDate": "2023-04-15", "purchaseAmount": "750", "notes": "", "archived": false}, {"id": "podio-4", "tag": "4", "sex": "Sow", "group": "", "status": "Deceased", "breed": "Berkshire", "origin": "Corey Davis", "birthDate": "2022-02-01", "lastWeight": "570", "purchaseDate": "2022-04-01", "purchaseAmount": "750", "notes": "", "archived": true}, {"id": "podio-5", "tag": "5", "sex": "Sow", "group": "2", "status": "Sow Group", "breed": "Berkshire", "origin": "Corey Davis", "birthDate": "2022-02-01", "lastWeight": "644", "purchaseDate": "2022-04-01", "purchaseAmount": "750", "notes": "", "archived": false}, {"id": "podio-6", "tag": "6", "sex": "Sow", "group": "1", "status": "Sow Group", "breed": "Berkshire", "origin": "Corey Davis", "birthDate": "2023-02-15", "lastWeight": "370", "purchaseDate": "2023-04-15", "purchaseAmount": "750", "notes": "", "archived": false}, {"id": "podio-7", "tag": "7", "sex": "Sow", "group": "1", "status": "Sow Group", "breed": "Berkshire", "origin": "Corey Davis", "birthDate": "2023-02-15", "lastWeight": "315", "purchaseDate": "2023-04-15", "purchaseAmount": "750", "notes": "", "archived": false}, {"id": "podio-8", "tag": "8", "sex": "Sow", "group": "2", "status": "Deceased", "breed": "Berkshire", "origin": "Corey Davis", "birthDate": "2022-02-01", "lastWeight": "416", "purchaseDate": "2022-04-01", "purchaseAmount": "750", "notes": "", "archived": true}, {"id": "podio-9", "tag": "9", "sex": "Sow", "group": "3", "status": "Sow Group", "breed": "Duroc/Berkshire Cross", "origin": "Born on Farm", "birthDate": "2023-05-17", "lastWeight": "374", "purchaseDate": "", "purchaseAmount": "", "notes": "", "archived": false}, {"id": "podio-10", "tag": "10", "sex": "Sow", "group": "2", "status": "Sow Group", "breed": "Berkshire", "origin": "Corey Davis", "birthDate": "2022-02-01", "lastWeight": "610", "purchaseDate": "2022-04-01", "purchaseAmount": "750", "notes": "", "archived": false}, {"id": "podio-11", "tag": "11", "sex": "Sow", "group": "3", "status": "Sow Group", "breed": "Berkshire", "origin": "Corey Davis", "birthDate": "2023-02-15", "lastWeight": "387", "purchaseDate": "2023-04-15", "purchaseAmount": "750", "notes": "", "archived": false}, {"id": "podio-13", "tag": "13", "sex": "Sow", "group": "2", "status": "Sow Group", "breed": "Duroc/Berkshire Cross", "origin": "Born on Farm", "birthDate": "2023-05-17", "lastWeight": "373", "purchaseDate": "", "purchaseAmount": "", "notes": "", "archived": false}, {"id": "podio-17", "tag": "17", "sex": "Sow", "group": "1", "status": "Sow Group", "breed": "Berkshire", "origin": "Corey Davis", "birthDate": "2023-02-15", "lastWeight": "370", "purchaseDate": "2023-04-15", "purchaseAmount": "750", "notes": "", "archived": false}, {"id": "podio-18", "tag": "18", "sex": "Sow", "group": "2", "status": "Sow Group", "breed": "Berkshire", "origin": "Corey Davis", "birthDate": "2023-02-15", "lastWeight": "462", "purchaseDate": "2024-04-15", "purchaseAmount": "750", "notes": "", "archived": false}, {"id": "podio-19", "tag": "19", "sex": "Sow", "group": "2", "status": "Sow Group", "breed": "Berkshire", "origin": "Corey Davis", "birthDate": "2023-03-06", "lastWeight": "414", "purchaseDate": "2023-04-15", "purchaseAmount": "750", "notes": "", "archived": false}, {"id": "podio-21", "tag": "21", "sex": "Sow", "group": "3", "status": "Sow Group", "breed": "Berkshire", "origin": "Corey Davis", "birthDate": "2023-02-15", "lastWeight": "388", "purchaseDate": "2023-04-15", "purchaseAmount": "750", "notes": "", "archived": false}, {"id": "podio-22", "tag": "22", "sex": "Sow", "group": "2", "status": "Sow Group", "breed": "Berkshire", "origin": "Corey Davis", "birthDate": "2023-02-15", "lastWeight": "395", "purchaseDate": "2023-04-15", "purchaseAmount": "750", "notes": "", "archived": false}, {"id": "podio-25", "tag": "25", "sex": "Boar", "group": "", "status": "Boar Group", "breed": "Duroc/Berkshire Cross", "origin": "Born on Farm", "birthDate": "2023-05-17", "lastWeight": "396", "purchaseDate": "", "purchaseAmount": "", "notes": "", "archived": false}, {"id": "podio-27", "tag": "27", "sex": "Sow", "group": "3", "status": "Sow Group", "breed": "Berkshire", "origin": "Corey Davis", "birthDate": "2023-02-15", "lastWeight": "377", "purchaseDate": "2023-04-15", "purchaseAmount": "750", "notes": "", "archived": false}, {"id": "podio-28", "tag": "28", "sex": "Sow", "group": "3", "status": "Sow Group", "breed": "Berkshire", "origin": "Corey Davis", "birthDate": "2023-02-15", "lastWeight": "360", "purchaseDate": "2023-04-15", "purchaseAmount": "750", "notes": "", "archived": false}, {"id": "podio-32", "tag": "32", "sex": "Gilt", "group": "3", "status": "Sow Group", "breed": "Duroc/Berkshire Cross", "origin": "Born on Farm", "birthDate": "2024-09-18", "lastWeight": "", "purchaseDate": "", "purchaseAmount": "", "notes": "", "archived": false}, {"id": "podio-33", "tag": "33", "sex": "Sow", "group": "3", "status": "Sow Group", "breed": "Berkshire", "origin": "Born on Farm", "birthDate": "2024-09-18", "lastWeight": "", "purchaseDate": "", "purchaseAmount": "", "notes": "", "archived": false}, {"id": "podio-34", "tag": "34", "sex": "Sow", "group": "3", "status": "Sow Group", "breed": "Berkshire", "origin": "Born on Farm", "birthDate": "2024-09-18", "lastWeight": "", "purchaseDate": "", "purchaseAmount": "", "notes": "", "archived": false}, {"id": "podio-98", "tag": "98", "sex": "Sow", "group": "1", "status": "Deceased", "breed": "Berkshire", "origin": "Corey Davis", "birthDate": "2023-02-15", "lastWeight": "361", "purchaseDate": "2023-04-15", "purchaseAmount": "750", "notes": "", "archived": true}];

// Historical farrowing records imported from Podio export
const INITIAL_FARROWING = [
  {id:"f1",  sow:"5",  group:"2", farrowingDate:"2025-11-13", exposureStart:"2025-07-02", exposureEnd:"2025-08-13", sire:"MACHINE", motheringQuality:"excellent", demeanor:"Meanest mom in a good defensive way", totalBorn:11, deaths:3, location:"outside-pen", wentWell:"She aggressively defends her piglets", didntGoWell:"Crushing day 5", defects:"1 doa, 1 dead within 24 hours, one crushed around day 5. 2 runts, one recovered decently, one is still much smaller than rest of batch at 2.5 months old.\n\nMinor prolapse."},
  {id:"f2",  sow:"19", group:"2", farrowingDate:"2025-11-11", exposureStart:"2025-07-02", exposureEnd:"2025-08-13", sire:"MACHINE", motheringQuality:"excellent", demeanor:"no complaints. Solid mother.", totalBorn:7,  deaths:1, location:"outside-pen", wentWell:"no deaths after 24 hours", didntGoWell:"", defects:"1 newborn death - no defects"},
  {id:"f3",  sow:"2",  group:"2", farrowingDate:"2025-11-04", exposureStart:"2025-07-02", exposureEnd:"2025-08-13", sire:"MACHINE", motheringQuality:"average", demeanor:"Very very protective", totalBorn:9,  deaths:4, location:"outside-pen", wentWell:"Very protective", didntGoWell:"Wish she picked hut with hay over bush nest. One piglet was killed during commotion with other moms when moved into different farrowing paddock.", defects:"One DOA, one thought a different mama was hers after 1 day and died, one was crushed after 2 days. Last one is only one you can really blame her for. One was killed about a week later when they were moved into other Paddock by other mom."},
  {id:"f4",  sow:"13", group:"2", farrowingDate:"2025-10-29", exposureStart:"2025-07-02", exposureEnd:"2025-08-13", sire:"MACHINE", motheringQuality:"excellent", demeanor:"Very protective", totalBorn:7,  deaths:0, location:"outside-pen", wentWell:"All alive, very protective, made her own nest", didntGoWell:"0", defects:"0"},
  {id:"f5",  sow:"6",  group:"1", farrowingDate:"2025-08-24", exposureStart:"2025-03-24", exposureEnd:"2025-05-05", sire:"MACHINE", motheringQuality:"average", demeanor:"Doesn't want you in the pen with her", totalBorn:10, deaths:2, location:"inside-hut", wentWell:"Hay bedding seemed an improvement on 0 bedding", didntGoWell:"Silver dog panels are easy for them to move and escape. Also easy for piglets to escape with those", defects:"One has an extremely large growth on back leg, but currently still alive\n\nOne was crushed by mama\n\nOne was walking on wrists on both back legs, had no chance, couldn't stand after 2 days"},
  {id:"f6",  sow:"17", group:"1", farrowingDate:"2025-08-18", exposureStart:"2025-03-24", exposureEnd:"2025-05-05", sire:"AO",      motheringQuality:"excellent", demeanor:"Bit a piglet from #3 unprovoked a day before she gave birth", totalBorn:9,  deaths:1, location:"outside-pen", wentWell:"High survival rate outside pen", didntGoWell:"", defects:"0\n\nAO father"},
  {id:"f7",  sow:"98", group:"1", farrowingDate:"2025-08-11", exposureStart:"2025-03-24", exposureEnd:"2025-05-05", sire:"MACHINE", motheringQuality:"average", demeanor:"Friendly", totalBorn:11, deaths:7, location:"inside-hut", wentWell:"Put in pen just hours before birth", didntGoWell:"She broke out twice, had to rebuild pen next to her as she was 40 yards away in morning", defects:"4 possible doa, 3 crushed after being alive"},
  {id:"f8",  sow:"3",  group:"1", farrowingDate:"2025-08-11", exposureStart:"2025-03-24", exposureEnd:"2025-05-05", sire:"AO",      motheringQuality:"",        demeanor:"Friendly, no issues", totalBorn:4,  deaths:1, location:"",           wentWell:"put into pen post birth to grow for a few days", didntGoWell:"one piglet was bitten by another sow #17 unprovoked, he shook it off and is doing fine", defects:"possible 1 DOA, small and never seen alive"},
  {id:"f9",  sow:"7",  group:"1", farrowingDate:"2025-08-05", exposureStart:"2025-03-24", exposureEnd:"2025-05-05", sire:"MACHINE", motheringQuality:"average", demeanor:"Friendly, no issues", totalBorn:10, deaths:4, location:"outside-hut",  wentWell:"", didntGoWell:"", defects:""},
  {id:"f10", sow:"9",  group:"3", farrowingDate:"2025-07-17", exposureStart:"2025-03-24", exposureEnd:"2025-05-05", sire:"AO",      motheringQuality:"poor",    demeanor:"", totalBorn:11, deaths:11, location:"outside-pen", wentWell:"", didntGoWell:"Better shade paddocks when pregnant, or potentially no summer farrowing", defects:"Premature. Most died immediately, oldest only lasted 2 days"},
  {id:"f11", sow:"2",  group:"2", farrowingDate:"2024-09-08", exposureStart:"", exposureEnd:"", sire:"MACHINE", motheringQuality:"average", demeanor:"nightmare to get into farrowing pen", totalBorn:7, deaths:1, location:"", wentWell:"", didntGoWell:"one piglet was crushed by hay under waterer, probably wasn't packed down enough or too much was used", defects:""},
  {id:"f12", sow:"10", group:"2", farrowingDate:"2024-07-25", exposureStart:"", exposureEnd:"", sire:"AO",      motheringQuality:"",        demeanor:"", totalBorn:11, deaths:1, location:"", wentWell:"", didntGoWell:"", defects:"one crushed"},
  {id:"f13", sow:"5",  group:"2", farrowingDate:"2024-07-19", exposureStart:"", exposureEnd:"", sire:"",        motheringQuality:"",        demeanor:"aggressive when getting into pen with her", totalBorn:8, deaths:1, location:"outside-pen", wentWell:"built pen around her after birth", didntGoWell:"", defects:"0, crushed piglet 3 days after birth"},
];



// ── Layer housing count helpers (top-level, no React state) ────────────────
// Model X: current_count is a *verified anchor* set by physical counts (manual
// or via daily report layer_count). Mortality reports do NOT mutate it.
// Projected count is computed at display time from anchor minus mortalities.

// Update housing anchor when a daily report includes a hen count.
// Sets current_count to the new value AND current_count_date to the report date.
// Phase 2.1 prep: setHousingAnchorFromReport + computeProjectedCount + computeLayerFeedCost moved to src/lib/layerHousing.js (imported at top of file).



// ── DATE HELPERS ───────────────────────────────────────────────────────────
// Phase 2.3 prep: date utils moved to src/lib/dateUtils.js.

// ── BUSINESS LOGIC ─────────────────────────────────────────────────────────

function calcTargetHatch(processingDate, breed){
  if(!processingDate) return null;
  // schoonerOut = processingDate - 1, so hatch = processingDate - 1 - schoonerDays - brooderDays
  const totalDays = 1 + BROODER_DAYS + (breed==="WR" ? WR_SCHOONER : CC_SCHOONER);
  return toISO(addDays(processingDate, -totalDays));
}

function suggestHatchDates(targetISO){
  if(!targetISO) return [];
  const out=[];
  for(let i=-3;i<=3;i++){
    const d=addDays(targetISO,i);
    const dow=d.getDay();
    if(dow>=1&&dow<=5){
      out.push({iso:toISO(d), offset:i, day:["","Mon","Tue","Wed","Thu","Fri"][dow], label:fmtS(toISO(d))});
    }
  }
  return out;
}

function overlaps(a1,a2,b1,b2){
  return new Date(a1+"T12:00:00")<=new Date(b2+"T12:00:00")
      && new Date(a2+"T12:00:00")>=new Date(b1+"T12:00:00");
}

function detectConflicts(form, batches, layerBatches, editId){
  const tl=calcTimeline(form.hatchDate, form.breed, form.processingDate);
  if(!tl) return [];
  const safeAddDays=(dateStr,n)=>{
    if(!dateStr) return null;
    try { return toISO(addDays(dateStr,n)); } catch(e) { return null; }
  };
  const bEnd=safeAddDays(tl.brooderOut,  BROODER_CLEANOUT);
  const sEnd=safeAddDays(tl.schoonerOut, SCHOONER_CLEANOUT);
  if(!bEnd&&!sEnd) return [];
  const out=[];
  // Hard conflicts: broiler vs broiler
  for(const b of batches){
    if(b.id===editId) continue;
    if(b.brooder===form.brooder && b.brooderIn && b.brooderOut && bEnd){
      const exEnd=safeAddDays(b.brooderOut, BROODER_CLEANOUT);
      if(exEnd && overlaps(tl.brooderIn,bEnd,b.brooderIn,exEnd))
        out.push({soft:false,message:'Brooder '+form.brooder+' conflict with "'+b.name+'" (brooder '+fmtS(b.brooderIn)+'\u2013'+fmtS(b.brooderOut)+' + '+BROODER_CLEANOUT+'d cleanout)'});
    }
    if(b.schooner===form.schooner && b.schoonerIn && b.schoonerOut && sEnd){
      const exEnd=safeAddDays(b.schoonerOut, SCHOONER_CLEANOUT);
      if(exEnd && overlaps(tl.schoonerIn,sEnd,b.schoonerIn,exEnd))
        out.push({soft:false,message:'Schooner '+form.schooner+' conflict with "'+b.name+'" (schooner '+fmtS(b.schoonerIn)+'\u2013'+fmtS(b.schoonerOut)+' + '+SCHOONER_CLEANOUT+'d cleanout)'});
    }
  }
  // Soft conflicts: broiler vs layer (layer brooder/schooner names have prefix to strip)
  if(layerBatches&&layerBatches.length){
    for(const lb of layerBatches){
      if(lb.status==='retired') continue;
      if(lb.name==='Retirement Home') continue;
      // Strip "Brooder " / "Schooner " prefix to compare with broiler form values
      const lbBrooderId = (lb.brooder_name||'').replace(/^Brooder\s*/i,'').trim();
      const lbSchoonerId = (lb.schooner_name||'').replace(/^Schooner\s*/i,'').trim();
      // Brooder check
      if(lbBrooderId && lbBrooderId===form.brooder && lb.brooder_entry_date && bEnd){
        const lbBOut = lb.brooder_exit_date || safeAddDays(lb.brooder_entry_date,21);
        if(lbBOut){
          const lbBExEnd = safeAddDays(lbBOut, BROODER_CLEANOUT);
          if(lbBExEnd && overlaps(tl.brooderIn,bEnd,lb.brooder_entry_date,lbBExEnd))
            out.push({soft:true,message:'Brooder '+form.brooder+' overlaps layer batch "'+lb.name+'" (brooder '+fmtS(lb.brooder_entry_date)+'\u2013'+fmtS(lbBOut)+')'});
        }
      }
      // Schooner check
      if(lbSchoonerId && lbSchoonerId===form.schooner && lb.schooner_entry_date && sEnd){
        const lbSOut = lb.schooner_exit_date || safeAddDays(lb.schooner_entry_date,119);
        if(lbSOut){
          const lbSExEnd = safeAddDays(lbSOut, SCHOONER_CLEANOUT);
          if(lbSExEnd && overlaps(tl.schoonerIn,sEnd,lb.schooner_entry_date,lbSExEnd))
            out.push({soft:true,message:'Schooner '+form.schooner+' overlaps layer batch "'+lb.name+'" (schooner '+fmtS(lb.schooner_entry_date)+'\u2013'+fmtS(lbSOut)+')'});
        }
      }
    }
  }
  return out;
}

// ── EMPTY FORM ─────────────────────────────────────────────────────────────
const EMPTY_FORM = {
  name:"", breed:"CC", hatchery:"Meyer Hatchery",
  hatchDate:"", birdCount:750, birdCountActual:"",
  brooder:"1", schooner:"2&3",
  processingDate:"", status:"planned", notes:"",
  // Podio fields
  brooderIn:"", brooderOut:"",
  brooderFeedLbs:0, schoonerFeedLbs:0, gritLbs:0,
  mortalityCumulative:0,
  week4Lbs:0, week6Lbs:0,
  perLbStandardCost:0, perLbStarterCost:0, perLbGritCost:0,
  totalToProcessor:0, processingCost:0,
  avgBreastLbs:0, avgThighsLbs:0, avgDressedLbs:0,
  totalLbsWhole:0, totalLbsCuts:0,
  documents:[],
};

// ══════════════════════════════════════════════════════════════════════════
// MAIN APP
// ══════════════════════════════════════════════════════════════════════════


// Shown when the user lands via a password reset / invite link. Supabase has
// already exchanged the recovery token for a session, but we hold them here
// to set their password before they reach the home screen. After update, we
// clear the recovery flag and they continue into the app already signed in.
// Phase 2.1.5: SetPasswordScreen moved to src/auth/SetPasswordScreen.jsx.


// Phase 2.1.5: LoginScreen moved to src/auth/LoginScreen.jsx.;


// Phase 2 Round 5 fix: S styles object moved to src/lib/styles.js.

// ── PERMISSION HELPERS ──────────────────────────────────────
function canEditDailys(role)     { return ['farm_team','management','admin'].includes(role); }
function canDeleteDailys(role)   { return ['farm_team','management','admin'].includes(role); }
function canEditAnything(role)   { return ['management','admin'].includes(role); }
function canDeleteAnything(role) { return role==='admin'; }

// ── USERS MODAL ── (standalone component — must NOT be nested inside App)
// Phase 2 Round 3: UsersModal moved to C:\Users\Ronni\WCF-planner\src\auth\UsersModal.jsx.


// ── ADD FEED WEBFORM ──────────────────────────────────────────────────────────
// Public webform for quick feed logging. Inserts a new row into the appropriate
// *_dailys table with source='add_feed_webform'. No merge, no collision check.
// Admin-configurable: fields can be toggled on/off, marked required, relabeled.
// Supports Add Group (multiple batch+feed entries per submit).
// Phase 2 Round 5: AddFeedWebform moved to C:\Users\Ronni\WCF-planner\src\webforms\AddFeedWebform.jsx.


// Recompute the broiler session's average and write it to the matching
// batch's week4Lbs / week6Lbs in app_store.ppp-v4. ONLY runs for sessions
// already marked complete -- draft saves never bleed into the batch tile.
// Called from completeSession (webform), completeFromAdmin (admin), and
// saveAdminGrid (admin in-place edits on already-complete sessions).
async function writeBroilerBatchAvg(sb, sessionRow, sessionEntries) {
  if(!sb || !sessionRow || sessionRow.species !== 'broiler') return;
  if(sessionRow.status !== 'complete') return;
  if(!sessionRow.batch_id || !(sessionRow.broiler_week === 4 || sessionRow.broiler_week === 6)) return;
  if(!sessionEntries || sessionEntries.length === 0) return;
  var sum = 0, n = 0;
  for(var i=0;i<sessionEntries.length;i++){
    var w = parseFloat(sessionEntries[i].weight);
    if(!isNaN(w) && w > 0) { sum += w; n++; }
  }
  if(n === 0) return;
  var avg = Math.round((sum / n) * 100) / 100;
  var fieldKey = sessionRow.broiler_week === 4 ? 'week4Lbs' : 'week6Lbs';
  var resp = await sb.from('app_store').select('data').eq('key','ppp-v4').maybeSingle();
  if(!resp || !resp.data || !Array.isArray(resp.data.data)) return;
  var updated = resp.data.data.map(function(b){
    return (b.name === sessionRow.batch_id) ? Object.assign({}, b, {[fieldKey]: avg}) : b;
  });
  await sb.from('app_store').upsert({key:'ppp-v4', data: updated, updated_at: new Date().toISOString()}, {onConflict:'key'});
}

// ── WEIGH-INS WEBFORM ──────────────────────────────────────────────────────
// Public webform for weigh-in sessions. Three species flows:
//   - Cattle: session-based with autosave + diminishing tag dropdown + new-tag flag
//   - Pig: per-row weights for an active feeder batch (no tag); send-to-trip later
//   - Broiler: 4-week / 6-week weighings, ~15 birds, average auto-fills batch
// All entries persist to weigh_in_sessions + weigh_ins immediately. Phone drop
// recoverable: re-open the form, pick "Resume" on a draft session.
// Phase 2 Round 5: WeighInsWebform moved to C:\Users\Ronni\WCF-planner\src\webforms\WeighInsWebform.jsx.


// Phase 2 Round 5: WebformHub moved to C:\Users\Ronni\WCF-planner\src\webforms\WebformHub.jsx.

// Phase 2 Round 4: FeedCostsPanel moved to C:\Users\Ronni\WCF-planner\src\admin\FeedCostsPanel.jsx.


// ── FEED COST BY MONTH PANEL ────────────────────────────────────────────────
// Admin \u2192 Cost by Month. Aggregates feed spend across programs by month.
// Pig/Broiler/Layer multiply feed_lbs by the per-lb rates in FeedCostsPanel.
// Cattle multiplies each daily's feed-line qty by the matching feed-input
// cost_per_unit from the Livestock Feed Inputs panel.
// Current costs are used for all rows (no per-month historical cost ledger),
// so retroactive price changes affect historical totals.
// Phase 2 Round 4: FeedCostByMonthPanel moved to C:\Users\Ronni\WCF-planner\src\admin\FeedCostByMonthPanel.jsx.


// ── LIVESTOCK FEED INPUTS PANEL ─────────────────────────────────────────────
// Admin → Feed sub-section. Full feed master list with nutrition, costs, herd
// scoping. Reusable for cattle today, sheep later. Autosave on close.
// Test PDF upload + version history is built out separately (Phase 1 step 5).
// Phase 2 Round 4: LivestockFeedInputsPanel moved to C:\Users\Ronni\WCF-planner\src\admin\LivestockFeedInputsPanel.jsx.


// ── NUTRITION TARGETS PANEL ─────────────────────────────────────────────────
// Admin → Feed sub-section. Per-herd DM/CP/NFC target percentages used by the
// dashboard rolling-window comparison and the recommendation engine.
// Phase 2 Round 4: NutritionTargetsPanel moved to C:\Users\Ronni\WCF-planner\src\admin\NutritionTargetsPanel.jsx.


// Phase 2.1.2: DeleteModal moved to src/shared/DeleteModal.jsx.


function App(){
  // ── AUTH & LOADING STATE ──
  // Phase 2.0.1: these hooks live in AuthContext. See src/contexts/AuthContext.jsx
  // for the pwRecovery URL-hash initializer and other state defaults. Effects
  // (auth listener, visibility refresh, access-gate redirect), helpers
  // (loadUser, loadAllData, canAccessProgram), and derived values remain here.
  const {
    authState,   setAuthState,
    pwRecovery,  setPwRecovery,
    dataLoaded,  setDataLoaded,
    saveStatus,  setSaveStatus,
    showUsers,   setShowUsers,
    allUsers,    setAllUsers,
    inviteEmail, setInviteEmail,
    inviteRole,  setInviteRole,
    inviteMsg,   setInviteMsg,
  } = useAuth();

  // Phase 2.0.2: broiler batch + edit-form hooks live in BatchesContext.
  const {
    batches,         setBatches,
    showForm,        setShowForm,
    editId,          setEditId,
    form,            setForm,
    originalForm,    setOriginalForm,
    conflicts,       setConflicts,
    tlStart,         setTlStart,
    tooltip,         setTooltip,
    override,        setOverride,
    showLegacy,      setShowLegacy,
    parsedProcessor, setParsedProcessor,
    docUploading,    setDocUploading,
    deleteConfirm,   setDeleteConfirm,
  } = useBatches();

  // Phase 2.0.3: pig-scoped hooks live in PigContext.
  const {
    pigData, setPigData,
    breedingCycles, setBreedingCycles,
    farrowingRecs, setFarrowingRecs,
    boarNames, setBoarNames,
    breedTlStart, setBreedTlStart,
    showBreedForm, setShowBreedForm,
    editBreedId, setEditBreedId,
    breedForm, setBreedForm,
    showFarrowForm, setShowFarrowForm,
    editFarrowId, setEditFarrowId,
    farrowForm, setFarrowForm,
    farrowFilter, setFarrowFilter,
    feederGroups, setFeederGroups,
    showFeederForm, setShowFeederForm,
    editFeederId, setEditFeederId,
    feederForm, setFeederForm,
    originalFeederForm, setOriginalFeederForm,
    activeTripBatchId, setActiveTripBatchId,
    tripForm, setTripForm,
    editTripId, setEditTripId,
    sowSearch, setSowSearch,
    expandedSow, setExpandedSow,
    archivedSows, setArchivedSows,
    breeders, setBreeders,
    breedOptions, setBreedOptions,
    originOptions, setOriginOptions,
    showBreederForm, setShowBreederForm,
    editBreederId, setEditBreederId,
    breederForm, setBreederForm,
  } = usePig();

  // Phase 2.0.4: layer-scoped hooks live in LayerContext.
  const {
    layerGroups,      setLayerGroups,
    layerBatches,     setLayerBatches,
    layerHousings,    setLayerHousings,
    allLayerDailys,   setAllLayerDailys,
    allEggDailys,     setAllEggDailys,
    layerDashPeriod,  setLayerDashPeriod,
    retHomeDashPeriod,setRetHomeDashPeriod,
  } = useLayer();

  // Phase 2.0.5: recent-window dailys arrays live in DailysRecentContext.
  const {
    broilerDailys,     setBroilerDailys,
    pigDailys,         setPigDailys,
    layerDailysRecent, setLayerDailysRecent,
    eggDailysRecent,   setEggDailysRecent,
    cattleDailysRecent,setCattleDailysRecent,
    sheepDailysRecent, setSheepDailysRecent,
  } = useDailysRecent();

  // Phase 2.0.6 — small bundled contexts.
  const { cattleForHome, setCattleForHome, cattleOnFarmCount, setCattleOnFarmCount } = useCattleHome();
  const { sheepForHome,  setSheepForHome } = useSheepHome();
  const { wfGroups, setWfGroups, wfTeamMembers, setWfTeamMembers, webformsConfig, setWebformsConfig } = useWebformsConfig();
  const { feedCosts, setFeedCosts, broilerNotes, setBroilerNotes, missedCleared, setMissedCleared } = useFeedCosts();
  const { view, setView, pendingEdit, setPendingEdit, showAllComparison, setShowAllComparison, showMenu, setShowMenu } = useUI();

  // Permission helpers — role-based access
  // farm_team: edit+delete own dailys only
  // management: edit anything, delete dailys only
  // admin: full access
  const role = authState?.role;
  const isAdmin      = role==='admin';
  const isMgmt       = role==='management' || role==='admin';
  const isFarmTeam   = role==='farm_team';
  const canEditAll   = isMgmt;          // management + admin can edit anything
  const canDeleteDailys = isMgmt || isFarmTeam; // all roles can delete dailys
  const canDeleteAll = isAdmin;          // only admin can delete batches, groups, etc.
  const autoSaveTimer = React.useRef(null);
  const pigAutoSaveTimer = React.useRef(null);
  const subAutoSaveTimer = React.useRef(null);
  const tripAutoSaveTimer = React.useRef(null);
  const breedAutoSaveTimer = React.useRef(null);
  const [leaderboardExpanded, setLeaderboardExpanded] = useState(false);
  const [showArchived,   setShowArchived]  = useState(false);
  const [showArchBatches,setShowArchBatches]= useState(false);
  const [feedOrders,   setFeedOrders]    = useState({pig:{},starter:{},grower:{},layerfeed:{}});
  const [pigFeedInventory, setPigFeedInventory] = useState(null); // {count, date} or null
  const [pigFeedExpandedMonths, setPigFeedExpandedMonths] = useState(new Set());
  const [poultryFeedInventory, setPoultryFeedInventory] = useState(null); // {starter:{count,date}, grower:{count,date}, layer:{count,date}}
  const [poultryFeedExpandedMonths, setPoultryFeedExpandedMonths] = useState(new Set());
  const [adminTab,      setAdminTab]      = useState('webforms'); // 'webforms' | 'feedcosts'
  const [wfForm,     setWfForm]     = useState(()=>{const d=new Date();return{date:`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`,teamMember:localStorage.getItem('wcf_team')||'',batchId:'',pigCount:'',feedLbs:'',groupMoved:true,nippleDrinkerMoved:true,nippleDrinkerWorking:true,troughsMoved:true,fenceWalked:true,fenceVoltage:'',issues:''};});
  const [wfSubmitting,setWfSubmitting]= useState(false);
  const [wfDone,     setWfDone]     = useState(false);
  const [wfErr,      setWfErr]      = useState('');
  const [wfGroupName,setWfGroupName]= useState('');
  const [wfView,         setWfView]        = useState("list"); // list | edit-webform | edit-field
  const [editWfId,       setEditWfId]      = useState(null);
  const [editFieldId,    setEditFieldId]   = useState(null);
  const [wfFieldForm,    setWfFieldForm]   = useState({label:"",type:"text",required:false,options:[]});
  const [newTeamMember,  setNewTeamMember] = useState("");
  // Webforms admin state — must live at App top-level (React hooks rules)
  const [addingTo,       setAddingTo]      = useState(null);
  const [editFldLbl,     setEditFldLbl]    = useState(null);
  const [editFldVal,     setEditFldVal]    = useState('');
  const [editSecIdx,     setEditSecIdx]    = useState(null);
  const [editSecVal,     setEditSecVal]    = useState('');
  const [newOpt,         setNewOpt]        = useState('');
  const [showSubForm,    setShowSubForm]   = useState(null); // batchId or null
  const [subForm,        setSubForm]       = useState({name:"",giltCount:0,boarCount:0,originalPigCount:0,notes:""});
  const [editSubId,      setEditSubId]     = useState(null);
  const [collapsedBatches, setCollapsedBatches] = useState(new Set());
  const [collapsedMonths,  setCollapsedMonths]  = useState(()=>{
    // Auto-collapse past months on init
    const s = new Set();
    const now = new Date();
    const thisYM = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}`;
    // We'll populate this in the feed view
    return s;
  });
  const [pigNotes,         setPigNotes]         = useState('');
  const [layerNotes,       setLayerNotes]       = useState('');
  const [dailysFilter,     setDailysFilter]     = useState({batchId:"all",dateFrom:"",dateTo:""});
  const [showDailyForm,    setShowDailyForm]    = useState(false);
  const [editDailyId,      setEditDailyId]      = useState(null);
  const EMPTY_DAILY = {date:"",teamMember:"",batchId:"",batchLabel:"",pigCount:"",feedLbs:"",groupMoved:true,nippleDrinkerMoved:true,nippleDrinkerWorking:true,troughsMoved:true,fenceWalked:true,fenceVoltage:"",issues:""};
  const [dailyForm,        setDailyForm]        = useState(()=>{const d=new Date();return{...{date:`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`,teamMember:"",batchId:"",batchLabel:"",pigCount:"",feedLbs:"",groupMoved:true,nippleDrinkerMoved:true,nippleDrinkerWorking:true,troughsMoved:true,fenceWalked:true,fenceVoltage:"",issues:""}};});



  // ── AUTH LISTENER & DATA LOADING ──
  // Load webform config (anon, no auth needed) — team members + active groups
  useEffect(()=>{
    if(view!=="webform"&&view!=="webformhub") return;
    Promise.all([
      sb.from('webform_config').select('data').eq('key','team_members').maybeSingle(),
      sb.from('webform_config').select('data').eq('key','active_groups').maybeSingle(),
      sb.from('webform_config').select('data').eq('key','full_config').maybeSingle(),
    ]).then(([tmRes, agRes, fcRes])=>{
      // Team members
      if(!tmRes.error && Array.isArray(tmRes.data?.data)){
        const tm = tmRes.data.data;
        if(tm.length>0) setWfTeamMembers(tm);
      }
      // Active groups
      if(!agRes.error && Array.isArray(agRes.data?.data)){
        const groups = agRes.data.data.map(name=>({value:name, label:name}));
        setWfGroups(groups);
      }
      // Full config for webformhub (broiler/layer/egg groups + team members)
      if(!fcRes?.error && fcRes?.data?.data){
        const fc = fcRes.data.data;
        if(fc.teamMembers?.length>0 && wfTeamMembers.length===0) setWfTeamMembers(fc.teamMembers);
        // broilerGroups and layerGroups come through layerGroups/batches props from App
        // but if not logged in, we can still get them from full_config
      }
    });
  },[view]);

  // Load cattle count for Home page Animals on Farm tile
  useEffect(()=>{
    if(!authState) return;
    sb.from('cattle').select('*',{count:'exact', head:true}).in('herd',['mommas','backgrounders','finishers','bulls']).then(({count})=>{
      if(count!=null) setCattleOnFarmCount(count);
    }).catch(()=>{});
  },[authState]);

  // Load broiler dailys after auth is confirmed — same pattern as BroilerDailysView
  useEffect(()=>{
    if(!authState) return;
    // Load all broiler dailys (paginated) for batch calculations
    (async()=>{
      let all=[],from=0;
      while(true){
        const{data}=await sb.from('poultry_dailys').select('*').order('date',{ascending:false}).order('submitted_at',{ascending:false}).range(from,from+999);
        if(!data||data.length===0) break;
        all=[...all,...data];
        if(data.length<1000) break;
        from+=1000;
      }
      if(all.length>0) setBroilerDailys(all);
    })();
    // Load layer + egg dailys (45 days) for home page & dashboard calculations
    const cutoff = toISO(addDays(new Date(), -45));
    sb.from('layer_dailys').select('*').gte('date',cutoff).order('date',{ascending:false}).then(({data})=>{ if(data) setLayerDailysRecent(data); });
    sb.from('egg_dailys').select('*').gte('date',cutoff).order('date',{ascending:false}).then(({data})=>{ if(data) setEggDailysRecent(data); });
    // Cattle + sheep dailys (last 14 days) — drives missed-report check + Last 5 Days tiles on home
    const cutoff14 = toISO(addDays(new Date(), -14));
    sb.from('cattle_dailys').select('*').gte('date',cutoff14).order('date',{ascending:false}).then(({data})=>{ if(data) setCattleDailysRecent(data); });
    sb.from('sheep_dailys').select('*').gte('date',cutoff14).order('date',{ascending:false}).then(({data})=>{ if(data) setSheepDailysRecent(data); });
    // Lightweight cattle + sheep directory (id + flock/herd only) for the missed-report active-flock check
    sb.from('cattle').select('id,herd').then(({data})=>{ if(data) setCattleForHome(data); });
    sb.from('sheep').select('id,flock').then(({data})=>{ if(data) setSheepForHome(data); });
    // Full paginated fetch for layer dashboard period comparisons
    (async()=>{
      const fetchAll=async(table)=>{const PAGE=1000;let all=[],off=0;while(true){const{data}=await sb.from(table).select('*').order('date',{ascending:false}).range(off,off+PAGE-1);if(!data||data.length===0)break;all=all.concat(data);if(data.length<PAGE)break;off+=PAGE;}return all;};
      const [ld,ed]=await Promise.all([fetchAll('layer_dailys'),fetchAll('egg_dailys')]);
      setAllLayerDailys(ld); setAllEggDailys(ed);
    })();
  },[authState]);

  // refreshDailys('broiler' | 'layer' | 'egg' | 'pig' | 'all') — re-fetches the cached
  // App-level dailys arrays so dashboards reflect inline edits without sign-out/in.
  // Passed as a prop to all four DailysView components so their save() can call it.
  async function refreshDailys(kind){
    const want = (k)=> kind==='all'||kind===k;
    if(want('broiler')){
      let all=[],from=0;
      while(true){
        const{data}=await sb.from('poultry_dailys').select('*').order('date',{ascending:false}).order('submitted_at',{ascending:false}).range(from,from+999);
        if(!data||data.length===0) break;
        all=[...all,...data];
        if(data.length<1000) break;
        from+=1000;
      }
      setBroilerDailys(all);
    }
    const cutoff = toISO(addDays(new Date(), -45));
    if(want('layer')){
      const {data} = await sb.from('layer_dailys').select('*').gte('date',cutoff).order('date',{ascending:false});
      if(data) setLayerDailysRecent(data);
      const fetchAll=async()=>{const PAGE=1000;let all=[],off=0;while(true){const{data}=await sb.from('layer_dailys').select('*').order('date',{ascending:false}).range(off,off+PAGE-1);if(!data||data.length===0)break;all=all.concat(data);if(data.length<PAGE)break;off+=PAGE;}return all;};
      setAllLayerDailys(await fetchAll());
    }
    if(want('egg')){
      const {data} = await sb.from('egg_dailys').select('*').gte('date',cutoff).order('date',{ascending:false});
      if(data) setEggDailysRecent(data);
      const fetchAll=async()=>{const PAGE=1000;let all=[],off=0;while(true){const{data}=await sb.from('egg_dailys').select('*').order('date',{ascending:false}).range(off,off+PAGE-1);if(!data||data.length===0)break;all=all.concat(data);if(data.length<PAGE)break;off+=PAGE;}return all;};
      setAllEggDailys(await fetchAll());
    }
    if(want('pig')){
      const {data} = await sb.from('pig_dailys').select('*').order('date',{ascending:false});
      if(data) setPigDailys(data);
    }
  }

  // Guard: unknown views fall back to home (must be unconditional)
  const VALID_VIEWS = ['home','broilerHome','pigsHome','layersHome','timeline','list','feed','pigfeed','pigs','breeding','pigbatches','farrowing','sows','webforms','webformhub','webform','broilerdailys','pigdailys','layers','layerbatches','layerdailys','eggdailys','addfeed','weighins','cattleHome','cattleherds','cattledailys','cattleweighins','cattlebreeding','cattlebatches','broilerweighins','pigweighins','sheepHome','sheepflocks','sheepdailys','sheepweighins','equipmentHome'];
  useEffect(()=>{ if(view && !VALID_VIEWS.includes(view)) setView('home'); }, [view]);

  // Per-program access. profiles.program_access is null/empty = full access,
  // or a list like ['cattle','broiler']. Admins always bypass the check.
  // Maps every program-specific view to its program key. Views not in the
  // map (home, webforms, weighins, etc.) are always accessible.
  const VIEW_TO_PROGRAM = {
    broilerHome:'broiler', timeline:'broiler', list:'broiler', feed:'broiler', broilerdailys:'broiler', broilerweighins:'broiler',
    layersHome:'layer',   layerbatches:'layer', layerdailys:'layer', eggdailys:'layer', layers:'layer',
    pigsHome:'pig',       breeding:'pig', farrowing:'pig', sows:'pig', pigbatches:'pig', pigs:'pig', pigfeed:'pig', pigdailys:'pig', pigweighins:'pig',
    cattleHome:'cattle',  cattleherds:'cattle', cattledailys:'cattle', cattleweighins:'cattle', cattlebreeding:'cattle', cattlebatches:'cattle',
    sheepHome:'sheep',    sheepflocks:'sheep', sheepdailys:'sheep', sheepweighins:'sheep',
    equipmentHome:'equipment',
  };
  function canAccessProgram(prog) {
    if(!prog) return true;
    if(!authState || authState === false || !authState.profile) return true;
    if(authState.role === 'admin') return true;
    const list = authState.profile.program_access;
    if(!Array.isArray(list) || list.length === 0) return true;
    return list.includes(prog);
  }
  // Redirect to home if user lands on a program view they don't have access to.
  useEffect(()=>{
    const prog = VIEW_TO_PROGRAM[view];
    if(prog && !canAccessProgram(prog)) setView('home');
  }, [view, authState]);

  useEffect(()=>{
    // Safety timeout — if auth hasn't resolved in 6s, show login
    const authTimeout = setTimeout(()=>{
      setAuthState(prev => prev === null ? false : prev);
    }, 6000);

    // Use getUser() instead of getSession() to avoid storage lock issues
    sb.auth.getUser().then(async ({data:{user}, error})=>{
      clearTimeout(authTimeout);
      if(user && !error){ await loadUser(user); }
      else { setAuthState(false); }
    }).catch(()=>{ clearTimeout(authTimeout); setAuthState(false); });

    const {data:{subscription}} = sb.auth.onAuthStateChange(async (event, session)=>{
      if(event==='SIGNED_OUT'){
        setAuthState(false); setDataLoaded(false); setPwRecovery(false);
      }
      // Password-reset / invite link landed — hold the user on SetPasswordScreen
      // until they pick a password, then continue them into the app.
      if(event==='PASSWORD_RECOVERY'){
        setPwRecovery(true);
      }
      // Handle SIGNED_IN only when on login screen (authState===false), not on page-load token refresh
      if(event==='SIGNED_IN' && session?.user){
        setAuthState(prev=>{
          if(prev===false) loadUser(session.user);
          return prev;
        });
      }
    });
    return ()=>{ subscription.unsubscribe(); clearTimeout(authTimeout); };
  },[]);

  // Refresh Supabase session when tab becomes visible (prevents stale session after backgrounding)
  useEffect(()=>{
    function handleVisibility(){
      if(document.visibilityState==='visible'&&authState&&authState.user){
        sb.auth.getUser().then(function(res){
          if(res.error){
            console.warn('Session expired, signing out');
            sb.auth.signOut();
          }
        }).catch(function(){});
      }
    }
    document.addEventListener('visibilitychange',handleVisibility);
    return function(){document.removeEventListener('visibilitychange',handleVisibility);};
  },[authState]);

  async function loadUser(user){
    try {
      // Race the profile fetch against a 5s timeout
      const profilePromise = sb.from('profiles').select('*').eq('id',user.id).single();
      const timeoutPromise = new Promise((_,reject) => setTimeout(()=>reject(new Error('timeout')), 5000));
      const {data:profile} = await Promise.race([profilePromise, timeoutPromise]).catch(()=>({data:null}));
      setAuthState({user, role:profile?.role||'farm_team', profile, name:profile?.full_name||user.email});
      await loadAllData();
    } catch(e) {
      console.error('loadUser error:', e);
      setAuthState({user, role:'admin', name:user.email});
      setDataLoaded(true);
    }
  }

  async function loadAllData(){
    try {
    const {data,error} = await sb.from('app_store').select('*');
    if(!error && data){
      const store={};
      data.forEach(row=>store[row.key]=row.data);
      if(store['ppp-v4']) {
        // Migrate: archived → processed, brooderIn=hatchDate → hatchDate+1, FR breed for B-24-02..B-25-01
        let changed=false;
        const frBatchNames=['B-24-02','B-24-03','B-24-04','B-25-01'];
        const migrated = store['ppp-v4'].map(b=>{
          let nb=b;
          if(b.status==='archived'){nb={...nb,status:'processed'};changed=true;}
          // Fix brooderIn if it equals hatchDate (was same-day, should be +1)
          if(b.status!=='processed'&&b.hatchDate&&b.brooderIn===b.hatchDate){
            try {
              const newBrooderIn=toISO(addDays(new Date(b.hatchDate+'T12:00:00'),1));
              nb={...nb,brooderIn:newBrooderIn};
              changed=true;
            } catch(e){}
          }
          // Hard-code Freedom Ranger breed/hatchery for legacy B-24-02..B-25-01 batches
          const nameUpper=String(nb.name||'').toUpperCase();
          if(frBatchNames.includes(nameUpper)){
            if(nb.breed!=='FR'){nb={...nb,breed:'FR'};changed=true;}
            if(nb.hatchery!=='Freedom Ranger Hatchery'){nb={...nb,hatchery:'Freedom Ranger Hatchery'};changed=true;}
          }
          return nb;
        });
        setBatches(migrated);
        if(changed){ sb.from('app_store').upsert({key:'ppp-v4',data:migrated},{onConflict:'key'}).then(()=>{}); }
      }
      if(store['ppp-pigs-v1']) setPigData(store['ppp-pigs-v1']);
      if(store['ppp-breeding-v1']) setBreedingCycles(store['ppp-breeding-v1']);
      if(store['ppp-farrowing-v1']) setFarrowingRecs(store['ppp-farrowing-v1']||INITIAL_FARROWING);
      if(store['ppp-boars-v1']) setBoarNames(store['ppp-boars-v1']);
      if(store['ppp-feeders-v1']) setFeederGroups(store['ppp-feeders-v1']);
      if(store['ppp-feed-costs-v1']) setFeedCosts({starter:0,grower:0,layer:0,pig:0,grit:0,...store['ppp-feed-costs-v1']});
      if(store['ppp-archived-sows-v1']) setArchivedSows(store['ppp-archived-sows-v1']||[]);
      if(store['ppp-breeders-v1']) setBreeders(store['ppp-breeders-v1'].length>0?store['ppp-breeders-v1']:INITIAL_BREEDERS); else setBreeders(INITIAL_BREEDERS);
      if(store['ppp-breed-options-v1']) setBreedOptions(store['ppp-breed-options-v1']);
      if(store['ppp-origin-options-v1']) setOriginOptions(store['ppp-origin-options-v1']);
      if(store['ppp-pigs-v1']) setPigData(store['ppp-pigs-v1']);
      if(store['ppp-webforms-v1']){
        // Inject Add Feed webform entry if not already present
        var wfCfg=store['ppp-webforms-v1'];
        if(!(wfCfg.webforms||[]).find(function(w){return w.id==='add-feed-webform';})){
          wfCfg={...wfCfg,webforms:[...(wfCfg.webforms||[]),{id:'add-feed-webform',teamMembers:[],name:'Add Feed Webform',description:'Quick feed logging for pig, broiler, and layer programs',table:'multiple',allowAddGroup:false,sections:[
            {id:'s-info',title:'Report Info',system:true,fields:[
              {id:'date',label:'Date',type:'date',required:true,system:true,enabled:true},
              {id:'team_member',label:'Team Member',type:'team_picker',required:false,system:false,enabled:true}
            ]},
            {id:'s-feed',title:'Feed',system:false,fields:[
              {id:'batch_label',label:'Batch / Group',type:'group_picker',required:true,system:true,enabled:true},
              {id:'feed_type',label:'Feed Type',type:'button_toggle',options:['STARTER','GROWER','LAYER'],required:true,system:false,enabled:true},
              {id:'feed_lbs',label:'Feed (lbs)',type:'number',required:true,system:false,enabled:true}
            ]}
          ]}]};
        }
        // Inject Cattle Daily webform entry if not already present (config may pre-date the cattle module)
        if(!(wfCfg.webforms||[]).find(function(w){return w.id==='cattle-dailys';})){
          wfCfg={...wfCfg,webforms:[...(wfCfg.webforms||[]),{id:'cattle-dailys',teamMembers:[],name:'Cattle Daily Report',description:'Daily care report for cattle herds',table:'cattle_dailys',allowAddGroup:false,sections:[
            {id:'s-info',title:'Report Info',system:true,fields:[
              {id:'date',label:'Date',type:'date',required:true,system:true,enabled:true},
              {id:'team_member',label:'Team Member',type:'team_picker',required:true,system:true,enabled:true}
            ]},
            {id:'s-herd',title:'Cattle Herd',system:true,fields:[
              {id:'herd',label:'Herd (mommas/backgrounders/finishers/bulls)',type:'herd_picker',required:true,system:true,enabled:true}
            ]},
            {id:'s-feeds',title:'Feeds & Minerals',system:true,fields:[
              {id:'feeds',label:'Feeds (multi-line, with creep toggle)',type:'feed_lines',required:false,system:true,enabled:true},
              {id:'minerals',label:'Minerals (multi-line)',type:'mineral_lines',required:false,system:true,enabled:true}
            ]},
            {id:'s-checks',title:'Daily Checks',system:false,fields:[
              {id:'fence_voltage',label:'Fence voltage (kV)',type:'number',required:false,system:false,enabled:true},
              {id:'water_checked',label:'Water source checked?',type:'yes_no',required:false,system:false,enabled:true}
            ]},
            {id:'s-comments',title:'Comments',system:false,fields:[
              {id:'issues',label:'Comments / Issues',type:'textarea',required:false,system:false,enabled:true}
            ]}
          ]}]};
        }
        // Cattle-only: strip s-mortality section from any previously-saved config
        // (mortality is handled via the cow record now, not the webform).
        wfCfg = {...wfCfg, webforms: (wfCfg.webforms||[]).map(function(w){
          if(w.id !== 'cattle-dailys') return w;
          return {...w, sections: (w.sections||[]).filter(function(s){ return s.id !== 's-mortality'; })};
        })};
        setWebformsConfig(wfCfg);
        // Per-form team members for logged-in users
        const allMembers=[...new Set((wfCfg.webforms||[]).flatMap(w=>w.teamMembers||[]))].sort();
        if(allMembers.length>0) setWfTeamMembers(allMembers);
      }
      if(store['ppp-layer-groups-v1']) setLayerGroups(store['ppp-layer-groups-v1']);
      if(store['ppp-missed-cleared-v1']) setMissedCleared(new Set(store['ppp-missed-cleared-v1']||[]));
      if(store['ppp-feed-orders-v1']) setFeedOrders(store['ppp-feed-orders-v1']);
      if(store['ppp-pig-feed-inventory-v1']) setPigFeedInventory(store['ppp-pig-feed-inventory-v1']);
      if(store['ppp-poultry-feed-inventory-v1']) setPoultryFeedInventory(store['ppp-poultry-feed-inventory-v1']);
      if(store['ppp-broiler-notes-v1']) setBroilerNotes(store['ppp-broiler-notes-v1']||'');
      if(store['ppp-pig-notes-v1'])     setPigNotes(store['ppp-pig-notes-v1']||'');
      if(store['ppp-layer-notes-v1'])   setLayerNotes(store['ppp-layer-notes-v1']||'');
      // Load layer batches and housings from dedicated tables, THEN sync webform config
      var lbPromise=sb.from('layer_batches').select('*').order('name');
      var lhPromise=sb.from('layer_housings').select('*').order('start_date');
      Promise.all([lbPromise,lhPromise]).then(function(results){
        var lbData=results[0].data||[];
        var lhData2=results[1].data||[];
        setLayerBatches(lbData);
        setLayerHousings(lhData2);
        // Now sync webform config with actual layer data available
        syncWebformConfig(store['ppp-webforms-v1']||null, store['ppp-feeders-v1']||null, store['ppp-v4']||[], store['ppp-layer-groups-v1']||[], lhData2);
      });
      // Sync broiler groups to webform_config for anon webform access
      const activeBroilerGroups = (store['ppp-v4']||[])
        .filter(b=>b.status!=='archived'&&b.status!=='processed')
        .map(b=>b.name);
      sb.from('webform_config').upsert({key:'broiler_groups',data:activeBroilerGroups},{onConflict:'key'}).then(()=>{});
    } else if(!error){
      // No data yet - init farrowing with historical records
      setFarrowingRecs(INITIAL_FARROWING);
    }
    // Load pig_dailys (paginated) and poultry_dailys in parallel. Both previously
    // ran serially, blocking the app on every cold start — see PROJECT.md §14.5 #3.
    const pigDailysPromise = (async () => {
      let allDailys = [];
      let from = 0;
      const pageSize = 1000;
      while(true){
        const {data:page, error:pageErr} = await sb.from('pig_dailys').select('*').order('date',{ascending:false}).range(from, from+pageSize-1);
        if(pageErr || !page || page.length===0) break;
        allDailys = [...allDailys, ...page];
        if(page.length < pageSize) break;
        from += pageSize;
      }
      return allDailys;
    })().catch(e => { console.warn('pig_dailys load error:', e.message); return []; });
    const poultryDailysPromise = sb.from('poultry_dailys').select('*').order('date',{ascending:false}).order('submitted_at',{ascending:false}).limit(2000)
      .then(({data, error}) => { if(error) { console.warn('poultry_dailys load error:', error.message); return []; } return data || []; })
      .catch(e => { console.warn('poultry_dailys load error:', e.message); return []; });
    const [pigDailysRows, poultryDailysRows] = await Promise.all([pigDailysPromise, poultryDailysPromise]);
    if(pigDailysRows) setPigDailys(pigDailysRows);
    setBroilerDailys(poultryDailysRows);
    const labels = [...new Set(poultryDailysRows.map(d=>d.batch_label).filter(Boolean))].sort();
    console.log(`[WCF] broilerDailys: ${poultryDailysRows.length} records, labels:`, labels);
    setDataLoaded(true);

    } catch(e) {
      console.error('loadAllData error:', e);
      setDataLoaded(true);
    }
  }

  async function loadUsers(){
    const {data, error} = await sb.from('profiles').select('*').order('created_at');
    if(data) setAllUsers(data);
    else if(error) console.error('loadUsers error:', error);
  }

  async function saveFeedCosts(costs){
    setFeedCosts(costs);
    await sbSave('ppp-feed-costs-v1', costs);
    // Update only ACTIVE broiler batches with new costs.
    // - Planned: stay blank until status flips to active (handled in upd() / status change path)
    // - Processed: never touched (preserves historical rates at time of processing)
    const activeBroiler = batches.filter(b=>b.status==='active');
    if(activeBroiler.length>0){
      const updated = batches.map(b=>{
        if(b.status!=='active') return b;
        return {...b,
          perLbStarterCost:costs.starter,
          perLbStandardCost:costs.grower,
          perLbGritCost:costs.grit||0,
        };
      });
      setBatches(updated);
      sbSave('ppp-v4', updated);
    }
    // Update active pig batches
    const activeF = feederGroups.filter(g=>g.status==='active');
    if(activeF.length>0){
      const updatedF = feederGroups.map(g=>g.status!=='active'?g:{...g,perLbFeedCost:costs.pig});
      setFeederGroups(updatedF);
      sbSave('ppp-feeders-v1', updatedF);
    }
    // Update active layer groups (legacy old system)
    const activeLG = layerGroups.filter(g=>g.status==='active');
    if(activeLG.length>0){
      const updatedLG = layerGroups.map(g=>g.status!=='active'?g:{...g,perLbFeedCost:costs.layer});
      persistLayerGroups(updatedLG);
    }
    // Update active layer batches (new system) — push 3 frozen rates
    // Skip the Retirement Home pseudo-batch
    const activeLBs = (layerBatches||[]).filter(b=>b.status==='active');
    if(activeLBs.length>0){
      const updatedLB = await Promise.all(activeLBs.map(async (b)=>{
        const upd = {
          per_lb_starter_cost: costs.starter,
          per_lb_grower_cost:  costs.grower,
          per_lb_layer_cost:   costs.layer,
        };
        await sb.from('layer_batches').update(upd).eq('id', b.id);
        return {...b, ...upd};
      }));
      // Merge updates back into local state
      setLayerBatches(prev => prev.map(b => {
        const u = updatedLB.find(x => x.id === b.id);
        return u ? u : b;
      }));
    }
  }

  async function sbSave(key, value){
    setSaveStatus('saving');
    let lastError = null;
    for(let attempt = 1; attempt <= 3; attempt++){
      try {
        const savePromise = sb.from('app_store').upsert(
          {key, data:value, updated_at:new Date().toISOString()},
          {onConflict:'key'}
        );
        const timeoutPromise = new Promise((_,reject) => setTimeout(()=>reject(new Error('timeout')), 8000));
        const {error} = await Promise.race([savePromise, timeoutPromise]);
        if(error) throw error;
        setSaveStatus('saved');
        setTimeout(()=>setSaveStatus(''), 2500);
        return; // success
      } catch(e) {
        lastError = e;
        console.warn(`sbSave attempt ${attempt} failed for key ${key}:`, e.message);
        if(attempt < 3) await new Promise(r=>setTimeout(r, 1000 * attempt)); // wait before retry
      }
    }
    // All 3 attempts failed
    console.error('sbSave failed after 3 attempts:', lastError);
    setSaveStatus('error');
    setTimeout(()=>setSaveStatus(''), 4000);
  }

  async function signOut(){
    await sb.auth.signOut();
  }

  function persist(nb){ sbSave('ppp-v4', nb); }
  function persistBreeding(nb){ sbSave('ppp-breeding-v1', nb); }
  function persistFarrowing(nb){ sbSave('ppp-farrowing-v1', nb); }
  function persistBoars(nb){ sbSave('ppp-boars-v1', nb); }
  function persistFeeders(nb){ setFeederGroups(nb); sbSave('ppp-feeders-v1', nb); syncWebformConfig(null, nb, batches, layerGroups, layerHousings); }
  function persistLayerGroups(nb){
    setLayerGroups(nb);
    sbSave('ppp-layer-groups-v1', nb);
    // Sync active layer group names to webform_config for anon access
    const activeNames = nb.filter(g=>g.status==='active').map(g=>g.name);
    sb.from('webform_config').upsert({key:'layer_groups',value:{groups:activeNames}},{onConflict:'key'}).then(()=>{});
    syncWebformConfig(null, null, batches, nb, layerHousings);
  }
  function persistLayerHousings(nb){
    // When housings change, re-sync webform so batch name vs housing name logic updates
    setLayerHousings(nb);
    syncWebformConfig(null, null, batches, layerGroups, nb);
  }
  function persistWebforms(nb){
    setWebformsConfig(nb);
    sbSave('ppp-webforms-v1', nb);
    syncWebformConfig(nb, null, batches, layerGroups, layerHousings);
    // Sync allowAddGroup to webform_settings key for anon access
    const allowAddGroup = {};
    (nb.webforms||[]).forEach(wf=>{ allowAddGroup[wf.id] = !!wf.allowAddGroup; });
    sb.from('webform_config').upsert({key:'webform_settings',data:{allowAddGroup}},{onConflict:'key'}).then(()=>{});
  }
  function persistFeedersAndSync(nb){
    setFeederGroups(nb);
    sbSave('ppp-feeders-v1', nb);
    // Sync active groups to webform_config for anon access
    syncWebformConfig(null, null, batches, nb, layerHousings);
  }
  async function syncWebformConfig(wfConfig, feeders, batchData, lgData, lhData){
    try {
      // Normalize: strip s-mortality from the cattle webform before sync.
      // Mortality is handled via the cow record, not the daily webform.
      function normalizeWebforms(webforms){
        return (webforms||[]).map(function(w){
          if(w.id !== 'cattle-dailys') return w;
          return {...w, sections: (w.sections||[]).filter(function(s){ return s.id !== 's-mortality'; })};
        });
      }
      const rawCfg = wfConfig || webformsConfig;
      const cfg = {...rawCfg, webforms: normalizeWebforms(rawCfg.webforms)};
      const fgs = feeders || feederGroups;
      const pigGroups = [
        'SOWS', 'BOARS',
        ...fgs.flatMap(g=>
          (g.subBatches&&g.subBatches.length>0)
            ? g.subBatches.filter(s=>s.status==='active').map(s=>s.name)
            : g.status==='active' ? [g.batchName] : []
        )
      ];
      // Per-form team members - push each form's list separately
      const allTeamMembers = [...new Set((cfg.webforms||[]).flatMap(wf=>wf.teamMembers||[]))].sort();
      const perFormTeamMembers = {};
      (cfg.webforms||[]).forEach(wf=>{ perFormTeamMembers[wf.id]=wf.teamMembers||[]; });
      // Use explicit batchData param to avoid stale closure — batches state may not be set yet
      const batchList = batchData || batches || [];
      const broilerGroupList = batchList.filter(b=>b.status==='active').map(b=>b.name);
      // Use explicit lgData param to avoid stale closure
      const lgList = lgData || layerGroups || [];
      // Layer batch names only appear on webform when the batch has NO active housings yet
      // (i.e. still in brooder/schooner phase). Once housings are active, the housing
      // names (already in lgList as layer groups) are the correct webform options.
      const activeLbNames = (layerBatches||[])
        .filter(b=>{
          if(b.status!=='active'||b.name==='Retirement Home') return false;
          const housings = lhData || layerHousings || [];
          const hasActiveHousing=housings.some(h=>h.batch_id===b.id&&h.status==='active');
          return !hasActiveHousing;
        })
        .map(b=>({id:b.id,name:b.name,status:'active'}));
      const lgListWithBatches = [...lgList, ...activeLbNames.filter(lb=>!lgList.find(g=>g.name===lb.name))];
      // allowAddGroup per form
      const allowAddGroup = {};
      (cfg.webforms||[]).forEach(wf=>{ allowAddGroup[wf.id] = !!wf.allowAddGroup; });
      await Promise.all([
        sb.from('webform_config').upsert({key:'team_members', data:allTeamMembers},{onConflict:'key'}),
        sb.from('webform_config').upsert({key:'per_form_team_members', data:perFormTeamMembers},{onConflict:'key'}),
        sb.from('webform_config').upsert({key:'active_groups', data:pigGroups},{onConflict:'key'}),
        sb.from('webform_config').upsert({key:'broiler_groups', data:broilerGroupList},{onConflict:'key'}),
        sb.from('webform_config').upsert({key:'webform_settings', data:{allowAddGroup}},{onConflict:'key'}),
        // Push housing→batch mapping for webform info display
        sb.from('webform_config').upsert({key:'housing_batch_map', data:Object.fromEntries(
          (lhData||layerHousings||[]).filter(h=>h.status==='active').map(h=>{
            const b=(layerBatches||[]).find(lb=>lb.id===h.batch_id);
            return [h.housing_name, b?b.name:null];
          }).filter(([,v])=>v)
        )},{onConflict:'key'}),
        // Push full form config for anon access — include layer batch names as selectable groups
        sb.from('webform_config').upsert({key:'full_config', data:{webforms:cfg.webforms,teamMembers:cfg.teamMembers,broilerGroups:broilerGroupList,layerGroups:lgListWithBatches}},{onConflict:'key'}),
      ]);
    } catch(e){ console.warn('syncWebformConfig error:', e.message); }
  }

  async function persistDaily(record){ 
    try { await sb.from('pig_dailys').upsert(record,{onConflict:'id'}); setSaveStatus('saved'); setTimeout(()=>setSaveStatus(''),2500); }
    catch(e){ console.error('persistDaily error:',e); setSaveStatus('error'); setTimeout(()=>setSaveStatus(''),4000); }
  }
  async function deleteDaily(id){
    try { await sb.from('pig_dailys').delete().eq('id',id); setPigDailys(prev=>prev.filter(d=>d.id!==id)); }
    catch(e){ alert('Could not delete record: '+e.message); }
  }
  function persistArchived(nb){ sbSave('ppp-archived-sows-v1', nb); }
  function persistBreeders(nb){ sbSave('ppp-breeders-v1', nb); }
  function persistBreedOptions(nb){ sbSave('ppp-breed-options-v1', nb); }
  function persistOriginOptions(nb){ sbSave('ppp-origin-options-v1', nb); }
  function persistPigData(nb){ sbSave('ppp-pigs-v1', nb); }

  function backupData(){
    const data={
      version:2, exported:new Date().toISOString(),
      batches, pigData, breedingCycles, farrowingRecs, boarNames, feederGroups,
    };
    const blob=new Blob([JSON.stringify(data,null,2)],{type:"application/json"});
    const url=URL.createObjectURL(blob);
    const a=document.createElement("a");
    a.href=url;
    a.download=`farm-planner-backup-${toISO(new Date())}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }

  function restoreData(e){
    const file=e.target.files[0];
    if(!file) return;
    const reader=new FileReader();
    reader.onload=ev=>{
      try{
        const data=JSON.parse(ev.target.result);
        if(!data.batches) throw new Error("Invalid backup file");
        if(!window.confirm(`Restore backup dated ${data.exported?.split("T")[0]}? This will replace current data for ALL users.`)) return;
        setBatches(data.batches); sbSave('ppp-v4', data.batches);
        if(data.pigData){ setPigData(data.pigData); sbSave('ppp-pigs-v1', data.pigData); }
        if(data.breedingCycles){ setBreedingCycles(data.breedingCycles); sbSave('ppp-breeding-v1', data.breedingCycles); }
        if(data.farrowingRecs){ setFarrowingRecs(data.farrowingRecs); sbSave('ppp-farrowing-v1', data.farrowingRecs); }
        if(data.boarNames){ setBoarNames(data.boarNames); sbSave('ppp-boars-v1', data.boarNames); }
        if(data.feederGroups){ setFeederGroups(data.feederGroups); sbSave('ppp-feeders-v1', data.feederGroups); }
        setTimeout(()=>alert("Restore complete! Data saved to cloud."), 2000);
      }catch(err){ alert("Could not read backup file. Make sure it's a valid Farm Planner backup."); }
    };
    reader.readAsText(file);
    e.target.value="";
  }

  // Form field update
  function upd(k,v){
    const f={...form,[k]:v};
    if(k==="breed"){
      // Hatchery is decoupled from breed — any hatchery can supply any breed now.
      // (Previously locked WR to Freedom Ranger Hatchery; that's no longer enforced.)
    }
    if(k==="schooner") f.birdCount=v==="1"?650:750;
    // When hatchDate changes, default brooderIn to hatchDate + 1 if blank OR if brooderIn matches hatchDate
    // (i.e., was previously auto-filled as same day). User can still manually override.
    if(k==="hatchDate" && v){
      try {
        if(!f.brooderIn || f.brooderIn==="" || f.brooderIn===form.hatchDate || f.brooderIn===v){
          f.brooderIn = toISO(addDays(new Date(v+'T12:00:00'), 1));
        }
      } catch(e) { /* ignore parse errors */ }
    }
    setForm(f);
    try {
      setConflicts(detectConflicts(f, batches, layerBatches, editId));
    } catch(e) {
      console.warn('detectConflicts failed on field change:', e);
      setConflicts([]);
    }
    setOverride(false);
    // Debounced auto-save: 1.5s after last keystroke
    if(editId){
      clearTimeout(autoSaveTimer.current);
      autoSaveTimer.current = setTimeout(()=>{
        const tl=calcTimeline(f.hatchDate, f.breed, f.processingDate);
        // Parse numeric form fields back to numbers before persisting (form state holds raw strings during typing)
        const numFields = ['birdCount','birdCountActual','brooderFeedLbs','schoonerFeedLbs','gritLbs','mortalityCumulative','week4Lbs','week6Lbs','perLbStandardCost','perLbStarterCost','perLbGritCost','totalToProcessor','processingCost','avgBreastLbs','avgThighsLbs','avgDressedLbs','totalLbsWhole','totalLbsCuts'];
        const fNum = {...f};
        for(const k of numFields){
          const v = fNum[k];
          fNum[k] = (v===''||v==null) ? 0 : (parseFloat(v)||0);
        }
        const computedStatus = calcPoultryStatus({...fNum,...tl});
        // When a batch is active and has no rates yet (e.g. just transitioned from planned),
        // stamp the current global admin feed cost rates onto it.
        if(computedStatus==='active' && (!fNum.perLbStarterCost || !fNum.perLbStandardCost)){
          fNum.perLbStarterCost  = feedCosts.starter || 0;
          fNum.perLbStandardCost = feedCosts.grower  || 0;
          fNum.perLbGritCost     = feedCosts.grit    || 0;
        }
        const batch={id:editId, ...fNum, ...tl, status:computedStatus};
        const nb=batches.map(b=>b.id===editId?batch:b);
        nb.sort((a,b)=>(a.hatchDate||'').localeCompare(b.hatchDate||''));
        setBatches(nb); persist(nb);
        setOriginalForm(f);
      }, 1500);
    }
  }

  function openAdd(){
    setForm(EMPTY_FORM); setEditId(null); setConflicts([]); setOverride(false); setShowLegacy(false); setOriginalForm(EMPTY_FORM); setShowForm(true);
  }
  function openEdit(b){
    const isB24=(/^b-24-/i).test(b.name);
    let brooderFeedLbs=b.brooderFeedLbs||0;
    let schoonerFeedLbs=b.schoonerFeedLbs||0;
    let gritLbs=b.gritLbs||0;
    let mortalityCumulative=b.mortalityCumulative||0;
    if(!isB24 && broilerDailys.length>0){
      const bd=broilerDailys.filter(d=>(d.batch_label||'').toLowerCase().trim().replace(/^\(processed\)\s*/,'').trim()===b.name.toLowerCase().trim());
      if(bd.length>0){
        brooderFeedLbs=Math.round(bd.filter(d=>d.feed_type==='STARTER').reduce((s,d)=>s+(parseFloat(d.feed_lbs)||0),0));
        schoonerFeedLbs=Math.round(bd.filter(d=>d.feed_type==='GROWER').reduce((s,d)=>s+(parseFloat(d.feed_lbs)||0),0));
        gritLbs=Math.round(bd.reduce((s,d)=>s+(parseFloat(d.grit_lbs)||0),0));
        mortalityCumulative=bd.reduce((s,d)=>s+(parseInt(d.mortality_count)||0),0);
      }
    }
    // Default Date In Brooder to hatchDate + 1 if blank (per "default fill, user can override" rule)
    let brooderIn = b.brooderIn || "";
    if(!brooderIn && b.hatchDate){
      brooderIn = toISO(addDays(new Date(b.hatchDate+'T12:00:00'), 1));
    }
    setForm({
      name:b.name, breed:b.breed||"", hatchery:b.hatchery||"", hatchDate:b.hatchDate||"",
      birdCount:b.birdCount||750, birdCountActual:b.birdCountActual||"",
      brooder:b.brooder||"1", schooner:b.schooner||"2&3",
      processingDate:b.processingDate||"", status:b.status||"planned", notes:b.notes||"",
      brooderIn, brooderOut:b.brooderOut||"",
      brooderFeedLbs, schoonerFeedLbs, gritLbs, mortalityCumulative,
      week4Lbs:b.week4Lbs||0, week6Lbs:b.week6Lbs||0,
      perLbStandardCost:b.perLbStandardCost||0, perLbStarterCost:b.perLbStarterCost||0, perLbGritCost:b.perLbGritCost||0,
      totalToProcessor:b.totalToProcessor||0, processingCost:b.processingCost||0,
      avgBreastLbs:b.avgBreastLbs||0, avgThighsLbs:b.avgThighsLbs||0, avgDressedLbs:b.avgDressedLbs||0,
      totalLbsWhole:b.totalLbsWhole||0, totalLbsCuts:b.totalLbsCuts||0,
      documents:b.documents||[],
    });
    const snap={name:b.name,breed:b.breed||"",hatchery:b.hatchery||"",hatchDate:b.hatchDate||"",birdCount:b.birdCount||750,birdCountActual:b.birdCountActual||"",brooder:b.brooder||"1",schooner:b.schooner||"2&3",processingDate:b.processingDate||"",status:b.status||"planned",notes:b.notes||"",brooderIn,brooderOut:b.brooderOut||"",brooderFeedLbs:b.brooderFeedLbs||0,schoonerFeedLbs:b.schoonerFeedLbs||0,gritLbs:b.gritLbs||0,mortalityCumulative:b.mortalityCumulative||0,week4Lbs:b.week4Lbs||0,week6Lbs:b.week6Lbs||0,perLbStandardCost:b.perLbStandardCost||0,perLbStarterCost:b.perLbStarterCost||0,perLbGritCost:b.perLbGritCost||0,totalToProcessor:b.totalToProcessor||0,processingCost:b.processingCost||0,avgBreastLbs:b.avgBreastLbs||0,avgThighsLbs:b.avgThighsLbs||0,avgDressedLbs:b.avgDressedLbs||0,totalLbsWhole:b.totalLbsWhole||0,totalLbsCuts:b.totalLbsCuts||0};
    setOriginalForm(snap);
    // Auto-enable Show Legacy if editing a batch that already has a legacy breed or hatchery selected,
    // so the user can actually see the saved value in the dropdown.
    const hasLegacyBreed = LEGACY_BREEDS.some(lb=>lb.code===b.breed);
    const hasLegacyHatchery = LEGACY_HATCHERIES.includes(b.hatchery);
    setShowLegacy(hasLegacyBreed || hasLegacyHatchery);
    // Compute existing conflicts on open so already-conflicting batches show their warnings immediately.
    // Wrapped in try/catch so a malformed batch record can never block the form from opening.
    setEditId(b.id);
    try {
      setConflicts(detectConflicts({name:b.name,breed:b.breed||'',hatchDate:b.hatchDate||'',brooder:b.brooder||'1',schooner:b.schooner||'2&3',processingDate:b.processingDate||''}, batches, layerBatches, b.id));
    } catch(e) {
      console.warn('detectConflicts failed on openEdit:', e);
      setConflicts([]);
    }
    setOverride(false); setShowForm(true);
  }

  async function parseProcessorXlsx(file) {
    try {
      // Lazy-load SheetJS on first use (saves ~900KB on every page load for users who don't import xlsx)
      if(typeof XLSX === 'undefined'){
        try { await window._wcfLoadXLSX(); }
        catch(e){ alert('Could not load Excel parser. Check your internet connection and try again.'); return; }
      }
      const buf = await file.arrayBuffer();
      const wb2 = XLSX.read(buf, {type:'array', cellDates:false});
      let parsed = null;

      for(const sheetName of wb2.SheetNames) {
        const ws = wb2.Sheets[sheetName];
        if(!ws || !ws['!ref']) continue;

        // Build a cell value map: address -> value
        const cv = {};
        Object.keys(ws).forEach(addr => {
          if(addr[0]==='!') return;
          cv[addr] = ws[addr].v;
        });

        // Find header row: look for a cell with "Row Labels"
        let labelCol=-1, totalWtCol=-1, countCol=-1, avgWtCol=-1, hRow=-1;
        const range = XLSX.utils.decode_range(ws['!ref']);
        for(let r=range.s.r; r<=Math.min(range.s.r+5, range.e.r); r++){
          for(let c=range.s.c; c<=range.e.c; c++){
            const addr=XLSX.utils.encode_cell({r,c});
            const v=String(cv[addr]||'').trim().toLowerCase();
            if(v==='row labels'){ labelCol=c; hRow=r; }
            if(hRow===r && v==='total weight') totalWtCol=c;
            if(hRow===r && v==='count of packages') countCol=c;
            if(hRow===r && v==='average weight') avgWtCol=c;
          }
          if(labelCol>=0 && avgWtCol>=0) break;
        }
        if(labelCol<0 || avgWtCol<0) continue;

        parsed={fileName:file.name};
        const excluded=['neck','feet','back','wing','grand total'];

        // Read each data row in the pivot
        for(let r=hRow+1; r<=range.e.r; r++){
          const labelAddr=XLSX.utils.encode_cell({r,c:labelCol});
          const labelVal=cv[labelAddr];
          if(!labelVal) continue;
          const label=String(labelVal).trim().toLowerCase();
          if(!label) continue;

          // Read values relative to label column position (label=col0, totalWt=+1, count=+2, avgWt=+3)
          const avgWt=parseFloat(cv[XLSX.utils.encode_cell({r,c:labelCol+3})]);
          const totalWt=parseFloat(cv[XLSX.utils.encode_cell({r,c:labelCol+1})]);
          const count=parseInt(cv[XLSX.utils.encode_cell({r,c:labelCol+2})]);

          if(label==='whole chicken'||label==='whole chicken '||label.includes('whole chicken')){
            if(!isNaN(avgWt)&&avgWt>0) parsed.avgDressed=Math.round(avgWt*100)/100;
            if(!isNaN(totalWt)&&totalWt>0) parsed.totalLbsWhole=Math.round(totalWt*10)/10;
          }
          if(label.includes('breast')&&!isNaN(avgWt)) parsed.avgBreast=Math.round(avgWt*100)/100;
          if(label.includes('thigh')&&!isNaN(avgWt)) parsed.avgThigh=Math.round(avgWt*100)/100;
          if(label!=='grand total'&&!excluded.some(e=>label.includes(e))&&!label.includes('whole chicken')&&!isNaN(totalWt)&&totalWt>0){
            parsed._cuts=(parsed._cuts||0)+totalWt;
          }
        }
        if(parsed._cuts>0){ parsed.totalLbsCuts=Math.round(parsed._cuts*10)/10; }
        delete parsed._cuts;
        if(Object.keys(parsed).length>1) break;
      }
      if(parsed&&Object.keys(parsed).length>1) setParsedProcessor(parsed);
    } catch(e){ console.warn('Processor parse error:',e.message); }
  }

  function confirmDelete(message, onConfirm) {
    setDeleteConfirm({message, onConfirm});
  }
  // Expose globally so child components can use without prop drilling
  React.useEffect(()=>{ window._wcfConfirmDelete = confirmDelete; }, []);

  function closeForm(){
    clearTimeout(autoSaveTimer.current);
    if(editId && originalForm){
      const keys = ['name','breed','hatchery','hatchDate','birdCount','birdCountActual','brooder','schooner','processingDate','status','notes','brooderIn','brooderOut','brooderFeedLbs','schoonerFeedLbs','gritLbs','mortalityCumulative','week4Lbs','week6Lbs','perLbStandardCost','perLbStarterCost','perLbGritCost','totalToProcessor','processingCost','avgBreastLbs','avgThighsLbs','avgDressedLbs','totalLbsWhole','totalLbsCuts'];
      const changed = keys.some(k=>String(form[k]||'')!==String(originalForm[k]||''));
      if(changed) submit(false);
      else setShowForm(false);
    } else {
      setShowForm(false);
    }
  }

  function submit(force){
    if(!form.name.trim()){ alert("Please enter a batch name."); return; }
    // Block on hard conflicts unless force=true. Soft (layer) conflicts always pass.
    const hardConflicts=(conflicts||[]).filter(c=>!c.soft);
    if(hardConflicts.length>0&&!force){
      alert('There are scheduling conflicts. Use the Override & Save Anyway button if you really want to save.');
      return;
    }
    const tl=calcTimeline(form.hatchDate, form.breed, form.processingDate);
    // Parse numeric form fields back to numbers (form state holds raw strings during typing)
    const numFields = ['birdCount','birdCountActual','brooderFeedLbs','schoonerFeedLbs','gritLbs','mortalityCumulative','week4Lbs','week6Lbs','perLbStandardCost','perLbStarterCost','perLbGritCost','totalToProcessor','processingCost','avgBreastLbs','avgThighsLbs','avgDressedLbs','totalLbsWhole','totalLbsCuts'];
    const formNum = {...form};
    for(const k of numFields){
      const v = formNum[k];
      formNum[k] = (v===''||v==null) ? 0 : (parseFloat(v)||0);
    }
    const computedStatus = calcPoultryStatus({...formNum,...tl});
    // When a batch is active and has no rates yet (e.g. just transitioned from planned),
    // stamp the current global admin feed cost rates onto it.
    if(computedStatus==='active' && (!formNum.perLbStarterCost || !formNum.perLbStandardCost)){
      formNum.perLbStarterCost  = feedCosts.starter || 0;
      formNum.perLbStandardCost = feedCosts.grower  || 0;
      formNum.perLbGritCost     = feedCosts.grit    || 0;
    }
    const batch={id:editId||String(Date.now()), ...formNum, ...tl, status:computedStatus, conflictOverride:force&&hardConflicts.length>0?true:(form.conflictOverride||false)};
    const nb=editId
      ? batches.map(b=>b.id===editId?batch:b)
      : [...batches, batch];
    nb.sort((a,b)=>(a.hatchDate||'').localeCompare(b.hatchDate||''));
    setBatches(nb); persist(nb); setOriginalForm(null); setShowForm(false); setOverride(false);
  }

  function del(id){
    confirmDelete("Delete this batch? This cannot be undone.",()=>{
      const nb=batches.filter(b=>b.id!==id);
      setBatches(nb); persist(nb);
    });
  }

  // Timeline helpers
  const tlS      = new Date(tlStart+"T12:00:00");
  const tlE      = addDays(tlS, WEEKS_SHOWN*7);
  const totalDays= WEEKS_SHOWN*7;
  function pct(iso){ return ((new Date(iso+"T12:00:00")-tlS)/86400000/totalDays)*100; }
  const wkHdrs   = Array.from({length:WEEKS_SHOWN},(_,i)=>addDays(tlS,i*7));

  // Derived
  const tl              = calcTimeline(form.hatchDate, form.breed, form.processingDate);
  const targetHatch     = calcTargetHatch(form.processingDate, form.breed);
  const hatchSuggestions= suggestHatchDates(targetHatch);
  const hatchWarn       = isNearHoliday(form.hatchDate);
  const procWarn        = form.processingDate && isNearHoliday(form.processingDate);
  // Hatcheries available in the dropdown — all hatcheries are now selectable for any breed.
  // Legacy hatcheries appended only when admin toggles "Show legacy" on a processed batch.
  const hatcheries      = (form.status==='processed' && showLegacy)
                            ? [...ALL_HATCHERIES, '__SEP__', ...LEGACY_HATCHERIES]
                            : ALL_HATCHERIES;
  const counts          = STATUSES.reduce((a,s)=>({...a,[s]:batches.filter(b=>b.status===s).length}),{});

  // ── STYLES ──
  // S defined globally above App

  // ── HEADER ──
  const Header=()=>{
    const poultryViews = ['broilerHome','timeline','list','feed','broilerdailys','broilerweighins'];
    const pigViews     = ['pigsHome','breeding','farrowing','sows','pigbatches','pigs','pigdailys','pigweighins'];
    const cattleViews  = ['cattleHome','cattleherds','cattledailys','cattleweighins','cattlebreeding','cattlebatches'];
    const sheepViews   = ['sheepHome','sheepflocks','sheepdailys','sheepweighins'];
    const inPoultry    = poultryViews.includes(view) || showForm;
    const inPigs       = pigViews.includes(view) || showBreedForm || showFarrowForm || showDailyForm;
    const inLayers     = ['layersHome','layerbatches','layerdailys','eggdailys'].includes(view);
    const inCattle     = cattleViews.includes(view);
    const inSheep      = sheepViews.includes(view);
    const inSection    = inPoultry || inPigs || inLayers || inCattle || inSheep;
    const nb = (active) => ({
      padding:'7px 16px', borderRadius:8, cursor:'pointer', fontFamily:'inherit',
      fontSize:12, fontWeight:active?700:500, whiteSpace:'nowrap',
      border: active?'2px solid #085041':'1px solid #d1d5db',
      background: active?'#085041':'white',
      color: active?'white':'#374151',
    });
    const ghostBtn = {padding:'7px 12px',borderRadius:8,border:'1px solid #d1d5db',cursor:'pointer',fontSize:12,fontWeight:500,background:'white',color:'#6b7280',fontFamily:'inherit',whiteSpace:'nowrap'};
    return (
    <div className="no-print">
      {DeleteConfirmModal}
      {/* ── Dark top bar ── */}
      <div style={S.header}>
        <button onClick={()=>{setShowForm(false);setShowBreedForm(false);setShowFarrowForm(false);setView("home");}}
          style={{background:"none",border:"none",cursor:"pointer",padding:0,display:"flex",alignItems:"center",gap:10}}>
          <div style={{fontSize:17,fontWeight:700,letterSpacing:"-.4px",color:"white"}}>WCF Planner</div>
          {inPoultry&&<span style={{fontSize:11,fontWeight:500,color:"rgba(255,255,255,.6)",borderLeft:"1px solid rgba(255,255,255,.25)",paddingLeft:10,letterSpacing:.5}}>BROILERS</span>}
          {(['webforms'].includes(view))&&<span style={{fontSize:11,fontWeight:500,color:"rgba(255,255,255,.6)",borderLeft:"1px solid rgba(255,255,255,.25)",paddingLeft:10,letterSpacing:.5}}>ADMIN</span>}
          {inPigs&&<span style={{fontSize:11,fontWeight:500,color:"rgba(255,255,255,.6)",borderLeft:"1px solid rgba(255,255,255,.25)",paddingLeft:10,letterSpacing:.5}}>PIGS</span>}
          {inLayers&&<span style={{fontSize:11,fontWeight:500,color:"rgba(255,255,255,.6)",borderLeft:"1px solid rgba(255,255,255,.25)",paddingLeft:10,letterSpacing:.5}}>LAYERS</span>}
          {inCattle&&<span style={{fontSize:11,fontWeight:500,color:"rgba(255,255,255,.6)",borderLeft:"1px solid rgba(255,255,255,.25)",paddingLeft:10,letterSpacing:.5}}>CATTLE</span>}
          {inSheep&&<span style={{fontSize:11,fontWeight:500,color:"rgba(255,255,255,.6)",borderLeft:"1px solid rgba(255,255,255,.25)",paddingLeft:10,letterSpacing:.5}}>SHEEP</span>}
        </button>
        <div style={{fontSize:11,display:"flex",alignItems:"center",gap:5,opacity:.75}}>
          {saveStatus==='saving'&&<span style={{color:"#a7f3d0",fontWeight:500}}>Saving…</span>}
          {saveStatus==='saved'&&<span style={{color:"#a7f3d0",fontWeight:500}}>✓ Saved</span>}
          {saveStatus==='error'&&<span style={{color:"#fca5a5",fontWeight:500}}>⚠ Save failed — check connection</span>}
          {!saveStatus&&authState?.name&&<span>{authState.name} · <span style={{textTransform:"capitalize"}}>{authState?.role}</span></span>}
        </div>
        <div style={{display:"flex",gap:6,alignItems:"center",position:"relative"}}>
          <div style={{position:"relative"}}>
            <button onClick={()=>setShowMenu(m=>!m)}
              style={{padding:"5px 10px",borderRadius:8,border:"1px solid rgba(255,255,255,.3)",cursor:"pointer",fontSize:15,background:"rgba(255,255,255,.1)",color:"white",lineHeight:1}}>
              ☰
            </button>
            {showMenu&&(
              <div onClick={()=>setShowMenu(false)} style={{position:"fixed",top:0,left:0,right:0,bottom:0,zIndex:199}} />
            )}
            {showMenu&&(
              <div style={{position:"absolute",right:0,top:"110%",background:"white",border:"1px solid #e5e7eb",borderRadius:10,boxShadow:"0 8px 24px rgba(0,0,0,.15)",zIndex:200,minWidth:160,overflow:"hidden"}}>
                <button onClick={()=>{backupData();setShowMenu(false);}}
                  style={{display:"block",width:"100%",padding:"10px 16px",border:"none",background:"none",cursor:"pointer",fontSize:13,textAlign:"left",color:"#111827",fontFamily:"inherit"}}>
                  ⬇ Backup
                </button>
                <label style={{display:"block",width:"100%",padding:"10px 16px",border:"none",background:"none",cursor:"pointer",fontSize:13,textAlign:"left",color:"#111827",fontFamily:"inherit"}}>
                  ⬆ Restore
                  <input type="file" accept=".json" onChange={(e)=>{restoreData(e);setShowMenu(false);}} style={{display:"none"}}/>
                </label>
                {authState?.role==='admin'&&(
                  <button onClick={()=>{setShowUsers(true);loadUsers();setShowMenu(false);}}
                    style={{display:"block",width:"100%",padding:"10px 16px",border:"none",background:"none",cursor:"pointer",fontSize:13,textAlign:"left",color:"#111827",fontFamily:"inherit"}}>
                    👥 Users
                  </button>
                )}
                <div style={{height:1,background:"#e5e7eb",margin:"4px 0"}}/>
              </div>
            )}
          </div>
          <button onClick={signOut}
            style={{padding:"5px 12px",borderRadius:8,border:"1px solid rgba(255,255,255,.3)",cursor:"pointer",fontSize:12,fontWeight:500,background:"rgba(255,255,255,.1)",color:"white"}}>
            Sign Out
          </button>
        </div>
      </div>
      {/* ── Light sub-nav bar — only in section views ── */}
      {inSection&&(
        <div style={{background:"white",borderBottom:"1px solid #e5e7eb",padding:"8px 1.25rem",display:"flex",gap:6,alignItems:"center",flexWrap:"wrap"}}>
          <button onClick={()=>{setShowForm(false);setShowBreedForm(false);setShowFarrowForm(false);setView("home");}} style={ghostBtn}>
            ⌂ Home
          </button>
          <div style={{width:1,height:20,background:"#e5e7eb",margin:"0 4px"}}/>
          {inPoultry&&[["broilerHome","Dashboard"],["timeline","Timeline"],["list","Batches"],["broilerdailys","Dailys"],["broilerweighins","Weigh-Ins"],["feed","Poultry Feed"]].map(([v,l])=>(
            <button key={v} style={nb(view===v&&!showForm)} onClick={()=>{setShowForm(false);setView(v);}}>{l}</button>
          ))}
          {inPigs&&[["pigsHome","Dashboard"],["breeding","Timeline"],["farrowing","Farrowing"],["sows","Breeding Pigs"],["pigbatches","Batches"],["pigdailys","Dailys"],["pigweighins","Weigh-Ins"],["pigs","Feed"]].map(([v,l])=>(
            <button key={v} style={nb(view===v&&!showForm&&!showBreedForm&&!showFarrowForm)} onClick={()=>{setShowForm(false);setShowBreedForm(false);setShowFarrowForm(false);setView(v);}}>{l}</button>
          ))}
          {inLayers&&[["layersHome","Dashboard"],["layerbatches","Layer Batches"],["layerdailys","Layer Dailys"],["eggdailys","Egg Dailys"]].map(([v,l])=>(
            <button key={v} style={nb(view===v)} onClick={()=>setView(v)}>{l}</button>
          ))}
          {inCattle&&[["cattleHome","Dashboard"],["cattleherds","Herds"],["cattlebreeding","Breeding"],["cattleweighins","Weigh-Ins"],["cattledailys","Dailys"],["cattlebatches","Batches"]].map(([v,l])=>(
            <button key={v} style={nb(view===v)} onClick={()=>setView(v)}>{l}</button>
          ))}
          {inSheep&&[["sheepHome","Dashboard"],["sheepflocks","Flocks"],["sheepweighins","Weigh-Ins"],["sheepdailys","Dailys"]].map(([v,l])=>(
            <button key={v} style={nb(view===v)} onClick={()=>setView(v)}>{l}</button>
          ))}
        </div>
      )}
    </div>
    );
  }


  // ── DELETE CONFIRM MODAL ── (proper component so useState is never conditional)
  const DeleteConfirmModal = deleteConfirm ? React.createElement(DeleteModal, {msg:deleteConfirm.message, onConfirm:deleteConfirm.onConfirm, onCancel:()=>setDeleteConfirm(null)}) : null;

  // ── WEBFORM BYPASS — no auth required ──
  if(view==="webform") return renderWebform();
  if(view==="addfeed") return React.createElement(AddFeedWebform, {sb});
  if(view==="weighins") return React.createElement(WeighInsWebform, {sb});
  if(view==="webformhub") return React.createElement(WebformHub, {sb, wfGroups, setWfGroups, wfTeamMembers, setWfTeamMembers, layerGroups, batches, layerBatches, layerHousings, webformsConfig});

  // ── AUTH GATES ──
  // SetPasswordScreen comes first: a recovery / invite link gives the user a
  // valid session, so authState would otherwise jump straight to home.
  if(pwRecovery) return <SetPasswordScreen prefilledEmail={authState && authState.user ? authState.user.email : null} onDone={()=>setPwRecovery(false)}/>;
  if(authState===null) return (
    <div style={{minHeight:"100vh",background:"#085041",display:"flex",alignItems:"center",justifyContent:"center"}}>
      <div style={{color:"white",fontSize:16,opacity:.8}}>Loading...</div>
    </div>
  );
  if(authState===false) return <LoginScreen/>;
  if(!dataLoaded) return (
    <div style={{minHeight:"100vh",background:"#085041",display:"flex",alignItems:"center",justifyContent:"center"}}>
      <div style={{color:"white",fontSize:16,opacity:.8}}>Loading your farm data...</div>
    </div>
  );




  // ── HOME DASHBOARD ──
  if(view==="home") {
    const today = new Date();
    const todayStr = todayISO();
    const in30 = toISO(addDays(today, 30));

    // Auto-status counts for poultry
    const activeBatches = batches.filter(b => calcPoultryStatus(b)==='active');
    const plannedBatches = batches.filter(b => calcPoultryStatus(b)==='planned');
    const processedBatches = batches.filter(b => calcPoultryStatus(b)==='processed');
    const birdsOnFarm = activeBatches.reduce((s,b)=>s+(parseInt(b.birdCountActual)||0),0);
    const projectedBirds = activeBatches.reduce((s,b)=>{
      const stats = calcBroilerStatsFromDailys(b, broilerDailys);
      return s + stats.projectedBirds;
    }, 0);

    // What's happening in the next 30 days
    const weekEvents = [];

    // Poultry events
    batches.forEach(b=>{
      const live = calcTimeline(b.hatchDate, b.breed, b.processingDate);
      if(!live) return;
      if(live.brooderIn >= todayStr && live.brooderIn <= in30)
        weekEvents.push({type:'brooder-in', label:`${b.name} enters brooder`, date:live.brooderIn, color:'#065f46', icon:'🐣'});
      if(live.schoonerIn >= todayStr && live.schoonerIn <= in30)
        weekEvents.push({type:'schooner-in', label:`${b.name} moves to schooner`, date:live.schoonerIn, color:'#a16207', icon:'🐔'});
      if(b.processingDate >= todayStr && b.processingDate <= in30)
        weekEvents.push({type:'processing', label:`${b.name} processing day`, date:b.processingDate, color:'#7f1d1d', icon:'📅'});
      // 4-week weight reminder
      if(b.hatchDate){
        const wk4date = toISO(addDays(new Date(b.hatchDate+'T12:00:00'), 28));
        if(wk4date >= todayStr && wk4date <= in30 && !(parseFloat(b.week4Lbs)>0))
          weekEvents.push({type:'wt-4wk', label:`${b.name} — record 4-week weights`, date:wk4date, color:'#854d0e', icon:'⚖️', reminder:true});
      }
      // 6-week weight reminder
      if(b.hatchDate){
        const wk6date = toISO(addDays(new Date(b.hatchDate+'T12:00:00'), 42));
        if(wk6date >= todayStr && wk6date <= in30 && !(parseFloat(b.week6Lbs)>0))
          weekEvents.push({type:'wt-6wk', label:`${b.name} — record 6-week weights`, date:wk6date, color:'#854d0e', icon:'⚖️', reminder:true});
      }
    });

    // Pig events
    const _weekSeqMap = buildCycleSeqMap(breedingCycles);
    breedingCycles.forEach(c=>{
      const tl = calcBreedingTimeline(c.exposureStart);
      if(!tl) return;
      const lbl = cycleLabel(c, _weekSeqMap);
      if(tl.farrowingStart >= todayStr && tl.farrowingStart <= in30)
        weekEvents.push({type:'farrow-open', label:`${lbl} farrowing window opens`, date:tl.farrowingStart, color:'#1e40af', icon:'🐷'});
      if(tl.farrowingEnd >= todayStr && tl.farrowingEnd <= in30)
        weekEvents.push({type:'farrow-close', label:`${lbl} farrowing window closes`, date:tl.farrowingEnd, color:'#be185d', icon:'🐷'});
      // Sows due in window
      if(tl.farrowingStart <= in30 && tl.farrowingEnd >= todayStr) {
        const expected = [...(c.boar1Tags||'').split(/[\n,]+/), ...(c.boar2Tags||'').split(/[\n,]+/)]
          .map(t=>t.trim()).filter(Boolean);
        const farrowed = new Set(farrowingRecs.filter(r=>r.group===c.group).map(r=>r.sow.trim()));
        const pending = expected.filter(t=>!farrowed.has(t));
        if(pending.length>0)
          weekEvents.push({type:'farrow-due', label:`${pending.length} sow${pending.length>1?'s':''} due to farrow (${lbl})`, date:tl.farrowingStart, color:'#1e40af', icon:'🌱'});
      }
    });

    // Pig batches hitting 6 months
    feederGroups.forEach(g=>{
      const cycle = breedingCycles.find(c=>c.id===g.cycleId);
      if(!cycle) return;
      const tl = calcBreedingTimeline(cycle.exposureStart);
      if(!tl) return;
      const farrowMid = new Date(tl.farrowingStart+"T12:00:00");
      const sixMonths = toISO(addDays(farrowMid, 183));
      if(sixMonths >= todayStr && sixMonths <= in30)
        weekEvents.push({type:'pig-age', label:`${g.batchName} hitting ~6 months`, date:sixMonths, color:'#92400e', icon:'🐖'});
    });

    weekEvents.sort((a,b)=>a.date.localeCompare(b.date));

    // ── Missed daily reports — checks last 7 days, persists until cleared ──
    async function clearMissedEntry(key) {
      const newSet = new Set([...missedCleared, key]);
      setMissedCleared(newSet);
      sb.from('app_store').upsert({key:'ppp-missed-cleared-v1',data:[...newSet]},{onConflict:'key'}).then(()=>{});
    }
    async function clearAllMissed(keys) {
      const newSet = new Set([...missedCleared, ...keys]);
      setMissedCleared(newSet);
      sb.from('app_store').upsert({key:'ppp-missed-cleared-v1',data:[...newSet]},{onConflict:'key'}).then(()=>{});
    }
    const allMissed = [];
    for(let daysBack=1; daysBack<=7; daysBack++){
      const checkDate = toISO(addDays(new Date(), -daysBack));
      const broilerCheck = new Set(broilerDailys.filter(d=>d.date===checkDate).map(d=>(d.batch_label||'').toLowerCase().trim().replace(/^\(processed\)\s*/,'')));
      const pigCheck     = new Set(pigDailys.filter(d=>d.date===checkDate).map(d=>(d.batch_label||'').toLowerCase().trim()));
      const layerCheck   = new Set(layerDailysRecent.filter(d=>d.date===checkDate).map(d=>(d.batch_label||'').toLowerCase().trim()));
      // Broilers — only check batches user has explicitly marked active AND only for days the batch was on the farm
      batches.filter(b=>b.status==='active').forEach(b=>{
        // Skip days before the batch arrived (use brooderIn, fall back to hatchDate)
        const earliestDate=b.brooderIn||b.hatchDate;
        if(earliestDate&&checkDate<earliestDate) return;
        // Skip days after processing
        if(b.processingDate&&checkDate>b.processingDate) return;
        const key=`${b.id}|${checkDate}`;
        if(!broilerCheck.has(b.name.toLowerCase().trim())&&!missedCleared.has(key))
          allMissed.push({key,label:b.name,icon:'🐔',type:'Broiler',date:checkDate});
      });
      // Pigs — sub-batches if present, main batch otherwise
      feederGroups.filter(g=>g.status==='active').forEach(g=>{
        const activeSubs=(g.subBatches||[]).filter(s=>s.status==='active');
        if(activeSubs.length>0){
          activeSubs.forEach(s=>{
            const key=`${s.id}|${checkDate}`;
            if(!pigCheck.has((s.name||'').toLowerCase().trim())&&!missedCleared.has(key))
              allMissed.push({key,label:s.name,icon:'🐷',type:`Pig · ${g.batchName}`,date:checkDate});
          });
        } else {
          const key=`${g.id}|${checkDate}`;
          if(!pigCheck.has((g.batchName||'').toLowerCase().trim())&&!missedCleared.has(key))
            allMissed.push({key,label:g.batchName,icon:'🐷',type:'Pig',date:checkDate});
        }
      });
      // Layers
      (layerGroups||[]).filter(g=>g.status==='active').forEach(g=>{
        const key=`${g.id}|${checkDate}`;
        if(!layerCheck.has((g.name||'').toLowerCase().trim())&&!missedCleared.has(key))
          allMissed.push({key,label:g.name,icon:'🥚',type:'Layer',date:checkDate});
      });
      // Cattle — flag any active herd that has cattle but no daily report on this date
      const cattleCheck = new Set(cattleDailysRecent.filter(d=>d.date===checkDate).map(d=>d.herd));
      ['mommas','backgrounders','finishers','bulls'].forEach(h=>{
        if(!cattleForHome.some(c=>c.herd===h)) return;
        const key=`cattle-${h}|${checkDate}`;
        if(!cattleCheck.has(h)&&!missedCleared.has(key))
          allMissed.push({key,label:h.charAt(0).toUpperCase()+h.slice(1),icon:'🐄',type:'Cattle',date:checkDate});
      });
      // Sheep — flag any active flock that has sheep but no daily report on this date
      const sheepCheck = new Set(sheepDailysRecent.filter(d=>d.date===checkDate).map(d=>d.flock));
      ['rams','ewes','feeders'].forEach(f=>{
        if(!sheepForHome.some(s=>s.flock===f)) return;
        const key=`sheep-${f}|${checkDate}`;
        if(!sheepCheck.has(f)&&!missedCleared.has(key))
          allMissed.push({key,label:f.charAt(0).toUpperCase()+f.slice(1),icon:'🐑',type:'Sheep',date:checkDate});
      });
    }
    // Sort newest first
    allMissed.sort((a,b)=>b.date.localeCompare(a.date));
    const activeBroilerBatches2 = batches.filter(b=>calcPoultryStatus(b)==='active');
    const activePigBatches2     = feederGroups.filter(g=>g.status==='active');
    const activeLayerGroups2    = (layerGroups||[]).filter(g=>g.status==='active');

    // ── Admin weekly table data ──
    const fiveDaysAgo = toISO(addDays(new Date(), -5));
    const weekAgo = fiveDaysAgo; // used for admin daily tiles (5 days)
    const allRecentReports = [
      ...broilerDailys.filter(d=>d.date>=weekAgo).map(d=>({id:d.id,view:'broilerdailys',date:d.date,type:'🐔 Broiler',raw:d})),
      ...pigDailys.filter(d=>d.date>=weekAgo).map(d=>({id:d.id,view:'pigdailys',date:d.date,type:'🐷 Pig',raw:d})),
      ...layerDailysRecent.filter(d=>d.date>=weekAgo).map(d=>({id:d.id,view:'layerdailys',date:d.date,type:'🐓 Layer',raw:d})),
      ...eggDailysRecent.filter(d=>d.date>=weekAgo).map(d=>({id:d.id,view:'eggdailys',date:d.date,type:'🥚 Egg',raw:d})),
      ...cattleDailysRecent.filter(d=>d.date>=weekAgo).map(d=>({id:d.id,view:'cattledailys',date:d.date,type:'🐄 Cattle',raw:d})),
      ...sheepDailysRecent.filter(d=>d.date>=weekAgo).map(d=>({id:d.id,view:'sheepdailys',date:d.date,type:'🐑 Sheep',raw:d})),
    ].sort((a,b)=>b.date.localeCompare(a.date)||a.type.localeCompare(b.type));

    // Active pig breeding cycles
    const activeCycles = breedingCycles.filter(c=>calcCycleStatus(c)==='active');
    const totalSows = breedingCycles.reduce((s,c)=>s+(parseInt(c.sowCount)||0),0);

    // Performance trends
    // Pig farrowing survival per cycle (most recent 5)
    const _homeSeqMap = buildCycleSeqMap(breedingCycles);
    const cycleSurvival = breedingCycles.map(c=>{
      const tl = calcBreedingTimeline(c.exposureStart);
      if(!tl) return null;
      const recs = farrowingRecs.filter(r=>{
        if(r.group!==c.group||!r.farrowingDate) return false;
        const rd=new Date(r.farrowingDate+"T12:00:00");
        return rd>=new Date(tl.farrowingStart+"T12:00:00") && rd<=addDays(tl.farrowingEnd,14);
      });
      if(recs.length===0) return null;
      const born=recs.reduce((s,r)=>s+(parseInt(r.totalBorn)||0),0);
      const dead=recs.reduce((s,r)=>s+(parseInt(r.deaths)||0),0);
      const _suf=_homeSeqMap[c.id];
      return {label:`G${c.group}${_suf?' · '+_suf:''} ${fmtS(c.exposureStart)}`, survival:born>0?Math.round(((born-dead)/born)*100):0, recs:recs.length};
    }).filter(Boolean).slice(-5);

    // Pig carcass yield trend
    const yieldData = feederGroups.flatMap(g=>(g.processingTrips||[]).map(t=>{
      const live=((t.liveWeights||'').split(/[\s,]+/).map(v=>parseFloat(v)).filter(v=>!isNaN(v)&&v>0)).reduce((a,b)=>a+b,0);
      const hang=parseFloat(t.hangingWeight)||0;
      return live>0&&hang>0?{label:t.date,yld:Math.round((hang/live)*1000)/10,batch:g.batchName}:null;
    })).filter(Boolean).sort((a,b)=>a.label.localeCompare(b.label)).slice(-8);

    const statCard = (label, val, color='#085041', sub='') => (
      <div key={label} style={{background:"white",border:"1px solid #e5e7eb",borderRadius:12,padding:"14px 16px",boxShadow:"0 1px 3px rgba(0,0,0,.06)"}}>
        <div style={{fontSize:11,fontWeight:500,color:"#6b7280",textTransform:"uppercase",letterSpacing:.8,marginBottom:4}}>{label}</div>
        <div style={{fontSize:26,fontWeight:700,color,lineHeight:1}}>{val}</div>
        {sub&&<div style={{fontSize:11,color:"#9ca3af",marginTop:3}}>{sub}</div>}
      </div>
    );

    return (
      <div style={{minHeight:"100vh",background:"#f1f3f2"}}>
        {showUsers&&<UsersModal sb={sb} authState={authState} allUsers={allUsers} setAllUsers={setAllUsers} setShowUsers={setShowUsers} loadUsers={loadUsers}/>}
        <Header/>
        <div style={{padding:"1.25rem",maxWidth:1200,margin:"0 auto",display:"flex",flexDirection:"column",gap:"1.5rem"}}>

          {/* Nav cards — 3 cols × 2 rows fits all 6 programs without bloating the page */}
          <div style={{display:"grid",gridTemplateColumns:"repeat(3, 1fr)",gap:10}}>
            {[
              {label:"Broilers", icon:"🐔", desc:`${activeBatches.length} active \u00b7 ${birdsOnFarm.toLocaleString()} on farm`, view:"broilerHome", color:"#a16207", bg:"#fef9c3"},
              {label:"Layers", icon:"🥚", desc:`${(layerGroups||[]).filter(g=>g.status==='active').length} active groups \u00b7 ${(layerGroups||[]).filter(g=>g.status==='active').reduce((s,g)=>s+(g.currentCount||0),0)} hens`, view:"layersHome", color:"#78350f", bg:"#fffbeb"},
              {label:"Pigs", icon:"🐷", desc:`${activeCycles.length} cycles \u00b7 ${totalSows} sows \u00b7 ${feederGroups.filter(g=>g.status==="active").length} batches`, view:"pigsHome", color:"#1e40af", bg:"#eff6ff"},
              {label:"Cattle", icon:"🐄", desc:`Mommas \u00b7 backgrounders \u00b7 finishers \u00b7 bulls`, view:"cattleHome", color:"#991b1b", bg:"#fef2f2"},
              {label:"Sheep", icon:"🐑", desc:`Hair sheep for meat \u00b7 rams + ewes + feeders`, view:"sheepHome", color:"#0f766e", bg:"#f0fdfa"},
              {label:"Equipment", icon:"🚜", desc:`Tractors \u00b7 implements \u00b7 maintenance (coming soon)`, view:"equipmentHome", color:"#57534e", bg:"#fafaf9"},
            ].filter(c => canAccessProgram(VIEW_TO_PROGRAM[c.view])).map(c=>(
              <div key={c.view} onClick={()=>setView(c.view)}
                style={{background:c.bg,border:"1px solid #e5e7eb",borderRadius:12,padding:"12px 14px",cursor:"pointer",boxShadow:"0 1px 3px rgba(0,0,0,.05)",transition:"transform .1s",display:"flex",alignItems:"center",gap:12,minWidth:0}}>
                <div style={{fontSize:26,flexShrink:0}}>{c.icon}</div>
                <div style={{minWidth:0,flex:1}}>
                  <div style={{fontSize:15,fontWeight:700,color:c.color,marginBottom:2}}>{c.label}</div>
                  <div style={{fontSize:11,color:"#6b7280",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{c.desc}</div>
                </div>
              </div>
            ))}
          </div>

          {/* Webforms Admin card — admin only */}
          {authState?.role==="admin"&&(
            <div onClick={()=>setView("webforms")}
              style={{background:"#fefce8",border:"1px solid #fde68a",borderRadius:14,padding:"16px 22px",cursor:"pointer",boxShadow:"0 2px 6px rgba(0,0,0,.06)",display:"flex",alignItems:"center",gap:16}}>
              <div style={{fontSize:32}}>⚙️</div>
              <div style={{fontSize:16,fontWeight:700,color:"#92400e"}}>Admin</div>
              <div style={{marginLeft:"auto",fontSize:12,color:"#92400e",fontWeight:600}}>Manage →</div>
            </div>
          )}


{/* ── Animals on Farm ── */}
          {(()=>{
            const totalHens=(layerHousings||[]).filter(h=>h.status==='active').reduce((s,h)=>s+(parseInt(h.current_count)||0),0);
            const activeFeederNamesHome=feederGroups.filter(g=>g.status==='active').flatMap(g=>{
              const subs=(g.subBatches||[]).filter(s=>s.status==='active');
              return subs.length>0?subs.map(s=>(s.name||'').toLowerCase().trim()):[(g.batchName||'').toLowerCase().trim()];
            });
            const pigCounts={};
            [...pigDailys].sort((a,b)=>a.date.localeCompare(b.date)).forEach(d=>{
              if(d.pig_count>0&&d.batch_label){
                const lbl=d.batch_label.toLowerCase().trim();
                if(activeFeederNamesHome.includes(lbl)||lbl==='sows'||lbl==='boars') pigCounts[d.batch_label]=parseInt(d.pig_count);
              }
            });
            const totalPigs=Object.values(pigCounts).reduce((s,v)=>s+v,0);
            const totalAll=projectedBirds+totalHens+totalPigs+cattleOnFarmCount;
            return (
              <div style={{background:'white',border:'1px solid #e5e7eb',borderRadius:14,padding:'16px 24px'}}>
                <div style={{fontSize:12,fontWeight:600,color:'#4b5563',letterSpacing:.3,marginBottom:12}}>ANIMALS ON FARM</div>
                <div style={{display:'grid',gridTemplateColumns:'1fr 1fr 1fr 1fr 1fr',gap:16,alignItems:'center'}}>
                  <div style={{textAlign:'center'}}>
                    <div style={{fontSize:26,fontWeight:700,color:'#a16207'}}>{projectedBirds.toLocaleString()}</div>
                    <div style={{fontSize:11,color:'#6b7280',marginTop:2}}>{'\ud83d\udc14 Broilers'}</div>
                  </div>
                  <div style={{textAlign:'center'}}>
                    <div style={{fontSize:26,fontWeight:700,color:'#92400e'}}>{totalHens.toLocaleString()}</div>
                    <div style={{fontSize:11,color:'#6b7280',marginTop:2}}>{'\ud83d\udc13 Layer Hens'}</div>
                  </div>
                  <div style={{textAlign:'center'}}>
                    <div style={{fontSize:26,fontWeight:700,color:'#1e40af'}}>{totalPigs.toLocaleString()}</div>
                    <div style={{fontSize:11,color:'#6b7280',marginTop:2}}>{'\ud83d\udc37 Pigs'}</div>
                  </div>
                  <div style={{textAlign:'center'}}>
                    <div style={{fontSize:26,fontWeight:700,color:'#991b1b'}}>{cattleOnFarmCount.toLocaleString()}</div>
                    <div style={{fontSize:11,color:'#6b7280',marginTop:2}}>{'\ud83d\udc04 Cattle'}</div>
                  </div>
                  <div style={{textAlign:'center',borderLeft:'1px solid #e5e7eb',paddingLeft:16}}>
                    <div style={{fontSize:26,fontWeight:700,color:'#085041'}}>{totalAll.toLocaleString()}</div>
                    <div style={{fontSize:11,color:'#6b7280',marginTop:2}}>Total Animals</div>
                  </div>
                </div>
              </div>
            );
          })()}

{/* ── Missed Daily Reports ── */}
          {allMissed.length>0&&(
            <div>
              <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:8}}>
                <div style={{fontSize:13,fontWeight:600,color:'#b91c1c',letterSpacing:.3}}>⚠ MISSED DAILY REPORTS</div>
                <button onClick={()=>clearAllMissed(allMissed.map(m=>m.key))} style={{fontSize:11,color:'#6b7280',background:'none',border:'1px solid #d1d5db',borderRadius:6,padding:'3px 10px',cursor:'pointer',fontFamily:'inherit'}}>Clear all</button>
              </div>
              <div style={{display:'flex',flexDirection:'column',gap:6}}>
                {allMissed.map(m=>(
                  <div key={m.key} style={{background:'#fef2f2',border:'1px solid #fecaca',borderRadius:10,padding:'10px 16px',display:'flex',alignItems:'center',gap:12}}>
                    <span style={{fontSize:18}}>{m.icon}</span>
                    <div style={{flex:1}}>
                      <div style={{fontSize:13,fontWeight:600,color:'#b91c1c'}}>{m.label}</div>
                      <div style={{fontSize:11,color:'#9ca3af'}}>{m.type} · No daily report for {fmt(m.date)}</div>
                    </div>
                    <button onClick={()=>clearMissedEntry(m.key)} style={{fontSize:11,color:'#6b7280',background:'white',border:'1px solid #d1d5db',borderRadius:6,padding:'3px 10px',cursor:'pointer',fontFamily:'inherit',flexShrink:0}}>Clear</button>
                  </div>
                ))}
              </div>
            </div>
          )}
          {allMissed.length===0&&(activeBroilerBatches2.length>0||activePigBatches2.length>0||activeLayerGroups2.length>0)&&(
            <div style={{background:'#ecfdf5',border:'1px solid #a7f3d0',borderRadius:10,padding:'10px 16px',display:'flex',alignItems:'center',gap:10}}>
              <span style={{fontSize:16}}>✅</span>
              <div style={{fontSize:12,color:'#065f46',fontWeight:500}}>All active batches had daily reports entered for the past 7 days</div>
            </div>
          )}

          {/* ── Admin Weekly Report Table ── */}



          {/* What's happening this week */}
          <div>
            <div style={{fontSize:13,fontWeight:600,color:"#4b5563",marginBottom:8,letterSpacing:.3}}>NEXT 30 DAYS</div>
            {weekEvents.length===0?(
              <div style={{background:"white",border:"1px solid #e5e7eb",borderRadius:12,padding:"20px",textAlign:"center",color:"#9ca3af",fontSize:13}}>
                Nothing scheduled in the next 30 days
              </div>
            ):(
              <div style={{display:"flex",flexDirection:"column",gap:6}}>
                {weekEvents.map((e,i)=>(
                  <div key={i} onClick={()=>{if(e.type==='wt-4wk'||e.type==='wt-6wk'){setView('list');}}}
                    style={{background:e.reminder?'#eff6ff':'white',border:e.reminder?'1px solid #bfdbfe':'1px solid #e5e7eb',borderRadius:10,padding:"10px 16px",display:"flex",alignItems:"center",gap:12,boxShadow:"0 1px 3px rgba(0,0,0,.04)",cursor:e.reminder?'pointer':'default'}}>
                    <span style={{fontSize:18}}>{e.icon}</span>
                    <div style={{flex:1}}>
                      <div style={{fontSize:13,fontWeight:e.reminder?600:500,color:e.reminder?'#1e40af':"#111827"}}>{e.label}</div>
                      <div style={{fontSize:11,color:"#9ca3af"}}>{fmt(e.date)}{e.reminder?' · click to open batch':''}</div>
                    </div>
                    {e.reminder
                      ? <span style={{fontSize:10,fontWeight:700,color:'#1d4ed8',background:'#dbeafe',padding:'2px 8px',borderRadius:10}}>REMINDER</span>
                      : <div style={{width:8,height:8,borderRadius:4,background:e.color,flexShrink:0}}/>
                    }
                  </div>
                ))}
              </div>
            )}
          </div>



          {isAdmin&&allRecentReports.length>0&&(
            <div>
              <div style={{fontSize:13,fontWeight:600,color:'#4b5563',marginBottom:10,letterSpacing:.3}}>LAST 5 DAYS — ALL DAILY REPORTS</div>
              {(()=>{
                // Group by date, then within each date group by animal type
                const dates = [...new Set(allRecentReports.map(r=>r.date))].sort().reverse();
                const typeOrder = {'🐔 Broiler':0,'🐷 Pig':1,'🐓 Layer':2,'🥚 Layer':2,'🥚 Egg':3,'🐄 Cattle':4,'🐑 Sheep':5};
                const typeColors = {'🐔 Broiler':'#a16207','🐷 Pig':'#1e3a8a','🐓 Layer':'#92400e','🥚 Layer':'#92400e','🥚 Egg':'#78350f','🐄 Cattle':'#991b1b','🐑 Sheep':'#0f766e'};
                const typeBg = {'🐔 Broiler':'#fef9c3','🐷 Pig':'#eff6ff','🐓 Layer':'#fffbeb','🥚 Layer':'#fffbeb','🥚 Egg':'#fefce8','🐄 Cattle':'#fef2f2','🐑 Sheep':'#f0fdfa'};
                return dates.map((date, di)=>{
                  const dayRecs = allRecentReports.filter(r=>r.date===date).sort((a,b)=>(typeOrder[a.type]??9)-(typeOrder[b.type]??9));
                  const types = [...new Set(dayRecs.map(r=>r.type))];
                  return (
                    <div key={date}>
                      {di>0&&<div style={{height:3,background:'#9ca3af',borderRadius:2,margin:'8px 0'}}/>}
                      <div style={{fontSize:12,fontWeight:700,color:'#374151',marginBottom:6,display:'flex',alignItems:'center',gap:8}}>
                        <span>{fmt(date)}</span>
                        <span style={{fontSize:11,fontWeight:400,color:'#9ca3af'}}>{dayRecs.length} report{dayRecs.length!==1?'s':''}</span>
                      </div>
                      {types.map(type=>{
                        const typeRecs = dayRecs.filter(r=>r.type===type);
                        const color = typeColors[type]||'#374151';
                        const bg = typeBg[type]||'#f9fafb';
                        return (
                          <div key={type} style={{marginBottom:10}}>
                            <div style={{fontSize:13,fontWeight:700,color:color,letterSpacing:.5,marginBottom:6,paddingLeft:2}}>{type.toUpperCase()}</div>
                            <div style={{display:'flex',flexDirection:'column',gap:8}}>
                              {typeRecs.map((r,i)=>{
                                const d = r.raw||{};
                                const hasMort = parseInt(d.mortality_count)>0;
                                const hasIssue = (d.issues&&String(d.issues).trim().length>2) || (d.comments&&String(d.comments).trim().length>2&&String(d.comments).trim()!=='0');
                                const lowVolt = d.fence_voltage!=null&&parseFloat(d.fence_voltage)<3;
                                const notable = hasMort||hasIssue||lowVolt;
                                const dateIdx = di;
                                const shadeBg = dateIdx%2===0?'white':'#f8fafc';
                                return (
                                  <div key={i} onClick={()=>{setPendingEdit({id:r.id,viewName:r.view});setView(r.view);}} style={{
                                    background:shadeBg,borderRadius:7,
                                    border:notable?'1.5px solid #fca5a5':'1px solid #e5e7eb',
                                    padding:'8px 12px',cursor:'pointer',display:'flex',flexDirection:'column',gap:4
                                  }} className="hoverable-tile">
                                    {(()=>{
                                      const d=r.raw;
                                      // Shared chip styles — match the admin daily-report tiles exactly.
                                      const chipBase = {fontSize:10,fontWeight:600,padding:'2px 7px',borderRadius:4};
                                      const chipYes = (label,ok)=> <span style={{...chipBase,background:ok===false?'#fef2f2':'#f0fdf4',color:ok===false?'#b91c1c':'#065f46',border:ok===false?'1px solid #fecaca':'1px solid #bbf7d0'}}>{label+': '+(ok===false?'No':'Yes')}</span>;
                                      const teamChip = <span style={{fontSize:11,fontWeight:600,padding:'2px 8px',borderRadius:4,background:'#f1f5f9',color:'#475569',border:'1px solid #e2e8f0',textAlign:'center',whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis'}}>{d.team_member||'\u2014'}</span>;
                                      const mortChip = (n,reason)=> <span style={{fontSize:11,fontWeight:600,padding:'3px 8px',borderRadius:6,background:'#fef2f2',color:'#b91c1c',border:'1px solid #fecaca'}}>{'\ud83d\udc80 '+n+' mort.'+(reason?' \u2014 '+reason:'')}</span>;
                                      const commentChip = (txt)=> <span style={{fontSize:11,color:'#92400e',padding:'3px 10px',background:'#fffbeb',border:'1px solid #fde68a',borderRadius:6,fontStyle:'italic'}}>{'\ud83d\udcac '+txt}</span>;

                                      if(r.type==='🐔 Broiler'){
                                        const hasFeed=parseFloat(d.feed_lbs)>0,hasGrit=parseFloat(d.grit_lbs)>0,hasMort=parseInt(d.mortality_count)>0;
                                        const comment=d.comments&&String(d.comments).trim().length>2?String(d.comments).trim():'';
                                        return (<>
                                          <div style={{display:'grid',gridTemplateColumns:'110px 90px 150px 90px 1fr',alignItems:'center',gap:12}}>
                                            <span style={{fontWeight:700,color:'#111827',fontSize:13,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{d.batch_label||'\u2014'}</span>
                                            {teamChip}
                                            <span style={{color:hasFeed?'#92400e':'#9ca3af',fontWeight:hasFeed?600:400,fontSize:12,display:'flex',alignItems:'center',gap:4,overflow:'hidden',whiteSpace:'nowrap',textOverflow:'ellipsis'}}>{hasFeed?`\ud83c\udf3e ${parseFloat(d.feed_lbs).toLocaleString()} lbs`:'no feed'}{hasFeed&&d.feed_type&&<span style={{fontSize:10,fontWeight:700,padding:'1px 5px',borderRadius:4,background:d.feed_type==='STARTER'?'#dbeafe':'#d1fae5',color:d.feed_type==='STARTER'?'#1e40af':'#065f46'}}>{d.feed_type}</span>}</span>
                                            <span style={{color:'#374151',fontSize:12,whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis'}}>{hasGrit?`grit ${parseFloat(d.grit_lbs)} lbs`:'no grit'}</span>
                                            <span style={{display:'flex',gap:6,flexWrap:'wrap',alignItems:'center'}}>
                                              {chipYes('Moved',d.group_moved!==false)}
                                              {chipYes('Waterer',d.waterer_checked!==false)}
                                            </span>
                                          </div>
                                          {(hasMort||comment)&&<div style={{display:'flex',gap:8,flexWrap:'wrap',alignItems:'center',marginTop:2}}>
                                            {hasMort&&mortChip(d.mortality_count,d.mortality_reason)}
                                            {comment&&commentChip(comment)}
                                          </div>}
                                        </>);
                                      }
                                      if(r.type==='🐓 Layer'){
                                        const hasFeed=parseFloat(d.feed_lbs)>0,hasGrit=parseFloat(d.grit_lbs)>0,hasCount=parseInt(d.layer_count)>0,hasMort=parseInt(d.mortality_count)>0;
                                        const comment=d.comments&&String(d.comments).trim().length>2?String(d.comments).trim():'';
                                        return (<>
                                          <div style={{display:'grid',gridTemplateColumns:'110px 90px 150px 80px 80px 1fr',alignItems:'center',gap:12}}>
                                            <span style={{fontWeight:700,color:'#111827',fontSize:13,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{d.batch_label||'\u2014'}</span>
                                            {teamChip}
                                            <span style={{color:hasFeed?'#92400e':'#9ca3af',fontWeight:hasFeed?600:400,fontSize:12,display:'flex',alignItems:'center',gap:4,overflow:'hidden',whiteSpace:'nowrap',textOverflow:'ellipsis'}}>{hasFeed?`\ud83c\udf3e ${parseFloat(d.feed_lbs).toLocaleString()} lbs`:'no feed'}{hasFeed&&d.feed_type&&<span style={{fontSize:10,fontWeight:700,padding:'1px 5px',borderRadius:4,background:d.feed_type==='STARTER'?'#dbeafe':d.feed_type==='GROWER'?'#d1fae5':'#fef3c7',color:d.feed_type==='STARTER'?'#1e40af':d.feed_type==='GROWER'?'#065f46':'#92400e'}}>{d.feed_type}</span>}</span>
                                            <span style={{color:'#374151',fontSize:12,whiteSpace:'nowrap'}}>{hasGrit?`grit ${d.grit_lbs} lbs`:'no grit'}</span>
                                            <span style={{color:'#374151',fontSize:12,whiteSpace:'nowrap'}}>{hasCount?`\ud83d\udc14 ${d.layer_count} hens`:'no count'}</span>
                                            <span style={{display:'flex',gap:6,flexWrap:'wrap',alignItems:'center'}}>
                                              {chipYes('Moved',d.group_moved!==false)}
                                              {chipYes('Waterer',d.waterer_checked!==false)}
                                            </span>
                                          </div>
                                          {(hasMort||comment)&&<div style={{display:'flex',gap:8,flexWrap:'wrap',alignItems:'center',marginTop:2}}>
                                            {hasMort&&mortChip(d.mortality_count,d.mortality_reason)}
                                            {comment&&commentChip(comment)}
                                          </div>}
                                        </>);
                                      }
                                      if(r.type==='🐷 Pig'){
                                        const hasFeed=parseFloat(d.feed_lbs)>0,hasCount=parseInt(d.pig_count)>0;
                                        const hasVolt=d.fence_voltage!=null&&String(d.fence_voltage).trim()!=='';
                                        const voltColor=v=>v<3?'#b91c1c':v<5?'#92400e':'#065f46';
                                        const hasMort=parseInt(d.mortality_count)>0;
                                        const issues=d.issues&&String(d.issues).trim().length>2?String(d.issues).trim():'';
                                        return (<>
                                          <div style={{display:'grid',gridTemplateColumns:'110px 90px 130px 80px 80px 1fr',alignItems:'center',gap:12}}>
                                            <span style={{fontWeight:700,color:'#111827',fontSize:13,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{d.batch_label||'\u2014'}</span>
                                            {teamChip}
                                            <span style={{color:hasFeed?'#92400e':'#9ca3af',fontWeight:hasFeed?600:400,fontSize:12,whiteSpace:'nowrap'}}>{hasFeed?`\ud83c\udf3e ${parseFloat(d.feed_lbs).toLocaleString()} lbs`:'no feed'}</span>
                                            <span style={{color:'#1e40af',fontSize:12,whiteSpace:'nowrap'}}>{hasCount?`\ud83d\udc37 ${d.pig_count} pigs`:'no count'}</span>
                                            <span style={{color:hasVolt?voltColor(parseFloat(d.fence_voltage)):'#9ca3af',fontWeight:hasVolt?600:400,fontSize:12,whiteSpace:'nowrap'}}>{hasVolt?`\u26a1 ${d.fence_voltage} kV`:'no voltage'}</span>
                                            <span style={{display:'flex',gap:6,flexWrap:'wrap',alignItems:'center'}}>
                                              {chipYes('Moved',d.group_moved!==false)}
                                              {chipYes('Nipple',d.nipple_drinker_working!==false)}
                                              {chipYes('Fence',d.fence_walked!==false)}
                                            </span>
                                          </div>
                                          {(hasMort||issues)&&<div style={{display:'flex',gap:8,flexWrap:'wrap',alignItems:'center',marginTop:2}}>
                                            {hasMort&&mortChip(d.mortality_count,d.mortality_reason)}
                                            {issues&&commentChip(issues)}
                                          </div>}
                                        </>);
                                      }
                                      if(r.type==='🥚 Egg'){
                                        const total=(parseInt(d.group1_count)||0)+(parseInt(d.group2_count)||0)+(parseInt(d.group3_count)||0)+(parseInt(d.group4_count)||0);
                                        const groups=[[d.group1_name,d.group1_count],[d.group2_name,d.group2_count],[d.group3_name,d.group3_count],[d.group4_name,d.group4_count]].filter(([n,c])=>n&&parseInt(c)>0);
                                        const comment=d.comments&&String(d.comments).trim().length>2?String(d.comments).trim():'';
                                        return (<>
                                          <div style={{display:'flex',alignItems:'center',gap:12,flexWrap:'wrap'}}>
                                            <span style={{fontWeight:700,color:'#78350f',fontSize:13,flexShrink:0}}>{'\ud83e\udd5a '+total+' eggs'}</span>
                                            {teamChip}
                                            {groups.map(([n,c])=><span key={n} style={{color:'#374151',fontSize:11}}>{n}: <strong>{c}</strong></span>)}
                                            {parseFloat(d.dozens_on_hand)>0&&<span style={{color:'#065f46',fontWeight:600,fontSize:12}}>{'\ud83d\udce6 '+d.dozens_on_hand+' doz'}</span>}
                                          </div>
                                          {comment&&<div style={{display:'flex',gap:8,flexWrap:'wrap',marginTop:2}}>{commentChip(comment)}</div>}
                                        </>);
                                      }
                                      if(r.type==='🐄 Cattle'){
                                        const HERD_LBL={mommas:'Mommas',backgrounders:'Backgrounders',finishers:'Finishers',bulls:'Bulls'};
                                        const HERD_C={mommas:{bg:'#fef2f2',tx:'#991b1b',bd:'#fca5a5'},backgrounders:{bg:'#ffedd5',tx:'#9a3412',bd:'#fdba74'},finishers:{bg:'#fff1f2',tx:'#9f1239',bd:'#fda4af'},bulls:{bg:'#fee2e2',tx:'#7f1d1d',bd:'#fca5a5'}};
                                        const hc=HERD_C[d.herd]||HERD_C.mommas;
                                        const feedSummary=Array.isArray(d.feeds)&&d.feeds.length>0?d.feeds.map(f=>(f.feed_name||'?')+(f.qty?(' '+f.qty+' '+(f.unit||'')+(f.is_creep?' \ud83c\udf7c':'')):'')).join(', '):'';
                                        const mineralSummary=Array.isArray(d.minerals)&&d.minerals.length>0?d.minerals.map(m=>(m.name||'?')+(m.lbs?(' '+m.lbs+' lb'):'')).join(', '):'';
                                        const hasMort=parseInt(d.mortality_count)>0;
                                        const issues=d.issues&&String(d.issues).trim().length>2?String(d.issues).trim():'';
                                        const hasVolt=d.fence_voltage!=null&&String(d.fence_voltage).trim()!=='';
                                        return (<>
                                          <div style={{display:'grid',gridTemplateColumns:'120px 90px 90px 1fr',alignItems:'center',gap:12}}>
                                            <span style={{padding:'2px 8px',borderRadius:4,fontSize:11,fontWeight:700,background:hc.bg,color:hc.tx,border:'1px solid '+hc.bd,textAlign:'center',whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis'}}>{HERD_LBL[d.herd]||d.herd||'\u2014'}</span>
                                            {teamChip}
                                            <span style={{fontSize:11,color:hasVolt?(parseFloat(d.fence_voltage)<3?'#b91c1c':parseFloat(d.fence_voltage)<5?'#92400e':'#065f46'):'#9ca3af',fontWeight:600,whiteSpace:'nowrap'}}>{hasVolt?'\u26a1 '+d.fence_voltage+' kV':'no voltage'}</span>
                                            <span style={{display:'flex',gap:6,flexWrap:'wrap',alignItems:'center'}}>
                                              {chipYes('Water',d.water_checked!==false)}
                                            </span>
                                          </div>
                                          {feedSummary&&<div style={{fontSize:11,color:'#92400e'}}>{'\ud83c\udf3e '+feedSummary}</div>}
                                          {mineralSummary&&<div style={{fontSize:11,color:'#6b21a8'}}>{'\ud83e\uddc2 '+mineralSummary}</div>}
                                          {(hasMort||issues)&&<div style={{display:'flex',gap:8,flexWrap:'wrap',alignItems:'center',marginTop:2}}>
                                            {hasMort&&mortChip(d.mortality_count,d.mortality_reason)}
                                            {issues&&commentChip(issues)}
                                          </div>}
                                        </>);
                                      }
                                      if(r.type==='🐑 Sheep'){
                                        const FLOCK_LBL={rams:'Rams',ewes:'Ewes',feeders:'Feeders'};
                                        const FLOCK_C={rams:{bg:'#f0fdfa',tx:'#0f766e',bd:'#5eead4'},ewes:{bg:'#fdf4ff',tx:'#86198f',bd:'#f0abfc'},feeders:{bg:'#fefce8',tx:'#854d0e',bd:'#fde047'}};
                                        const fc=FLOCK_C[d.flock]||FLOCK_C.ewes;
                                        const hasHay=d.bales_of_hay!=null;
                                        const hasAlfalfa=d.lbs_of_alfalfa!=null&&parseFloat(d.lbs_of_alfalfa)>0;
                                        const hasMort=(d.mortality_count||0)>0;
                                        const comment=d.comments&&String(d.comments).trim().length>2?String(d.comments).trim():'';
                                        const hasVolt=d.fence_voltage_kv!=null;
                                        const voltColor=v=>v<2?'#b91c1c':v<4?'#92400e':'#065f46';
                                        return (<>
                                          <div style={{display:'grid',gridTemplateColumns:'120px 90px 90px 90px 90px 1fr',alignItems:'center',gap:12}}>
                                            <span style={{padding:'2px 8px',borderRadius:4,fontSize:11,fontWeight:700,background:fc.bg,color:fc.tx,border:'1px solid '+fc.bd,textAlign:'center',whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis'}}>{FLOCK_LBL[d.flock]||d.flock||'\u2014'}</span>
                                            {teamChip}
                                            <span style={{color:hasHay?'#92400e':'#9ca3af',fontWeight:hasHay?600:400,fontSize:12,whiteSpace:'nowrap'}}>{hasHay?`\ud83c\udf3e ${d.bales_of_hay} bales`:'no hay'}</span>
                                            <span style={{color:hasAlfalfa?'#92400e':'#9ca3af',fontWeight:hasAlfalfa?600:400,fontSize:12,whiteSpace:'nowrap'}}>{hasAlfalfa?`alfalfa ${d.lbs_of_alfalfa} lb`:'no alfalfa'}</span>
                                            <span style={{color:hasVolt?voltColor(parseFloat(d.fence_voltage_kv)):'#9ca3af',fontWeight:hasVolt?600:400,fontSize:12,whiteSpace:'nowrap'}}>{hasVolt?`\u26a1 ${d.fence_voltage_kv} kV`:'no voltage'}</span>
                                            <span style={{display:'flex',gap:6,flexWrap:'wrap',alignItems:'center'}}>
                                              {d.minerals_given!=null&&<span style={{...chipBase,background:d.minerals_given?'#f0fdf4':'#f3f4f6',color:d.minerals_given?'#065f46':'#6b7280',border:'1px solid '+(d.minerals_given?'#bbf7d0':'#e5e7eb')}}>{d.minerals_given?(d.minerals_pct_eaten!=null?'Min '+d.minerals_pct_eaten+'%':'Minerals: Yes'):'Minerals: No'}</span>}
                                              {chipYes('Waterers',d.waterers_working!==false)}
                                            </span>
                                          </div>
                                          {(hasMort||comment)&&<div style={{display:'flex',gap:8,flexWrap:'wrap',alignItems:'center',marginTop:2}}>
                                            {hasMort&&mortChip(d.mortality_count,null)}
                                            {comment&&commentChip(comment)}
                                          </div>}
                                        </>);
                                      }
                                      return null;
                                    })()}
                                  </div>
                                );
                              })}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  );
                });
              })()}
            </div>
          )}

        </div>
      </div>
    );
  }

  // ── FORM ──
  if(showForm) return (
    <div>
      {showUsers&&<UsersModal sb={sb} authState={authState} allUsers={allUsers} setAllUsers={setAllUsers} setShowUsers={setShowUsers} loadUsers={loadUsers}/>}
      <Header/>
      <div style={{background:"rgba(0,0,0,.45)",minHeight:"100vh",display:"flex",alignItems:"flex-start",justifyContent:"center",padding:"1.5rem 1rem"}} className="no-print">

        {/* Floating prev/next side buttons — desktop only */}
        {editId&&(()=>{
          const sorted=[...batches].sort((a,b)=>(a.name||'').localeCompare(b.name||'',undefined,{numeric:true}));
          const idx=sorted.findIndex(b=>b.id===editId);
          const prev=idx>0?sorted[idx-1]:null;
          const next=idx<sorted.length-1?sorted[idx+1]:null;
          const sideBtn=(on,label,onClick)=>({
            style:{position:'fixed',top:'50%',transform:'translateY(-50%)',zIndex:600,
              display:'flex',flexDirection:'column',alignItems:'center',gap:4,
              padding:'14px 8px',borderRadius:10,border:'1px solid #d1d5db',
              background:on?'white':'#f3f4f6',color:on?'#085041':'#d1d5db',
              cursor:on?'pointer':'default',boxShadow:on?'0 2px 8px rgba(0,0,0,.12)':'none',
              fontFamily:'inherit',transition:'all .15s'},
            onClick:on?onClick:undefined
          });
          return (<>
            <button {...sideBtn(!!prev,prev?.name,()=>{closeForm();setTimeout(()=>openEdit(prev),50);})}
              style={{...sideBtn(!!prev).style, left:'max(8px, calc(50% - 430px - 60px))'}}>
              <span style={{fontSize:20,lineHeight:1}}>‹</span>
              {prev&&<span style={{fontSize:9,fontWeight:700,maxWidth:40,textAlign:'center',wordBreak:'break-all',lineHeight:1.2}}>{prev.name}</span>}
            </button>
            <button {...sideBtn(!!next,next?.name,()=>{closeForm();setTimeout(()=>openEdit(next),50);})}
              style={{...sideBtn(!!next).style, right:'max(8px, calc(50% - 430px - 60px))'}}>
              <span style={{fontSize:20,lineHeight:1}}>›</span>
              {next&&<span style={{fontSize:9,fontWeight:700,maxWidth:40,textAlign:'center',wordBreak:'break-all',lineHeight:1.2}}>{next.name}</span>}
            </button>
          </>);
        })()}

        <div style={{background:"white",borderRadius:12,width:"100%",maxWidth:806,border:"1px solid #e5e7eb",marginBottom:"2rem"}}>

          {/* Sticky header: title + batch name + close */}
          <div style={{padding:"12px 20px",borderBottom:"1px solid #e5e7eb",display:"flex",justifyContent:"space-between",alignItems:"center",position:"sticky",top:0,background:"white",zIndex:10,boxShadow:"0 1px 4px rgba(0,0,0,.06)"}}>
            <div style={{display:"flex",alignItems:"center",gap:10,minWidth:0}}>
              <div style={{fontSize:13,fontWeight:500,color:"#9ca3af",flexShrink:0}}>{editId?"Edit Batch":"Add New Batch"}</div>
              {form.name&&<div style={{fontSize:18,fontWeight:700,color:"#085041",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{form.name}</div>}
            </div>
            <button onClick={closeForm} style={{background:"none",border:"none",fontSize:22,cursor:"pointer",color:"#999",lineHeight:1,flexShrink:0}}>×</button>
          </div>

          <div style={{padding:"16px 20px",display:"flex",flexDirection:"column",gap:12}}>

            {/* Conflict alert */}
            {conflicts.length>0&&(()=>{
              const hard=conflicts.filter(c=>!c.soft);
              const soft=conflicts.filter(c=>c.soft);
              const hasHard=hard.length>0;
              return (
                <div style={{background:hasHard?"#fef2f2":"#fffbeb",border:"1px solid "+(hasHard?"#F09595":"#fde68a"),borderRadius:10,padding:"10px 14px"}}>
                  {hasHard&&(
                    <>
                      <div style={{color:"#791F1F",fontWeight:600,fontSize:13,marginBottom:4}}>{'\u26a0 Scheduling conflict detected:'}</div>
                      {hard.map((c,i)=><div key={'h'+i} style={{color:"#b91c1c",fontSize:12,marginTop:3}}>{'\u2022 '+c.message}</div>)}
                    </>
                  )}
                  {soft.length>0&&(
                    <div style={{marginTop:hasHard?10:0,paddingTop:hasHard?10:0,borderTop:hasHard?'1px solid #F09595':'none'}}>
                      <div style={{color:"#92400e",fontWeight:600,fontSize:13,marginBottom:4}}>{'\u26a0 Layer batch overlap (soft warning, save will go through):'}</div>
                      {soft.map((c,i)=><div key={'s'+i} style={{color:"#92400e",fontSize:12,marginTop:3}}>{'\u2022 '+c.message}</div>)}
                    </div>
                  )}
                  {hasHard&&(
                    <div style={{marginTop:10,paddingTop:10,borderTop:"1px solid #F09595",display:"flex",alignItems:"center",gap:10,flexWrap:"wrap"}}>
                      <div style={{fontSize:12,color:"#791F1F",flex:1}}>You can override and save anyway if you know what you're doing (e.g. staggered timing, special arrangement).</div>
                      <button onClick={()=>submit(true)} style={{padding:"6px 14px",borderRadius:8,border:"none",background:"#A32D2D",color:"white",fontWeight:600,fontSize:12,cursor:"pointer",whiteSpace:"nowrap"}}>
                        Override &amp; Save Anyway
                      </button>
                    </div>
                  )}
                </div>
              );
            })()}

            {/* Step 1 — Processing date + hatch suggestions */}
            <div style={{background:"#ecfdf5",border:"1px solid #a7f3d0",borderRadius:10,padding:"10px 14px"}}>
              <div style={{color:"#083d30",fontWeight:600,fontSize:12,marginBottom:8}}>
                Step 1 — Enter your target processing date
              </div>
              <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10,marginBottom:8}}>
                <div>
                  <label style={{...S.label,color:"#085041"}}>Breed</label>
                  <select value={form.breed} onChange={e=>upd("breed",e.target.value)}>
                    <option value="CC">Cornish Cross {'\u2014'} 7 weeks</option>
                    <option value="WR">White Ranger {'\u2014'} 8 weeks</option>
                    {form.status==='processed'&&showLegacy&&(
                      <>
                        <option disabled value="__sep__">{'\u2500\u2500\u2500 Legacy \u2500\u2500\u2500'}</option>
                        {LEGACY_BREEDS.map(lb=>(
                          <option key={lb.code} value={lb.code}>{lb.label} (legacy)</option>
                        ))}
                      </>
                    )}
                  </select>
                  {form.status==='processed'&&(
                    <button type="button" onClick={()=>setShowLegacy(s=>!s)} style={{marginTop:5,padding:'3px 9px',borderRadius:5,border:'1px solid '+(showLegacy?'#92400e':'#d1d5db'),background:showLegacy?'#fffbeb':'white',color:showLegacy?'#92400e':'#6b7280',fontSize:10,fontWeight:600,cursor:'pointer',fontFamily:'inherit'}}>
                      {showLegacy?'\u2713 Showing legacy options':'+ Show legacy options'}
                    </button>
                  )}
                </div>
                <div>
                  <label style={{...S.label,color:"#085041"}}>Processing date</label>
                  <input type="date" value={form.processingDate} onChange={e=>upd("processingDate",e.target.value)}/>
                  {procWarn&&<div style={{fontSize:11,color:"#92400e",marginTop:3}}>{'\u26a0 Within 1 day of a major holiday'}</div>}
                </div>
              </div>

              {/* Hatch suggestions */}
              {targetHatch&&(
                <div style={{borderTop:"1px solid #97C459",paddingTop:8}}>
                  <div style={{fontSize:11,color:"#085041",marginBottom:5,fontWeight:600}}>
                    Suggested hatch dates to check with hatchery (target: {fmt(targetHatch)}):
                  </div>
                  <div style={{display:"flex",gap:5,flexWrap:"wrap"}}>
                    {hatchSuggestions.map(s=>(
                      <button key={s.iso} onClick={()=>upd("hatchDate",s.iso)} style={{
                        padding:"4px 10px",borderRadius:5,fontSize:11,cursor:"pointer",fontWeight:500,border:"1px solid #085041",
                        background:form.hatchDate===s.iso?"#085041":s.offset===0?"#1D9E75":"#EAF3DE",
                        color:form.hatchDate===s.iso?"white":s.offset===0?"white":"#3B6D11",
                      }}>
                        {s.day} {s.label}{s.offset===0?" (exact)":s.offset<0?` (${Math.abs(s.offset)}d early)`:` (${s.offset}d late)`}
                      </button>
                    ))}
                  </div>
                  <div style={{fontSize:11,color:"#5a8a3a",marginTop:5}}>Click a date or type one below once confirmed with hatchery</div>
                </div>
              )}
            </div>

            {/* Step 2 — Hatch date confirmed + full timeline */}
            <div style={{background:"#f0f7ff",border:"1px solid #B5D4F4",borderRadius:10,padding:"10px 14px"}}>
              <div style={{color:"#1d4ed8",fontWeight:600,fontSize:12,marginBottom:8}}>
                Step 2 — Confirm hatch date with hatchery
              </div>
              <div>
                <label style={{...S.label,color:"#1d4ed8"}}>Confirmed hatch date</label>
                <input type="date" value={form.hatchDate} onChange={e=>upd("hatchDate",e.target.value)}/>
                {hatchWarn&&<div style={{fontSize:11,color:"#92400e",marginTop:3}}>⚠ Within 1 day of a major holiday</div>}
              </div>
              {tl&&(
                <div style={{marginTop:8,borderTop:"1px solid #B5D4F4",paddingTop:8,display:"grid",gridTemplateColumns:"1fr 1fr",gap:"3px 12px",fontSize:12,color:"#1d4ed8"}}>
                  <div>Brooder in: <strong>{fmt(tl.brooderIn)}</strong></div>
                  <div>Brooder out: <strong>{fmt(tl.brooderOut)}</strong><span style={{opacity:.6}}> +{BROODER_CLEANOUT}d</span></div>
                  <div>Schooner in: <strong>{fmt(tl.schoonerIn)}</strong></div>
                  <div>Schooner out: <strong>{fmt(tl.schoonerOut)}</strong><span style={{opacity:.6}}> +{SCHOONER_CLEANOUT}d</span></div>
                </div>
              )}
            </div>

            {/* Batch details */}
            <div>
              <label style={S.label}>Batch name</label>
              <input value={form.name} onChange={e=>upd("name",e.target.value)} placeholder="e.g. 26-01 CC BROILERS"/>
            </div>

            <div style={S.fieldGroup}>
              <div>
                <label style={S.label}>Hatchery</label>
                <select value={form.hatchery} onChange={e=>upd("hatchery",e.target.value)}>
                  {hatcheries.map(h=> h==='__SEP__'
                    ? <option key="sep" disabled value="__sep__">{'\u2500\u2500\u2500 Legacy \u2500\u2500\u2500'}</option>
                    : <option key={h} value={h}>{h}</option>
                  )}
                </select>
              </div>
              <div>
                <label style={S.label}>Birds ordered</label>
                <input type="number" value={form.birdCount||''} onChange={e=>upd("birdCount",e.target.value)}/>
                <div style={{fontSize:11,color:"#9ca3af",marginTop:3}}>Standard 750 · Schooner 1 solo: 650</div>
              </div>
              <div>
                <label style={S.label}>Birds arrived</label>
                <input type="number" value={form.birdCountActual||''} onChange={e=>upd("birdCountActual",e.target.value)} placeholder="Enter actual count"/>
                <div style={{fontSize:11,color:"#9ca3af",marginTop:3}}>Actual day-1 count after hatchery overship. Enter manually — never auto-fills from ordered.</div>
              </div>

              <div>
                <label style={S.label}>Brooder assigned</label>
                <select value={form.brooder} onChange={e=>upd("brooder",e.target.value)}>
                  {BROODERS.map(b=><option key={b} value={b}>Brooder {b} — max 750 birds</option>)}
                </select>
              </div>
              <div>
                <label style={S.label}>Schooner assigned</label>
                <select value={form.schooner} onChange={e=>upd("schooner",e.target.value)}>
                  {SCHOONERS.map(s=><option key={s} value={s}>Schooner {s}{s==="1"?" (solo / 650 birds)":" (pair)"}</option>)}
                </select>
              </div>

              <div>
                <label style={S.label}>Status</label>
                <select value={form.status} onChange={e=>upd("status",e.target.value)}>
                  {STATUSES.map(s=><option key={s} value={s}>{s.charAt(0).toUpperCase()+s.slice(1)}</option>)}
                </select>
              </div>
            </div>

            <div>
              <label style={S.label}>Notes</label>
              <textarea value={form.notes} onChange={e=>upd("notes",e.target.value)} rows={2} placeholder="Farm team, transporter, distribution notes…"/>
            </div>

            {/* ── Brooder / Schooner Counts ── */}
            <div style={{gridColumn:"1/-1",borderTop:"1px solid #e5e7eb",paddingTop:12,marginTop:4}}>
              <div style={{fontSize:11,fontWeight:700,color:"#9ca3af",letterSpacing:.5,marginBottom:8}}>BROODER & SCHOONER</div>
              <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:10}}>
                <div>
                  <label style={S.label}>Date In Brooder</label>
                  <input type="date" value={form.brooderIn} onChange={e=>upd("brooderIn",e.target.value)}/>
                  <div style={{fontSize:11,color:"#9ca3af",marginTop:3}}>Defaults to hatch date + 1 day</div>
                </div>
                <div><label style={S.label}>Date Out of Brooder</label><input type="date" value={form.brooderOut} onChange={e=>upd("brooderOut",e.target.value)}/></div>
                <div><label style={S.label}>4-Week Weight (lbs)</label><input type="number" min="0" step="0.01" value={form.week4Lbs||''} onChange={e=>upd("week4Lbs",e.target.value)}/></div>
                <div><label style={S.label}>6-Week Weight (lbs)</label><input type="number" min="0" step="0.01" value={form.week6Lbs||''} onChange={e=>upd("week6Lbs",e.target.value)}/></div>
                {(()=>{
                  const stats = calcBroilerStatsFromDailys(form, broilerDailys);
                  if(stats.legacy){
                    return <div><label style={S.label}>Mortality Cumulative</label><input type="number" min="0" value={form.mortalityCumulative||''} onChange={e=>upd("mortalityCumulative",e.target.value)}/></div>;
                  }
                  return (
                    <div>
                      <label style={S.label}>Mortality (from daily reports)</label>
                      <div style={{padding:'8px 11px',background:'#f9fafb',border:'1px solid #e5e7eb',borderRadius:6,fontSize:13,fontWeight:600,color:stats.mortality>0?'#b91c1c':'#9ca3af'}}>
                        {stats.mortality.toLocaleString()}{stats.mortPct>0?<span style={{fontWeight:400,color:'#9ca3af',marginLeft:6}}>({stats.mortPct.toFixed(1)}%)</span>:null}
                      </div>
                    </div>
                  );
                })()}
              </div>
            </div>

            {/* ── Feed ── */}
            <div style={{gridColumn:"1/-1",borderTop:"1px solid #e5e7eb",paddingTop:12}}>
              <div style={{fontSize:11,fontWeight:700,color:"#9ca3af",letterSpacing:.5,marginBottom:8}}>FEED & GRIT</div>
              {editId&&!(/^b-24-/i).test(form.name)&&(()=>{
                const bd=broilerDailys.filter(d=>(d.batch_label||'').toLowerCase().trim().replace(/^\(processed\)\s*/,'').trim()===form.name.toLowerCase().trim());
                const allLabels=[...new Set(broilerDailys.map(d=>d.batch_label).filter(Boolean))].sort();
                if(broilerDailys.length===0) return <div style={{fontSize:11,color:'#b91c1c',background:'#fef2f2',border:'1px solid #fecaca',borderRadius:6,padding:'5px 10px',marginBottom:8}}>⚠ Daily records not loaded yet — try closing and reopening this form.</div>;
                if(bd.length===0) return <div style={{fontSize:11,color:'#b91c1c',background:'#fef2f2',border:'1px solid #fecaca',borderRadius:6,padding:'5px 10px',marginBottom:8}}>⚠ No daily reports found matching "{form.name}". Labels in DB: {allLabels.filter(l=>l.toLowerCase().includes('26-0')).join(', ')||'none found'}</div>;
                return <div style={{fontSize:11,color:'#085041',background:'#ecfdf5',border:'1px solid #a7f3d0',borderRadius:6,padding:'5px 10px',marginBottom:8}}>🌾 Auto-filled from {bd.length} daily reports. Edit only to correct errors.</div>;
              })()}
              {(()=>{
                const stats = calcBroilerStatsFromDailys(form, broilerDailys);
                if(stats.legacy){
                  // Legacy B-24-* batches: keep editable fields (no daily reports exist)
                  return (
                    <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:10}}>
                      <div><label style={S.label}>Brooder Feed (lbs)</label><input type="number" min="0" value={form.brooderFeedLbs||''} onChange={e=>upd("brooderFeedLbs",e.target.value)}/></div>
                      <div><label style={S.label}>Schooner Feed (lbs)</label><input type="number" min="0" value={form.schoonerFeedLbs||''} onChange={e=>upd("schoonerFeedLbs",e.target.value)}/></div>
                      <div><label style={S.label}>Grit (lbs)</label><input type="number" min="0" value={form.gritLbs||''} onChange={e=>upd("gritLbs",e.target.value)}/></div>
                    </div>
                  );
                }
                // Modern batches: read-only display sourced live from daily reports
                const ro = (label, val, suffix) => (
                  <div>
                    <label style={S.label}>{label} <span style={{fontWeight:400,color:'#9ca3af'}}>(from daily reports)</span></label>
                    <div style={{padding:'8px 11px',background:'#f9fafb',border:'1px solid #e5e7eb',borderRadius:6,fontSize:13,fontWeight:600,color:val>0?'#085041':'#9ca3af'}}>
                      {val>0?val.toLocaleString()+suffix:'\u2014'}
                    </div>
                  </div>
                );
                return (
                  <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:10}}>
                    {ro('Starter Feed', stats.starterFeed, ' lbs')}
                    {ro('Grower Feed', stats.growerFeed, ' lbs')}
                    {ro('Grit', stats.gritLbs, ' lbs')}
                  </div>
                );
              })()}
              {/* FEED COST RATES (read-only — set in Admin → Feed Costs, propagated to all active broiler batches) */}
              <div style={{gridColumn:'1/-1',borderTop:'1px solid #e5e7eb',paddingTop:10,marginTop:10}}>
                <div style={{fontSize:11,fontWeight:700,color:'#4b5563',letterSpacing:.5,marginBottom:6}}>{'\ud83d\udcb0 FEED COST RATES'} <span style={{fontWeight:400,color:'#9ca3af'}}>{'(locked \u2014 set in Admin \u203a Feed Costs)'}</span></div>
                <div style={{display:'flex',gap:16,fontSize:12,color:'#374151',padding:'8px 12px',background:'#f9fafb',borderRadius:8,border:'1px solid #e5e7eb',flexWrap:'wrap'}}>
                  <span>Starter: <strong>{form.perLbStarterCost!==''&&form.perLbStarterCost!=null?'$'+parseFloat(form.perLbStarterCost).toFixed(3)+'/lb':'\u2014'}</strong></span>
                  <span>Grower (Standard): <strong>{form.perLbStandardCost!==''&&form.perLbStandardCost!=null?'$'+parseFloat(form.perLbStandardCost).toFixed(3)+'/lb':'\u2014'}</strong></span>
                  <span>Grit: <strong>{form.perLbGritCost!==''&&form.perLbGritCost!=null?'$'+parseFloat(form.perLbGritCost).toFixed(3)+'/lb':'\u2014'}</strong></span>
                </div>
              </div>
            </div>

            {/* ── Processing ── */}
            <div style={{gridColumn:"1/-1",borderTop:"1px solid #e5e7eb",paddingTop:12}}>
              <div style={{fontSize:11,fontWeight:700,color:"#9ca3af",letterSpacing:.5,marginBottom:8}}>PROCESSING</div>
              <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10}}>
                <div><label style={S.label}>Birds to Processor</label><input type="number" min="0" value={form.totalToProcessor||''} onChange={e=>upd("totalToProcessor",e.target.value)}/></div>
                <div><label style={S.label}>Processing Cost ($)</label><input type="number" min="0" step="0.01" value={form.processingCost||''} onChange={e=>upd("processingCost",e.target.value)}/></div>
                <div>
                  <label style={S.label}>Feed per Bird (lbs)</label>
                  <div style={{padding:'8px 10px',background:'#f9fafb',border:'1px solid #e5e7eb',borderRadius:6,fontSize:13,fontWeight:600,color:(()=>{const tf=(parseFloat(form.brooderFeedLbs)||0)+(parseFloat(form.schoonerFeedLbs)||0);const p=parseFloat(form.totalToProcessor)||0;return tf>0&&p>0?'#085041':'#9ca3af';})()}}>
                    {(()=>{
                      const tf=(parseFloat(form.brooderFeedLbs)||0)+(parseFloat(form.schoonerFeedLbs)||0);
                      const p=parseFloat(form.totalToProcessor)||0;
                      return tf>0&&p>0?(tf/p).toFixed(1)+' lbs/bird':'\u2014 (enter feed totals + birds to processor)';
                    })()}
                  </div>
                </div>
                <div><label style={S.label}>Avg Breast (lbs)</label><input type="number" min="0" step="0.01" value={form.avgBreastLbs||''} onChange={e=>upd("avgBreastLbs",e.target.value)}/></div>
                <div><label style={S.label}>Avg Thighs (lbs)</label><input type="number" min="0" step="0.01" value={form.avgThighsLbs||''} onChange={e=>upd("avgThighsLbs",e.target.value)}/></div>
                <div style={{gridColumn:"1/-1"}}><label style={S.label}>Avg Dressed Bird (lbs)</label><input type="number" min="0" step="0.01" value={form.avgDressedLbs||''} onChange={e=>upd("avgDressedLbs",e.target.value)}/></div>
              </div>
            </div>
            <div style={{gridColumn:"1/-1",borderTop:"1px solid #e5e7eb",paddingTop:12}}>
              <div style={{fontSize:11,fontWeight:700,color:"#9ca3af",letterSpacing:.5,marginBottom:8}}>PRODUCTION TOTALS</div>
              <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10}}>
                <div><label style={S.label}>Total Lbs — Whole Birds</label><input type="number" min="0" step="0.1" value={form.totalLbsWhole||''} onChange={e=>upd("totalLbsWhole",e.target.value)}/></div>
                <div><label style={S.label}>Total Lbs — Cuts</label><input type="number" min="0" step="0.1" value={form.totalLbsCuts||''} onChange={e=>upd("totalLbsCuts",e.target.value)}/></div>
              </div>
            </div>

            {/* ── Documents ── */}
            {editId&&(
              <div style={{gridColumn:"1/-1",borderTop:"1px solid #e5e7eb",paddingTop:12}}>
                <div style={{fontSize:11,fontWeight:700,color:"#9ca3af",letterSpacing:.5,marginBottom:8}}>DOCUMENTS</div>

                {/* Processor Excel parse confirmation panel */}
                {parsedProcessor&&(
                  <div style={{background:'#eff6ff',border:'1px solid #bfdbfe',borderRadius:10,padding:'12px 14px',marginBottom:12}}>
                    <div style={{fontSize:12,fontWeight:700,color:'#1e40af',marginBottom:8}}>📊 Processor data found in <em>{parsedProcessor.fileName}</em> — select fields to apply:</div>
                    {[
                      {key:'avgDressed',   label:'Avg Dressed Wt (lbs)', val:parsedProcessor.avgDressed,  fmt:v=>v},
                      {key:'avgBreast',    label:'Avg Breast (lbs)',      val:parsedProcessor.avgBreast,   fmt:v=>v},
                      {key:'avgThigh',     label:'Avg Thigh (lbs)',       val:parsedProcessor.avgThigh,    fmt:v=>v},
                      {key:'totalLbsWhole',label:'Total Lbs — Whole',    val:parsedProcessor.totalLbsWhole,fmt:v=>v!=null?Math.round(v)+' lbs':null},
                      {key:'totalLbsCuts', label:'Total Lbs — Cuts',     val:parsedProcessor.totalLbsCuts, fmt:v=>v!=null?Math.round(v)+' lbs':null},
                    ].filter(f=>f.val!=null).map(f=>(
                      <label key={f.key} style={{display:'flex',alignItems:'center',gap:8,marginBottom:6,cursor:'pointer'}}>
                        <input type="checkbox" defaultChecked={true} id={`pp_${f.key}`}
                          style={{width:14,height:14,cursor:'pointer'}}/>
                        <span style={{fontSize:12,color:'#1e40af',minWidth:160}}>{f.label}</span>
                        <span style={{fontSize:12,fontWeight:700,color:'#111827'}}>{f.fmt(f.val)}</span>
                      </label>
                    ))}
                    <div style={{display:'flex',gap:8,marginTop:10}}>
                      <button onClick={()=>{
                        const updates = {};
                        [
                          {key:'avgDressed',    formKey:'avgDressedLbs'},
                          {key:'avgBreast',     formKey:'avgBreastLbs'},
                          {key:'avgThigh',      formKey:'avgThighsLbs'},
                          {key:'totalLbsWhole', formKey:'totalLbsWhole'},
                          {key:'totalLbsCuts',  formKey:'totalLbsCuts'},
                        ].forEach(({key,formKey})=>{
                          const cb = document.getElementById(`pp_${key}`);
                          if(cb&&cb.checked&&parsedProcessor[key]!=null) updates[formKey]=parsedProcessor[key];
                        });
                        setForm(f=>({...f,...updates}));
                        setParsedProcessor(null);
                      }} style={{padding:'6px 16px',borderRadius:7,border:'none',background:'#085041',color:'white',fontSize:12,fontWeight:600,cursor:'pointer',fontFamily:'inherit'}}>
                        Apply Selected
                      </button>
                      <button onClick={()=>{
                        const updates = {};
                        [
                          {key:'avgDressed',    formKey:'avgDressedLbs'},
                          {key:'avgBreast',     formKey:'avgBreastLbs'},
                          {key:'avgThigh',      formKey:'avgThighsLbs'},
                          {key:'totalLbsWhole', formKey:'totalLbsWhole'},
                          {key:'totalLbsCuts',  formKey:'totalLbsCuts'},
                        ].forEach(({key,formKey})=>{
                          if(parsedProcessor[key]!=null) updates[formKey]=parsedProcessor[key];
                        });
                        setForm(f=>({...f,...updates}));
                        setParsedProcessor(null);
                      }} style={{padding:'6px 16px',borderRadius:7,border:'1px solid #085041',background:'white',color:'#085041',fontSize:12,fontWeight:600,cursor:'pointer',fontFamily:'inherit'}}>
                        Apply All
                      </button>
                      <button onClick={()=>setParsedProcessor(null)} style={{padding:'6px 12px',borderRadius:7,border:'1px solid #d1d5db',background:'white',color:'#6b7280',fontSize:12,cursor:'pointer',fontFamily:'inherit'}}>
                        Dismiss
                      </button>
                    </div>
                  </div>
                )}

                {/* Drop zone */}
                <label
                  onDragOver={e=>{e.preventDefault();e.currentTarget.style.background='#ecfdf5';e.currentTarget.style.borderColor='#085041';}}
                  onDragLeave={e=>{e.currentTarget.style.background='#f8fafc';e.currentTarget.style.borderColor='#d1d5db';}}
                  onDrop={async e=>{
                    e.preventDefault();
                    e.currentTarget.style.background='#f8fafc';e.currentTarget.style.borderColor='#d1d5db';
                    const files=Array.from(e.dataTransfer.files).filter(f=>/\.(pdf|xlsx|xls|csv)$/i.test(f.name));
                    if(!files.length){alert('Only PDF, Excel, and CSV files are supported.');return;}
                    setDocUploading(true);
                    for(const file of files){
                      if(file.size>20*1024*1024){alert(file.name+' is over 20 MB and was skipped.');continue;}
                      if(/\.xlsx?$/i.test(file.name)) await parseProcessorXlsx(file);
                      try {
                        const path=`broiler-batches/${editId}/${Date.now()}-${file.name.replace(/[^a-zA-Z0-9._-]/g,'_')}`;
                        const {error:upErr}=await sb.storage.from('batch-documents').upload(path,file,{cacheControl:'3600',upsert:false});
                        if(upErr) throw upErr;
                        const {data:urlData}=sb.storage.from('batch-documents').getPublicUrl(path);
                        const doc={name:file.name,path,url:urlData.publicUrl,size:file.size,uploadedAt:new Date().toISOString()};
                        setForm(f=>{const newDocs=[...(f.documents||[]),doc];const nb=batches.map(b=>b.id===editId?{...b,documents:newDocs}:b);setBatches(nb);persist(nb);return {...f,documents:newDocs};});
                      } catch(err){alert('Upload failed for '+file.name+': '+(err.message||'Unknown error'));}
                    }
                    setDocUploading(false);
                  }}
                  style={{display:'flex',flexDirection:'column',alignItems:'center',justifyContent:'center',gap:6,
                    padding:'20px',background:'#f8fafc',border:'2px dashed #d1d5db',borderRadius:10,
                    cursor:docUploading?'not-allowed':'pointer',marginBottom:10,transition:'all .15s'}}>
                  <span style={{fontSize:28}}>{docUploading?'⏳':'📎'}</span>
                  <div style={{fontSize:12,fontWeight:600,color:'#374151'}}>{docUploading?'Uploading…':'Drop files here'}</div>
                  <div style={{fontSize:11,color:'#9ca3af'}}>PDF, Excel, CSV · click to browse · Excel files scanned for processor data</div>
                  <input type="file" accept=".pdf,.xlsx,.xls,.csv" multiple style={{display:"none"}} disabled={docUploading} onChange={async e=>{
                    const files=Array.from(e.target.files||[]);
                    if(!files.length) return;
                    setDocUploading(true);
                    for(const file of files){
                      if(!/\.(pdf|xlsx|xls|csv)$/i.test(file.name)){alert(file.name+' is not a supported file type and was skipped.');continue;}
                      if(file.size>20*1024*1024){alert(file.name+' is over 20 MB and was skipped.');continue;}
                      if(/\.xlsx?$/i.test(file.name)) await parseProcessorXlsx(file);
                      try {
                        const path=`broiler-batches/${editId}/${Date.now()}-${file.name.replace(/[^a-zA-Z0-9._-]/g,'_')}`;
                        const {error:upErr}=await sb.storage.from('batch-documents').upload(path,file,{cacheControl:'3600',upsert:false});
                        if(upErr) throw upErr;
                        const {data:urlData}=sb.storage.from('batch-documents').getPublicUrl(path);
                        const doc={name:file.name,path,url:urlData.publicUrl,size:file.size,uploadedAt:new Date().toISOString()};
                        setForm(f=>{const newDocs=[...(f.documents||[]),doc];const nb=batches.map(b=>b.id===editId?{...b,documents:newDocs}:b);setBatches(nb);persist(nb);return {...f,documents:newDocs};});
                      } catch(err){alert('Upload failed for '+file.name+': '+(err.message||'Unknown error'));}
                    }
                    setDocUploading(false);
                    e.target.value='';
                  }}/>
                </label>
                {(form.documents||[]).length===0&&(
                  <div style={{fontSize:12,color:'#9ca3af',fontStyle:'italic'}}>No documents attached yet</div>
                )}
                {(form.documents||[]).map((doc,i)=>(
                  <div key={i} style={{display:'flex',alignItems:'center',gap:8,padding:'8px 10px',background:'#f8fafc',border:'1px solid #e5e7eb',borderRadius:7,marginBottom:6}}>
                    {(()=>{const ext=(doc.name||'').split('.').pop().toLowerCase();const ico=ext==='pdf'?'📄':ext==='csv'?'📊':'📗';return <span style={{fontSize:18,flexShrink:0}}>{ico}</span>;})()}
                    <div style={{flex:1,minWidth:0}}>
                      <div style={{fontSize:12,fontWeight:600,color:'#111827',overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{doc.name}</div>
                      <div style={{fontSize:10,color:'#9ca3af'}}>{doc.size?(Math.round(doc.size/1024)+' KB'):''}{doc.uploadedAt?' · '+new Date(doc.uploadedAt).toLocaleDateString():''}</div>
                    </div>
                    <a href={doc.url} target="_blank" rel="noopener noreferrer" style={{fontSize:11,color:'#1d4ed8',fontWeight:600,textDecoration:'none',flexShrink:0}}>View</a>
                    <button onClick={()=>
                      confirmDelete('Remove this document? It cannot be recovered.',async()=>{
                        try { await sb.storage.from('batch-documents').remove([doc.path]); } catch(e){}
                        const newDocs=(form.documents||[]).filter((_,j)=>j!==i);
                        setForm(f=>({...f,documents:newDocs}));
                        const nb=batches.map(b=>b.id===editId?{...b,documents:newDocs}:b);
                        setBatches(nb); persist(nb);
                      })}
                      style={{fontSize:11,color:'#b91c1c',background:'none',border:'none',cursor:'pointer',flexShrink:0}}>Remove</button>
                  </div>
                ))}
              </div>
            )}          </div>

          <div style={{padding:"12px 20px",borderTop:"1px solid #e5e7eb",display:"flex",gap:8,alignItems:"center"}}>
            {editId
              ? <button style={S.btnDanger} onClick={()=>{del(editId);setShowForm(false);}}>Delete</button>
              : <button onClick={()=>submit(false)} style={{...S.btnPrimary,background:"#085041",cursor:"pointer"}}>Add batch</button>
            }
            <button style={S.btnGhost} onClick={closeForm}>Close</button>
            {editId&&<div style={{marginLeft:'auto',fontSize:11,color:'#9ca3af'}}>Auto-saves as you type</div>}
          </div>
        </div>
      </div>
    </div>
  );

  // ── BROILER HOME DASHBOARD ──
  if(view==="broilerHome") return React.createElement(BroilerHomeView, {Header, loadUsers});

  // ── TIMELINE VIEW ──
  if(view==="timeline") return React.createElement(BroilerTimelineView, {Header, loadUsers, openEdit});


  if(view==="broilerdailys") return React.createElement(BroilerDailysView, {sb, fmt, Header, authState, pendingEdit, setPendingEdit, refreshDailys});
  if(view==="pigdailys")     return React.createElement(PigDailysView,     {sb, fmt, Header, authState, pigDailys, setPigDailys, feederGroups, pendingEdit, setPendingEdit, refreshDailys});
  if(view==="cattledailys")  return React.createElement(CattleDailysView,  {sb, fmt, Header, authState, pendingEdit, setPendingEdit, refreshDailys});
  if(view==="cattleHome")    return React.createElement(CattleHomeView,    {sb, fmt, Header, authState, setView, showUsers, setShowUsers, allUsers, setAllUsers, loadUsers});
  if(view==="cattleherds")   return React.createElement(CattleHerdsView,   {sb, fmt, Header, authState, setView, showUsers, setShowUsers, allUsers, setAllUsers, loadUsers, pendingEdit, setPendingEdit});
  if(view==="cattlebreeding")return React.createElement(CattleBreedingView,{sb, fmt, Header, authState, setView, showUsers, setShowUsers, allUsers, setAllUsers, loadUsers});
  if(view==="cattlebatches") return React.createElement(CattleBatchesView, {sb, fmt, Header, authState, setView, showUsers, setShowUsers, allUsers, setAllUsers, loadUsers});
  if(view==="cattleweighins")return React.createElement(CattleWeighInsView,{sb, fmt, Header, authState, setView, showUsers, setShowUsers, allUsers, setAllUsers, loadUsers});
  if(view==="broilerweighins")return React.createElement(LivestockWeighInsView,{sb, fmt, Header, authState, setView, showUsers, setShowUsers, allUsers, setAllUsers, loadUsers, species:'broiler'});
  if(view==="pigweighins")return React.createElement(LivestockWeighInsView,{sb, fmt, Header, authState, setView, showUsers, setShowUsers, allUsers, setAllUsers, loadUsers, species:'pig'});
  if(view==="sheepHome")     return React.createElement(SheepHomeView,     {sb, fmt, Header, authState, setView, showUsers, setShowUsers, allUsers, setAllUsers, loadUsers});
  if(view==="sheepflocks")   return React.createElement(SheepFlocksView,   {sb, fmt, Header, authState, setView, showUsers, setShowUsers, allUsers, setAllUsers, loadUsers, pendingEdit, setPendingEdit});
  if(view==="sheepdailys")   return React.createElement(SheepDailysView,   {sb, fmt, Header, authState, pendingEdit, setPendingEdit, refreshDailys});
  if(view==="sheepweighins") return React.createElement(SheepWeighInsView, {sb, fmt, Header, authState, setView, showUsers, setShowUsers, allUsers, setAllUsers, loadUsers});
  if(view==="equipmentHome") return (
    <div style={{minHeight:'100vh',background:'#f1f3f2'}}>
      {showUsers&&<UsersModal sb={sb} authState={authState} allUsers={allUsers} setAllUsers={setAllUsers} setShowUsers={setShowUsers} loadUsers={loadUsers}/>}
      <Header/>
      <div style={{padding:'1.25rem',maxWidth:1200,margin:'0 auto'}}>
        <div style={{background:'white',border:'1px solid #e5e7eb',borderRadius:12,padding:'2rem',textAlign:'center'}}>
          <div style={{fontSize:48,marginBottom:12}}>{'\ud83d\ude9c'}</div>
          <div style={{fontSize:18,fontWeight:700,color:'#57534e',marginBottom:6}}>Equipment Tracking</div>
          <div style={{fontSize:13,color:'#6b7280',marginBottom:18}}>Tractors, implements, maintenance schedules \u2014 coming in a future build.</div>
          <button onClick={()=>setView('home')} style={{padding:'8px 20px',borderRadius:7,border:'1px solid #d1d5db',background:'white',color:'#374151',fontSize:13,fontWeight:600,cursor:'pointer',fontFamily:'inherit'}}>{'\u2190 Back to Home'}</button>
        </div>
      </div>
    </div>
  );

  // ── LIST VIEW ──
  if(view==="list") return React.createElement(BroilerListView, {Header, loadUsers, openAdd, openEdit});

  // ── POULTRY FEED VIEW ──
  if(view==="feed") {
    const today = new Date();
    const todayDate = todayISO();
    const months = [];
    for(var mi2=-6;mi2<=6;mi2++){
      var d2=new Date(today.getFullYear(),today.getMonth()+mi2,1);
      months.push(d2.getFullYear()+'-'+String(d2.getMonth()+1).padStart(2,'0'));
    }
    var thisYM=today.getFullYear()+'-'+String(today.getMonth()+1).padStart(2,'0');
    function fmtMonth(ym){var p=ym.split('-').map(Number);return new Date(p[0],p[1]-1,1).toLocaleDateString('en-US',{month:'short',year:'numeric'});}

    var activeBroilers=batches.filter(function(b){return b.hatchDate;});
    var activeLayerBatchesForFeed=(layerBatches||[]).filter(function(b){return b.status==='active'&&b.name!=='Retirement Home';});
    var activeHousings=(layerHousings||[]).filter(function(h){return h.status==='active';});

    // Pre-compute actual consumption by month and feed type
    var actualByMonth={};
    months.forEach(function(ym){actualByMonth[ym]={starter:0,grower:0,layer:0};});
    (broilerDailys||[]).forEach(function(d){
      if(!d.date) return;
      var ym=d.date.substring(0,7);
      if(!actualByMonth[ym]) return;
      var lbs=parseFloat(d.feed_lbs)||0;
      if(d.feed_type==='STARTER') actualByMonth[ym].starter+=lbs;
      else if(d.feed_type==='GROWER') actualByMonth[ym].grower+=lbs;
    });
    (allLayerDailys||[]).forEach(function(d){
      if(!d.date) return;
      var ym=d.date.substring(0,7);
      if(!actualByMonth[ym]) return;
      var lbs=parseFloat(d.feed_lbs)||0;
      if(d.feed_type==='STARTER') actualByMonth[ym].starter+=lbs;
      else if(d.feed_type==='GROWER') actualByMonth[ym].grower+=lbs;
      else if(d.feed_type==='LAYER') actualByMonth[ym].layer+=lbs;
    });

    var monthlyData=months.map(function(ym){
      var p=ym.split('-').map(Number);var daysInMonth=new Date(p[0],p[1],0).getDate();
      var isFuture=ym>thisYM;var isCurrent=ym===thisYM;
      // Broiler projected
      var bStarter=0,bGrover=0;
      activeBroilers.forEach(function(b){var f=calcBatchFeedForMonth(b,ym);bStarter+=f.starter;bGrover+=f.grower;});
      // Layer projected
      var lStarter=0,lGrover=0,lLayer=0;
      activeLayerBatchesForFeed.forEach(function(b){
        var f=calcLayerFeedForMonth(b,layerHousings||[],allLayerDailys||[],ym);
        lStarter+=f.starter;lGrover+=f.grower;lLayer+=f.layer;
      });
      var starter=Math.round(bStarter+lStarter);
      var grower=Math.round(bGrover+lGrover);
      var layerFeed=Math.round(lLayer);
      var total=starter+grower+layerFeed;
      var act=actualByMonth[ym]||{starter:0,grower:0,layer:0};
      var actualTotal=Math.round(act.starter+act.grower+act.layer);
      var ordS=(feedOrders.starter||{})[ym]||0;
      var ordG=(feedOrders.grower||{})[ym]||0;
      var ordL=(feedOrders.layerfeed||{})[ym]||0;
      var ordered=Math.round((parseFloat(ordS)||0)+(parseFloat(ordG)||0)+(parseFloat(ordL)||0));
      return {ym:ym,daysInMonth:daysInMonth,starter:starter,grower:grower,layerFeed:layerFeed,total:total,
        actualStarter:Math.round(act.starter),actualGrover:Math.round(act.grower),actualLayer:Math.round(act.layer),actualTotal:actualTotal,
        ordS:ordS,ordG:ordG,ordL:ordL,ordered:ordered,isFuture:isFuture,isCurrent:isCurrent,
        bStarter:Math.round(bStarter),bGrover:Math.round(bGrover),lStarter:Math.round(lStarter),lGrover:Math.round(lGrover),lLayer:Math.round(lLayer)};
    }).filter(function(m){return m.total>0||m.actualTotal>0||m.ordered>0||m.isCurrent;});

    // Save helpers
    function savePoultryOrder(type,ym,val){
      // Empty string = clear the order (delete key). Any number (including 0) = save as decision made.
      var typeOrders={...(feedOrders[type]||{})};
      if(val===''||val==null){delete typeOrders[ym];}
      else{typeOrders[ym]=parseFloat(val)||0;}
      var next={...feedOrders,[type]:typeOrders};
      setFeedOrders(next);sbSave('ppp-feed-orders-v1',next);
    }
    function savePoultryFeedCount(type,count,date){
      var inv={...(poultryFeedInventory||{})};
      inv[type]={count:parseFloat(count)||0,date:date||todayDate};
      setPoultryFeedInventory(inv);sbSave('ppp-poultry-feed-inventory-v1',inv);
    }

    // Find earliest month with ANY poultry feed order — this is when tracking starts
    var allPoultryOrderMonths=[].concat(
      Object.keys(feedOrders.starter||{}).filter(function(k){return (parseFloat((feedOrders.starter||{})[k])||0)>0;}),
      Object.keys(feedOrders.grower||{}).filter(function(k){return (parseFloat((feedOrders.grower||{})[k])||0)>0;}),
      Object.keys(feedOrders.layerfeed||{}).filter(function(k){return (parseFloat((feedOrders.layerfeed||{})[k])||0)>0;})
    ).sort();
    var firstPoultryOrderYM=allPoultryOrderMonths.length>0?allPoultryOrderMonths[0]:'9999-99';

    // ── Build poultry running ledger per feed type ──
    var pAllDailys=(broilerDailys||[]).concat(allLayerDailys||[]);
    var pLedger={starter:{},grower:{},layer:{}};
    var pDaysLeft=new Date(today.getFullYear(),today.getMonth()+1,0).getDate()-today.getDate();
    ['starter','grower','layer'].forEach(function(type){
      var orderKey=type==='layer'?'layerfeed':type;
      var ftKey=type==='starter'?'STARTER':type==='grower'?'GROWER':'LAYER';
      var projKey=type==='starter'?'starter':type==='grower'?'grower':'layerFeed';
      var actualKey=type==='starter'?'actualStarter':type==='grower'?'actualGrover':'actualLayer';
      var runBal2=0;
      var pInv2=poultryFeedInventory&&poultryFeedInventory[type];
      var countApplied2=false;
      var allSorted=monthlyData.slice().sort(function(a,b){return a.ym.localeCompare(b.ym);});
      for(var mi4=0;mi4<allSorted.length;mi4++){
        var md4=allSorted[mi4];
        if(md4.ym<firstPoultryOrderYM){pLedger[type][md4.ym]=null;continue;}
        var st=runBal2;
        var isCM=false;var cAdj=null;
        if(pInv2&&!countApplied2){
          var iYM=pInv2.date.substring(0,7);
          if(iYM===md4.ym){
            cAdj=Math.round(pInv2.count-runBal2);st=pInv2.count;isCM=true;countApplied2=true;
            var cA=0;pAllDailys.forEach(function(d){if(d.date&&d.date>pInv2.date&&d.date.startsWith(md4.ym)&&d.feed_type===ftKey)cA+=(parseFloat(d.feed_lbs)||0);});
            var pR=0;if(md4.isCurrent&&pDaysLeft>0)pR=Math.round(md4[projKey]*(pDaysLeft/md4.daysInMonth));
            var cons=Math.round(cA+pR);var ord=parseFloat((feedOrders[orderKey]||{})[md4.ym])||0;var en=Math.round(st-cons+ord);
            pLedger[type][md4.ym]={start:st,consumed:cons,actualCons:Math.round(cA),projCons:Math.round(pR),ordered:ord,end:en,countMonth:true,countAdj:cAdj,proj:md4[projKey],actual:md4[actualKey]};
            runBal2=en;continue;
          } else if(iYM<md4.ym){st=pInv2.count;countApplied2=true;}
        }
        var aCtual=md4[actualKey];var pRoj=0;
        if(md4.isCurrent&&pDaysLeft>0)pRoj=Math.round(md4[projKey]*(pDaysLeft/md4.daysInMonth));
        else if(md4.isFuture){pRoj=md4[projKey];aCtual=0;}
        var cons2=Math.round(aCtual+pRoj);var ord2=parseFloat((feedOrders[orderKey]||{})[md4.ym])||0;var en2=Math.round(st-cons2+ord2);
        pLedger[type][md4.ym]={start:Math.round(st),consumed:cons2,actualCons:Math.round(aCtual),projCons:Math.round(pRoj),ordered:ord2,end:en2,countMonth:isCM,countAdj:cAdj,proj:md4[projKey],actual:md4[actualKey]};
        runBal2=en2;
      }
    });

    // Top-level aggregates for cards
    var pInv=poultryFeedInventory;
    var curLgS=pLedger.starter[thisYM];var curLgG=pLedger.grower[thisYM];var curLgL=pLedger.layer[thisYM];
    var pActualOnHand=null;var pEndOfMonth=null;
    if(curLgS||curLgG||curLgL){
      // Actual on hand = start of month - actual consumed so far (no projected, no current month order)
      var aohS=curLgS?Math.round(curLgS.start-curLgS.actualCons):null;
      var aohG=curLgG?Math.round(curLgG.start-curLgG.actualCons):null;
      var aohL=curLgL?Math.round(curLgL.start-curLgL.actualCons):null;
      pActualOnHand={starter:aohS,grower:aohG,layer:aohL,total:(aohS||0)+(aohG||0)+(aohL||0)};
      pEndOfMonth={starter:curLgS?curLgS.end:null,grower:curLgG?curLgG.end:null,layer:curLgL?curLgL.end:null,total:(curLgS?curLgS.end:0)+(curLgG?curLgG.end:0)+(curLgL?curLgL.end:0)};
    }
    // Suggested order — auto-detect: all 3 types must have current month order before cycling to next
    var pCurHasAllOrders=(feedOrders.starter||{})[thisYM]!=null
      &&(feedOrders.grower||{})[thisYM]!=null
      &&(feedOrders.layerfeed||{})[thisYM]!=null;
    var pOrderOffset=pCurHasAllOrders?1:0;
    var pOrderTarget=new Date(today.getFullYear(),today.getMonth()+pOrderOffset,1);
    var pOrderTargetYM=pOrderTarget.getFullYear()+'-'+String(pOrderTarget.getMonth()+1).padStart(2,'0');
    var pOrderTargetLabel=pOrderTarget.toLocaleDateString('en-US',{month:'short'});
    var pOrderTargetMD=monthlyData.find(function(m){return m.ym===pOrderTargetYM;});
    var pNextMonth=new Date(today.getFullYear(),today.getMonth()+pOrderOffset,1);
    var pMonthAfter=new Date(today.getFullYear(),today.getMonth()+pOrderOffset+1,1);
    var pMonthAfterYM=pMonthAfter.getFullYear()+'-'+String(pMonthAfter.getMonth()+1).padStart(2,'0');
    var pMonthAfterMD=monthlyData.find(function(m){return m.ym===pMonthAfterYM;});
    var pSugOrder=null;
    if(pEndOfMonth||!pCurHasAllOrders){
      var pBase=pEndOfMonth||{starter:0,grower:0,layer:0};
      // If ordering for current month, base is previous month end (start of current month)
      if(!pCurHasAllOrders&&curLgS){
        pBase={starter:curLgS?curLgS.start:0,grower:curLgG?curLgG.start:0,layer:curLgL?curLgL.start:0};
      }
      var sNeed=(pOrderTargetMD?pOrderTargetMD.starter:0)+(pMonthAfterMD?pMonthAfterMD.starter:0);
      var gNeed=(pOrderTargetMD?pOrderTargetMD.grower:0)+(pMonthAfterMD?pMonthAfterMD.grower:0);
      var lNeed=(pOrderTargetMD?pOrderTargetMD.layerFeed:0)+(pMonthAfterMD?pMonthAfterMD.layerFeed:0);
      pSugOrder={
        starter:Math.max(0,sNeed-(pBase.starter||0)),
        grower:Math.max(0,gNeed-(pBase.grower||0)),
        layer:Math.max(0,lNeed-(pBase.layer||0)),
        sNeed:sNeed,gNeed:gNeed,lNeed:lNeed,
      };
      pSugOrder.total=pSugOrder.starter+pSugOrder.grower+pSugOrder.layer;
    }

    var expandedMonths2=poultryFeedExpandedMonths;
    function toggleMonth2(ym){setPoultryFeedExpandedMonths(function(s){var n=new Set(s);n.has(ym)?n.delete(ym):n.add(ym);return n;});}

    return (
      <div>
        <Header/>
        <div style={{padding:"1rem",maxWidth:1200,margin:"0 auto",display:"flex",flexDirection:"column",gap:"1.25rem"}}>

          {/* Compact feed summary table — one row per type */}
          <div style={{background:'white',border:'1px solid #e5e7eb',borderRadius:12,overflow:'hidden'}}>
            <table style={{width:'100%',borderCollapse:'collapse',fontSize:13}}>
              <thead>
                <tr style={{borderBottom:'1px solid #e5e7eb',background:'#f9fafb'}}>
                  <th style={{padding:'8px 16px',textAlign:'left',fontWeight:600,color:'#6b7280',fontSize:10,textTransform:'uppercase',letterSpacing:.5}}>Feed Type</th>
                  <th style={{padding:'8px 12px',textAlign:'right',fontWeight:600,color:'#6b7280',fontSize:10,textTransform:'uppercase',letterSpacing:.5}}>On Hand</th>
                  <th style={{padding:'8px 12px',textAlign:'right',fontWeight:600,color:'#6b7280',fontSize:10,textTransform:'uppercase',letterSpacing:.5}}>End of Mo Est.</th>
                  <th style={{padding:'8px 12px',textAlign:'right',fontWeight:600,color:pSugOrder&&pSugOrder.total>0?'#92400e':'#6b7280',fontSize:10,textTransform:'uppercase',letterSpacing:.5}}>{'Order for '+pOrderTargetLabel}</th>
                  <th style={{padding:'8px 12px',textAlign:'right',fontWeight:600,color:'#6b7280',fontSize:10,textTransform:'uppercase',letterSpacing:.5}}>{'Need thru '+pMonthAfter.toLocaleDateString('en-US',{month:'short'})}</th>
                </tr>
              </thead>
              <tbody>
                {[
                  {label:'Starter',key:'starter',color:'#1d4ed8',aoh:pActualOnHand?pActualOnHand.starter:null,eom:pEndOfMonth?pEndOfMonth.starter:null,sug:pSugOrder?pSugOrder.starter:null,need:pSugOrder?pSugOrder.sNeed:null,m1:pOrderTargetMD?pOrderTargetMD.starter:0,m2:pMonthAfterMD?pMonthAfterMD.starter:0,countAdj:curLgS&&curLgS.countMonth?curLgS.countAdj:null,countDate:pInv&&pInv.starter?pInv.starter.date:null},
                  {label:'Grower',key:'grower',color:'#085041',aoh:pActualOnHand?pActualOnHand.grower:null,eom:pEndOfMonth?pEndOfMonth.grower:null,sug:pSugOrder?pSugOrder.grower:null,need:pSugOrder?pSugOrder.gNeed:null,m1:pOrderTargetMD?pOrderTargetMD.grower:0,m2:pMonthAfterMD?pMonthAfterMD.grower:0,countAdj:curLgG&&curLgG.countMonth?curLgG.countAdj:null,countDate:pInv&&pInv.grower?pInv.grower.date:null},
                  {label:'Layer Feed',key:'layer',color:'#78350f',aoh:pActualOnHand?pActualOnHand.layer:null,eom:pEndOfMonth?pEndOfMonth.layer:null,sug:pSugOrder?pSugOrder.layer:null,need:pSugOrder?pSugOrder.lNeed:null,m1:pOrderTargetMD?pOrderTargetMD.layerFeed:0,m2:pMonthAfterMD?pMonthAfterMD.layerFeed:0,countAdj:curLgL&&curLgL.countMonth?curLgL.countAdj:null,countDate:pInv&&pInv.layer?pInv.layer.date:null},
                ].map(function(ft){
                  return React.createElement('tr',{key:ft.label,style:{borderBottom:'1px solid #f3f4f6'}},
                    React.createElement('td',{style:{padding:'10px 16px',fontWeight:700,color:ft.color,fontSize:13}},
                      React.createElement('span',{style:{display:'inline-block',width:8,height:8,borderRadius:2,background:ft.color,marginRight:8}}),ft.label),
                    React.createElement('td',{style:{padding:'10px 12px',textAlign:'right'}},
                      React.createElement('div',{style:{fontSize:15,fontWeight:700,color:ft.aoh!=null?(ft.aoh>0?'#065f46':'#b91c1c'):'#9ca3af'}},ft.aoh!=null?ft.aoh.toLocaleString():'\u2014'),
                      ft.countDate&&React.createElement('div',{style:{fontSize:9,color:'#9ca3af'}},'Count: '+fmt(ft.countDate)),
                      ft.countAdj!=null&&ft.countAdj!==0&&React.createElement('div',{style:{fontSize:9,color:ft.countAdj>0?'#065f46':'#b91c1c'}},
                        'Adj '+(ft.countAdj>0?'+':'')+ft.countAdj.toLocaleString())
                    ),
                    React.createElement('td',{style:{padding:'10px 12px',textAlign:'right',fontSize:15,fontWeight:700,color:ft.eom!=null?(ft.eom>0?'#065f46':'#b91c1c'):'#9ca3af'}},ft.eom!=null?ft.eom.toLocaleString():'\u2014'),
                    React.createElement('td',{style:{padding:'10px 12px',textAlign:'right',fontSize:15,fontWeight:700,color:ft.sug>0?'#92400e':'#065f46',background:ft.sug>0?'#fffbeb':'transparent'}},ft.sug!=null?(ft.sug>0?ft.sug.toLocaleString():'\u2713 Surplus'):'\u2014'),
                    React.createElement('td',{style:{padding:'10px 12px',textAlign:'right'}},
                      React.createElement('div',{style:{fontSize:12,color:'#6b7280',fontWeight:600}},ft.need!=null?ft.need.toLocaleString():'\u2014'),
                      React.createElement('div',{style:{fontSize:10,color:'#9ca3af'}},ft.m1.toLocaleString()+' ('+pOrderTargetLabel+') + '+ft.m2.toLocaleString()+' ('+pMonthAfter.toLocaleDateString('en-US',{month:'short'})+')')
                    )
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* Physical count input */}
          <div style={{background:'white',border:'1px solid #e5e7eb',borderRadius:12,padding:'12px 20px'}}>
            <div style={{display:'flex',gap:12,alignItems:'flex-end',flexWrap:'wrap'}}>
              <div style={{fontSize:12,fontWeight:600,color:'#4b5563',alignSelf:'center'}}>{pInv&&(pInv.starter||pInv.grower||pInv.layer)?'Update Physical Count':'Enter Physical Count'}</div>
              <div>
                <label style={{fontSize:11,color:'#6b7280',display:'block',marginBottom:3}}>Feed type</label>
                <select id="poultry-feed-count-type" defaultValue="starter" style={{fontSize:13,padding:'7px 10px',border:'1px solid #d1d5db',borderRadius:6,fontFamily:'inherit'}}>
                  <option value="starter">Starter</option>
                  <option value="grower">Grower</option>
                  <option value="layer">Layer Feed</option>
                </select>
              </div>
              <div>
                <label style={{fontSize:11,color:'#6b7280',display:'block',marginBottom:3}}>Lbs on hand</label>
                <input id="poultry-feed-count-input" type="number" min="0" step="100" placeholder="e.g. 2000" style={{fontSize:13,padding:'7px 10px',border:'1px solid #d1d5db',borderRadius:6,width:100,fontFamily:'inherit'}}/>
              </div>
              <div>
                <label style={{fontSize:11,color:'#6b7280',display:'block',marginBottom:3}}>Date</label>
                <input id="poultry-feed-count-date" type="date" defaultValue={todayDate} style={{fontSize:13,padding:'7px 10px',border:'1px solid #d1d5db',borderRadius:6,fontFamily:'inherit'}}/>
              </div>
              <button onClick={function(){
                var el=document.getElementById('poultry-feed-count-input');
                var dl=document.getElementById('poultry-feed-count-date');
                var tp=document.getElementById('poultry-feed-count-type');
                if(!el||!el.value){alert('Enter the lbs on hand.');return;}
                savePoultryFeedCount(tp.value,el.value,dl?dl.value:todayDate);
                el.value='';
              }} style={{padding:'7px 16px',borderRadius:7,border:'none',background:'#085041',color:'white',fontWeight:600,fontSize:12,cursor:'pointer',fontFamily:'inherit',whiteSpace:'nowrap'}}>
                Save Count
              </button>
            </div>
          </div>

          {/* Monthly summary — current first, then future, then past by year */}
          {(function(){
            // Render a single month card — ledger format
            function renderMonthCard(md){
              var lgS=pLedger.starter[md.ym];var lgG=pLedger.grower[md.ym];var lgL=pLedger.layer[md.ym];
              var types=[
                {key:'starter',label:'Starter',color:'#1d4ed8',ordKey:'starter',lg:lgS,proj:md.starter,actual:md.actualStarter},
                {key:'grower',label:'Grower',color:'#085041',ordKey:'grower',lg:lgG,proj:md.grower,actual:md.actualGrover},
                {key:'layer',label:'Layer Feed',color:'#78350f',ordKey:'layerfeed',lg:lgL,proj:md.layerFeed,actual:md.actualLayer},
              ];
              var daysElapsed=md.isFuture?0:md.isCurrent?today.getDate():md.daysInMonth;
              return React.createElement('div',{key:md.ym,style:{background:'white',border:md.isCurrent?'2px solid #085041':'1px solid #e5e7eb',borderRadius:12,overflow:'hidden'}},
                React.createElement('div',{style:{padding:'10px 16px',display:'flex',alignItems:'center',gap:8,background:md.isCurrent?'#ecfdf5':md.isFuture?'#f8fafc':'white'}},
                  React.createElement('span',{style:{fontSize:14,fontWeight:700,color:'#111827'}},fmtMonth(md.ym)),
                  md.isCurrent&&React.createElement('span',{style:{fontSize:10,fontWeight:700,color:'#065f46',background:'#d1fae5',padding:'1px 8px',borderRadius:10}},'NOW'),
                  md.isFuture&&React.createElement('span',{style:{fontSize:10,color:'#9ca3af'}},'projected')
                ),
                // Ledger table per feed type
                React.createElement('div',{style:{padding:'0 16px 8px'}},
                  React.createElement('table',{style:{width:'100%',borderCollapse:'collapse',fontSize:12}},
                    React.createElement('thead',null,
                      React.createElement('tr',{style:{borderBottom:'1px solid #e5e7eb'}},
                        React.createElement('th',{style:{padding:'6px 0',textAlign:'left',fontWeight:600,color:'#6b7280',fontSize:10,textTransform:'uppercase',letterSpacing:.5,width:90}},'Feed Type'),
                        React.createElement('th',{style:{padding:'6px 8px',textAlign:'right',fontWeight:600,color:'#6b7280',fontSize:10,textTransform:'uppercase',letterSpacing:.5}},'Start'),
                        React.createElement('th',{style:{padding:'6px 8px',textAlign:'right',fontWeight:600,color:'#6b7280',fontSize:10,textTransform:'uppercase',letterSpacing:.5}},'Consumed'),
                        React.createElement('th',{style:{padding:'6px 8px',textAlign:'right',fontWeight:600,color:'#6b7280',fontSize:10,textTransform:'uppercase',letterSpacing:.5,width:90}},'Ordered'),
                        React.createElement('th',{style:{padding:'6px 8px',textAlign:'right',fontWeight:600,color:'#6b7280',fontSize:10,textTransform:'uppercase',letterSpacing:.5}},'End of Mo')
                      )
                    ),
                    React.createElement('tbody',null,
                      types.map(function(t){
                        var lg=t.lg;
                        var ordRaw=(feedOrders[t.ordKey]||{})[md.ym];var ordVal=ordRaw!=null&&ordRaw!==''?ordRaw:'';
                        return React.createElement('tr',{key:t.key,style:{borderBottom:'1px solid #f3f4f6'}},
                          React.createElement('td',{style:{padding:'7px 0',fontWeight:600,color:t.color,fontSize:12}},t.label),
                          React.createElement('td',{style:{padding:'7px 8px',textAlign:'right',color:lg?'#374151':'#9ca3af'}},lg?lg.start.toLocaleString():'\u2014'),
                          React.createElement('td',{style:{padding:'7px 8px',textAlign:'right',color:'#111827'}},
                            lg?React.createElement('span',null,lg.consumed.toLocaleString(),
                              (md.isCurrent&&lg.projCons>0)?React.createElement('span',{style:{fontSize:10,color:'#9ca3af',marginLeft:4}},'('+lg.actualCons.toLocaleString()+'+'+lg.projCons.toLocaleString()+'p)'):null
                            ):'\u2014'
                          ),
                          React.createElement('td',{style:{padding:'7px 8px',textAlign:'right'},onClick:function(e){e.stopPropagation();}},
                            React.createElement('input',{type:'number',min:'0',step:'100',value:ordVal,onChange:function(e){savePoultryOrder(t.ordKey,md.ym,e.target.value);},placeholder:'0',style:{width:80,fontSize:12,padding:'4px 8px',border:'1px solid #d1d5db',borderRadius:6,textAlign:'right',fontFamily:'inherit'}})
                          ),
                          React.createElement('td',{style:{padding:'7px 8px',textAlign:'right',fontWeight:700,color:lg?(lg.end>0?'#065f46':'#b91c1c'):'#9ca3af'}},lg?lg.end.toLocaleString():'\u2014')
                        );
                      })
                    )
                  )
                ),
                null
              );
            }

            // Split months into current, future, past
            var currentMonth=monthlyData.filter(function(m){return m.isCurrent;});
            var futureMonths=monthlyData.filter(function(m){return m.isFuture;});
            var pastMonths=monthlyData.filter(function(m){return !m.isCurrent&&!m.isFuture;}).reverse(); // newest first

            // Group past months by year
            var pastByYear={};
            pastMonths.forEach(function(m){var yr=m.ym.substring(0,4);if(!pastByYear[yr])pastByYear[yr]=[];pastByYear[yr].push(m);});
            var pastYears=Object.keys(pastByYear).sort().reverse(); // newest year first

            var secToggle=poultryFeedExpandedMonths;
            function togSec(key){setPoultryFeedExpandedMonths(function(s){var n=new Set(s);n.has(key)?n.delete(key):n.add(key);return n;});}

            return React.createElement('div',{style:{display:'flex',flexDirection:'column',gap:'1.25rem'}},
              // Section header
              React.createElement('div',{style:{fontSize:14,fontWeight:700,color:'#085041'}},'Monthly Poultry Feed Summary'),

              // Current month — always visible
              currentMonth.length>0&&React.createElement('div',null,
                currentMonth.map(renderMonthCard)
              ),

              // Future months — collapsible
              futureMonths.length>0&&React.createElement('div',null,
                React.createElement('div',{onClick:function(){togSec('future');},style:{display:'flex',alignItems:'center',gap:6,cursor:'pointer',padding:'8px 0',marginBottom:6}},
                  React.createElement('span',{style:{fontSize:10,color:'#9ca3af'}},secToggle.has('future')?'\u25bc':'\u25b6'),
                  React.createElement('span',{style:{fontSize:13,fontWeight:600,color:'#4b5563'}},'UPCOMING MONTHS'),
                  React.createElement('span',{style:{fontSize:11,color:'#9ca3af'}},'('+futureMonths.length+')')
                ),
                secToggle.has('future')&&React.createElement('div',{style:{display:'flex',flexDirection:'column',gap:10}},
                  futureMonths.map(renderMonthCard)
                )
              ),

              // Past months — collapsible, grouped by year
              pastYears.length>0&&React.createElement('div',null,
                React.createElement('div',{onClick:function(){togSec('past');},style:{display:'flex',alignItems:'center',gap:6,cursor:'pointer',padding:'8px 0',marginBottom:6}},
                  React.createElement('span',{style:{fontSize:10,color:'#9ca3af'}},secToggle.has('past')?'\u25bc':'\u25b6'),
                  React.createElement('span',{style:{fontSize:13,fontWeight:600,color:'#4b5563'}},'PAST MONTHS'),
                  React.createElement('span',{style:{fontSize:11,color:'#9ca3af'}},'('+pastMonths.length+')')
                ),
                secToggle.has('past')&&React.createElement('div',{style:{display:'flex',flexDirection:'column',gap:14}},
                  pastYears.map(function(yr){
                    var yearMonths=pastByYear[yr];
                    var yearKey='past-'+yr;
                    return React.createElement('div',{key:yr},
                      pastYears.length>1&&React.createElement('div',{onClick:function(){togSec(yearKey);},style:{display:'flex',alignItems:'center',gap:6,cursor:'pointer',padding:'4px 0',marginBottom:6}},
                        React.createElement('span',{style:{fontSize:10,color:'#9ca3af'}},secToggle.has(yearKey)?'\u25bc':'\u25b6'),
                        React.createElement('span',{style:{fontSize:12,fontWeight:600,color:'#6b7280'}},yr),
                        React.createElement('span',{style:{fontSize:11,color:'#9ca3af'}},'('+yearMonths.length+' months)')
                      ),
                      (pastYears.length===1||secToggle.has(yearKey))&&React.createElement('div',{style:{display:'flex',flexDirection:'column',gap:10}},
                        yearMonths.map(renderMonthCard)
                      )
                    );
                  })
                )
              )
            );
          })()}

          {/* Per-batch breakdown - Broiler: Active expanded, Processed collapsible, Planned collapsible */}
          {(function(){
            function renderBroilerBatchFeed(b){
              var feed=calcBatchFeed(b);var schedule=feed.schedule;var starter=feed.starter;var grower=feed.grower;var total=feed.total;
              var C=getBatchColor(b.name);
              var bStats=calcBroilerStatsFromDailys(b,broilerDailys);
              var actStarter=bStats.starterFeed;var actGrower=bStats.growerFeed;var actTotal=actStarter+actGrower;
              var autoSt=calcPoultryStatus(b);
              return React.createElement('div',{key:b.id,style:{borderBottom:'1px solid #e5e7eb'}},
                React.createElement('div',{style:{display:'flex',alignItems:'center',gap:10,padding:'10px 16px',background:'#f9fafb',flexWrap:'wrap'}},
                  React.createElement('span',{style:{display:'inline-block',width:12,height:12,borderRadius:3,background:C.bg,border:'1px solid '+C.bd}}),
                  React.createElement('div',{style:{fontWeight:600,fontSize:13,color:'#1a1a1a',minWidth:100}},b.name),
                  React.createElement('span',{style:S.badge((BREED_STYLE[b.breed]||BREED_STYLE.CC).bg,(BREED_STYLE[b.breed]||BREED_STYLE.CC).tx)},breedLabel(b.breed)),
                  React.createElement('span',{style:S.badge('#f3f4f6','#374151')},'Schooner '+b.schooner),
                  React.createElement('span',{style:{fontSize:12,color:'#4b5563'}},'Hatch: '+fmt(b.hatchDate)),
                  (function(){var autoSt2=calcPoultryStatus(b);var endDate=autoSt2==='processed'?b.processingDate:todayISO();if(!b.hatchDate||!endDate)return null;var days=Math.round((new Date(endDate+'T12:00:00')-new Date(b.hatchDate+'T12:00:00'))/86400000);var w2=Math.floor(days/7);var d2=days%7;return React.createElement('span',{style:{fontSize:11,fontWeight:600,color:'#085041',background:'#ecfdf5',padding:'2px 8px',borderRadius:10}},w2+'w '+d2+'d'+(autoSt2==='processed'?' total':''));})(),
                  (parseInt(b.totalToProcessor)>0)?React.createElement('span',{style:{fontSize:11,fontWeight:600,color:'#374151',background:'#f3f4f6',padding:'2px 8px',borderRadius:10}},parseInt(b.totalToProcessor).toLocaleString()+' processed'):null,
                  React.createElement('div',{style:{marginLeft:'auto',display:'flex',gap:20,flexWrap:'wrap'}},
                    [{label:'Starter',proj:starter,act:actStarter,color:'#1d4ed8'},
                     {label:'Grower',proj:grower,act:actGrower,color:'#085041'},
                     {label:'Total',proj:total,act:actTotal,color:'#1a1a1a'}
                    ].map(function(col){
                      var diff=col.act-col.proj;
                      return React.createElement('div',{key:col.label,style:{textAlign:'center'}},
                        React.createElement('div',{style:{fontSize:10,color:'#9ca3af',textTransform:'uppercase',letterSpacing:.5}},col.label),
                        React.createElement('div',{style:{display:'flex',gap:6,alignItems:'baseline',justifyContent:'center'}},
                          React.createElement('span',{style:{fontSize:13,fontWeight:700,color:col.color}},col.proj.toLocaleString()),
                          React.createElement('span',{style:{fontSize:10,color:'#9ca3af'}},'/'),
                          React.createElement('span',{style:{fontSize:13,fontWeight:700,color:col.act>0?'#111827':'#9ca3af'}},col.act>0?col.act.toLocaleString():'\u2014')
                        ),
                        col.act>0&&React.createElement('div',{style:{fontSize:10,fontWeight:600,color:diff>0?'#b91c1c':'#065f46'}},(diff>0?'+':'')+diff.toLocaleString())
                      );
                    })
                  )
                ),
                React.createElement('div',{style:{overflowX:'auto'}},
                  React.createElement('table',{style:{width:'100%',borderCollapse:'collapse',fontSize:11}},
                    React.createElement('thead',null,
                      React.createElement('tr',{style:{background:'#ecfdf5'}},
                        React.createElement('th',{style:{padding:'5px 12px',textAlign:'left',fontWeight:600,color:'#4b5563',whiteSpace:'nowrap'}},'Week'),
                        React.createElement('th',{style:{padding:'5px 12px',textAlign:'left',fontWeight:600,color:'#4b5563'}},'Phase'),
                        React.createElement('th',{style:{padding:'5px 12px',textAlign:'left',fontWeight:600,color:'#4b5563'}},'Location'),
                        React.createElement('th',{style:{padding:'5px 12px',textAlign:'right',fontWeight:600,color:'#4b5563',whiteSpace:'nowrap'}},'Lbs/Bird'),
                        React.createElement('th',{style:{padding:'5px 12px',textAlign:'right',fontWeight:600,color:'#4b5563',whiteSpace:'nowrap'}},'Total Lbs')
                      )
                    ),
                    React.createElement('tbody',null,
                      schedule.map(function(w,i){
                        return React.createElement('tr',{key:i,style:{borderTop:'1px solid #e5e7eb',background:w.phase==='starter'?'#f0f7ff':'#f0faf5'}},
                          React.createElement('td',{style:{padding:'5px 12px',fontWeight:500}},'Week '+w.week),
                          React.createElement('td',{style:{padding:'5px 12px'}},
                            React.createElement('span',{style:{padding:'2px 7px',borderRadius:4,fontSize:10,fontWeight:600,background:w.phase==='starter'?'#E6F1FB':'#EAF3DE',color:w.phase==='starter'?'#185FA5':'#27500A'}},w.phase==='starter'?'Starter':'Grower')
                          ),
                          React.createElement('td',{style:{padding:'5px 12px',color:'#4b5563'}},i<2?'Brooder '+b.brooder:'Schooner '+b.schooner),
                          React.createElement('td',{style:{padding:'5px 12px',textAlign:'right'}},w.lbsPerBird.toFixed(2)),
                          React.createElement('td',{style:{padding:'5px 12px',textAlign:'right',fontWeight:500}},w.totalLbs.toLocaleString())
                        );
                      }),
                      React.createElement('tr',{style:{borderTop:'2px solid #ddd',background:'#ecfdf5',fontWeight:600}},
                        React.createElement('td',{colSpan:4,style:{padding:'6px 12px',textAlign:'right',color:'#4b5563'}},'Total'),
                        React.createElement('td',{style:{padding:'6px 12px',textAlign:'right'}},total.toLocaleString()+' lbs')
                      )
                    )
                  )
                )
              );
            }
            var activeBrFeed=activeBroilers.filter(function(b){return calcPoultryStatus(b)==='active';});
            var plannedBrFeed=activeBroilers.filter(function(b){return calcPoultryStatus(b)==='planned';});
            var processedBrFeed=batches.filter(function(b){return calcPoultryStatus(b)==='processed'&&b.hatchDate;}).sort(function(a,b){return (b.processingDate||b.hatchDate||'').localeCompare(a.processingDate||a.hatchDate||'');});
            var secT=collapsedBatches;
            function togBr(key){setCollapsedBatches(function(s){var n=new Set(s);n.has(key)?n.delete(key):n.add(key);return n;});}
            return React.createElement('div',{style:{...S.card}},
              React.createElement('div',{style:{padding:'12px 16px',borderBottom:'1px solid #e5e7eb'}},
                React.createElement('div',{style:{fontWeight:600,fontSize:14,color:'#085041'}},'\ud83d\udc14 Broiler Feed Estimate Per Batch')
              ),
              // Active — always expanded
              activeBrFeed.length>0&&React.createElement('div',null,
                React.createElement('div',{style:{padding:'8px 16px',fontSize:12,fontWeight:700,color:'#065f46',background:'#ecfdf5',borderBottom:'1px solid #d1fae5'}},'ACTIVE ('+activeBrFeed.length+')'),
                activeBrFeed.map(renderBroilerBatchFeed)
              ),
              activeBrFeed.length===0&&React.createElement('div',{style:{padding:'2rem',textAlign:'center',color:'#9ca3af',fontSize:13}},'No active broiler batches'),
              // Processed — collapsible, newest first
              processedBrFeed.length>0&&React.createElement('div',null,
                React.createElement('div',{onClick:function(){togBr('proc');},style:{padding:'8px 16px',fontSize:12,fontWeight:700,color:'#4b5563',background:'#f9fafb',borderBottom:'1px solid #e5e7eb',cursor:'pointer',display:'flex',alignItems:'center',gap:6}},
                  React.createElement('span',{style:{fontSize:10,color:'#9ca3af'}},secT.has('proc')?'\u25bc':'\u25b6'),
                  'PROCESSED ('+processedBrFeed.length+')'
                ),
                secT.has('proc')&&processedBrFeed.map(renderBroilerBatchFeed)
              ),
              // Planned — collapsible
              plannedBrFeed.length>0&&React.createElement('div',null,
                React.createElement('div',{onClick:function(){togBr('planned');},style:{padding:'8px 16px',fontSize:12,fontWeight:700,color:'#4b5563',background:'#f8fafc',borderBottom:'1px solid #e5e7eb',cursor:'pointer',display:'flex',alignItems:'center',gap:6}},
                  React.createElement('span',{style:{fontSize:10,color:'#9ca3af'}},secT.has('planned')?'\u25bc':'\u25b6'),
                  'PLANNED ('+plannedBrFeed.length+')'
                ),
                secT.has('planned')&&plannedBrFeed.map(renderBroilerBatchFeed)
              )
            );
          })()}

          {/* Per-batch breakdown - Layer COLLAPSIBLE */}
          <div style={{...S.card}}>
            <div style={{padding:"12px 16px",borderBottom:"1px solid #e5e7eb",display:"flex",justifyContent:"space-between",alignItems:"center",cursor:"pointer"}}
              onClick={()=>setCollapsedBatches(s=>{const n=new Set(s); n.has('layers')?n.delete('layers'):n.add('layers'); return n;})}>
              <div style={{fontWeight:600,fontSize:14,color:"#78350f"}}>{'\ud83d\udc13 Layer Feed Estimate Per Batch'}</div>
              <span style={{fontSize:12,color:"#9ca3af"}}>{collapsedBatches.has('layers')?'\u25b6 expand':'\u25bc collapse'}</span>
            </div>
            {!collapsedBatches.has('layers')&&<>
            {activeLayerBatchesForFeed.length===0&&(
              <div style={{padding:"2rem",textAlign:"center",color:"#9ca3af",fontSize:13}}>No active layer batches</div>
            )}
            {activeLayerBatchesForFeed.map(function(b){
              var startDate=b.brooder_entry_date||b.arrival_date;
              var birdCount=parseInt(b.original_count)||0;
              var batchHousings=activeHousings.filter(function(h){return h.batch_id===b.id;});
              var hens=0;
              batchHousings.forEach(function(h){
                var proj=computeProjectedCount(h,allLayerDailys||[]);
                hens+=proj?proj.projected:(parseInt(h.current_count)||0);
              });
              if(hens===0) hens=birdCount;
              var totalStarter=0,totalGrover=0,totalLayer=0;
              LAYER_FEED_SCHEDULE.forEach(function(w){
                if(w.phase==='starter') totalStarter+=w.lbsPerBird*birdCount;
                else totalGrover+=w.lbsPerBird*birdCount;
              });
              // Cap starter at 1500
              if(totalStarter>1500) totalStarter=1500;
              // Layer feed: estimate 365 days/year at 0.25/bird/day
              totalLayer=hens*LAYER_FEED_PER_DAY*365;
              var ageMs=startDate?(new Date()-new Date(startDate+'T12:00:00')):0;
              var ageWeeks=ageMs>0?Math.floor(ageMs/86400000/7):0;
              var phase=ageWeeks<6?'Starter':ageWeeks<20?'Grower':'Layer Feed';
              return (
                <div key={b.id} style={{borderBottom:'1px solid #e5e7eb'}}>
                  <div style={{display:'flex',alignItems:'center',gap:10,padding:'10px 16px',background:'#fffbeb',flexWrap:'wrap'}}>
                    <span style={{fontSize:14}}>{'\ud83d\udc13'}</span>
                    <div style={{fontWeight:600,fontSize:13,color:'#92400e',minWidth:100}}>{b.name}</div>
                    <span style={S.badge('#fef3c7','#92400e')}>{phase}</span>
                    {startDate&&<span style={{fontSize:11,color:'#6b7280'}}>Started: {fmt(startDate)}</span>}
                    <span style={{fontSize:11,color:'#6b7280'}}>{birdCount>0?birdCount+' birds':'no bird count'}</span>
                    {hens!==birdCount&&<span style={{fontSize:11,color:'#6b7280'}}>{'\u2192 '+hens+' projected hens'}</span>}
                    <div style={{marginLeft:'auto',display:'flex',gap:16,flexWrap:'wrap'}}>
                      <div style={{textAlign:'center'}}>
                        <div style={{fontSize:10,color:'#9ca3af',textTransform:'uppercase',letterSpacing:.5}}>Starter</div>
                        <div style={{fontSize:15,fontWeight:700,color:'#1d4ed8'}}>{Math.round(totalStarter).toLocaleString()} lbs</div>
                      </div>
                      <div style={{textAlign:'center'}}>
                        <div style={{fontSize:10,color:'#9ca3af',textTransform:'uppercase',letterSpacing:.5}}>Grower</div>
                        <div style={{fontSize:15,fontWeight:700,color:'#085041'}}>{Math.round(totalGrover).toLocaleString()} lbs</div>
                      </div>
                      <div style={{textAlign:'center'}}>
                        <div style={{fontSize:10,color:'#9ca3af',textTransform:'uppercase',letterSpacing:.5}}>Layer / Year</div>
                        <div style={{fontSize:15,fontWeight:700,color:'#78350f'}}>{Math.round(totalLayer).toLocaleString()} lbs</div>
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
          </>}
          </div>

        </div>
      </div>
    );
  }

  // ── PIG FEED VIEW ──
  if(view==="pigs") return React.createElement(PigFeedView, {Header, loadUsers, pigFeedInventory, setPigFeedInventory, pigFeedExpandedMonths, setPigFeedExpandedMonths, sbSave});
  // ── BREEDING GANTT VIEW ──

  // ── PIGS HOME DASHBOARD ──
  if(view==="pigsHome") return React.createElement(PigsHomeView, {Header, loadUsers});

  if(view==="breeding") return React.createElement(BreedingView, {Header, loadUsers, persistBreeding, breedAutoSaveTimer});

  // ── PIG BATCHES VIEW ──
  if(view==="pigbatches") return React.createElement(PigBatchesView, {Header, loadUsers, persistFeeders, pigAutoSaveTimer, subAutoSaveTimer, tripAutoSaveTimer, showSubForm, setShowSubForm, subForm, setSubForm, editSubId, setEditSubId, collapsedBatches, setCollapsedBatches, collapsedMonths, setCollapsedMonths});


  // ── WEBFORMS ADMIN VIEW ──
  if(view==="webforms") return React.createElement(WebformsAdminView, {Header, loadUsers, persistWebforms, wfForm, setWfForm, wfSubmitting, setWfSubmitting, wfDone, setWfDone, wfErr, setWfErr, wfGroupName, setWfGroupName, wfView, setWfView, editWfId, setEditWfId, editFieldId, setEditFieldId, wfFieldForm, setWfFieldForm, newTeamMember, setNewTeamMember, addingTo, setAddingTo, editFldLbl, setEditFldLbl, editFldVal, setEditFldVal, editSecIdx, setEditSecIdx, editSecVal, setEditSecVal, newOpt, setNewOpt});

  // ── PIG DAILY WEBFORM VIEW (public, no auth needed — route: #pigdailys) ──
  function renderWebform() {
    const wfGroupOptions = wfGroups;

    function wfToggle(field, val){
      setWfForm(f=>({...f,[field]:val}));
    }

    async function wfSubmit(){
      // Validate required fields based on webformsConfig
      const wfCfg = webformsConfig?.webforms?.find(w=>w.id==='pig-dailys');
      const wfRequiredFields = wfCfg ? wfCfg.fields.filter(f=>f.required&&f.enabled!==false) : [];
      if(!wfForm.date){setWfErr('Please enter a date.');return;}
      if(!wfForm.teamMember.trim()){setWfErr('Please enter your name.');return;}
      if(!wfForm.batchId){setWfErr('Please select a pig group.');return;}
      // Check custom required fields
      for(const f of wfRequiredFields){
        if(f.system) continue; // already checked above
        if(f.id==='pig_count'&&wfForm.pigCount===''){setWfErr(`${f.label} is required.`);return;}
        if(f.id==='feed_lbs'&&wfForm.feedLbs===''){setWfErr(`${f.label} is required.`);return;}
        if(f.id==='fence_voltage'&&wfForm.fenceVoltage===''){setWfErr(`${f.label} is required.`);return;}
        if(f.id==='issues'&&!wfForm.issues.trim()){setWfErr(`${f.label} is required.`);return;}
      }
      setWfErr(''); setWfSubmitting(true);
      localStorage.setItem('wcf_team', wfForm.teamMember.trim());
      const record = {
        id: String(Date.now())+Math.random().toString(36).slice(2,6),
        submitted_at: new Date().toISOString(),
        date: wfForm.date,
        team_member: wfForm.teamMember.trim(),
        batch_id: wfForm.batchId.toLowerCase().replace(/[^a-z0-9]+/g,'-'),
        batch_label: wfForm.batchId,
        pig_count: wfForm.pigCount!==''?parseInt(wfForm.pigCount):null,
        feed_lbs: wfForm.feedLbs!==''?parseFloat(wfForm.feedLbs):null,
        group_moved: wfForm.groupMoved,
        nipple_drinker_moved: wfForm.nippleDrinkerMoved,
        nipple_drinker_working: wfForm.nippleDrinkerWorking,
        troughs_moved: wfForm.troughsMoved,
        fence_walked: wfForm.fenceWalked,
        fence_voltage: wfForm.fenceVoltage!==''?parseFloat(wfForm.fenceVoltage):null,
        issues: wfForm.issues.trim()||null
      };
      const {error} = await sb.from('pig_dailys').insert(record);
      setWfSubmitting(false);
      if(error){setWfErr('Could not save: '+error.message);return;}
      setWfGroupName(wfForm.batchId);
      setWfDone(true);
    }

    function wfReset(){
      const d=new Date();
      setWfForm({
        date:`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`,
        teamMember:localStorage.getItem('wcf_team')||'',
        batchId:'',pigCount:'',feedLbs:'',
        groupMoved:true,nippleDrinkerMoved:true,nippleDrinkerWorking:true,
        troughsMoved:true,fenceWalked:true,fenceVoltage:'',issues:''
      });
      setWfDone(false); setWfErr('');
    }

    function wfTgl(label,field){
      return (
        <div style={{marginBottom:12}}>
          <label style={{display:'block',fontSize:12,color:'#4b5563',marginBottom:4,fontWeight:500}}>{label}</label>
          <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',borderRadius:6,overflow:'hidden',border:'1px solid #d1d5db'}}>
            {[{v:true,l:'Yes'},{v:false,l:'No'}].map(({v,l})=>(
              <button key={String(v)} type="button" onClick={()=>wfToggle(field,v)}
                style={{padding:'9px 0',border:'none',fontFamily:'inherit',fontSize:13,fontWeight:500,cursor:'pointer',
                  background:wfForm[field]===v?(v?'#085041':'#374151'):'#f9fafb',
                  color:wfForm[field]===v?'white':'#6b7280'}}>
                {l}
              </button>
            ))}
          </div>
        </div>
      );
    }

    const wfCfgFields = (()=>{
      const wf = webformsConfig?.webforms?.find(w=>w.id==='pig-dailys');
      if(!wf) return [];
      return (wf.sections||[]).flatMap(s=>s.fields||[]);
    })();
    const isReq = id => { const f=wfCfgFields.find(f=>f.id===id); return f?f.required:['date','team_member','group'].includes(id); };
    const wfLbl = (text,id) => <label style={{display:'block',fontSize:12,color:'#4b5563',marginBottom:4,fontWeight:500}}>{text}{isReq(id)&&<span style={{color:'#b91c1c',marginLeft:2}}>*</span>}</label>;

    const wfCard = (title, children) => (
      <div style={{background:'white',border:'1px solid #e5e7eb',borderRadius:10,padding:20,marginBottom:16,boxShadow:'0 1px 3px rgba(0,0,0,.06)'}}>
        <div style={{fontSize:13,fontWeight:700,color:'#4b5563',textTransform:'uppercase',letterSpacing:.4,marginBottom:14,paddingBottom:10,borderBottom:'1px solid #e5e7eb'}}>{title}</div>
        {children}
      </div>
    );

    if(wfDone) return (
      <div style={{background:'#f6f8f7',minHeight:'100vh'}}>
        <div style={{background:'linear-gradient(135deg,#042f23,#085041 60%,#0d6652)',color:'white',padding:'14px 1.5rem',display:'flex',justifyContent:'space-between',alignItems:'center'}}>
          <div style={{display:'flex',alignItems:'center',gap:10}}>
            <div style={{fontSize:17,fontWeight:700,letterSpacing:'-.4px'}}>WCF Planner</div>
            <span style={{fontSize:11,fontWeight:500,color:'rgba(255,255,255,.6)',borderLeft:'1px solid rgba(255,255,255,.25)',paddingLeft:10,letterSpacing:.5}}>PIGS</span>
          </div>
          <div style={{fontSize:12,color:'rgba(255,255,255,.6)'}}>Daily Report</div>
        </div>
        <div style={{maxWidth:540,margin:'0 auto',padding:'3rem 1rem',textAlign:'center'}}>
          <div style={{fontSize:56,marginBottom:16}}>✅</div>
          <div style={{fontSize:20,fontWeight:700,marginBottom:8}}>Report submitted!</div>
          <div style={{fontSize:14,color:'#4b5563',marginBottom:28}}>Daily report saved for <strong>{wfGroupName}</strong>.</div>
          <button onClick={wfReset} style={{padding:'10px 28px',border:'2px solid #085041',borderRadius:10,background:'white',color:'#085041',fontSize:14,fontWeight:600,cursor:'pointer'}}>Submit another</button>
        </div>
      </div>
    );

    return (
      <div style={{background:'#f6f8f7',minHeight:'100vh'}}>
        {/* Header */}
        <div style={{background:'linear-gradient(135deg,#042f23,#085041 60%,#0d6652)',color:'white',padding:'14px 1.5rem',display:'flex',justifyContent:'space-between',alignItems:'center'}}>
          <div style={{display:'flex',alignItems:'center',gap:10}}>
            <div style={{fontSize:17,fontWeight:700,letterSpacing:'-.4px'}}>WCF Planner</div>
            <span style={{fontSize:11,fontWeight:500,color:'rgba(255,255,255,.6)',borderLeft:'1px solid rgba(255,255,255,.25)',paddingLeft:10,letterSpacing:.5}}>PIGS</span>
          </div>
          <div style={{fontSize:12,color:'rgba(255,255,255,.6)'}}>Daily Report</div>
        </div>

        <div style={{maxWidth:540,margin:'0 auto',padding:'1.5rem 1rem 3rem'}}>
          <div style={{fontSize:22,fontWeight:700,color:'#111827',marginBottom:20,letterSpacing:'-.3px'}}>Pig Dailys</div>
          {wfErr&&<div style={{background:'#fef2f2',border:'1px solid #fecaca',borderRadius:6,color:'#b91c1c',padding:'10px 14px',fontSize:13,marginBottom:14}}>{wfErr}</div>}


          {wfCard('Report Info', (
            <div style={{display:'flex',flexDirection:'column',gap:12}}>
              <div>
                <label style={{display:'block',fontSize:12,color:'#4b5563',marginBottom:4,fontWeight:500}}>Date{isReq('date')&&<span style={{color:'#b91c1c',marginLeft:2}}>*</span>}</label>
                <div style={{display:'flex',gap:8,alignItems:'center'}}>
                  <input type="date" value={wfForm.date} onChange={e=>setWfForm({...wfForm,date:e.target.value})}
                    style={{fontFamily:'inherit',fontSize:13,padding:'9px 12px',border:'1px solid #d1d5db',borderRadius:6,flex:1,outline:'none',background:'white',color:'#111827'}}/>
                  <span onClick={()=>{const d=new Date();setWfForm({...wfForm,date:`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`});}}
                    style={{display:'inline-block',fontSize:11,padding:'6px 10px',background:'#ecfdf5',color:'#085041',border:'1px solid #a7f3d0',borderRadius:6,fontWeight:600,cursor:'pointer',whiteSpace:'nowrap'}}>Today</span>
                </div>
              </div>
              <div>
                <label style={{display:'block',fontSize:12,color:'#4b5563',marginBottom:4,fontWeight:500}}>Team member{isReq('team_member')&&<span style={{color:'#b91c1c',marginLeft:2}}>*</span>}</label>
                {wfTeamMembers.length>0
                  ? <select value={wfForm.teamMember} onChange={e=>setWfForm({...wfForm,teamMember:e.target.value})}
                      style={{fontFamily:'inherit',fontSize:13,padding:'9px 12px',border:'1px solid #d1d5db',borderRadius:6,width:'100%',outline:'none',background:'white',color:wfForm.teamMember?'#111827':'#9ca3af'}}>
                      <option value="">— Select name —</option>
                      {wfTeamMembers.map(m=><option key={m} value={m}>{m}</option>)}
                    </select>
                  : <input value={wfForm.teamMember} onChange={e=>setWfForm({...wfForm,teamMember:e.target.value})} placeholder="Your name"
                      style={{fontFamily:'inherit',fontSize:13,padding:'9px 12px',border:'1px solid #d1d5db',borderRadius:6,width:'100%',outline:'none',background:'white',color:'#111827'}}/>
                }
              </div>
              <div>
                <label style={{display:'block',fontSize:12,color:'#4b5563',marginBottom:4,fontWeight:500}}>Pig group{isReq('group')&&<span style={{color:'#b91c1c',marginLeft:2}}>*</span>}</label>
                <select value={wfForm.batchId} onChange={e=>setWfForm({...wfForm,batchId:e.target.value})}
                  style={{fontFamily:'inherit',fontSize:13,padding:'9px 12px',border:'1px solid #d1d5db',borderRadius:6,width:'100%',outline:'none',background:'white',color:'#111827'}}>
                  <option value="">— Select group —</option>
                  {wfGroupOptions.map(g=><option key={g.value} value={g.value}>{g.label}</option>)}
                </select>
              </div>
            </div>
          ))}

          {wfCard('Count & Feed', (
            <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:12}}>
              <div>
                <label style={{display:'block',fontSize:12,color:'#4b5563',marginBottom:4,fontWeight:500}}># Pigs in group{isReq('pig_count')&&<span style={{color:'#b91c1c',marginLeft:2}}>*</span>}</label>
                <input type="number" min="0" value={wfForm.pigCount||''} onChange={e=>setWfForm({...wfForm,pigCount:e.target.value})} placeholder="0"
                  style={{fontFamily:'inherit',fontSize:13,padding:'9px 12px',border:'1px solid #d1d5db',borderRadius:6,width:'100%',outline:'none',background:'white'}}/>
                <div style={{fontSize:11,color:'#9ca3af',marginTop:3}}>Current headcount</div>
              </div>
              <div>
                <label style={{display:'block',fontSize:12,color:'#4b5563',marginBottom:4,fontWeight:500}}>Feed given (lbs){isReq('feed_lbs')&&<span style={{color:'#b91c1c',marginLeft:2}}>*</span>}</label>
                <input type="number" min="0" step="0.1" value={wfForm.feedLbs||''} onChange={e=>setWfForm({...wfForm,feedLbs:e.target.value})} placeholder="0"
                  style={{fontFamily:'inherit',fontSize:13,padding:'9px 12px',border:'1px solid #d1d5db',borderRadius:6,width:'100%',outline:'none',background:'white'}}/>
                <div style={{fontSize:11,color:'#9ca3af',marginTop:3}}>Total lbs fed today</div>
              </div>
            </div>
          ))}

          {wfCard('Daily Checks', (
            <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:12}}>
              {wfTgl("Was group moved?","groupMoved")}
              {wfTgl("Nipple drinker moved?","nippleDrinkerMoved")}
              {wfTgl("Nipple drinker working?","nippleDrinkerWorking")}
              {wfTgl("Feed troughs moved?","troughsMoved")}
              {wfTgl("Fence line walked?","fenceWalked")}
              <div>
                <label style={{display:'block',fontSize:12,color:'#4b5563',marginBottom:4,fontWeight:500}}>Fence voltage (kV){isReq('fence_voltage')&&<span style={{color:'#b91c1c',marginLeft:2}}>*</span>}</label>
                <input type="number" min="0" max="20" step="0.1" value={wfForm.fenceVoltage||''} onChange={e=>setWfForm({...wfForm,fenceVoltage:e.target.value})} placeholder="e.g. 4.2"
                  style={{fontFamily:'inherit',fontSize:13,padding:'9px 12px',border:'1px solid #d1d5db',borderRadius:6,width:'100%',outline:'none',background:'white'}}/>
              </div>
            </div>
          ))}

          {wfCard('Issues & Comments', (
            <div>
              <label style={{display:'block',fontSize:12,color:'#4b5563',marginBottom:4,fontWeight:500}}>Notes, issues, observations{isReq('issues')&&<span style={{color:'#b91c1c',marginLeft:2}}>*</span>}</label>
              <textarea rows={4} value={wfForm.issues} onChange={e=>setWfForm({...wfForm,issues:e.target.value})}
                placeholder="Any problems, unusual behavior, health concerns, maintenance needed…"
                style={{fontFamily:'inherit',fontSize:13,padding:'9px 12px',border:'1px solid #d1d5db',borderRadius:6,width:'100%',outline:'none',background:'white',resize:'vertical'}}/>
            </div>
          ))}

          <button onClick={wfSubmit} disabled={wfSubmitting}
            style={{width:'100%',padding:13,border:'none',borderRadius:10,background:'linear-gradient(135deg,#085041,#0d6652)',color:'white',fontSize:15,fontWeight:600,cursor:wfSubmitting?'not-allowed':'pointer',opacity:wfSubmitting?.6:1,boxShadow:'0 2px 8px rgba(8,80,65,.25)',fontFamily:'inherit'}}>
            {wfSubmitting?'Submitting…':'Submit Daily Report'}
          </button>
        </div>
      </div>
    );
  }



  // Resolve sire for a farrowing record from breeding cycle data.
  // Checks which cycle the farrowing belongs to (by date window),
  // then checks if the sow tag is in boar1Tags or boar2Tags to determine the sire.
  // Falls back to the manually entered r.sire for unlinked historical records.
  function resolveSire(rec){
    if(!rec||!rec.sow) return null;
    var sowTag=rec.sow.trim();
    for(var ci=0;ci<breedingCycles.length;ci++){
      var c=breedingCycles[ci];
      var tl=calcBreedingTimeline(c.exposureStart);
      if(!tl) continue;
      if(!rec.farrowingDate) continue;
      var rd=new Date(rec.farrowingDate+'T12:00:00');
      if(rd<new Date(tl.farrowingStart+'T12:00:00')||rd>addDays(new Date(tl.farrowingEnd+'T12:00:00'),14)) continue;
      var b1Tags=(c.boar1Tags||'').split(/[\n,]+/).map(function(t){return t.trim();}).filter(Boolean);
      var b2Tags=(c.boar2Tags||'').split(/[\n,]+/).map(function(t){return t.trim();}).filter(Boolean);
      if(b1Tags.includes(sowTag)) return c.boar1Name||boarNames.boar1;
      if(b2Tags.includes(sowTag)) return c.boar2Name||boarNames.boar2;
    }
    // No cycle match — return null (Unknown), not the hardcoded r.sire
    return null;
  }

  // ── FARROWING RECORDS VIEW ──
  if(view==="farrowing") return React.createElement(FarrowingView, {Header, loadUsers, persistFarrowing});

  // ── BREEDING PIGS TAB ──
  if(view==="sows") return React.createElement(SowsView, {Header, loadUsers, persistBreeders});




  // ── LAYERS HOME DASHBOARD (Phase 4) ──
  if(view==="layersHome") return React.createElement(LayersHomeView, {Header, loadUsers});

  if(view==="layers") return React.createElement(LayersView, {sb, layerGroups, persistLayerGroups, fmt, Header, layerBatches, layerHousings});
  if(view==="layerbatches") return React.createElement(LayerBatchesView, {sb, layerGroups, layerBatches, setLayerBatches, layerHousings, setLayerHousings:persistLayerHousings, batches, fmt, Header, authState, feedCosts, setView, pendingEdit, setPendingEdit});
  if(view==="layerdailys") return React.createElement(LayerDailysView, {sb, fmt, Header, authState, layerGroups, pendingEdit, setPendingEdit, refreshDailys});
  if(view==="eggdailys") return React.createElement(EggDailysView, {sb, fmt, Header, authState, layerGroups, pendingEdit, setPendingEdit, refreshDailys});

  // ── Cattle views ──
  // cattledailys is fully built; others are placeholder stubs until Phase 1 steps 10-13 land.
  // Unknown view - return null safely
  return null;
};



// Phase 2.1.1: WcfYN + WcfToggle moved to src/shared/ — imported at top of file.

// ── ADMIN ADD REPORT MODAL ──
// Mirrors WebformHub forms. Loads same Supabase config so Admin panel drives both.
// Phase 2.1.4: AdminAddReportModal moved to src/shared/AdminAddReportModal.jsx.
// ── BROILER DAILYS VIEW ──
// Phase 2 Round 2: BroilerDailysView moved to C:\Users\Ronni\WCF-planner\src\broiler\BroilerDailysView.jsx.

// ── LAYERS VIEW ──
// ── LAYER BATCHES VIEW ──
const LayerBatchesView = ({sb, layerGroups, layerBatches, setLayerBatches, layerHousings, setLayerHousings, batches, fmt, Header, authState, feedCosts, setView, pendingEdit, setPendingEdit}) => {
  const {useState,useEffect,useRef}=React;
  const todayStr=()=>{const d=new Date();return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;};
  const [loading,setLoading]=useState(true);
  const [batchStats,setBatchStats]=useState({});
  const [housingStats,setHousingStats]=useState({});
  const [rawLayerDailys,setRawLayerDailys]=useState([]); // for projected count calc
  const [selectedBatchId,setSelectedBatchId]=useState(null);
  const [retHomePeriod,setRetHomePeriod]=useState(30); // Rolling window: 30, 90, or 180 days
  const [showBatchForm,setShowBatchForm]=useState(false);
  const [showHousingForm,setShowHousingForm]=useState(false);
  const [editBatchId,setEditBatchId]=useState(null);
  const [editHousingId,setEditHousingId]=useState(null);
  const [err,setErr]=useState('');
  const [saving,setSaving]=useState(false);

  const HOUSING_CAPS={'Layer Schooner':450,'Eggmobile 1':250,'Eggmobile 2':250,'Eggmobile 3':250,'Eggmobile 4':250,'Retirement Home':9999};
  const getHousingCap=(name)=>{
    if(!name) return 9999;
    for(const [k,v] of Object.entries(HOUSING_CAPS)){if(name.toLowerCase().includes(k.toLowerCase()))return v;}
    return 9999;
  };

  const EMPTY_BATCH={name:'',status:'active',arrival_date:'',original_count:'',supplier:'',cost_per_bird:'',brooder_name:'',brooder_entry_date:'',brooder_exit_date:'',schooner_name:'',schooner_entry_date:'',schooner_exit_date:'',notes:'',per_lb_starter_cost:'',per_lb_grower_cost:'',per_lb_layer_cost:''};
  const EMPTY_HOUSING={housing_name:'',status:'active',current_count:'',start_date:todayStr(),retired_date:'',notes:''};
  const [bForm,setBForm]=useState(EMPTY_BATCH);
  const [hForm,setHForm]=useState(EMPTY_HOUSING);
  const housingAutoSaveTimer = useRef(null);
  const [housingSaving, setHousingSaving] = useState(false);
  const [housingPending, setHousingPending] = useState(false); // shows "saving..." indicator
  // Layer batch form autosave state
  const batchAutoSaveTimer = useRef(null);
  const [batchSaving, setBatchSaving] = useState(false);
  const [batchPending, setBatchPending] = useState(false);

  // Handle deep-link from timeline (clicking a layer bar selects this batch)
  useEffect(()=>{
    if(pendingEdit?.viewName==='layerbatches'&&pendingEdit?.id){
      setSelectedBatchId(pendingEdit.id);
      setPendingEdit&&setPendingEdit(null);
    }
  },[pendingEdit]);

  // Compute next batch name
  function nextBatchName(){
    const yr=new Date().getFullYear().toString().slice(2);
    const existing=layerBatches.filter(b=>b.name&&b.name.match(/^L-\d{2}-\d{2}$/));
    const nums=existing.map(b=>parseInt(b.name.slice(5))||0);
    const next=(Math.max(0,...nums)+1).toString().padStart(2,'0');
    return `L-${yr}-${next}`;
  }

  useEffect(()=>{
    // Paginated fetch — Supabase caps at 1000 rows per request.
    // This fetches in pages of 1000 until all rows are retrieved.
    async function fetchAll(table, columns){
      const PAGE=1000;
      let all=[], offset=0, done=false;
      while(!done){
        const{data,error}=await sb.from(table).select(columns).range(offset, offset+PAGE-1);
        if(error||!data||data.length===0){ done=true; break; }
        all=all.concat(data);
        if(data.length<PAGE) done=true;
        else offset+=PAGE;
      }
      return all;
    }
    Promise.all([
      fetchAll('layer_dailys','batch_label,batch_id,feed_lbs,grit_lbs,mortality_count,date,feed_type'),
      fetchAll('egg_dailys','group1_name,group1_count,group2_name,group2_count,group3_name,group3_count,group4_name,group4_count,date'),
    ]).then(([ld,ed])=>{
      setRawLayerDailys(ld);
      // Date range helper — only count records within a housing's active period
      function inRange(date,start,end){
        if(!date) return false;
        if(start && date<start) return false;
        if(end && date>end) return false;
        return true;
      }
      // Live layer feed phase calc — bird age from brooder_entry_date.
      // Days 0-20 = STARTER, 21-139 = GROWER, 140+ = LAYER.
      // Falls back to stored feed_type if anchor date is unknown.
      function calcPhaseFromAge(reportDate, brooderEntry, storedType){
        if(!brooderEntry || !reportDate) return storedType || 'LAYER';
        try {
          const days = Math.floor((new Date(reportDate+'T12:00:00') - new Date(brooderEntry+'T12:00:00'))/86400000);
          if(days < 21) return 'STARTER';
          if(days < 140) return 'GROWER';
          return 'LAYER';
        } catch(e) { return storedType || 'LAYER'; }
      }
      // Stats per batch — batch_id-based attribution.
      // Every layer_dailys row has a batch_id linking it to exactly one layer_batch.
      // This is set at submit time (for new reports) or backfilled (for historical data).
      // batch_id is the source of truth — NOT batch_label text matching.
      const stats={};
      layerBatches.forEach(batch=>{
        const anchor = batch.brooder_entry_date || batch.arrival_date || null;
        const bHousings=layerHousings.filter(h=>h.batch_id===batch.id);
        const myReports = ld.filter(d => d.batch_id === batch.id);
        let totalFeed=0,totalMort=0,starterFeed=0,growerFeed=0,layerFeed=0;
        myReports.forEach(d=>{
          const f = parseFloat(d.feed_lbs)||0;
          totalFeed += f;
          totalMort += parseInt(d.mortality_count)||0;
          const phase = calcPhaseFromAge(d.date, anchor, d.feed_type);
          if(phase==='STARTER') starterFeed += f;
          else if(phase==='GROWER') growerFeed += f;
          else layerFeed += f;
        });
        let totalEggs=0;
        bHousings.forEach(h=>{
          totalEggs += ed.reduce((s,d)=>{
            if(!inRange(d.date,h.start_date,h.retired_date)) return s;
            let e=0;
            [[d.group1_name,d.group1_count],[d.group2_name,d.group2_count],[d.group3_name,d.group3_count],[d.group4_name,d.group4_count]].forEach(([n,c])=>{if(n===h.housing_name)e+=parseInt(c)||0;});
            return s+e;
          },0);
        });
        stats[batch.id]={totalFeed,totalMort,totalEggs,starterFeed,growerFeed,layerFeed};
      });
      setBatchStats(stats);
      // Stats per housing — uses batch_id from each report's parent batch for phase calc
      const batchById = Object.fromEntries(layerBatches.map(b=>[b.id, b]));
      const hStats={};
      layerHousings.forEach(h=>{
        const parent = h.batch_id ? batchById[h.batch_id] : null;
        const anchor = parent ? (parent.brooder_entry_date || parent.arrival_date || null) : null;
        const hd=ld.filter(d=>String(d.batch_label||'').toLowerCase().trim()===String(h.housing_name||'').toLowerCase().trim() && inRange(d.date,h.start_date,h.retired_date));
        let totalFeed=0,totalMort=0,starterFeedH=0,growerFeedH=0,layerFeedH=0;
        hd.forEach(d=>{
          const f = parseFloat(d.feed_lbs)||0;
          totalFeed += f;
          totalMort += parseInt(d.mortality_count)||0;
          const phase = calcPhaseFromAge(d.date, anchor, d.feed_type);
          if(phase==='STARTER') starterFeedH += f;
          else if(phase==='GROWER') growerFeedH += f;
          else layerFeedH += f;
        });
        const totalEggs=ed.reduce((s,d)=>{
          if(!inRange(d.date,h.start_date,h.retired_date)) return s;
          let e=0;
          [[d.group1_name,d.group1_count],[d.group2_name,d.group2_count],[d.group3_name,d.group3_count],[d.group4_name,d.group4_count]].forEach(([n,c])=>{if(n===h.housing_name)e+=parseInt(c)||0;});
          return s+e;
        },0);
        hStats[h.id]={totalFeed,totalMort,totalEggs,starterFeed:starterFeedH,growerFeed:growerFeedH,layerFeed:layerFeedH};
      });
      setHousingStats(hStats);
      setLoading(false);
    });
  },[layerBatches,layerHousings]);

  // Which housings are currently locked (active in some batch)
  const lockedHousings=new Set(layerHousings.filter(h=>h.status==='active').map(h=>h.housing_name));

  // Save batch
  // Build a record from a form snapshot. Used by both autosave and close-flush.
  function buildBatchRec(formSnapshot){
    const f = formSnapshot;
    return {
      id: editBatchId || f.name.toLowerCase().replace(/[^a-z0-9]+/g,'-'),
      name: f.name.trim(),
      status: f.status||'active',
      arrival_date: f.arrival_date||null,
      original_count: f.original_count!==''?parseInt(f.original_count):null,
      supplier: f.supplier||null,
      cost_per_bird: f.cost_per_bird!==''?parseFloat(f.cost_per_bird):null,
      brooder_name: f.brooder_name||null,
      brooder_entry_date: f.brooder_entry_date||null,
      brooder_exit_date: f.brooder_exit_date||null,
      schooner_name: f.schooner_name||null,
      schooner_entry_date: f.schooner_entry_date||null,
      schooner_exit_date: f.schooner_exit_date||null,
      notes: f.notes||null,
      // Cost rates: only used at create-time. Once set, they're locked from this UI
      // (admin must update via Feed Costs panel). Defaulting on creation pulls from global.
      per_lb_starter_cost: editBatchId
        ? (f.per_lb_starter_cost!==''?parseFloat(f.per_lb_starter_cost):null)
        : (parseFloat(f.per_lb_starter_cost) || (feedCosts && feedCosts.starter) || null),
      per_lb_grower_cost: editBatchId
        ? (f.per_lb_grower_cost!==''?parseFloat(f.per_lb_grower_cost):null)
        : (parseFloat(f.per_lb_grower_cost) || (feedCosts && feedCosts.grower) || null),
      per_lb_layer_cost: editBatchId
        ? (f.per_lb_layer_cost!==''?parseFloat(f.per_lb_layer_cost):null)
        : (parseFloat(f.per_lb_layer_cost) || (feedCosts && feedCosts.layer) || null),
    };
  }

  async function persistBatchRec(rec){
    setBatchSaving(true);
    const {error} = await sb.from('layer_batches').upsert(rec,{onConflict:'id'});
    setBatchSaving(false);
    if(error){
      console.warn('layer_batches upsert error:', error.message);
      return false;
    }
    setLayerBatches(prev => {
      const exists = prev.find(b => b.id === rec.id);
      return exists ? prev.map(b => b.id === rec.id ? rec : b) : [...prev, rec];
    });
    setBatchPending(false);
    return true;
  }

  function scheduleBatchAutosave(formSnapshot){
    if(!formSnapshot.name || !formSnapshot.name.trim()) return; // never autosave a nameless batch
    setBatchPending(true);
    clearTimeout(batchAutoSaveTimer.current);
    batchAutoSaveTimer.current = setTimeout(()=>{
      const rec = buildBatchRec(formSnapshot);
      // Only set editBatchId on the first successful save of a NEW batch,
      // so subsequent autosaves UPDATE rather than re-INSERT
      if(!editBatchId) setEditBatchId(rec.id);
      persistBatchRec(rec);
    }, 1500);
  }

  async function flushBatchAutosave(){
    clearTimeout(batchAutoSaveTimer.current);
    if(!batchPending) return true;
    if(!bForm.name || !bForm.name.trim()){
      setErr('Batch name is required.');
      return false;
    }
    const rec = buildBatchRec(bForm);
    if(!editBatchId) setEditBatchId(rec.id);
    return await persistBatchRec(rec);
  }

  function updBatch(updater){
    setBForm(prev => {
      const next = typeof updater === 'function' ? updater(prev) : {...prev, ...updater};
      scheduleBatchAutosave(next);
      return next;
    });
  }

  async function closeBatchForm(){
    const ok = await flushBatchAutosave();
    if(!ok) return; // don't close if there's an unrecoverable error (e.g. missing name)
    setShowBatchForm(false);
    setEditBatchId(null);
    setBForm(EMPTY_BATCH);
    setBatchPending(false);
    setErr('');
  }

  // Save housing
  // ── Housing persistence (autosave model) ──
  // Build the record from a form snapshot. Used by both autosave and close-flush.
  function buildHousingRec(formSnapshot){
    let newCurrentCountDate = null;
    if(editHousingId){
      const existing = layerHousings.find(h=>h.id===editHousingId);
      const oldVal = existing?.current_count;
      const newVal = formSnapshot.current_count!==''?parseInt(formSnapshot.current_count):null;
      if(newVal !== (oldVal==null?null:parseInt(oldVal))){
        newCurrentCountDate = todayStr();
      } else {
        newCurrentCountDate = existing?.current_count_date || null;
      }
    } else {
      if(formSnapshot.current_count!==''){ newCurrentCountDate = todayStr(); }
    }
    return {
      id: editHousingId||(String(Date.now())+Math.random().toString(36).slice(2,6)),
      batch_id: selectedBatchId,
      housing_name: formSnapshot.housing_name,
      status: formSnapshot.status||'active',
      current_count: formSnapshot.current_count!==''?parseInt(formSnapshot.current_count):null,
      current_count_date: newCurrentCountDate,
      start_date: formSnapshot.start_date||null,
      retired_date: formSnapshot.retired_date||null,
      notes: formSnapshot.notes||null,
    };
  }

  // Persist a housing record. Returns true on success.
  async function persistHousing(rec){
    if(!rec.housing_name) return false;
    if(!selectedBatchId) return false;
    // Capacity warning now uses current_count instead of allocated_count
    const cap = getHousingCap(rec.housing_name);
    if((rec.current_count||0) > cap){
      setErr('\u26a0 '+rec.housing_name+' capacity is '+cap+' birds. You have '+rec.current_count+'.');
    } else {
      setErr('');
    }
    setHousingSaving(true);
    const {error} = await sb.from('layer_housings').upsert(rec, {onConflict:'id'});
    setHousingSaving(false);
    setHousingPending(false);
    if(error){
      setErr('Could not save: '+error.message);
      return false;
    }
    const exists = layerHousings.find(h=>h.id===rec.id);
    const updated = exists
      ? layerHousings.map(h=>h.id===rec.id?rec:h)
      : [...layerHousings, rec];
    setLayerHousings(updated);
    if(!editHousingId) setEditHousingId(rec.id);
    return true;
  }

  // Schedule a debounced autosave (1.5s)
  function scheduleHousingAutosave(formSnapshot){
    if(!formSnapshot.housing_name) return;
    setHousingPending(true);
    clearTimeout(housingAutoSaveTimer.current);
    housingAutoSaveTimer.current = setTimeout(()=>{
      const rec = buildHousingRec(formSnapshot);
      persistHousing(rec);
    }, 1500);
  }

  // Flush pending autosave immediately
  async function flushHousingAutosave(){
    if(housingAutoSaveTimer.current){
      clearTimeout(housingAutoSaveTimer.current);
      housingAutoSaveTimer.current = null;
    }
    if(housingPending && hForm.housing_name){
      const rec = buildHousingRec(hForm);
      await persistHousing(rec);
    }
  }

  // Close modal, flushing first
  async function closeHousingForm(){
    await flushHousingAutosave();
    setShowHousingForm(false);
    setEditHousingId(null);
    setHForm(EMPTY_HOUSING);
    setHousingPending(false);
    setErr('');
  }

  // Wrapper for setHForm that also schedules autosave
  function updHousing(updater){
    setHForm(prev => {
      const next = typeof updater === 'function' ? updater(prev) : updater;
      scheduleHousingAutosave(next);
      return next;
    });
  }

  // Retire housing
  async function retireHousing(h){
    const updated={...h,status:'retired',retired_date:todayStr()};
    const{error}=await sb.from('layer_housings').upsert(updated,{onConflict:'id'});
    if(error){alert('Could not retire: '+error.message);return;}
    setLayerHousings(layerHousings.map(x=>x.id===h.id?updated:x));
  }

  const selectedBatch=layerBatches.find(b=>b.id===selectedBatchId);
  const batchHousings=layerHousings.filter(h=>h.batch_id===selectedBatchId);

  // Available housing options (layer groups not locked by another batch)
  const availableHousings=layerGroups.filter(g=>{
    if(editHousingId){const cur=layerHousings.find(h=>h.id===editHousingId);if(cur&&cur.housing_name===g.name)return true;}
    return !lockedHousings.has(g.name)||(editHousingId&&layerHousings.find(h=>h.id===editHousingId)?.housing_name===g.name);
  });

  const StatPill=({label,val,color='#374151'})=>(
    <div style={{display:'flex',flexDirection:'column',alignItems:'center',minWidth:70}}>
      <div style={{fontSize:11,color:'#9ca3af',marginBottom:2}}>{label}</div>
      <div style={{fontWeight:700,fontSize:13,color}}>{val}</div>
    </div>
  );

  return (
    <div style={{minHeight:'100vh',background:'#f1f3f2'}}>
      <Header/>
      <div style={{padding:'1rem',maxWidth:1100,margin:'0 auto'}}>

        {/* BATCH LIST */}
        {!selectedBatchId&&(
          <>
            <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:16}}>
              <div style={{fontSize:20,fontWeight:700,color:'#111827'}}>Layer Batches
                <span style={{fontSize:13,fontWeight:400,color:'#6b7280',marginLeft:8}}>{layerBatches.filter(b=>b.status==='active').length} active</span>
              </div>
              <button onClick={()=>{setBForm({...EMPTY_BATCH,name:nextBatchName()});setEditBatchId(null);setShowBatchForm(true);}} style={{padding:'7px 18px',borderRadius:8,border:'none',background:'#085041',color:'white',cursor:'pointer',fontSize:12,fontWeight:600}}>+ New Batch</button>
            </div>
            {loading&&<div style={{textAlign:'center',padding:'3rem',color:'#9ca3af'}}>Loading...</div>}
            {!loading&&(
              <div style={{display:'flex',flexDirection:'column',gap:10}}>
                {/* Active batches */}
                {layerBatches.filter(b=>b.status==='active').map(function(batch,bi){
                  const stats=batchStats[batch.id]||{};
                  const housings=layerHousings.filter(h=>h.batch_id===batch.id);
                  const activeH=housings.filter(h=>h.status==='active');
                  const isRetHome=batch.name==='Retirement Home';
                  var batchColors=[{bg:'#ecfdf5',bd:'#a7f3d0',tx:'#065f46'},{bg:'#eff6ff',bd:'#bfdbfe',tx:'#1e40af'},{bg:'#fffbeb',bd:'#fde68a',tx:'#92400e'},{bg:'#f5f3ff',bd:'#ddd6fe',tx:'#5b21b6'}];
                  var bc=batchColors[bi%batchColors.length];
                  return (
                    <div key={batch.id} onClick={()=>setSelectedBatchId(batch.id)} style={{background:'white',border:'1px solid #e5e7eb',borderRadius:12,overflow:'hidden',cursor:'pointer'}} className="hoverable-tile">
                      <div style={{background:bc.bg,borderBottom:'1px solid '+bc.bd,padding:'10px 20px',display:'flex',alignItems:'center',gap:10,flexWrap:'wrap'}}>
                        <span style={{fontSize:15,fontWeight:700,color:bc.tx}}>{batch.name}</span>
                        <span style={{fontSize:10,fontWeight:700,padding:'2px 8px',borderRadius:10,background:'#d1fae5',color:'#065f46',textTransform:'uppercase'}}>{isRetHome?'Permanent':'Active'}</span>
                        {(batch.brooder_entry_date||batch.arrival_date)&&(()=>{const anchor=batch.brooder_entry_date||batch.arrival_date;const days=Math.max(0,Math.round((new Date(new Date().toISOString().split('T')[0]+'T12:00:00')-new Date(anchor+'T12:00:00'))/86400000));const months=+(days/30.44).toFixed(1);return <span style={{fontSize:11,color:'#6b7280'}}>In brooder {fmt(anchor)}{months>0?(' \u00b7 '+months+' months'):''}</span>;})()}
                        {batch.original_count&&<span style={{fontSize:11,color:'#6b7280'}}>{batch.original_count.toLocaleString()} birds</span>}
                      </div>
                      <div style={{padding:'12px 20px',display:'flex',gap:20,alignItems:'flex-start'}}>
                      <div style={{flex:1}}>
                        {activeH.length>0&&(()=>{
                          var batchColors=[{bg:'#ecfdf5',bd:'#a7f3d0',tx:'#065f46'},{bg:'#eff6ff',bd:'#bfdbfe',tx:'#1e40af'},{bg:'#fffbeb',bd:'#fde68a',tx:'#92400e'},{bg:'#f5f3ff',bd:'#ddd6fe',tx:'#5b21b6'}];
                          var bc=batchColors[bi%batchColors.length];
                          return (
                          <div style={{display:'flex',gap:6,flexWrap:'wrap',marginBottom:8}}>
                            {activeH.map(h=>(
                              <span key={h.id} style={{fontSize:11,background:bc.bg,border:'1px solid '+bc.bd,color:bc.tx,padding:'2px 8px',borderRadius:6,fontWeight:600}}>
                                🏠 {h.housing_name}{h.current_count?' · '+h.current_count+' hens':''}
                              </span>
                            ))}
                          </div>
                          );
                        })()}
                      </div>
                      <div style={{display:'flex',gap:20,flexShrink:0}}>
                        <StatPill label="Feed" val={stats.totalFeed>0?Math.round(stats.totalFeed).toLocaleString()+' lbs':'\u2014'} color="#92400e"/>
                        <StatPill label="Mort." val={stats.totalMort>0?stats.totalMort:'0'} color={stats.totalMort>10?'#b91c1c':'#374151'}/>
                        <StatPill label="Dozens" val={stats.totalEggs>0?Math.floor(stats.totalEggs/12).toLocaleString():'\u2014'} color="#065f46"/>
                        {(()=>{const fc=computeLayerFeedCost(stats.starterFeed,stats.growerFeed,stats.layerFeed,batch);return <StatPill label="Cost" val={fc!=null?'$'+fc.toLocaleString(undefined,{minimumFractionDigits:0,maximumFractionDigits:0}):'\u2014'} color="#065f46"/>;})()}
                      </div>
                      </div>
                    </div>
                  );
                })}
                {/* Retired batches */}
                {layerBatches.filter(b=>b.status==='retired').length>0&&(
                  <>
                    <div style={{fontSize:12,fontWeight:600,color:'#4b5563',letterSpacing:.3,marginTop:8}}>RETIRED BATCHES</div>
                    {layerBatches.filter(b=>b.status==='retired').map(function(batch,bi){
                      const stats=batchStats[batch.id]||{};
                      const housings=layerHousings.filter(h=>h.batch_id===batch.id);
                      return (
                        <div key={batch.id} onClick={()=>setSelectedBatchId(batch.id)} style={{background:bi%2===0?'#f9fafb':'#f3f4f6',border:'1px solid #e5e7eb',borderRadius:12,padding:'14px 20px',cursor:'pointer',display:'flex',gap:20,alignItems:'center',opacity:.8}} className="hoverable-tile">
                          <div style={{flex:1}}>
                            <div style={{display:'flex',alignItems:'center',gap:10}}>
                              <span style={{fontSize:14,fontWeight:700,color:'#374151'}}>{batch.name}</span>
                              <span style={{fontSize:10,fontWeight:700,padding:'2px 8px',borderRadius:10,background:'#f3f4f6',color:'#6b7280',textTransform:'uppercase'}}>Retired</span>
                              {(batch.brooder_entry_date||batch.arrival_date)&&(()=>{const anchor=batch.brooder_entry_date||batch.arrival_date;const days=Math.max(0,Math.round((new Date(new Date().toISOString().split('T')[0]+'T12:00:00')-new Date(anchor+'T12:00:00'))/86400000));const months=+(days/30.44).toFixed(1);return <span style={{fontSize:11,color:'#9ca3af'}}>In brooder {fmt(anchor)}{months>0?(' \u00b7 '+months+' months'):''}</span>;})()}
                            </div>
                          </div>
                          <div style={{display:'flex',gap:20,flexShrink:0}}>
                            <StatPill label="Feed" val={stats.totalFeed>0?Math.round(stats.totalFeed).toLocaleString()+' lbs':'\u2014'}/>
                            <StatPill label="Mort." val={stats.totalMort||'0'}/>
                            <StatPill label="Dozens" val={stats.totalEggs>0?Math.floor(stats.totalEggs/12).toLocaleString():'\u2014'}/>
                            {(()=>{const fc=computeLayerFeedCost(stats.starterFeed,stats.growerFeed,stats.layerFeed,batch);return <StatPill label="Cost" val={fc!=null?'$'+fc.toLocaleString(undefined,{minimumFractionDigits:0,maximumFractionDigits:0}):'\u2014'}/>;})()}
                          </div>
                        </div>
                      );
                    })}
                  </>
                )}
              </div>
            )}
          </>
        )}

        {/* BATCH DETAIL */}
        {selectedBatchId&&selectedBatch&&(
          <>
            <div style={{display:'flex',alignItems:'center',gap:12,marginBottom:16}}>
              <button onClick={()=>setSelectedBatchId(null)} style={{padding:'6px 12px',borderRadius:7,border:'1px solid #d1d5db',background:'white',fontSize:12,cursor:'pointer',fontFamily:'inherit'}}>← Back</button>
              <div style={{fontSize:18,fontWeight:700,color:'#111827'}}>{selectedBatch.name}</div>
              <span style={{fontSize:10,fontWeight:700,padding:'2px 8px',borderRadius:10,background:selectedBatch.status==='active'?'#d1fae5':'#f3f4f6',color:selectedBatch.status==='active'?'#065f46':'#6b7280',textTransform:'uppercase'}}>{selectedBatch.name==='Retirement Home'?'Permanent':selectedBatch.status}</span>
              <button onClick={()=>{setBForm({...EMPTY_BATCH,...selectedBatch,original_count:selectedBatch.original_count||'',cost_per_bird:selectedBatch.cost_per_bird||'',per_lb_starter_cost:selectedBatch.per_lb_starter_cost||'',per_lb_grower_cost:selectedBatch.per_lb_grower_cost||'',per_lb_layer_cost:selectedBatch.per_lb_layer_cost||''});setEditBatchId(selectedBatch.id);setShowBatchForm(true);}} style={{marginLeft:'auto',padding:'6px 14px',borderRadius:7,border:'1px solid #d1d5db',background:'white',fontSize:12,cursor:'pointer',fontFamily:'inherit'}}>Edit Batch</button>
            </div>

            {/* Batch summary stats */}
            {(()=>{
              const isRetHome=selectedBatch.name==='Retirement Home';
              let s;
              if(isRetHome){
                // Rolling window stats computed from raw data
                const cutoff=new Date();
                cutoff.setDate(cutoff.getDate()-retHomePeriod);
                const cutoffStr=cutoff.toISOString().split('T')[0];
                const windowReports=rawLayerDailys.filter(d=>d.batch_id===selectedBatch.id&&d.date>=cutoffStr);
                const anchor=selectedBatch.brooder_entry_date||selectedBatch.arrival_date||null;
                let totalFeed=0,totalMort=0,starterFeed=0,growerFeed=0,layerFeed=0;
                windowReports.forEach(d=>{
                  const f=parseFloat(d.feed_lbs)||0;
                  totalFeed+=f;
                  totalMort+=parseInt(d.mortality_count)||0;
                  // Phase calc (all Retirement Home is LAYER since no anchor, but be safe)
                  if(!anchor) layerFeed+=f;
                  else{
                    try{const days=Math.floor((new Date(d.date+'T12:00:00')-new Date(anchor+'T12:00:00'))/86400000);
                    if(days<21)starterFeed+=f;else if(days<140)growerFeed+=f;else layerFeed+=f;}
                    catch(e){layerFeed+=f;}
                  }
                });
                // Eggs from egg_dailys for the window — approximate from batchStats proportion
                // (egg_dailys aren't in rawLayerDailys, but batchStats has lifetime eggs)
                // For simplicity, use the housing stats approach
                const bHousings=layerHousings.filter(h=>h.batch_id===selectedBatch.id);
                const hNames=new Set(bHousings.map(h=>h.housing_name));
                s={totalFeed,totalMort,starterFeed,growerFeed,layerFeed,totalEggs:(batchStats[selectedBatch.id]||{}).totalEggs||0,isWindowed:true};
              } else {
                s=batchStats[selectedBatch.id]||{};
              }
              const feedCost=computeLayerFeedCost(s.starterFeed,s.growerFeed,s.layerFeed,selectedBatch);
              const totalDozens=s.totalEggs>0?(s.totalEggs/12):0;
              const costPerDoz=(feedCost!=null&&totalDozens>0)?(feedCost/totalDozens):null;
              const fmt$=v=>'$'+v.toLocaleString(undefined,{minimumFractionDigits:2,maximumFractionDigits:2});
              const periodLabel=isRetHome?{30:'Last 30 Days',90:'Last 90 Days',180:'Last 6 Months'}[retHomePeriod]:'Lifetime';
              return(
              <div>
                {isRetHome&&(
                  <div style={{display:'flex',gap:0,marginBottom:12,borderRadius:8,overflow:'hidden',border:'1px solid #d1d5db',width:'fit-content'}}>
                    {[{v:30,l:'30 Days'},{v:90,l:'90 Days'},{v:180,l:'6 Months'}].map(({v,l})=>(
                      <button key={v} onClick={()=>setRetHomePeriod(v)} style={{padding:'7px 16px',border:'none',fontFamily:'inherit',fontSize:12,fontWeight:600,cursor:'pointer',background:retHomePeriod===v?'#085041':'white',color:retHomePeriod===v?'white':'#6b7280'}}>{l}</button>
                    ))}
                  </div>
                )}
                <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(110px,1fr))',gap:10,marginBottom:20}}>
                  {[['Total Feed'+(isRetHome?' ('+periodLabel+')':''),s.totalFeed>0?Math.round(s.totalFeed).toLocaleString()+' lbs':'\u2014','#92400e'],
                    ...(isRetHome?[]:[['Starter Feed',s.starterFeed>0?Math.round(s.starterFeed).toLocaleString()+' lbs':'\u2014',s.starterFeed>=1400?'#b91c1c':'#1e40af']]),
                    ...(isRetHome?[]:[['Grower Feed',s.growerFeed>0?Math.round(s.growerFeed).toLocaleString()+' lbs':'\u2014','#065f46']]),
                    ['Layer Feed',s.layerFeed>0?Math.round(s.layerFeed).toLocaleString()+' lbs':'\u2014','#78350f'],
                    ['Mortality'+(isRetHome?' ('+periodLabel+')':''),s.totalMort||'0',s.totalMort>10?'#b91c1c':'#374151'],
                    ...(isRetHome?[]:[['Total Dozens',s.totalEggs>0?Math.floor(s.totalEggs/12).toLocaleString():'\u2014','#065f46']]),
                    ...(isRetHome?[]:[['Feed Cost',feedCost!=null?fmt$(feedCost):'\u2014','#92400e']]),
                    ...(isRetHome?[]:[['Cost / Dozen',costPerDoz!=null?fmt$(costPerDoz):'\u2014','#065f46']]),
                  ].map(([l,v,c])=>(
                    <div key={l} style={{background:'white',border:'1px solid #e5e7eb',borderRadius:10,padding:'12px 14px',textAlign:'center'}}>
                      <div style={{fontSize:10,color:'#6b7280',marginBottom:4,textTransform:'uppercase',letterSpacing:.5}}>{l}</div>
                      <div style={{fontSize:18,fontWeight:700,color:c||'#111827'}}>{v}</div>
                    </div>
                  ))}
                </div>
              </div>
              );
            })()}

            {/* PERFORMANCE SUMMARY (lifetime/derived metrics) — hidden for Retirement Home */}
            {selectedBatch.name!=='Retirement Home'&&(()=>{
              const s=batchStats[selectedBatch.id]||{};
              const bHousings=layerHousings.filter(h=>h.batch_id===selectedBatch.id);
              const orig=parseInt(selectedBatch.original_count)||0;
              const currentHens=bHousings.reduce((sum,h)=>sum+(parseInt(h.current_count)||0),0);
              // End date for time-based metrics: today if active, latest housing retired_date if retired
              const todayISOstr=new Date().toISOString().split('T')[0];
              let endDate=todayISOstr;
              if(selectedBatch.status==='retired'){
                const ret=bHousings.map(h=>h.retired_date).filter(Boolean).sort();
                endDate=ret.length>0?ret[ret.length-1]:(selectedBatch.schooner_exit_date||todayISOstr);
              }
              // Batch age = today - brooder_entry_date (total time on farm)
              const anchor=selectedBatch.brooder_entry_date||selectedBatch.arrival_date||null;
              const batchAgeDays=anchor?Math.max(0,Math.round((new Date(endDate+'T12:00:00')-new Date(anchor+'T12:00:00'))/86400000)):0;
              const batchAgeMonths=+(batchAgeDays/30.44).toFixed(1);
              const batchAgeStr=batchAgeDays>0?`${batchAgeMonths} months (${batchAgeDays} days)`:'\u2014';
              // Days in housing phase = endDate - first housing start_date
              const firstHousingStart=bHousings.length>0?bHousings.map(h=>h.start_date).filter(Boolean).sort()[0]:null;
              const daysInHousing=firstHousingStart?Math.max(0,Math.round((new Date(endDate+'T12:00:00')-new Date(firstHousingStart+'T12:00:00'))/86400000)):0;
              // Metric computations
              const eggsPerHen=orig>0?s.totalEggs/orig:null;
              const eggsPerHenPerDay=(currentHens>0&&daysInHousing>0)?s.totalEggs/(currentHens*daysInHousing):null;
              const feedPerHen=orig>0?s.totalFeed/orig:null;
              const totalDozens=(s.totalEggs||0)/12;
              const feedPerDozen=totalDozens>0?s.totalFeed/totalDozens:null;
              const feedCost=computeLayerFeedCost(s.starterFeed,s.growerFeed,s.layerFeed,selectedBatch);
              const costPerDoz=totalDozens>0&&feedCost!=null?feedCost/totalDozens:null;
              const costPerHen=(feedCost!=null&&orig>0)?feedCost/orig:null;
              const fmt$=v=>'$'+v.toLocaleString(undefined,{minimumFractionDigits:2,maximumFractionDigits:2});
              const tiles=[
                {l:'Batch Age',v:batchAgeStr,c:'#78350f'},
                {l:'Days in Housing',v:daysInHousing>0?daysInHousing+' days':'\u2014',c:'#374151'},
                {l:'Original \u2192 Current',v:orig>0?(orig.toLocaleString()+' \u2192 '+currentHens.toLocaleString()):'\u2014',c:'#78350f'},
                {l:'Dozens / Hen (lifetime)',v:eggsPerHen!=null?(eggsPerHen/12).toFixed(1)+' doz':'\u2014',c:'#78350f'},
                {l:'Eggs / Hen / Day (housing)',v:eggsPerHenPerDay!=null?eggsPerHenPerDay.toFixed(3):'\u2014',c:eggsPerHenPerDay!=null&&eggsPerHenPerDay>=0.7?'#065f46':'#b45309'},
                {l:'Feed / Hen (lifetime)',v:feedPerHen!=null?feedPerHen.toFixed(1)+' lbs':'\u2014',c:'#92400e'},
                {l:'Feed / Dozen (lifetime)',v:feedPerDozen!=null?feedPerDozen.toFixed(2)+' lbs':'\u2014',c:'#92400e'},
                {l:'Cost / Dozen (lifetime)',v:costPerDoz!=null?fmt$(costPerDoz):'\u2014',c:'#065f46'},
                {l:'Cost / Hen (lifetime)',v:costPerHen!=null?fmt$(costPerHen):'\u2014',c:'#065f46'},
              ];
              return (
                <div style={{background:'white',border:'1px solid #e5e7eb',borderRadius:12,padding:'16px 20px',marginBottom:16}}>
                  <div style={{fontSize:12,fontWeight:700,color:'#4b5563',letterSpacing:.5,marginBottom:12}}>PERFORMANCE SUMMARY</div>
                  <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(140px,1fr))',gap:10}}>
                    {tiles.map(t=>(
                      <div key={t.l} style={{background:'#f9fafb',border:'1px solid #e5e7eb',borderRadius:10,padding:'12px 14px',textAlign:'center'}}>
                        <div style={{fontSize:10,color:'#6b7280',marginBottom:4,textTransform:'uppercase',letterSpacing:.5}}>{t.l}</div>
                        <div style={{fontSize:17,fontWeight:700,color:t.c||'#111827'}}>{t.v}</div>
                      </div>
                    ))}
                  </div>
                </div>
              );
            })()}

            {/* Phase timeline — not shown for Retirement Home */}
            {selectedBatch.name!=='Retirement Home'&&(
              <div style={{background:'white',border:'1px solid #e5e7eb',borderRadius:12,padding:'16px 20px',marginBottom:16}}>
                <div style={{fontSize:12,fontWeight:700,color:'#4b5563',letterSpacing:.5,marginBottom:12}}>LIFECYCLE PHASES</div>
                <div style={{display:'flex',gap:0,alignItems:'stretch'}}>
                  {[
                    {label:'Brooder',icon:'🔆',name:selectedBatch.brooder_name,entry:selectedBatch.brooder_entry_date,exit:selectedBatch.brooder_exit_date,color:'#dbeafe',border:'#93c5fd',text:'#1e40af'},
                    {label:'Schooner',icon:'🚌',name:selectedBatch.schooner_name,entry:selectedBatch.schooner_entry_date,exit:selectedBatch.schooner_exit_date,color:'#d1fae5',border:'#6ee7b7',text:'#065f46'},
                    {label:'Housing',icon:'🏠',name:batchHousings.filter(h=>h.status==='active').map(h=>h.housing_name).join(', ')||'—',entry:batchHousings[0]?.start_date,exit:null,color:'#fef3c7',border:'#fde68a',text:'#92400e'},
                  ].map((phase,i)=>(
                    <React.Fragment key={phase.label}>
                      <div style={{flex:1,background:phase.color,borderWidth:1,borderStyle:'solid',borderColor:phase.border,borderRadius:i===0?'8px 0 0 8px':i===2?'0 8px 8px 0':'0',padding:'10px 14px'}}>
                        <div style={{fontSize:10,fontWeight:700,color:phase.text,letterSpacing:.5,marginBottom:4}}>{phase.icon} {phase.label.toUpperCase()}</div>
                        <div style={{fontSize:12,fontWeight:600,color:'#111827',marginBottom:4}}>{phase.name||<span style={{color:'#9ca3af'}}>Not set</span>}</div>
                        <div style={{fontSize:10,color:'#6b7280'}}>{phase.entry?fmt(phase.entry):'—'}{phase.exit?' \u2192 '+fmt(phase.exit):' \u2192 present'}</div>
                      </div>
                      {i<2&&<div style={{width:20,display:'flex',alignItems:'center',justifyContent:'center',fontSize:14,color:'#9ca3af',flexShrink:0}}>→</div>}
                    </React.Fragment>
                  ))}
                </div>
              </div>
            )}

            {/* Housings */}
            <div style={{marginBottom:16}}>
              <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:10}}>
                <div style={{fontSize:12,fontWeight:700,color:'#4b5563',letterSpacing:.5}}>HOUSINGS</div>
                {selectedBatch.status==='active'&&<button onClick={()=>{setHForm(EMPTY_HOUSING);setEditHousingId(null);setShowHousingForm(true);}} style={{padding:'5px 14px',borderRadius:7,border:'none',background:'#085041',color:'white',fontSize:11,fontWeight:600,cursor:'pointer'}}>+ Add Housing</button>}
              </div>
              {batchHousings.length===0&&<div style={{color:'#9ca3af',fontSize:13,padding:'1rem 0'}}>No housings yet.</div>}
              <div style={{display:'flex',flexDirection:'column',gap:8}}>
                {batchHousings.map(h=>{
                  const hs=housingStats[h.id]||{};
                  const cap=getHousingCap(h.housing_name);
                  const util=h.current_count&&cap?Math.round((h.current_count/cap)*100):null;
                  // Projected count: anchor minus mortalities since current_count_date
                  const proj = computeProjectedCount(h, rawLayerDailys);
                  return (
                    <div key={h.id} style={{background:'white',border:h.status==='active'?'1px solid #fde68a':'1px solid #e5e7eb',borderRadius:10,padding:'14px 18px',display:'flex',gap:16,alignItems:'center'}}>
                      <div style={{flex:1}}>
                        <div style={{display:'flex',alignItems:'center',gap:8,marginBottom:6}}>
                          <span style={{fontSize:13,fontWeight:700,color:'#111827'}}>{'\ud83c\udfe0 '+h.housing_name}</span>
                          <span style={{fontSize:10,fontWeight:700,padding:'2px 7px',borderRadius:8,background:h.status==='active'?'#d1fae5':'#f3f4f6',color:h.status==='active'?'#065f46':'#6b7280',textTransform:'uppercase'}}>{h.status}</span>
                          {h.start_date&&<span style={{fontSize:11,color:'#6b7280'}}>from {fmt(h.start_date)}</span>}
                          {h.retired_date&&<span style={{fontSize:11,color:'#9ca3af'}}>{'\u2192 '+fmt(h.retired_date)}</span>}
                        </div>
                        <div style={{display:'flex',gap:16,fontSize:11,color:'#6b7280',flexWrap:'wrap'}}>
                          <span>Physical: <strong style={{color:'#374151'}}>{h.current_count!=null?h.current_count:'\u2014'}</strong>{h.current_count_date?<span style={{color:'#9ca3af',fontWeight:400}}>{' on '+fmt(h.current_count_date)}</span>:null}</span>
                          {proj && proj.anchorDate && proj.mortSince>0 && (
                            <span title={'Anchor '+proj.anchor+' on '+fmt(proj.anchorDate)+' minus '+proj.mortSince+' mortalities since'}>
                              Projected: <strong style={{color:proj.projected<proj.anchor*0.9?'#b91c1c':'#92400e'}}>{proj.projected}</strong>
                              <span style={{color:'#9ca3af',fontWeight:400}}>{' (\u2212'+proj.mortSince+')'}</span>
                            </span>
                          )}
                          <span>Capacity: <strong style={{color:'#374151'}}>{cap===9999?'Unlimited':cap}</strong></span>
                          {util!==null&&<span>Utilization: <strong style={{color:util>95?'#b91c1c':util>80?'#92400e':'#065f46'}}>{util+'%'}</strong></span>}
                        </div>
                      </div>
                      <div style={{display:'flex',gap:16,flexShrink:0}}>
                        <StatPill label="Total Feed" val={hs.totalFeed>0?Math.round(hs.totalFeed)+' lbs':'\u2014'} color="#92400e"/>
                        {selectedBatch&&selectedBatch.name!=='Retirement Home'&&<StatPill label="Starter" val={hs.starterFeed>0?Math.round(hs.starterFeed)+' lbs':'\u2014'} color="#1e40af"/>}
                        {selectedBatch&&selectedBatch.name!=='Retirement Home'&&<StatPill label="Grower" val={hs.growerFeed>0?Math.round(hs.growerFeed)+' lbs':'\u2014'} color="#065f46"/>}
                        <StatPill label="Layer" val={hs.layerFeed>0?Math.round(hs.layerFeed)+' lbs':'\u2014'} color="#78350f"/>
                        <StatPill label="Mort." val={hs.totalMort||'0'} color={hs.totalMort>5?'#b91c1c':'#374151'}/>
                        <StatPill label="Eggs" val={hs.totalEggs>0?hs.totalEggs.toLocaleString():'\u2014'} color="#78350f"/>
                      </div>
                      <div style={{display:'flex',gap:6,flexShrink:0}}>
                        <button onClick={()=>{setHForm({...EMPTY_HOUSING,...h,current_count:h.current_count!=null?h.current_count:''});setEditHousingId(h.id);setShowHousingForm(true);}} style={{padding:'5px 10px',borderRadius:6,border:'1px solid #d1d5db',background:'white',fontSize:11,cursor:'pointer',fontFamily:'inherit'}}>Edit</button>
                        {h.status==='active'&&<button onClick={()=>{if(confirm('Retire '+h.housing_name+'?'))retireHousing(h);}} style={{padding:'5px 10px',borderRadius:6,border:'1px solid #fca5a5',background:'#fef2f2',color:'#b91c1c',fontSize:11,cursor:'pointer',fontFamily:'inherit'}}>Retire</button>}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Batch notes */}
            {selectedBatch.notes&&<div style={{background:'white',border:'1px solid #e5e7eb',borderRadius:10,padding:'12px 16px',fontSize:12,color:'#374151'}}><span style={{color:'#9ca3af'}}>Notes: </span>{selectedBatch.notes}</div>}
          </>
        )}

        {/* BATCH FORM MODAL */}
        {showBatchForm&&(
          <div onClick={closeBatchForm} style={{position:'fixed',top:0,left:0,right:0,bottom:0,background:'rgba(0,0,0,.45)',zIndex:500,display:'flex',alignItems:'flex-start',justifyContent:'center',padding:'1rem',overflowY:'auto'}}>
            <div onClick={e=>e.stopPropagation()} style={{background:'white',borderRadius:12,width:'100%',maxWidth:540,boxShadow:'0 8px 32px rgba(0,0,0,.2)',marginTop:40}}>
              <div style={{padding:'14px 20px',borderBottom:'1px solid #e5e7eb',display:'flex',justifyContent:'space-between',alignItems:'center'}}>
                <div style={{fontSize:15,fontWeight:600,color:'#78350f'}}>{editBatchId?'Edit Layer Batch':'New Layer Batch'} <span style={{fontSize:11,color:'#9ca3af',fontWeight:400,marginLeft:6}}>Auto-saves as you type</span></div>
                <div style={{display:'flex',alignItems:'center',gap:10}}>
                  {batchSaving?<span style={{fontSize:11,color:'#9ca3af'}}>{'Saving\u2026'}</span>:batchPending?<span style={{fontSize:11,color:'#9ca3af'}}>{'Unsaved\u2026'}</span>:editBatchId?<span style={{fontSize:11,color:'#065f46'}}>{'\u2713 Saved'}</span>:null}
                  <button onClick={closeBatchForm} style={{background:'none',border:'none',fontSize:22,cursor:'pointer',color:'#9ca3af'}}>{'\u00d7'}</button>
                </div>
              </div>
              <div style={{padding:'16px 20px',display:'grid',gridTemplateColumns:'1fr 1fr',gap:10,maxHeight:'70vh',overflowY:'auto'}}>
                <div style={{gridColumn:'1/-1'}}><label style={S.label}>Batch Name *</label><input value={bForm.name} onChange={e=>updBatch(f=>({...f,name:e.target.value}))} placeholder="e.g. L-26-01"/></div>
                <div><label style={S.label}>Status</label><select value={bForm.status} onChange={e=>updBatch(f=>({...f,status:e.target.value}))}><option value="active">Active</option><option value="retired">Retired</option></select></div>
                {bForm.name!=='Retirement Home'&&<div><label style={S.label}>Original Count</label><input type="number" min="0" value={bForm.original_count||''} onChange={e=>updBatch(f=>({...f,original_count:e.target.value}))}/></div>}
                {bForm.name!=='Retirement Home'&&<div><label style={S.label}>Supplier</label><input value={bForm.supplier} onChange={e=>updBatch(f=>({...f,supplier:e.target.value}))}/></div>}
                {bForm.name!=='Retirement Home'&&<div style={{gridColumn:'1/-1'}}><label style={S.label}>Cost per Bird ($)</label><input type="number" min="0" step="0.01" style={{maxWidth:160}} value={bForm.cost_per_bird||''} onChange={e=>updBatch(f=>({...f,cost_per_bird:e.target.value}))}/></div>}

                {/* FEED COST RATES (read-only — populated from global rates set in Admin → Feed Costs) */}
                {bForm.name!=='Retirement Home'&&<div style={{gridColumn:'1/-1',borderTop:'1px solid #e5e7eb',paddingTop:10,marginTop:4}}>
                  <div style={{fontSize:11,fontWeight:700,color:'#4b5563',letterSpacing:.5,marginBottom:6}}>{'\ud83d\udcb0 FEED COST RATES'} <span style={{fontWeight:400,color:'#9ca3af'}}>{'(locked \u2014 set in Admin \u203a Feed Costs)'}</span></div>
                  <div style={{display:'flex',gap:16,fontSize:12,color:'#374151',padding:'8px 12px',background:'#f9fafb',borderRadius:8,border:'1px solid #e5e7eb'}}>
                    <span>Starter: <strong>{bForm.per_lb_starter_cost!==''&&bForm.per_lb_starter_cost!=null?'$'+parseFloat(bForm.per_lb_starter_cost).toFixed(3)+'/lb':'\u2014'}</strong></span>
                    <span>Grower: <strong>{bForm.per_lb_grower_cost!==''&&bForm.per_lb_grower_cost!=null?'$'+parseFloat(bForm.per_lb_grower_cost).toFixed(3)+'/lb':'\u2014'}</strong></span>
                    <span>Layer: <strong>{bForm.per_lb_layer_cost!==''&&bForm.per_lb_layer_cost!=null?'$'+parseFloat(bForm.per_lb_layer_cost).toFixed(3)+'/lb':'\u2014'}</strong></span>
                  </div>
                </div>}

                {/* BROODER PHASE */}
                {bForm.name!=='Retirement Home'&&<div style={{gridColumn:'1/-1',borderTop:'1px solid #e5e7eb',paddingTop:10,marginTop:4,fontSize:11,fontWeight:700,color:'#4b5563',letterSpacing:.5}}>🔆 BROODER PHASE <span style={{fontWeight:400,color:'#9ca3af'}}>(fixed 3 weeks)</span></div>}
                {bForm.name!=='Retirement Home'&&<div style={{gridColumn:'1/-1'}}>
                  <label style={S.label}>Brooder</label>
                  <select value={bForm.brooder_name} onChange={e=>{
                    const val=e.target.value;
                    const entry=bForm.brooder_entry_date;
                    const exit=entry?toISO(addDays(new Date(entry+'T12:00:00'),21)):bForm.brooder_exit_date;
                    const schoonerIn=exit||bForm.schooner_entry_date;
                    const schoonerOut=schoonerIn?toISO(addDays(new Date(schoonerIn+'T12:00:00'),119)):bForm.schooner_exit_date;
                    updBatch(f=>({...f,brooder_name:val,brooder_exit_date:exit||f.brooder_exit_date,schooner_entry_date:schoonerIn||f.schooner_entry_date,schooner_exit_date:schoonerOut||f.schooner_exit_date}));
                  }}>
                    <option value="">Select brooder…</option>
                    {BROODERS.map(b=>{
                      // Check conflicts with broiler batches
                      const entry=bForm.brooder_entry_date;
                      const exit=entry?toISO(addDays(new Date(entry+'T12:00:00'),21+BROODER_CLEANOUT)):null;
                      const conflictBroiler=entry&&exit&&batches.filter(bt=>bt.brooder===b&&bt.id!==editBatchId).some(bt=>{
                        const exEnd=toISO(addDays(new Date((bt.brooderOut||bt.brooder_exit_date||entry)+'T12:00:00'),BROODER_CLEANOUT));
                        return overlaps(entry,exit,bt.brooderIn||bt.brooder_entry_date||'',exEnd);
                      });
                      const conflictLayer=entry&&exit&&layerBatches.filter(lb=>lb.brooder_name===b&&lb.id!==editBatchId&&lb.brooder_entry_date).some(lb=>{
                        const lbExit=lb.brooder_exit_date||toISO(addDays(new Date(lb.brooder_entry_date+'T12:00:00'),21+BROODER_CLEANOUT));
                        return overlaps(entry,exit,lb.brooder_entry_date,lbExit);
                      });
                      const conflict=conflictBroiler||conflictLayer;
                      return <option key={b} value={'Brooder '+b} disabled={conflict} style={{color:conflict?'#9ca3af':'inherit'}}>{'Brooder '+b+(conflict?' ⚠ In use':'')}</option>;
                    })}
                  </select>
                </div>}
                {bForm.name!=='Retirement Home'&&<div>
                  <label style={S.label}>Date in Brooder</label>
                  <input type="date" value={bForm.brooder_entry_date} onChange={e=>{
                    const entry=e.target.value;
                    const exit=entry?toISO(addDays(new Date(entry+'T12:00:00'),21)):'';
                    const schoonerOut=exit?toISO(addDays(new Date(exit+'T12:00:00'),119)):'';
                    updBatch(f=>({...f,brooder_entry_date:entry,brooder_exit_date:exit,schooner_entry_date:exit,schooner_exit_date:schoonerOut,arrival_date:entry||f.arrival_date}));
                  }}/>
                </div>}
                {bForm.name!=='Retirement Home'&&<div>
                  <label style={S.label}>Exit Date <span style={{color:'#9ca3af',fontWeight:400}}>(auto)</span></label>
                  <input type="date" value={bForm.brooder_exit_date} readOnly style={{background:'#f9fafb',color:'#6b7280'}}/>
                </div>}

                {/* SCHOONER PHASE */}
                {bForm.name!=='Retirement Home'&&<div style={{gridColumn:'1/-1',borderTop:'1px solid #e5e7eb',paddingTop:10,marginTop:4,fontSize:11,fontWeight:700,color:'#4b5563',letterSpacing:.5}}>🚌 SCHOONER PHASE <span style={{fontWeight:400,color:'#9ca3af'}}>(3 to 24 weeks)</span></div>}
                {bForm.name!=='Retirement Home'&&<div style={{gridColumn:'1/-1'}}>
                  <label style={S.label}>Schooner</label>
                  <select value={bForm.schooner_name} onChange={e=>updBatch(f=>({...f,schooner_name:e.target.value}))}>
                    <option value="">Select schooner…</option>
                    {SCHOONERS.map(s=>{
                      const entry=bForm.schooner_entry_date;
                      const exit=bForm.schooner_exit_date||( entry?toISO(addDays(new Date(entry+'T12:00:00'),119+SCHOONER_CLEANOUT)):null);
                      const conflictBroiler=entry&&exit&&batches.filter(bt=>bt.schooner===s&&bt.id!==editBatchId).some(bt=>{
                        const exEnd=toISO(addDays(new Date((bt.schoonerOut||bt.schooner_exit_date||entry)+'T12:00:00'),SCHOONER_CLEANOUT));
                        return overlaps(entry,exit,bt.schoonerIn||bt.schooner_entry_date||'',exEnd);
                      });
                      const conflictLayer=entry&&exit&&layerBatches.filter(lb=>lb.schooner_name===('Schooner '+s)&&lb.id!==editBatchId&&lb.schooner_entry_date).some(lb=>{
                        const lbExit=lb.schooner_exit_date||toISO(addDays(new Date(lb.schooner_entry_date+'T12:00:00'),119+SCHOONER_CLEANOUT));
                        return overlaps(entry,exit,lb.schooner_entry_date,lbExit);
                      });
                      const conflict=conflictBroiler||conflictLayer;
                      return <option key={s} value={'Schooner '+s} disabled={conflict} style={{color:conflict?'#9ca3af':'inherit'}}>{'Schooner '+s+(conflict?' ⚠ In use':'')}</option>;
                    })}
                  </select>
                </div>}
                {bForm.name!=='Retirement Home'&&<div>
                  <label style={S.label}>Entry Date <span style={{color:'#9ca3af',fontWeight:400}}>(auto)</span></label>
                  <input type="date" value={bForm.schooner_entry_date} onChange={e=>{
                    const entry=e.target.value;
                    const exit=entry?toISO(addDays(new Date(entry+'T12:00:00'),119)):'';
                    updBatch(f=>({...f,schooner_entry_date:entry,schooner_exit_date:exit}));
                  }}/>
                </div>}
                {bForm.name!=='Retirement Home'&&<div>
                  <label style={S.label}>Exit Date <span style={{color:'#9ca3af',fontWeight:400}}>(editable)</span></label>
                  <input type="date" value={bForm.schooner_exit_date} onChange={e=>updBatch(f=>({...f,schooner_exit_date:e.target.value}))}/>
                </div>}
                {bForm.name!=='Retirement Home'&&bForm.schooner_entry_date&&bForm.schooner_exit_date&&(()=>{
                  const weeks=Math.round((new Date(bForm.schooner_exit_date+'T12:00:00')-new Date(bForm.schooner_entry_date+'T12:00:00'))/604800000);
                  const warn=weeks<3||weeks>24;
                  return <div style={{gridColumn:'1/-1',fontSize:11,padding:'4px 8px',borderRadius:5,background:warn?'#fef2f2':'#ecfdf5',color:warn?'#b91c1c':'#065f46',fontWeight:600}}>{warn?'\u26a0 ':''}{weeks} weeks in schooner {warn?'(expected 3 to 24 weeks)':'\u2713'}</div>;
                })()}

                <div style={{gridColumn:'1/-1',borderTop:'1px solid #e5e7eb',paddingTop:10,marginTop:4}}><label style={S.label}>Notes</label><textarea value={bForm.notes} onChange={e=>updBatch(f=>({...f,notes:e.target.value}))} rows={2} style={{resize:'vertical'}}/></div>
                {err&&<div style={{gridColumn:'1/-1',color:'#b91c1c',fontSize:12,fontWeight:600}}>{err}</div>}
              </div>
              {editBatchId&&bForm.name!=='Retirement Home'&&<div style={{padding:'12px 20px',borderTop:'1px solid #e5e7eb'}}>
                <button onClick={function(){confirmDelete('Delete batch '+bForm.name+'? This will also delete all its housings. This cannot be undone.',function(){clearTimeout(batchAutoSaveTimer.current);sb.from('layer_housings').delete().eq('batch_id',editBatchId).then(function(){setLayerHousings(function(prev){return prev.filter(function(h){return h.batch_id!==editBatchId;});});});sb.from('layer_batches').delete().eq('id',editBatchId).then(function(){setLayerBatches(function(prev){return prev.filter(function(b){return b.id!==editBatchId;});});});setShowBatchForm(false);setEditBatchId(null);setBForm(EMPTY_BATCH);setSelectedBatchId(null);});}} style={S.btnDanger}>Delete Batch</button>
              </div>}
            </div>
          </div>
        )}

        {/* HOUSING FORM MODAL */}
        {showHousingForm&&(
          <div onClick={closeHousingForm} style={{position:'fixed',top:0,left:0,right:0,bottom:0,background:'rgba(0,0,0,.45)',zIndex:500,display:'flex',alignItems:'flex-start',justifyContent:'center',padding:'1rem',overflowY:'auto'}}>
            <div onClick={e=>e.stopPropagation()} style={{background:'white',borderRadius:12,width:'100%',maxWidth:440,boxShadow:'0 8px 32px rgba(0,0,0,.2)',marginTop:40}}>
              <div style={{padding:'14px 20px',borderBottom:'1px solid #e5e7eb',display:'flex',justifyContent:'space-between',alignItems:'center'}}>
                <div style={{fontSize:15,fontWeight:600,color:'#78350f'}}>{editHousingId?'Edit Housing':'Add Housing'}</div>
                <div style={{display:'flex',alignItems:'center',gap:10}}>
                  {housingSaving?<span style={{fontSize:11,color:'#9ca3af'}}>{'Saving\u2026'}</span>:housingPending?<span style={{fontSize:11,color:'#9ca3af'}}>{'Unsaved\u2026'}</span>:editHousingId?<span style={{fontSize:11,color:'#065f46'}}>{'\u2713 Saved'}</span>:null}
                  <button onClick={closeHousingForm} style={{background:'none',border:'none',fontSize:22,cursor:'pointer',color:'#9ca3af'}}>{'\u00d7'}</button>
                </div>
              </div>
              <div style={{padding:'16px 20px',display:'grid',gridTemplateColumns:'1fr 1fr',gap:10,maxHeight:'65vh',overflowY:'auto'}}>
                <div style={{gridColumn:'1/-1'}}>
                  <label style={S.label}>Housing (Layer Group) *</label>
                  <select value={hForm.housing_name} onChange={e=>updHousing(f=>({...f,housing_name:e.target.value}))}>
                    <option value="">{'Select housing\u2026'}</option>
                    {layerGroups.map(g=>{
                      const isRetiredBatch=selectedBatch&&selectedBatch.status==='retired';
                      const locked=!isRetiredBatch&&lockedHousings.has(g.name)&&!(editHousingId&&layerHousings.find(h=>h.id===editHousingId)?.housing_name===g.name);
                      const owningHousing=layerHousings.find(h=>h.housing_name===g.name&&h.status==='active');
                      const owningBatch=owningHousing?layerBatches.find(b=>b.id===owningHousing.batch_id):null;
                      const label=g.name+(locked?' \u26a0 In use'+(owningBatch?' by '+owningBatch.name:''):'');
                      return <option key={g.id} value={g.name} disabled={locked}>{label}</option>;
                    })}
                  </select>
                  {hForm.housing_name&&(()=>{
                    const owningH=layerHousings.find(h=>h.housing_name===hForm.housing_name&&h.status==='active');
                    const owningB=owningH?layerBatches.find(b=>b.id===owningH.batch_id):null;
                    if(!owningB) return null;
                    return <div style={{marginTop:6,fontSize:11,color:'#1d4ed8',background:'#eff6ff',border:'1px solid #bfdbfe',borderRadius:6,padding:'5px 10px'}}>Currently active in: <strong>{owningB.name}</strong></div>;
                  })()}
                </div>
                {hForm.housing_name&&(()=>{const cap=getHousingCap(hForm.housing_name);return cap<9999&&<div style={{gridColumn:'1/-1',fontSize:11,color:'#92400e',background:'#fffbeb',border:'1px solid #fde68a',borderRadius:6,padding:'6px 10px'}}>{'\u26a0 Capacity: '+cap+' birds max'}</div>;})()}
                <div style={{gridColumn:'1/-1'}}>
                  <label style={S.label}>Current Count</label>
                  <input type="number" min="0" value={hForm.current_count||''} onChange={e=>updHousing(f=>({...f,current_count:e.target.value}))}/>
                  {(()=>{
                    // Date hint: show below field when current count value differs from existing stored value
                    if(!editHousingId) return hForm.current_count!==''?<div style={{fontSize:10,color:'#065f46',marginTop:4}}>{'Will be stamped: '+fmt(todayStr())}</div>:null;
                    const existing = layerHousings.find(h=>h.id===editHousingId);
                    const oldVal = existing?.current_count;
                    const newVal = hForm.current_count!==''?parseInt(hForm.current_count):null;
                    const oldNorm = oldVal==null?null:parseInt(oldVal);
                    if(newVal !== oldNorm){
                      return <div style={{fontSize:10,color:'#065f46',marginTop:4,fontWeight:600}}>{'Will be stamped: '+fmt(todayStr())}</div>;
                    }
                    if(existing?.current_count_date){
                      return <div style={{fontSize:10,color:'#9ca3af',marginTop:4}}>{'Last set: '+fmt(existing.current_count_date)}</div>;
                    }
                    return null;
                  })()}
                </div>
                <div><label style={S.label}>Start Date</label><input type="date" value={hForm.start_date} onChange={e=>updHousing(f=>({...f,start_date:e.target.value}))}/></div>
                <div><label style={S.label}>Status</label><select value={hForm.status} onChange={e=>updHousing(f=>({...f,status:e.target.value}))}><option value="active">Active</option><option value="retired">Retired</option></select></div>
                {hForm.status==='retired'&&<div style={{gridColumn:'1/-1'}}><label style={S.label}>Retired Date</label><input type="date" value={hForm.retired_date} onChange={e=>updHousing(f=>({...f,retired_date:e.target.value}))}/></div>}
                <div style={{gridColumn:'1/-1'}}><label style={S.label}>Notes</label><textarea value={hForm.notes} onChange={e=>updHousing(f=>({...f,notes:e.target.value}))} rows={2} style={{resize:'vertical'}}/></div>
                {err&&<div style={{gridColumn:'1/-1',color:'#b91c1c',fontSize:12,fontWeight:600}}>{err}</div>}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

// Phase 2 Round 3: LayersView moved to C:\Users\Ronni\WCF-planner\src\layer\LayersView.jsx.

// ── LAYER DAILYS VIEW ──
// Phase 2 Round 2: LayerDailysView moved to C:\Users\Ronni\WCF-planner\src\layer\LayerDailysView.jsx.

// ── EGG DAILYS VIEW ──
// Phase 2 Round 2: EggDailysView moved to C:\Users\Ronni\WCF-planner\src\layer\EggDailysView.jsx.

// ── PIG DAILYS VIEW ──
// Phase 2 Round 2: PigDailysView moved to C:\Users\Ronni\WCF-planner\src\pig\PigDailysView.jsx.

// ── CATTLE DAILYS VIEW ─────────────────────────────────────────────────────
// Admin list of cattle_dailys records with filters, edit, delete.
// Parallels PigDailysView / LayerDailysView pattern.
// Phase 2 Round 2: CattleDailysView moved to C:\Users\Ronni\WCF-planner\src\cattle\CattleDailysView.jsx.


// ── CATTLE HOME DASHBOARD ───────────────────────────────────────────────────
// Stats tiles + per-herd live weight / cow units / mortality.
// Phase 2 Round 3: CattleHomeView moved to C:\Users\Ronni\WCF-planner\src\cattle\CattleHomeView.jsx.


// ── CATTLE BULK IMPORT ─────────────────────────────────────────────────────
// Self-serve cattle uploader. User downloads a fixed-shape xlsx template,
// fills it (or has Claude pre-seed it), uploads it back, previews per-row,
// and commits. Per row: inserts a cattle row, plus optional calving record
// (last_calve_date), optional comment (comment), optional receiving weigh-in
// (receiving_weight). Auto-creates new breeds/origins as needed.
// Phase 2 Round 2: CattleBulkImport moved to C:\Users\Ronni\WCF-planner\src\cattle\CattleBulkImport.jsx.


// ── SHEEP BULK IMPORT ──────────────────────────────────────────────────────
// Same shape as CattleBulkImport but adapted to sheep schema (no pct_wagyu,
// flock instead of herd, lambing instead of calving, sex enum is
// ewe/ram/wether). Auto-creates new breeds/origins on commit.
// Phase 2 Round 2: SheepBulkImport moved to C:\Users\Ronni\WCF-planner\src\sheep\SheepBulkImport.jsx.


// ── SHEEP DETAIL PANEL ─────────────────────────────────────────────────────
// Inline expansion under a sheep row. Slimmer than CowDetail — Phase 1 keeps
// the essentials: identity, lineage tags, weight history table, lambing
// history, comments timeline. Charts + nav stack are Phase 2.
// Phase 2 Round 2: SheepDetail moved to C:\Users\Ronni\WCF-planner\src\sheep\SheepDetail.jsx.


// ── SHEEP FLOCKS VIEW ──────────────────────────────────────────────────────
// Mirror of CattleHerdsView with sheep terminology (flock/ewe/ram/wether,
// lambing instead of calving). Phase 1 covers: directory + flat/tile modes,
// add/edit/delete, transfer, inline detail, bulk import.
// Phase 2 Round 3: SheepFlocksView moved to C:\Users\Ronni\WCF-planner\src\sheep\SheepFlocksView.jsx.


// ── SHEEP HOME DASHBOARD ───────────────────────────────────────────────────
// Top stats + per-flock count tiles + rolling-window card with sheep-specific
// MetricsGrid (bales of hay, alfalfa lbs, mineral compliance %, fence
// voltage avg, mortality, report days). Period toggle 30/90/120 days.
// Phase 1 has no nutrition targets, so target % cells are skipped.
// Phase 2 Round 3: SheepHomeView moved to C:\Users\Ronni\WCF-planner\src\sheep\SheepHomeView.jsx.


// ── SHEEP DAILYS VIEW (admin entry) ────────────────────────────────────────
// Add/edit daily reports for sheep. Sheep-specific fields: bales of hay,
// alfalfa lbs, minerals given + % eaten, fence voltage kV, waterers working.
// Phase 2 Round 2: SheepDailysView moved to C:\Users\Ronni\WCF-planner\src\sheep\SheepDailysView.jsx.


// ── SHEEP WEIGH-INS VIEW (admin) ───────────────────────────────────────────
// Session-based weigh-ins on the shared weigh_in_sessions / weigh_ins tables
// with species='sheep'. Phase 1: list sessions, expand to entries, create
// session, add/edit/delete entries. Retag flow deferred to Phase 2.
// Phase 2 Round 2: SheepWeighInsView moved to C:\Users\Ronni\WCF-planner\src\sheep\SheepWeighInsView.jsx.


// ── CATTLE HERDS VIEW (merged with Directory) ──────────────────────────────
// Single tab combining per-herd tiles + global search/filter across all cattle.
// Add/edit/transfer/delete happen here. Cow detail expands inline with weigh
// history, calving history (Mommas), comments timeline.
// Phase 2 Round 3: CattleHerdsView moved to C:\Users\Ronni\WCF-planner\src\cattle\CattleHerdsView.jsx.

// Helper component — outcome (Processed/Deceased/Sold) sections collapsed at bottom of Herds view
// Phase 2 Round 2: CollapsibleOutcomeSections moved to C:\Users\Ronni\WCF-planner\src\cattle\CollapsibleOutcomeSections.jsx.

// Helper component — cow detail body shown when expanded inside the herd tile
// Phase 2 Round 2: CowDetail moved to C:\Users\Ronni\WCF-planner\src\cattle\CowDetail.jsx.


// ── CATTLE BREEDING VIEW ────────────────────────────────────────────────────
// Lists breeding cycles with computed dates, status, outstanding cows.
// Phase 2 Round 3: CattleBreedingView moved to C:\Users\Ronni\WCF-planner\src\cattle\CattleBreedingView.jsx.


// ── CATTLE PROCESSING BATCHES VIEW ─────────────────────────────────────────
// Lists processing batches (C-26-01 etc.) with cow lists and yield data.
// Phase 2 Round 3: CattleBatchesView moved to C:\Users\Ronni\WCF-planner\src\cattle\CattleBatchesView.jsx.


// ── CATTLE WEIGH-INS VIEW ───────────────────────────────────────────────────
// Authenticated review of past weigh-in sessions. Drill into a session to see
// individual entries. Highlights new-tag flags for admin reconciliation.
// Modal that creates a new draft weigh_in_sessions row from inside the admin
// LivestockWeighInsView (broiler + pig only). Mirrors the AdminAddReportModal
// pattern -- no navigate-away. After insert, the parent loadAll-then-expand
// hook drops the user straight into the in-tile grid for that fresh session.
// Phase 2.1.4: AdminNewWeighInModal moved to C:\Users\Ronni\WCF-planner\src\shared\AdminNewWeighInModal.jsx.

// Modal for "Send to Trip" — pick a feeder group + existing trip or create new.
// Totally stateless wrt Supabase; just collects inputs and hands them back.
// Phase 2.1.4: PigSendToTripModal moved to C:\Users\Ronni\WCF-planner\src\livestock\PigSendToTripModal.jsx.

// Modal: start a new cattle weigh-in session inline (no webform nav).
// Phase 2.1.4: CattleNewWeighInModal moved to src/cattle/CattleNewWeighInModal.jsx.



// === END VERBATIM PORT ===

// Render. Reuse-existing-root guard from the old bootstrap (prevented double
// createRoot on Babel cache retry) is no longer needed under Vite — there's
// no eval+retry path that could re-execute this module.
const root = createRoot(document.getElementById('root'));
const breedTlStartInit = () => {
  const d = new Date();
  d.setMonth(d.getMonth() - 2);
  d.setDate(1);
  return toISO(d);
};

root.render(
  <AuthProvider>
    <BatchesProvider formInit={EMPTY_FORM} tlStartInit={thisMonday}>
      <PigProvider
        initialFarrowing={INITIAL_FARROWING}
        initialBreeders={INITIAL_BREEDERS}
        breedTlStartInit={breedTlStartInit}
      >
        <LayerProvider>
          <DailysRecentProvider>
            <CattleHomeProvider>
              <SheepHomeProvider>
                <WebformsConfigProvider configInit={DEFAULT_WEBFORMS_CONFIG}>
                  <FeedCostsProvider>
                    <UIProvider>
                      <App/>
                    </UIProvider>
                  </FeedCostsProvider>
                </WebformsConfigProvider>
              </SheepHomeProvider>
            </CattleHomeProvider>
          </DailysRecentProvider>
        </LayerProvider>
      </PigProvider>
    </BatchesProvider>
  </AuthProvider>
);

// Fade out the static boot loader after React's first paint. Two RAFs to
// ensure the first frame containing real React content is on screen before
// the spinner disappears (matches the original bootstrap's fadeOutLoader).
requestAnimationFrame(() => {
  requestAnimationFrame(() => {
    const loader = document.getElementById('wcf-boot-loader');
    if(loader){
      loader.classList.add('fade-out');
      setTimeout(() => { if(loader.parentNode) loader.parentNode.removeChild(loader); }, 350);
    }
  });
});
