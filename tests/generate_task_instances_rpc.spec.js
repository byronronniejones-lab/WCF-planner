import {test, expect} from './fixtures.js';
import {createClient} from '@supabase/supabase-js';

// ============================================================================
// Phase B — public.generate_task_instances RPC contract (mig 039)
// ============================================================================
// Locks the contract Codex approved in plan rev 3:
//
//   * SECURITY DEFINER + SET search_path = public.
//   * GRANT EXECUTE TO service_role only. Anon + authenticated REVOKED.
//   * Owns ON CONFLICT (template_id, due_date) WHERE template_id IS NOT NULL
//     DO NOTHING. Single-statement INSERT ... ON CONFLICT does NOT abort on
//     duplicate (mig 037's partial unique index absorbs the conflict).
//   * Returns int = inserted row count (via GET DIAGNOSTICS).
//   * Empty p_dates array → returns 0, no error.
//   * Unknown template_id → SQL exception with explicit message.
//   * Inactive template → SQL exception with explicit message.
//   * Re-invocation with the same (template, dates) returns 0 inserted; the
//     existing rows stay untouched.
//   * Concurrent calls with overlapping dates: total inserted across both
//     equals (union − pre-existing). The partial unique index protects
//     against double-mint regardless of caller race.
// ============================================================================

const TODAY = '2026-05-01';

async function getAdminProfileId(supabaseAdmin) {
  // Resolve the test admin's profiles.id. The admin row is fixed across the
  // test project lifetime; no mutation needed. recon_tasks_rls.cjs upserts
  // role='admin' on this id; we just need a valid uuid for the FK.
  const email = process.env.VITE_TEST_ADMIN_EMAIL;
  if (!email) throw new Error('VITE_TEST_ADMIN_EMAIL not set in env');
  const {data, error} = await supabaseAdmin.from('profiles').select('id').eq('email', email).maybeSingle();
  if (error) throw new Error(`profiles lookup: ${error.message}`);
  if (!data) throw new Error(`profiles row missing for ${email} — recon_tasks_rls.cjs setup needed first`);
  return data.id;
}

async function seedTemplate(supabaseAdmin, overrides = {}) {
  const adminId = await getAdminProfileId(supabaseAdmin);
  const template = {
    id: overrides.id || `tmpl-rpc-${Math.random().toString(36).slice(2, 10)}`,
    title: overrides.title || 'rpc spec template',
    description: overrides.description || null,
    assignee_profile_id: adminId,
    recurrence: overrides.recurrence || 'daily',
    recurrence_interval: overrides.recurrence_interval || 1,
    first_due_date: overrides.first_due_date || TODAY,
    active: overrides.active === undefined ? true : overrides.active,
  };
  const {error} = await supabaseAdmin.from('task_templates').insert(template);
  if (error) throw new Error(`seed template: ${error.message}`);
  return template;
}

// --------------------------------------------------------------------------
// Test 1 — Single-date insert: returns 1, row matches template
// --------------------------------------------------------------------------
test('single date: returns 1, row carries template title/description/assignee', async ({supabaseAdmin, resetDb}) => {
  await resetDb();
  const t = await seedTemplate(supabaseAdmin, {title: 'Daily Feed Check', description: 'Walk through pens'});

  const {data: inserted, error} = await supabaseAdmin.rpc('generate_task_instances', {
    p_template_id: t.id,
    p_dates: [TODAY],
  });
  expect(error).toBeNull();
  expect(inserted).toBe(1);

  const {data: rows} = await supabaseAdmin.from('task_instances').select('*').eq('template_id', t.id);
  expect(rows).toHaveLength(1);
  expect(rows[0].title).toBe('Daily Feed Check');
  expect(rows[0].description).toBe('Walk through pens');
  expect(rows[0].assignee_profile_id).toBe(t.assignee_profile_id);
  expect(rows[0].submission_source).toBe('generated');
  expect(rows[0].status).toBe('open');
  expect(String(rows[0].due_date).slice(0, 10)).toBe(TODAY);
  expect(rows[0].id).toMatch(/^ti-/);
});

