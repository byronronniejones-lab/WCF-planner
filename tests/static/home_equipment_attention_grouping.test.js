import {describe, it, expect} from 'vitest';
import {buildEquipmentAttention} from '../../src/dashboard/homeAlerts.js';

// buildEquipmentAttention must collapse every attention item for the SAME piece
// of equipment into ONE grouped notice carrying a TYPED item list, so the home
// dashboard / light portal never show multiple duplicate-looking rows for one
// machine, and a 50-hour checklist streak never reads like a service alert.
//
// It must ALSO preserve the per-item detail / metaLabel / pill shape the two
// consumers (HomeDashboard pill + LightHomePortal single-text detail) read.

// A piece of equipment with TWO overdue service intervals + a skipped every-
// fillup checklist item + a warranty inside the window — every category at once.
function multiAttentionEquipment() {
  return {
    id: 'eq-jd',
    slug: 'jd-317',
    name: 'JD 317',
    tracking_unit: 'hours',
    current_hours: 1100,
    service_intervals: [
      {kind: 'hours', hours_or_km: 250, label: '250h service'},
      {kind: 'hours', hours_or_km: 500, label: '500h service'},
    ],
    every_fillup_items: [{id: 'grease', label: 'Grease zerks'}],
    // 30 days past expiration — inside WARRANTY_WINDOW_DAYS (60).
    warranty_expiration: new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10),
  };
}

function fuelingsFor(eq) {
  // One fueling at the current reading, no every-fillup ticks → grease streak=1.
  return {[eq.id]: [{date: '2026-06-01', hours_reading: 1100, every_fillup_check: []}]};
}

