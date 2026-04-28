import { test, expect } from './fixtures.js';

// ============================================================================
// Sheep Send-to-Processor spec — Phase A6
// ============================================================================
// Mirror of A5 (tests/cattle_send_to_processor.spec.js) for sheep, with one
// behavioral difference locked: the §7 sheep gate is intentionally LOOSER
// than cattle (any draft session, any flock, vs cattle's finishers-only).
//
// 10 tests, structured around the §7 entries each one protects:
//
//   1  happy-path attach            — prior_herd_or_flock stamping +
//                                     sheep_transfers audit + sheep_detail
//                                     content per sheep
//   2  toggle-clear detach          — full UI round-trip: attach → reopen
//                                     → toggle off
//   3  entry-delete detach          — _wcfConfirmDelete stub post-mount
//   4  session-delete detach        — 3-sheep loop
//   5  batch-delete detach          — 3-sheep loop, drives DeleteModal UI
//   6  fallback to audit row        — prior_herd_or_flock null →
//                                     sheep_transfers.from_flock resolves
//   7  null from_flock guard        — audit row exists but from_flock=null
//                                     → truthy guard at
//                                     sheepProcessingBatch.js:170 forces
//                                     no_prior_flock
//   8  no audit row block           — neither path resolves → blocked
//   9  looser gate (rams flock)     — UNIQUE TO SHEEP. A rams-flock entry
//                                     CAN attach to a processing batch
//                                     (cattle would refuse). Locks the §7
//                                     "sheep gate is intentionally looser"
//                                     rule.
//   10 no manual bypass             — /sheep/batches has no manual sheep
//                                     attach UI (negative assertion)
// ============================================================================

const FEEDERS_LABEL = 'Feeders';
const RAMS_LABEL = 'Rams';

function uniqueRow(page, tag) {
  // Same dual-filter strategy as the cattle spec: anchor on the always-
  // present Edit button so the locator lands on the entry box (or its
  // flex-column child) rather than an inner row that lacks buttons or an
  // outer container that contains every entry's buttons.
  return page
    .locator('div')
    .filter({ has: page.locator('span', { hasText: new RegExp(`^#${tag}$`) }) })
    .filter({ has: page.getByRole('button', { name: 'Edit', exact: true }) })
    .last();
}

async function installConfirmDeleteStub(page) {
  await page.waitForFunction(() => typeof window._wcfConfirmDelete === 'function');
  await page.evaluate(() => {
    window._wcfConfirmDelete = (_msg, fn) => fn();
  });
}

