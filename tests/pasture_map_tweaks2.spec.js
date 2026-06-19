// Pasture Map tweak lane #2 e2e (NON-resetting; cleans only the isolated pasture
// tables). Covers: selection dismissal (X / Escape / empty-background click), the
// Setup "open outlines - needs closing" surface (count / zoom / close), and that
// animal occupancy survives toggling the boundary overlay off.
import {test, expect} from '@playwright/test';
import {getTestAdminClient} from './setup/reset.js';

const A_ID = 'pm-tw2-a';
const B_ID = 'pm-tw2-b';
const OUT_ID = 'pm-tw2-outline';
const MOMMA_ID = 'pm-tw2-momma';

const SQUARE_A =
  '{"type":"Polygon","coordinates":[[[-86.44,30.84],[-86.435,30.84],[-86.435,30.845],[-86.44,30.845],[-86.44,30.84]]]}';
const SQUARE_B =
  '{"type":"Polygon","coordinates":[[[-86.40,30.865],[-86.395,30.865],[-86.395,30.87],[-86.40,30.87],[-86.40,30.865]]]}';
// An OPEN line (4 corners, not closed) -> outline candidate that can be closed.
const OPEN_LINE =
  '{"type":"LineString","coordinates":[[-86.44,30.84],[-86.435,30.84],[-86.435,30.845],[-86.44,30.845]]}';

async function exec(sql) {
  const {error} = await getTestAdminClient().rpc('exec_sql', {sql});
  if (error) throw new Error('seed pasture tweaks2: ' + error.message);
}

const TRUNCATE = `
  TRUNCATE TABLE public.pasture_planned_moves, public.pasture_move_impacts, public.pasture_move_events,
    public.land_area_geometry_versions, public.pasture_import_batches, public.land_areas RESTART IDENTITY CASCADE;
`;

async function seedTwoAreas() {
  await exec(`
    ${TRUNCATE}
    DO $$ DECLARE v_profile uuid; BEGIN
      SELECT id INTO v_profile FROM public.profiles LIMIT 1;
      INSERT INTO public.land_areas (id, kind, name, status, review_status, geometry_status, baseline_no_history, source, created_by) VALUES
        ('${A_ID}','paddock','TW2 Paddock A','active','reviewed','none',true,'drawn',v_profile),
        ('${B_ID}','paddock','TW2 Paddock B','active','reviewed','none',true,'drawn',v_profile);
      PERFORM public._land_area_add_version('${A_ID}', extensions.ST_SetSRID(extensions.ST_GeomFromGeoJSON('${SQUARE_A}'),4326),'drawn','{}'::jsonb,v_profile);
      PERFORM public._land_area_add_version('${B_ID}', extensions.ST_SetSRID(extensions.ST_GeomFromGeoJSON('${SQUARE_B}'),4326),'drawn','{}'::jsonb,v_profile);
    END $$;
  `);
}

test('selection dismissal: X button, Escape, and empty-background click', async ({page}) => {
  await seedTwoAreas();
  await page.setViewportSize({width: 1280, height: 900});
  await page.goto('/pasture-map', {timeout: 90_000});
  await expect(page.locator('.pm-tabs')).toBeVisible({timeout: 25_000});

  const panel = page.locator('[data-pasture-selected-panel]');

  // X button.
  await page.locator(`[data-pasture-area-select="${A_ID}"]`).first().click();
  await expect(panel).toBeVisible();
  await page.locator('[data-pasture-clear-selection]').click();
  await expect(panel).toHaveCount(0);

  // Escape key.
  await page.locator(`[data-pasture-area-select="${A_ID}"]`).first().click();
  await expect(panel).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(panel).toHaveCount(0);

  // Empty-background click: the two paddocks are far apart, so the map center is
  // empty imagery. Clicking it clears the selection.
  await page.locator(`[data-pasture-area-select="${A_ID}"]`).first().click();
  await expect(panel).toBeVisible();
  const box = await page.locator('.pm-map').boundingBox();
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  await expect(panel).toHaveCount(0);
});

