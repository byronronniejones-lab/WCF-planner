// Pasture Map CP3 - move ledger / occupancy / rest e2e (NON-resetting). Cleans
// only the isolated pasture tables, seeds two paddocks through the existing
// append-only geometry helper, then records moves through the real UI/RPC path.
import {test, expect} from '@playwright/test';
import {getTestAdminClient} from './setup/reset.js';

const A_ID = 'pm-cp3-a';
const B_ID = 'pm-cp3-b';

const SQUARE_A =
  '{"type":"Polygon","coordinates":[[[-86.44,30.84],[-86.435,30.84],[-86.435,30.845],[-86.44,30.845],[-86.44,30.84]]]}';
const SQUARE_B =
  '{"type":"Polygon","coordinates":[[[-86.43,30.84],[-86.425,30.84],[-86.425,30.845],[-86.43,30.845],[-86.43,30.84]]]}';

async function cleanAndSeedPastureTables() {
  const c = getTestAdminClient();
  const sql = `
    TRUNCATE TABLE public.pasture_planned_moves, public.pasture_move_impacts,
      public.pasture_move_events, public.land_area_geometry_versions, public.pasture_import_batches,
      public.land_areas RESTART IDENTITY CASCADE;

    DO $$
    DECLARE v_profile uuid;
    BEGIN
      SELECT id INTO v_profile FROM public.profiles LIMIT 1;

      INSERT INTO public.land_areas
        (id, kind, name, status, review_status, geometry_status, baseline_no_history, source, created_by)
      VALUES
        ('${A_ID}', 'paddock', 'CP3 North Paddock', 'active', 'reviewed', 'none', true, 'drawn', v_profile),
        ('${B_ID}', 'paddock', 'CP3 South Paddock', 'active', 'reviewed', 'none', true, 'drawn', v_profile);

      PERFORM public._land_area_add_version(
        '${A_ID}',
        extensions.ST_SetSRID(extensions.ST_GeomFromGeoJSON('${SQUARE_A}'),4326),
        'drawn',
        '{}'::jsonb,
        v_profile
      );
      PERFORM public._land_area_add_version(
        '${B_ID}',
        extensions.ST_SetSRID(extensions.ST_GeomFromGeoJSON('${SQUARE_B}'),4326),
        'drawn',
        '{}'::jsonb,
        v_profile
      );
    END $$;
  `;
  const {error} = await c.rpc('exec_sql', {sql});
  if (error) throw new Error('seed pasture CP3: ' + error.message);
}

test.beforeAll(async () => {
  await cleanAndSeedPastureTables();
});

test('records moves and derives occupied/resting state', async ({page}) => {
  await page.setViewportSize({width: 1280, height: 900});
  await page.goto('/pasture-map', {timeout: 90_000});
  await expect(page.locator('.pm-title')).toHaveText('Pasture Map');
  await expect(page.locator(`[data-pasture-area="${A_ID}"]`)).toBeVisible({timeout: 25_000});
  await expect(page.locator(`[data-pasture-area="${B_ID}"]`)).toBeVisible();

  await page.locator(`[data-pasture-area-select="${A_ID}"]`).click();
  await expect(page.locator('[data-pasture-selected-panel]')).toContainText('CP3 North Paddock');
  await expect(page.locator('[data-pasture-move-form]')).toBeVisible();
  await page.locator('[data-pasture-move-count]').fill('12');
  await page.locator('[data-pasture-move-save]').click();
  await expect(page.locator(`[data-pasture-area="${A_ID}"]`)).toContainText('Occupied now', {timeout: 15_000});
  await expect(page.locator('[data-pasture-recent-moves]')).toContainText('Mommas');

  await page.locator(`[data-pasture-area-select="${B_ID}"]`).click();
  await page.locator('[data-pasture-move-count]').fill('12');
  await page.locator('[data-pasture-move-save]').click();
  await expect(page.locator(`[data-pasture-area="${B_ID}"]`)).toContainText('Occupied now', {timeout: 15_000});
  await expect(page.locator(`[data-pasture-area="${A_ID}"]`)).toContainText(/resting/i);

  await page.setViewportSize({width: 390, height: 844});
  await page.reload();
  await expect(page.locator(`[data-pasture-area="${B_ID}"]`)).toBeVisible({timeout: 25_000});
  await page.locator(`[data-pasture-area-select="${B_ID}"]`).click();
  await expect(page.locator('[data-pasture-move-form]').first()).toBeVisible({timeout: 25_000});
});
