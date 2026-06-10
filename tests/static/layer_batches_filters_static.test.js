import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {describe, it, expect} from 'vitest';

import {
  LAYER_BATCH_STATUS_KEYS,
  LAYER_BATCH_FILTER_DIMENSIONS,
  LAYER_BATCH_SORT_KEYS,
  buildLayerBatchPredicate,
  buildLayerBatchComparator,
  layerBatchStartDate,
  layerBatchBirdCount,
} from '../../src/lib/layerBatchFilters.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..', '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

const filterLibSrc = read('src/lib/layerBatchFilters.js');
const viewSrc = read('src/layer/LayerBatchesView.jsx');
const savedViewsApi = read('src/lib/savedViewsApi.js');
const exportColumnsSrc = read('src/lib/operationalExportColumns.js');

describe('layer batch filter lib (pure module)', () => {
  it('exports the key constants, predicate, and comparator', () => {
    expect(LAYER_BATCH_SORT_KEYS).toEqual(['batchName', 'status', 'startDate', 'birdCount']);
    expect(LAYER_BATCH_STATUS_KEYS).toEqual(['active', 'retired']);
    expect(LAYER_BATCH_FILTER_DIMENSIONS).toContain('textSearch');
    expect(LAYER_BATCH_FILTER_DIMENSIONS).toContain('status');
    expect(LAYER_BATCH_FILTER_DIMENSIONS).toContain('supplier');
    expect(LAYER_BATCH_FILTER_DIMENSIONS).toContain('startDateRange');
    expect(LAYER_BATCH_FILTER_DIMENSIONS).toContain('birdCountRange');
    expect(typeof buildLayerBatchPredicate).toBe('function');
    expect(typeof buildLayerBatchComparator).toBe('function');
  });

  it('is a pure module — no React, Supabase, or browser globals', () => {
    expect(filterLibSrc).not.toMatch(/import\s+React/);
    expect(filterLibSrc).not.toMatch(/from\s+['"].*supabase/);
    expect(filterLibSrc).not.toContain('window.');
    expect(filterLibSrc).not.toContain('document.');
  });

  it('derives start date from brooder entry, then arrival', () => {
    expect(layerBatchStartDate({brooder_entry_date: '2026-01-01', arrival_date: '2025-12-01'})).toBe('2026-01-01');
    expect(layerBatchStartDate({arrival_date: '2025-12-01'})).toBe('2025-12-01');
    expect(layerBatchStartDate({})).toBe(null);
  });

  it('parses bird count defensively', () => {
    expect(layerBatchBirdCount({original_count: 200})).toBe(200);
    expect(layerBatchBirdCount({original_count: '150'})).toBe(150);
    expect(layerBatchBirdCount({original_count: null})).toBe(null);
    expect(layerBatchBirdCount({})).toBe(null);
  });

  const ROWS = [
    {id: 'a', name: 'L-26-02', status: 'active', supplier: 'Hoover', original_count: 300, arrival_date: '2026-02-01'},
    {id: 'b', name: 'L-26-01', status: 'active', supplier: 'Murray', original_count: 100, arrival_date: '2026-01-01'},
    {id: 'c', name: 'L-25-09', status: 'retired', supplier: 'Hoover', original_count: 200, arrival_date: '2025-09-01'},
  ];

  it('predicate filters by status, supplier, search, ranges', () => {
    expect(ROWS.filter(buildLayerBatchPredicate({status: 'active'})).map((r) => r.id)).toEqual(['a', 'b']);
    expect(ROWS.filter(buildLayerBatchPredicate({supplier: 'Hoover'})).map((r) => r.id)).toEqual(['a', 'c']);
    expect(ROWS.filter(buildLayerBatchPredicate({textSearch: 'L-26'})).map((r) => r.id)).toEqual(['a', 'b']);
    expect(ROWS.filter(buildLayerBatchPredicate({birdCountRange: {min: 150}})).map((r) => r.id)).toEqual(['a', 'c']);
    expect(ROWS.filter(buildLayerBatchPredicate({startDateRange: {after: '2026-01-01'}})).map((r) => r.id)).toEqual([
      'a',
      'b',
    ]);
    // Empty filters keep everything.
    expect(ROWS.filter(buildLayerBatchPredicate({})).length).toBe(3);
  });

  it('comparator honors the single active sort rule + direction', () => {
    const byName = [...ROWS].sort(buildLayerBatchComparator({key: 'batchName', dir: 'asc'})).map((r) => r.id);
    expect(byName).toEqual(['c', 'b', 'a']);
    const byBirdDesc = [...ROWS].sort(buildLayerBatchComparator({key: 'birdCount', dir: 'desc'})).map((r) => r.id);
    expect(byBirdDesc).toEqual(['a', 'c', 'b']);
    const byStatus = [...ROWS].sort(buildLayerBatchComparator({key: 'status', dir: 'asc'})).map((r) => r.status);
    expect(byStatus).toEqual(['active', 'active', 'retired']);
    // Unknown key is a stable no-op comparator.
    expect([...ROWS].sort(buildLayerBatchComparator({key: 'nope'})).map((r) => r.id)).toEqual(['a', 'b', 'c']);
  });
});

describe('LayerBatchesView wires the filter lib + saved views', () => {
  it('imports the filter lib helpers', () => {
    expect(viewSrc).toContain("from '../lib/layerBatchFilters.js'");
    expect(viewSrc).toContain('buildLayerBatchPredicate');
    expect(viewSrc).toContain('buildLayerBatchComparator');
    expect(viewSrc).toContain('LAYER_BATCH_SORT_KEYS');
  });

  it('applies predicate then comparator and renders the sorted set', () => {
    expect(viewSrc).toContain('.filter(buildLayerBatchPredicate(filters))');
    expect(viewSrc).toContain('[...filtered].sort(buildLayerBatchComparator(sortRule))');
    expect(viewSrc).toContain('const batchSeqRows = sorted;');
  });

  it('wires saved views to its own surface via the shared API owner', () => {
    expect(savedViewsApi).toContain('export async function listSavedViews');
    expect(savedViewsApi).toContain('export function buildViewState');
    expect(viewSrc).toContain("from '../lib/savedViewsApi.js'");
    expect(viewSrc).toContain("const LAYER_BATCHES_SURFACE_KEY = 'layer.batches'");
    expect(viewSrc).toContain('listSavedViews(sb, LAYER_BATCHES_SURFACE_KEY)');
    expect(viewSrc).toContain('surfaceKey: LAYER_BATCHES_SURFACE_KEY');
    expect(viewSrc).toContain('createSavedView(sb, {');
    expect(viewSrc).toContain('updateSavedView(sb, selectedView.id');
    expect(viewSrc).toContain('deleteSavedView(sb, view.id)');
    // owner is stamped server-side; never sent from the client.
    expect(viewSrc).not.toContain('owner_profile_id:');
  });

  it('round-trips view state via buildViewState with single sort rule', () => {
    expect(viewSrc).toContain('buildViewState({');
    expect(viewSrc).toContain('sortRules: [{key: sortKey, dir: sortDir}]');
    expect(viewSrc).toContain('function layerBatchesViewState()');
    expect(viewSrc).toContain('function applyLayerBatchesSavedView(view)');
  });

  it('renders the right-sized toolbar controls', () => {
    for (const marker of [
      'data-layer-batches-toolbar',
      'data-layer-batches-search',
      'data-layer-batches-status-filter',
      'data-layer-batches-supplier-filter',
      'data-layer-batches-start-after',
      'data-layer-batches-start-before',
      'data-layer-batches-bird-min',
      'data-layer-batches-bird-max',
      'data-layer-batches-sort-key',
      'data-layer-batches-sort-dir',
      'data-layer-batches-clear-filters',
      'data-layer-batches-count',
    ]) {
      expect(viewSrc).toContain(marker);
    }
  });

  it('renders saved-view controls and degrades failures locally', () => {
    for (const marker of [
      'data-layer-batches-saved-views-row',
      'data-layer-batches-saved-view-select',
      'data-layer-batches-saved-view-save-open',
      'data-layer-batches-saved-view-form',
      'data-layer-batches-saved-view-name',
      'data-layer-batches-saved-view-visibility="private"',
      'data-layer-batches-saved-view-visibility="public"',
      'data-layer-batches-saved-view-save',
      'data-layer-batches-saved-view-update',
      'data-layer-batches-saved-view-delete',
      'data-layer-batches-saved-views-error',
    ]) {
      expect(viewSrc).toContain(marker);
    }
    expect(viewSrc).toContain('Saved views unavailable. Filters still work.');
    expect(viewSrc).toContain('setSavedViewsError(e.message || String(e))');
    expect(viewSrc).toContain('window._wcfConfirmDelete');
    expect(viewSrc).not.toContain('window.prompt');
    expect(viewSrc).not.toContain('window.confirm(');
  });
});

describe('LayerBatchesView converts cards to a unified grid', () => {
  it('renders a shared-template header row + aligned rows (no card swimlanes)', () => {
    expect(viewSrc).toContain('LAYER_BATCH_GRID_COLUMNS');
    expect(viewSrc).toContain('data-layer-batches-grid-header');
    expect(viewSrc).toContain('gridTemplateColumns: LAYER_BATCH_GRID_COLUMNS');
    // The old card-era artifacts are gone.
    expect(viewSrc).not.toContain('batchColors');
    expect(viewSrc).not.toContain('RETIRED BATCHES');
    expect(viewSrc).not.toContain('StatPill');
  });

  it('keeps click-to-open with the sorted set as the record-sequence order', () => {
    expect(viewSrc).toContain('data-layer-batch-tile={row.id}');
    expect(viewSrc).toContain("recordSeqNavOptions(labeledSeqItems(batchSeqRows, 'name'))");
  });

  it('distinguishes true-empty from filtered-no-results and preserves load-error retry', () => {
    expect(viewSrc).toContain('totalBatches === 0');
    expect(viewSrc).toContain('data-empty-state="true-empty"');
    expect(viewSrc).toContain('OperationalListEmptyState');
    expect(viewSrc).toContain('filteredLabel="No layer batches match the current filters"');
    expect(viewSrc).toContain('onClick={loadLayerMetrics}');
    expect(viewSrc).toContain('Retry');
  });
});

describe('LayerBatchesView export is fed the filtered+sorted rows', () => {
  it('uses the shared export column owner unchanged', () => {
    expect(exportColumnsSrc).toContain('export function buildLayerBatchExportColumns');
    expect(viewSrc).toContain("from '../lib/operationalExportColumns.js'");
    expect(viewSrc).toContain('buildLayerBatchExportColumns({fmt})');
  });

  it('builds export rows from the sorted set, not the raw layerBatches', () => {
    expect(viewSrc).toContain('const layerBatchExportRows = sorted.map(decorateBatch);');
    expect(viewSrc).not.toContain('layerBatchExportRows = batchSeqRows.map');
    expect(viewSrc).not.toMatch(/layerBatchExportRows\s*=\s*\(layerBatches/);
  });

  it('feeds CSV and print the same filtered+sorted export rows', () => {
    expect(viewSrc).toContain('data-layer-batches-export-csv="1"');
    expect(viewSrc).toContain('data-layer-batches-print="1"');
    expect(viewSrc).toContain('rowsToCsv(exportColumns, layerBatchExportRows)');
    expect(viewSrc).toContain('rows: layerBatchExportRows');
  });
});
