import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {describe, it, expect} from 'vitest';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..', '..');

const batchesView = fs.readFileSync(path.join(ROOT, 'src/cattle/CattleBatchesView.jsx'), 'utf8');
const filtersLibPath = path.join(ROOT, 'src/lib/cattleBatchFilters.js');
const filtersLib = fs.readFileSync(filtersLibPath, 'utf8');
const savedViewsApi = fs.readFileSync(path.join(ROOT, 'src/lib/savedViewsApi.js'), 'utf8');

// ============================================================================
// Cattle Batches operational-list parity — pure filter lib + toolbar + saved
// views (surface_key cattle.batches) + filtered/sorted export wiring.
// Right-sized: a single active sort rule, a flat toolbar (no chip popovers),
// pipeline sections preserved with one toolbar filtering across all of them.
// ============================================================================

describe('cattleBatchFilters pure module', () => {
  it('exists as a pure module (no React / Supabase / browser globals)', () => {
    expect(fs.existsSync(filtersLibPath)).toBe(true);
    expect(filtersLib).not.toMatch(/from ['"]react['"]/);
    expect(filtersLib).not.toMatch(/supabase/i);
    expect(filtersLib).not.toMatch(/\bwindow\b/);
    expect(filtersLib).not.toMatch(/\bdocument\b/);
  });

  it('exports the predicate + comparator factories', () => {
    expect(filtersLib).toContain('export function buildCattleBatchPredicate');
    expect(filtersLib).toContain('export function buildCattleBatchComparator');
  });

  it('exports the sort-key + filter-dimension + status-key constants', () => {
    expect(filtersLib).toContain('export const CATTLE_BATCH_SORT_KEYS');
    expect(filtersLib).toContain('export const CATTLE_BATCH_FILTER_DIMENSIONS');
    expect(filtersLib).toContain('export const CATTLE_BATCH_STATUS_KEYS');
  });

  it('covers the hub sort keys over real batch fields', () => {
    for (const key of ['batchName', 'status', 'plannedDate', 'animalCount', 'yieldPct']) {
      expect(filtersLib).toContain(`'${key}'`);
    }
  });

  it('covers the hub filter dimensions (search / status / planned-date / count)', () => {
    for (const dim of ['textSearch', 'status', 'plannedDateRange', 'animalCountRange']) {
      expect(filtersLib).toContain(`'${dim}'`);
    }
  });

  it('drives status filter + sort over the real status enum (scheduled/active/complete)', () => {
    expect(filtersLib).toContain("['scheduled', 'active', 'complete']");
  });
});

describe('CattleBatchesView imports + uses the pure filter lib', () => {
  it('imports the predicate, comparator, and key constants', () => {
    expect(batchesView).toContain("from '../lib/cattleBatchFilters.js'");
    expect(batchesView).toContain('buildCattleBatchPredicate');
    expect(batchesView).toContain('buildCattleBatchComparator');
    expect(batchesView).toContain('CATTLE_BATCH_SORT_KEYS');
    expect(batchesView).toContain('CATTLE_BATCH_STATUS_KEYS');
  });

  it('builds a predicate + a single-rule comparator from toolbar state', () => {
    expect(batchesView).toContain('const EXTENDED_LIST_CONTROLS_ENABLED = false;');
    expect(batchesView).toContain('const effectiveFilters = EXTENDED_LIST_CONTROLS_ENABLED ? filters : {};');
    expect(batchesView).toContain('const batchPredicate = buildCattleBatchPredicate(effectiveFilters)');
    expect(batchesView).toContain('const batchComparator = buildCattleBatchComparator(effectiveSortRule)');
    // Single active sort rule (right-sized), not a multi-rule array.
    expect(batchesView).toMatch(/sortRule.*=.*usePersistentViewState\('cattle\.batches\.sortRule'/);
  });

  it('renders the toolbar controls (search / status / ranges / sort / clear / count)', () => {
    expect(batchesView).toContain('data-cattle-batches-toolbar');
    expect(batchesView).toContain('data-cattle-batches-search');
    expect(batchesView).toContain('data-cattle-batches-status-option');
    expect(batchesView).toContain('data-cattle-batches-planned-after');
    expect(batchesView).toContain('data-cattle-batches-planned-before');
    expect(batchesView).toContain('data-cattle-batches-count-min');
    expect(batchesView).toContain('data-cattle-batches-count-max');
    expect(batchesView).toContain('data-cattle-batches-sort-key');
    expect(batchesView).toContain('data-cattle-batches-sort-dir');
    expect(batchesView).toContain('data-cattle-batches-clear-filters');
    expect(batchesView).toContain('data-cattle-batches-count');
  });
});

describe('CattleBatches saved views (surface_key cattle.batches)', () => {
  it('imports the saved-views API and pins the surface key', () => {
    expect(batchesView).toContain("from '../lib/savedViewsApi.js'");
    expect(batchesView).toContain("CATTLE_BATCHES_SURFACE_KEY = 'cattle.batches'");
  });

  it('renders save / select / update / delete + visibility controls', () => {
    expect(batchesView).toContain('data-cattle-batches-saved-view-select');
    expect(batchesView).toContain('data-cattle-batches-saved-view-save');
    expect(batchesView).toContain('data-cattle-batches-saved-view-update');
    expect(batchesView).toContain('data-cattle-batches-saved-view-delete');
    expect(batchesView).toContain('data-cattle-batches-saved-view-visibility');
  });

  it('saved state captures filters + sortRules + viewMode via buildViewState', () => {
    expect(savedViewsApi).toContain('filters');
    expect(savedViewsApi).toContain('sortRules');
    expect(savedViewsApi).toContain('viewMode');
    expect(batchesView).toContain('buildViewState({filters, sortRules: [sortRule], viewMode: ');
  });

  it('saved-view load failure degrades gracefully without blocking the list', () => {
    expect(batchesView).toContain('data-cattle-batches-saved-views-error');
    expect(batchesView).toContain('savedViewsError');
  });
});

describe('CattleBatches CSV + print export are fed the filtered + sorted rows', () => {
  it('builds the export rows from the filtered/sorted pipeline pairs, not the raw batches list', () => {
    // batchExportRows is assembled from the post-filter, post-sort pairs
    // (scheduled + active + completed-when-expanded), then projected to the
    // enriched export shape. Prettier keeps this short array on one line, so
    // the spreads are asserted individually rather than as a fixed block.
    expect(batchesView).toContain('const batchExportRows = [');
    expect(batchesView).toContain('...scheduledPairs,');
    expect(batchesView).toContain('...activePairs,');
    expect(batchesView).toContain('...(showCompleted ? completedPairs : [])');
    expect(batchesView).toContain('.map(\n    (p) => p.enriched,\n  )');
    // The export must NOT be handed the raw, unfiltered batches array.
    expect(batchesView).not.toContain('rowsToCsv(exportColumns, batches)');
    expect(batchesView).not.toContain('rows: batches');
  });

  it('CSV + print consume batchExportRows', () => {
    expect(batchesView).toContain('data-cattle-batches-export-csv="1"');
    expect(batchesView).toContain('data-cattle-batches-print="1"');
    expect(batchesView).toContain('rowsToCsv(exportColumns, batchExportRows)');
    expect(batchesView).toContain('rows: batchExportRows');
  });

  it('record-sequence nav steps the filtered + sorted set', () => {
    // batchSeqRows is the filtered + sorted visible order and is what feeds
    // labeledSeqItems for click-through.
    expect(batchesView).toContain(
      'const batchSeqRows = [...scheduledVisible, ...activeVisible, ...(showCompleted ? completedVisible : [])]',
    );
    expect(batchesView).toContain("labeledSeqItems(batchSeqRows, 'name')");
  });

  it('reuses the shared processing-batch export column builder (unchanged shared file)', () => {
    expect(batchesView).toContain("from '../lib/operationalExportColumns.js'");
    expect(batchesView).toContain("buildProcessingBatchExportColumns({fmt, animalLabel: 'Cow'})");
  });
});

describe('CattleBatches filtered-vs-empty states', () => {
  it('distinguishes filtered-no-results from true-empty per pipeline section', () => {
    expect(batchesView).toContain('data-cattle-batches-scheduled-empty-filtered');
    expect(batchesView).toContain('data-cattle-batches-active-empty-filtered');
    expect(batchesView).toContain('data-cattle-batches-processed-empty-filtered');
    // True-empty in-process message is preserved.
    expect(batchesView).toContain('No in-process batches. Cattle enter an in-process batch only via');
  });

  it('keeps the pipeline sections + the existing scheduled/processed contract intact', () => {
    expect(batchesView).toContain('data-scheduled-section');
    expect(batchesView).toContain('Show Complete Batches');
    expect(batchesView).toContain("completed = batches.filter((b) => b.status === 'complete')");
  });
});
