import {test, expect} from './fixtures.js';

// ============================================================================
// HomeDashboard equipment-attention regression spec
// ============================================================================
// Locks the THREE alert kinds the EQUIPMENT ATTENTION section renders
// (overdue / fillup_streak / warranty) and the TWO seed shapes that must
// NOT generate a row (near-due-but-not-overdue services, and old-fueling-
// by-calendar-time). Equipment maintenance is hour/km-based, not calendar-
// based — animal daily reports are the calendar workflow, equipment is not.
//
// Production hooks on the wrapping <div> of each attention row in
// src/dashboard/HomeDashboard.jsx:
//   data-attention-kind="overdue|fillup_streak|warranty"
//   data-equipment-slug="<slug>"
//
// Selectors anchor on BOTH attrs (defensive — protects against future
// seed evolution where multiple pieces of equipment might land in the
// test DB). Per Codex's review, text assertions use toContainText (not
// exact text) so midnight-crossing day counts don't flake.
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

async function gotoHomeAndWaitLoaded(page) {
  await page.goto('/');
  // Boot-loader fades after the first paint and the auth + data effects
  // resolve. Same load gate the smoke spec uses. Guarantees the dashboard
  // had a chance to render before we assert absence of a row.
  await expect(page.locator('#wcf-boot-loader')).toHaveCount(0, {timeout: 15_000});
}

// --------------------------------------------------------------------------
// Test 1 — overdue (positive)
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
// Test 2 — near-due service (negative lock)
// --------------------------------------------------------------------------
// Equipment is hour/km-based, not calendar-based. A near-due service
// (within ~50h of next_due but not overdue) used to render as kind:
// 'upcoming'. Per Ronnie 2026-04-28 (eve+), that surfacing was noise —
// admins watch overdue, not "due in 40 hours" forecasts. This spec
// regression-locks that no row appears for a near-due seed.
test('near-due service does NOT render an Equipment Attention row (negative lock)', async ({
  page,
  homeDashboardEquipmentScenario,
}) => {
  const seed = await homeDashboardEquipmentScenario({kind: 'upcoming'});
  await gotoHomeAndWaitLoaded(page);
  await expect(page.locator(`[data-equipment-slug="${seed.slug}"]`)).toHaveCount(0);
});

// --------------------------------------------------------------------------
// Test 3 — old-fueling-by-calendar-time (negative lock)
// --------------------------------------------------------------------------
// Equipment fueling cadence is operator-driven, not calendar-driven. A
// piece of equipment that hasn't been fueled in 14+ days used to render
// as kind: 'missed_fueling'. Per Ronnie 2026-04-28 (eve+), that surfacing
// confused two distinct workflows (animal dailys = calendar; equipment
// = hour/km usage). This spec regression-locks that no row appears for a
// stale-fueling seed.
test('old fueling date does NOT render an Equipment Attention row (negative lock)', async ({
  page,
  homeDashboardEquipmentScenario,
}) => {
  const seed = await homeDashboardEquipmentScenario({kind: 'missed_fueling'});
  await gotoHomeAndWaitLoaded(page);
  await expect(page.locator(`[data-equipment-slug="${seed.slug}"]`)).toHaveCount(0);
});

// --------------------------------------------------------------------------
// Test 4 — fillup_streak (positive)
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
// Test 5 — warranty (positive)
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