// --------------------------------------------------------------------------
// Test 2 — Bulk insert: N dates → N rows
// --------------------------------------------------------------------------
test('bulk: N dates → N rows; ON CONFLICT DO NOTHING does not abort', async ({supabaseAdmin, resetDb}) => {
  await resetDb();
  const t = await seedTemplate(supabaseAdmin);
  const dates = ['2026-05-01', '2026-05-02', '2026-05-03', '2026-05-04', '2026-05-05'];

  const {data: inserted, error} = await supabaseAdmin.rpc('generate_task_instances', {
    p_template_id: t.id,
    p_dates: dates,
  });
  expect(error).toBeNull();
  expect(inserted).toBe(5);

  const {data: rows} = await supabaseAdmin.from('task_instances').select('due_date').eq('template_id', t.id);
  const dueSet = new Set(rows.map((r) => String(r.due_date).slice(0, 10)));
  expect(dueSet).toEqual(new Set(dates));
});

// --------------------------------------------------------------------------
// Test 3 — Re-invocation idempotency: same dates → 0 inserted
// --------------------------------------------------------------------------
test('idempotent: same template + same dates → 0 inserted on second call; existing rows preserved', async ({
  supabaseAdmin,
  resetDb,
}) => {
  await resetDb();
  const t = await seedTemplate(supabaseAdmin);
  const dates = ['2026-05-01', '2026-05-02', '2026-05-03'];

  const r1 = await supabaseAdmin.rpc('generate_task_instances', {p_template_id: t.id, p_dates: dates});
  expect(r1.error).toBeNull();
  expect(r1.data).toBe(3);

  const r2 = await supabaseAdmin.rpc('generate_task_instances', {p_template_id: t.id, p_dates: dates});
  expect(r2.error).toBeNull();
  expect(r2.data).toBe(0);

  const {data: rows} = await supabaseAdmin.from('task_instances').select('id, due_date').eq('template_id', t.id);
  expect(rows).toHaveLength(3);
});

// --------------------------------------------------------------------------
// Test 4 — Mixed overlap: partial new dates inserted, existing skipped
// --------------------------------------------------------------------------
test('mixed: only new dates inserted; pre-existing rows untouched', async ({supabaseAdmin, resetDb}) => {
  await resetDb();
  const t = await seedTemplate(supabaseAdmin);

  const r1 = await supabaseAdmin.rpc('generate_task_instances', {
    p_template_id: t.id,
    p_dates: ['2026-05-01', '2026-05-02'],
  });
  expect(r1.error).toBeNull();
  expect(r1.data).toBe(2);

  // First-call rows now exist. Second call with overlap: 2 existing + 1 new = 1 inserted.
  const r2 = await supabaseAdmin.rpc('generate_task_instances', {
    p_template_id: t.id,
    p_dates: ['2026-05-01', '2026-05-02', '2026-05-03'],
  });
  expect(r2.error).toBeNull();
  expect(r2.data).toBe(1);

  const {data: rows} = await supabaseAdmin
    .from('task_instances')
    .select('due_date')
    .eq('template_id', t.id)
    .order('due_date', {ascending: true});
  expect(rows.map((r) => String(r.due_date).slice(0, 10))).toEqual(['2026-05-01', '2026-05-02', '2026-05-03']);
});

// --------------------------------------------------------------------------
// Test 5 — Empty array: returns 0, no error
// --------------------------------------------------------------------------
test('empty array: returns 0 with no error and no inserts', async ({supabaseAdmin, resetDb}) => {
  await resetDb();
  const t = await seedTemplate(supabaseAdmin);

  const {data, error} = await supabaseAdmin.rpc('generate_task_instances', {
    p_template_id: t.id,
    p_dates: [],
  });
  expect(error).toBeNull();
  expect(data).toBe(0);

  const {data: rows} = await supabaseAdmin.from('task_instances').select('id').eq('template_id', t.id);
  expect(rows).toHaveLength(0);
});

