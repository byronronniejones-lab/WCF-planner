// ============================================================================
// src/lib/broiler.js  —  broiler domain helpers + constants
// ----------------------------------------------------------------------------
// Lifted out of main.jsx as prep for Round 6 (inline-JSX view extraction).
// Pure module-scope functions + constants; no React, no App closure state.
// ============================================================================
import { toISO, addDays, todayISO } from './dateUtils.js';
export const BROODER_DAYS = 14;
export const CC_SCHOONER  = 35;
export const WR_SCHOONER  = 42;

const FEED_BIRDS        = 700;                           // target processed count (order 750, expect ~700 to processor)
const STARTER_TOTAL_LBS = 1500;                          // fixed cap per batch for both breeds
const STARTER_PER_BIRD  = STARTER_TOTAL_LBS / FEED_BIRDS; // 2.14 lbs/bird (1500/700)
// Split starter 30/70 across weeks 1-2 (matches chick growth pattern)
const STARTER_W1 = STARTER_PER_BIRD * 0.30;
const STARTER_W2 = STARTER_PER_BIRD * 0.70;

// CC grower weeks 3-7 (5 weeks): derived from WCF historical data (2026-04 analysis)
// CC avg 14.29 lbs/bird at 7 weeks processing (7 data points, combining actual 7w batches +
// 8w batches back-calculated using 26.4% week 7→8 growth rate from Aviagen chart)
const CC_TOTAL_TARGET   = 14.29;
const CC_GROWER_TARGET  = CC_TOTAL_TARGET - STARTER_PER_BIRD; // 12.15 lbs/bird
const CC_GROWER_CHART   = [2.482,4.535,7.24,10.485,14.129]; // cumulative at wks 3-7 from chart (shape only — scaled to WCF target)
const CC_GROWER_WEEKLY_CHART = CC_GROWER_CHART.map((c,i) => c - (i===0 ? 1.109 : CC_GROWER_CHART[i-1]));
const CC_GROWER_CHART_TOTAL  = CC_GROWER_WEEKLY_CHART.reduce((a,b)=>a+b,0);
const CC_GROWER_SCALE        = CC_GROWER_TARGET / CC_GROWER_CHART_TOTAL;
const CC_GROWER_WEEKLY       = CC_GROWER_WEEKLY_CHART.map(w => w * CC_GROWER_SCALE);

// WR grower weeks 3-8 (6 weeks): derived from WCF historical data (2026-04 analysis)
// WR avg 16.26 lbs/bird at 8 weeks processing (3 data points, combining actual 8w batches +
// 9w batches back-calculated using 23.5% week 8→9 growth rate from White Ranger Hatchery chart)
const WR_TOTAL_TARGET   = 16.26;
const WR_GROWER_TARGET  = WR_TOTAL_TARGET - STARTER_PER_BIRD; // 14.12 lbs/bird
const WR_GROWER_CHART   = [2.3048,3.975,5.9292,8.1483,10.58,13.365]; // cumulative wks 3-8
const WR_GROWER_WEEKLY_CHART = WR_GROWER_CHART.map((c,i) => c - (i===0 ? 1.1193 : WR_GROWER_CHART[i-1]));
const WR_GROWER_CHART_TOTAL  = WR_GROWER_WEEKLY_CHART.reduce((a,b)=>a+b,0);
const WR_GROWER_SCALE        = WR_GROWER_TARGET / WR_GROWER_CHART_TOTAL;
const WR_GROWER_WEEKLY       = WR_GROWER_WEEKLY_CHART.map(w => w * WR_GROWER_SCALE);

export function getFeedSchedule(breed) {
  const growerWeeks = breed === "WR" ? WR_GROWER_WEEKLY : CC_GROWER_WEEKLY;
  const weeks = [
    { week:1, phase:"starter", lbsPerBird: STARTER_W1 },
    { week:2, phase:"starter", lbsPerBird: STARTER_W2 },
    ...growerWeeks.map((lpb,i) => ({ week:i+3, phase:"grower", lbsPerBird: lpb })),
  ];
  return weeks.map(w => ({
    ...w,
    lbsPerBird: Math.round(w.lbsPerBird * 100) / 100,
    totalLbs:   Math.round(w.lbsPerBird * FEED_BIRDS * 10) / 10,
  }));
}

