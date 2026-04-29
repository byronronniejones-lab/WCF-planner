import {test, expect} from './fixtures.js';

// ============================================================================
// Cattle calf dam-link — 2026-04-29
// ============================================================================
// Locks the post-build contract:
//   - mig 033 AFTER-INSERT trigger on cattle_calving_records sets the
//     matching calf cattle row's dam_tag when currently null/blank.
//   - Never overwrites an existing non-blank dam_tag (admin work survives,
//     conflicting calving records surface naturally).
//   - Backfill DO block is callable + idempotent — uses deterministic
//     row_number() over (calving_date, created_at, id) to pick a single
//     dam when multiple calving records reference the same calf_tag.
//   - Calf herd tile renders "dam #<damTag>" subtitle once the trigger
//     populates dam_tag (UI symptom test).
//
// Pre-flight: mig 033 must be applied to the test project.
// ============================================================================

const DAM = {
  id: 'cow-dam-001',
  tag: 'M-DAM-001',
  sex: 'cow',
  herd: 'mommas',
  breed: 'Angus',
};

const CALF_BLANK = {
  id: 'calf-blank-001',
  tag: 'C-CALF-001',
  sex: 'heifer',
  herd: 'mommas',
  breed: 'Angus',
  dam_tag: null,
};

const CALF_EXISTING_DAM = {
  id: 'calf-existing-001',
  tag: 'C-CALF-002',
  sex: 'heifer',
  herd: 'mommas',
  breed: 'Angus',
  dam_tag: 'M-OTHER-001',
};

// Inline copy of the mig 033 backfill DO block, callable via exec_sql for
// the idempotency regression test. Must mirror the migration's backfill
// shape exactly — if the migration's backfill changes, this constant must
// be updated too.
const BACKFILL_SQL = `
DO $$
BEGIN
  WITH ranked AS (
    SELECT
      calf_tag,
      dam_tag,
      row_number() OVER (
        PARTITION BY calf_tag
        ORDER BY calving_date ASC NULLS LAST,
                 created_at  ASC NULLS LAST,
                 id          ASC
      ) AS rn
    FROM cattle_calving_records
    WHERE calf_tag IS NOT NULL
      AND calf_tag <> ''
      AND dam_tag  IS NOT NULL
      AND dam_tag  <> ''
  )
  UPDATE cattle c
     SET dam_tag = r.dam_tag
    FROM ranked r
   WHERE r.rn = 1
     AND c.tag = r.calf_tag
     AND (c.dam_tag IS NULL OR c.dam_tag = '');
END $$;
`;

// --------------------------------------------------------------------------
// Test 1 — Trigger sets blank dam_tag on calf row
// --------------------------------------------------------------------------
test('trigger: calf with blank dam_tag gets linked on calving record insert', async ({supabaseAdmin, resetDb}) => {
  await resetDb();
  await supabaseAdmin.from('cattle').insert([DAM, CALF_BLANK]);

  await supabaseAdmin.from('cattle_calving_records').insert({
    id: 'cr-link-test-1',
    dam_tag: DAM.tag,
    calving_date: '2026-04-29',
    calf_tag: CALF_BLANK.tag,
    total_born: 1,
    deaths: 0,
  });

  const {data: calfRow, error} = await supabaseAdmin
    .from('cattle')
    .select('id, dam_tag')
    .eq('id', CALF_BLANK.id)
    .maybeSingle();
  expect(error).toBeNull();
  expect(calfRow.dam_tag).toBe(DAM.tag);
});

// --------------------------------------------------------------------------
// Test 2 — Trigger does NOT overwrite existing dam_tag
// --------------------------------------------------------------------------
test('trigger: calf with existing dam_tag is left alone on calving record insert', async ({supabaseAdmin, resetDb}) => {
  await resetDb();
  await supabaseAdmin.from('cattle').insert([DAM, CALF_EXISTING_DAM]);

  await supabaseAdmin.from('cattle_calving_records').insert({
    id: 'cr-link-test-2',
    dam_tag: DAM.tag,
    calving_date: '2026-04-29',
    calf_tag: CALF_EXISTING_DAM.tag,
    total_born: 1,
    deaths: 0,
  });

  const {data: calfRow} = await supabaseAdmin
    .from('cattle')
    .select('dam_tag')
    .eq('id', CALF_EXISTING_DAM.id)
    .maybeSingle();
  expect(calfRow.dam_tag).toBe('M-OTHER-001');
});

