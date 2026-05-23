// One-shot UX sweep — boots each operator surface at desktop + three mobile
// widths, captures a full-page screenshot, and probes for concrete layout
// signals (horizontal scroll on body, viewport overflow). NOT part of the
// regression floor — intended for ad-hoc audit runs only.
//
// EXCLUDED from CI: `npm run test:e2e:ci` (and the verify workflow) passes
// `--grep-invert ux-audit` so this file does NOT run on push to main. The
// 2026-05-23 verify run for 46a2f51 hit the 20-min workflow timeout inside
// this spec; nothing failed, the job just ran out of time. Run it locally
// when you need fresh screenshots:
//
//   npx playwright test tests/ux_audit.spec.js
//
// Screenshots land under test-results/ux-audit/<viewport>/<surface>.png so
// they can be read back and inspected. Page-level metrics are echoed via
// console.log so the run report shows scrollWidth/innerWidth deltas next
// to each visit.

import {test, expect} from '@playwright/test';

const VIEWPORTS = [
  {label: 'desktop', width: 1280, height: 800},
  {label: '360x780', width: 360, height: 780},
  {label: '390x844', width: 390, height: 844},
  {label: '430x932', width: 430, height: 932},
];

// All surfaces. `requiresAuth` controls whether the page uses the shared
// admin storageState or an anonymous context. `setup` lets us drive the
// page into a specific tab before the screenshot when the URL alone is
// ambiguous (e.g. /admin defaults to the Webforms tab on first paint).
const SURFACES = [
  {key: 'tasks', path: '/tasks', requiresAuth: true},
  {key: 'admin-webforms', path: '/admin?tab=webforms', requiresAuth: true},
  {key: 'admin-feedcosts', path: '/admin?tab=feedcosts', requiresAuth: true},
  {key: 'cattle-dailys', path: '/cattle/dailys', requiresAuth: true},
  {key: 'sheep-dailys', path: '/sheep/dailys', requiresAuth: true},
  {key: 'public-dailys', path: '/dailys', requiresAuth: false},
  {key: 'public-addfeed', path: '/addfeed', requiresAuth: false},
  {key: 'cattle-batches', path: '/cattle/batches', requiresAuth: true},
  // Equipment fleet detail — pick the first equipment slug at runtime; the
  // fleet list page itself is a useful checkpoint too.
  {key: 'fleet-list', path: '/fleet', requiresAuth: true},
];

async function probeAndCapture(page, surface, vp) {
  // Wait for the boot loader to clear when present; some routes don't have
  // it (anon public forms render straight). Loosely tolerant.
  try {
    await page.locator('#wcf-boot-loader').waitFor({state: 'detached', timeout: 8_000});
  } catch (_) {
    /* not all routes render the boot loader */
  }
  // Settle layout — wait for the header subnav to render so we capture
  // the full chrome rather than a mid-mount snapshot, then a beat for
  // any deferred panels.
  try {
    await page.locator('[data-header-subnav="1"]').waitFor({state: 'visible', timeout: 6_000});
  } catch (_) {
    /* public anon forms have no logged-in subnav */
  }
  await page.waitForTimeout(1200);

  const metrics = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    innerWidth: window.innerWidth,
    overflowsHoriz: document.documentElement.scrollWidth > window.innerWidth + 1,
    title: document.title || '',
  }));
  console.log(
    `[ux-audit] ${vp.label} ${surface.key} path=${surface.path} ` +
      `inner=${metrics.innerWidth} scroll=${metrics.scrollWidth} ` +
      `overflow=${metrics.overflowsHoriz}`,
  );

  await page.screenshot({
    path: `test-results/ux-audit/${vp.label}/${surface.key}.png`,
    fullPage: true,
  });

  return metrics;
}

for (const vp of VIEWPORTS) {
  test.describe(`ux-audit @ ${vp.label}`, () => {
    test.use({viewport: {width: vp.width, height: vp.height}});

    for (const surface of SURFACES) {
      test(`${surface.key}`, async ({page, browser}) => {
        if (surface.requiresAuth) {
          await page.goto(surface.path);
        } else {
          // Anon context — no admin storageState. Fresh page per surface.
          const ctx = await browser.newContext({
            viewport: {width: vp.width, height: vp.height},
            storageState: undefined,
          });
          const anon = await ctx.newPage();
          try {
            await anon.goto(surface.path);
            const m = await probeAndCapture(anon, surface, vp);
            // Cap horizontal overflow at +8px to ignore scrollbar rounding;
            // anything larger is real overflow worth eyeballing.
            expect.soft(m.scrollWidth, `horiz overflow @ ${vp.label} ${surface.key}`).toBeLessThanOrEqual(vp.width + 8);
          } finally {
            await ctx.close();
          }
          return;
        }
        const m = await probeAndCapture(page, surface, vp);
        expect.soft(m.scrollWidth, `horiz overflow @ ${vp.label} ${surface.key}`).toBeLessThanOrEqual(vp.width + 8);
      });
    }
  });
}

// Equipment detail — separate test that resolves the slug at runtime.
for (const vp of VIEWPORTS) {
  test(`ux-audit @ ${vp.label} fleet-detail`, async ({page}) => {
    test.setTimeout(45_000);
    // Pull the first equipment slug from the fleet page link instead of
    // hitting the DB so the audit doesn't depend on extra fixtures.
    await page.setViewportSize({width: vp.width, height: vp.height});
    await page.goto('/fleet');
    try {
      await page.locator('#wcf-boot-loader').waitFor({state: 'detached', timeout: 8_000});
    } catch (_) {
      /* tolerated */
    }
    const slug = await page
      .locator('a[href^="/fleet/"]')
      .first()
      .getAttribute('href')
      .then((h) => (h ? h.replace(/^\/fleet\//, '') : null));
    if (!slug) {
      console.log(`[ux-audit] ${vp.label} fleet-detail: NO equipment seeded; skipped`);
      test.skip();
      return;
    }
    await page.goto(`/fleet/${slug}`);
    const m = await probeAndCapture(page, {key: 'fleet-detail', path: `/fleet/${slug}`}, vp);
    expect.soft(m.scrollWidth, `horiz overflow @ ${vp.label} fleet-detail`).toBeLessThanOrEqual(vp.width + 8);
  });
}
