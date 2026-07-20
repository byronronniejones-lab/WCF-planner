// Apply migration 189 to TEST and prove the newsletter voice-reference + tone
// semantics contract. TEST-only, disposable rows/users, full cleanup in finally
// (including RESTORING the global newsletter_settings singleton).
//
// Proof matrix:
//   1.  admin settings round-trip: set voice_example + custom tone, read them back
//       through get_newsletter_settings (voiceExample surfaced to the admin read).
//   2.  NULL RPC input preserves the current value (omitted field = preserve).
//   3.  '' input CLEARS voice_example + custom tone to NULL.
//   4.  tone precedence fix: after clearing custom tone, settings.tone is NULL so
//       the preset controls; a real custom tone is stored; clearing restores NULL.
//   5.  length backstop: a >12000-char writing example is rejected (friendly).
//   6.  new 12-arg update signature resolves with p_voice_example (no PostgREST
//       overload ambiguity — the old 11-arg signature is gone).
//   7.  non-admin (farm_team) is denied get/update settings.
//   8.  get_newsletter_generation_input returns voiceExample INSIDE its private
//       settings object AND is service_role-only (denied to authenticated + anon).
//   9.  no anon/preview/published payload leaks voiceExample / settings / the
//       writing sample (preview + list_published + get_published).

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
const adminCaller = createClient(url, anonKey, {auth: {autoRefreshToken: false, persistSession: false}});
const teamCaller = createClient(url, anonKey, {auth: {autoRefreshToken: false, persistSession: false}});
const anonCaller = createClient(url, anonKey, {auth: {autoRefreshToken: false, persistSession: false}});

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const stamp = `${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
const VOICE = `__mig189_voice_${stamp} — plain and proud, like a farmer writing to neighbors.`;
const TONE = `__mig189_tone_${stamp}`;
const TONE2 = `__mig189_tone2_${stamp}`;
const ISSUE = {id: `nli-2098-${stamp.slice(-2)}`, ym: '2098-01', slug: `2098-01-${stamp.slice(-4)}`};
const users = {
  admin: {email: `mig189-admin-${stamp}@wcfplanner.test`, password: 'Mig189!AdminProof', id: null, role: 'admin'},
  team: {email: `mig189-team-${stamp}@wcfplanner.test`, password: 'Mig189!TeamProof', id: null, role: 'farm_team'},
};

let original = null; // captured global settings for restore

let checks = 0;
function ok(cond, label, detail) {
  checks += 1;
  if (!cond) throw new Error(`FAIL [${label}]${detail ? `: ${detail}` : ''}`);
  console.log(`ok ${checks}. ${label}`);
}

async function execSql(sql, label) {
  const {error} = await service.rpc('exec_sql', {sql});
  if (error) throw new Error(`${label}: ${error.message || String(error)}`);
}

async function makeUser(u) {
  const created = await service.auth.admin.createUser({email: u.email, password: u.password, email_confirm: true});
  if (created.error) throw new Error(`createUser ${u.role}: ${created.error.message}`);
  u.id = created.data.user.id;
  const prof = await service
    .from('profiles')
    .upsert({id: u.id, email: u.email, full_name: `Mig189 ${u.role}`, role: u.role});
  if (prof.error) throw new Error(`profile ${u.role}: ${prof.error.message}`);
}

async function signIn(client, u) {
  const {error} = await client.auth.signInWithPassword({email: u.email, password: u.password});
  if (error) throw new Error(`signIn ${u.role}: ${error.message}`);
}

// Retry a call while PostgREST is still reloading its schema cache after the
// signature change (DROP old + CREATE new update_newsletter_settings).
async function rpcReady(client, name, params, {tries = 20, delayMs = 1000} = {}) {
  let last;
  for (let i = 0; i < tries; i++) {
    last = await client.rpc(name, params);
    const msg = (last.error && (last.error.message || '')) || '';
    if (last.error && /schema cache|Could not find the function|PGRST202|does not exist/i.test(msg)) {
      await sleep(delayMs);
      continue;
    }
    return last;
  }
  return last;
}

async function setSettings(patch) {
  const res = await adminCaller.rpc('update_newsletter_settings', patch);
  if (res.error) throw new Error(`update_newsletter_settings: ${res.error.message}`);
  return res.data;
}
async function getSettings(client = adminCaller) {
  const res = await client.rpc('get_newsletter_settings');
  return res;
}

async function cleanup() {
  try {
    await service.from('newsletter_issues').delete().eq('id', ISSUE.id);
  } catch (_e) {
    /* best effort */
  }
  // Restore the global settings singleton to exactly what we captured.
  if (original) {
    try {
      await service
        .from('newsletter_settings')
        .update({
          tone: original.tone,
          voice_example: original.voice_example,
          tone_preset: original.tone_preset,
          length_detail: original.length_detail,
          archive_access_token: original.archive_access_token,
          archive_access_expires_at: original.archive_access_expires_at,
        })
        .eq('id', 'singleton');
    } catch (_e) {
      /* best effort */
    }
  }
  for (const u of Object.values(users)) {
    if (!u.id) continue;
    await service.from('profiles').delete().eq('id', u.id);
    await service.auth.admin.deleteUser(u.id);
  }
  await adminCaller.auth.signOut();
  await teamCaller.auth.signOut();
}

(async () => {
  try {
    // ── apply the migration ──────────────────────────────────────────────────
    const migSql = fs.readFileSync(
      path.join(__dirname, '..', 'supabase-migrations', '189_newsletter_voice_example.sql'),
      'utf8',
    );
    await execSql(migSql, 'apply mig 189');
    console.log('mig 189 applied to TEST');

    // Capture the current global settings so cleanup can restore them exactly.
    const cap = await service
      .from('newsletter_settings')
      .select('tone, voice_example, tone_preset, length_detail, archive_access_token, archive_access_expires_at')
      .eq('id', 'singleton')
      .single();
    if (cap.error) throw new Error(`capture settings: ${cap.error.message}`);
    original = cap.data;

    // ── fixtures ─────────────────────────────────────────────────────────────
    await makeUser(users.admin);
    await makeUser(users.team);
    await signIn(adminCaller, users.admin);
    await signIn(teamCaller, users.team);

    // Seed a throwaway DRAFT issue with a working preview link.
    const seed = await service.from('newsletter_issues').insert({
      id: ISSUE.id,
      year_month: ISSUE.ym,
      slug: ISSUE.slug,
      title: `Mig189 proof ${stamp}`,
      status: 'draft',
      period_start: '2098-01-01',
      period_end: '2098-01-31',
      noindex: true,
      preview_token: 'p'.repeat(32),
      preview_enabled: true,
      preview_expires_at: new Date(Date.now() + 30 * 86400000).toISOString(),
      draft_payload: {
        blocks: [
          {type: 'heading', text: 'Mig189 heading'},
          {type: 'paragraph', text: 'Body.'},
        ],
      },
      photo_plan: [],
    });
    if (seed.error) throw new Error(`seed issue: ${seed.error.message}`);

    // 6. new 12-arg signature resolves (schema-cache ready) with p_voice_example.
    const first = await rpcReady(adminCaller, 'update_newsletter_settings', {
      p_voice_example: VOICE,
      p_tone: TONE,
      p_tone_preset: 'celebratory',
    });
    ok(
      !first.error,
      'update_newsletter_settings resolves with p_voice_example (new 12-arg signature)',
      first.error && first.error.message,
    );

    // 1. admin round-trip: voiceExample + custom tone read back.
    let s = (await getSettings()).data;
    ok(s && s.voiceExample === VOICE, 'get_newsletter_settings surfaces the writing example to the admin');
    ok(s && s.tone === TONE, 'custom tone stored + read back');
    ok(s && s.tonePreset === 'celebratory', 'tone preset stored');

    // 2. NULL input preserves (change only tonePreset; omit tone + voice).
    await setSettings({p_tone_preset: 'warm_credible'});
    s = (await getSettings()).data;
    ok(s.voiceExample === VOICE, 'omitted voice_example is preserved (NULL = preserve)');
    ok(s.tone === TONE, 'omitted tone is preserved (NULL = preserve)');
    ok(s.tonePreset === 'warm_credible', 'tone preset updated independently');

    // 4a. clearing custom tone -> NULL so the preset controls resolveTone().
    await setSettings({p_tone: ''});
    s = (await getSettings()).data;
    ok(s.tone === null, 'empty custom tone clears to NULL (preset then controls)', JSON.stringify(s.tone));
    ok(s.voiceExample === VOICE, 'clearing tone did not touch the writing example');

    // 4b. a real custom tone overrides again; clearing restores NULL.
    await setSettings({p_tone: TONE2});
    ok((await getSettings()).data.tone === TONE2, 'a real custom tone is stored (overrides preset)');
    await setSettings({p_tone: ''});
    ok((await getSettings()).data.tone === null, 'clearing custom tone again restores NULL');

    // 3. clearing voice_example -> NULL.
    await setSettings({p_voice_example: ''});
    ok((await getSettings()).data.voiceExample === null, 'empty writing example clears to NULL');
    // re-set it for the generation-input + leak proofs below.
    await setSettings({p_voice_example: VOICE});
    ok((await getSettings()).data.voiceExample === VOICE, 'writing example re-set for downstream proofs');

    // 5. length backstop: >12000 chars rejected (friendly), value unchanged.
    const tooLong = await adminCaller.rpc('update_newsletter_settings', {p_voice_example: 'a'.repeat(12001)});
    ok(
      !!tooLong.error && /NEWSLETTER_VALIDATION/.test(tooLong.error.message),
      'writing example over 12000 chars is rejected',
    );
    ok((await getSettings()).data.voiceExample === VOICE, 'rejected over-length update left the value unchanged');

    // 7. non-admin denial.
    const teamGet = await getSettings(teamCaller);
    ok(
      !!teamGet.error && /admin role required/.test(teamGet.error.message),
      'farm_team denied get_newsletter_settings',
    );
    const teamSet = await teamCaller.rpc('update_newsletter_settings', {p_voice_example: 'nope'});
    ok(
      !!teamSet.error && /admin role required/.test(teamSet.error.message),
      'farm_team denied update_newsletter_settings',
    );

    // 8. generation_input: voiceExample present in the PRIVATE settings object,
    //    service_role-only (denied to authenticated admin + anon).
    const gen = await service.rpc('get_newsletter_generation_input', {p_issue_id: ISSUE.id});
    ok(!gen.error, 'service_role can read get_newsletter_generation_input', gen.error && gen.error.message);
    ok(
      gen.data && gen.data.settings && gen.data.settings.voiceExample === VOICE,
      'generation input carries voiceExample in its private settings',
    );
    const genAdmin = await adminCaller.rpc('get_newsletter_generation_input', {p_issue_id: ISSUE.id});
    ok(!!genAdmin.error, 'authenticated admin is denied get_newsletter_generation_input (service_role only)');
    const genAnon = await anonCaller.rpc('get_newsletter_generation_input', {p_issue_id: ISSUE.id});
    ok(!!genAnon.error, 'anon is denied get_newsletter_generation_input');

    // 9a. preview payload (anon) never leaks voiceExample / settings / the sample.
    const preview = await anonCaller.rpc('get_newsletter_preview', {p_slug: ISSUE.slug, p_token: 'p'.repeat(32)});
    ok(
      !preview.error && preview.data,
      'anon preview renders for a valid draft token',
      preview.error && preview.error.message,
    );
    const previewJson = JSON.stringify(preview.data);
    ok(
      !/voiceExample/.test(previewJson) && !previewJson.includes(VOICE),
      'preview payload has no voiceExample / writing sample',
    );
    ok(!('settings' in (preview.data || {})), 'preview payload exposes no settings object');

    // 9b. publish, then anon list + get_published carry no voiceExample / settings.
    const pub = await adminCaller.rpc('publish_newsletter_issue', {p_id: ISSUE.id});
    ok(!pub.error, 'admin publish succeeds', pub.error && pub.error.message);
    const key = (await getSettings()).data.archiveAccessToken;
    ok(!!key, 'publish minted a fresh archive access key');
    const list = await anonCaller.rpc('list_published_newsletters', {p_key: key});
    ok(!list.error && Array.isArray(list.data), 'anon list_published_newsletters returns with the key');
    const listJson = JSON.stringify(list.data);
    ok(
      !/voiceExample/.test(listJson) && !listJson.includes(VOICE),
      'published list has no voiceExample / writing sample',
    );
    const got = await anonCaller.rpc('get_published_newsletter', {p_slug: ISSUE.slug, p_key: key});
    ok(!got.error && got.data, 'anon get_published_newsletter returns with the key');
    const gotJson = JSON.stringify(got.data);
    ok(
      !/voiceExample/.test(gotJson) && !gotJson.includes(VOICE),
      'published issue payload has no voiceExample / writing sample',
    );
    ok(!('settings' in (got.data || {})), 'published issue payload exposes no settings object');

    console.log(`\nALL ${checks} CHECKS PASSED — mig 189 applied + proven on TEST`);
  } finally {
    try {
      await cleanup();
      console.log('cleanup: complete (issue removed, global settings restored)');
    } catch (e) {
      console.error(`cleanup: INCOMPLETE — ${e && e.message}`);
      process.exitCode = 1;
    }
  }
})().catch((e) => {
  console.error(e && e.message ? e.message : e);
  process.exitCode = 1;
});
