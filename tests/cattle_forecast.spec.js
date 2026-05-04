import {test, expect} from './fixtures.js';

// ============================================================================
// Cattle Forecast tab + Batches rework + Send-to-Processor gate
// ============================================================================
// Locks the post-build contract for the Cattle Forecast lane (mig 043 +
// CattleForecastView + CattleBatchesView rework + Send-to-Processor modal
// rework). Pure-helper math is vitest-locked separately at
// src/lib/cattleForecast.test.js (61 cases including Codex 2026-05-04
// regression locks).
//
// Coverage (Codex required-checkpoint set):
//  1  Forecast does NOT assign nextProcessorBatch to a past month.
//  2  Hide a cow in its assigned month, turn Show hidden on, unhide it
//     from that same month.
//  3  Send-to-Processor creates an active batch with the EXACT displayed
//     virtual batch name.
//  4  Modal gate blocks tags outside the Forecast tab's next processor
//     tag set; whole send is blocked and blocked tags are listed.
//  5  Management/admin can edit Forecast controls and Send-to-Processor;
//     farm_team can view Forecast read-only and cannot send.
//  6  Batches tab shows virtual planned, active, completed sections; +
//     New Batch is absent.
//  7  Active batch auto-completes when all hanging weights exist, and
//     can be reopened.
// ============================================================================

const FORECAST_PATH = '/cattle/forecast';

async function waitForForecastLoaded(page) {
  await expect(page.locator('[data-cattle-forecast-root]')).toBeVisible({timeout: 15_000});
  // Next Processor Batch panel renders after settings + cattle land. The
  // panel always renders when forecast is computed; absence of the panel
  // means the forecast is still loading.
  await expect(page.locator('[data-next-processor-panel]')).toBeVisible({timeout: 15_000});
}

async function setRoleOverride(page, role) {
  // The DEV-only sentinel in main.jsx reads
  // window.localStorage.getItem('wcf-test-role-override') and applies it on
  // top of the resolved profile.role. Setting it before navigation gates
  // the Forecast view's edit controls accordingly.
  await page.addInitScript((r) => {
    if (r) window.localStorage.setItem('wcf-test-role-override', r);
    else window.localStorage.removeItem('wcf-test-role-override');
  }, role);
}

// --------------------------------------------------------------------------
// Test 1 — Past-month regression: nextProcessorBatch month is current or future.
// --------------------------------------------------------------------------
test('forecast: nextProcessorBatch lands in current or future month, never past', async ({
  page,
  cattleForecastScenario,
}) => {
  await page.goto(FORECAST_PATH);
  await waitForForecastLoaded(page);

  // F-AT-MAX (1450 lb) would land in 2026-01 without the monthsForAssignment
  // fix. Confirm the panel text shows a month >= current month.
  const panel = page.locator('[data-next-processor-panel]');
  await expect(panel).toBeVisible();
  // Read the panel's month label and assert no past-month label leaks.
  const panelText = (await panel.innerText()).toLowerCase();
  // Today is 2026-05-* so January..April 2026 are "past" months.
  for (const past of ['jan 2026', 'feb 2026', 'mar 2026', 'apr 2026']) {
    expect(panelText).not.toContain(past);
  }
  // And there must be SOME virtual batch — the seed has F1 and F-AT-MAX
  // both eligible, so a panel with "No virtual batch" copy would mean the
  // helper miscomputed.
  expect(panelText).not.toContain('no virtual batch');
});

