import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {describe, expect, it} from 'vitest';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..', '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

const migration = read('supabase-migrations/180_pasture_direct_rest_history.sql');
const view = read('src/pasture/PastureMapView.jsx');
const proof = read('scripts/apply_test_mig_180.cjs');

function slice(src, startMarker, endMarker, label) {
  const start = src.indexOf(startMarker);
  expect(start, `${label}: start marker present`).toBeGreaterThan(-1);
  const end = src.indexOf(endMarker, start + startMarker.length);
  expect(end, `${label}: end marker present`).toBeGreaterThan(start);
  return src.slice(start, end);
}

const occupied = slice(
  migration,
  'CREATE OR REPLACE FUNCTION public._land_area_is_occupied',
  'REVOKE ALL ON FUNCTION public._land_area_is_occupied',
  '_land_area_is_occupied',
);
const summary = slice(
  migration,
  'CREATE OR REPLACE FUNCTION public._land_area_summary',
  'REVOKE ALL ON FUNCTION public._land_area_summary',
  '_land_area_summary',
);

describe('migration 180 — direct move history owns pasture state', () => {
  it('treats only a latest direct destination as occupied', () => {
    expect(occupied).toContain('l.to_land_area_id = p_id');
    expect(occupied).not.toContain('pasture_move_impacts');
    expect(occupied).not.toContain("impact_kind IN ('destination', 'overlap')");
  });

  it('keeps overlap occupants advisory but counts only direct destinations', () => {
    // Advisory overlap information remains available to the map readout.
    expect(summary).toContain("i.impact_kind IN ('destination', 'overlap')");
    expect(summary).toContain("'impact_kind', i.impact_kind");

    // State authority is a separate count over the latest move destinations,
    // not the advisory impact array.
    expect(summary).toMatch(/SELECT count\(\*\)::int\s+INTO v_current_count[\s\S]*?WHERE l\.to_land_area_id = p_id/);
    expect(summary).toMatch(/IF v_current_count > 0 THEN[\s\S]*?v_rest_state := 'occupied'/);
  });

  it('starts rest from the latest direct departure, never an overlap departure', () => {
    expect(summary).toMatch(
      /SELECT max\(m\.moved_at\)\s+INTO v_last_departure\s+FROM public\.pasture_move_events m\s+WHERE m\.from_land_area_id = p_id/,
    );
    const directDeparture = slice(
      summary,
      'SELECT max(m.moved_at)\n    INTO v_last_departure',
      '-- Latest direct grazing activity',
      'direct departure query',
    );
    expect(directDeparture).not.toContain('pasture_move_impacts');
    expect(directDeparture).not.toContain('impact_kind');
  });

  it('makes last_touched_at the latest direct arrival/departure', () => {
    expect(summary).toMatch(
      /SELECT max\(m\.moved_at\)\s+INTO v_last_touch\s+FROM public\.pasture_move_events m\s+WHERE m\.from_land_area_id = p_id\s+OR m\.to_land_area_id = p_id/,
    );
    expect(summary).toContain("'last_touched_at', v_last_touch");
    expect(summary).toContain("'last_moved_out_at', v_last_departure");
  });

  it('preserves the existing ready threshold and return shape', () => {
    expect(summary).toContain("CASE WHEN v_rest_days < 60 THEN 'resting' ELSE 'rested' END");
    for (const key of [
      'current_occupants',
      'current_occupancy_count',
      'last_touched_at',
      'last_moved_out_at',
      'rest_days',
      'rest_state',
    ]) {
      expect(summary).toContain(`'${key}'`);
    }
    expect(migration).toContain("NOTIFY pgrst, 'reload schema'");
  });
});

describe('Pasture Map client — direct stays control density and history copy', () => {
  it('excludes advisory overlap occupants from head/ac density', () => {
    const density = slice(view, 'function densityCopy(area)', 'function areaFacts(area)', 'densityCopy');
    expect(density).toContain("filter((o) => o && o.impact_kind !== 'overlap')");
    expect(density).toContain('directOccupants.reduce');
    expect(density).not.toContain('area.current_occupants.reduce');
  });

  it('renders Last grazed from the latest direct stay exit', () => {
    const history = slice(
      view,
      'function renderAreaGrazingHistory()',
      '// The ONE canonical Area Record',
      'renderAreaGrazingHistory',
    );
    expect(history).toContain('const latestStay = recordStays[0] || null;');
    expect(history).toContain('latestStay.outAt || latestStay.inAt');
    expect(history).toContain('Last grazed ${formatMoveTime(lastGrazedAt)}');
    expect(history).not.toContain('Last grazed ${formatMoveTime(area.last_touched_at)}');
  });
});

describe('migration 180 TEST proof safety and coverage', () => {
  it('is fail-closed to TEST and applies only migration 180', () => {
    expect(proof).toMatch(/WCF_TEST_DATABASE !== '1'/);
    expect(proof).toMatch(/url\.includes\(PROD_REF\)/);
    expect(proof).toContain('180_pasture_direct_rest_history.sql');
    expect(proof).not.toContain('158_pasture_map_positive_overlap_impacts.sql');
  });

  it('proves both reported overlap regressions and a direct occupied control', () => {
    expect(proof).toContain('D2 rest start');
    expect(proof).toContain('D2 Last grazed');
    expect(proof).toContain('D3 overlap must remain resting');
    expect(proof).toContain("o.impact_kind === 'overlap'");
    expect(proof).toContain('direct destination Y must remain occupied');
    expect(proof).toContain("public._land_area_is_occupied('${AREA.D3}')");
  });

  it('cleans every disposable impact, move, and area even on failure', () => {
    expect(proof).toMatch(/const errors = \[\]/);
    expect(proof).toMatch(/delete\(\)\.in\('move_id', MOVE_IDS\)/);
    expect(proof).toMatch(/from\('pasture_move_events'\)\.delete\(\)\.in\('id', MOVE_IDS\)/);
    expect(proof).toMatch(/from\('land_areas'\)\.delete\(\)\.in\('id', AREA_IDS\)/);
    expect(proof).toMatch(/\.finally\(async \(\) => \{/);
    expect(proof).toContain('CLEANUP FAIL:');
  });
});