// --------------------------------------------------------------------------
// Test 6 — Unknown template_id → explicit SQL exception
// --------------------------------------------------------------------------
test('unknown template: SQL exception with explicit message', async ({supabaseAdmin, resetDb}) => {
  await resetDb();
  const {data, error} = await supabaseAdmin.rpc('generate_task_instances', {
    p_template_id: 'tmpl-does-not-exist',
    p_dates: [TODAY],
  });
  expect(error).not.toBeNull();
  expect(data).toBeNull();
  expect(/unknown template_id/i.test(String(error.message))).toBe(true);
});

// --------------------------------------------------------------------------
// Test 7 — Inactive template → explicit SQL exception
// --------------------------------------------------------------------------
test('inactive template: SQL exception (cron skips inactive templates entirely)', async ({supabaseAdmin, resetDb}) => {
  await resetDb();
  const t = await seedTemplate(supabaseAdmin, {active: false});

  const {data, error} = await supabaseAdmin.rpc('generate_task_instances', {
    p_template_id: t.id,
    p_dates: [TODAY],
  });
  expect(error).not.toBeNull();
  expect(data).toBeNull();
  expect(/is not active/i.test(String(error.message))).toBe(true);

  const {data: rows} = await supabaseAdmin.from('task_instances').select('id').eq('template_id', t.id);
  expect(rows).toHaveLength(0);
});

// --------------------------------------------------------------------------
// Test 8 — Concurrent calls: partial-unique-index absorbs the race
// --------------------------------------------------------------------------
test('concurrent: two service-role calls with overlapping dates land exactly the union', async ({
  supabaseAdmin,
  resetDb,
}) => {
  await resetDb();
  const t = await seedTemplate(supabaseAdmin);
  const datesA = ['2026-05-01', '2026-05-02', '2026-05-03'];
  const datesB = ['2026-05-02', '2026-05-03', '2026-05-04']; // 2 overlap, 1 new

  const [rA, rB] = await Promise.all([
    supabaseAdmin.rpc('generate_task_instances', {p_template_id: t.id, p_dates: datesA}),
    supabaseAdmin.rpc('generate_task_instances', {p_template_id: t.id, p_dates: datesB}),
  ]);
  expect(rA.error).toBeNull();
  expect(rB.error).toBeNull();
  // Total inserted across both = union size = 4. Distribution between the
  // two calls depends on scheduling; either could see 1, 2, 3, or 4.
  expect(rA.data + rB.data).toBe(4);

  const {data: rows} = await supabaseAdmin.from('task_instances').select('due_date').eq('template_id', t.id);
  const dueSet = new Set(rows.map((r) => String(r.due_date).slice(0, 10)));
  expect(dueSet).toEqual(new Set(['2026-05-01', '2026-05-02', '2026-05-03', '2026-05-04']));
});

// --------------------------------------------------------------------------
// Test 9 — Anon caller: REVOKE grant blocks execution
// --------------------------------------------------------------------------
test('anon: EXECUTE revoked → permission denied', async ({supabaseAdmin, resetDb}) => {
  await resetDb();
  const t = await seedTemplate(supabaseAdmin);

  const anonClient = createClient(process.env.VITE_SUPABASE_URL, process.env.VITE_SUPABASE_ANON_KEY, {
    auth: {autoRefreshToken: false, persistSession: false},
  });

  const {data, error} = await anonClient.rpc('generate_task_instances', {
    p_template_id: t.id,
    p_dates: [TODAY],
  });
  expect(error).not.toBeNull();
  expect(data).toBeNull();
  // PostgREST surfaces the GRANT failure to anon as one of: permission-denied
  // / 42501 (clean PG error), OR PGRST002 "schema cache" (Supabase's quirk
  // when anon lacks EXECUTE — same pattern documented in mig 037 for
  // is_admin()). Either response proves the boundary is enforced; the security
  // contract is anon CANNOT execute generate_task_instances.
  const blob = String(error.message) + String(error.code || '');
  expect(/permission denied|42501|PGRST002|schema cache/i.test(blob)).toBe(true);

  const {data: rows} = await supabaseAdmin.from('task_instances').select('id').eq('template_id', t.id);
  expect(rows).toHaveLength(0);
});
