import {test, expect} from './fixtures.js';

// ============================================================================
// PWA install entry point — manifest start_url + /webforms anon load
// ============================================================================
// Locks the operator install instruction: "Open https://wcfplanner.com/webforms
// and Add to Home Screen." Two checks:
//
//   1. /manifest.webmanifest is served and start_url is /webforms (so the
//      installed PWA opens the operator hub, not the login/admin app).
//      Also pin scope=/ so a future change that scopes the SW to /webforms
//      surfaces here before it ships and breaks navigation back to /addfeed,
//      /weighins, or /fueling.
//
//   2. Anon load of /webforms renders WebformHub branding and not the
//      LoginScreen ("Broiler, Layer & Pig Planner" — the same negative
//      marker smoke.spec.js uses) — confirms the public no-auth route still
//      works after the manifest change.
//
// /webforms, /addfeed, /weighins, and the legacy /#... bookmarks are §7
// load-bearing. This spec does not touch them; it only locks that /webforms
// is the canonical install entry point.
// ============================================================================

// Anon context — operators arrive at /webforms unauthenticated. Override
// the chromium project's admin storageState the same way the offline-queue
// canary does.
test.use({storageState: {cookies: [], origins: []}});

test('manifest start_url is /webforms and scope is /', async ({request}) => {
  const res = await request.get('/manifest.webmanifest');
  expect(res.ok()).toBe(true);
  const manifest = await res.json();
  expect(manifest.start_url).toBe('/webforms');
  expect(manifest.scope).toBe('/');
});

test('anon load of /webforms renders WebformHub, not LoginScreen', async ({page}) => {
  await page.goto('/webforms');

  // Boot loader fades after first paint.
  await expect(page.locator('#wcf-boot-loader')).toHaveCount(0, {timeout: 15_000});

  // Negative — LoginScreen branding must NOT be visible. Same marker as
  // smoke.spec.js's authenticated-dashboard test, inverted: there, an
  // authenticated session must skip LoginScreen; here, an anonymous load
  // of a public route must skip LoginScreen too.
  await expect(page.locator('text=Broiler, Layer & Pig Planner')).toHaveCount(0, {timeout: 15_000});

  // Positive — WebformHub form selector copy ("Select a report type to fill
  // out") is unique to WebformHub.jsx's !activeForm branch.
  await expect(page.getByText('Select a report type to fill out')).toBeVisible({timeout: 15_000});

  // URL stays at /webforms (no redirect to / or to login).
  await expect(page).toHaveURL(/\/webforms\/?$/);
});
