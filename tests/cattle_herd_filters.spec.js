import {test, expect} from './fixtures.js';

// ============================================================================
// Cattle Herd filters/sort + smart-input — 2026-05-02
// ============================================================================
// Locks the post-build contract for the new composable filter chips, ordered
// sort rules, explicit grouped/flat toggle, smart-input parser, and the
// maternal-issue UI retirement. Pure module helpers in
// src/lib/cattleHerdFilters.js are vitest-locked separately.
//
// Coverage:
//   1  default load = grouped view, all 4 active herd tiles visible
//   2  age sort youngest-first orders newest-birth-date cow first within tile
//   3  sex=heifer + age >= 18mo compose; same survivors in grouped + flat
//   4  calved=no in mommas — only the never-calved heifer matches
//   5  blacklist filter — only blacklisted cow matches
//   6  grouped/flat toggle parity — same survivors after a filter
//   7  smart-input proposes chips, banner shows preview, state unchanged
//      until Apply clicked
//   8  smart-input on unparseable input → error banner, no state change
//   9  maternal-issue absence regression — zero /maternal/i text anywhere
//  10  breed dropdown surfaces historical "Heritage Wagyu" (Codex amend 3)
// ============================================================================

async function waitForLoaded(page) {
  // Wait for both visibility AND a non-zero match count so the seed-vs-render
  // race doesn't leave us reading "0 cattle match" before cattle data lands.
  // Anchored regex — "10 cattle match" trivially contains "0 cattle match"
  // as a substring, so a plain not.toContainText would never settle.
  await expect(page.locator('[data-cattle-match-count]')).toBeVisible({timeout: 15_000});
  await expect(page.locator('[data-cattle-match-count]')).not.toHaveText(/^0 /, {timeout: 15_000});
}

async function readTagsInOrder(locator) {
  return locator.evaluateAll((nodes) => nodes.map((n) => n.getAttribute('data-cow-row-tag') || ''));
}

async function expandHerd(page, herd) {
  const tile = page.locator(`[data-herd-tile="${herd}"]`);
  await expect(tile).toBeVisible();
  if ((await tile.getAttribute('data-herd-open')) !== '1') {
    await tile.click();
  }
  await expect(tile).toHaveAttribute('data-herd-open', '1');
}

async function openFilter(page, key) {
  const chip = page.locator(`[data-filter-chip="${key}"]`);
  await expect(chip).toBeVisible();
  await chip.click();
  await expect(page.locator(`[data-filter-popover="${key}"]`)).toBeVisible();
}

// --------------------------------------------------------------------------
// Test 1 — Default load shows grouped view + 4 active herd tiles
// --------------------------------------------------------------------------
test('default load: grouped view with 4 active herd tiles', async ({page, cattleHerdFiltersScenario}) => {
  await page.goto('/cattle/herds');
  await waitForLoaded(page);

  // Grouped radio is selected by default.
  await expect(page.locator('input[data-view-mode="grouped"]')).toBeChecked();
  await expect(page.locator('input[data-view-mode="flat"]')).not.toBeChecked();

  // 4 active herd tiles render.
  for (const h of ['mommas', 'backgrounders', 'finishers', 'bulls']) {
    await expect(page.locator(`[data-herd-tile="${h}"]`)).toBeVisible();
  }

  // Outcome herds NOT rendered as expanded tiles by default — they live in
  // the CollapsibleOutcomeSections at the bottom.
  await expect(page.locator('[data-herd-tile="processed"]')).toHaveCount(0);

  // Ensure data is loaded — Mommas has 5 cows in the seed.
  const mommasTile = page.locator('[data-herd-tile="mommas"]');
  await expect(mommasTile).toContainText('5 cows');
});

// --------------------------------------------------------------------------
// Test 2 — Age sort youngest-first orders newest birth_date first
// --------------------------------------------------------------------------
test('age sort youngest-first orders newest birth_date first inside tile', async ({
  page,
  cattleHerdFiltersScenario,
}) => {
  await page.goto('/cattle/herds');
  await waitForLoaded(page);

  // Default sort is [{tag asc}]. Remove it so age becomes the primary sort
  // (otherwise age would be a tiebreaker behind tag and the order assertion
  // would fail).
  const tagRule = page.locator('[data-sort-rule="tag"]');
  await expect(tagRule).toBeVisible();
  await tagRule.locator('button').last().click(); // × remove
  await expect(tagRule).toHaveCount(0);

  // Add age sort.
  await page.locator('select[data-sort-add]').selectOption('age');
  // Default dir is asc = youngest first. Verify chip badge.
  const ageRule = page.locator('[data-sort-rule="age"]');
  await expect(ageRule).toBeVisible();
  await expect(ageRule).toHaveAttribute('data-sort-dir', 'asc');

  await expandHerd(page, 'mommas');

  // Mommas seed: M001 (2020-04), M002 (2021-03), M003 (2024-06 — youngest),
  // M004 (2019-02 — oldest), M005 (2022-08).
  // Youngest-first asc order: M003, M005, M002, M001, M004.
  const mommasTile = page.locator('[data-herd-tile="mommas"]').locator('..');
  const cowRows = mommasTile.locator('div[id^="cow-"]');
  await expect(cowRows).toHaveCount(5);

  // Read tag via data attribute (sibling spans have no whitespace separator
  // so textContent regex would concatenate tag with neighbor cells).
  const tags = await readTagsInOrder(cowRows);
  expect(tags).toEqual(['M003', 'M005', 'M002', 'M001', 'M004']);

  // Flip to desc — oldest first.
  const dirBtn = ageRule.locator('button').first(); // direction button is the first child <button>
  await dirBtn.click();
  await expect(ageRule).toHaveAttribute('data-sort-dir', 'desc');
  const tagsDesc = await readTagsInOrder(cowRows);
  expect(tagsDesc).toEqual(['M004', 'M001', 'M002', 'M005', 'M003']);
});