// --------------------------------------------------------------------------
// Test 2 — Hide / Show hidden / Unhide cycle persists per-month, regardless
// of where the cow's current assignment rolls to.
// --------------------------------------------------------------------------
test('forecast: hide a cow, reveal under Show hidden, unhide from same month', async ({
  page,
  cattleForecastScenario,
  supabaseAdmin,
}) => {
  await page.goto(FORECAST_PATH);
  await waitForForecastLoaded(page);

  // Current + future tiles default-expanded (Codex 2026-05-04). F-HIDE's
  // assigned row is therefore already in the DOM somewhere. Find it and
  // read its parent month-bucket attribute.
  const fHideRow = page.locator('[data-month-row="F-HIDE"]').first();
  await expect(fHideRow).toBeVisible({timeout: 10_000});
  const hiddenMonth = await fHideRow.evaluate((el) => {
    const bucket = el.closest('[data-month-bucket]');
    return bucket ? bucket.getAttribute('data-month-bucket') : null;
  });
  expect(hiddenMonth).toBeTruthy();

  // Click Hide on F-HIDE in that month.
  const hideBtn = page.locator('[data-toggle-hide="F-HIDE"]');
  await expect(hideBtn).toBeVisible();
  await hideBtn.click();

  // In the ORIGINAL hide month, the assigned row goes away AND a muted
  // hidden-here row appears in its place — no global toggle needed (Codex
  // 2026-05-04 hide UX rework). F-HIDE's assignment rolls forward to a
  // different month and may render there too; that's expected.
  const hideMonthAssigned = page.locator(`[data-month-bucket="${hiddenMonth}"] [data-month-row="F-HIDE"]`);
  await expect(hideMonthAssigned).toHaveCount(0, {timeout: 5_000});

  // Verify a hidden row landed in the DB.
  const hiddenRows = await supabaseAdmin
    .from('cattle_forecast_hidden')
    .select('cattle_id, month_key')
    .eq('cattle_id', 'F-HIDE');
  expect(hiddenRows.data?.length).toBe(1);
  expect(hiddenRows.data?.[0].month_key).toBe(hiddenMonth);

  // Hidden-here row must be visible directly in the same tile. The bucket
  // may be auto-collapsed by the parent's monthFilter toggle; reopen if so.
  const targetBucket = page.locator(`[data-month-bucket="${hiddenMonth}"]`);
  if ((await targetBucket.locator('[data-month-bucket-table]').count()) === 0) {
    await targetBucket.locator('> div').first().click();
  }
  const hiddenHereRow = page.locator(`[data-month-bucket="${hiddenMonth}"] [data-month-hidden-row="F-HIDE"]`);
  await expect(hiddenHereRow).toBeVisible();

  // Unhide it.
  const unhideBtn = page.locator('[data-toggle-unhide="F-HIDE"]');
  await expect(unhideBtn).toBeVisible();
  await unhideBtn.click();

  // Hidden row gone, assignment row reappears in the bucket.
  await expect(hiddenHereRow).toHaveCount(0, {timeout: 5_000});
  // DB row removed.
  const after = await supabaseAdmin.from('cattle_forecast_hidden').select('cattle_id').eq('cattle_id', 'F-HIDE');
  expect(after.data?.length).toBe(0);
});

// --------------------------------------------------------------------------
// Test 3 — Send-to-Processor saves an active batch with the exact displayed
// virtual batch name.
// --------------------------------------------------------------------------
test('forecast → send: active batch saved with exact virtual batch name', async ({
  page,
  cattleForecastSendFlowScenario,
  supabaseAdmin,
}) => {
  // Read the displayed virtual batch name from the Forecast tab first.
  await page.goto(FORECAST_PATH);
  await waitForForecastLoaded(page);
  const panel = page.locator('[data-next-processor-panel]');
  const panelText = await panel.innerText();
  const m = panelText.match(/(C-\d{2}-\d{2,})/);
  expect(m).toBeTruthy();
  const expectedName = m[1];

  // The next virtual batch only contains F-AT-MAX (1002) because F-AT-MAX
  // is the only cow already inside the display window (1450 lb today). F1
  // projects ~2 months out, F-HIDE further. Unflag both F1 and F-HIDE so
  // the modal's selectedTags ⊆ next.allowedTagSet and the gate passes.
  await supabaseAdmin.from('weigh_ins').update({send_to_processor: false}).in('id', ['wi-send-F1', 'wi-send-F-HIDE']);

  // Drive the WeighIns view's Complete Session to fire the modal.
  await page.goto('/cattle/weighins');
  // Pick the draft session.
  const draftRow = page.locator('.hoverable-tile').filter({hasText: /draft/i}).first();
  await expect(draftRow).toBeVisible({timeout: 15_000});
  await draftRow.click();
  await page.getByRole('button', {name: /Complete Session/}).click();

  // Send modal opens — the displayed Next forecast batch must match the
  // Forecast tab's panel.
  const modal = page.locator('[data-cattle-send-modal]');
  await expect(modal).toBeVisible({timeout: 5_000});
  await expect(modal).toContainText(expectedName);

  // Confirm.
  await page.locator('[data-send-modal-confirm]').click();
  await expect(modal).toHaveCount(0, {timeout: 10_000});

  // DB: a single active batch was created with the EXACT virtual name.
  const r = await supabaseAdmin
    .from('cattle_processing_batches')
    .select('id, name, status, actual_process_date, cows_detail')
    .eq('name', expectedName);
  expect(r.error).toBeNull();
  expect(r.data?.length).toBe(1);
  const batch = r.data[0];
  expect(batch.status).toBe('active');
  // Processing date should equal the session date (2026-05-04 per seed).
  expect(batch.actual_process_date).toBe('2026-05-04');
  // Only F-AT-MAX attached (other tags were unflagged above).
  const tags = (batch.cows_detail || []).map((r2) => r2.tag).sort();
  expect(tags).toEqual(['1002']);
});

