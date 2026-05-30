import {test, expect} from './fixtures.js';
import {waitForPigFeedersLoaded} from './helpers/pigReady.js';

// CP1 — farm-born pig batches are created from the FIRST farrowing record of a
// breeding cycle (create-only, idempotent). This drives the real FarrowingView
// form path → persistFeeders write → /pig/batches tile.

const CYCLE_ID = 'cyc-fb-1';
// exposureStart 2026-01-01 → farrowing window opens ~2026-04-27; 2026-05-01 is
// safely in-window (and well within the +14d buffer).
const FARROW_DATE = '2026-05-01';

async function seedCycle(supabaseAdmin) {
  await supabaseAdmin.from('app_store').upsert(
    {
      key: 'ppp-breeding-v1',
      data: [{id: CYCLE_ID, group: '1', exposureStart: '2026-01-01', sowCount: 3, boar1Tags: '5,6,7'}],
    },
    {onConflict: 'key'},
  );
  await supabaseAdmin.from('app_store').upsert({key: 'ppp-farrowing-v1', data: []}, {onConflict: 'key'});
  await supabaseAdmin.from('app_store').upsert({key: 'ppp-feeders-v1', data: []}, {onConflict: 'key'});
  await supabaseAdmin.from('app_store').upsert({key: 'ppp-breeders-v1', data: []}, {onConflict: 'key'});
}

async function readFeeders(supabaseAdmin) {
  const {data} = await supabaseAdmin.from('app_store').select('data').eq('key', 'ppp-feeders-v1').single();
  return (data && data.data) || [];
}

// Fill the farrow form for one sow and save. The sow field is a <select> when
// the cycle resolves (built from its tags) and a plain input otherwise.
async function recordFarrowing(page, {sow, totalBorn, deaths}) {
  await page.locator('[data-farrow-date]').fill(FARROW_DATE);
  const sowField = page.locator('[data-farrow-sow]');
  const tag = await sowField.evaluate((el) => el.tagName);
  if (tag === 'SELECT') await sowField.selectOption(sow);
  else await sowField.fill(sow);
  await page.locator('[data-farrow-total-born]').fill(String(totalBorn));
  await page.locator('[data-farrow-deaths]').fill(String(deaths));
  await page.locator('[data-farrow-save]').click();
}

test('first farrowing record creates a neutral farm-born batch; second does not duplicate', async ({
  page,
  supabaseAdmin,
  resetDb,
}) => {
  await resetDb();
  await seedCycle(supabaseAdmin);

  await page.goto('/pig/farrowing');
  await page.locator(`[data-farrow-add-record="${CYCLE_ID}"]`).click();
  await recordFarrowing(page, {sow: '5', totalBorn: 12, deaths: 2}); // alive 10

  // The farm-born batch is written to ppp-feeders-v1.
  await expect.poll(async () => (await readFeeders(supabaseAdmin)).length, {timeout: 15_000}).toBe(1);
  const batch = (await readFeeders(supabaseAdmin))[0];
  expect(batch.farmBorn).toBe(true);
  expect(batch.cycleId).toBe(CYCLE_ID);
  expect(batch.id).toBe('farrowing-cycle-' + CYCLE_ID);
  expect(batch.batchName).toBe('P-26-01');
  expect(batch.originalPigCount).toBe(10); // totalBorn - deaths
  expect(batch.startDate).toBe(FARROW_DATE);
  expect(batch.giltCount).toBe(0);
  expect(batch.boarCount).toBe(0);

  // The generated batch shows on the hub and is routable to its record page.
  await page.goto('/pig/batches');
  await waitForPigFeedersLoaded(page);
  const tile = page.locator(`[data-pig-batch-tile="${batch.id}"]`);
  await expect(tile).toBeVisible({timeout: 15_000});
  await tile.click();
  await expect(page).toHaveURL(new RegExp('/pig/batches/' + encodeURIComponent(batch.id) + '$'), {timeout: 10_000});

  // A second farrowing record in the same cycle must not duplicate or overwrite.
  await page.goto('/pig/farrowing');
  await page.locator(`[data-farrow-add-record="${CYCLE_ID}"]`).click();
  await recordFarrowing(page, {sow: '6', totalBorn: 8, deaths: 1}); // alive 7

  // Give the (no-op) save a moment, then assert exactly one batch, unchanged count.
  await page.waitForTimeout(1500);
  const after = await readFeeders(supabaseAdmin);
  expect(after).toHaveLength(1);
  expect(after[0].originalPigCount).toBe(10); // NOT re-summed to 17
  expect(after[0].id).toBe('farrowing-cycle-' + CYCLE_ID);
});
