import {test, expect} from './fixtures.js';

// ============================================================================
// Cattle Send-to-Processor spec — Phase A5
// ============================================================================
// Codex-reviewed scope: lock the §7 cattle Send-to-Processor contract
// (PROJECT.md §7 entries: weigh_ins.prior_herd_or_flock semantics, detach
// fallback hierarchy, cattle_transfers append-only, batch membership rule).
//
// 9 tests, structured around the §7 entries each one protects:
//
//   1  happy-path attach            — prior_herd_or_flock stamping +
//                                     cattle_transfers insert + cows_detail
//   2  toggle-clear detach          — full UI round-trip (attach via UI,
//                                     reopen, toggle off) — the clearest
//                                     regression for the four detach paths
//   3  entry-delete detach          — stub _wcfConfirmDelete post-mount
//   4  session-delete detach        — stub _wcfConfirmDelete post-mount
//   5  batch-delete detach          — drives the real DeleteModal UI once
//                                     to lock the shared modal contract
//   6  fallback to audit row        — prior_herd_or_flock null →
//                                     cattle_transfers.from_herd resolves
//   7  null from_herd guard         — audit row exists but from_herd=null →
//                                     truthy guard at cattleProcessingBatch.js:177
//                                     forces no_prior_herd
//   8  no audit row block           — neither path resolves → blocked
//   9  no manual bypass             — /cattle/batches has no manual cow
//                                     attach UI (negative assertion)
//
// Test 1 uses an existing seeded planned batch (Codex correction: keeps the
// assertion tied to a known batchId). Tests 3–5 use a pre-attached seed so
// runtime + setup noise stays focused on the detach behavior under test.
// Tests 6–8 share the same fallback seed, parameterised by mode.
// ============================================================================

const HERD_LABEL = 'Finishers';

function uniqueRow(page, tag) {
  // The entry rendered in CattleWeighInsView is a div containing a span with
  // the tag (`#NNNN`) and a button-row with Edit + Delete (+ ✓ Processor on
  // finishers). The tag span and the buttons live in SIBLING flex rows
  // inside the entry box, so we need a filter that requires BOTH descendants
  // — `.first()` returns the outermost ancestor (matches every entry's
  // buttons; strict-mode trips on >1 entry), `.last()` returns the inner
  // tag-only row (no buttons inside). Anchoring on the always-present Edit
  // button forces the match to the entry box (or its flex-column child).
  return page
    .locator('div')
    .filter({has: page.locator('span', {hasText: new RegExp(`^#${tag}$`)})})
    .filter({has: page.getByRole('button', {name: 'Edit', exact: true})})
    .last();
}

async function installConfirmDeleteStub(page) {
  // main.jsx assigns window._wcfConfirmDelete in a useEffect after first
  // render (line ~1509). Wait for it to land, then overwrite. Codex's race
  // concern with addInitScript is precisely that the init-script stub gets
  // overwritten by main.jsx; post-mount evaluate avoids the race entirely.
  await page.waitForFunction(() => typeof window._wcfConfirmDelete === 'function');
  await page.evaluate(() => {
    window._wcfConfirmDelete = (_msg, fn) => fn();
  });
}

