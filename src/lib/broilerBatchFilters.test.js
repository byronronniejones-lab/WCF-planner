import {describe, expect, it} from 'vitest';
import {
  BROILER_BATCH_DEFAULT_SORT,
  BROILER_BATCH_FILTER_DIMENSIONS,
  BROILER_BATCH_SORT_KEYS,
  broilerBreedFilterOptions,
  broilerDistinctFieldValues,
  buildBroilerBatchComparator,
  buildBroilerBatchPredicate,
} from './broilerBatchFilters.js';

const batch = (over = {}) => ({
  id: over.id || over.name || 'b',
  name: 'B-26-01',
  status: 'processed',
  breed: 'CC',
  hatchery: 'Mt. Healthy',
  brooder: 'Brooder 1',
  schooner: 'Schooner A',
  hatchDate: '2026-01-01',
  processingDate: '2026-03-01',
  birdCount: 500,
  birdCountActual: 490,
  totalToProcessor: 470,
  mortalityCumulative: 20,
  ...over,
});

const keep = (filters, rows, ctx) => rows.filter(buildBroilerBatchPredicate(filters, ctx)).map((b) => b.id);

describe('broilerBatchFilters — exports', () => {
  it('declares the expanded real-field filter dimensions', () => {
    for (const dim of [
      'status',
      'breed',
      'hatchery',
      'brooder',
      'schooner',
      'startDateRange',
      'processingDateRange',
      'birdCountRange',
      'birdsArrivedRange',
      'toProcessorRange',
      'mortalityRange',
      'lbsProducedRange',
      'textSearch',
    ]) {
      expect(BROILER_BATCH_FILTER_DIMENSIONS).toContain(dim);
    }
  });

  it('adds a processingDate sort key and defaults to processed newest-first', () => {
    expect(BROILER_BATCH_SORT_KEYS).toContain('processingDate');
    expect(BROILER_BATCH_DEFAULT_SORT).toEqual({key: 'processingDate', dir: 'desc'});
  });
});

describe('broilerBatchFilters — predicate', () => {
  const rows = [
    batch({id: 'a', hatchery: 'Mt. Healthy', brooder: 'Brooder 1', schooner: 'Schooner A', breed: 'CC'}),
    batch({id: 'b', hatchery: 'Ridgway', brooder: 'Brooder 2', schooner: 'Schooner B', breed: 'WR'}),
  ];

  it('filters by hatchery, brooder, schooner, and breed (case-insensitive)', () => {
    expect(keep({hatchery: ['ridgway']}, rows)).toEqual(['b']);
    expect(keep({brooder: ['Brooder 1']}, rows)).toEqual(['a']);
    expect(keep({schooner: ['Schooner B']}, rows)).toEqual(['b']);
    expect(keep({breed: ['CC']}, rows)).toEqual(['a']);
  });

  it('filters by processing-date range and excludes batches with no processing date', () => {
    const list = [
      batch({id: 'old', processingDate: '2025-06-01'}),
      batch({id: 'new', processingDate: '2026-06-01'}),
      batch({id: 'planned', status: 'planned', processingDate: null}),
    ];
    expect(keep({processingDateRange: {after: '2026-01-01'}}, list)).toEqual(['new']);
  });

  it('filters by numeric ranges and excludes rows missing the value', () => {
    const list = [
      batch({id: 'small', birdCount: 100}),
      batch({id: 'big', birdCount: 900}),
      batch({id: 'none', birdCount: null}),
    ];
    expect(keep({birdCountRange: {min: 500}}, list)).toEqual(['big']);
    expect(keep({toProcessorRange: {max: 480}}, [batch({id: 'x', totalToProcessor: 470})])).toEqual(['x']);
    expect(keep({mortalityRange: {min: 50}}, [batch({id: 'y', mortalityCumulative: 20})])).toEqual([]);
  });

  it('reads lbsProduced via ctx.totalFeedLbsOf', () => {
    const ctx = {totalFeedLbsOf: (b) => (b.id === 'heavy' ? 1000 : 100)};
    const list = [batch({id: 'heavy'}), batch({id: 'light'})];
    expect(keep({lbsProducedRange: {min: 500}}, list, ctx)).toEqual(['heavy']);
  });

  it('uses ctx.statusOf for the status filter and text-searches real fields', () => {
    const ctx = {statusOf: (b) => (b.id === 'act' ? 'active' : 'processed')};
    const list = [batch({id: 'act'}), batch({id: 'proc'})];
    expect(keep({status: ['active']}, list, ctx)).toEqual(['act']);
    expect(keep({textSearch: 'ridgway'}, [batch({id: 'r', hatchery: 'Ridgway'})])).toEqual(['r']);
  });
});

describe('broilerBatchFilters — comparator', () => {
  it('default sort puts newest processed first and no-date batches last', () => {
    const rows = [
      batch({id: 'mid', processingDate: '2026-02-01'}),
      batch({id: 'new', processingDate: '2026-05-01'}),
      batch({id: 'planned', status: 'planned', processingDate: null}),
      batch({id: 'old', processingDate: '2026-01-01'}),
    ];
    const sorted = [...rows].sort(buildBroilerBatchComparator(BROILER_BATCH_DEFAULT_SORT));
    expect(sorted.map((b) => b.id)).toEqual(['new', 'mid', 'old', 'planned']);
  });

  it('falls back to the default sort for an unknown key', () => {
    const rows = [batch({id: 'x', processingDate: '2026-01-01'}), batch({id: 'y', processingDate: '2026-09-01'})];
    const sorted = [...rows].sort(buildBroilerBatchComparator({key: 'nope', dir: 'asc'}));
    expect(sorted.map((b) => b.id)).toEqual(['y', 'x']);
  });
});

describe('broilerBatchFilters — option helpers', () => {
  it('lists distinct non-empty field values sorted', () => {
    const rows = [
      batch({hatchery: 'Ridgway'}),
      batch({hatchery: 'Mt. Healthy'}),
      batch({hatchery: 'Ridgway'}),
      batch({hatchery: ''}),
    ];
    expect(broilerDistinctFieldValues(rows, 'hatchery')).toEqual(['Mt. Healthy', 'Ridgway']);
  });

  it('keeps known breed codes plus observed legacy codes', () => {
    const opts = broilerBreedFilterOptions(['ZZ'], (c) => c);
    expect(opts.map((o) => o.code)).toEqual(expect.arrayContaining(['CC', 'WR', 'FR', 'CY', 'ZZ']));
  });
});