// --------------------------------------------------------------------------
// Test 4 — Modal gate blocks tags outside the Forecast tab's next batch.
// --------------------------------------------------------------------------
test('forecast → send: gate blocks tags outside next batch and lists them', async ({
  page,
  cattleForecastSendFlowScenario,
  supabaseAdmin,
}) => {
  // Hide F-HIDE in its assigned month so its tag drops OUT of next.allowedTagSet.
  // Easiest path: pre-hide via API at the cow's projected month. The
  // exact month doesn't matter — any hide row pushes F-HIDE off the next
  // bucket. Pick a bucket the helper will treat as eligible-but-hidden.
  // Since F-HIDE's projection isn't deterministic across spec runs, we
  // hide it in EVERY future month via the addHidden API. The helper's
  // ALL_ELIGIBLE_HIDDEN watchlist reason then guarantees F-HIDE never
  // appears in any bucket's animalIds.
  const months = [];
  // 18 months out is plenty.
  for (let i = 0; i < 18; i++) {
    const d = new Date('2026-05-04T12:00:00Z');
    d.setUTCMonth(d.getUTCMonth() + i);
    months.push(d.toISOString().slice(0, 7));
  }
  for (const mk of months) {
    await supabaseAdmin.from('cattle_forecast_hidden').insert({cattle_id: 'F-HIDE', month_key: mk, hidden_by: 'test'});
  }

  await page.goto('/cattle/weighins');
  const draftRow = page.locator('.hoverable-tile').filter({hasText: /draft/i}).first();
  await expect(draftRow).toBeVisible({timeout: 15_000});
  await draftRow.click();
  await page.getByRole('button', {name: /Complete Session/}).click();

  // Modal renders with three flagged cows including F-HIDE (tag 1003), but
  // F-HIDE is hidden in every month so its tag is NOT in the next batch's
  // allowedTagSet. The whole send must be blocked.
  const modal = page.locator('[data-cattle-send-modal]');
  await expect(modal).toBeVisible({timeout: 5_000});
  const blocked = page.locator('[data-send-modal-blocked]');
  await expect(blocked).toBeVisible();
  await expect(blocked).toContainText('1003');
  // Confirm button is disabled.
  await expect(page.locator('[data-send-modal-confirm]')).toBeDisabled();

  // No DB batch was created.
  const r = await supabaseAdmin.from('cattle_processing_batches').select('id');
  expect(r.error).toBeNull();
  expect(r.data?.length || 0).toBe(0);
});

// --------------------------------------------------------------------------
// Test 5 — Role gating: farm_team gets read-only Forecast; mgmt/admin edit.
// --------------------------------------------------------------------------
test('forecast: farm_team is read-only, no Include Heifers / Settings save', async ({page, cattleForecastScenario}) => {
  await setRoleOverride(page, 'farm_team');
  await page.goto(FORECAST_PATH);
  await waitForForecastLoaded(page);

  // READ-ONLY badge visible.
  await expect(page.locator('[data-forecast-readonly]')).toBeVisible();
  // Include Momma Herd Heifers button absent.
  await expect(page.locator('[data-include-heifers-btn]')).toHaveCount(0);
  // Settings panel shows but Save Settings button is absent for farm_team.
  await page.getByRole('button', {name: 'Settings'}).click();
  await expect(page.locator('[data-forecast-settings-panel]')).toBeVisible();
  await expect(page.locator('[data-save-settings-btn]')).toHaveCount(0);
});

