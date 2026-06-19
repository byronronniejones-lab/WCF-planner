// Pasture Map CP1 — import + classify e2e (NON-resetting). Cleans ONLY the
// isolated pasture tables (land_areas / land_area_geometry_versions /
// pasture_import_batches — none in the reset.js shared whitelist), imports the
// real OnX export, classifies, closes an outline candidate, and captures
// desktop/mobile + GPS screenshots for UI sign-off. Run via
// playwright.pasture.config.js on port 5199 so it cannot collide with the
// active Home-parity lane.
//
// Updated for the planner-group redesign: the shared header replaced the
// in-panel .pm-title; the area list rows are .pm-area-row (was .pm-item);
// classification + close-outline now live in the Setup tab pasture editor; the
// locate control is labeled "My Location".
import {test, expect} from '@playwright/test';
import fs from 'fs';
import path from 'path';
import {getTestAdminClient} from './setup/reset.js';

const KML_PATH = path.resolve('tests/fixtures/pasture_map_onx_sample.kml');
const SHOTS = path.resolve('pasture-map-shots');

async function cleanPastureTables() {
  const c = getTestAdminClient();
  const {error} = await c.rpc('exec_sql', {
    sql: 'TRUNCATE TABLE public.pasture_planned_moves, public.pasture_move_impacts, public.pasture_move_events, public.land_area_geometry_versions, public.pasture_import_batches, public.land_areas RESTART IDENTITY CASCADE;',
  });
  if (error) throw new Error('clean pasture tables: ' + error.message);
}

test.beforeAll(async () => {
  if (!fs.existsSync(SHOTS)) fs.mkdirSync(SHOTS, {recursive: true});
  if (!fs.existsSync(KML_PATH)) throw new Error('sample KML not found at ' + KML_PATH);
  await cleanPastureTables();
});

test('import OnX KML, classify, close outline, capture screenshots', async ({page}) => {
  // ── Empty state ──
  await page.setViewportSize({width: 1280, height: 900});
  await page.goto('/pasture-map', {timeout: 90_000});
  await expect(page.locator('.pm-tabs')).toBeVisible({timeout: 25_000});
  await expect(page.locator('.pm-empty').first()).toBeVisible({timeout: 20_000});
  await page.waitForTimeout(2000); // let NAIP tiles paint
  await page.screenshot({path: path.join(SHOTS, '01-empty-desktop.png'), fullPage: true});

  // ── Import preview ── (choosing a KML auto-switches to the Setup tab so the
  // imported areas can be classified; the preview banner renders above the tabs.)
  await page.locator('[data-pasture-import-input]').setInputFiles(KML_PATH);
  await expect(page.locator('[data-pasture-import-preview]')).toBeVisible();
  await page.screenshot({path: path.join(SHOTS, '02-import-preview-desktop.png'), fullPage: true});

  // ── Import (10 placemarks -> 10 land areas), shown in the Setup pasture editor ──
  await page.getByRole('button', {name: /^Import \d+$/}).click();
  await expect(page.locator('[data-pasture-area]')).toHaveCount(10, {timeout: 25_000});
  await page.waitForTimeout(2500); // tiles + polygons
  await page.screenshot({path: path.join(SHOTS, '03-post-import-desktop.png'), fullPage: true});

  // 4 polygons import valid (HUB/SHOP/FP 4/Area...), 6 lines as outline candidates.
  await expect(page.locator('[data-pasture-area][data-kind="unclassified"]')).toHaveCount(4);
  await expect(page.locator('[data-pasture-area][data-kind="outline_candidate"]')).toHaveCount(6);

  // ── Classification + close-outline live in the Setup tab pasture editor ──
  // Classify a polygon (an unclassified import) as a paddock via the Setup
  // designation control; the Setup row's data-kind reflects the new kind.
  const unclassifiedRow = page.locator('[data-pasture-area][data-kind="unclassified"]').first();
  await expect(unclassifiedRow).toBeVisible({timeout: 15_000});
  const classifyId = await unclassifiedRow.getAttribute('data-pasture-area');
  await page.locator(`[data-pasture-expand="${classifyId}"]`).click();
  await page.locator(`[data-pasture-designation="${classifyId}"]`).selectOption('paddock');
  await expect(page.locator(`[data-pasture-area="${classifyId}"]`)).toHaveAttribute('data-kind', 'paddock', {
    timeout: 15_000,
  });
  // One fewer unclassified import remains.
  await expect(page.locator('[data-pasture-area][data-kind="unclassified"]')).toHaveCount(3);
  await page.screenshot({path: path.join(SHOTS, '04-classified-desktop.png'), fullPage: true});

  // Close an outline candidate (a traced line) from its Setup row.
  const outlineRow = page.locator('[data-pasture-area][data-kind="outline_candidate"]').first();
  const outlineId = await outlineRow.getAttribute('data-pasture-area');
  await page.locator(`[data-pasture-expand="${outlineId}"]`).click();
  await page.locator(`[data-pasture-area="${outlineId}"]`).getByRole('button', {name: 'Close outline'}).click();
  // That area is no longer an outline candidate -> 5 remain.
  await expect(page.locator('[data-pasture-area][data-kind="outline_candidate"]')).toHaveCount(5, {timeout: 15_000});
  await page.waitForTimeout(1500);
  await page.screenshot({path: path.join(SHOTS, '05-outline-closed-desktop.png'), fullPage: true});

  // ── GPS "you are here" (mocked geolocation; best-effort) ──
  try {
    await page.context().grantPermissions(['geolocation']);
    await page.context().setGeolocation({latitude: 30.84175, longitude: -86.43686, accuracy: 8});
    await page.getByRole('button', {name: /My Location/}).click();
    await expect(page.locator('.pm-gps-msg')).toBeVisible({timeout: 10_000});
    await page.waitForTimeout(1500);
    await page.screenshot({path: path.join(SHOTS, '06-gps-locate-desktop.png'), fullPage: true});
  } catch (e) {
    console.warn('GPS screenshot skipped:', e.message);
  }

  // ── Mobile ──
  await page.setViewportSize({width: 390, height: 844});
  await page.reload();
  await expect(page.locator('[data-pasture-area]').first()).toBeVisible({timeout: 25_000});
  await page.waitForTimeout(2500);
  await page.screenshot({path: path.join(SHOTS, '07-post-import-mobile.png'), fullPage: true});
});