// --------------------------------------------------------------------------
// Test 1 — happy-path attach via UI (feeders flock)
// --------------------------------------------------------------------------
test('attach: complete session + modal stamps prior_herd_or_flock and writes audit', async ({
  page,
  sheepSendToProcessorScenario,
  supabaseAdmin,
}) => {
  const { batchId, sessionId, sheep } = await sheepSendToProcessorScenario({ flock: 'feeders' });

  await page.goto('/sheep/weighins');

  const sessionRow = page
    .locator('.hoverable-tile')
    .filter({ hasText: FEEDERS_LABEL })
    .filter({ hasText: /draft/i });
  await expect(sessionRow).toBeVisible({ timeout: 15_000 });
  await sessionRow.click();

  await page.getByRole('button', { name: /Complete Session/ }).click();

  // Post-patch modal title: '🚩 Send N sheep to processor' (no plural 's' —
  // "sheep" is invariant; SheepSendToProcessorModal.jsx:80 was simplified
  // from the cattle-style finisher/finishers branch in this same PR).
  const modalTitle = page.getByText(/Send 3 sheep to processor/);
  await expect(modalTitle).toBeVisible({ timeout: 5_000 });

  const select = page
    .locator('select')
    .filter({ has: page.locator(`option[value="${batchId}"]`) })
    .first();
  await select.selectOption(batchId);

  await page.getByRole('button', { name: 'Send to processor' }).click();
  await expect(modalTitle).toHaveCount(0, { timeout: 10_000 });

  // --- Assertions: poll until the attach lands. ---
  await expect
    .poll(
      async () => {
        const r = await supabaseAdmin
          .from('sheep_processing_batches')
          .select('sheep_detail')
          .eq('id', batchId)
          .single();
        return (r.data?.sheep_detail || []).length;
      },
      { timeout: 10_000, message: 'sheep_detail did not populate after attach' }
    )
    .toBe(3);

  // sheep_detail content: sheep_id + tag + live_weight per sheep.
  const batchAfter = await supabaseAdmin
    .from('sheep_processing_batches')
    .select('sheep_detail')
    .eq('id', batchId)
    .single();
  const detailByTag = Object.fromEntries(
    (batchAfter.data.sheep_detail || []).map((r) => [r.tag, r])
  );
  expect(detailByTag).toEqual({
    '3001': { sheep_id: 'sheep-test-3001', tag: '3001', live_weight: 90, hanging_weight: null },
    '3002': { sheep_id: 'sheep-test-3002', tag: '3002', live_weight: 95, hanging_weight: null },
    '3003': { sheep_id: 'sheep-test-3003', tag: '3003', live_weight: 85, hanging_weight: null },
  });

  // Sheep moved to 'processed' + processing_batch_id stamped.
  for (const s of sheep) {
    const r = await supabaseAdmin
      .from('sheep')
      .select('flock, processing_batch_id')
      .eq('id', s.id)
      .single();
    expect(r.data.flock).toBe('processed');
    expect(r.data.processing_batch_id).toBe(batchId);
  }

  // weigh_ins stamped: prior_herd_or_flock='feeders' (NOT 'processed' —
  // mirror of cattle's Codex Edge Case #1 lock at sheepProcessingBatch.js:97).
  const wis = await supabaseAdmin
    .from('weigh_ins')
    .select('id, tag, prior_herd_or_flock, target_processing_batch_id')
    .eq('session_id', sessionId);
  expect(wis.error).toBeNull();
  expect(wis.data).toHaveLength(3);
  for (const w of wis.data) {
    expect(w.prior_herd_or_flock).toBe('feeders');
    expect(w.prior_herd_or_flock).not.toBe('processed');
    expect(w.target_processing_batch_id).toBe(batchId);
  }

  // sheep_transfers append-only audit (3 rows, reason='processing_batch').
  const xfers = await supabaseAdmin
    .from('sheep_transfers')
    .select('sheep_id, from_flock, to_flock, reason, reference_id')
    .eq('reference_id', batchId)
    .eq('reason', 'processing_batch');
  expect(xfers.error).toBeNull();
  expect(xfers.data).toHaveLength(3);
  for (const x of xfers.data) {
    expect(x.from_flock).toBe('feeders');
    expect(x.to_flock).toBe('processed');
  }

  const sess = await supabaseAdmin
    .from('weigh_in_sessions')
    .select('status')
    .eq('id', sessionId)
    .single();
  expect(sess.data.status).toBe('complete');
});

