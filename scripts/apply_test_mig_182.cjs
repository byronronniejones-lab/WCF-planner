// Apply migration 182 to TEST and prove zero-cow cattle months do not consume
// sequence numbers. The script is TEST-only, uses disposable rows and a
// disposable admin, and cleans every proof artifact in finally.

const fs = require('fs');
const path = require('path');

function loadDotEnv(file) {
  if (!fs.existsSync(file)) return;
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (!match) continue;
    let value = match[2].trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (process.env[match[1]] === undefined) process.env[match[1]] = value;
  }
}

loadDotEnv(path.join(__dirname, '..', '..', 'WCF-planner', '.env.test'));
loadDotEnv(path.join(__dirname, '..', '..', 'WCF-planner', '.env.test.local'));
loadDotEnv(path.join(__dirname, '..', '.env.test'));
loadDotEnv(path.join(__dirname, '..', '.env.test.local'));

const url = process.env.VITE_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const anonKey = process.env.VITE_SUPABASE_ANON_KEY;
const PROD_REF = 'pzfujbjtayhkdlxiblwe';
if (process.env.WCF_TEST_DATABASE !== '1') {
  console.error('refusing: WCF_TEST_DATABASE must be 1');
  process.exit(2);
}
if (!url || !serviceKey || !anonKey) {
  console.error('missing TEST env');
  process.exit(2);
}
if (url.includes(PROD_REF)) {
  console.error('refusing: URL matches PROD project ref');
  process.exit(2);
}

