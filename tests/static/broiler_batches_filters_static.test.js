import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {describe, it, expect} from 'vitest';

// Broiler Batches operational-list parity — locks the pure filter lib shape,
// the view's wiring to it, the broiler.batches saved-view surface, and that the
// CSV/print export is fed the FILTERED + SORTED set (not the raw batches).

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..', '..');
const lib = fs.readFileSync(path.join(ROOT, 'src/lib/broilerBatchFilters.js'), 'utf8');
const view = fs.readFileSync(path.join(ROOT, 'src/broiler/BroilerListView.jsx'), 'utf8');

describe('broilerBatchFilters lib', () => {
  it('exports the sort keys, filter dimensions, statuses, predicate, and comparator', () => {
    expect(lib).toMatch(/export const BROILER_BATCH_SORT_KEYS\b/);
    expect(lib).toMatch(/export const BROILER_BATCH_FILTER_DIMENSIONS\b/);
    expect(lib).toMatch(/export const BROILER_BATCH_STATUSES\b/);
    expect(lib).toMatch(/export function buildBroilerBatchPredicate\(/);
    expect(lib).toMatch(/export function buildBroilerBatchComparator\(/);
  });

  it('declares the hub-specific sort keys over real fields', () => {
    for (const key of ['batchName', 'status', 'startDate', 'birdCount', 'lbsProduced']) {
      expect(lib).toContain(`'${key}'`);
    }
  });

  it('declares the real broiler statuses', () => {
    for (const status of ['planned', 'active', 'processed']) {
      expect(lib).toContain(`'${status}'`);
    }
  });

  it('is a pure module (no React / Supabase / browser globals)', () => {
    expect(lib).not.toMatch(/from ['"]react['"]/);
    expect(lib).not.toMatch(/supabase/i);
    expect(lib).not.toMatch(/\bwindow\b|\bdocument\b|sessionStorage|localStorage/);
  });

  it('uses a single active sort rule (right-sized, not multi-rule)', () => {
    // The comparator takes one sortRule object, not an array of rules.
    expect(lib).toMatch(/buildBroilerBatchComparator\(sortRule\b/);
  });
});

describe('BroilerListView wiring', () => {
  it('imports the filter lib helpers', () => {
    expect(view).toContain("from '../lib/broilerBatchFilters.js'");
    expect(view).toContain('buildBroilerBatchPredicate');
    expect(view).toContain('buildBroilerBatchComparator');
  });

  it('applies predicate then comparator to derive the filtered + sorted set', () => {
    expect(view).toMatch(/batches\.filter\(buildBroilerBatchPredicate\(/);
    expect(view).toMatch(/\[\.\.\.filtered\]\.sort\(buildBroilerBatchComparator\(/);
  });

  it('uses the broiler.batches saved-view surface_key', () => {
    expect(view).toContain("'broiler.batches'");
    expect(view).toContain('buildViewState');
    expect(view).toContain('listSavedViews');
    expect(view).toContain('createSavedView');
    expect(view).toContain('updateSavedView');
    expect(view).toContain('deleteSavedView');
  });

  it('saves view state via buildViewState with a single sort rule + grouped mode', () => {
    expect(view).toMatch(/buildViewState\(\{filters, sortRules, viewMode: 'grouped'\}\)/);
  });

  it('feeds the SORTED set to the export rows (not the raw batches)', () => {
    // broilerExportRows must map over `sorted`, the filtered+sorted set.
    expect(view).toMatch(/const broilerExportRows = sorted\.map\(/);
    // The old hard-coded raw concatenation must be gone.
    expect(view).not.toContain('[...activeRows, ...processedCardRows].map');
  });

  it('reuses the shared export column builder unchanged', () => {
    expect(view).toContain('buildBroilerBatchExportColumns({fmt})');
  });

  it('derives the rendered sections from the sorted set', () => {
    expect(view).toMatch(/const activeRows = sorted\.filter\(/);
    expect(view).toMatch(/const processedCardRows = sorted\.filter\(/);
  });

  it('distinguishes true-empty from filtered-no-results', () => {
    expect(view).toContain("data-broiler-batches-empty={totalCount === 0 ? 'true' : 'filtered'}");
    expect(view).toContain('No broiler batches match the current filters');
  });

  it('exposes the toolbar controls + count', () => {
    for (const hook of [
      'data-broiler-search',
      'data-broiler-status-filter',
      'data-broiler-breed-filter',
      'data-broiler-sort',
      'data-broiler-clear-filters',
      'data-broiler-count',
    ]) {
      expect(view).toContain(hook);
    }
  });

  it('preserves the record-navigation contract on row click', () => {
    expect(view).toContain('openBatch(b, activeRows)');
    expect(view).toContain('openBatch(b, processedCardRows)');
  });
});