// --------------------------------------------------------------------------
// Test 2 — toggle-clear detach (full UI round-trip)
// --------------------------------------------------------------------------
test('toggle-clear: reopen + clear flag detaches via prior_herd_or_flock', async ({
  page,
  sheepSendToProcessorScenario,
  supabaseAdmin,
}) => {
  const { batchId, sessionId } = await sheepSendToProcessorScenario({ flock: 'feeders' });

  await page.goto('/sheep/weighins');

  // Step 1: attach via UI.
  const sessionRow = page
    .locator('.hoverable-tile')
    .filter({ hasText: FEEDERS_LABEL })
    .filter({ hasText: /draft/i });
  await sessionRow.click();
  await page.getByRole('button', { name: /Complete Session/ }).click();
  await expect(page.getByText(/Send 3 sheep to processor/)).toBeVisible({ timeout: 5_000 });
  const select = page
    .locator('select')
    .filter({ has: page.locator(`option[value="${batchId}"]`) })
    .first();
  await select.selectOption(batchId);
  await page.getByRole('button', { name: 'Send to processor' }).click();
  await expect(page.getByText(/Send 3 sheep to processor/)).toHaveCount(0, { timeout: 10_000 });

  await expect
    .poll(async () => {
      const r = await supabaseAdmin
        .from('sheep_processing_batches')
        .select('sheep_detail')
        .eq('id', batchId)
        .single();
      return (r.data?.sheep_detail || []).length;
    }, { timeout: 10_000 })
    .toBe(3);

  // Step 2: Reopen session — finalizeComplete preserves expandedSession,
  // so the panel is still open. (Same pattern as cattle Test 2.)
  await page.getByRole('button', { name: 'Reopen Session' }).click();

  // Step 3: clear the flag on tag #3002.
  const entry3002 = uniqueRow(page, '3002');
  const toggle = entry3002.getByRole('button', { name: '✓ Processor' });
  await expect(toggle).toBeVisible({ timeout: 5_000 });
  await toggle.click();

  // --- Assertions: sheep 3002 detached, others untouched. ---
  await expect
    .poll(async () => {
      const r = await supabaseAdmin
        .from('sheep')
        .select('flock, processing_batch_id')
        .eq('id', 'sheep-test-3002')
        .single();
      return r.data;
    }, { timeout: 10_000, message: 'sheep 3002 was not detached' })
    .toEqual({ flock: 'feeders', processing_batch_id: null });

  for (const sheepId of ['sheep-test-3001', 'sheep-test-3003']) {
    const r = await supabaseAdmin
      .from('sheep')
      .select('flock, processing_batch_id')
      .eq('id', sheepId)
      .single();
    expect(r.data.flock).toBe('processed');
    expect(r.data.processing_batch_id).toBe(batchId);
  }

  const batchR = await supabaseAdmin
    .from('sheep_processing_batches')
    .select('sheep_detail')
    .eq('id', batchId)
    .single();
  const detailTags = (batchR.data.sheep_detail || []).map((r) => r.tag);
  expect(detailTags).toEqual(expect.arrayContaining(['3001', '3003']));
  expect(detailTags).not.toContain('3002');

  const wi = await supabaseAdmin
    .from('weigh_ins')
    .select('send_to_processor, target_processing_batch_id')
    .eq('id', 'wi-test-sheep-3002')
    .single();
  expect(wi.data.send_to_processor).toBe(false);
  expect(wi.data.target_processing_batch_id).toBeNull();

  const undo = await supabaseAdmin
    .from('sheep_transfers')
    .select('from_flock, to_flock, reason, reference_id')
    .eq('sheep_id', 'sheep-test-3002')
    .eq('reason', 'processing_batch_undo');
  expect(undo.data).toHaveLength(1);
  expect(undo.data[0].from_flock).toBe('processed');
  expect(undo.data[0].to_flock).toBe('feeders');
  expect(undo.data[0].reference_id).toBe(batchId);
});

// --------------------------------------------------------------------------
// Test 3 — entry-delete detach
// --------------------------------------------------------------------------
test('entry-delete: detaches sheep then deletes weigh_in row', async ({
  page,
  sheepPreAttachedScenario,
  supabaseAdmin,
}) => {
  const { batchId, sheepId, entryId } = await sheepPreAttachedScenario('with_audit_row');

  await page.goto('/sheep/weighins');
  await installConfirmDeleteStub(page);

  const sessionRow = page
    .locator('.hoverable-tile')
    .filter({ hasText: FEEDERS_LABEL });
  await sessionRow.click();

  const entry = uniqueRow(page, '3001');
  await entry.getByRole('button', { name: 'Delete', exact: true }).click();

  await expect
    .poll(async () => {
      const r = await supabaseAdmin
        .from('weigh_ins')
        .select('id')
        .eq('id', entryId)
        .maybeSingle();
      return r.data;
    }, { timeout: 10_000, message: 'weigh_in entry was not deleted' })
    .toBeNull();

  const sheepR = await supabaseAdmin
    .from('sheep')
    .select('flock, processing_batch_id')
    .eq('id', sheepId)
    .single();
  expect(sheepR.data.flock).toBe('feeders');
  expect(sheepR.data.processing_batch_id).toBeNull();

  const batchR = await supabaseAdmin
    .from('sheep_processing_batches')
    .select('sheep_detail')
    .eq('id', batchId)
    .single();
  expect(batchR.data.sheep_detail).toEqual([]);

  const undo = await supabaseAdmin
    .from('sheep_transfers')
    .select('reason')
    .eq('sheep_id', sheepId)
    .eq('reason', 'processing_batch_undo');
  expect(undo.data).toHaveLength(1);
});

