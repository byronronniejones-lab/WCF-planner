// Canonical /dailys display order — orders the admin Webforms list so it
// matches the public /dailys selector tile sequence: Add Feed → Weigh-Ins →
// Submit a Task → Broiler → Layer → Egg → Pig → Cattle → Sheep, with Fuel
// Supply (not on /dailys) last. Each entry is the alias group that maps to the
// same slot — a form's key and its stored webform id both resolve to one index.
const DAILYS_ORDER = [
  ['add-feed', 'add-feed-webform'],
  ['weigh-ins', 'weighins-webform'],
  ['tasks-public', 'tasks-public-webform'],
  ['broiler-dailys'],
  ['layer-dailys'],
  ['egg-dailys'],
  ['pig-dailys'],
  ['cattle-dailys'],
  ['sheep-dailys'],
  ['fuel-supply', 'fuel-supply-webform'],
];

const ORDER_INDEX = (() => {
  const m = new Map();
  DAILYS_ORDER.forEach((aliases, i) => aliases.forEach((k) => m.set(k, i)));
  return m;
})();

/**
 * Returns the /dailys-order index for a form key or stored webform id. Unknown
 * keys sort AFTER all known entries (stable original-order tiebreaker).
 */
export function dailysOrderIndex(key) {
  const i = ORDER_INDEX.get(key);
  return i == null ? DAILYS_ORDER.length : i;
}

/**
 * Returns a new array sorted by /dailys display order. Pass a `getKey`
 * extractor for arrays of objects (e.g. webformsConfig.webforms).
 */
export function sortByDailysOrder(list, getKey = (x) => x) {
  return list
    .map((item, i) => ({item, i, idx: dailysOrderIndex(getKey(item))}))
    .sort((a, b) => a.idx - b.idx || a.i - b.i)
    .map((x) => x.item);
}
