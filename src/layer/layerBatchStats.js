// Pure helpers for layer batch + housing stat derivation. Extracted from
// LayerBatchesView so the upcoming layer.batch / layer.housing record-page
// migration only needs to touch UI, routing, and Activity wiring.
//
// All helpers are pure: input rows in, computed object out. They do not
// fetch, persist, mutate, or touch Activity. They preserve the source
// records, date boundaries, batch_id attribution, and feed phase math the
// view used inline before the extraction.

export const HOUSING_CAPS = {
  'Layer Schooner': 450,
  'Eggmobile 1': 250,
  'Eggmobile 2': 250,
  'Eggmobile 3': 250,
  'Eggmobile 4': 250,
  'Retirement Home': 9999,
};

const HOUSING_CAP_FALLBACK = 9999;

export function getHousingCap(name) {
  if (!name) return HOUSING_CAP_FALLBACK;
  const lower = String(name).toLowerCase();
  for (const [k, v] of Object.entries(HOUSING_CAPS)) {
    if (lower.includes(k.toLowerCase())) return v;
  }
  return HOUSING_CAP_FALLBACK;
}

// Date is in a housing's active window. Empty start/end means open-ended on
// that side. Caller passes ISO date strings ('YYYY-MM-DD') so lexical
// comparison is correct.
export function inRange(date, start, end) {
  if (!date) return false;
  if (start && date < start) return false;
  if (end && date > end) return false;
  return true;
}

// Bird-age feed phase. Anchor is the brooder entry date (falls back to
// arrival_date at the call site). Thresholds: 0-20 STARTER, 21-139 GROWER,
// 140+ LAYER. If anchor is missing, fall back to the stored feed_type so
// historical rows without an anchor keep their recorded phase.
export function calcPhaseFromAge(reportDate, brooderEntry, storedType) {
  if (!brooderEntry || !reportDate) return storedType || 'LAYER';
  try {
    const days = Math.floor((new Date(reportDate + 'T12:00:00') - new Date(brooderEntry + 'T12:00:00')) / 86400000);
    if (days < 21) return 'STARTER';
    if (days < 140) return 'GROWER';
    return 'LAYER';
  } catch (_e) {
    return storedType || 'LAYER';
  }
}

// Sum the egg counts on one egg_daily row that match a given housing_name.
function sumEggsForHousing(eggDaily, housingName) {
  let e = 0;
  const pairs = [
    [eggDaily.group1_name, eggDaily.group1_count],
    [eggDaily.group2_name, eggDaily.group2_count],
    [eggDaily.group3_name, eggDaily.group3_count],
    [eggDaily.group4_name, eggDaily.group4_count],
  ];
  for (const [n, c] of pairs) {
    if (n === housingName) e += parseInt(c) || 0;
  }
  return e;
}

// Batch stats: keyed by batch.id. Attribution is batch_id-based on
// layer_dailys (NOT batch_label text matching). Eggs are summed from
// egg_dailys per attached housing, bounded by each housing's
// start_date/retired_date window.
export function computeBatchStats(layerBatches, layerHousings, layerDailys, eggDailys) {
  const stats = {};
  for (const batch of layerBatches || []) {
    const anchor = batch.brooder_entry_date || batch.arrival_date || null;
    const bHousings = (layerHousings || []).filter((h) => h.batch_id === batch.id);
    const myReports = (layerDailys || []).filter((d) => d.batch_id === batch.id);
    let totalFeed = 0;
    let totalMort = 0;
    let starterFeed = 0;
    let growerFeed = 0;
    let layerFeed = 0;
    for (const d of myReports) {
      const f = parseFloat(d.feed_lbs) || 0;
      totalFeed += f;
      totalMort += parseInt(d.mortality_count) || 0;
      const phase = calcPhaseFromAge(d.date, anchor, d.feed_type);
      if (phase === 'STARTER') starterFeed += f;
      else if (phase === 'GROWER') growerFeed += f;
      else layerFeed += f;
    }
    let totalEggs = 0;
    for (const h of bHousings) {
      for (const d of eggDailys || []) {
        if (!inRange(d.date, h.start_date, h.retired_date)) continue;
        totalEggs += sumEggsForHousing(d, h.housing_name);
      }
    }
    stats[batch.id] = {totalFeed, totalMort, totalEggs, starterFeed, growerFeed, layerFeed};
  }
  return stats;
}

// Housing stats: keyed by housing.id. layer_dailys are matched to a housing
// by case-insensitive trimmed batch_label vs housing_name AND by date being
// inside the housing's active window. The parent batch supplies the
// brooder/arrival anchor used by the phase calc.
export function computeHousingStats(layerBatches, layerHousings, layerDailys, eggDailys) {
  const batchById = Object.fromEntries((layerBatches || []).map((b) => [b.id, b]));
  const hStats = {};
  for (const h of layerHousings || []) {
    const parent = h.batch_id ? batchById[h.batch_id] : null;
    const anchor = parent ? parent.brooder_entry_date || parent.arrival_date || null : null;
    const hd = (layerDailys || []).filter(
      (d) =>
        String(d.batch_label || '')
          .toLowerCase()
          .trim() ===
          String(h.housing_name || '')
            .toLowerCase()
            .trim() && inRange(d.date, h.start_date, h.retired_date),
    );
    let totalFeed = 0;
    let totalMort = 0;
    let starterFeed = 0;
    let growerFeed = 0;
    let layerFeed = 0;
    for (const d of hd) {
      const f = parseFloat(d.feed_lbs) || 0;
      totalFeed += f;
      totalMort += parseInt(d.mortality_count) || 0;
      const phase = calcPhaseFromAge(d.date, anchor, d.feed_type);
      if (phase === 'STARTER') starterFeed += f;
      else if (phase === 'GROWER') growerFeed += f;
      else layerFeed += f;
    }
    let totalEggs = 0;
    for (const d of eggDailys || []) {
      if (!inRange(d.date, h.start_date, h.retired_date)) continue;
      totalEggs += sumEggsForHousing(d, h.housing_name);
    }
    hStats[h.id] = {
      totalFeed,
      totalMort,
      totalEggs,
      starterFeed,
      growerFeed,
      layerFeed,
    };
  }
  return hStats;
}