describe('buildEquipmentAttention — grouping by equipment', () => {
  it('collapses all attention items for one piece into a SINGLE grouped notice', () => {
    const eq = multiAttentionEquipment();
    const notices = buildEquipmentAttention({
      equipment: [eq],
      equipmentFuelings: fuelingsFor(eq),
      equipmentCompletions: {},
      missedCleared: [],
    });
    // One notice for the one machine, even though it has 2 services + 1
    // checklist + 1 warranty = 4 underlying attention items.
    expect(notices).toHaveLength(1);
    const notice = notices[0];
    expect(notice.label).toBe('JD 317');
    expect(notice.slug).toBe('jd-317');
    expect(Array.isArray(notice.items)).toBe(true);
    expect(notice.items.length).toBe(4);
  });

  it('types each item so checklist / service / warranty are distinguishable', () => {
    const eq = multiAttentionEquipment();
    const [notice] = buildEquipmentAttention({
      equipment: [eq],
      equipmentFuelings: fuelingsFor(eq),
      equipmentCompletions: {},
      missedCleared: [],
    });
    const types = notice.items.map((i) => i.type);
    expect(types).toContain('service');
    expect(types).toContain('checklist');
    expect(types).toContain('warranty');
    // Each item carries a human-readable type label for the consumers.
    for (const item of notice.items) {
      expect(typeof item.typeLabel).toBe('string');
      expect(item.typeLabel.length).toBeGreaterThan(0);
    }
    // Service items lead the grouped notice (primary kind drives LED color).
    expect(notice.items[0].type).toBe('service');
    expect(notice.kind).toBe('overdue');
  });

  it('preserves the per-item detail / metaLabel / pill the consumers read', () => {
    const eq = multiAttentionEquipment();
    const [notice] = buildEquipmentAttention({
      equipment: [eq],
      equipmentFuelings: fuelingsFor(eq),
      equipmentCompletions: {},
      missedCleared: [],
    });
    // Overdue services are ordered ascending by interval, so the 250h is first.
    const services = notice.items.filter((i) => i.type === 'service');
    expect(services.map((s) => s.metaLabel)).toEqual(['250h service', '500h service']);
    const service = services[0];
    // Full detail keeps the overdue quantity (single-text consumers); metaLabel
    // is the service-only label; pill is the pastel quantity badge.
    expect(service.detail).toMatch(/overdue/);
    expect(service.metaLabel).toBe('250h service');
    expect(service.pill).toMatch(/overdue/);

    const checklist = notice.items.find((i) => i.type === 'checklist');
    expect(checklist.detail).toMatch(/skipped/);
    expect(checklist.pill).toMatch(/skipped/);

    const warranty = notice.items.find((i) => i.type === 'warranty');
    expect(warranty.detail).toMatch(/Warranty/);

    // Notice-level detail joins every item so LightHomePortal's single {a.detail}
    // still surfaces all due items (with their overdue quantities).
    expect(notice.detail).toMatch(/overdue/);
    expect(notice.detail).toMatch(/skipped/);
    expect(notice.detail).toMatch(/Warranty/);
    // Notice-level metaLabel / pill mirror the primary (first service) item.
    expect(notice.metaLabel).toBe('250h service');
    expect(notice.pill).toMatch(/overdue/);
  });

  it('keeps separate equipment in separate notices', () => {
    const a = multiAttentionEquipment();
    const b = {...multiAttentionEquipment(), id: 'eq-b', slug: 'c362', name: 'C362'};
    const notices = buildEquipmentAttention({
      equipment: [a, b],
      equipmentFuelings: {...fuelingsFor(a), ...fuelingsFor(b)},
      equipmentCompletions: {},
      missedCleared: [],
    });
    expect(notices).toHaveLength(2);
    expect(new Set(notices.map((n) => n.label))).toEqual(new Set(['JD 317', 'C362']));
  });

  it('emits no notice for equipment with nothing due', () => {
    const eq = {
      id: 'eq-clean',
      slug: 'clean',
      name: 'Clean',
      tracking_unit: 'hours',
      current_hours: 100,
      service_intervals: [{kind: 'hours', hours_or_km: 500, label: '500h service'}],
      every_fillup_items: [],
    };
    const notices = buildEquipmentAttention({
      equipment: [eq],
      equipmentFuelings: {[eq.id]: [{date: '2026-06-01', hours_reading: 100, every_fillup_check: []}]},
      equipmentCompletions: {},
      missedCleared: [],
    });
    expect(notices).toHaveLength(0);
  });

  it('marks a warranty-ONLY notice as manually clearable; auto-clears otherwise', () => {
    const warrantyOnly = {
      id: 'eq-w',
      slug: 'warr',
      name: 'Warr',
      tracking_unit: 'hours',
      current_hours: 100,
      service_intervals: [],
      every_fillup_items: [],
      warranty_expiration: new Date(Date.now() - 5 * 86400000).toISOString().slice(0, 10),
    };
    const [wNotice] = buildEquipmentAttention({
      equipment: [warrantyOnly],
      equipmentFuelings: {},
      equipmentCompletions: {},
      missedCleared: [],
    });
    expect(wNotice.items).toHaveLength(1);
    expect(wNotice.clearableKey).toBe(wNotice.items[0].key);
    expect(wNotice.clearableKey).toMatch(/^equip-warranty-/);

    // A piece with a service item too is auto-clearing (no manual Clear).
    const eq = multiAttentionEquipment();
    const [notice] = buildEquipmentAttention({
      equipment: [eq],
      equipmentFuelings: fuelingsFor(eq),
      equipmentCompletions: {},
      missedCleared: [],
    });
    expect(notice.clearableKey).toBeNull();
  });

  it('honors missedCleared for the warranty item key', () => {
    const warrantyOnly = {
      id: 'eq-w',
      slug: 'warr',
      name: 'Warr',
      tracking_unit: 'hours',
      current_hours: 100,
      service_intervals: [],
      every_fillup_items: [],
      warranty_expiration: new Date(Date.now() - 5 * 86400000).toISOString().slice(0, 10),
    };
    const key = 'equip-warranty-eq-w|' + warrantyOnly.warranty_expiration;
    const notices = buildEquipmentAttention({
      equipment: [warrantyOnly],
      equipmentFuelings: {},
      equipmentCompletions: {},
      missedCleared: [key],
    });
    // Warranty was the only item and it's cleared → no notice at all.
    expect(notices).toHaveLength(0);
  });
});
