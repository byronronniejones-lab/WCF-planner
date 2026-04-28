import { test, expect } from './fixtures.js';

// ============================================================================
// Fuel reconciliation UI spec — Phase A8b
// ============================================================================
// Locks two §7 contracts from the operator-facing reconciliation table:
//
//   1. The variance bands (≤5 green / ≤10 orange / >10 red) — driven by
//      VARIANCE_WARN_PCT in src/admin/FuelReconcileView.jsx via varBand().
//   2. The cell-destination exclusion: fuel_supplies rows with
//      destination='cell' are inventory movement, NOT consumption — so
//      they MUST NOT contribute to the consumed-gallons total. (§7 entry
//      "fuel_supplies table ≠ equipment_fuelings table".)
//
// 4 tests:
//   1  green band   — purchased 100 / consumed 102 → +2.0% (within ≤5)
//   2  orange band  — purchased 100 / consumed 92  → -8.0% (within ≤10)
//   3  red band     — purchased 100 / consumed 130 → +30.0% (>10)
//   4  cell exclusion — same as Test 1 plus a 50-gal destination='cell'
//                       fuel_supplies row that, if counted, would drive
//                       the band to red (+52%). Asserts the band stays
//                       green (still +2.0%).
//
// All seeds use a single fuel_type (diesel) and a single fixed month
// ('2026-01'). DOM hooks added in this PR for stable Playwright selection:
//   - data-month="YYYY-MM" + data-fuel-type="…" + data-cell="…" on the
//     9 per-fuel-type cells of each per-month row in FuelReconcileView.
//   - data-variance-band="green|orange|red" on the 3 variance cells.
//
// Selectors anchor on (data-month, data-fuel-type, data-cell) — never on
// table column position or header text.
// ============================================================================

async function gotoReconcile(page) {
  await page.goto('/admin');
  await page.getByRole('button', { name: 'Fuel Log' }).click();
  await page.getByRole('button', { name: 'Reconciliation' }).click();
  // The variance cells render once the load() effect resolves. Wait for
  // any [data-cell="variance"] cell with our seeded month before reading.
  await expect(
    page.locator('[data-month="2026-01"][data-fuel-type="diesel"][data-cell="variance"]')
  ).toBeVisible({ timeout: 15_000 });
}

function purchasedCell(page, { month = '2026-01', fuelType = 'diesel' } = {}) {
  return page.locator(
    `[data-month="${month}"][data-fuel-type="${fuelType}"][data-cell="purchased"]`
  );
}
function consumedCell(page, { month = '2026-01', fuelType = 'diesel' } = {}) {
  return page.locator(
    `[data-month="${month}"][data-fuel-type="${fuelType}"][data-cell="consumed"]`
  );
}
function varianceCell(page, { month = '2026-01', fuelType = 'diesel' } = {}) {
  return page.locator(
    `[data-month="${month}"][data-fuel-type="${fuelType}"][data-cell="variance"]`
  );
}

async function assertGallons(cell, gallons) {
  // FuelReconcileView renders gallons via Math.round(n).toLocaleString().
  // Numbers ≤ 999 won't have separators; comparing to the same expression
  // keeps locale assumptions out of the test.
  await expect(cell).toHaveText(Math.round(gallons).toLocaleString());
}

// --------------------------------------------------------------------------
// Test 1 — green band (+2.0%)
// --------------------------------------------------------------------------
test('green band: +2% variance renders data-variance-band="green" + signed text', async ({
  page,
  fuelReconcileScenario,
}) => {
  const seed = await fuelReconcileScenario({ band: 'green' });

  await gotoReconcile(page);

  await assertGallons(purchasedCell(page), seed.purchased);
  await assertGallons(consumedCell(page), seed.consumed);

  const variance = varianceCell(page);
  await expect(variance).toHaveAttribute('data-variance-band', 'green');
  await expect(variance).toHaveText(seed.expectedPct); // '+2.0%'
});

// --------------------------------------------------------------------------
// Test 2 — orange band (-8.0%, negative variance)
// --------------------------------------------------------------------------
test('orange band: -8% variance renders data-variance-band="orange" + signed text', async ({
  page,
  fuelReconcileScenario,
}) => {
  const seed = await fuelReconcileScenario({ band: 'orange' });

  await gotoReconcile(page);

  await assertGallons(purchasedCell(page), seed.purchased);
  await assertGallons(consumedCell(page), seed.consumed);

  const variance = varianceCell(page);
  await expect(variance).toHaveAttribute('data-variance-band', 'orange');
  // Negative-sign polarity: text rendered as '-8.0%' (no '+' prefix).
  // Locks signed-text formatting against the absolute-value band coercion.
  await expect(variance).toHaveText(seed.expectedPct); // '-8.0%'
});

// --------------------------------------------------------------------------
// Test 3 — red band (+30.0%)
// --------------------------------------------------------------------------
test('red band: +30% variance renders data-variance-band="red" + signed text', async ({
  page,
  fuelReconcileScenario,
}) => {
  const seed = await fuelReconcileScenario({ band: 'red' });

  await gotoReconcile(page);

  await assertGallons(purchasedCell(page), seed.purchased);
  await assertGallons(consumedCell(page), seed.consumed);

  const variance = varianceCell(page);
  await expect(variance).toHaveAttribute('data-variance-band', 'red');
  await expect(variance).toHaveText(seed.expectedPct); // '+30.0%'
});

// --------------------------------------------------------------------------
// Test 4 — §7 cell-destination exclusion
// --------------------------------------------------------------------------
test('cell exclusion: destination="cell" supply row does not push variance', async ({
  page,
  fuelReconcileScenario,
}) => {
  // Same band as Test 1 (purchased 100 / consumed 102 = +2%) PLUS a 50-gal
  // fuel_supplies row with destination='cell'. If the §7 contract were
  // violated, total consumption would read 152 gal and variance would
  // jump to +52% (red). Test asserts the cell row is excluded — band
  // remains green at +2.0%.
  const seed = await fuelReconcileScenario({ band: 'green', includeCellRow: true });
  expect(seed.cellGallons).toBe(50); // sanity: seed actually inserted the row

  await gotoReconcile(page);

  // Consumed cell stays at the equipment-only total (102), NOT 152.
  await assertGallons(consumedCell(page), seed.consumed);
  await assertGallons(purchasedCell(page), seed.purchased);

  const variance = varianceCell(page);
  await expect(variance).toHaveAttribute('data-variance-band', 'green');
  await expect(variance).toHaveText(seed.expectedPct); // '+2.0%'
});