// --------------------------------------------------------------------------
// Test 3 — Trigger no-op when calf_tag has no matching cattle row
// --------------------------------------------------------------------------
test('trigger: missing calf row is silent no-op', async ({supabaseAdmin, resetDb}) => {
  await resetDb();
  await supabaseAdmin.from('cattle').insert(DAM);

  // calf_tag references no existing cattle row — should not error.
  const {error} = await supabaseAdmin.from('cattle_calving_records').insert({
    id: 'cr-link-test-3',
    dam_tag: DAM.tag,
    calving_date: '2026-04-29',
    calf_tag: 'NONEXISTENT-999',
    total_born: 1,
    deaths: 0,
  });
  expect(error).toBeNull();
});

// --------------------------------------------------------------------------
// Test 4 — Backfill links existing calving + is idempotent
// --------------------------------------------------------------------------
// Mirrors mig 032 spec test 3: insert calving record (trigger fires + sets
// dam_tag), reset calf.dam_tag back to null to simulate pre-mig-033 data,
// run backfill DO block, assert dam_tag is restored. Re-run is a no-op.
test('backfill: links existing calf with blank dam_tag; idempotent on re-run', async ({supabaseAdmin, resetDb}) => {
  await resetDb();
  await supabaseAdmin.from('cattle').insert([DAM, CALF_BLANK]);
  await supabaseAdmin.from('cattle_calving_records').insert({
    id: 'cr-backfill-1',
    dam_tag: DAM.tag,
    calving_date: '2026-01-15',
    calf_tag: CALF_BLANK.tag,
    total_born: 1,
    deaths: 0,
  });

  // Reset to null to simulate a pre-mig-033 row (calving record exists,
  // calf row was never linked).
  await supabaseAdmin.from('cattle').update({dam_tag: null}).eq('id', CALF_BLANK.id);

  const before = await supabaseAdmin.from('cattle').select('dam_tag').eq('id', CALF_BLANK.id).maybeSingle();
  expect(before.data.dam_tag).toBeNull();

  // First backfill run — sets the link.
  const {error: bf1Err} = await supabaseAdmin.rpc('exec_sql', {sql: BACKFILL_SQL});
  expect(bf1Err).toBeNull();

  const after1 = await supabaseAdmin.from('cattle').select('dam_tag').eq('id', CALF_BLANK.id).maybeSingle();
  expect(after1.data.dam_tag).toBe(DAM.tag);

  // Second run — idempotent, no further changes.
  const {error: bf2Err} = await supabaseAdmin.rpc('exec_sql', {sql: BACKFILL_SQL});
  expect(bf2Err).toBeNull();

  const after2 = await supabaseAdmin.from('cattle').select('dam_tag').eq('id', CALF_BLANK.id).maybeSingle();
  expect(after2.data.dam_tag).toBe(DAM.tag);
});

// --------------------------------------------------------------------------
// Test 5 — UI: calf tile shows "dam #<damTag>" after trigger fires
// --------------------------------------------------------------------------
// Codex revision: assert the visible symptom (calf herd record showing the
// dam) — not just the DB field. Confirms the DB fix actually resolves the
// reported issue.
test('UI: calf herd tile shows dam tag after trigger links it', async ({page, supabaseAdmin, resetDb}) => {
  await resetDb();
  await supabaseAdmin.from('cattle').insert([DAM, CALF_BLANK]);

  await supabaseAdmin.from('cattle_calving_records').insert({
    id: 'cr-ui-test',
    dam_tag: DAM.tag,
    calving_date: '2026-04-29',
    calf_tag: CALF_BLANK.tag,
    total_born: 1,
    deaths: 0,
  });

  await page.goto('/cattle/herds');
  await expect(page.locator('#wcf-boot-loader')).toHaveCount(0, {timeout: 15_000});

  // Mommas herd renders collapsed by default — click the header to expand.
  await page.locator('[data-herd-tile="mommas"]').click();

  const calfTile = page.locator(`#cow-${CALF_BLANK.id}`).first();
  await expect(calfTile).toBeVisible({timeout: 10_000});
  await expect(calfTile).toContainText(`dam #${DAM.tag}`);
});
