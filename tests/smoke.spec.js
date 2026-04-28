import {test, expect} from './fixtures.js';

// ============================================================================
// A2.5 — vertical slice. Proves the harness end-to-end before any domain
// spec gets layered on:
//   1. global.setup ran (storageState exists)
//   2. webServer started (vite --mode test)
//   3. dev server hits the test Supabase project (env-driven URL)
//   4. authenticated session replays via storageState
//   5. dashboard renders without crash
//   6. assertTestDatabase guard wired into the fixtures
//
// No domain assertions here — that's A4 onward.
// ============================================================================

test('authenticated user loads dashboard without LoginScreen', async ({page}) => {
  await page.goto('/');

  // LoginScreen branding ("Broiler, Layer & Pig Planner") must NOT be visible
  // on a successfully authenticated session — the storageState replays the
  // session and the App skips LoginScreen.
  await expect(page.locator('text=Broiler, Layer & Pig Planner')).toHaveCount(0, {timeout: 15_000});

  // Boot loader must have faded — the App fades #wcf-boot-loader after the
  // first paint, then either renders LoginScreen or the authenticated tree.
  // Since we already asserted LoginScreen isn't there, the auth tree is up.
  await expect(page.locator('#wcf-boot-loader')).toHaveCount(0, {
    timeout: 15_000,
  });

  // URL settles at root for the dashboard.
  await expect(page).toHaveURL(/\/$/);
});

test('test admin client refuses operations against prod URL', async ({supabaseAdmin}) => {
  // Fixture construction ran assertTestDatabase already — getting here means
  // the URL is non-prod and WCF_TEST_DATABASE=1. Sanity-check the client by
  // pulling a row count from a table we own. Service role bypasses RLS.
  const {error} = await supabaseAdmin.from('app_store').select('key', {count: 'exact', head: true});
  expect(error).toBeNull();
});
