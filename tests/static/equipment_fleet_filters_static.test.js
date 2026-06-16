import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {describe, it, expect} from 'vitest';
import {buildEquipmentFleetPredicate} from '../../src/lib/equipmentFleetFilters.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..', '..');

const fleetView = fs.readFileSync(path.join(ROOT, 'src/equipment/EquipmentFleetView.jsx'), 'utf8');
const filtersLib = fs.readFileSync(path.join(ROOT, 'src/lib/equipmentFleetFilters.js'), 'utf8');
const savedViewsApi = fs.readFileSync(path.join(ROOT, 'src/lib/savedViewsApi.js'), 'utf8');

// ============================================================================
// Equipment Fleet operational-list parity lock (surface_key equipment.fleet):
// pure filter/sort lib + toolbar saved-views CRUD + filtered/sorted feeding
// both render and CSV/print export.
// ============================================================================

describe('equipmentFleetFilters — pure filter/sort module', () => {
  it('exports the sort keys + filter dimension constants', () => {
    expect(filtersLib).toContain('export const EQUIPMENT_FLEET_SORT_KEYS');
    expect(filtersLib).toContain('export const EQUIPMENT_FLEET_FILTER_DIMENSIONS');
    for (const key of ['name', 'category', 'status', 'daysSinceFueling']) {
      expect(filtersLib).toContain(`'${key}'`);
    }
  });

  it('exports a predicate factory and a single-rule comparator factory', () => {
    expect(filtersLib).toContain('export function buildEquipmentFleetPredicate(filters, ctx');
    expect(filtersLib).toContain('export function buildEquipmentFleetComparator(sortRule, ctx');
  });

  it('filters over REAL equipment fields (not invented ones)', () => {
    expect(filtersLib).toContain('row.status');
    expect(filtersLib).toContain('row.category');
    expect(filtersLib).toContain('row.fuel_type');
    expect(filtersLib).toContain('row.tracking_unit');
    expect(filtersLib).toContain('row.serial_number');
    expect(filtersLib).toContain('row.name');
  });

  it('is a pure module — no React / Supabase / browser globals', () => {
    expect(filtersLib).not.toMatch(/from 'react'/);
    expect(filtersLib).not.toMatch(/from '\.\.\/lib\/supabase/);
    expect(filtersLib).not.toContain('document.');
    expect(filtersLib).not.toContain('window.');
  });
});

describe('EquipmentFleetView — imports the pure filter lib', () => {
  it('imports the keys + predicate + comparator from equipmentFleetFilters', () => {
    expect(fleetView).toContain("from '../lib/equipmentFleetFilters.js'");
    expect(fleetView).toContain('EQUIPMENT_FLEET_SORT_KEYS');
    expect(fleetView).toContain('buildEquipmentFleetPredicate');
    expect(fleetView).toContain('buildEquipmentFleetComparator');
  });

  it('applies predicate then comparator (filter then sort)', () => {
    expect(fleetView).toContain('buildEquipmentFleetPredicate(filters, filterCtx)');
    expect(fleetView).toContain('[...filtered].sort(buildEquipmentFleetComparator(sortRule, filterCtx))');
  });
});

describe('EquipmentFleetView — toolbar + saved views (surface_key equipment.fleet)', () => {
  it('declares the equipment.fleet surface key', () => {
    expect(fleetView).toContain("EQUIPMENT_FLEET_SURFACE_KEY = 'equipment.fleet'");
  });

  it('imports the saved-views API and renders save/select/update/delete controls', () => {
    expect(fleetView).toContain("from '../lib/savedViewsApi.js'");
    expect(fleetView).toContain('data-equipment-saved-view-select');
    expect(fleetView).toContain('data-equipment-saved-view-save');
    expect(fleetView).toContain('data-equipment-saved-view-update');
    expect(fleetView).toContain('data-equipment-saved-view-delete');
    expect(fleetView).toContain('data-equipment-saved-view-visibility');
  });

  it('builds saved state from filters + [sortRule] + viewMode', () => {
    expect(savedViewsApi).toContain('filters');
    expect(savedViewsApi).toContain('sortRules');
    expect(savedViewsApi).toContain('viewMode');
    expect(fleetView).toContain('buildViewState({filters, sortRules: [sortRule], viewMode})');
  });

  it('renders search / status / category / fuel / sort toolbar controls + count', () => {
    expect(fleetView).toContain('data-equipment-fleet-search');
    expect(fleetView).toContain('data-equipment-fleet-status-filter');
    expect(fleetView).toContain('data-equipment-fleet-category-filter');
    expect(fleetView).toContain('data-equipment-fuel-type');
    expect(fleetView).toContain('data-equipment-fleet-sort-key');
    expect(fleetView).toContain('data-equipment-fleet-sort-dir');
    expect(fleetView).toContain('data-equipment-fleet-clear-filters');
    expect(fleetView).toContain('data-equipment-fleet-count');
  });

  it('fuel-type filter uses the canonical "gasoline" value (not "gas")', () => {
    // App-wide canonical equipment fuel_type is 'diesel' | 'gasoline' | null
    // (EquipmentAddModal, EquipmentFuelLogView, the fuel webforms). The fleet
    // filter MUST match that or the gasoline filter silently selects nothing.
    expect(fleetView).toContain("{key: 'gasoline', label: 'Gasoline'}");
    expect(fleetView).not.toContain("{key: 'gas', label: 'Gas'}");
  });

  it('saved-view load failures degrade gracefully (never block the list)', () => {
    expect(fleetView).toContain('data-equipment-saved-views-error');
    expect(fleetView).toContain('savedViewsError');
  });
});

describe('EquipmentFleetView — empty / filtered states', () => {
  it('keeps the true-empty message but distinguishes filtered-no-results', () => {
    expect(fleetView).toContain('No equipment yet. Run the Podio import');
    expect(fleetView).toContain('data-equipment-fleet-no-match');
    expect(fleetView).toContain('No equipment match the current filters.');
  });
});

describe('EquipmentFleetView — sold equipment section', () => {
  it('splits sold equipment out of active render groups behind a collapsed section', () => {
    expect(fleetView).toContain('const [soldOpen, setSoldOpen] = useState(false)');
    expect(fleetView).toMatch(
      /activeSorted\s*=\s*useMemo\(\(\) => sorted\.filter\(\(eq\) => eq\.status !== 'sold'\), \[sorted\]\)/,
    );
    expect(fleetView).toMatch(
      /soldSorted\s*=\s*useMemo\(\(\) => sorted\.filter\(\(eq\) => eq\.status === 'sold'\), \[sorted\]\)/,
    );
    expect(fleetView).toContain('data-equipment-fleet-sold-section');
    expect(fleetView).toContain('data-equipment-fleet-sold-toggle');
    expect(fleetView).toContain('aria-expanded={soldOpen}');
    expect(fleetView).toContain('{soldOpen && (');
  });

  it('builds category and uncategorized groups from active rows only', () => {
    expect(fleetView).toContain(
      'EQUIPMENT_CATEGORIES.map((cat) => ({...cat, rows: activeSorted.filter((e) => e.category === cat.key)}))',
    );
    expect(fleetView).toContain(
      'const uncategorized = useMemo(() => activeSorted.filter((e) => !CATEGORY_BY_KEY[e.category]), [activeSorted])',
    );
    expect(fleetView).not.toContain('rows: sorted.filter((e) => e.category === cat.key)');
    expect(fleetView).not.toContain('const uncategorized = useMemo(() => sorted.filter');
  });

  it('keeps sold rows after active rows for sequence/export without making no-match lie', () => {
    expect(fleetView).toContain(
      "viewMode === 'flat' ? activeSorted : [...grouped.flatMap((g) => g.rows), ...uncategorized]",
    );
    expect(fleetView).toContain(
      'const fleetSeqRows = useMemo(() => [...activeSeqRows, ...soldSorted], [activeSeqRows, soldSorted])',
    );
    expect(fleetView).toContain('const filteredEmpty = sorted.length === 0');
    expect(fleetView).toContain('{!filteredEmpty && soldSection}');
  });
});

describe('EquipmentFleetView — export feeds the filtered+sorted rows, not raw', () => {
  it('still uses the shared export column owner unchanged', () => {
    expect(fleetView).toContain("from '../lib/operationalExportColumns.js'");
    expect(fleetView).toContain('buildEquipmentFleetExportColumns({fmt, fmtReading})');
  });

  it('derives export rows from the sorted sequence (fleetSeqRows), not equipment', () => {
    expect(fleetView).toContain('fleetSeqRows.map((eq)');
    expect(fleetView).toContain('rowsToCsv(exportColumns, fleetExportRows)');
    expect(fleetView).toContain('rows: fleetExportRows');
    // fleetSeqRows is built from the sorted set, not the raw equipment prop.
    expect(fleetView).toContain(
      "viewMode === 'flat' ? activeSorted : [...grouped.flatMap((g) => g.rows), ...uncategorized]",
    );
    expect(fleetView).toContain(
      'const fleetSeqRows = useMemo(() => [...activeSeqRows, ...soldSorted], [activeSeqRows, soldSorted])',
    );
    expect(fleetView).not.toContain('equipment.map((eq) => {');
  });

  it('passes the sorted sequence as the record-nav order to onOpen', () => {
    expect(fleetView).toContain('onOpen(eq.slug, fleetSeqRows)');
  });
});

describe('buildEquipmentFleetPredicate — fuel_type matches the canonical values', () => {
  const gasolineRow = {id: 'e1', fuel_type: 'gasoline'};
  const dieselRow = {id: 'e2', fuel_type: 'diesel'};
  const noFuelRow = {id: 'e3', fuel_type: null};

  it("fuelType ['gasoline'] includes a gasoline row and excludes diesel", () => {
    const p = buildEquipmentFleetPredicate({fuelType: ['gasoline']}, {});
    expect(p(gasolineRow)).toBe(true);
    expect(p(dieselRow)).toBe(false);
  });

  it("fuelType ['diesel'] excludes a gasoline row", () => {
    const p = buildEquipmentFleetPredicate({fuelType: ['diesel']}, {});
    expect(p(gasolineRow)).toBe(false);
    expect(p(dieselRow)).toBe(true);
  });

  it("fuelType ['unset'] includes a row with fuel_type null and excludes typed rows", () => {
    const p = buildEquipmentFleetPredicate({fuelType: ['unset']}, {});
    expect(p(noFuelRow)).toBe(true);
    expect(p(gasolineRow)).toBe(false);
  });
});