test('Setup open-outlines surface lists, zooms, and closes an open shape', async ({page}) => {
  // Outline candidates keep their LineString in raw_geometry (the versions table
  // is polygon-only), mirroring create_land_area_track.
  await exec(`
    ${TRUNCATE}
    DO $$ DECLARE v_profile uuid; BEGIN
      SELECT id INTO v_profile FROM public.profiles LIMIT 1;
      INSERT INTO public.land_areas
        (id, kind, name, status, review_status, geometry_status, baseline_no_history, raw_geometry, source, raw_notes, created_by)
      VALUES
        ('${OUT_ID}','outline_candidate','TW2 Open Trace','active','pending_review','outline_candidate',true,
         extensions.ST_SetSRID(extensions.ST_GeomFromGeoJSON('${OPEN_LINE}'),4326),'drawn','created_via=field_track',v_profile);
    END $$;
  `);
  await page.setViewportSize({width: 1280, height: 900});
  await page.goto('/pasture-map', {timeout: 90_000});
  await expect(page.locator('.pm-tabs')).toBeVisible({timeout: 25_000});
  await page.locator('.pm-tabs button', {hasText: 'Setup'}).click();

  const card = page.locator('[data-pasture-open-outlines]');
  await expect(card).toBeVisible({timeout: 15_000});
  await expect(page.locator('[data-pasture-open-outline-count]')).toHaveText('1');
  await expect(page.locator(`[data-pasture-open-outline="${OUT_ID}"]`)).toBeVisible();

  // Zoom selects the outline (read-only Map detail reflects the selection).
  await page.locator(`[data-pasture-open-outline-zoom="${OUT_ID}"]`).click();

  // Close the outline -> it becomes a closed polygon and leaves the surface.
  await page.locator(`[data-pasture-open-outline-close="${OUT_ID}"]`).click();
  await expect(card).toHaveCount(0, {timeout: 15_000});
});

test('animal occupancy survives toggling the boundary overlay off', async ({page}) => {
  await exec(`
    ${TRUNCATE}
    DO $$ DECLARE v_profile uuid; BEGIN
      SELECT id INTO v_profile FROM public.profiles LIMIT 1;
      INSERT INTO public.land_areas (id, kind, name, status, review_status, geometry_status, baseline_no_history, source, created_by) VALUES
        ('${A_ID}','paddock','TW2 Occupied A','active','reviewed','none',true,'drawn',v_profile);
      PERFORM public._land_area_add_version('${A_ID}', extensions.ST_SetSRID(extensions.ST_GeomFromGeoJSON('${SQUARE_A}'),4326),'drawn','{}'::jsonb,v_profile);
    END $$;
    DELETE FROM public.cattle WHERE id='${MOMMA_ID}';
    INSERT INTO public.cattle (id,tag,sex,herd,breeding_blacklist,old_tags) VALUES ('${MOMMA_ID}','PMTW2-MOMMA','cow','mommas',false,'[]'::jsonb);
  `);
  await page.setViewportSize({width: 1280, height: 900});
  await page.goto('/pasture-map', {timeout: 90_000});
  await expect(page.locator('.pm-tabs')).toBeVisible({timeout: 25_000});

  // Record Mommas -> Paddock A in the Plan tab.
  await page.locator('.pm-tabs button', {hasText: 'Plan'}).click();
  await page.locator(`[data-pasture-area-select="${A_ID}"]`).first().click();
  await expect(page.locator('[data-pasture-move-form]').first()).toBeVisible({timeout: 15_000});
  await page.locator('[data-pasture-move-group]').selectOption({label: 'Mommas'});
  await page.locator('[data-pasture-move-save]').click();
  await page.waitForTimeout(1000);

  // Back on the Map, the occupant marker is present.
  await page.locator('.pm-tabs button', {hasText: 'Map'}).click();
  const marker = page.locator('.pm-occupant-marker').filter({hasText: 'Mommas'});
  await expect(marker).toHaveCount(1, {timeout: 15_000});

  // Toggle the Paddocks boundary overlay OFF -> occupancy marker must remain.
  await page.locator('[data-pasture-boundary="paddock"]').click();
  await expect(page.locator('[data-pasture-boundary="paddock"]')).toHaveAttribute('data-pasture-boundary-on', '0');
  await expect(marker).toHaveCount(1);
});
