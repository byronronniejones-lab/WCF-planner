import {describe, it, expect} from 'vitest';
import {
  HOUSING_CAPS,
  getHousingCap,
  inRange,
  calcPhaseFromAge,
  computeBatchStats,
  computeHousingStats,
} from './layerBatchStats.js';

describe('HOUSING_CAPS table', () => {
  it('exposes the canonical layer housing capacities', () => {
    expect(HOUSING_CAPS).toEqual({
      'Layer Schooner': 450,
      'Eggmobile 1': 250,
      'Eggmobile 2': 250,
      'Eggmobile 3': 250,
      'Eggmobile 4': 250,
      'Retirement Home': 9999,
    });
  });
});

describe('getHousingCap', () => {
  it('returns 450 for Layer Schooner names', () => {
    expect(getHousingCap('Layer Schooner')).toBe(450);
    expect(getHousingCap('layer schooner #1')).toBe(450);
    expect(getHousingCap('North Layer Schooner pen')).toBe(450);
  });
  it('returns 250 for any Eggmobile (1-4)', () => {
    expect(getHousingCap('Eggmobile 1')).toBe(250);
    expect(getHousingCap('Eggmobile 2')).toBe(250);
    expect(getHousingCap('Eggmobile 3')).toBe(250);
    expect(getHousingCap('Eggmobile 4')).toBe(250);
    expect(getHousingCap('eggmobile 3 — back pasture')).toBe(250);
  });
  it('returns 9999 for Retirement Home', () => {
    expect(getHousingCap('Retirement Home')).toBe(9999);
    expect(getHousingCap('Retirement Home (south)')).toBe(9999);
  });
  it('falls back to 9999 for unknown names', () => {
    expect(getHousingCap('Unknown coop')).toBe(9999);
    expect(getHousingCap('')).toBe(9999);
    expect(getHousingCap(null)).toBe(9999);
    expect(getHousingCap(undefined)).toBe(9999);
  });
  it('matches case-insensitively', () => {
    expect(getHousingCap('LAYER SCHOONER')).toBe(450);
    expect(getHousingCap('EGGMOBILE 2')).toBe(250);
  });
});

describe('inRange', () => {
  it('returns false for missing date', () => {
    expect(inRange(null, '2026-01-01', '2026-12-31')).toBe(false);
    expect(inRange('', '2026-01-01', '2026-12-31')).toBe(false);
  });
  it('returns true when start and end are unset (open window)', () => {
    expect(inRange('2026-04-15', null, null)).toBe(true);
    expect(inRange('2026-04-15', '', '')).toBe(true);
  });
  it('respects start bound (inclusive)', () => {
    expect(inRange('2026-01-01', '2026-01-01', null)).toBe(true);
    expect(inRange('2025-12-31', '2026-01-01', null)).toBe(false);
  });
  it('respects end bound (inclusive)', () => {
    expect(inRange('2026-12-31', null, '2026-12-31')).toBe(true);
    expect(inRange('2027-01-01', null, '2026-12-31')).toBe(false);
  });
  it('keeps current active/retired filtering for housing totals', () => {
    // A housing with start_date=2026-02-01, retired_date=2026-08-31 should
    // include dailys on its bounds and exclude dailys outside.
    const start = '2026-02-01';
    const end = '2026-08-31';
    expect(inRange('2026-02-01', start, end)).toBe(true);
    expect(inRange('2026-08-31', start, end)).toBe(true);
    expect(inRange('2026-01-31', start, end)).toBe(false);
    expect(inRange('2026-09-01', start, end)).toBe(false);
  });
});