test('send-to-processor: farm_team cannot send even when the tag gate would otherwise pass', async ({
  page,
  cattleForecastSendFlowScenario,
  supabaseAdmin,
}) => {
  // Force farm_team role for this page's session via the DEV-only override.
  await setRoleOverride(page, 'farm_team');

  // Drop F1 + F-HIDE flags so only F-AT-MAX (which is in the next batch's
  // allowed tag set) stays selected; the gate then passes cleanly so the
  // role gate is the only thing keeping Confirm disabled.
  await supabaseAdmin.from('weigh_ins').update({send_to_processor: false}).in('id', ['wi-send-F1', 'wi-send-F-HIDE']);

  await page.goto('/cattle/weighins');
  const draftRow = page.locator('.hoverable-tile').filter({hasText: /draft/i}).first();
  await expect(draftRow).toBeVisible({timeout: 15_000});
  await draftRow.click();
  await page.getByRole('button', {name: /Complete Session/}).click();

  const modal = page.locator('[data-cattle-send-modal]');
  await expect(modal).toBeVisible({timeout: 5_000});

  // Tag gate is valid → blocked banner must NOT render. If it did render,
  // we couldn't tell whether Confirm was disabled by the role gate or the
  // tag gate, so this assertion is load-bearing.
  await expect(page.locator('[data-send-modal-blocked]')).toHaveCount(0);

  // Role gate disables the Confirm button.
  await expect(page.locator('[data-send-modal-confirm]')).toBeDisabled();

  // No DB batch was created.
  const r = await supabaseAdmin.from('cattle_processing_batches').select('id');
  expect(r.error).toBeNull();
  expect(r.data?.length || 0).toBe(0);
});

test('forecast: current and future month tiles default to expanded; past months collapsed', async ({
  page,
  cattleForecastScenario,
}) => {
  await page.goto(FORECAST_PATH);
  await waitForForecastLoaded(page);

  const nowYm = new Date().toISOString().slice(0, 7);
  const tile = page.locator(`[data-month-bucket="${nowYm}"]`);
  await expect(tile).toBeVisible();
  // Current month tile renders the inner table without a click.
  await expect(tile.locator('[data-month-bucket-table]')).toBeVisible({timeout: 5_000});

  // Pick a past month in the same year that the tile renders for.
  const pastYm = nowYm.slice(0, 5) + '01'; // YYYY-01
  if (pastYm < nowYm) {
    const past = page.locator(`[data-month-bucket="${pastYm}"]`);
    if ((await past.count()) > 0) {
      // Past month tile starts collapsed → no inner table rendered yet.
      await expect(past.locator('[data-month-bucket-table]')).toHaveCount(0);
    }
  }
});

test('forecast: per-cow row shows ADG value + calc text', async ({page, cattleForecastScenario}) => {
  await page.goto(FORECAST_PATH);
  await waitForForecastLoaded(page);

  // Find the next-processor batch month + open it. Has at least F-AT-MAX
  // (1450 lb) in May or later.
  const panel = page.locator('[data-next-processor-panel]');
  const m = (await panel.innerText()).match(/(\w{3} \d{4})/);
  expect(m).toBeTruthy();
  // Find a month bucket and confirm row text contains "lb/day · …" calc string.
  const anyRow = page.locator('[data-month-row]').first();
  await expect(anyRow).toBeVisible();
  const rowText = await anyRow.innerText();
  // Calc string format: "X.XX lb/day · last 3 weigh-ins" / "last 2 weigh-ins"
  // / "1 weigh-in + global" / "DOB + global" / "global only".
  expect(rowText).toMatch(/lb\/day · (last [23] weigh-ins|1 weigh-in \+ global|DOB \+ global|global only)/);
});