// --------------------------------------------------------------------------
// Test 4 — session-delete detach (3-sheep loop)
// --------------------------------------------------------------------------
test('session-delete: detaches all 3 attached sheep then deletes session+entries', async ({
  page,
  sheepBatchPreAttachedScenario,
  supabaseAdmin,
}) => {
  const { batchId, sessionId, sheep, entryIds } = sheepBatchPreAttachedScenario;

  await page.goto('/sheep/weighins');
  await installConfirmDeleteStub(page);

  const sessionRow = page
    .locator('.hoverable-tile')
    .filter({ hasText: FEEDERS_LABEL });
  await sessionRow.click();

  await page.getByRole('button', { name: 'Delete Session' }).click();

  await expect
    .poll(async () => {
      const r = await supabaseAdmin
        .from('weigh_in_sessions')
        .select('id')
        .eq('id', sessionId)
        .maybeSingle();
      return r.data;
    }, { timeout: 10_000, message: 'session was not deleted' })
    .toBeNull();

  const wiR = await supabaseAdmin
    .from('weigh_ins')
    .select('id')
    .in('id', entryIds);
  expect(wiR.data).toEqual([]);

  for (const s of sheep) {
    const r = await supabaseAdmin
      .from('sheep')
      .select('flock, processing_batch_id')
      .eq('id', s.id)
      .single();
    expect(r.data.flock).toBe('feeders');
    expect(r.data.processing_batch_id).toBeNull();
  }

  const batchR = await supabaseAdmin
    .from('sheep_processing_batches')
    .select('sheep_detail')
    .eq('id', batchId)
    .single();
  expect(batchR.data.sheep_detail).toEqual([]);

  const undo = await supabaseAdmin
    .from('sheep_transfers')
    .select('sheep_id, reason')
    .eq('reason', 'processing_batch_undo')
    .in('sheep_id', sheep.map((s) => s.id));
  expect(undo.data).toHaveLength(3);
});

// --------------------------------------------------------------------------
// Test 5 — batch-delete detach (3-sheep loop, drives DeleteModal UI)
// --------------------------------------------------------------------------
test('batch-delete: real DeleteModal flow detaches all 3 sheep and removes batch', async ({
  page,
  sheepBatchPreAttachedScenario,
  supabaseAdmin,
}) => {
  const { batchId, batchName, sheep } = sheepBatchPreAttachedScenario;

  await page.goto('/sheep/batches');

  const batchTile = page
    .locator('.hoverable-tile')
    .filter({ hasText: batchName });
  await batchTile.getByRole('button', { name: 'Edit' }).click();
  await expect(page.getByText(/Edit Batch/)).toBeVisible({ timeout: 5_000 });

  await page.getByRole('button', { name: 'Delete', exact: true }).click();

  await expect(page.getByText('Are you sure?')).toBeVisible({ timeout: 5_000 });
  const input = page.getByPlaceholder('delete');
  await input.fill('delete');
  await page.keyboard.press('Enter');

  await expect
    .poll(async () => {
      const r = await supabaseAdmin
        .from('sheep_processing_batches')
        .select('id')
        .eq('id', batchId)
        .maybeSingle();
      return r.data;
    }, { timeout: 10_000, message: 'batch was not deleted' })
    .toBeNull();

  for (const s of sheep) {
    const r = await supabaseAdmin
      .from('sheep')
      .select('flock, processing_batch_id')
      .eq('id', s.id)
      .single();
    expect(r.data.flock).toBe('feeders');
    expect(r.data.processing_batch_id).toBeNull();
  }

  const undo = await supabaseAdmin
    .from('sheep_transfers')
    .select('sheep_id, reason')
    .eq('reason', 'processing_batch_undo')
    .in('sheep_id', sheep.map((s) => s.id));
  expect(undo.data).toHaveLength(3);
});

// --------------------------------------------------------------------------
// Test 6 — fallback hierarchy via sheep_transfers audit row
// --------------------------------------------------------------------------
test('fallback: detach reads from_flock off sheep_transfers when prior_herd_or_flock is null', async ({
  page,
  sheepPreAttachedScenario,
  supabaseAdmin,
}) => {
  const { sheepId } = await sheepPreAttachedScenario('with_audit_row');

  await page.goto('/sheep/weighins');

  const sessionRow = page
    .locator('.hoverable-tile')
    .filter({ hasText: FEEDERS_LABEL })
    .filter({ hasText: /complete/i });
  await sessionRow.click();
  await page.getByRole('button', { name: 'Reopen Session' }).click();

  const entry = uniqueRow(page, '3001');
  await entry.getByRole('button', { name: '✓ Processor' }).click();

  await expect
    .poll(async () => {
      const r = await supabaseAdmin
        .from('sheep')
        .select('flock, processing_batch_id')
        .eq('id', sheepId)
        .single();
      return r.data;
    }, { timeout: 10_000 })
    .toEqual({ flock: 'feeders', processing_batch_id: null });
});