// --------------------------------------------------------------------------
// Test 1 — happy-path attach via UI
// --------------------------------------------------------------------------
test('attach: complete session + modal stamps prior_herd_or_flock and writes audit', async ({
  page,
  cattleSendToProcessorScenario,
  supabaseAdmin,
}) => {
  const {batchId, sessionId, cows} = cattleSendToProcessorScenario;

  await page.goto('/cattle/weighins');

  const sessionRow = page.locator('.hoverable-tile').filter({hasText: HERD_LABEL}).filter({hasText: /draft/i});
  await expect(sessionRow).toBeVisible({timeout: 15_000});
  await sessionRow.click();

  // ✓ Complete Session — finishers + flagged entries → modal intercepts.
  await page.getByRole('button', {name: /Complete Session/}).click();

  // Modal title text is built as: '🚩 Send N finisher(s) to processor'
  // (CattleSendToProcessorModal.jsx:84). 3 entries → "finishers" plural.
  const modalTitle = page.getByText(/Send 3 finishers to processor/);
  await expect(modalTitle).toBeVisible({timeout: 5_000});

  // Default mode is 'existing' because the seed includes a planned batch.
  // Pick by value (deterministic, doesn't depend on label punctuation).
  const select = page
    .locator('select')
    .filter({has: page.locator(`option[value="${batchId}"]`)})
    .first();
  await select.selectOption(batchId);

  // Submit. Exact lowercase 'p' in 'processor'. No /i flag — Codex correction.
  await page.getByRole('button', {name: 'Send to processor'}).click();
  await expect(modalTitle).toHaveCount(0, {timeout: 10_000});

  // --- Assertions: poll until the attach lands. ---
  await expect
    .poll(
      async () => {
        const r = await supabaseAdmin
          .from('cattle_processing_batches')
          .select('cows_detail')
          .eq('id', batchId)
          .single();
        return (r.data?.cows_detail || []).length;
      },
      {timeout: 10_000, message: 'cows_detail did not populate after attach'},
    )
    .toBe(3);

  // cows_detail content: cattle_id + tag + live_weight per cow.
  // Length-only would let a regression attach 3 malformed rows (wrong
  // cattle_id, dropped weights) and still pass — Codex finding #1.
  const batchAfter = await supabaseAdmin
    .from('cattle_processing_batches')
    .select('cows_detail')
    .eq('id', batchId)
    .single();
  const detailByTag = Object.fromEntries((batchAfter.data.cows_detail || []).map((r) => [r.tag, r]));
  expect(detailByTag).toEqual({
    2001: {cattle_id: 'cow-test-2001', tag: '2001', live_weight: 1100, hanging_weight: null},
    2002: {cattle_id: 'cow-test-2002', tag: '2002', live_weight: 1150, hanging_weight: null},
    2003: {cattle_id: 'cow-test-2003', tag: '2003', live_weight: 1080, hanging_weight: null},
  });

  // Cattle moved to 'processed' + processing_batch_id stamped.
  for (const c of cows) {
    const r = await supabaseAdmin.from('cattle').select('herd, processing_batch_id').eq('id', c.id).single();
    expect(r.data.herd).toBe('processed');
    expect(r.data.processing_batch_id).toBe(batchId);
  }

  // weigh_ins stamped: prior_herd_or_flock='finishers' (NOT 'processed' —
  // regression lock for Codex Edge Case #1, the multi-batch reattach
  // contract at cattleProcessingBatch.js:91).
  const wis = await supabaseAdmin
    .from('weigh_ins')
    .select('id, tag, prior_herd_or_flock, target_processing_batch_id')
    .eq('session_id', sessionId);
  expect(wis.error).toBeNull();
  expect(wis.data).toHaveLength(3);
  for (const w of wis.data) {
    expect(w.prior_herd_or_flock).toBe('finishers');
    expect(w.prior_herd_or_flock).not.toBe('processed');
    expect(w.target_processing_batch_id).toBe(batchId);
  }

  // cattle_transfers append-only audit (3 rows, reason='processing_batch').
  const xfers = await supabaseAdmin
    .from('cattle_transfers')
    .select('cattle_id, from_herd, to_herd, reason, reference_id')
    .eq('reference_id', batchId)
    .eq('reason', 'processing_batch');
  expect(xfers.error).toBeNull();
  expect(xfers.data).toHaveLength(3);
  for (const x of xfers.data) {
    expect(x.from_herd).toBe('finishers');
    expect(x.to_herd).toBe('processed');
  }

  // Session marked complete.
  const sess = await supabaseAdmin.from('weigh_in_sessions').select('status').eq('id', sessionId).single();
  expect(sess.data.status).toBe('complete');
});