test('forecast: Attention section near top with rows or empty state', async ({page, cattleForecastScenario}) => {
  await page.goto(FORECAST_PATH);
  await waitForForecastLoaded(page);

  // The Attention section ALWAYS renders, even when empty (Codex 2026-05-04
  // follow-up). With the seed's W1 cow (no weight + no DOB), at least one
  // attention row exists, so the empty-state element is absent.
  const attention = page.locator('[data-forecast-attention]');
  await expect(attention).toBeVisible();
  // Section header text is the explicit operator label.
  await expect(attention).toContainText(/NEEDS ATTENTION/i);
  // Attention must render BEFORE the year selector — no scroll past month
  // tiles to find it. Compare DOM position via getBoundingClientRect.
  const yearBtn = page.locator('[data-year-button]').first();
  if ((await yearBtn.count()) > 0) {
    const aBox = await attention.boundingBox();
    const yBox = await yearBtn.boundingBox();
    expect(aBox.y).toBeLessThan(yBox.y);
  }
});

test('forecast: actual-batch month shows "X cows processed" and lists cow tags', async ({
  page,
  cattleForecastScenario,
  supabaseAdmin,
}) => {
  // Seed an actual ACTIVE batch in current month so its month tile renders
  // a "processed" pill + per-cow detail under the batch row.
  const monthKey = new Date().toISOString().slice(0, 7);
  await supabaseAdmin.from('cattle_processing_batches').insert({
    id: 'b-actual-test-1',
    name: 'C-26-90',
    status: 'active',
    actual_process_date: monthKey + '-04',
    planned_process_date: monthKey + '-04',
    cows_detail: [
      {cattle_id: 'F1', tag: '1001', live_weight: 1100, hanging_weight: null},
      {cattle_id: 'F-AT-MAX', tag: '1002', live_weight: 1450, hanging_weight: null},
    ],
    total_live_weight: 2550,
    total_hanging_weight: null,
  });
  await supabaseAdmin
    .from('cattle')
    .update({herd: 'processed', processing_batch_id: 'b-actual-test-1'})
    .in('id', ['F1', 'F-AT-MAX']);

  await page.goto(FORECAST_PATH);
  await waitForForecastLoaded(page);

  const tile = page.locator(`[data-month-bucket="${monthKey}"]`);
  await expect(tile).toBeVisible();

  // Pill: "2 cows processed" rendered by the new processed-count pill.
  const processedPill = tile.locator('[data-month-processed-count]');
  await expect(processedPill).toBeVisible();
  await expect(processedPill).toContainText('2 cows processed');

  // The actual batch row carries cow tags + status + name.
  const batchRow = tile.locator('[data-actual-batch="b-actual-test-1"]');
  await expect(batchRow).toBeVisible();
  await expect(batchRow).toContainText('C-26-90');
  await expect(batchRow).toContainText('1001');
  await expect(batchRow).toContainText('1002');

  // Per-cow expanded table.
  const innerTable = page.locator('[data-actual-batch-table="b-actual-test-1"]');
  await expect(innerTable).toBeVisible();
  await expect(innerTable.locator('[data-actual-batch-row="F1"]')).toBeVisible();
  await expect(innerTable.locator('[data-actual-batch-row="F-AT-MAX"]')).toBeVisible();
});

test('forecast: hidden row shows projected weight for the hide month + Unhide button', async ({
  page,
  cattleForecastScenario,
  supabaseAdmin,
}) => {
  await page.goto(FORECAST_PATH);
  await waitForForecastLoaded(page);

  // Find F-HIDE's assigned month bucket (current/future tiles default-expanded).
  const fHideRow = page.locator('[data-month-row="F-HIDE"]').first();
  await expect(fHideRow).toBeVisible({timeout: 10_000});
  const hiddenMonth = await fHideRow.evaluate((el) => {
    const bucket = el.closest('[data-month-bucket]');
    return bucket ? bucket.getAttribute('data-month-bucket') : null;
  });

  // Hide F-HIDE in that month.
  await page.locator('[data-toggle-hide="F-HIDE"]').click();
  // DB row landed.
  await expect
    .poll(async () => {
      const r = await supabaseAdmin.from('cattle_forecast_hidden').select('cattle_id').eq('cattle_id', 'F-HIDE');
      return r.data?.length || 0;
    })
    .toBe(1);

  // Hidden-here row in the original tile shows a projected weight (lb)
  // for THAT month — not just "rolled to …" — and an Unhide button.
  const hiddenCell = page.locator(`[data-month-bucket="${hiddenMonth}"] [data-hidden-projected="F-HIDE"]`);
  await expect(hiddenCell).toBeVisible({timeout: 5_000});
  await expect(hiddenCell).toContainText(/\d+,?\d* lb/);
  await expect(page.locator('[data-toggle-unhide="F-HIDE"]')).toBeVisible();
});

