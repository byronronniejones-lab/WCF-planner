import {test, expect} from './fixtures.js';

// CP4 — record-page sequence navigation for layer.batch (/layer/batches/<id>)
// and the NESTED layer.housing (/layer/housings/<id>, reached from a batch page).

async function seedLayerBatch(supabaseAdmin, {id, name, status = 'active'}) {
  const {error} = await supabaseAdmin.from('layer_batches').insert({id, name, status});
  if (error) throw new Error('seedLayerBatch(' + id + '): ' + error.message);
}

async function seedHousing(supabaseAdmin, {id, batchId, name}) {
  const {error} = await supabaseAdmin
    .from('layer_housings')
    .insert({id, batch_id: batchId, housing_name: name, status: 'active'});
  if (error) throw new Error('seedHousing(' + id + '): ' + error.message);
}

test.describe('Layer batch record-page sequence navigation', () => {
  test('batch tile opens with Prev/Next; Next advances to the labeled neighbor', async ({
    page,
    supabaseAdmin,
    resetDb,
  }) => {
    await resetDb();
    await seedLayerBatch(supabaseAdmin, {id: 'lb-1', name: 'LB-One'});
    await seedLayerBatch(supabaseAdmin, {id: 'lb-2', name: 'LB-Two'});

    await page.goto('/layer/batches');
    await expect(page.locator('[data-layer-batch-tile]').first()).toBeVisible({timeout: 15_000});
    await page.locator('[data-layer-batch-tile]').first().click();

    await expect(page).toHaveURL(/\/layer\/batches\/lb-/, {timeout: 10_000});
    await expect(page.locator('[data-record-seq-nav="1"]')).toBeVisible();
    await expect(page.locator('[data-record-seq-position="1"]')).toHaveText('1 of 2');
    await expect(page.locator('[data-record-seq-prev="1"]')).toBeDisabled();

    const nextBtn = page.locator('[data-record-seq-next="1"]');
    const nextLabel = (await nextBtn.innerText()).replace(/[‹›]/g, '').trim();
    expect(nextLabel).toMatch(/^LB-/);

    await nextBtn.click();
    await expect(page.locator('[data-record-title="1"]')).toHaveText(nextLabel, {timeout: 10_000});
    await expect(page.locator('[data-record-seq-position="1"]')).toHaveText('2 of 2');
  });

  test('direct batch URL hides the sequence controls', async ({page, supabaseAdmin, resetDb}) => {
    await resetDb();
    await seedLayerBatch(supabaseAdmin, {id: 'lb-1', name: 'LB-One'});
    await seedLayerBatch(supabaseAdmin, {id: 'lb-2', name: 'LB-Two'});

    await page.goto('/layer/batches/lb-1');
    await expect(page.locator('[data-record-title="1"]')).toHaveText('LB-One', {timeout: 15_000});
    await expect(page.locator('[data-record-seq-nav="1"]')).toHaveCount(0);
  });
});

test.describe('Layer housing record-page sequence navigation (nested)', () => {
  test('housing tile opens with Prev/Next; Next advances to the labeled neighbor', async ({
    page,
    supabaseAdmin,
    resetDb,
  }) => {
    await resetDb();
    await seedLayerBatch(supabaseAdmin, {id: 'lb-1', name: 'LB-One'});
    await seedHousing(supabaseAdmin, {id: 'lh-1', batchId: 'lb-1', name: 'Barn A'});
    await seedHousing(supabaseAdmin, {id: 'lh-2', batchId: 'lb-1', name: 'Barn B'});
    await seedHousing(supabaseAdmin, {id: 'lh-3', batchId: 'lb-1', name: 'Barn C'});

    // Open the batch record page directly (no batch sequence), then click a housing.
    await page.goto('/layer/batches/lb-1');
    await expect(page.locator('[data-layer-housing-tile]').first()).toBeVisible({timeout: 15_000});
    await page.locator('[data-layer-housing-tile]').first().click();

    await expect(page).toHaveURL(/\/layer\/housings\/lh-/, {timeout: 10_000});
    await expect(page.locator('[data-record-seq-nav="1"]')).toBeVisible();
    await expect(page.locator('[data-record-seq-position="1"]')).toHaveText('1 of 3');
    await expect(page.locator('[data-record-seq-prev="1"]')).toBeDisabled();

    const nextBtn = page.locator('[data-record-seq-next="1"]');
    const nextLabel = (await nextBtn.innerText()).replace(/[‹›]/g, '').trim();
    expect(nextLabel).toMatch(/^Barn /);

    await nextBtn.click();
    // Housing title is "🏠 <housing_name>".
    await expect(page.locator('[data-record-title="1"]')).toContainText(nextLabel, {timeout: 10_000});
    await expect(page.locator('[data-record-seq-position="1"]')).toHaveText('2 of 3');
    await expect(page.locator('[data-record-seq-prev="1"]')).toBeEnabled();
  });

  test('direct housing URL hides the sequence controls', async ({page, supabaseAdmin, resetDb}) => {
    await resetDb();
    await seedLayerBatch(supabaseAdmin, {id: 'lb-1', name: 'LB-One'});
    await seedHousing(supabaseAdmin, {id: 'lh-1', batchId: 'lb-1', name: 'Barn A'});
    await seedHousing(supabaseAdmin, {id: 'lh-2', batchId: 'lb-1', name: 'Barn B'});

    await page.goto('/layer/housings/lh-1');
    await expect(page.locator('[data-record-title="1"]')).toContainText('Barn A', {timeout: 15_000});
    await expect(page.locator('[data-record-seq-nav="1"]')).toHaveCount(0);
  });
});
