// Pasture Map CP4 - planned moves / history / rest / stocking reports e2e.
// Cleans only pasture-owned tables, seeds two paddocks, then drives the UI
// through plan -> use plan -> same-day second move -> reports.
import {test, expect} from '@playwright/test';
import {getTestAdminClient} from './setup/reset.js';

const A_ID = 'pm-cp4-a';
const B_ID = 'pm-cp4-b';
const MOMMA_ID = 'pm-cp4-momma';

const SQUARE_A =
  '{"type":"Polygon","coordinates":[[[-86.44,30.84],[-86.435,30.84],[-86.435,30.845],[-86.44,30.845],[-86.44,30.84]]]}';
const SQUARE_B =
  '{"type":"Polygon","coordinates":[[[-86.43,30.84],[-86.425,30.84],[-86.425,30.845],[-86.43,30.845],[-86.43,30.84]]]}';

function localDateTimeValue(date = new Date()) {
  const pad = (n) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(
    date.getMinutes(),
  )}`;
}

async function cleanAndSeedPastureTables() {
  const c = getTestAdminClient();
  const sql = `
    TRUNCATE TABLE public.pasture_planned_moves, public.pasture_move_impacts,
      public.pasture_move_events, public.land_area_geometry_versions,
      public.pasture_import_batches, public.land_areas RESTART IDENTITY CASCADE;

    DO $$
    DECLARE v_profile uuid;
    BEGIN
      SELECT id INTO v_profile FROM public.profiles LIMIT 1;

      INSERT INTO public.land_areas
        (id, kind, name, status, review_status, geometry_status, baseline_no_history, source, created_by)
      VALUES
        ('${A_ID}', 'paddock', 'CP4 North Paddock', 'active', 'reviewed', 'none', true, 'drawn', v_profile),
        ('${B_ID}', 'paddock', 'CP4 South Paddock', 'active', 'reviewed', 'none', true, 'drawn', v_profile);

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
    -- yields the cattle "Mommas" group the plan/move forms now select.
    DELETE FROM public.cattle WHERE id = '${MOMMA_ID}';
    INSERT INTO public.cattle (id, tag, sex, herd, breeding_blacklist, old_tags)
    VALUES ('${MOMMA_ID}', 'PMCP4-MOMMA', 'cow', 'mommas', false, '[]'::jsonb);
  `;
  const {error} = await c.rpc('exec_sql', {sql});
  if (error) throw new Error('seed pasture CP4: ' + error.message);
}

test.beforeAll(async () => {
  await cleanAndSeedPastureTables();
});

test('plans a move and renders history/rest/stocking reports', async ({page}) => {
  await page.setViewportSize({width: 1280, height: 900});
  await page.goto('/pasture-map', {timeout: 90_000});
  // View loaded (shared header migration removed the old .pm-title topbar).
  await expect(page.locator('.pm-tabs')).toBeVisible({timeout: 25_000});
  await expect(page.locator(`[data-pasture-area="${A_ID}"]`)).toBeVisible({timeout: 25_000});

  // The selected panel hosts both the plan form and the move form. Create a
  // planned move and record an actual move for Mommas -> A in one place. (The
  // planned-move "Use" -> complete flow moves into Plan mode and is part of the
  // P3 Plan-tab redesign; here we verify plan creation, move recording, reports.)
  await page.locator(`[data-pasture-area-select="${A_ID}"]`).click();
  await expect(page.locator('[data-pasture-plan-form]')).toBeVisible();
  // Roster-driven: pick the real cattle "Mommas" group; count is locked/derived.
  await page.locator('[data-pasture-plan-animal-type]').selectOption('cattle_herd');
  await page.locator('[data-pasture-plan-group]').selectOption('mommas');
  await page.locator('[data-pasture-plan-at]').fill(localDateTimeValue());
  await page.locator('[data-pasture-plan-save]').click();

  await page.locator('[data-pasture-move-animal-type]').selectOption('cattle_herd');
  await page.locator('[data-pasture-move-group]').selectOption('mommas');
  await page.locator('[data-pasture-move-save]').click();
  await expect(page.locator(`[data-pasture-occupancy="${A_ID}"]`)).toContainText('Mommas', {timeout: 15_000});

  // The created plan shows in the Plan tab's planned-moves list.
  await page.locator('.pm-tabs button', {hasText: 'Plan'}).click();
  await expect(page.locator('[data-pasture-planned-moves]')).toContainText('Mommas', {timeout: 15_000});
  await expect(page.locator('[data-pasture-planned-moves]')).toContainText('CP4 North Paddock');

  // Reports tab: rest (open by default), then stocking and history.
  await page.locator('.pm-tabs button', {hasText: 'Reports'}).click();
  await expect(page.locator('[data-pasture-rest-report]')).toContainText('Occupied', {timeout: 15_000});
  await page.locator('.pm-report-card button', {hasText: 'Stocking rate'}).click();
  await expect(page.locator('[data-pasture-stocking-report]')).toContainText('animal-days');
  await page.locator('.pm-report-card button', {hasText: 'Grazing days log'}).click();
  await expect(page.locator('[data-pasture-history-report]')).toContainText('Mommas', {timeout: 15_000});
});