test('forecast: tag search filters planned + actual batch rows; clear restores', async ({
  page,
  cattleForecastScenario,
  supabaseAdmin,
}) => {
  // Seed an actual ACTIVE batch with F-AT-MAX so tag search has both a
  // planned row (F1 → tag 1001) AND an actual-batch row (F-AT-MAX → tag 1002)
  // to discriminate against.
  const monthKey = new Date().toISOString().slice(0, 7);
  await supabaseAdmin.from('cattle_processing_batches').insert({
    id: 'b-search-test-1',
    name: 'C-26-91',
    status: 'active',
    actual_process_date: monthKey + '-04',
    planned_process_date: monthKey + '-04',
    cows_detail: [{cattle_id: 'F-AT-MAX', tag: '1002', live_weight: 1450, hanging_weight: null}],
    total_live_weight: 1450,
    total_hanging_weight: null,
  });
  await supabaseAdmin
    .from('cattle')
    .update({herd: 'processed', processing_batch_id: 'b-search-test-1'})
    .eq('id', 'F-AT-MAX');

  await page.goto(FORECAST_PATH);
  await waitForForecastLoaded(page);

  const search = page.locator('[data-forecast-tag-search]');
  await expect(search).toBeVisible();

  // Search "1001" — F1 row visible; F-AT-MAX actual batch row hidden.
  await search.fill('1001');
  await expect(page.locator('[data-month-row="F1"]')).toBeVisible();
  await expect(page.locator('[data-actual-batch-row="F-AT-MAX"]')).toHaveCount(0);

  // Search "1002" — actual-batch row visible; F1 planned row hidden.
  await search.fill('1002');
  await expect(page.locator('[data-actual-batch-row="F-AT-MAX"]')).toBeVisible();
  await expect(page.locator('[data-month-row="F1"]')).toHaveCount(0);

  // Clear button restores both.
  await page.locator('[data-forecast-tag-search-clear]').click();
  await expect(page.locator('[data-month-row="F1"]')).toBeVisible();
  await expect(page.locator('[data-actual-batch-row="F-AT-MAX"]')).toBeVisible();
});

test('forecast: actual-batch table does not include ADG Calc; planned table does', async ({
  page,
  cattleForecastScenario,
  supabaseAdmin,
}) => {
  const monthKey = new Date().toISOString().slice(0, 7);
  await supabaseAdmin.from('cattle_processing_batches').insert({
    id: 'b-no-adg-test',
    name: 'C-26-92',
    status: 'active',
    actual_process_date: monthKey + '-04',
    planned_process_date: monthKey + '-04',
    cows_detail: [{cattle_id: 'F-AT-MAX', tag: '1002', live_weight: 1450, hanging_weight: null}],
    total_live_weight: 1450,
    total_hanging_weight: null,
  });
  await supabaseAdmin
    .from('cattle')
    .update({herd: 'processed', processing_batch_id: 'b-no-adg-test'})
    .eq('id', 'F-AT-MAX');

  await page.goto(FORECAST_PATH);
  await waitForForecastLoaded(page);

  // Actual batch table headers: Tag / Sex / Herd / Live / Hanging — no ADG Calc.
  const actualTable = page.locator('[data-actual-batch-table="b-no-adg-test"]');
  await expect(actualTable).toBeVisible();
  const actualHeaders = await actualTable.locator('thead th').allTextContents();
  expect(actualHeaders.map((s) => s.trim())).toEqual(['Tag', 'Sex', 'Herd', 'Live', 'Hanging']);
  // Sanity: planned table for the same view DOES include ADG Calc.
  const plannedTable = page.locator('[data-month-bucket-table]').first();
  await expect(plannedTable).toBeVisible();
  const plannedHeaders = await plannedTable.locator('thead th').allTextContents();
  expect(plannedHeaders.map((s) => s.trim())).toContain('ADG Calc');
});

