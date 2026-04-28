import {test, expect} from './fixtures.js';

// ============================================================================
// HomeDashboard equipment-attention regression spec — A1 follow-up
// ============================================================================
// Locks the five alert kinds that HomeDashboard's EQUIPMENT ATTENTION section
// renders: overdue / upcoming / missed_fueling / fillup_streak / warranty.
// Each test seeds exactly one piece of equipment positioned to trigger its
// target kind and asserts the row exists with both data hooks plus the
// signal substrings the alert owns.
//
// Production hooks added in this PR:
//   data-attention-kind="overdue|upcoming|missed_fueling|fillup_streak|warranty"
//   data-equipment-slug="<slug>"
// Both attrs on the wrapping <div> of each attention row in
// src/dashboard/HomeDashboard.jsx.
//
// Selectors anchor on BOTH attrs (defensive — protects against future seed
// evolution where multiple pieces of equipment might land in the test DB).
// Per Codex's review, text assertions use toContainText (not exact text) so
// midnight-crossing day counts don't flake.
// ============================================================================

function attentionRow(page, kind, slug) {
  return page.locator(`[data-attention-kind="${kind}"][data-equipment-slug="${slug}"]`);
}

async function gotoHome(page, kind, slug) {
  await page.goto('/');
  // EQUIPMENT ATTENTION section renders after the equipment + fuelings
  // useEffect resolves (loaded defensively per the comment at HomeDashboard.jsx:48).
  await expect(attentionRow(page, kind, slug)).toBeVisible({timeout: 15_000});
}

// --------------------------------------------------------------------------
// Test 1 — overdue
// --------------------------------------------------------------------------
test('overdue: 100hr service past next_due renders data-attention-kind="overdue"', async ({
  page,
  homeDashboardEquipmentScenario,
}) => {
  const seed = await homeDashboardEquipmentScenario({kind: 'overdue'});
  await gotoHome(page, seed.kind, seed.slug);

  const row = attentionRow(page, seed.kind, seed.slug);
  for (const substr of seed.expectedSubstrings) {
    await expect(row).toContainText(substr);
  }
});

// --------------------------------------------------------------------------
// Test 2 — upcoming
// --------------------------------------------------------------------------
test('upcoming: 100hr service within UPCOMING_WINDOW renders data-attention-kind="upcoming"', async ({
  page,
  homeDashboardEquipmentScenario,
}) => {
  const seed = await homeDashboardEquipmentScenario({kind: 'upcoming'});
  await gotoHome(page, seed.kind, seed.slug);

  const row = attentionRow(page, seed.kind, seed.slug);
  for (const substr of seed.expectedSubstrings) {
    await expect(row).toContainText(substr);
  }
});

// --------------------------------------------------------------------------
// Test 3 — missed_fueling
// --------------------------------------------------------------------------
test('missed_fueling: latest fueling > MISSED_FUELING_DAYS days ago renders data-attention-kind="missed_fueling"', async ({
  page,
  homeDashboardEquipmentScenario,
}) => {
  const seed = await homeDashboardEquipmentScenario({kind: 'missed_fueling'});
  await gotoHome(page, seed.kind, seed.slug);

  const row = attentionRow(page, seed.kind, seed.slug);
  // Stable substrings only — day count varies if CI crosses midnight between
  // seed and assertion. seededFuelDate is fixed by daysAgo(20) at seed time.
  for (const substr of seed.expectedSubstrings) {
    await expect(row).toContainText(substr);
  }
});

// --------------------------------------------------------------------------
// Test 4 — fillup_streak
// --------------------------------------------------------------------------
test('fillup_streak: never-ticked every-fillup item across 2 fuelings renders data-attention-kind="fillup_streak"', async ({
  page,
  homeDashboardEquipmentScenario,
}) => {
  const seed = await homeDashboardEquipmentScenario({kind: 'fillup_streak'});
  await gotoHome(page, seed.kind, seed.slug);

  const row = attentionRow(page, seed.kind, seed.slug);
  for (const substr of seed.expectedSubstrings) {
    await expect(row).toContainText(substr);
  }
});

// --------------------------------------------------------------------------
// Test 5 — warranty
// --------------------------------------------------------------------------
test('warranty: expiration within WARRANTY_WINDOW_DAYS renders data-attention-kind="warranty"', async ({
  page,
  homeDashboardEquipmentScenario,
}) => {
  const seed = await homeDashboardEquipmentScenario({kind: 'warranty'});
  await gotoHome(page, seed.kind, seed.slug);

  const row = attentionRow(page, seed.kind, seed.slug);
  for (const substr of seed.expectedSubstrings) {
    await expect(row).toContainText(substr);
  }
});
