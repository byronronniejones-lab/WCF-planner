import {test, expect} from './fixtures.js';

// ============================================================================
// Admin broiler session metadata edit (WK + team_member)
// ============================================================================
// Drives /broiler/weighins (LivestockWeighInsView) under the default
// authenticated storage state. Locks the always-visible inline metadata
// panel for broiler sessions, the broiler-only visibility, the legacy
// team_member preservation, and the side-effect on app_store.ppp-v4
// (recompute OLD week / write NEW week) when a complete session's
// broiler_week changes.
//
// Helper contract (src/lib/broiler.js recomputeBroilerBatchWeekAvg) is
// exercised end-to-end here; unit-level cases live in src/lib/broiler.test.js.
// ============================================================================

async function readPppV4Batch(supabaseAdmin, batchName) {
  const {data} = await supabaseAdmin.from('app_store').select('data').eq('key', 'ppp-v4').maybeSingle();
  if (!data || !Array.isArray(data.data)) return null;
  return data.data.find((b) => b && b.name === batchName) || null;
}

// =============================================================================
// T1 — Edit DRAFT session: WK 4→6 + team BMAN→JANE; ppp-v4 untouched.
// =============================================================================
test('T1: edit draft session WK + team_member; ppp-v4 untouched', async ({
  page,
  supabaseAdmin,
  adminBroilerSessionMetaScenario,
}) => {
  const {batchId, draftId} = adminBroilerSessionMetaScenario;
  await page.goto('/broiler/weighins');

  // Two sessions visible in the list — pick the DRAFT one. Both rows show
  // 'B-26-01'; expand by clicking the row that also shows 'DRAFT' status.
  await expect(page.locator('#wcf-boot-loader')).toHaveCount(0, {timeout: 15_000});
  await expect(page.getByText('B-26-01').first()).toBeVisible({timeout: 15_000});
  // Click the DRAFT row by its DRAFT pill.
  await page.getByText('draft', {exact: true}).first().click();
  await expect(page.locator('[data-testid="broiler-meta-panel"]').first()).toBeVisible({timeout: 10_000});

  await page.getByTestId('broiler-meta-wk6').click();
  await page.getByTestId('broiler-meta-team').selectOption({label: 'JANE'});
  await page.getByTestId('broiler-meta-save').click();

  // Wait for the save round-trip + reload to settle.
  await expect(page.getByTestId('broiler-meta-save')).toHaveCount(0, {timeout: 10_000});

  // DB row reflects both changes.
  const {data: rows} = await supabaseAdmin.from('weigh_in_sessions').select('*').eq('id', draftId);
  expect(rows).toHaveLength(1);
  expect(rows[0].broiler_week).toBe(6);
  expect(rows[0].team_member).toBe('JANE');
  expect(rows[0].status).toBe('draft');

  // ppp-v4 untouched — week4Lbs still 1.5, no week6Lbs added.
  const batch = await readPppV4Batch(supabaseAdmin, batchId);
  expect(batch.week4Lbs).toBe(1.5);
  expect(batch.week6Lbs).toBeUndefined();
});

// =============================================================================
// T2 — Edit COMPLETE session: team_member only; ppp-v4 untouched.
// =============================================================================
test('T2: edit complete session team_member only; ppp-v4 untouched', async ({
  page,
  supabaseAdmin,
  adminBroilerSessionMetaScenario,
}) => {
  const {batchId, completeId} = adminBroilerSessionMetaScenario;
  await page.goto('/broiler/weighins');

  await expect(page.locator('#wcf-boot-loader')).toHaveCount(0, {timeout: 15_000});
  await page.getByText('complete', {exact: true}).first().click();
  await expect(page.locator('[data-testid="broiler-meta-panel"]').first()).toBeVisible({timeout: 10_000});

  await page.getByTestId('broiler-meta-team').selectOption({label: 'JANE'});
  await page.getByTestId('broiler-meta-save').click();
  await expect(page.getByTestId('broiler-meta-save')).toHaveCount(0, {timeout: 10_000});

  const {data: rows} = await supabaseAdmin.from('weigh_in_sessions').select('*').eq('id', completeId);
  expect(rows[0].team_member).toBe('JANE');
  expect(rows[0].broiler_week).toBe(4);

  const batch = await readPppV4Batch(supabaseAdmin, batchId);
  expect(batch.week4Lbs).toBe(1.5);
  expect(batch.week6Lbs).toBeUndefined();
});