// --------------------------------------------------------------------------
// Test 2 — toggle-clear detach (full UI round-trip: attach → reopen → toggle)
// --------------------------------------------------------------------------
test('toggle-clear: reopen + clear flag detaches via prior_herd_or_flock', async ({
  page,
  cattleSendToProcessorScenario,
  supabaseAdmin,
}) => {
  const {batchId, sessionId} = cattleSendToProcessorScenario;

  await page.goto('/cattle/weighins');

  // Step 1: attach via UI (same flow as Test 1, condensed).
  const sessionRow = page.locator('.hoverable-tile').filter({hasText: HERD_LABEL}).filter({hasText: /draft/i});
  await sessionRow.click();
  await page.getByRole('button', {name: /Complete Session/}).click();
  await expect(page.getByText(/Send 3 finishers to processor/)).toBeVisible({timeout: 5_000});
  const select = page
    .locator('select')
    .filter({has: page.locator(`option[value="${batchId}"]`)})
    .first();
  await select.selectOption(batchId);
  await page.getByRole('button', {name: 'Send to processor'}).click();
  await expect(page.getByText(/Send 3 finishers to processor/)).toHaveCount(0, {timeout: 10_000});

  // Wait for attach to fully land before reopening (otherwise the toggle
  // sees stale local state).
  await expect
    .poll(
      async () => {
        const r = await supabaseAdmin
          .from('cattle_processing_batches')
          .select('cows_detail')
          .eq('id', batchId)
          .single();
        return (r.data?.cows_detail || []).length;
      },
      {timeout: 10_000},
    )
    .toBe(3);

  // Step 2: Reopen session — flips status to 'draft' and re-renders the
  // toggle button (the read-only span only shows on complete sessions).
  // Don't click the row again — finalizeComplete preserves expandedSession
  // state, so the panel is still open. Clicking would COLLAPSE it and hide
  // Reopen Session.
  await page.getByRole('button', {name: 'Reopen Session'}).click();

  // Step 3: clear the flag on tag #2002. The button label is '✓ Processor'
  // because send_to_processor is still true after reopen (no cleanup happens
  // on reopen — that's the very state toggle-clear was built to handle).
  const entry2002 = uniqueRow(page, '2002');
  const toggle = entry2002.getByRole('button', {name: '✓ Processor'});
  await expect(toggle).toBeVisible({timeout: 5_000});
  await toggle.click();

  // --- Assertions: cow 2002 detached, others untouched. ---
  await expect
    .poll(
      async () => {
        const r = await supabaseAdmin
          .from('cattle')
          .select('herd, processing_batch_id')
          .eq('id', 'cow-test-2002')
          .single();
        return r.data;
      },
      {timeout: 10_000, message: 'cow 2002 was not detached'},
    )
    .toEqual({herd: 'finishers', processing_batch_id: null});

  // Other cows still attached.
  for (const cowId of ['cow-test-2001', 'cow-test-2003']) {
    const r = await supabaseAdmin.from('cattle').select('herd, processing_batch_id').eq('id', cowId).single();
    expect(r.data.herd).toBe('processed');
    expect(r.data.processing_batch_id).toBe(batchId);
  }

  // batch.cows_detail dropped tag 2002.
  const batchR = await supabaseAdmin.from('cattle_processing_batches').select('cows_detail').eq('id', batchId).single();
  const detailTags = (batchR.data.cows_detail || []).map((r) => r.tag);
  expect(detailTags).toEqual(expect.arrayContaining(['2001', '2003']));
  expect(detailTags).not.toContain('2002');

  // weigh_ins for tag 2002 fully cleared (both flags per
  // cattleProcessingBatch.js:215–230).
  const wi = await supabaseAdmin
    .from('weigh_ins')
    .select('send_to_processor, target_processing_batch_id')
    .eq('id', 'wi-test-cattle-2002')
    .single();
  expect(wi.data.send_to_processor).toBe(false);
  expect(wi.data.target_processing_batch_id).toBeNull();

  // Append-only audit row written.
  const undo = await supabaseAdmin
    .from('cattle_transfers')
    .select('from_herd, to_herd, reason, reference_id')
    .eq('cattle_id', 'cow-test-2002')
    .eq('reason', 'processing_batch_undo');
  expect(undo.data).toHaveLength(1);
  expect(undo.data[0].from_herd).toBe('processed');
  expect(undo.data[0].to_herd).toBe('finishers');
  expect(undo.data[0].reference_id).toBe(batchId);
});