test('forecast: visible dates render as mm/dd/yy', async ({page, cattleForecastScenario, supabaseAdmin}) => {
  // Seed an actual batch so a batch-date renders + the planned row's latest
  // weigh-in already has a date in the seed.
  const monthKey = new Date().toISOString().slice(0, 7);
  await supabaseAdmin.from('cattle_processing_batches').insert({
    id: 'b-date-test',
    name: 'C-26-93',
    status: 'active',
    actual_process_date: monthKey + '-04',
    planned_process_date: monthKey + '-04',
    cows_detail: [{cattle_id: 'F-AT-MAX', tag: '1002', live_weight: 1450, hanging_weight: null}],
    total_live_weight: 1450,
    total_hanging_weight: null,
  });

  await page.goto(FORECAST_PATH);
  await waitForForecastLoaded(page);

  // Planned-row Latest cell: weight + " · MM/DD/YY".
  const f1Row = page.locator('[data-month-row="F1"]');
  await expect(f1Row).toBeVisible();
  await expect(f1Row).toContainText(/\d{2}\/\d{2}\/\d{2}/);
  // Raw YYYY-MM-DD must NOT appear in the planned-row text.
  const f1Text = await f1Row.innerText();
  expect(f1Text).not.toMatch(/\b\d{4}-\d{2}-\d{2}\b/);

  // Actual-batch header date renders mm/dd/yy too.
  const batchHeader = page.locator('[data-actual-batch="b-date-test"]');
  await expect(batchHeader).toContainText(/\d{2}\/\d{2}\/\d{2}/);
});

test('forecast: include-heifers modal rows show age + latest weight visible without expanding', async ({
  page,
  cattleForecastScenario,
}) => {
  await page.goto(FORECAST_PATH);
  await waitForForecastLoaded(page);

  await page.locator('[data-include-heifers-btn]').click();
  await expect(page.locator('[data-include-heifers-modal]')).toBeVisible({timeout: 5_000});

  const heiferRow = page.locator('[data-heifer-row="M-HEIFER"]');
  await expect(heiferRow).toBeVisible();
  // Age + latest-weight cells render directly in the row (no Details click).
  await expect(page.locator('[data-heifer-age="M-HEIFER"]')).toBeVisible();
  await expect(page.locator('[data-heifer-latest-weight="M-HEIFER"]')).toBeVisible();
});

test('forecast: admin can save settings + open Include Heifers modal', async ({page, cattleForecastScenario}) => {
  // Default storageState is admin.
  await page.goto(FORECAST_PATH);
  await waitForForecastLoaded(page);
  await expect(page.locator('[data-forecast-readonly]')).toHaveCount(0);
  await expect(page.locator('[data-include-heifers-btn]')).toBeVisible();
  // Open settings, see Save Settings.
  await page.getByRole('button', {name: 'Settings'}).click();
  await expect(page.locator('[data-save-settings-btn]')).toBeVisible();
});

// --------------------------------------------------------------------------
// Test 6 — Batches tab: three sections, no + New Batch.
// --------------------------------------------------------------------------
test('batches: three sections (planned / active / completed); + New Batch removed', async ({
  page,
  cattleForecastScenario,
}) => {
  await page.goto('/cattle/batches');
  await expect(page.locator('[data-cattle-batches-root]')).toBeVisible({timeout: 15_000});

  // No + New Batch button anywhere.
  await expect(page.getByRole('button', {name: /\+ New Batch/i})).toHaveCount(0);

  // Planned (virtual) section header present, collapsed by default.
  const plannedSection = page.locator('[data-batches-section="planned"]');
  await expect(plannedSection).toBeVisible();
  await expect(plannedSection).toContainText('Show Planned Batches');

  // Active section header rendered with count parenthesized; seed has zero
  // active batches by default.
  await expect(page.getByText(/^Active \(0\)/)).toBeVisible();

  // Completed section header (collapsed).
  const completedSection = page.locator('[data-batches-section="completed"]');
  await expect(completedSection).toBeVisible();
  await expect(completedSection).toContainText('Show Completed Batches');

  // Expand Planned — should show at least one virtual planned batch tile.
  await plannedSection.locator('> div').first().click();
  // Virtual batches use data-virtual-batch attr set to the C-YY-NN name.
  const virtualBatches = page.locator('[data-virtual-batch]');
  await expect(virtualBatches.first()).toBeVisible({timeout: 5_000});
});

