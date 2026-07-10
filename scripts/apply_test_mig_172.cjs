// Apply mig 172 (Processing template suite) to TEST via exec_sql, then verify:
//   1. every program WITHOUT a template gets exactly one ACTIVE v1 default
//      whose fields/checklist EQUAL the canonical JS suite
//      (defaultProcessingTemplateSuite — the same source the client Reset uses);
//   2. reapply is a NO-OP (idempotent — no duplicate rows, versions unchanged);
//   3. an administrator-customized program is NEVER overwritten or deactivated:
//      after an admin saves a v2, re-applying 172 leaves v2 active and adds
//      nothing;
//   4. set_processing_field accepts the new control types (checkbox boolean,
//      url http/https) and refuses wrong-typed values for both.
// Snapshot/restore: the script captures the pre-existing template state per
// program and restores it in finally, so shared TEST state is unchanged.
const fs = require('fs');
const path = require('path');

function loadDotEnv(file) {
  if (!fs.existsSync(file)) return;
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (!m) continue;
    let v = m[2].trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    if (process.env[m[1]] === undefined) process.env[m[1]] = v;
  }
}
loadDotEnv(path.join(__dirname, '..', '.env.test'));
loadDotEnv(path.join(__dirname, '..', '.env.test.local'));

const url = process.env.VITE_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const anonKey = process.env.VITE_SUPABASE_ANON_KEY;
const adminEmail = process.env.VITE_TEST_ADMIN_EMAIL;
const adminPassword = process.env.VITE_TEST_ADMIN_PASSWORD;
const PROD_REF = 'pzfujbjtayhkdlxiblwe';
if (!url || !serviceKey || !anonKey || !adminEmail || !adminPassword) {
  console.error('missing TEST env');
  process.exit(2);
}
if (url.includes(PROD_REF)) {
  console.error('refusing to run against PROD url');
  process.exit(2);
}

const {createClient} = require(path.join(__dirname, '..', 'node_modules', '@supabase', 'supabase-js'));
const service = createClient(url, serviceKey, {auth: {autoRefreshToken: false, persistSession: false}});
const authed = createClient(url, anonKey, {auth: {autoRefreshToken: false, persistSession: false}});

function die(msg) {
  throw new Error(msg);
}
// Key-order-insensitive canonical stringify: Postgres jsonb reorders object
// keys (length, then alphabetical), so a byte compare against the JS suite
// would false-negative on key order while the CONTENT is identical.
function canon(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value ?? null);
  if (Array.isArray(value)) return '[' + value.map(canon).join(',') + ']';
  return (
    '{' +
    Object.keys(value)
      .sort()
      .map((k) => JSON.stringify(k) + ':' + canon(value[k]))
      .join(',') +
    '}'
  );
}
const PROGRAMS = ['broiler', 'cattle', 'pig', 'sheep'];
const REC = 'mig172-rec-1';

