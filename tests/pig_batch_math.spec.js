import { test, expect } from './fixtures.js';

// ============================================================================
// Pig batch math regression spec — Phase A4
// ============================================================================
// Codex-scoped to ONE happy-path Send-to-Trip test that proves the three
// pieces this code path actually exercises:
//   1. processingTrips[].subAttributions stamped with the §7 schema
//      ([{subId, subBatchName, sex, count}]) — derived in
//      LivestockWeighInsView.sendEntriesToTrip via pigSlug match against
//      sub.name.
//   2. Parent ledger current count = started − processed − transferred − mortality
//      (NOT just latest_daily.pig_count and NOT mutating started counts).
//   3. lbs/pig denominator = finishers (started − transferred − mortality), the
//      regression lock for the 1644 vs 1186 P-26-01A bug from 2026-04-27 PM.
//
// FCR cache (the fourth assertion Codex asked for) was DEFERRED. Send-to-Trip
// does not write parent.fcrCached — that contract lives in PigBatchesView's
// persistTrip (Edit Trip / Save Trip flow). A separate spec driving Edit Trip
// will exercise the fcrCached add + delete contract end-to-end. Mis-scoped
// during planning; flagged in commit message.
//
// Edge cases (multi-sub Send-to-Trip, FCR add/clear, trip edit recalc,
// mortality limit math) deferred per Codex's "narrow first pass" guidance.
// ============================================================================

test('Send-to-Trip stamps subAttributions, ledger current = 12, lbs/pig honors finishers (FCR deferred)', async ({
  page,
  p2601Scenario,
  supabaseAdmin,
}) => {
  const { batchName, subAName, subAId, expected } = p2601Scenario;

  // --- Pre-flight: confirm the seed actually landed how we think.
  // If the seed changes shape silently, the test should fail with a clear
  // arrange-time error, not a confusing UI assertion failure later.
  {
    const { data } = await supabaseAdmin
      .from('app_store')
      .select('data')
      .eq('key', 'ppp-feeders-v1')
      .single();
    const feeders = data?.data || [];
    expect(feeders).toHaveLength(1);
    const batch = feeders[0];
    expect(batch.batchName).toBe(batchName);
    expect(batch.processingTrips).toEqual([]);
    expect(batch.fcrCached).toBeUndefined();
    expect(batch.subBatches).toHaveLength(2);
  }

  // --- ACT: drive Send-to-Trip via UI ---------------------------------------
  await page.goto('/pig/weighins');

  // Expand the seeded session row. The row's visible text is the session's
  // batch_id slug ('p-26-01a' — pigSlug('P-26-01A'), no dash before the 'a'
  // because uppercase letters are alphanumeric in /[^a-z0-9]+/g) plus a
  // DRAFT status pill — match both for specificity.
  const sessionRow = page
    .locator('.hoverable-tile')
    .filter({ hasText: /p-26-01/i })
    .filter({ hasText: /draft/i })
    .first();
  await expect(sessionRow).toBeVisible({ timeout: 15_000 });
  await sessionRow.click();

  // "Select all unsent (5)" — proves the expansion landed AND selects all
  // entries in one click (avoiding the per-entry checkbox selector problem
  // which would otherwise need a data-testid).
  const selectAllBtn = page.getByText(/Select all unsent \(5\)/);
  await expect(selectAllBtn).toBeVisible({ timeout: 5_000 });
  await selectAllBtn.click();

  // Click "→ Send 5 to Trip" — opens PigSendToTripModal.
  await page.getByText(/→ Send 5 to Trip/).click();

  // Modal opened — anchor on the title line.
  const modalTitle = page.getByText(/Send 5 weigh-ins to Trip/);
  await expect(modalTitle).toBeVisible({ timeout: 5_000 });

  // Pick the feeder group. Locate the modal's <select> by the option whose
  // text contains the batch name ("P-26-01 (0 trips)" — count is 0 because
  // the seed deliberately leaves processingTrips empty).
  const groupSelect = page
    .locator('select')
    .filter({ has: page.locator('option', { hasText: batchName }) })
    .first();
  await groupSelect.selectOption({ label: `${batchName} (0 trips)` });

  // Default mode is 'existing' but the seeded batch has zero trips, so the
  // "Existing trip (0)" button is disabled. Switch to "+ New trip".
  await page.getByRole('button', { name: '+ New trip' }).click();

  // Submit. Modal "Send" button — exact text disambiguates from the page's
  // "→ Send 5 to Trip" trigger that's still in the DOM behind the modal.
  await page.getByRole('button', { name: 'Send', exact: true }).click();

  // Wait for the modal to close.
  await expect(modalTitle).toHaveCount(0, { timeout: 10_000 });

  // --- ASSERT 1: DB ppp-feeders-v1 has trip with proper subAttributions.
  // Poll until the trip appears — modal close and persistence are async,
  // and decoupling them is a real risk if the persist contract changes.
  // Once one trip exists, we read once more to assert exact subAttributions
  // shape (so the failure message shows the diff, not "trip never arrived").
  await expect
    .poll(
      async () => {
        const r = await supabaseAdmin
          .from('app_store')
          .select('data')
          .eq('key', 'ppp-feeders-v1')
          .single();
        return r.data?.data?.[0]?.processingTrips?.length ?? 0;
      },
      { timeout: 10_000, message: 'Send-to-Trip did not persist a trip' }
    )
    .toBe(1);

  const { data: postFeed } = await supabaseAdmin
    .from('app_store')
    .select('data')
    .eq('key', 'ppp-feeders-v1')
    .single();
  const batch = postFeed.data[0];

  const trip = batch.processingTrips[0];
  expect(trip.pigCount).toBe(5);
  expect(trip.subAttributions).toEqual([
    { subId: subAId, subBatchName: subAName, sex: 'Gilts', count: 5 },
  ]);

  // FCR cache assertion deferred — see header comment. Send-to-Trip writes
  // the trip but does not run computePigBatchFCR. fcrCached remains
  // undefined for this flow; it populates only via Edit Trip → Save in
  // PigBatchesView.persistTrip. A future spec covers that contract.
  expect(batch.fcrCached).toBeUndefined();

  // --- ASSERT 3 + 4: UI on /pig/batches reflects ledger math --------------
  await page.goto('/pig/batches');

  // Current count: 20 started − 5 trip − 2 transferred − 1 mortality = 12.
  // Header shows "Current: <strong>12</strong>".
  await expect(
    page.getByText(new RegExp(`Current:\\s*${expected.postTripCurrent}\\b`))
  ).toBeVisible({ timeout: 15_000 });

  // lbs/pig: 19000 adjusted feed ÷ 17 finishers = 1117.6 → rounds to 1118.
  // The bug regression: this MUST NOT be 950 (19000/20) or 1000 (20000/20).
  // The page shows BOTH parent ("1118 lbs/pig") AND sub-A inline ("1286 lbs/pig"
  // = 9000/7) — assert the parent value specifically.
  await expect(
    page.getByText(new RegExp(`\\b${expected.preTripLbsPerPig} lbs/pig\\b`))
  ).toBeVisible();
});