// --------------------------------------------------------------------------
// Test 7 — null from_flock truthy guard blocks
// --------------------------------------------------------------------------
test('fallback null-from-flock: truthy guard at sheepProcessingBatch.js:170 blocks detach', async ({
  page,
  sheepPreAttachedScenario,
  supabaseAdmin,
}) => {
  const { batchId, sheepId, entryId } = await sheepPreAttachedScenario('null_from_flock');

  const dialogMessages = [];
  page.on('dialog', async (dialog) => {
    dialogMessages.push(dialog.message());
    await dialog.dismiss();
  });

  await page.goto('/sheep/weighins');

  const sessionRow = page
    .locator('.hoverable-tile')
    .filter({ hasText: FEEDERS_LABEL })
    .filter({ hasText: /complete/i });
  await sessionRow.click();
  await page.getByRole('button', { name: 'Reopen Session' }).click();

  const entry = uniqueRow(page, '3001');
  await entry.getByRole('button', { name: '✓ Processor' }).click();

  await expect.poll(() => dialogMessages.length, { timeout: 10_000 }).toBeGreaterThan(0);

  // Sheep alert text from SheepWeighInsView.jsx:144 — "no prior flock
  // recorded" + "Flocks tab" (not "Herds tab" as cattle uses).
  expect(dialogMessages.join(' ')).toContain('no prior flock recorded');
  expect(dialogMessages.join(' ')).toContain('Flocks tab');

  // Sheep STILL processed (toggle aborted before clearing flag).
  const sheepR = await supabaseAdmin
    .from('sheep')
    .select('flock, processing_batch_id')
    .eq('id', sheepId)
    .single();
  expect(sheepR.data.flock).toBe('processed');
  expect(sheepR.data.processing_batch_id).toBe(batchId);

  const wi = await supabaseAdmin
    .from('weigh_ins')
    .select('send_to_processor, target_processing_batch_id')
    .eq('id', entryId)
    .single();
  expect(wi.data.send_to_processor).toBe(true);
  expect(wi.data.target_processing_batch_id).toBe(batchId);
});

// --------------------------------------------------------------------------
// Test 8 — no audit row at all blocks
// --------------------------------------------------------------------------
test('no_prior_flock: missing audit row + null prior_herd_or_flock blocks detach', async ({
  page,
  sheepPreAttachedScenario,
  supabaseAdmin,
}) => {
  const { batchId, sheepId, entryId } = await sheepPreAttachedScenario('no_audit_row');

  const dialogMessages = [];
  page.on('dialog', async (dialog) => {
    dialogMessages.push(dialog.message());
    await dialog.dismiss();
  });

  await page.goto('/sheep/weighins');

  const sessionRow = page
    .locator('.hoverable-tile')
    .filter({ hasText: FEEDERS_LABEL })
    .filter({ hasText: /complete/i });
  await sessionRow.click();
  await page.getByRole('button', { name: 'Reopen Session' }).click();

  const entry = uniqueRow(page, '3001');
  await entry.getByRole('button', { name: '✓ Processor' }).click();

  await expect.poll(() => dialogMessages.length, { timeout: 10_000 }).toBeGreaterThan(0);
  expect(dialogMessages.join(' ')).toContain('no prior flock recorded');

  const sheepR = await supabaseAdmin
    .from('sheep')
    .select('flock, processing_batch_id')
    .eq('id', sheepId)
    .single();
  expect(sheepR.data.flock).toBe('processed');
  expect(sheepR.data.processing_batch_id).toBe(batchId);

  const wi = await supabaseAdmin
    .from('weigh_ins')
    .select('send_to_processor, target_processing_batch_id')
    .eq('id', entryId)
    .single();
  expect(wi.data.send_to_processor).toBe(true);
  expect(wi.data.target_processing_batch_id).toBe(batchId);
});

