import {describe, expect, it} from 'vitest';
import {
  buildEggProductionEvents,
  buildLegacyProductionEvents,
  buildProductionModel,
  buildProductionYearRows,
  formatProductionDelta,
  formatProductionNumber,
  homeProductionStats,
  reconcileProductionEvents,
} from './production.js';

describe('production reconciliation', () => {
  it('counts Planner events once and uses legacy rows only as backfill', () => {
    const plannerEvents = buildLegacyProductionEvents([
      {id: 'planner-pig', event_date: '2026-04-03', program: 'pig', batch_name: 'P-26-01A', quantity: 5},
      {id: 'planner-broiler-5', event_date: '2026-05-01', program: 'broiler', batch_name: 'B-26-05', quantity: 600},
    ]).map((event) => ({...event, source: 'planner', sourceLabel: 'Planner'}));
    const legacyEvents = buildLegacyProductionEvents([
      {id: 'legacy-pig', event_date: '2026-04-03', program: 'PIG', batch_name: 'P-26-01A', quantity: 5},
      {id: 'legacy-broiler-4', event_date: '2026-04-01', program: 'CHICKEN', batch_name: 'B-26-04', quantity: 574},
    ]);

    const result = reconcileProductionEvents({plannerEvents, legacyEvents});

    expect(result.events.filter((event) => event.program === 'pig')).toHaveLength(1);
    expect(
      result.events.filter((event) => event.program === 'broiler').reduce((sum, event) => sum + event.quantity, 0),
    ).toBe(1174);
    expect(result.audit.map((row) => row.status)).toEqual(['matched', 'legacy_only']);
  });

  it('holds conflicts out of totals so Planner wins until review', () => {
    const plannerEvents = buildLegacyProductionEvents([
      {id: 'planner-cattle', event_date: '2026-04-03', program: 'cattle', batch_name: 'C-26-01', quantity: 4},
    ]).map((event) => ({...event, source: 'planner', sourceLabel: 'Planner'}));
    const legacyEvents = buildLegacyProductionEvents([
      {id: 'legacy-cattle', event_date: '2026-04-03', program: 'CATTLE', batch_name: 'C-26-01', quantity: 5},
    ]);

    const result = reconcileProductionEvents({plannerEvents, legacyEvents});

    expect(result.events).toHaveLength(1);
    expect(result.events[0].quantity).toBe(4);
    expect(result.audit[0].status).toBe('conflict');
    expect(result.audit[0].counted).toBe(false);
  });
});

describe('production yearly totals', () => {
  it('calculates YoY inside each program, including explicit zero years', () => {
    const events = buildLegacyProductionEvents([
      {event_date: '2023-10-18', program: 'LAMB', quantity: 26},
      {event_date: '2024-01-01', program: 'LAMB', quantity: 0},
      {event_date: '2025-07-23', program: 'LAMB', quantity: 3},
    ]);

    expect(buildProductionYearRows(events, 'sheep')).toEqual([
      {year: '2023', quantity: 26, yoy: null},
      {year: '2024', quantity: 0, yoy: -26},
      {year: '2025', quantity: 3, yoy: 3},
    ]);
  });

  it('formats eggs as dozens without mixing them into animal counts', () => {
    const eggEvents = buildEggProductionEvents([
      {id: 'egg-1', date: '2026-06-01', group1_count: 12, group2_count: 6, group3_count: '', group4_count: 0},
    ]);
    const model = buildProductionModel({eggDailys: [eggEvents[0].raw]});
    const stats = homeProductionStats(model, 2026);

    expect(eggEvents[0].quantity).toBe(18);
    expect(formatProductionNumber('egg', 18)).toBe('1.5');
    expect(formatProductionDelta('egg', -24)).toBe('-2');
    expect(stats.find((stat) => stat.programKey === 'egg').value).toBe('1.5');
    expect(stats).toHaveLength(5);
  });
});
