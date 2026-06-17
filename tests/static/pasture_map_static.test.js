import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {describe, expect, it} from 'vitest';
import {VIEW_TO_PATH, PATH_TO_VIEW} from '../../src/lib/routes.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '../..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

const mig = read('supabase-migrations/116_pasture_map_land_areas.sql');
const mig127 = read('supabase-migrations/127_pasture_map_draw_edit.sql');
const mig128 = read('supabase-migrations/128_pasture_map_move_ledger.sql');
const mig129 = read('supabase-migrations/129_pasture_map_planning_reports.sql');
const mainSrc = read('src/main.jsx');
const homeSrc = read('src/dashboard/HomeDashboard.jsx');
const viewSrc = read('src/pasture/PastureMapView.jsx');
const canvasSrc = read('src/pasture/PastureMapCanvas.jsx');
const apiSrc = read('src/lib/pastureMapApi.js');
const offlineSrc = read('src/lib/pastureOffline.js');
const pasturePwConfig = read('playwright.pasture.config.js');

describe('Pasture Map route + wiring', () => {
  it('registers the canonical /pasture-map path', () => {
    expect(VIEW_TO_PATH.pastureMap).toBe('/pasture-map');
    expect(PATH_TO_VIEW['/pasture-map']).toBe('pastureMap');
  });

  it('main.jsx imports, allows, renders, and excludes Light from the view', () => {
    expect(mainSrc).toContain("import PastureMapView from './pasture/PastureMapView.jsx'");
    expect(mainSrc).toMatch(/VALID_VIEWS\s*=\s*\[[\s\S]*?'pastureMap'/);
    expect(mainSrc).toContain("if (view === 'pastureMap')");
    const lightAllowedBlock = mainSrc.match(/const LIGHT_ALLOWED_VIEWS[\s\S]*?new Set\(\[([\s\S]*?)\]\)/)?.[1] || '';
    expect(lightAllowedBlock).not.toContain("'pastureMap'");
  });

  it('home page exposes the Pasture Map field button', () => {
    const fieldBlock = homeSrc.slice(homeSrc.indexOf('field-tools'), homeSrc.indexOf('Utility row'));
    expect(fieldBlock).toContain("setView('pastureMap')");
    expect(fieldBlock).toContain('Pasture Map');
    expect(fieldBlock).toContain('HomeWeatherCard');
  });
});

describe('Migration 116 — RLS / SECDEF / access', () => {
  it('all three tables are deny-all RLS with no direct anon/authenticated grants', () => {
    for (const t of ['land_areas', 'land_area_geometry_versions', 'pasture_import_batches']) {
      expect(mig).toContain(`ALTER TABLE public.${t} ENABLE ROW LEVEL SECURITY`);
      expect(mig).toMatch(new RegExp(`REVOKE ALL ON TABLE public\\.${t} FROM PUBLIC, anon, authenticated`));
    }
    expect(mig).toContain('FOR ALL USING (false)');
  });

  it('client RPCs are SECURITY DEFINER and granted to authenticated only', () => {
    for (const fn of [
      'import_land_area_batch',
      'list_land_areas',
      'update_land_area',
      'close_land_area_outline',
      'delete_land_area',
    ]) {
      expect(mig).toContain(`CREATE OR REPLACE FUNCTION public.${fn}`);
      expect(mig).toMatch(new RegExp(`GRANT EXECUTE ON FUNCTION public\\.${fn}\\([^)]*\\) TO authenticated`));
    }
    expect(mig).toContain("v_role NOT IN ('farm_team', 'management', 'admin')");
  });
});

describe('Migration 116 — CP1 invariants', () => {
  it("kind CHECK includes 'unclassified' and import defaults polygons to it", () => {
    expect(mig).toMatch(/kind IN \([^)]*'unclassified'/);
    expect(mig).toContain("v_kind  := 'unclassified';");
  });

  it('LineStrings are NEVER auto-closed (import sets outline_candidate)', () => {
    expect(mig).toContain("v_kind  := 'outline_candidate';");
    expect(mig).toContain("v_gstatus := 'outline_candidate';");
  });

  it('parent assignment has a recursive-CTE cycle guard (A>B rejects B>A)', () => {
    expect(mig).toMatch(/WITH RECURSIVE ancestors/);
    expect(mig).toContain('parent assignment would create a cycle');
  });

  it('close reclassifies only outline candidates or fixed-invalid polygons', () => {
    expect(mig).toMatch(/v_row\.kind = 'outline_candidate' OR v_row\.geometry_status = 'invalid'/);
  });

  it('import creates the batch row BEFORE the loop so the FK resolves', () => {
    const lockIdx = mig.indexOf("pg_advisory_xact_lock(hashtext('land_areas_import')");
    const batchInsertIdx = mig.indexOf('INSERT INTO public.pasture_import_batches');
    const loopIdx = mig.indexOf('FOR v_pm IN SELECT * FROM jsonb_array_elements(p_placemarks)');
    expect(lockIdx).toBeGreaterThan(-1);
    expect(batchInsertIdx).toBeGreaterThan(lockIdx);
    expect(batchInsertIdx).toBeLessThan(loopIdx);
  });

  it('acreage is geodesic (geography cast), not planar', () => {
    expect(mig).toMatch(/ST_Area\(p_geom::extensions\.geography\)/);
  });
});

describe('Pasture Map view - CP1/CP3 scope boundary', () => {
  it('only imports pasture-scoped data modules (no daily report coupling)', () => {
    const libImports = [...viewSrc.matchAll(/import\s[^;]*?from\s+'(\.\.\/lib\/[^']+)'/g)].map((m) => m[1]);
    expect(libImports.length).toBeGreaterThan(0);
    expect(libImports.every((p) => /pastureMapApi|pastureKml|pastureOffline/.test(p))).toBe(true);
  });

  it('exposes import + classify + close-outline actions', () => {
    expect(viewSrc).toContain('Import OnX KML');
    expect(viewSrc).toContain('Close outline');
    expect(viewSrc).toContain('classifyLandArea');
  });
});

describe('Migration 127 — CP2 draw/edit RPCs', () => {
  it('create_land_area + update_land_area_geometry are SECDEF, authenticated-only, mgmt/admin gated', () => {
    for (const fn of ['create_land_area', 'update_land_area_geometry']) {
      expect(mig127).toContain(`CREATE OR REPLACE FUNCTION public.${fn}`);
      expect(mig127).toMatch(new RegExp(`GRANT EXECUTE ON FUNCTION public\\.${fn}\\([^)]*\\) TO authenticated`));
    }
    expect(mig127).toContain("v_role NOT IN ('management', 'admin')");
  });

  it('reuses the append-only version helper and rejects invalid polygons', () => {
    expect(mig127).toContain('_land_area_add_version');
    expect(mig127).toMatch(/ST_IsValid/);
  });

  it('an edited area records its new version as a human draw, not the original source', () => {
    expect(mig127).toMatch(/_land_area_add_version\(\s*p_id,\s*v_geom,\s*'drawn'/);
    expect(mig127).toContain("'origin_source', v_row.source");
  });
});

describe('CP2 API wrappers + draw/edit UI', () => {
  it('pastureMapApi exposes create/update-geometry wrappers over the mig 127 RPCs', () => {
    expect(apiSrc).toContain('export async function createLandArea');
    expect(apiSrc).toContain('export async function updateLandAreaGeometry');
    expect(apiSrc).toContain('export function newLandAreaId');
    expect(apiSrc).toContain("sb.rpc('create_land_area'");
    expect(apiSrc).toContain("sb.rpc('update_land_area_geometry'");
  });

  it('view has select/draw/edit/measure modes and an in-app name+kind save form', () => {
    for (const m of ['select', 'draw', 'edit', 'measure']) {
      expect(viewSrc).toContain(`data-mode="${m}"`);
    }
    expect(viewSrc).toContain('data-pasture-drawform-name');
    expect(viewSrc).toContain('data-pasture-drawform-kind');
    expect(viewSrc).toContain('createLandArea');
    expect(viewSrc).toContain('updateLandAreaGeometry');
  });

  it('uses NO raw browser alert/confirm/prompt in the view or canvas', () => {
    for (const src of [viewSrc, canvasSrc]) {
      expect(src).not.toMatch(/\b(?:window\.)?(?:alert|confirm|prompt)\s*\(/);
    }
  });

  it('disables Edit for selections without a polygon (outline candidates must be closed first)', () => {
    expect(viewSrc).toContain('function hasPolygonGeom');
    expect(viewSrc).toContain('!selectedEditable');
  });
});

describe('Migration 128 - CP3 move ledger / occupancy / rest', () => {
  it('adds append-only move tables with deny-all RLS and no direct grants', () => {
    for (const t of ['pasture_move_events', 'pasture_move_impacts']) {
      expect(mig128).toContain(`CREATE TABLE IF NOT EXISTS public.${t}`);
      expect(mig128).toContain(`ALTER TABLE public.${t} ENABLE ROW LEVEL SECURITY`);
      expect(mig128).toMatch(new RegExp(`REVOKE ALL ON TABLE public\\.${t} FROM PUBLIC, anon, authenticated`));
      expect(mig128).toContain('FOR ALL USING (false)');
    }
  });

  it('keeps animal groups decoupled from land and livestock tables', () => {
    expect(mig128).toContain("animal_type IN ('cattle_herd', 'sheep_flock'");
    expect(mig128).toContain('group_key');
    expect(mig128).toContain('group_label');
    expect(mig128).not.toMatch(/REFERENCES public\.(?:cattle|sheep|pig|pigs|app_store)/);
  });

  it('records destination, overlap, and departure impacts for rest resets', () => {
    for (const kind of ["'destination'", "'overlap'", "'departure'"]) {
      expect(mig128).toContain(kind);
    }
    expect(mig128).toContain('ST_Intersects');
    expect(mig128).toContain('baseline_no_history = false');
  });

  it('exposes move RPCs as SECDEF authenticated-only and farm-team readable/writeable', () => {
    for (const fn of ['list_pasture_moves', 'record_pasture_move']) {
      expect(mig128).toContain(`CREATE OR REPLACE FUNCTION public.${fn}`);
      expect(mig128).toMatch(new RegExp(`GRANT EXECUTE ON FUNCTION public\\.${fn}\\([^)]*\\)\\s+TO authenticated`));
    }
    expect(mig128).toContain("v_role NOT IN ('farm_team', 'management', 'admin')");
    expect(mig128).toContain('feeder pig area already occupied');
  });

  it('extends land area summaries with current occupancy and rest state', () => {
    for (const field of [
      'current_occupants',
      'current_occupancy_count',
      'last_touched_at',
      'last_moved_out_at',
      'rest_days',
      'rest_state',
    ]) {
      expect(mig128).toContain(field);
    }
  });
});

describe('CP3 API + UI wiring', () => {
  it('pastureMapApi wraps the CP3 move RPCs and ids', () => {
    expect(apiSrc).toContain('export function newPastureMoveId');
    expect(apiSrc).toContain('export async function listPastureMoves');
    expect(apiSrc).toContain('export async function recordPastureMove');
    expect(apiSrc).toContain("sb.rpc('list_pasture_moves'");
    expect(apiSrc).toContain("sb.rpc('record_pasture_move'");
  });

  it('view renders move form, occupancy, rest, and recent moves without raw browser prompts', () => {
    for (const marker of [
      'data-pasture-selected-panel',
      'data-pasture-move-form',
      'data-pasture-move-save',
      'data-pasture-occupancy',
      'data-pasture-rest-state',
      'data-pasture-recent-moves',
    ]) {
      expect(viewSrc).toContain(marker);
    }
    expect(viewSrc).toContain('recordPastureMove');
    expect(viewSrc).not.toMatch(/\b(?:window\.)?(?:alert|confirm|prompt)\s*\(/);
  });

  it('canvas colors by CP3 occupancy/rest state', () => {
    for (const marker of ['rest_state', 'current_occupancy_count', 'occupied', 'resting', 'rested', 'baseline']) {
      expect(canvasSrc).toContain(marker);
    }
  });

  it('allows field-level over-zoom on NAIP imagery', () => {
    expect(canvasSrc).toContain('const MAP_MAX_ZOOM = 22');
    expect(canvasSrc).toContain('const IMAGERY_NATIVE_MAX_ZOOM = 19');
    expect(canvasSrc).toContain('maxNativeZoom: IMAGERY_NATIVE_MAX_ZOOM');
    expect(canvasSrc).toContain('maxZoom: MAP_MAX_ZOOM');
  });

  it('does not refit the map on occupancy-only refreshes', () => {
    expect(canvasSrc).toContain('fitSignatureRef');
    expect(canvasSrc).toContain('fitSignature !== fitSignatureRef.current');
  });
});

describe('Migration 129 - CP4 planned moves / reports', () => {
  it('adds planned moves with deny-all RLS and no direct grants', () => {
    expect(mig129).toContain('CREATE TABLE IF NOT EXISTS public.pasture_planned_moves');
    expect(mig129).toContain('ALTER TABLE public.pasture_planned_moves ENABLE ROW LEVEL SECURITY');
    expect(mig129).toMatch(/REVOKE ALL ON TABLE public\.pasture_planned_moves FROM PUBLIC, anon, authenticated/);
    expect(mig129).toContain('FOR ALL USING (false)');
  });

  it('keeps planned animal groups decoupled from livestock tables', () => {
    expect(mig129).toContain("animal_type IN ('cattle_herd', 'sheep_flock'");
    expect(mig129).toContain('group_key');
    expect(mig129).toContain('group_label');
    expect(mig129).not.toMatch(/REFERENCES public\.(?:cattle|sheep|pig|pigs|app_store)/);
  });

  it('exposes CP4 RPCs as SECDEF authenticated-only farm-team-readable/writeable APIs', () => {
    for (const fn of [
      'list_pasture_planned_moves',
      'create_pasture_planned_move',
      'update_pasture_planned_move_status',
      'list_pasture_history_report',
      'list_pasture_rest_report',
      'list_pasture_stocking_report',
    ]) {
      expect(mig129).toContain(`CREATE OR REPLACE FUNCTION public.${fn}`);
      expect(mig129).toMatch(new RegExp(`GRANT EXECUTE ON FUNCTION public\\.${fn}\\([^)]*\\)\\s+TO authenticated`));
    }
    expect(mig129).toContain("v_role NOT IN ('farm_team', 'management', 'admin')");
  });

  it('reports paddock/group history, rest state, and animal-days per acre', () => {
    expect(mig129).toContain('list_pasture_history_report');
    expect(mig129).toContain('list_pasture_rest_report');
    expect(mig129).toContain('list_pasture_stocking_report');
    expect(mig129).toContain('animal_days_per_acre');
    expect(mig129).toContain('impact_kind IN (');
  });
});

describe('CP4 API + UI wiring', () => {
  it('pastureMapApi wraps planned move and report RPCs', () => {
    for (const marker of [
      'newPasturePlanId',
      'listPasturePlannedMoves',
      'createPasturePlannedMove',
      'updatePasturePlannedMoveStatus',
      'listPastureHistoryReport',
      'listPastureRestReport',
      'listPastureStockingReport',
    ]) {
      expect(apiSrc).toContain(marker);
    }
  });

  it('view renders CP4 forms/reports and same-day prompt without raw browser prompts', () => {
    for (const marker of [
      'data-pasture-plan-form',
      'data-pasture-plan-save',
      'data-pasture-planned-moves',
      'data-pasture-same-day-prompt',
      'data-pasture-density',
      'data-pasture-use-facts',
      'data-pasture-history-report',
      'data-pasture-rest-report',
      'data-pasture-stocking-report',
    ]) {
      expect(viewSrc).toContain(marker);
    }
    expect(viewSrc).not.toMatch(/\b(?:window\.)?(?:alert|confirm|prompt)\s*\(/);
  });

  it('shows exact rested day counts instead of threshold text', () => {
    expect(viewSrc).toContain('area.rest_days');
    expect(viewSrc).toMatch(/area\.rest_days[\s\S]{0,140}rested/);
    expect(viewSrc).not.toMatch(/Rested\s+\d+\+\s+days/);
  });

  it('pasture Playwright lane includes CP4 coverage', () => {
    expect(pasturePwConfig).toContain('pasture_map_cp4.spec.js');
  });
});

describe('CP5 offline field use wiring', () => {
  it('reuses the shared offline queue owner instead of opening IndexedDB directly', () => {
    expect(offlineSrc).toContain("from './offlineQueue.js'");
    expect(offlineSrc).not.toMatch(/from 'idb'/);
    expect(offlineSrc).not.toMatch(/\bopenDB\s*\(/);
    expect(offlineSrc).not.toMatch(/\bindexedDB\b/);
    expect(offlineSrc).toContain("PASTURE_OFFLINE_FORM_KIND = 'pasture_map'");
  });

  it('caches vector outlines separately from imagery and does not cache map tiles', () => {
    expect(offlineSrc).toContain('PASTURE_VECTOR_CACHE_KEY');
    expect(offlineSrc).toContain('cachePastureSnapshot');
    expect(offlineSrc).toContain('loadPastureSnapshot');
    expect(offlineSrc).not.toMatch(/tile|NAIP|Imagery|cacheStorage|caches\.open/i);
  });

  it('queues move logging and field-created paddocks', () => {
    expect(offlineSrc).toContain("op === 'record_move'");
    expect(offlineSrc).toContain("op === 'create_area'");
    expect(viewSrc).toContain("op: 'record_move'");
    expect(viewSrc).toContain("op: 'create_area'");
    expect(viewSrc).toContain('queued_offline');
  });

  it('renders offline field status and queue controls', () => {
    for (const marker of ['data-pasture-offline-panel', 'data-pasture-offline-queued', 'data-pasture-offline-stuck']) {
      expect(viewSrc).toContain(marker);
    }
  });

  it('pasture Playwright lane includes CP5 offline coverage', () => {
    expect(pasturePwConfig).toContain('pasture_map_cp5.spec.js');
  });
});