// --------------------------------------------------------------------------
// Test 3 — sex=heifer + age >= 18mo compose; same survivors in grouped + flat
// --------------------------------------------------------------------------
test('sex + age compose; same survivors across grouped and flat modes', async ({page, cattleHerdFiltersScenario}) => {
  await page.goto('/cattle/herds');
  await waitForLoaded(page);

  // Open Sex filter; check Heifer.
  await openFilter(page, 'sex');
  await page.locator('[data-filter-popover="sex"] >> text=Heifer').click();
  await page.locator('[data-filter-popover="sex"] >> text=Close').click();

  // Open Age; min 18.
  await openFilter(page, 'ageMonthsRange');
  await page.locator('[data-filter-popover="ageMonthsRange"] input[type="number"]').first().fill('18');
  await page.locator('[data-filter-popover="ageMonthsRange"] >> text=Close').click();

  // Survivors per seed: heifers >=18mo
  //   M003 (~23mo, mommas) ✓
  //   B201 (~20mo, backgrounders) ✓
  //   B202 (~21mo, backgrounders) ✓
  //   B203 (~16mo) ✗
  // Match-count chip:
  await expect(page.locator('[data-cattle-match-count]')).toContainText('3');

  // Verify in grouped tiles.
  await expandHerd(page, 'mommas');
  await expandHerd(page, 'backgrounders');
  const groupedRows = page.locator('div[id^="cow-"][data-cow-row-tag]');
  const groupedTags = await readTagsInOrder(groupedRows);
  expect(new Set(groupedTags)).toEqual(new Set(['M003', 'B201', 'B202']));

  // Switch to flat.
  await page.locator('input[data-view-mode="flat"]').click();
  await expect(page.locator('[data-cattle-flat-list]')).toBeVisible();
  const flatRows = page.locator('[data-cattle-flat-list] div[id^="cow-"]');
  await expect(flatRows).toHaveCount(3);
  const flatTags = await readTagsInOrder(flatRows);
  expect(new Set(flatTags)).toEqual(new Set(['M003', 'B201', 'B202']));
});

// --------------------------------------------------------------------------
// Test 4 — calved=no in mommas
// --------------------------------------------------------------------------
test('calved=no in mommas surfaces only the never-calved heifer', async ({page, cattleHerdFiltersScenario}) => {
  await page.goto('/cattle/herds');
  await waitForLoaded(page);

  // Constrain to mommas explicitly (default already shows active including
  // mommas, but pinning the chip makes the assertion exact).
  await openFilter(page, 'herdSet');
  await page.locator('[data-filter-popover="herdSet"] >> text=Mommas').click();
  await page.locator('[data-filter-popover="herdSet"] >> text=Close').click();

  await openFilter(page, 'calvedStatus');
  await page.locator('[data-filter-popover="calvedStatus"] >> text=Never calved').click();
  await page.locator('[data-filter-popover="calvedStatus"] >> text=Close').click();

  await expect(page.locator('[data-cattle-match-count]')).toContainText('1 ');

  await expandHerd(page, 'mommas');
  const visibleRows = page.locator('[data-herd-tile="mommas"]').locator('..').locator('div[id^="cow-"]');
  await expect(visibleRows).toHaveCount(1);
  await expect(visibleRows.first()).toContainText('#M003');
});

// --------------------------------------------------------------------------
// Test 5 — blacklist filter
// --------------------------------------------------------------------------
test('blacklist filter surfaces only the blacklisted cow', async ({page, cattleHerdFiltersScenario}) => {
  await page.goto('/cattle/herds');
  await waitForLoaded(page);

  await openFilter(page, 'breedingBlacklist');
  await page.locator('[data-filter-popover="breedingBlacklist"] >> text=Only blacklisted').click();
  await page.locator('[data-filter-popover="breedingBlacklist"] >> text=Close').click();

  await expect(page.locator('[data-cattle-match-count]')).toContainText('1 ');

  // Switch to flat to check the single survivor without expanding tiles.
  await page.locator('input[data-view-mode="flat"]').click();
  const flatRows = page.locator('[data-cattle-flat-list] div[id^="cow-"]');
  await expect(flatRows).toHaveCount(1);
  await expect(flatRows.first()).toContainText('#M004');
});

