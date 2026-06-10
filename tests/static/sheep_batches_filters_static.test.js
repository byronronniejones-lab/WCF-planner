import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {describe, it, expect} from 'vitest';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..', '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

const filtersLib = read('src/lib/sheepBatchFilters.js');
const batchesView = read('src/sheep/SheepBatchesView.jsx');
const savedViewsApi = read('src/lib/savedViewsApi.js');
const exportColumns = read('src/lib/operationalExportColumns.js');
const csvExport = read('src/lib/csvExport.js');
const printExport = read('src/lib/printExport.js');

// ============================================================================
// Sheep Batches operational-list parity lock (surface_key sheep.batches).
// The pure filter/sort lib, the toolbar + saved-view wiring, the cards ->
// unified-grid conversion, and the filtered+sorted export feed.
// ============================================================================

describe('sheep batch filters — pure module shape', () => {
  it('exports the sort keys, filter dimensions, predicate and comparator', () => {
    expect(filtersLib).toContain('export const SHEEP_BATCH_SORT_KEYS');
    expect(filtersLib).toContain('export const SHEEP_BATCH_FILTER_DIMENSIONS');
    expect(filtersLib).toContain('export const SHEEP_BATCH_STATUS_KEYS');
    expect(filtersLib).toContain('export function buildSheepBatchPredicate(filters, ctx');
    expect(filtersLib).toContain('export function buildSheepBatchComparator(sortRule, ctx');
  });

  it('locks the real hub sort keys (batchName/status/plannedDate/animalCount/yieldPct)', () => {
    for (const key of ['batchName', 'status', 'plannedDate', 'animalCount', 'yieldPct']) {
      expect(filtersLib).toContain(`'${key}'`);
    }
  });

  it('filters over the real batch fields and the hub statuses', () => {
    expect(filtersLib).toContain("'planned'");
    expect(filtersLib).toContain("'complete'");
    expect(filtersLib).toContain('planned_process_date');
    expect(filtersLib).toContain('animal_count');
    expect(filtersLib).toContain('yield_pct');
    expect(filtersLib).toContain('textSearch');
    expect(filtersLib).toContain('plannedDateRange');
    expect(filtersLib).toContain('animalCountRange');
  });

  it('stays a pure module — no React / Supabase / browser globals', () => {
    expect(filtersLib).not.toContain("from 'react'");
    expect(filtersLib).not.toContain('supabase');
    expect(filtersLib).not.toContain('window.');
    expect(filtersLib).not.toContain('document.');
  });

  it('runs a single active sort rule, not a multi-rule comparator', () => {
    expect(filtersLib).toContain('buildSheepBatchComparator(sortRule, ctx');
    expect(filtersLib).not.toContain('sortRules.filter');
  });
});

describe('sheep batches view — imports + saved views (surface_key sheep.batches)', () => {
  it('imports the pure filter lib', () => {
    expect(batchesView).toContain("from '../lib/sheepBatchFilters.js'");
    expect(batchesView).toContain('buildSheepBatchPredicate');
    expect(batchesView).toContain('buildSheepBatchComparator');
  });

  it('wires saved views to its own surface via the shared API owner', () => {
    expect(savedViewsApi).toContain('export async function listSavedViews');
    expect(savedViewsApi).toContain('export async function createSavedView');
    expect(savedViewsApi).toContain('export async function updateSavedView');
    expect(savedViewsApi).toContain('export async function deleteSavedView');
    expect(batchesView).toContain("from '../lib/savedViewsApi.js'");
    expect(batchesView).toContain("SHEEP_BATCHES_SURFACE_KEY = 'sheep.batches'");
    expect(batchesView).toContain('listSavedViews(sb, SHEEP_BATCHES_SURFACE_KEY)');
    expect(batchesView).toContain('surfaceKey: SHEEP_BATCHES_SURFACE_KEY');
    expect(batchesView).toContain('createSavedView(sb, {');
    expect(batchesView).toContain('updateSavedView(sb, selectedView.id');
    expect(batchesView).toContain('deleteSavedView(sb, view.id)');
  });

  it('saved state captures filters + the single sort rule + viewMode', () => {
    expect(batchesView).toContain(
      'buildViewState({filters, sortRules: [{key: sortRule.key, dir: sortRule.dir}], viewMode',
    );
  });

  it('renders the saved-view controls and degrades load failures locally', () => {
    for (const marker of [
      'data-sheep-batches-saved-views-row',
      'data-sheep-batches-saved-view-select',
      'data-sheep-batches-saved-view-save-open',
      'data-sheep-batches-saved-view-form',
      'data-sheep-batches-saved-view-name',
      'data-sheep-batches-saved-view-visibility="private"',
      'data-sheep-batches-saved-view-visibility="public"',
      'data-sheep-batches-saved-view-save',
      'data-sheep-batches-saved-view-update',
      'data-sheep-batches-saved-view-delete',
      'data-sheep-batches-saved-views-error',
    ]) {
      expect(batchesView).toContain(marker);
    }
    expect(batchesView).toContain('Saved views unavailable. Filters still work.');
    expect(batchesView).toContain('setSavedViewsError(e.message || String(e))');
    expect(batchesView).toContain('window._wcfConfirmDelete');
    expect(batchesView).not.toContain('window.prompt');
    expect(batchesView).not.toContain('window.confirm');
  });
});