export function calcBatchFeed(batch) {
  const schedule = getFeedSchedule(batch.breed);
  let starter = 0, grower = 0;
  schedule.forEach(w => {
    if (w.phase === "starter") starter += w.totalLbs;
    else grower += w.totalLbs;
  });
  return { schedule, starter: Math.round(starter), grower: Math.round(grower), total: Math.round(starter+grower) };
}

export const BREED_STYLE = {
  CC: {bg:"#E6F1FB", tx:"#185FA5"},
  WR: {bg:"#FAEEDA", tx:"#854F0B"},
  FR: {bg:"#F3E8FF", tx:"#6b21a8"}, // Freedom Rangers (legacy)
  CY: {bg:"#FFE4E6", tx:"#9f1239"}, // Color Yields (legacy)
};

export function calcTimeline(hatchDate, breed, processingDate){
  if(!hatchDate) return null;
  const brooderIn   = hatchDate;
  const brooderOut  = toISO(addDays(hatchDate, BROODER_DAYS));
  const schoonerIn  = brooderOut;
  const schoonerOut = processingDate
    ? toISO(addDays(processingDate, -1))
    : toISO(addDays(brooderOut, breed==="WR" ? WR_SCHOONER : CC_SCHOONER));
  return {brooderIn, brooderOut, schoonerIn, schoonerOut};
}

export function calcPoultryStatus(batch) {
  // Trust user's explicit status choice. Auto-compute only when not set.
  if(batch.status) return batch.status;
  if(!batch.hatchDate) return 'planned';
  const today = todayISO();
  const tl = calcTimeline(batch.hatchDate, batch.breed, batch.processingDate);
  if(!tl) return 'planned';
  if(today < tl.brooderIn) return 'planned';
  if(batch.processingDate && today > batch.processingDate) return 'processed';
  return 'active';
}

// Live broiler stats computed from daily reports.
// For modern (non-B-24) batches this is the source of truth for feed/grit/mortality.
// For legacy B-24-* batches the stored fields on the batch are used (no daily reports exist).
// Returns: {starterFeed, growerFeed, gritLbs, mortality, projectedBirds, mortPct, dailyCount}
export function calcBroilerStatsFromDailys(batch, broilerDailys){
  const isLegacy = (/^b-24-/i).test(batch.name||"");
  const dayOneCount = parseInt(batch.birdCountActual) || 0;
  if(isLegacy){
    const mort = parseInt(batch.mortalityCumulative)||0;
    return {
      starterFeed: parseFloat(batch.brooderFeedLbs)||0,
      growerFeed:  parseFloat(batch.schoonerFeedLbs)||0,
      gritLbs:     parseFloat(batch.gritLbs)||0,
      mortality:   mort,
      projectedBirds: Math.max(0, dayOneCount - mort),
      mortPct: dayOneCount>0 ? (mort/dayOneCount*100) : 0,
      dailyCount: 0,
      legacy: true,
    };
  }
  const target = String(batch.name||"").toLowerCase().trim();
  const bd = (broilerDailys||[]).filter(d=>{
    const lbl = String(d.batch_label||"").toLowerCase().trim().replace(/^\(processed\)\s*/,'').trim();
    return lbl === target;
  });
  let starterFeed=0, growerFeed=0, gritLbs=0, mortality=0;
  for(const d of bd){
    const f = parseFloat(d.feed_lbs)||0;
    if(d.feed_type === 'STARTER') starterFeed += f;
    else if(d.feed_type === 'GROWER') growerFeed += f;
    gritLbs   += parseFloat(d.grit_lbs)||0;
    mortality += parseInt(d.mortality_count)||0;
  }
  return {
    starterFeed: Math.round(starterFeed),
    growerFeed:  Math.round(growerFeed),
    gritLbs:     Math.round(gritLbs),
    mortality,
    projectedBirds: Math.max(0, dayOneCount - mortality),
    mortPct: dayOneCount>0 ? (mortality/dayOneCount*100) : 0,
    dailyCount: bd.length,
    legacy: false,
  };
}