// --------------------------------------------------------------------------
// Test 6 — grouped/flat toggle parity
// --------------------------------------------------------------------------
test('grouped/flat toggle yields same filtered survivors', async ({page, cattleHerdFiltersScenario}) => {
  await page.goto('/cattle/herds');
  await waitForLoaded(page);

  // Apply herd=backgrounders filter.
  await openFilter(page, 'herdSet');
  await page.locator('[data-filter-popover="herdSet"] >> text=Backgrounders').click();
  await page.locator('[data-filter-popover="herdSet"] >> text=Close').click();

  // Grouped: 3 cows under backgrounders tile.
  await expandHerd(page, 'backgrounders');
  const groupedRows = page.locator('[data-herd-tile="backgrounders"]').locator('..').locator('div[id^="cow-"]');
  await expect(groupedRows).toHaveCount(3);

  // Switch to flat — same 3.
  await page.locator('input[data-view-mode="flat"]').click();
  await expect(page.locator('[data-cattle-flat-list]')).toBeVisible();
  await expect(page.locator('[data-cattle-flat-list] div[id^="cow-"]')).toHaveCount(3);
});

// --------------------------------------------------------------------------
// Test 7 — smart-input proposes; state unchanged until Apply
// --------------------------------------------------------------------------
test('smart-input shows preview banner; state unchanged until Apply clicked', async ({
  page,
  cattleHerdFiltersScenario,
}) => {
  await page.goto('/cattle/herds');
  await waitForLoaded(page);

  // Initial match count — 9 active cattle (all active herds).
  const initialCount = await page.locator('[data-cattle-match-count]').textContent();

  await page.locator('input[data-smart-input]').fill('heffers older than 18 months');
  await page.locator('button[data-smart-apply]').click();

  // Preview banner appears.
  const banner = page.locator('[data-smart-preview]');
  await expect(banner).toBeVisible();
  await expect(banner).toContainText('Proposed:');
  await expect(banner).toContainText('Age');

  // Match count UNCHANGED until Apply.
  await expect(page.locator('[data-cattle-match-count]')).toHaveText(initialCount);

  // Click Apply.
  await page.locator('button[data-smart-apply-proposal]').click();
  await expect(banner).toHaveCount(0);

  // State changed: 3 survivors (heifers >=18mo). Same set as Test 3.
  await expect(page.locator('[data-cattle-match-count]')).toContainText('3');
});

// --------------------------------------------------------------------------
// Test 8 — smart-input clarification on unparseable
// --------------------------------------------------------------------------
test('smart-input clarification on unparseable input — no state change', async ({page, cattleHerdFiltersScenario}) => {
  await page.goto('/cattle/herds');
  await waitForLoaded(page);

  const initialCount = await page.locator('[data-cattle-match-count]').textContent();

  await page.locator('input[data-smart-input]').fill('xyzzy plugh foobar');
  await page.locator('button[data-smart-apply]').click();

  const banner = page.locator('[data-smart-preview]');
  await expect(banner).toBeVisible();
  await expect(banner).toContainText("couldn't parse");

  // No Apply button rendered when parse failed.
  await expect(page.locator('button[data-smart-apply-proposal]')).toHaveCount(0);

  // State unchanged.
  await expect(page.locator('[data-cattle-match-count]')).toHaveText(initialCount);
});

// --------------------------------------------------------------------------
// Test 9 — maternal-issue UI absence regression
// --------------------------------------------------------------------------
test('maternal-issue text absent from herd view, expanded cow detail, and Add modal', async ({
  page,
  cattleHerdFiltersScenario,
}) => {
  await page.goto('/cattle/herds');
  await waitForLoaded(page);

  // Page-level scrub.
  const bodyText = await page.locator('body').innerText();
  expect(bodyText.toLowerCase()).not.toContain('maternal');

  // Expand a cow detail.
  await expandHerd(page, 'mommas');
  const firstCow = page.locator('[data-herd-tile="mommas"]').locator('..').locator('div[id^="cow-"]').first();
  await firstCow.click();
  // Expanded CowDetail panel — re-scan body text.
  const bodyTextExpanded = await page.locator('body').innerText();
  expect(bodyTextExpanded.toLowerCase()).not.toContain('maternal');

  // Open Add Cow modal.
  await page.getByRole('button', {name: '+ Add Cow'}).click();
  const modalText = await page.locator('body').innerText();
  expect(modalText.toLowerCase()).not.toContain('maternal');
});

// --------------------------------------------------------------------------
// Test 10 — historical breed surfaces in filter dropdown
// --------------------------------------------------------------------------
test('breed filter dropdown includes historical "Heritage Wagyu" present on cow but not in cattle_breeds', async ({
  page,
  cattleHerdFiltersScenario,
}) => {
  await page.goto('/cattle/herds');
  await waitForLoaded(page);

  // Expand More filters → click Breed chip → assert dropdown contains label.
  await page.locator('[data-more-filters-toggle]').click();
  await page.locator('[data-filter-chip="breed"]').click();
  const popover = page.locator('[data-filter-popover="breed"]');
  await expect(popover).toBeVisible();
  await expect(popover).toContainText('Heritage Wagyu');
  await expect(popover).toContainText('(historical)');
});