// --------------------------------------------------------------------------
// Test 3 — entry-delete detach
// --------------------------------------------------------------------------
test('entry-delete: detaches cow then deletes weigh_in row', async ({
  page,
  cattlePreAttachedScenario,
  supabaseAdmin,
}) => {
  const {batchId, cowId, entryId} = await cattlePreAttachedScenario('with_audit_row');

  await page.goto('/cattle/weighins');
  await installConfirmDeleteStub(page);

  // Reopen the seeded complete session to expose the per-entry Delete button.
  // (Delete buttons render on both draft + complete, but reopening keeps the
  // row layout consistent with the toggle-clear test path.)
  const sessionRow = page.locator('.hoverable-tile').filter({hasText: HERD_LABEL});
  await sessionRow.click();

  const entry = uniqueRow(page, '2001');
  await entry.getByRole('button', {name: 'Delete', exact: true}).click();

  await expect
    .poll(
      async () => {
        const r = await supabaseAdmin.from('weigh_ins').select('id').eq('id', entryId).maybeSingle();
        return r.data;
      },
      {timeout: 10_000, message: 'weigh_in entry was not deleted'},
    )
    .toBeNull();

  // Cow reverted via the audit-row fallback (mode='with_audit_row').
  const cowR = await supabaseAdmin.from('cattle').select('herd, processing_batch_id').eq('id', cowId).single();
  expect(cowR.data.herd).toBe('finishers');
  expect(cowR.data.processing_batch_id).toBeNull();

  // Batch.cows_detail dropped the cow.
  const batchR = await supabaseAdmin.from('cattle_processing_batches').select('cows_detail').eq('id', batchId).single();
  expect(batchR.data.cows_detail).toEqual([]);

  // Undo audit row written.
  const undo = await supabaseAdmin
    .from('cattle_transfers')
    .select('reason')
    .eq('cattle_id', cowId)
    .eq('reason', 'processing_batch_undo');
  expect(undo.data).toHaveLength(1);
});

// --------------------------------------------------------------------------
// Test 4 — session-delete detach
// --------------------------------------------------------------------------
test('session-delete: detaches all 3 attached cows then deletes session+entries', async ({
  page,
  cattleMultiCowPreAttachedScenario,
  supabaseAdmin,
}) => {
  const {batchId, sessionId, cows, entryIds} = cattleMultiCowPreAttachedScenario;

  await page.goto('/cattle/weighins');
  await installConfirmDeleteStub(page);

  const sessionRow = page.locator('.hoverable-tile').filter({hasText: HERD_LABEL});
  await sessionRow.click();

  await page.getByRole('button', {name: 'Delete Session'}).click();

  await expect
    .poll(
      async () => {
        const r = await supabaseAdmin.from('weigh_in_sessions').select('id').eq('id', sessionId).maybeSingle();
        return r.data;
      },
      {timeout: 10_000, message: 'session was not deleted'},
    )
    .toBeNull();

  // All 3 entries deleted (FK cascade on weigh_ins.session_id).
  const wiR = await supabaseAdmin.from('weigh_ins').select('id').in('id', entryIds);
  expect(wiR.data).toEqual([]);

  // ALL 3 cows reverted — exercises the loop, not just N=1.
  for (const cow of cows) {
    const r = await supabaseAdmin.from('cattle').select('herd, processing_batch_id').eq('id', cow.id).single();
    expect(r.data.herd).toBe('finishers');
    expect(r.data.processing_batch_id).toBeNull();
  }

  // Batch.cows_detail emptied.
  const batchR = await supabaseAdmin.from('cattle_processing_batches').select('cows_detail').eq('id', batchId).single();
  expect(batchR.data.cows_detail).toEqual([]);

  // 3 undo audit rows — one per cow.
  const undo = await supabaseAdmin
    .from('cattle_transfers')
    .select('cattle_id, reason')
    .eq('reason', 'processing_batch_undo')
    .in(
      'cattle_id',
      cows.map((c) => c.id),
    );
  expect(undo.data).toHaveLength(3);
});