// =============================================================================
// T3 — Edit COMPLETE session WK 4→6, no other complete wk4 session.
//      ppp-v4: week4Lbs DELETED, week6Lbs = session avg (1.5).
// =============================================================================
test('T3: edit complete session WK 4→6 (sole wk4) → wk4Lbs deleted, wk6Lbs set', async ({
  page,
  supabaseAdmin,
  adminBroilerSessionMetaScenario,
}) => {
  const {batchId, completeId} = adminBroilerSessionMetaScenario;
  await page.goto('/broiler/weighins');

  await expect(page.locator('#wcf-boot-loader')).toHaveCount(0, {timeout: 15_000});
  await page.getByText('complete', {exact: true}).first().click();
  await expect(page.locator('[data-testid="broiler-meta-panel"]').first()).toBeVisible({timeout: 10_000});

  await page.getByTestId('broiler-meta-wk6').click();
  await page.getByTestId('broiler-meta-save').click();
  await expect(page.getByTestId('broiler-meta-save')).toHaveCount(0, {timeout: 10_000});

  const {data: rows} = await supabaseAdmin.from('weigh_in_sessions').select('*').eq('id', completeId);
  expect(rows[0].broiler_week).toBe(6);

  const batch = await readPppV4Batch(supabaseAdmin, batchId);
  // OLD week field DELETED (Q4 contract).
  expect('week4Lbs' in batch).toBe(false);
  // NEW week field set from this session's entries (avg 1.5).
  expect(batch.week6Lbs).toBe(1.5);
});

// =============================================================================
// T4 — Two complete wk4 sessions: edit the LATER one to WK 6.
//      ppp-v4.week4Lbs = OTHER session's avg (excludeSessionId locked it
//      out so the moved session's stale value can't win).
//      ppp-v4.week6Lbs = changed session's avg.
// =============================================================================
test('T4: two complete wk4 sessions, move later one to WK6 → wk4Lbs from other, wk6Lbs from moved', async ({
  page,
  supabaseAdmin,
  adminBroilerSessionMetaScenario,
}) => {
  const {batchId, completeId} = adminBroilerSessionMetaScenario;

  // Pre-seed an EARLIER complete wk4 session for the same batch with avg
  // 1.7 (weights all 1.7). The fixture's seeded complete session is wk4
  // avg 1.5; we want the EARLIER session (other) to be the one whose avg
  // ends up in wk4Lbs after the move. The fixture's session is the one
  // we'll move to WK 6.
  const otherId = 'sd-complete-other';
  const today = new Date().toISOString().slice(0, 10);
  const completedEarlier = new Date(Date.now() - 6 * 60 * 60 * 1000).toISOString();
  let r = await supabaseAdmin.from('weigh_in_sessions').insert({
    id: otherId,
    species: 'broiler',
    status: 'complete',
    date: today,
    team_member: 'BMAN',
    batch_id: batchId,
    broiler_week: 4,
    started_at: completedEarlier,
    completed_at: completedEarlier,
  });
  expect(r.error).toBeNull();
  const otherEntries = [1.7, 1.7, 1.7].map((w, i) => ({
    id: `${otherId}-e${i}`,
    session_id: otherId,
    tag: i % 2 === 0 ? '2' : '3',
    weight: w,
    note: null,
    new_tag_flag: false,
    entered_at: completedEarlier,
  }));
  r = await supabaseAdmin.from('weigh_ins').insert(otherEntries);
  expect(r.error).toBeNull();

  await page.goto('/broiler/weighins');
  await expect(page.locator('#wcf-boot-loader')).toHaveCount(0, {timeout: 15_000});

  // Sessions are ordered by completed_at desc — the FIXTURE's complete
  // session (1.5) lands first because it was completed AFTER the
  // pre-seeded other (1.7). Click the first COMPLETE row to move it.
  await page.getByText('complete', {exact: true}).first().click();
  await expect(page.locator('[data-testid="broiler-meta-panel"]').first()).toBeVisible({timeout: 10_000});

  await page.getByTestId('broiler-meta-wk6').click();
  await page.getByTestId('broiler-meta-save').click();
  await expect(page.getByTestId('broiler-meta-save')).toHaveCount(0, {timeout: 10_000});

  // Moved session is now wk6.
  const {data: movedRows} = await supabaseAdmin.from('weigh_in_sessions').select('*').eq('id', completeId);
  expect(movedRows[0].broiler_week).toBe(6);

  const batch = await readPppV4Batch(supabaseAdmin, batchId);
  expect(batch.week4Lbs).toBe(1.7); // from the OTHER session (excludeSessionId locked out the moved one)
  expect(batch.week6Lbs).toBe(1.5); // from the moved session's existing entries
});