// --------------------------------------------------------------------------
// Test 9 — looser gate: rams flock CAN attach (UNIQUE TO SHEEP)
// --------------------------------------------------------------------------
test('looser gate: rams-flock entry attaches to processing batch (cattle would refuse)', async ({
  page,
  sheepSendToProcessorScenario,
  supabaseAdmin,
}) => {
  // Same shape as Test 1's seed but with flock='rams'. Cattle's equivalent
  // gate (CattleWeighInsView completeSession check `s.herd === 'finishers'`)
  // would never reach the modal — sheep has no such guard at
  // SheepWeighInsView.jsx:122-128.
  const { batchId, sessionId, sheep } = await sheepSendToProcessorScenario({ flock: 'rams' });

  await page.goto('/sheep/weighins');

  const sessionRow = page
    .locator('.hoverable-tile')
    .filter({ hasText: RAMS_LABEL })
    .filter({ hasText: /draft/i });
  await expect(sessionRow).toBeVisible({ timeout: 15_000 });
  await sessionRow.click();

  await page.getByRole('button', { name: /Complete Session/ }).click();

  // Modal opens — proves the looser gate (cattle would never get here for
  // a non-finishers session).
  const modalTitle = page.getByText(/Send 3 sheep to processor/);
  await expect(modalTitle).toBeVisible({ timeout: 5_000 });

  const select = page
    .locator('select')
    .filter({ has: page.locator(`option[value="${batchId}"]`) })
    .first();
  await select.selectOption(batchId);
  await page.getByRole('button', { name: 'Send to processor' }).click();
  await expect(modalTitle).toHaveCount(0, { timeout: 10_000 });

  // --- Assertions: prior_herd_or_flock captures the actual rams state,
  // not stale 'feeders' or 'processed'. ---
  await expect
    .poll(async () => {
      const r = await supabaseAdmin
        .from('sheep_processing_batches')
        .select('sheep_detail')
        .eq('id', batchId)
        .single();
      return (r.data?.sheep_detail || []).length;
    }, { timeout: 10_000, message: 'rams sheep did not attach' })
    .toBe(3);

  for (const s of sheep) {
    const r = await supabaseAdmin
      .from('sheep')
      .select('flock')
      .eq('id', s.id)
      .single();
    expect(r.data.flock).toBe('processed');
  }

  // The key §7 lock: prior_herd_or_flock = 'rams' (not 'feeders' as a
  // stale default; not 'processed' per Codex Edge Case #1). This is the
  // sheep weigh_ins table — the typo from the original plan is corrected.
  const wis = await supabaseAdmin
    .from('weigh_ins')
    .select('prior_herd_or_flock')
    .eq('session_id', sessionId);
  for (const w of wis.data) {
    expect(w.prior_herd_or_flock).toBe('rams');
    expect(w.prior_herd_or_flock).not.toBe('feeders');
    expect(w.prior_herd_or_flock).not.toBe('processed');
  }

  // sheep_transfers audit captures from_flock='rams' (the actual source
  // flock, not a hardcoded value).
  const xfers = await supabaseAdmin
    .from('sheep_transfers')
    .select('from_flock, to_flock, reason')
    .eq('reference_id', batchId)
    .eq('reason', 'processing_batch');
  expect(xfers.data).toHaveLength(3);
  for (const x of xfers.data) {
    expect(x.from_flock).toBe('rams');
    expect(x.to_flock).toBe('processed');
  }
});

// --------------------------------------------------------------------------
// Test 10 — no manual batch-membership bypass (negative assertion)
// --------------------------------------------------------------------------
test('no manual bypass: /sheep/batches has no manual sheep-attach UI', async ({
  page,
  sheepSendToProcessorScenario,
}) => {
  const { batchName } = await sheepSendToProcessorScenario({ flock: 'feeders' });

  await page.goto('/sheep/batches');

  await page.getByRole('button', { name: '+ New Batch' }).click();
  await expect(page.getByText(/New Processing Batch/)).toBeVisible({ timeout: 5_000 });
  // Post-patch hint cites "sheep weigh-in entry" (any flock per §7), not
  // the old "feeders weigh-in entry" wording that contradicted the gate.
  await expect(page.getByText(/sheep weigh-in entry/i)).toBeVisible();

  // No element offering manual sheep attach. Reject both the would-be
  // multi-select dropdown and any stale "feeders weigh-in entry" copy
  // that the patch in this PR replaced.
  expect(await page.getByText(/Add sheep from feeders/i).count()).toBe(0);
  expect(await page.getByText(/feeders weigh-in entry/i).count()).toBe(0);

  await page.getByRole('button', { name: 'Cancel' }).click();

  // Same hint surfaces on the expanded existing-batch view.
  const tile = page
    .locator('.hoverable-tile')
    .filter({ hasText: batchName });
  await tile.click();
  await expect(
    page.getByText(/Sheep enter this batch only via the Send-to-Processor flag on a sheep weigh-in entry/i)
  ).toBeVisible({ timeout: 5_000 });
});