// --------------------------------------------------------------------------
// Test 5 — batch-delete detach (drives the real DeleteModal UI once)
// --------------------------------------------------------------------------
test('batch-delete: real DeleteModal flow detaches all 3 cows and removes batch', async ({
  page,
  cattleMultiCowPreAttachedScenario,
  supabaseAdmin,
}) => {
  const {batchId, batchName, cows} = cattleMultiCowPreAttachedScenario;

  await page.goto('/cattle/batches');

  // Edit modal — only one batch in the seed, so the lone Edit link suffices.
  const batchTile = page.locator('.hoverable-tile').filter({hasText: batchName});
  await batchTile.getByRole('button', {name: 'Edit'}).click();
  await expect(page.getByText(/Edit Batch/)).toBeVisible({timeout: 5_000});

  // Click Delete in the batch modal footer (exact-match disambiguates from
  // the DeleteModal's own Delete button which appears next).
  await page.getByRole('button', {name: 'Delete', exact: true}).click();

  // DeleteModal — type "delete" + Enter (Enter submits per
  // DeleteModal.jsx:22). This is the one place we drive the real shared
  // confirmation modal end-to-end (Codex-approved: lock the modal contract
  // exactly once across the four detach paths).
  await expect(page.getByText('Are you sure?')).toBeVisible({timeout: 5_000});
  const input = page.getByPlaceholder('delete');
  await input.fill('delete');
  await page.keyboard.press('Enter');

  // Wait for batch row to disappear from DB.
  await expect
    .poll(
      async () => {
        const r = await supabaseAdmin.from('cattle_processing_batches').select('id').eq('id', batchId).maybeSingle();
        return r.data;
      },
      {timeout: 10_000, message: 'batch was not deleted'},
    )
    .toBeNull();

  // ALL 3 cows reverted — exercises the deleteBatch detach loop, the
  // load-bearing part Codex flagged.
  for (const cow of cows) {
    const r = await supabaseAdmin.from('cattle').select('herd, processing_batch_id').eq('id', cow.id).single();
    expect(r.data.herd).toBe('finishers');
    expect(r.data.processing_batch_id).toBeNull();
  }

  // 3 undo audit rows.
  const undo = await supabaseAdmin
    .from('cattle_transfers')
    .select('cattle_id, reason')
    .eq('reason', 'processing_batch_undo')
    .in(
      'cattle_id',
      cows.map((c) => c.id),
    );
  expect(undo.data).toHaveLength(3);
});

// --------------------------------------------------------------------------
// Test 6 — fallback hierarchy via cattle_transfers audit row
// --------------------------------------------------------------------------
test('fallback: detach reads from_herd off cattle_transfers when prior_herd_or_flock is null', async ({
  page,
  cattlePreAttachedScenario,
  supabaseAdmin,
}) => {
  const {cowId} = await cattlePreAttachedScenario('with_audit_row');

  await page.goto('/cattle/weighins');

  // Reopen session to surface the toggle button.
  const sessionRow = page
    .locator('.hoverable-tile')
    .filter({hasText: HERD_LABEL})
    .filter({hasText: /complete/i});
  await sessionRow.click();
  await page.getByRole('button', {name: 'Reopen Session'}).click();

  const entry = uniqueRow(page, '2001');
  await entry.getByRole('button', {name: '✓ Processor'}).click();

  // Cow reverted to 'finishers' — sourced from cattle_transfers.from_herd
  // because weigh_ins.prior_herd_or_flock is null.
  await expect
    .poll(
      async () => {
        const r = await supabaseAdmin.from('cattle').select('herd, processing_batch_id').eq('id', cowId).single();
        return r.data;
      },
      {timeout: 10_000},
    )
    .toEqual({herd: 'finishers', processing_batch_id: null});
});

// --------------------------------------------------------------------------
// Test 7 — null from_herd: truthy guard forces no_prior_herd
// --------------------------------------------------------------------------
test('fallback null-from-herd: truthy guard at cattleProcessingBatch.js:177 blocks detach', async ({
  page,
  cattlePreAttachedScenario,
  supabaseAdmin,
}) => {
  const {batchId, cowId, entryId} = await cattlePreAttachedScenario('null_from_herd');

  // Capture window.alert before the action.
  const dialogMessages = [];
  page.on('dialog', async (dialog) => {
    dialogMessages.push(dialog.message());
    await dialog.dismiss();
  });

  await page.goto('/cattle/weighins');

  const sessionRow = page
    .locator('.hoverable-tile')
    .filter({hasText: HERD_LABEL})
    .filter({hasText: /complete/i});
  await sessionRow.click();
  await page.getByRole('button', {name: 'Reopen Session'}).click();

  const entry = uniqueRow(page, '2001');
  await entry.getByRole('button', {name: '✓ Processor'}).click();

  // Wait for the alert to fire.
  await expect.poll(() => dialogMessages.length, {timeout: 10_000}).toBeGreaterThan(0);

  // Codex's contains-match guidance — exact text is implementation detail.
  expect(dialogMessages.join(' ')).toContain('no prior herd recorded');
  expect(dialogMessages.join(' ')).toContain('Herds tab');

  // Cow STILL at processed (toggle aborted before clearing flag —
  // CattleWeighInsView.jsx:141-144).
  const cowR = await supabaseAdmin.from('cattle').select('herd, processing_batch_id').eq('id', cowId).single();
  expect(cowR.data.herd).toBe('processed');
  expect(cowR.data.processing_batch_id).toBe(batchId);

  // Flag still set (toggle aborted, no DB write).
  const wi = await supabaseAdmin
    .from('weigh_ins')
    .select('send_to_processor, target_processing_batch_id')
    .eq('id', entryId)
    .single();
  expect(wi.data.send_to_processor).toBe(true);
  expect(wi.data.target_processing_batch_id).toBe(batchId);
});