describe('calcPhaseFromAge — feed phase thresholds', () => {
  // Anchor + test dates kept within a single DST window (US: Mar 8 → Nov 1,
  // 2026) so no spring-forward / fall-back hour skews the day count.
  const anchor = '2026-04-01';
  it('returns STARTER for days 0-20', () => {
    expect(calcPhaseFromAge('2026-04-01', anchor)).toBe('STARTER'); // day 0
    expect(calcPhaseFromAge('2026-04-20', anchor)).toBe('STARTER'); // day 19
    expect(calcPhaseFromAge('2026-04-21', anchor)).toBe('STARTER'); // day 20
  });
  it('flips to GROWER at day 21', () => {
    expect(calcPhaseFromAge('2026-04-22', anchor)).toBe('GROWER'); // day 21
  });
  it('returns GROWER through day 139', () => {
    expect(calcPhaseFromAge('2026-08-18', anchor)).toBe('GROWER'); // day 139
  });
  it('flips to LAYER at day 140', () => {
    expect(calcPhaseFromAge('2026-08-19', anchor)).toBe('LAYER'); // day 140
  });
  it('returns LAYER for days far past 140', () => {
    expect(calcPhaseFromAge('2026-10-15', anchor)).toBe('LAYER');
  });
  it('falls back to storedType when anchor is missing', () => {
    expect(calcPhaseFromAge('2026-08-19', null, 'GROWER')).toBe('GROWER');
    expect(calcPhaseFromAge('2026-08-19', '', 'STARTER')).toBe('STARTER');
  });
  it('falls back to LAYER when both anchor and storedType missing', () => {
    expect(calcPhaseFromAge('2026-08-19', null, null)).toBe('LAYER');
    expect(calcPhaseFromAge('2026-08-19', null)).toBe('LAYER');
  });
  it('falls back to storedType when reportDate is missing', () => {
    expect(calcPhaseFromAge(null, anchor, 'GROWER')).toBe('GROWER');
    expect(calcPhaseFromAge(null, anchor)).toBe('LAYER');
  });
});

describe('computeBatchStats', () => {
  const layerBatches = [
    {id: 'b1', name: 'L-26-01', brooder_entry_date: '2026-01-01', arrival_date: '2026-01-01'},
    {id: 'b2', name: 'L-26-02', brooder_entry_date: '2026-02-01', arrival_date: '2026-02-01'},
  ];
  const layerHousings = [
    {id: 'h1', housing_name: 'Eggmobile 1', batch_id: 'b1', start_date: '2026-01-01', retired_date: null},
    {id: 'h2', housing_name: 'Eggmobile 2', batch_id: 'b2', start_date: '2026-02-01', retired_date: null},
  ];
  const layerDailys = [
    // b1: day 0 starter (50 lbs)
    {batch_id: 'b1', date: '2026-01-01', feed_lbs: 50, mortality_count: 1},
    // b1: day 30 grower (100 lbs)
    {batch_id: 'b1', date: '2026-01-31', feed_lbs: 100, mortality_count: 0},
    // b1: day 145 layer (200 lbs)
    {batch_id: 'b1', date: '2026-05-26', feed_lbs: 200, mortality_count: 2},
    // b2: assigned to b2 even though batch_label mismatches — proves batch_id attribution
    {batch_id: 'b2', batch_label: 'Eggmobile 1', date: '2026-02-01', feed_lbs: 25, mortality_count: 0},
    // unassigned daily — must not bleed into either batch
    {batch_id: null, date: '2026-01-15', feed_lbs: 9999, mortality_count: 99},
  ];
  const eggDailys = [
    // 10 eggs to Eggmobile 1 inside b1's window
    {date: '2026-03-01', group1_name: 'Eggmobile 1', group1_count: 10},
    // 5 eggs to Eggmobile 1 BEFORE b1's housing start (no retire bound, but housing started 2026-01-01)
    {date: '2025-12-15', group1_name: 'Eggmobile 1', group1_count: 5},
    // 20 eggs to Eggmobile 2 inside b2's window
    {date: '2026-03-10', group1_name: 'Eggmobile 2', group1_count: 20},
  ];

  it('attributes by batch.id, not batch_label', () => {
    const stats = computeBatchStats(layerBatches, layerHousings, layerDailys, eggDailys);
    expect(stats.b1.totalFeed).toBe(350);
    expect(stats.b2.totalFeed).toBe(25);
    // unassigned daily (batch_id: null) is never attributed
    expect(stats.b1.totalFeed + stats.b2.totalFeed).toBe(375);
  });
  it('splits feed across starter/grower/layer phases', () => {
    const stats = computeBatchStats(layerBatches, layerHousings, layerDailys, eggDailys);
    expect(stats.b1.starterFeed).toBe(50);
    expect(stats.b1.growerFeed).toBe(100);
    expect(stats.b1.layerFeed).toBe(200);
  });
  it('counts mortalities across all phases', () => {
    const stats = computeBatchStats(layerBatches, layerHousings, layerDailys, eggDailys);
    expect(stats.b1.totalMort).toBe(3);
    expect(stats.b2.totalMort).toBe(0);
  });
  it('bounds egg attribution by each housing window', () => {
    const stats = computeBatchStats(layerBatches, layerHousings, layerDailys, eggDailys);
    expect(stats.b1.totalEggs).toBe(10); // pre-window 5 excluded
    expect(stats.b2.totalEggs).toBe(20);
  });
  it('returns zeroed stats for batches with no reports', () => {
    const lone = [{id: 'b3', name: 'L-26-03', brooder_entry_date: '2026-03-01', arrival_date: '2026-03-01'}];
    const stats = computeBatchStats(lone, [], [], []);
    expect(stats.b3).toEqual({totalFeed: 0, totalMort: 0, totalEggs: 0, starterFeed: 0, growerFeed: 0, layerFeed: 0});
  });
  it('handles empty inputs without throwing', () => {
    expect(computeBatchStats([], [], [], [])).toEqual({});
    expect(computeBatchStats(null, null, null, null)).toEqual({});
  });
});

