import {describe, it, expect} from 'vitest';
import {calcBreedingTimeline, batchStartedCount} from './pig.js';
import {matchCycleForFarrowing, ensureFarrowBatchForCycle, farrowBatchId, farrowBatchName} from './pigFarrowBatch.js';

const cycle = {id: 'cyc-1', group: '1', exposureStart: '2026-01-01', sowCount: 4};
const cycles = [cycle];
// A farrowing date guaranteed inside the cycle's window (window start itself).
const inWindow = calcBreedingTimeline(cycle.exposureStart).farrowingStart;
const rec = (over) => ({id: 'f1', group: '1', farrowingDate: inWindow, alive: 9, ...over});

describe('matchCycleForFarrowing', () => {
  it('matches a record to its cycle by group + farrowing window', () => {
    expect(matchCycleForFarrowing(rec(), cycles)).toBe(cycle);
  });
  it('returns null for a different group', () => {
    expect(matchCycleForFarrowing(rec({group: '2'}), cycles)).toBeNull();
  });
  it('returns null for an out-of-window date', () => {
    expect(matchCycleForFarrowing(rec({farrowingDate: '2025-06-01'}), cycles)).toBeNull();
  });
  it('returns null when group/date missing', () => {
    expect(matchCycleForFarrowing({id: 'x', alive: 5}, cycles)).toBeNull();
  });
});

describe('ensureFarrowBatchForCycle', () => {
  it('creates a neutral farm-born batch on the first farrowing record', () => {
    const {next, created, batch} = ensureFarrowBatchForCycle([], cycle, [rec()], cycles);
    expect(created).toBe(true);
    expect(next).toHaveLength(1);
    expect(batch.id).toBe(farrowBatchId(cycle)); // 'farrowing-cycle-cyc-1'
    expect(batch.cycleId).toBe('cyc-1');
    expect(batch.farmBorn).toBe(true);
    expect(batch.giltCount).toBe(0); // no fake sex split
    expect(batch.boarCount).toBe(0);
    expect(batch.originalPigCount).toBe(9); // neutral started = alive
    expect(batch.status).toBe('active');
    expect(batch.subBatches).toEqual([]);
    expect(batch.batchName).toBe('P-26-01');
  });
  it('is idempotent — a second farrowing record does not duplicate or overwrite', () => {
    const first = ensureFarrowBatchForCycle([], cycle, [rec()], cycles).next;
    const second = ensureFarrowBatchForCycle(first, cycle, [rec(), rec({id: 'f2', alive: 7})], cycles);
    expect(second.created).toBe(false);
    expect(second.next).toBe(first); // same reference, untouched
    expect(second.next).toHaveLength(1);
    expect(second.next[0].originalPigCount).toBe(9); // NOT re-summed to 16
  });
  it('reuses an existing manually-linked batch (by cycleId) without overwriting counts', () => {
    const manual = {
      id: 'manual-1',
      cycleId: 'cyc-1',
      batchName: 'Manual',
      giltCount: 5,
      boarCount: 5,
      subBatches: [{id: 's', status: 'active'}],
    };
    const {next, created, batch} = ensureFarrowBatchForCycle([manual], cycle, [rec()], cycles);
    expect(created).toBe(false);
    expect(batch).toBe(manual);
    expect(next).toEqual([manual]);
  });
  it('reuses a batch already at the deterministic id even without a cycleId yet', () => {
    const gen = {id: farrowBatchId(cycle), batchName: 'P-26-01'};
    expect(ensureFarrowBatchForCycle([gen], cycle, [rec()], cycles).created).toBe(false);
  });
  it('derives the started count from totalBorn-deaths when historical records lack alive', () => {
    // Two records: one stamped alive=9, one legacy (no alive) totalBorn 11/deaths 2 → 9.
    const legacy = {id: 'f-legacy', group: '1', farrowingDate: inWindow, totalBorn: 11, deaths: 2};
    const {batch} = ensureFarrowBatchForCycle([], cycle, [rec({alive: 9}), legacy], cycles);
    expect(batch.originalPigCount).toBe(18);
  });
  it('no-ops for a cycle without an id', () => {
    const {next, created} = ensureFarrowBatchForCycle([], {group: '1'}, [rec()], cycles);
    expect(created).toBe(false);
    expect(next).toEqual([]);
  });
});

describe('farrowBatchName', () => {
  it('uses P-<YY-NN> from the sequence map', () => {
    expect(farrowBatchName(cycle, cycles)).toBe('P-26-01');
  });
  it('falls back to the cycle label when the cycle has no sequence suffix', () => {
    const noExp = {id: 'cyc-x', group: '2'};
    expect(farrowBatchName(noExp, [noExp])).toBe('Group 2');
  });
});

describe('batchStartedCount', () => {
  it('uses gilt + boar for a normal batch', () => {
    expect(batchStartedCount({giltCount: 6, boarCount: 4})).toBe(10);
  });
  it('uses originalPigCount for a farm-born batch with no sex split', () => {
    expect(batchStartedCount({giltCount: 0, boarCount: 0, farmBorn: true, originalPigCount: 9})).toBe(9);
  });
  it('is 0 for a non-farm-born batch with no gilt/boar counts (daily fallback handled upstream)', () => {
    expect(batchStartedCount({giltCount: 0, boarCount: 0, originalPigCount: 9})).toBe(0);
  });
});