describe('sheep batches view — toolbar filters + sort', () => {
  it('renders search, status, planned-date range, count range, sort + direction, clear', () => {
    for (const marker of [
      'data-sheep-batches-toolbar',
      'data-sheep-batches-search',
      'data-sheep-batches-status-filter',
      'data-sheep-batches-planned-after',
      'data-sheep-batches-planned-before',
      'data-sheep-batches-count-min',
      'data-sheep-batches-count-max',
      'data-sheep-batches-sort-key',
      'data-sheep-batches-sort-dir',
      'data-sheep-batches-clear-filters',
    ]) {
      expect(batchesView).toContain(marker);
    }
  });

  it('shows a visible-of-total count', () => {
    expect(batchesView).toContain('data-sheep-batches-count');
    expect(batchesView).toContain('{sortedBatches.length} of {batches.length}');
  });
});

describe('sheep batches view — cards converted to a unified grid', () => {
  it('renders an aligned grid via a shared column template, not stacked cards', () => {
    expect(batchesView).toContain('SHEEP_BATCH_GRID_COLUMNS');
    expect(batchesView).toContain('data-sheep-batches-grid');
    expect(batchesView).toContain('function BatchRow(');
    // The old free-flow card component is gone.
    expect(batchesView).not.toContain('function BatchTile(');
  });

  it('preserves the per-row data attributes + click-to-open navigation', () => {
    expect(batchesView).toContain('data-batch-row={batch.id}');
    expect(batchesView).toContain('data-batch-name={batch.name}');
    expect(batchesView).toContain('data-batch-status={batch.status}');
    expect(batchesView).toContain('labeledSeqItems(batchSeqRows');
    expect(batchesView).toContain("navigate('/sheep/batches/' + b.id");
  });
});

describe('sheep batches view — empty / filtered / fail-closed states', () => {
  it('distinguishes true-empty from filtered-no-results', () => {
    expect(batchesView).toContain('data-sheep-batches-empty');
    expect(batchesView).toContain('data-sheep-batches-no-match');
    expect(batchesView).toContain('No sheep processing batches match the current filters.');
    expect(batchesView).toContain('batches.length > 0 && sortedBatches.length === 0');
  });

  it('clears stale rows + offers retry on load failure', () => {
    expect(batchesView).toContain('setBatches([]);');
    expect(batchesView).toContain('data-sheep-batches-load-retry="1"');
  });
});

describe('sheep batches view — filtered + sorted export feed (shared owners untouched)', () => {
  it('keeps the shared processing-batch export builder as owner', () => {
    expect(exportColumns).toContain('export function buildProcessingBatchExportColumns');
    expect(batchesView).toContain("from '../lib/operationalExportColumns.js'");
    expect(batchesView).toContain('buildProcessingBatchExportColumns({fmt, animalLabel');
  });

  it('uses the shared csv + print owners for browser mechanics', () => {
    expect(csvExport).toContain('export function rowsToCsv');
    expect(csvExport).toContain('export function downloadCsv');
    expect(printExport).toContain('export function printRows');
  });

  it('feeds CSV + print the SORTED rows, never the raw batches', () => {
    expect(batchesView).toContain('const batchSeqRows = sortedBatches;');
    expect(batchesView).toContain('const batchExportRows = sortedBatches;');
    expect(batchesView).toContain('rowsToCsv(exportColumns, batchExportRows)');
    expect(batchesView).toContain('rows: batchExportRows');
    expect(batchesView).not.toContain('rowsToCsv(exportColumns, batches)');
    expect(batchesView).not.toContain('rows: batches');
  });

  it('runs the augment -> filter -> sort pipeline off one array', () => {
    expect(batchesView).toContain('const augmentedBatches');
    expect(batchesView).toContain('buildSheepBatchPredicate(filters');
    expect(batchesView).toContain('buildSheepBatchComparator(sortRule');
    expect(batchesView).toContain('[...filteredBatches].sort(cmp)');
  });
});
