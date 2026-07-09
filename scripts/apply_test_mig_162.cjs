// Apply mig 162 (server-backed Customer/Processor option lists) to TEST via
// exec_sql, then behaviorally verify set_processing_option_list: admin can
// replace either list, the server trims + de-dupes + drops blanks, invalid kind
// and non-array inputs are refused, and get_processing_settings surfaces the
// lists. Captures the post-apply baseline of processor_options + customer_options
// and ALWAYS restores it (try/finally) so shared TEST settings are unchanged.
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

// Throw (do NOT process.exit) so the try/finally settings restore always runs.
function die(msg) {
  throw new Error(msg);
}
function eqArr(a, b) {
  return Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((v, i) => v === b[i]);
}

(async () => {
  console.log(`TEST url=${url}`);
  const {error: signErr} = await authed.auth.signInWithPassword({email: adminEmail, password: adminPassword});
  if (signErr) die('admin signIn failed: ' + (signErr.message || signErr));

  const body = fs.readFileSync(
    path.join(__dirname, '..', 'supabase-migrations', '162_processing_option_lists.sql'),
    'utf8',
  );
  console.log(`applying 162_processing_option_lists.sql (${body.length} bytes)`);
  const {error: applyErr} = await service.rpc('exec_sql', {sql: body});
  if (applyErr) die('exec_sql APPLY failed: ' + (applyErr.message || applyErr));
  await new Promise((r) => setTimeout(r, 2000));

  // Baseline AFTER apply, BEFORE our test writes (processor_options unchanged by
  // ADD COLUMN; customer_options now seeded). Restore target.
  const {data: baseRow, error: baseErr} = await service
    .from('processing_asana_sync_settings')
    .select('processor_options, customer_options')
    .eq('id', 'singleton')
    .maybeSingle();
  if (baseErr) die('baseline read failed: ' + (baseErr.message || baseErr));
  const baseProcessor = baseRow.processor_options;
  const baseCustomer = baseRow.customer_options;

  let restored = false;
  const restore = async () => {
    if (restored) return;
    restored = true;
    await service
      .from('processing_asana_sync_settings')
      .update({processor_options: baseProcessor, customer_options: baseCustomer})
      .eq('id', 'singleton');
  };

  try {
    // get_processing_settings surfaces customer_options (default seeded).
    const {data: settings, error: gErr} = await authed.rpc('get_processing_settings');
    if (gErr) die('get_processing_settings failed: ' + (gErr.message || gErr));
    if (!settings || !Array.isArray(settings.customer_options)) die('get: customer_options missing from settings');
    if (!Array.isArray(settings.processor_options)) die('get: processor_options missing from settings');
    console.log('  [ok] get_processing_settings returns processor_options + customer_options');

    // set customer: trim + de-dupe + drop blanks, preserve first-seen order.
    const {error: cErr} = await authed.rpc('set_processing_option_list', {
      p_kind: 'customer',
      p_options: ['  Alpha  ', 'Beta', 'Alpha', '', 'Gamma'],
    });
    if (cErr) die('set customer failed: ' + (cErr.message || cErr));
    const {data: after1} = await service
      .from('processing_asana_sync_settings')
      .select('customer_options')
      .eq('id', 'singleton')
      .maybeSingle();
    if (!eqArr(after1.customer_options, ['Alpha', 'Beta', 'Gamma'])) {
      die('customer clean wrong: ' + JSON.stringify(after1.customer_options));
    }
    console.log('  [ok] set_processing_option_list(customer) trimmed/de-duped → [Alpha, Beta, Gamma]');

    // set processor.
    const {error: pErr} = await authed.rpc('set_processing_option_list', {
      p_kind: 'processor',
      p_options: ['Proc One', 'Proc Two', 'Proc One'],
    });
    if (pErr) die('set processor failed: ' + (pErr.message || pErr));
    const {data: after2} = await service
      .from('processing_asana_sync_settings')
      .select('processor_options')
      .eq('id', 'singleton')
      .maybeSingle();
    if (!eqArr(after2.processor_options, ['Proc One', 'Proc Two'])) {
      die('processor clean wrong: ' + JSON.stringify(after2.processor_options));
    }
    console.log('  [ok] set_processing_option_list(processor) de-duped → [Proc One, Proc Two]');

    // invalid kind refused.
    const {error: kindErr} = await authed.rpc('set_processing_option_list', {p_kind: 'bogus', p_options: ['x']});
    if (!kindErr) die('invalid kind should be refused');
    console.log('  [ok] invalid kind refused');

    // non-array refused.
    const {error: typeErr} = await authed.rpc('set_processing_option_list', {p_kind: 'customer', p_options: {a: 1}});
    if (!typeErr) die('non-array options should be refused');
    console.log('  [ok] non-array options refused');
  } finally {
    await restore();
  }

  // Confirm restore.
  const {data: afterRestore} = await service
    .from('processing_asana_sync_settings')
    .select('processor_options, customer_options')
    .eq('id', 'singleton')
    .maybeSingle();
  if (
    JSON.stringify(afterRestore.processor_options) !== JSON.stringify(baseProcessor) ||
    JSON.stringify(afterRestore.customer_options) !== JSON.stringify(baseCustomer)
  ) {
    die('restore: settings not restored to baseline');
  }
  console.log('  [ok] settings restored to post-apply baseline');
  console.log('mig162 verify: ALL CHECKS PASSED');
  process.exit(0);
})().catch((e) => {
  // Settings restore runs in the try/finally above; a throw before that point
  // (apply / baseline read) hasn't mutated any settings, so nothing to undo.
  console.error('FAIL (exception):', e && (e.message || e));
  process.exit(1);
});