// =============================================================================
// T5 — Regression: existing weight-grid save path still preserves entries
//      AND session notes (locks the promised regression surface for the
//      metadata-edit feature).
// =============================================================================
test('T5: weight-grid save still preserves entries and notes after metadata-panel work', async ({
  page,
  supabaseAdmin,
  adminBroilerSessionMetaScenario,
}) => {
  const {completeId} = adminBroilerSessionMetaScenario;

  // Pre-stamp a note on the complete session so the regression covers
  // both entries AND notes preservation through the grid save path.
  const NOTE = 'admin-test-note do not lose';
  let r = await supabaseAdmin.from('weigh_in_sessions').update({notes: NOTE}).eq('id', completeId);
  expect(r.error).toBeNull();

  await page.goto('/broiler/weighins');

  await expect(page.locator('#wcf-boot-loader')).toHaveCount(0, {timeout: 15_000});
  await page.getByText('complete', {exact: true}).first().click();
  await expect(page.locator('[data-testid="broiler-meta-panel"]').first()).toBeVisible({timeout: 10_000});

  // Unlock the grid.
  await page.getByRole('button', {name: /Edit Weights/}).click();
  // Grid hydrates from existing entries — 5 weights present (1.3,1.4,1.5,1.6,1.7).
  // Notes textarea hydrates from session.notes. We don't change anything;
  // just hit save and verify entries + notes unchanged.
  // (Save Weights button surfaces once unlocked.)
  await page.getByRole('button', {name: 'Save Weights'}).click();
  // After save, the unlock toggles back; wait for it.
  await expect(page.getByRole('button', {name: /Edit Weights/})).toBeVisible({timeout: 10_000});

  const {data: weighIns} = await supabaseAdmin.from('weigh_ins').select('weight').eq('session_id', completeId);
  expect(weighIns).toHaveLength(5);
  const weights = weighIns.map((row) => Number(row.weight)).sort();
  expect(weights).toEqual([1.3, 1.4, 1.5, 1.6, 1.7]);

  const {data: sessions} = await supabaseAdmin.from('weigh_in_sessions').select('notes').eq('id', completeId);
  expect(sessions).toHaveLength(1);
  expect(sessions[0].notes).toBe(NOTE);
});

// =============================================================================
// T6 — Negative UI lock: pig sessions in LivestockWeighInsView do NOT
// render the broiler metadata panel. (Cattle/sheep are different views.)
// =============================================================================
test('T6: pig sessions in LivestockWeighInsView do NOT show the broiler metadata panel', async ({
  page,
  supabaseAdmin,
  adminBroilerSessionMetaScenario,
}) => {
  void adminBroilerSessionMetaScenario;

  // Pig flow needs an active pig group + a draft pig session.
  let r = await supabaseAdmin
    .from('webform_config')
    .upsert({key: 'active_groups', data: ['P-26-01']}, {onConflict: 'key'});
  expect(r.error).toBeNull();
  const today = new Date().toISOString().slice(0, 10);
  const startedAt = new Date().toISOString();
  r = await supabaseAdmin.from('weigh_in_sessions').insert({
    id: 'pig-sess-1',
    species: 'pig',
    status: 'draft',
    date: today,
    team_member: 'BMAN',
    batch_id: 'P-26-01',
    started_at: startedAt,
  });
  expect(r.error).toBeNull();

  await page.goto('/pig/weighins');
  await expect(page.locator('#wcf-boot-loader')).toHaveCount(0, {timeout: 15_000});
  await expect(page.getByText('P-26-01').first()).toBeVisible({timeout: 15_000});
  await page.getByText('P-26-01').first().click();

  // Some non-broiler expanded marker should be visible — the Edit/Complete
  // buttons exist on every species, so wait on Delete Weigh-In.
  await expect(page.getByRole('button', {name: 'Delete Weigh-In'})).toBeVisible({timeout: 10_000});
  // Broiler-only metadata panel must NOT render.
  await expect(page.locator('[data-testid="broiler-meta-panel"]')).toHaveCount(0);
});