const {createClient} = require(path.join(__dirname, '..', 'node_modules', '@supabase', 'supabase-js'));
const service = createClient(url, serviceKey, {auth: {autoRefreshToken: false, persistSession: false}});
const caller = createClient(url, anonKey, {auth: {autoRefreshToken: false, persistSession: false}});
const stamp = `${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
const email = `cattle-sequence-182-${stamp}@wcfplanner.test`;
const password = 'CattleSequence182!proof';
const ids = {
  drop: `__mig182_drop_${stamp}`,
  first: `__mig182_first_${stamp}`,
  second: `__mig182_second_${stamp}`,
  refused: `__mig182_refused_${stamp}`,
};
const names = {
  drop: 'C-98-90',
  first: 'C-98-91',
  second: 'C-98-92',
  refused: 'C-98-93',
};
let userId = null;

function fail(message, detail) {
  throw new Error(message + (detail ? `: ${detail}` : ''));
}

async function execSql(sql, label) {
  const {error} = await service.rpc('exec_sql', {sql});
  if (error) fail(label, error.message || String(error));
}

async function cleanup() {
  const allIds = Object.values(ids);
  const activityDelete = await service.from('activity_events').delete().in('entity_id', allIds);
  if (activityDelete.error) fail('cleanup activity rows', activityDelete.error.message);
  const processingDelete = await service
    .from('processing_records')
    .delete()
    .eq('source_kind', 'cattle')
    .in('source_id', allIds);
  if (processingDelete.error) fail('cleanup processing rows', processingDelete.error.message);
  const batchDelete = await service.from('cattle_processing_batches').delete().in('id', allIds);
  if (batchDelete.error) fail('cleanup batch rows', batchDelete.error.message);
  if (userId) {
    const profileDelete = await service.from('profiles').delete().eq('id', userId);
    if (profileDelete.error) fail('cleanup proof profile', profileDelete.error.message);
    const userDelete = await service.auth.admin.deleteUser(userId);
    if (userDelete.error) fail('cleanup proof user', userDelete.error.message);
  }
  await caller.auth.signOut();
  const batchResidue = await service.from('cattle_processing_batches').select('id').in('id', allIds);
  const processingResidue = await service
    .from('processing_records')
    .select('id')
    .eq('source_kind', 'cattle')
    .in('source_id', allIds);
  const activityResidue = await service.from('activity_events').select('id').in('entity_id', allIds);
  if (batchResidue.error || processingResidue.error || activityResidue.error) fail('cleanup residue check failed');
  if (batchResidue.data.length || processingResidue.data.length || activityResidue.data.length) {
    fail('cleanup residue remains');
  }
  console.log('  cleanup: all disposable rows and proof user removed');
}

(async () => {
  try {
    const migration = fs.readFileSync(
      path.join(__dirname, '..', 'supabase-migrations', '182_cattle_nonempty_batch_sequence.sql'),
      'utf8',
    );
    await execSql(migration, 'apply migration 182');
    await new Promise((resolve) => setTimeout(resolve, 2000));

    await execSql(
      `DO $$ BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM pg_proc
           WHERE oid = 'public.reconcile_cattle_scheduled_batches(jsonb,text)'::regprocedure
             AND prosecdef
             AND proconfig @> ARRAY['search_path=public']
        ) THEN RAISE EXCEPTION 'function security contract missing'; END IF;
        IF has_function_privilege('anon', 'public.reconcile_cattle_scheduled_batches(jsonb,text)', 'EXECUTE')
        THEN RAISE EXCEPTION 'anon unexpectedly has execute'; END IF;
        IF NOT has_function_privilege('authenticated', 'public.reconcile_cattle_scheduled_batches(jsonb,text)', 'EXECUTE')
        THEN RAISE EXCEPTION 'authenticated lacks execute'; END IF;
      END $$;`,
      'structural proof',
    );

    const created = await service.auth.admin.createUser({email, password, email_confirm: true});
    if (created.error) fail('create proof user', created.error.message);
    userId = created.data.user.id;
    const profile = await service.from('profiles').upsert({
      id: userId,
      email,
      full_name: 'Migration 182 Proof',
      role: 'admin',
      program_access: null,
    });
    if (profile.error) fail('create proof profile', profile.error.message);
    const signedIn = await caller.auth.signInWithPassword({email, password});
    if (signedIn.error) fail('sign in proof user', signedIn.error.message);

    const rows = [
      {id: ids.drop, name: names.drop, planned_process_date: '2098-08-07', status: 'scheduled', cows_detail: []},
      {id: ids.first, name: names.first, planned_process_date: '2098-09-11', status: 'scheduled', cows_detail: []},
      {id: ids.second, name: names.second, planned_process_date: '2098-10-09', status: 'scheduled', cows_detail: []},
      {
        id: ids.refused,
        name: names.refused,
        planned_process_date: '2098-11-13',
        status: 'scheduled',
        cows_detail: [{id: 'proof-cow', tag: 'proof-cow'}],
      },
    ];
    const inserted = await service.from('cattle_processing_batches').insert(rows);
    if (inserted.error) fail('seed scheduled rows', inserted.error.message);

    const plan = [
      {id: ids.drop, expected_name: names.drop, action: 'drop', target_name: null},
      {id: ids.first, expected_name: names.first, action: 'rename', target_name: names.drop},
      {id: ids.second, expected_name: names.second, action: 'rename', target_name: names.first},
    ];
    const result = await caller.rpc('reconcile_cattle_scheduled_batches', {
      p_plan: plan,
      p_team_member: 'Migration 182 Proof',
    });
    if (result.error) fail('authenticated reconciliation', result.error.message);
    if (!result.data || result.data.ok !== true || result.data.dropped !== 1 || result.data.renamed !== 2) {
      fail('unexpected reconciliation result', JSON.stringify(result.data));
    }

    const after = await service.from('cattle_processing_batches').select('id,name,status').in('id', Object.values(ids));
    if (after.error) fail('read reconciled rows', after.error.message);
    const byId = new Map(after.data.map((row) => [row.id, row]));
    if (byId.has(ids.drop)) fail('zero-cow scheduled row still exists');
    if (byId.get(ids.first)?.name !== names.drop || byId.get(ids.second)?.name !== names.first) {
      fail('later scheduled rows did not close the name gap');
    }

    const processing = await service
      .from('processing_records')
      .select('source_id,title,archived')
      .eq('source_kind', 'cattle')
      .in('source_id', [ids.drop, ids.first, ids.second]);
    if (processing.error) fail('read synchronized processing rows', processing.error.message);
    const processingBySource = new Map(processing.data.map((row) => [row.source_id, row]));
    if (processingBySource.has(ids.drop)) fail('removed zero-cow source lingered in Processing');
    if (
      processingBySource.get(ids.first)?.title !== names.drop ||
      processingBySource.get(ids.second)?.title !== names.first
    ) {
      fail('Processing titles did not follow scheduled renames');
    }

    const events = await service
      .from('activity_events')
      .select('entity_id,event_type,payload')
      .in('entity_id', [ids.drop, ids.first, ids.second]);
    if (events.error) fail('read audit rows', events.error.message);
    if (events.data.length !== 3) fail('expected exactly three audit rows', String(events.data.length));

    const refused = await caller.rpc('reconcile_cattle_scheduled_batches', {
      p_plan: [{id: ids.refused, expected_name: names.refused, action: 'drop', target_name: null}],
      p_team_member: 'Migration 182 Proof',
    });
    if (!refused.error || !String(refused.error.message).includes('refusing to drop non-empty batch')) {
      fail('nonempty scheduled row was not refused');
    }
    const stillThere = await service.from('cattle_processing_batches').select('id').eq('id', ids.refused).maybeSingle();
    if (stillThere.error || !stillThere.data) fail('refused nonempty row did not survive');

    console.log('MIGRATION 182 TEST PROOF PASSED');
    console.log('  authenticated chain: 1 zero-cow row dropped, 2 later rows renumbered');
    console.log('  audit: 3/3 rows present');
    console.log('  fail-closed: nonempty scheduled row refused and preserved');
  } finally {
    await cleanup();
  }
})().catch((error) => {
  console.error('MIGRATION 182 TEST PROOF FAILED:', error.message || String(error));
  process.exit(1);
});