(async () => {
  console.log(`TEST url=${url}`);
  const {error: signErr} = await authed.auth.signInWithPassword({email: adminEmail, password: adminPassword});
  if (signErr) die('admin signIn failed: ' + (signErr.message || signErr));
  const {data: me} = await authed.auth.getUser();
  const adminId = me.user.id;

  // Canonical suite from the SAME module the client uses (ESM import from CJS).
  const suite = (await import('../src/lib/processingFields.js')).defaultProcessingTemplateSuite();

  // Snapshot the pre-existing template table state (restored in finally).
  const {data: preRows, error: preErr} = await service.from('processing_templates').select('*');
  if (preErr) die('pre snapshot failed: ' + preErr.message);

  const body = fs.readFileSync(
    path.join(__dirname, '..', 'supabase-migrations', '172_processing_template_suite.sql'),
    'utf8',
  );

  const apply = async (label) => {
    const {error} = await service.rpc('exec_sql', {sql: body});
    if (error) die(`exec_sql APPLY (${label}) failed: ` + (error.message || error));
    await new Promise((r) => setTimeout(r, 1500));
  };

  const restore = async () => {
    await service.from('processing_records').delete().eq('id', REC);
    await service.from('activity_events').delete().eq('entity_id', REC);
    await service.from('processing_templates').delete().neq('id', '__none__');
    if (preRows.length) {
      const {error} = await service.from('processing_templates').insert(preRows);
      if (error) console.error('RESTORE WARNING: ' + error.message);
    }
  };

  try {
    // Start from an empty template table (the current PROD shape).
    await service.from('processing_templates').delete().neq('id', '__none__');

    // ── 1. first apply seeds all four programs with the canonical suite ──────
    console.log(`applying 172_processing_template_suite.sql (${body.length} bytes)`);
    await apply('first');
    const {data: seeded} = await service
      .from('processing_templates')
      .select('id, program, version, is_active, fields, checklist')
      .order('program');
    if (seeded.length !== 4) die('expected 4 seeded templates, got ' + seeded.length);
    for (const program of PROGRAMS) {
      const row = seeded.find((r) => r.program === program);
      if (!row) die(`missing seed for ${program}`);
      if (row.id !== `ptpl-default-${program}` || row.version !== 1 || row.is_active !== true) {
        die(
          `${program} seed shape wrong: ` + JSON.stringify({id: row.id, version: row.version, active: row.is_active}),
        );
      }
      if (canon(row.fields) !== canon(suite[program].fields)) {
        die(`${program} fields differ from the canonical JS suite`);
      }
      if (canon(row.checklist) !== canon(suite[program].checklist)) {
        die(`${program} checklist differs from the canonical JS suite`);
      }
    }
    console.log('  [ok] all four programs seeded ACTIVE v1 == canonical JS suite');

    // ── 2. reapply is a no-op ─────────────────────────────────────────────────
    await apply('reapply');
    const {data: after2} = await service.from('processing_templates').select('id');
    if (after2.length !== 4) die('reapply must not add rows (got ' + after2.length + ')');
    console.log('  [ok] reapply idempotent (still exactly 4 rows)');

    // ── 3. admin-customized program is never overwritten ─────────────────────
    const custom = await authed.rpc('upsert_processing_template', {
      p_program: 'cattle',
      p_fields: [{id: 'customField', name: 'Custom Field', type: 'text'}],
      p_checklist: [{label: 'Custom step', assignee: null, assignee_profile_id: null}],
    });
    if (custom.error) die('admin customize failed: ' + custom.error.message);
    await apply('after-customize');
    const {data: cattleRows} = await service
      .from('processing_templates')
      .select('id, version, is_active, fields')
      .eq('program', 'cattle')
      .order('version');
    if (cattleRows.length !== 2) die('cattle should have v1 (inactive) + v2 (custom active), got ' + cattleRows.length);
    const active = cattleRows.find((r) => r.is_active);
    if (!active || active.version !== 2 || active.fields[0].id !== 'customField') {
      die('customized cattle template must stay the ACTIVE one after reapply');
    }
    console.log('  [ok] admin-customized template untouched by reapply (v2 stays active)');

    // ── 4. checkbox / url validation in set_processing_field ─────────────────
    const tplNew = await authed.rpc('upsert_processing_template', {
      p_program: 'pig',
      p_fields: [
        {id: 'verified172', name: 'Verified', type: 'checkbox'},
        {id: 'killSheetUrl', name: 'Kill Sheet Link', type: 'url'},
      ],
      p_checklist: [],
    });
    if (tplNew.error) die('pig test template failed: ' + tplNew.error.message);
    const {error: recErr} = await service.from('processing_records').insert({
      id: REC,
      record_type: 'asana_historical',
      program: 'pig',
      title: 'MIG172 record',
      status: 'planned',
      match_status: 'unmatched',
      created_by: adminId,
    });
    if (recErr) die('seed record failed: ' + recErr.message);

    const okBool = await authed.rpc('set_processing_field', {p_id: REC, p_field_id: 'verified172', p_value: true});
    if (okBool.error) die('checkbox true failed: ' + okBool.error.message);
    const badBool = await authed.rpc('set_processing_field', {p_id: REC, p_field_id: 'verified172', p_value: 'yes'});
    if (!badBool.error) die('non-boolean checkbox must be refused');
    const okUrl = await authed.rpc('set_processing_field', {
      p_id: REC,
      p_field_id: 'killSheetUrl',
      p_value: 'https://example.com/kill-sheet.pdf',
    });
    if (okUrl.error) die('valid url failed: ' + okUrl.error.message);
    const badUrl = await authed.rpc('set_processing_field', {
      p_id: REC,
      p_field_id: 'killSheetUrl',
      p_value: 'notaurl',
    });
    if (!badUrl.error) die('non-http url must be refused');
    const badUrl2 = await authed.rpc('set_processing_field', {
      p_id: REC,
      p_field_id: 'killSheetUrl',
      p_value: 'javascript:alert(1)',
    });
    if (!badUrl2.error) die('javascript: scheme must be refused');
    const {data: recRow} = await service.from('processing_records').select('fields').eq('id', REC).single();
    if (recRow.fields.verified172 !== true || recRow.fields.killSheetUrl !== 'https://example.com/kill-sheet.pdf') {
      die('typed values not persisted: ' + JSON.stringify(recRow.fields));
    }
    console.log('  [ok] set_processing_field checkbox/url accept + refusal paths');
  } finally {
    await restore();
  }

  console.log('mig172 verify: ALL CHECKS PASSED');
  process.exit(0);
})().catch((e) => {
  console.error('FAIL (exception):', e && (e.message || e));
  process.exit(1);
});