// =============================================================================
// T7 — Legacy team_member preservation. Session has team_member='RETIREE'
//      but RETIREE is not in the active roster. The dropdown shows it
//      with a "(retired)" suffix, and a save that touches WK only
//      preserves team_member='RETIREE'.
// =============================================================================
test('T7: legacy team_member preserved across a WK-only save', async ({
  page,
  supabaseAdmin,
  adminBroilerSessionMetaScenario,
}) => {
  const {batchId} = adminBroilerSessionMetaScenario;

  // Insert a complete broiler session for the batch with a retired team
  // name (not present in the active roster BMAN+JANE).
  const today = new Date().toISOString().slice(0, 10);
  const completed = new Date(Date.now() - 30 * 60 * 1000).toISOString();
  const retiredId = 'sd-retired';
  let r = await supabaseAdmin.from('weigh_in_sessions').insert({
    id: retiredId,
    species: 'broiler',
    status: 'complete',
    date: today,
    team_member: 'RETIREE',
    batch_id: batchId,
    broiler_week: 4,
    started_at: completed,
    completed_at: completed,
  });
  expect(r.error).toBeNull();
  // 2 entries on the retired session (avg = 2.0) so the WK 4→6 path
  // produces a non-empty wk6Lbs in T7.
  r = await supabaseAdmin.from('weigh_ins').insert([
    {
      id: `${retiredId}-e0`,
      session_id: retiredId,
      tag: '2',
      weight: 2.0,
      note: null,
      new_tag_flag: false,
      entered_at: completed,
    },
    {
      id: `${retiredId}-e1`,
      session_id: retiredId,
      tag: '3',
      weight: 2.0,
      note: null,
      new_tag_flag: false,
      entered_at: completed,
    },
  ]);
  expect(r.error).toBeNull();

  await page.goto('/broiler/weighins');
  await expect(page.locator('#wcf-boot-loader')).toHaveCount(0, {timeout: 15_000});

  // Two complete sessions exist (the seeded BMAN one and the retired one).
  // The retired session was completed BEFORE the seeded one, so the seeded
  // session is on top by completed_at desc. Find the row showing 'RETIREE'.
  await expect(page.getByText('RETIREE').first()).toBeVisible({timeout: 10_000});
  await page.getByText('RETIREE').first().click();
  await expect(page.locator('[data-testid="broiler-meta-panel"]').first()).toBeVisible({timeout: 10_000});

  // Dropdown current value is RETIREE; the option is rendered with the
  // (retired) marker even though the active roster doesn't include it.
  const teamSelect = page.getByTestId('broiler-meta-team');
  await expect(teamSelect).toHaveValue('RETIREE');
  await expect(teamSelect.locator('option', {hasText: 'RETIREE (retired)'})).toHaveCount(1);

  // Make a dirty change on WK only (4 → 6), leaving team as RETIREE.
  await page.getByTestId('broiler-meta-wk6').click();
  await page.getByTestId('broiler-meta-save').click();
  await expect(page.getByTestId('broiler-meta-save')).toHaveCount(0, {timeout: 10_000});

  const {data: rows} = await supabaseAdmin.from('weigh_in_sessions').select('*').eq('id', retiredId);
  expect(rows[0].team_member).toBe('RETIREE');
  expect(rows[0].broiler_week).toBe(6);
});
