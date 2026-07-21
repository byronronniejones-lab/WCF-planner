import {test, expect} from './fixtures.js';
import {waitForAppReady} from './helpers/appReady.js';

// ============================================================================
// Centralized navigation-readiness fixture — behavioral proof
// ============================================================================
// Locks the contract added to tests/fixtures.js: page.goto() on an application
// route does not resolve until the fail-closed cold-boot gate has cleared.

const ADMIN_STORAGE = 'tests/.auth/admin.json';

test.describe('auto-ready navigation', () => {
  test.use({storageState: ADMIN_STORAGE});

  test('goto() on an app route resolves only after both readiness markers clear', async ({page, resetDb}) => {
    await resetDb();
    await page.goto('/');
    // No waiting here on purpose: if goto() returned early these would be the
    // race the whole lane is about.
    await expect(page.locator('#wcf-boot-loader')).toHaveCount(0);
    await expect(page.locator('[data-farm-data-loading]')).toHaveCount(0);
  });

  test('cannot return while "Loading your farm data..." is still on screen', async ({page, resetDb}) => {
    await resetDb();
    await page.goto('/');
    // The gate's own text, asserted with zero timeout budget. If the fixture
    // let goto() resolve during cold boot this reads 1.
    expect(await page.getByText('Loading your farm data...').count()).toBe(0);
  });

  test('in-app redirect lands on the redirected route already ready', async ({page, resetDb}) => {
    await resetDb();
    // A legacy alias that redirects through src/lib/routes.js. Readiness is
    // keyed on the POST-navigation url, so the redirect target is covered.
    await page.goto('/my-tasks');
    expect(await page.getByText('Loading your farm data...').count()).toBe(0);
    await expect(page).toHaveURL(/\/tasks/);
  });

  test('external origins are not subjected to WCF readiness', async ({page}) => {
    // data: URL is a non-app origin. If the fixture tried to apply WCF
    // readiness here it would wait on markers that can never exist and the
    // 15s budget would blow this test's default 30s timeout.
    const started = Date.now();
    await page.goto('data:text/html,<title>external</title><p>external</p>');
    expect(Date.now() - started).toBeLessThan(10_000);
    await expect(page.locator('p')).toHaveText('external');
  });

  test('protects client_errors_admin_tab-style navigation (run 29840170206 shard 1)', async ({page, resetDb}) => {
    await resetDb();
    // The exact shape that failed: goto an app route, then immediately assert a
    // surface marker on the 5s default budget with no readiness call.
    await page.goto('/admin/client-errors');
    await expect(page.locator('[data-client-errors-loaded="true"]')).toBeVisible();
  });
});

test.describe('explicit loading-state opt-out', () => {
  test.use({
    storageState: ADMIN_STORAGE,
    wcfAutoReady: false,
    wcfAutoReadyReason: 'observes the pre-ready cold-boot gate itself, which auto-ready would consume',
  });

  test('opt-out lets a spec observe the pre-ready state, and the helper still works', async ({page, resetDb}) => {
    await resetDb();
    await page.goto('/');
    // With the opt-out active goto() may return mid-boot. We cannot assert the
    // gate IS present without reintroducing the race we are fixing, so assert
    // the escape hatch instead: an explicit call still reaches readiness.
    await waitForAppReady(page);
    await expect(page.locator('[data-farm-data-loading]')).toHaveCount(0);
  });
});
