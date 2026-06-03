import {test, expect} from './fixtures.js';
import {createClient} from '@supabase/supabase-js';

// ============================================================================
// delete_cattle_calving_record — audit-grade transactional delete (mig 079)
// ============================================================================
// The calving-record delete moved from a bare client .delete() to an atomic
// SECDEF RPC that deletes the row AND logs a record.deleted Activity event
// scoped to the dam's cattle.animal record, in one transaction.
//   1  Admin delete: row removed + record.deleted Activity on the dam
//   2  Missing record returns {ok:false, not_found} without error
//   3  Anon/unauth caller is rejected (REVOKE from anon)
// ============================================================================

const TEST_ADMIN_EMAIL = process.env.VITE_TEST_ADMIN_EMAIL;
const TEST_ADMIN_PASSWORD = process.env.VITE_TEST_ADMIN_PASSWORD;

function newAnonClient() {
  return createClient(process.env.VITE_SUPABASE_URL, process.env.VITE_SUPABASE_ANON_KEY, {
    auth: {autoRefreshToken: false, persistSession: false},
  });
}
async function newAdminAuthedClient() {
  const sb = newAnonClient();
  const {error} = await sb.auth.signInWithPassword({email: TEST_ADMIN_EMAIL, password: TEST_ADMIN_PASSWORD});
  if (error) throw new Error(`admin signIn failed: ${error.message}`);
  return sb;
}
async function seed(supabaseAdmin) {
  const {data: u} = await supabaseAdmin.auth.admin.listUsers();
  const au = (u?.users || []).find((x) => (x.email || '').toLowerCase() === TEST_ADMIN_EMAIL.toLowerCase());
  await supabaseAdmin.from('profiles').upsert({id: au.id, email: au.email, role: 'admin'}, {onConflict: 'id'});
  await supabaseAdmin.from('cattle').upsert(
    {
      id: 'cv-dam',
      tag: 'CV-DAM-1',
      sex: 'cow',
      herd: 'mommas',
      old_tags: [],
      deleted_at: null,
      deleted_by: null,
      processing_batch_id: null,
    },
    {onConflict: 'id'},
  );
  await supabaseAdmin.from('cattle_calving_records').delete().eq('id', 'cv-rec-1');
  await supabaseAdmin
    .from('cattle_calving_records')
    .insert({id: 'cv-rec-1', dam_tag: 'CV-DAM-1', calving_date: '2026-03-01', total_born: 1, deaths: 0});
  await supabaseAdmin.from('activity_events').delete().eq('entity_id', 'cv-dam');
}
async function cleanup(supabaseAdmin) {
  await supabaseAdmin.from('cattle_calving_records').delete().eq('id', 'cv-rec-1');
  await supabaseAdmin.from('cattle').delete().eq('id', 'cv-dam');
  await supabaseAdmin.from('activity_events').delete().eq('entity_id', 'cv-dam');
}

test('admin delete: calving row removed + record.deleted Activity scoped to the dam', async ({supabaseAdmin}) => {
  await seed(supabaseAdmin);
  const adminSb = await newAdminAuthedClient();

  const res = await adminSb.rpc('delete_cattle_calving_record', {p_record_id: 'cv-rec-1', p_team_member: 'Test'});
  expect(res.error).toBeNull();
  expect(res.data).toMatchObject({ok: true, reason: 'deleted', dam_id: 'cv-dam'});
  expect(res.data.event_id).toBeTruthy();

  const {data: rows} = await supabaseAdmin.from('cattle_calving_records').select('id').eq('id', 'cv-rec-1');
  expect(rows || []).toHaveLength(0);

  const {data: events} = await supabaseAdmin
    .from('activity_events')
    .select('entity_type,event_type,body')
    .eq('entity_id', 'cv-dam');
  expect(events).toHaveLength(1);
  expect(events[0].entity_type).toBe('cattle.animal');
  expect(events[0].event_type).toBe('record.deleted');
  expect(events[0].body).toMatch(/calving record .* for #CV-DAM-1/);

  await cleanup(supabaseAdmin);
});

test('missing record returns not_found without error', async ({supabaseAdmin}) => {
  await seed(supabaseAdmin);
  const adminSb = await newAdminAuthedClient();
  const res = await adminSb.rpc('delete_cattle_calving_record', {p_record_id: 'does-not-exist', p_team_member: null});
  expect(res.error).toBeNull();
  expect(res.data).toMatchObject({ok: false, reason: 'not_found'});
  await cleanup(supabaseAdmin);
});

test('anon/unauth caller is rejected', async ({supabaseAdmin}) => {
  await seed(supabaseAdmin);
  const anon = newAnonClient();
  const res = await anon.rpc('delete_cattle_calving_record', {p_record_id: 'cv-rec-1'});
  expect(res.error).not.toBeNull();
  // The row must remain (anon could not delete it).
  const {data: rows} = await supabaseAdmin.from('cattle_calving_records').select('id').eq('id', 'cv-rec-1');
  expect(rows || []).toHaveLength(1);
  await cleanup(supabaseAdmin);
});