// --------------------------------------------------------------------------
// Test 7 — Auto-complete on full hanging weights + reopen back to active.
// --------------------------------------------------------------------------
test('batches: active auto-flips to complete on full hanging weights; reopen restores active', async ({
  page,
  cattleForecastScenario,
  supabaseAdmin,
}) => {
  // Seed a real active batch directly (mimics what Send-to-Processor would
  // create) so we can drive the hanging-weight UI without going through the
  // weighins flow.
  const batchId = 'b-active-test-1';
  await supabaseAdmin.from('cattle_processing_batches').insert({
    id: batchId,
    name: 'C-26-99',
    status: 'active',
    actual_process_date: '2026-05-04',
    planned_process_date: '2026-05-04',
    cows_detail: [
      {cattle_id: 'F1', tag: '1001', live_weight: 1100, hanging_weight: null},
      {cattle_id: 'F-AT-MAX', tag: '1002', live_weight: 1450, hanging_weight: null},
    ],
    total_live_weight: 2550,
    total_hanging_weight: null,
  });
  // Move both cows to processed herd to satisfy the implicit "linked
  // through send-to-processor" state.
  await supabaseAdmin
    .from('cattle')
    .update({herd: 'processed', processing_batch_id: batchId})
    .in('id', ['F1', 'F-AT-MAX']);

  await page.goto('/cattle/batches');
  await expect(page.locator('[data-cattle-batches-root]')).toBeVisible({timeout: 15_000});

  // Tile renders with status=active.
  const tile = page.locator('[data-batch-row="' + batchId + '"]');
  await expect(tile).toBeVisible();
  await expect(tile).toHaveAttribute('data-batch-status', 'active');

  // Expand and try to mark complete with weights still missing — expect alert.
  await tile.locator('> div').first().click();
  // Auto-complete fires on full hanging weights, so let's enter both:
  const w1 = page.locator('[data-batch-hanging-weight="F1"]');
  await w1.fill('660');
  await w1.blur();
  // Wait briefly for first save round-trip.
  await page.waitForTimeout(400);
  const w2 = page.locator('[data-batch-hanging-weight="F-AT-MAX"]');
  await w2.fill('870');
  await w2.blur();

  // After both weights, the helper auto-flips to complete. The tile moves
  // from the Active section into the (collapsed) Completed section, so the
  // active-section locator becomes detached from the DOM. Verify via the
  // header counter and DB before re-opening Completed.
  await expect(page.getByText(/^Active \(0\)/)).toBeVisible({timeout: 10_000});
  await expect
    .poll(
      async () => {
        const r = await supabaseAdmin.from('cattle_processing_batches').select('status').eq('id', batchId).single();
        return r.data?.status;
      },
      {timeout: 10_000, message: 'auto-complete did not land on the DB row'},
    )
    .toBe('complete');

  // Expand Completed section so the tile is in the DOM again. The tile was
  // already expanded from the earlier weight-entry step (expandedBatchId
  // state survives the auto-flip), so its detail panel re-renders along
  // with the section. Clicking the tile header again would TOGGLE IT
  // CLOSED — don't.
  await page.locator('[data-batches-section="completed"]').locator('> div').first().click();
  const completedTile = page.locator('[data-batch-row="' + batchId + '"]');
  await expect(completedTile).toHaveAttribute('data-batch-status', 'complete');

  const reopen = page.locator('[data-reopen="' + batchId + '"]');
  await expect(reopen).toBeVisible();
  await reopen.click();

  // After reopen, the tile flips back to active. The Active counter shows 1.
  await expect(page.getByText(/^Active \(1\)/)).toBeVisible({timeout: 5_000});
  const r = await supabaseAdmin.from('cattle_processing_batches').select('status').eq('id', batchId).single();
  expect(r.data.status).toBe('active');
});
