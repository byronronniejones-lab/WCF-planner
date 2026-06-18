// Pasture Map CP3 - move ledger / occupancy / rest e2e (NON-resetting). Cleans
// only the isolated pasture tables, seeds two paddocks through the existing
// append-only geometry helper, then records moves through the real UI/RPC path.
import {test, expect} from '@playwright/test';
import {getTestAdminClient} from './setup/reset.js';

const A_ID = 'pm-cp3-a';
const B_ID = 'pm-cp3-b';
const MOMMA_ID = 'pm-cp3-momma';

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

    -- Deterministic real planner group: one active Mommas cow so the roster
    -- yields the cattle "Mommas" group the move form now selects (no demo
    -- presets). cattle is not in the truncate set, so delete-by-id is the clean.
    DELETE FROM public.cattle WHERE id = '${MOMMA_ID}';
    INSERT INTO public.cattle (id, tag, sex, herd, breeding_blacklist, old_tags)
    VALUES ('${MOMMA_ID}', 'PMCP3-MOMMA', 'cow', 'mommas', false, '[]'::jsonb);
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
  // View loaded (shared header migration removed the old .pm-title topbar).
  await expect(page.locator('.pm-tabs')).toBeVisible({timeout: 25_000});
  await expect(page.locator(`[data-pasture-area="${A_ID}"]`)).toBeVisible({timeout: 25_000});
  await expect(page.locator(`[data-pasture-area="${B_ID}"]`)).toBeVisible();

  // Move 1: Mommas -> A. Roster-driven group pick; count is locked/derived.
  await page.locator(`[data-pasture-area-select="${A_ID}"]`).click();
  await expect(page.locator('[data-pasture-selected-panel]')).toContainText('CP3 North Paddock');
  await expect(page.locator('[data-pasture-move-form]')).toBeVisible();
  await page.locator('[data-pasture-move-animal-type]').selectOption('cattle_herd');
  await page.locator('[data-pasture-move-group]').selectOption('mommas');
  await page.locator('[data-pasture-move-save]').click();
  // A is now occupied by Mommas — the selected panel shows the occupant + state.
  await expect(page.locator(`[data-pasture-occupancy="${A_ID}"]`)).toContainText('Mommas', {timeout: 15_000});
  await expect(page.locator('[data-pasture-selected-panel]')).toContainText('Occupied now');

  // Clear selection to return to the area index, then move 2: Mommas -> B (vacates A).
  await page.locator('[data-pasture-selected-panel]').getByRole('button', {name: 'Clear selection'}).click();
  await page.locator(`[data-pasture-area-select="${B_ID}"]`).click();
  await page.locator('[data-pasture-move-animal-type]').selectOption('cattle_herd');
  await page.locator('[data-pasture-move-group]').selectOption('mommas');
  await page.locator('[data-pasture-move-save]').click();
  await expect(page.locator(`[data-pasture-occupancy="${B_ID}"]`)).toContainText('Mommas', {timeout: 15_000});

  // Clear selection -> the area index shows B occupied and A resting.
  await page.locator('[data-pasture-selected-panel]').getByRole('button', {name: 'Clear selection'}).click();
  await expect(page.locator(`[data-pasture-area="${B_ID}"]`)).toContainText('Occupied now', {timeout: 15_000});
  await expect(page.locator(`[data-pasture-area="${A_ID}"]`)).toContainText(/resting/i);

  // The move ledger is logged in the Reports tab's grazing-days log.
  await page.locator('.pm-tabs button', {hasText: 'Reports'}).click();
  await expect(page.locator('[data-pasture-recent-moves]')).toContainText('Mommas', {timeout: 15_000});

  // Mobile: the view loads and the move form is reachable from a selected area.
  await page.setViewportSize({width: 390, height: 844});
  await page.reload();
  await expect(page.locator('.pm-tabs')).toBeVisible({timeout: 25_000});
  await expect(page.locator(`[data-pasture-area="${B_ID}"]`)).toBeVisible({timeout: 25_000});
  await page.locator(`[data-pasture-area-select="${B_ID}"]`).click();
  await expect(page.locator('[data-pasture-move-form]').first()).toBeVisible({timeout: 25_000});
});
