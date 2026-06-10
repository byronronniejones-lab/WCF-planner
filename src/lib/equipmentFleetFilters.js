// Equipment Fleet filters + sort.
// Pure module: no React, no Supabase, no browser globals. EquipmentFleetView
// owns rendering + data loading; this file owns deterministic filter/sort
// behavior over the equipment rows. Right-sized — the fleet is a few dozen
// pieces, so a single active sort rule {key, dir} (not the cattle/sheep
// multi-rule stack) plus a flat set of high-value filters.

export const EQUIPMENT_FLEET_FILTER_DIMENSIONS = Object.freeze([
  'status',
  'category',
  'fuelType',
  'trackingUnit',
  'fuelingTier',
  'textSearch',
]);

export const EQUIPMENT_FLEET_SORT_KEYS = Object.freeze(['name', 'category', 'status', 'daysSinceFueling']);

// Days without a fueling entry before a piece is considered "missed". Mirrors
// lib/equipment.js MISSED_FUELING_DAYS (Ronnie's call: 14 days) but kept local
// so this pure module has no cross-import; callers may override via ctx.
export const MISSED_FUELING_DAYS_DEFAULT = 14;

const DAY_MS = 86400000;

// Category display order for the `category` sort key. Mirrors the
// EQUIPMENT_CATEGORIES order in lib/equipment.js; unknown categories sort last.
const CATEGORY_ORDER = ['tractors', 'atvs', 'hijets', 'mowers', 'skidsteers', 'forestry'];

// Status display order for the `status` sort key. active first, sold last.
const STATUS_ORDER = ['active', 'sold'];

// Days since an ISO date string, anchored to ctx.todayMs so tests are
// host-timezone-independent. Returns null for falsy/invalid input.
export function daysSinceDate(iso, todayMs) {
  if (!iso) return null;
  const t = new Date((iso + '').slice(0, 10) + 'T12:00:00Z').getTime();
  if (!Number.isFinite(t)) return null;
  const ms = (todayMs ?? Date.now()) - t;
  if (ms < 0) return 0;
  return Math.floor(ms / DAY_MS);
}

// Latest fueling DATE for one equipment id. ctx.latestFuelingDateById is a
// Map<equipmentId, isoDate> the view builds once from its fueling rows; this
// keeps the predicate O(1) per row and free of fueling-array scanning.
export function lastFuelingDateFor(equipmentId, latestFuelingDateById) {
  if (!latestFuelingDateById) return null;
  if (typeof latestFuelingDateById.get === 'function') return latestFuelingDateById.get(equipmentId) || null;
  return latestFuelingDateById[equipmentId] || null;
}

export function daysSinceFuelingFor(row, ctx) {
  if (!row) return null;
  const date = lastFuelingDateFor(row.id, ctx && ctx.latestFuelingDateById);
  return daysSinceDate(date, ctx && ctx.todayMs);
}

export function buildEquipmentFleetPredicate(filters, ctx = {}) {
  const f = filters || {};
  const todayMs = ctx.todayMs ?? Date.now();
  const latestFuelingDateById = ctx.latestFuelingDateById || null;
  const missedDays = ctx.missedFuelingDays ?? MISSED_FUELING_DAYS_DEFAULT;

  return (row) => {
    if (!row) return false;

    if (Array.isArray(f.status) && f.status.length > 0 && !f.status.includes(row.status)) return false;

    if (Array.isArray(f.category) && f.category.length > 0 && !f.category.includes(row.category)) return false;

    if (Array.isArray(f.fuelType) && f.fuelType.length > 0) {
      const fuel = row.fuel_type || null;
      const matches = f.fuelType.includes(fuel) || (fuel == null && f.fuelType.includes('unset'));
      if (!matches) return false;
    }

    if (Array.isArray(f.trackingUnit) && f.trackingUnit.length > 0 && !f.trackingUnit.includes(row.tracking_unit)) {
      return false;
    }

    if (f.fuelingTier) {
      const date = lastFuelingDateFor(row.id, latestFuelingDateById);
      const days = daysSinceDate(date, todayMs);
      const has = days != null;
      const missed = has && days > missedDays;
      if (f.fuelingTier === 'fueled' && !has) return false;
      if (f.fuelingTier === 'neverFueled' && has) return false;
      if (f.fuelingTier === 'missedFueling' && !(has && missed)) return false;
      if (f.fuelingTier === 'missedOrNeverFueled' && !(!has || missed)) return false;
    }

    if (typeof f.textSearch === 'string' && f.textSearch.trim()) {
      const q = f.textSearch.toLowerCase().trim();
      const fields = [row.name, row.category, row.serial_number, row.slug, row.fuel_type].map((x) =>
        (x || '').toLowerCase(),
      );
      if (!fields.some((x) => x.includes(q))) return false;
    }

    return true;
  };
}

export function buildEquipmentFleetComparator(sortRule, ctx = {}) {
  const rule =
    sortRule && sortRule.key && EQUIPMENT_FLEET_SORT_KEYS.includes(sortRule.key)
      ? {key: sortRule.key, dir: sortRule.dir === 'desc' ? 'desc' : 'asc'}
      : {key: 'name', dir: 'asc'};

  return (a, b) => compareByKey(rule.key, a, b, rule.dir, ctx);
}

function applyDir(cmp, dir) {
  return dir === 'desc' ? -cmp : cmp;
}

function compareByKey(key, a, b, dir, ctx) {
  switch (key) {
    case 'name': {
      const av = (a.name || '').toLowerCase();
      const bv = (b.name || '').toLowerCase();
      if (!av && !bv) return 0;
      if (!av) return 1;
      if (!bv) return -1;
      return applyDir(av.localeCompare(bv), dir);
    }
    case 'category': {
      const ai = CATEGORY_ORDER.indexOf(a.category);
      const bi = CATEGORY_ORDER.indexOf(b.category);
      const av = ai < 0 ? 999 : ai;
      const bv = bi < 0 ? 999 : bi;
      if (av === bv) {
        // Tie-break within a category by name so the order is stable.
        return applyDir((a.name || '').toLowerCase().localeCompare((b.name || '').toLowerCase()), dir);
      }
      return applyDir(av - bv, dir);
    }
    case 'status': {
      const ai = STATUS_ORDER.indexOf(a.status);
      const bi = STATUS_ORDER.indexOf(b.status);
      const av = ai < 0 ? 999 : ai;
      const bv = bi < 0 ? 999 : bi;
      return applyDir(av - bv, dir);
    }
    case 'daysSinceFueling': {
      const ad = daysSinceFuelingFor(a, ctx);
      const bd = daysSinceFuelingFor(b, ctx);
      // Never-fueled (null) sorts to the end regardless of direction.
      if (ad == null && bd == null) return 0;
      if (ad == null) return 1;
      if (bd == null) return -1;
      return applyDir(ad - bd, dir);
    }
    default:
      return 0;
  }
}
