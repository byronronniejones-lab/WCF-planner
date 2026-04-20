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


// ============================================================================
// Timeline + batch-color deps (added in Round 6 timeline-view extraction)
// ----------------------------------------------------------------------------
// These started life as plain module-scope names in main.jsx. Moved here so
// the extracted timeline/list/feed views can import them without a circular
// dep on the entry module. breedLabel reads LEGACY_BREEDS (also lifted).
// ============================================================================
export const WEEKS_SHOWN       = 52;

export const LEGACY_BREEDS = [
  {code:"FR", label:"Freedom Rangers"},
  {code:"CY", label:"Color Yields"},
];

export const RESOURCES = [
  {type:"brooder",  id:"1",    label:"Brooder 1"},
  {type:"brooder",  id:"2",    label:"Brooder 2"},
  {type:"brooder",  id:"3",    label:"Brooder 3"},
  {type:"schooner", id:"1",    label:"Schooner 1"},
  {type:"schooner", id:"2&3",  label:"Schooner 2 & 3"},
  {type:"schooner", id:"4&5",  label:"Schooner 4 & 5"},
  {type:"schooner", id:"6&6A", label:"Schooner 6 & 6A"},
  {type:"schooner", id:"7&7A", label:"Schooner 7 & 7A"},
];

// ── Per-batch color system (hash of batch name) ────────────────────────────
// Each batch gets a unique color from this palette. Brooder and schooner phases
// of the same batch share the literally identical color. Used in timeline,
// list view, and feed calculator.
// Palette curated so adjacent indices are maximally distinct in hue.
// Used with sequential batch number index (B-26-09 → 9), so consecutive
// batches always land on adjacent palette positions.
const BATCH_COLOR_PALETTE = [
  {bg:'#dc2626', tx:'white', bd:'#7f1d1d'}, // 0  red
  {bg:'#1e40af', tx:'white', bd:'#0f2247'}, // 1  navy
  {bg:'#ea580c', tx:'white', bd:'#7c2d12'}, // 2  orange
  {bg:'#7c3aed', tx:'white', bd:'#4c1d95'}, // 3  purple
  {bg:'#16a34a', tx:'white', bd:'#14532d'}, // 4  green
  {bg:'#db2777', tx:'white', bd:'#831843'}, // 5  pink
  {bg:'#0891b2', tx:'white', bd:'#164e63'}, // 6  cyan
  {bg:'#ca8a04', tx:'white', bd:'#713f12'}, // 7  amber
  {bg:'#525b6e', tx:'white', bd:'#1e293b'}, // 8  slate
  {bg:'#84cc16', tx:'#1a2e05', bd:'#365314'}, // 9  lime (light, dark text)
  {bg:'#9f1239', tx:'white', bd:'#4c0519'}, // 10 wine
  {bg:'#0284c7', tx:'white', bd:'#0c4a6e'}, // 11 sky
  {bg:'#a16207', tx:'white', bd:'#451a03'}, // 12 brown
  {bg:'#c026d3', tx:'white', bd:'#701a75'}, // 13 magenta
  {bg:'#0d9488', tx:'white', bd:'#134e4a'}, // 14 teal
  {bg:'#f97316', tx:'#451a03', bd:'#7c2d12'}, // 15 bright orange (light, dark text)
  {bg:'#5b21b6', tx:'white', bd:'#2e1065'}, // 16 indigo
  {bg:'#e11d48', tx:'white', bd:'#881337'}, // 17 crimson
  {bg:'#365314', tx:'white', bd:'#1a2e0a'}, // 18 forest
  {bg:'#67e8f9', tx:'#083344', bd:'#0e7490'}, // 19 light cyan (light, dark text)
  {bg:'#7e22ce', tx:'white', bd:'#581c87'}, // 20 violet
  {bg:'#facc15', tx:'#451a03', bd:'#854d0e'}, // 21 yellow (light, dark text)
  {bg:'#1e3a8a', tx:'white', bd:'#0a1429'}, // 22 deep blue
  {bg:'#be185d', tx:'white', bd:'#500724'}, // 23 deep pink
];
export function getBatchColor(name){
  if(!name) return BATCH_COLOR_PALETTE[0];
  // Try to extract a trailing number from the name (e.g. "B-26-09" → 9, "L-26-01" → 1).
  // This guarantees consecutive batches get adjacent (and visually distinct) palette colors.
  const m = String(name).match(/(\d+)\s*$/);
  if(m){
    const n = parseInt(m[1]);
    if(!isNaN(n)) return BATCH_COLOR_PALETTE[n % BATCH_COLOR_PALETTE.length];
  }
  // Fallback for batches without a trailing number: hash
  let hash = 5381;
  const s = String(name).toLowerCase().trim();
  for(let i=0;i<s.length;i++) hash = ((hash << 5) + hash + s.charCodeAt(i)) | 0;
  return BATCH_COLOR_PALETTE[Math.abs(hash) % BATCH_COLOR_PALETTE.length];
}

export function breedLabel(code){
  if(code==="CC") return "Cornish Cross";
  if(code==="WR") return "White Ranger";
  const lb = LEGACY_BREEDS.find(x=>x.code===code);
  if(lb) return lb.label;
  return code || "\u2014";
}


// ============================================================================
// Status badge colors + US-holiday-adjacent date warnings (list view deps)
// ----------------------------------------------------------------------------
// STATUS_STYLE is used by the broiler list view for the planned/active/
// processed pills. isNearHoliday flags hatch/processing dates that fall
// within 1 day of a US holiday (processors close, so scheduling gets sticky).
// ============================================================================
export const STATUS_STYLE = {
  planned:   {bg:"#374151", tx:"white"},
  active:    {bg:"#085041", tx:"white"},
  processed: {bg:"#4b5563", tx:"white"},
};

function getEaster(y){
  const a=y%19,b=Math.floor(y/100),c=y%100,d=Math.floor(b/4),e=b%4;
  const f=Math.floor((b+8)/25),g=Math.floor((b-f+1)/3),h=(19*a+b-d-g+15)%30;
  const i=Math.floor(c/4),k=c%4,l=(32+2*e+2*i-h-k)%7,m=Math.floor((a+11*h+22*l)/451);
  return toISO(new Date(y,Math.floor((h+l-7*m+114)/31)-1,((h+l-7*m+114)%31)+1));
}
function getThanksgiving(y){
  const d=new Date(y,10,1);
  return toISO(new Date(y,10,((4-d.getDay()+7)%7)+22));
}
function holidaysForYear(y){
  return [`${y}-01-01`,getEaster(y),`${y}-07-04`,getThanksgiving(y),`${y}-12-25`];
}
export function isNearHoliday(iso){
  if(!iso) return false;
  const d=new Date(iso+"T12:00:00"),y=d.getFullYear();
  const all=[...holidaysForYear(y-1),...holidaysForYear(y),...holidaysForYear(y+1)];
  return all.some(h=>Math.abs(d-new Date(h+"T12:00:00"))/86400000<=1);
}