describe('computeHousingStats', () => {
  const layerBatches = [{id: 'b1', name: 'L-26-01', brooder_entry_date: '2026-01-01', arrival_date: '2026-01-01'}];
  const layerHousings = [
    {id: 'h1', housing_name: 'Eggmobile 1', batch_id: 'b1', start_date: '2026-02-01', retired_date: '2026-08-31'},
    {id: 'h2', housing_name: 'Retirement Home', batch_id: 'b1', start_date: '2026-09-01', retired_date: null},
  ];
  const layerDailys = [
    // matches Eggmobile 1 by batch_label, inside window
    {batch_label: 'eggmobile 1', batch_id: 'b1', date: '2026-04-10', feed_lbs: 30, mortality_count: 0},
    // matches Eggmobile 1 but BEFORE start_date — must be excluded
    {batch_label: 'Eggmobile 1', batch_id: 'b1', date: '2026-01-15', feed_lbs: 999, mortality_count: 99},
    // matches Eggmobile 1 but AFTER retired_date — must be excluded
    {batch_label: 'Eggmobile 1', batch_id: 'b1', date: '2026-09-15', feed_lbs: 999, mortality_count: 99},
    // Retirement Home daily inside its window
    {batch_label: 'Retirement Home', batch_id: 'b1', date: '2026-09-30', feed_lbs: 40, mortality_count: 1},
    // Stray batch_label that doesn't match any housing — must be excluded
    {batch_label: 'Eggmobile 9', batch_id: 'b1', date: '2026-04-10', feed_lbs: 50, mortality_count: 0},
  ];
  const eggDailys = [
    // Eggmobile 1 inside window
    {date: '2026-04-10', group1_name: 'Eggmobile 1', group1_count: 50},
    // Eggmobile 1 outside window (pre-start) — excluded
    {date: '2026-01-01', group1_name: 'Eggmobile 1', group1_count: 9999},
    // Retirement Home inside its window
    {date: '2026-09-30', group1_name: 'Retirement Home', group1_count: 15},
  ];

  it('matches by housing_name (case-insensitive, trimmed) and bounds by active window', () => {
    const stats = computeHousingStats(layerBatches, layerHousings, layerDailys, eggDailys);
    expect(stats.h1.totalFeed).toBe(30);
    expect(stats.h1.totalEggs).toBe(50);
    expect(stats.h1.totalMort).toBe(0);
  });
  it('excludes dailys outside the active period (start_date and retired_date)', () => {
    const stats = computeHousingStats(layerBatches, layerHousings, layerDailys, eggDailys);
    // The two 999-feed rows outside the window would have surfaced as 1998
    // total if the window filter were broken.
    expect(stats.h1.totalFeed).not.toBe(2028);
    expect(stats.h1.totalFeed).not.toBe(1029);
  });
  it('keys results by housing.id', () => {
    const stats = computeHousingStats(layerBatches, layerHousings, layerDailys, eggDailys);
    expect(stats).toHaveProperty('h1');
    expect(stats).toHaveProperty('h2');
    expect(stats.h2.totalFeed).toBe(40);
    expect(stats.h2.totalEggs).toBe(15);
    expect(stats.h2.totalMort).toBe(1);
  });
  it('uses the parent batchs brooder/arrival anchor for phase calc', () => {
    // h1 has parent b1 with anchor 2026-01-01. A daily on 2026-04-10 is day
    // 99 → GROWER. The single 30-lb feed row should land in growerFeed.
    const stats = computeHousingStats(layerBatches, layerHousings, layerDailys, eggDailys);
    expect(stats.h1.growerFeed).toBe(30);
    expect(stats.h1.starterFeed).toBe(0);
    expect(stats.h1.layerFeed).toBe(0);
  });
  it('handles empty inputs without throwing', () => {
    expect(computeHousingStats([], [], [], [])).toEqual({});
    expect(computeHousingStats(null, null, null, null)).toEqual({});
  });
});