// --------------------------------------------------------------------------
// Test 8 — no audit row at all: detach blocked, state unchanged
// --------------------------------------------------------------------------
test('no_prior_herd: missing audit row + null prior_herd_or_flock blocks detach', async ({
  page,
  cattlePreAttachedScenario,
  supabaseAdmin,
}) => {
  const {batchId, cowId, entryId} = await cattlePreAttachedScenario('no_audit_row');

  const dialogMessages = [];
  page.on('dialog', async (dialog) => {
    dialogMessages.push(dialog.message());
    await dialog.dismiss();
  });

  await page.goto('/cattle/weighins');

  const sessionRow = page
    .locator('.hoverable-tile')
    .filter({hasText: HERD_LABEL})
    .filter({hasText: /complete/i});
  await sessionRow.click();
  await page.getByRole('button', {name: 'Reopen Session'}).click();

  const entry = uniqueRow(page, '2001');
  await entry.getByRole('button', {name: '✓ Processor'}).click();

  await expect.poll(() => dialogMessages.length, {timeout: 10_000}).toBeGreaterThan(0);
  expect(dialogMessages.join(' ')).toContain('no prior herd recorded');

  // State unchanged — same assertions as Test 7.
  const cowR = await supabaseAdmin.from('cattle').select('herd, processing_batch_id').eq('id', cowId).single();
  expect(cowR.data.herd).toBe('processed');
  expect(cowR.data.processing_batch_id).toBe(batchId);

  const wi = await supabaseAdmin
    .from('weigh_ins')
    .select('send_to_processor, target_processing_batch_id')
    .eq('id', entryId)
    .single();
  expect(wi.data.send_to_processor).toBe(true);
  expect(wi.data.target_processing_batch_id).toBe(batchId);
});

// --------------------------------------------------------------------------
// Test 9 — no manual batch-membership bypass (negative assertion)
// --------------------------------------------------------------------------
test('no manual bypass: /cattle/batches has no manual cow-attach UI', async ({page, cattleSendToProcessorScenario}) => {
  const {batchName} = cattleSendToProcessorScenario;

  await page.goto('/cattle/batches');

  // + New Batch modal hint cites the §7 batch-membership rule.
  await page.getByRole('button', {name: '+ New Batch'}).click();
  await expect(page.getByText(/New Processing Batch/)).toBeVisible({timeout: 5_000});
  await expect(page.getByText(/finisher weigh-in entry/i)).toBeVisible();

  // No element offering manual cow attach. Both phrasings rejected: the
  // "+ Add cow from finishers" dropdown that used to live here AND any
  // "attach cattle from the Herds tab" copy.
  expect(await page.getByText(/Add cow from finishers/i).count()).toBe(0);
  expect(await page.getByText(/from the Herds tab/i).count()).toBe(0);

  // Close the new-batch modal (Cancel button in modal footer).
  await page.getByRole('button', {name: 'Cancel'}).click();

  // Same hint surfaces on the expanded existing-batch view (different copy
  // anchor — confirms the §7 rule is messaged in both empty-create and
  // already-exists contexts).
  const tile = page.locator('.hoverable-tile').filter({hasText: batchName});
  await tile.click();
  await expect(
    page.getByText(/Cattle enter this batch only via the Send-to-Processor flag on a finisher weigh-in entry/i),
  ).toBeVisible({timeout: 5_000});
});
