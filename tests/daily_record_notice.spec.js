import {test, expect} from './fixtures.js';

// ============================================================================
// Daily record InlineNotice API — mutation notices actually render.
// ============================================================================
// The daily record pages previously passed kind=/message= props that the
// current InlineNotice ({notice, onDismiss}) ignores, so save/delete notices
// silently never rendered. After the API fix (notice={notice}), a successful
// save surfaces the "Saved." success banner. This is the regression lock that
// the cleanup actually wired the notice through — pre-fix nothing rendered.
// loadError stays non-dismissible (locked separately in the readiness statics).
// ============================================================================

async function seedDaily(supabaseAdmin, {id, date, herd = 'finishers'}) {
  const r = await supabaseAdmin
    .from('cattle_dailys')
    .upsert(
      {id, date, herd, deleted_at: null, deleted_by: null, client_submission_id: null, photos: []},
      {onConflict: 'id'},
    );
  if (r.error) throw new Error('seedDaily(' + id + '): ' + r.error.message);
}

test('cattle daily record save surfaces the InlineNotice success banner', async ({page, supabaseAdmin, resetDb}) => {
  await resetDb();
  await seedDaily(supabaseAdmin, {id: 'cd-notice-1', date: '2026-05-03'});

  await page.goto('/cattle/dailys/cd-notice-1');
  await expect(page.locator('[data-record-title="1"]')).toBeVisible({timeout: 15_000});

  await page.locator('[data-daily-save="1"]').click();

  // The success notice now renders through the corrected InlineNotice API.
  // (Pre-fix the kind=/message= props were ignored and nothing appeared.)
  const banner = page.locator('[data-inline-notice="success"]');
  await expect(banner).toBeVisible({timeout: 10_000});
  await expect(banner).toContainText('Saved.');
});
