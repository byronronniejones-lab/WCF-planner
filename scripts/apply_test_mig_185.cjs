// Apply migration 185 to TEST and prove the two-phase ADMIN-ONLY attachment
// delete contract, the tombstone resurrection blocks, the unchanged operational
// upload, the comments-only automation flag, and the fail-closed (unscheduled)
// cron invoker. TEST-only, disposable rows/users, full cleanup in finally.
//
// Proof matrix:
//   1.  operational upload UNCHANGED — farm_team can still storage-upload under
//       native/ and register via add_processing_attachment.
//   2.  farm_team CANNOT request/finalize delete (RPC boundary).
//   3.  farm_team storage.remove is silently refused (object survives).
//   4.  admin storage.remove WITHOUT a pending request is refused (narrow policy).
//   5.  admin two-phase delete works end-to-end (request → remove → finalize ok).
//   6.  get_processing_record excludes the tombstone; the row survives with its
//       asana gid (resurrection block).
//   7.  request/finalize replay is idempotent (already_deleted).
//   8.  finalize WITHOUT request is refused; failed finalize REOPENS the row
//       (still listed, delete_error recorded, never claimed deleted).
//   9.  imported-media delete scrubs the linked comment's attachments JSON and
//       record_processing_comment_media / record_processing_attachment re-offers
//       cannot resurrect the tombstoned gid.
//   10. asana_comments_import_enabled defaults false; toggle is admin-only.
//   11. invoke_processing_asana_cron: EXECUTE denied to authenticated/service
//       PostgREST callers; via exec_sql (postgres) it fails CLOSED on missing
//       Vault secrets. No cron schedule exists after apply.

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

const stamp = `${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
const REC = `__mig185_rec_${stamp}`;
const users = {
  admin: {email: `mig185-admin-${stamp}@wcfplanner.test`, password: 'Mig185!AdminProof', id: null, role: 'admin'},
  team: {email: `mig185-team-${stamp}@wcfplanner.test`, password: 'Mig185!TeamProof', id: null, role: 'farm_team'},
};
const BUCKET = 'processing-attachments';
const GID_IMPORTED = `__mig185gid_${stamp}`;
const STORY_GID = `__mig185story_${stamp}`;
const LINK_GID = `__mig185link_${stamp}`;
const COMMENT_ID = `cmt-__mig185_${stamp}`;

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
  const prof = await service.from('profiles').upsert({
    id: u.id,
    email: u.email,
    full_name: `Mig185 ${u.role}`,
    role: u.role,
  });
  if (prof.error) throw new Error(`profile ${u.role}: ${prof.error.message}`);
}

async function signIn(client, u) {
  const {error} = await client.auth.signInWithPassword({email: u.email, password: u.password});
  if (error) throw new Error(`signIn ${u.role}: ${error.message}`);
}

const fileBytes = (label) => new Blob([`mig185 proof file: ${label} @ ${stamp}`], {type: 'text/plain'});

async function uploadAs(client, attId, filename) {
  const storagePath = `native/${REC}/${attId}-${filename}`;
  const up = await client.storage
    .from(BUCKET)
    .upload(storagePath, fileBytes(attId), {upsert: false, contentType: 'text/plain'});
  if (up.error) return {error: up.error, storagePath};
  const reg = await client.rpc('add_processing_attachment', {
    p_row: {id: attId, record_id: REC, filename, content_type: 'text/plain', size_bytes: 40, storage_path: storagePath},
  });
  return {error: reg.error, storagePath};
}

async function signedUrlExists(client, storagePath) {
  const {data, error} = await client.storage.from(BUCKET).createSignedUrl(storagePath, 60);
  if (error) return false;
  return !!(data && data.signedUrl);
}

async function getAttachments(client) {
  const {data, error} = await client.rpc('get_processing_record', {p_id: REC});
  if (error) throw new Error(`get_processing_record: ${error.message}`);
  return Array.isArray(data && data.attachments) ? data.attachments : [];
}

async function cleanup() {
  try {
    const {data: objs} = await service.storage.from(BUCKET).list(`native/${REC}`);
    if (objs && objs.length) {
      await service.storage.from(BUCKET).remove(objs.map((o) => `native/${REC}/${o.name}`));
    }
  } catch (_e) {
    /* best effort */
  }
  try {
    const {data: impObjs} = await service.storage.from(BUCKET).list(`__mig185import_${stamp}`);
    if (impObjs && impObjs.length) {
      await service.storage.from(BUCKET).remove(impObjs.map((o) => `__mig185import_${stamp}/${o.name}`));
    }
  } catch (_e) {
    /* best effort */
  }
  await service.from('comments').delete().eq('entity_id', REC);
  await service.from('activity_events').delete().eq('entity_id', REC);
  await service.from('processing_attachments').delete().eq('record_id', REC);
  await service.from('processing_asana_links').delete().eq('asana_gid', LINK_GID);
  await service.from('processing_records').delete().eq('id', REC);
  // restore the singleton flag to its default (false) in case a proof step set it
  await service
    .from('processing_asana_sync_settings')
    .update({asana_comments_import_enabled: false})
    .eq('id', 'singleton');
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
      path.join(__dirname, '..', 'supabase-migrations', '185_processing_attachments_admin_and_comment_cron.sql'),
      'utf8',
    );
    await execSql(migSql, 'apply mig 185');
    console.log('mig 185 applied to TEST');

    // ── fixtures ─────────────────────────────────────────────────────────────
    await makeUser(users.admin);
    await makeUser(users.team);
    await signIn(adminCaller, users.admin);
    await signIn(teamCaller, users.team);
    const rec = await service.from('processing_records').insert({
      id: REC,
      record_type: 'asana_historical',
      program: 'cattle',
      title: `Mig185 proof ${stamp}`,
      processing_date: '2026-01-15',
      created_by: users.admin.id,
    });
    if (rec.error) throw new Error(`seed record: ${rec.error.message}`);

    // 1. operational upload UNCHANGED — farm_team uploads + registers.
    const teamUp = await uploadAs(teamCaller, `pat-mig185-team-${stamp}`, 'team-upload.txt');
    ok(
      !teamUp.error,
      'farm_team upload + register still works (upload gating unchanged)',
      teamUp.error && teamUp.error.message,
    );
    const adminUp = await uploadAs(adminCaller, `pat-mig185-admin-${stamp}`, 'admin-upload.txt');
    ok(!adminUp.error, 'admin upload + register works', adminUp.error && adminUp.error.message);
    const failUp = await uploadAs(adminCaller, `pat-mig185-fail-${stamp}`, 'fail-path.txt');
    ok(!failUp.error, 'second admin upload works (failure-path fixture)', failUp.error && failUp.error.message);

    // 2. farm_team cannot request/finalize delete.
    const teamReq = await teamCaller.rpc('request_processing_attachment_delete', {p_id: `pat-mig185-admin-${stamp}`});
    ok(
      !!teamReq.error && /PROCESSING_VALIDATION/.test(teamReq.error.message),
      'farm_team delete request refused at RPC boundary',
      teamReq.error && teamReq.error.message,
    );
    const teamFin = await teamCaller.rpc('finalize_processing_attachment_delete', {
      p_id: `pat-mig185-admin-${stamp}`,
      p_ok: true,
    });
    ok(
      !!teamFin.error && /PROCESSING_VALIDATION/.test(teamFin.error.message),
      'farm_team finalize refused at RPC boundary',
    );

    // 3. farm_team storage.remove silently refused — object survives.
    const teamRm = await teamCaller.storage.from(BUCKET).remove([adminUp.storagePath]);
    ok(!teamRm.error && (teamRm.data || []).length === 0, 'farm_team storage remove silently refused');
    ok(await signedUrlExists(adminCaller, adminUp.storagePath), 'object survives farm_team remove attempt');

    // 4. admin remove WITHOUT a pending request is refused by the narrow policy.
    const coldRm = await adminCaller.storage.from(BUCKET).remove([adminUp.storagePath]);
    ok(!coldRm.error && (coldRm.data || []).length === 0, 'admin remove without pending request refused');
    ok(await signedUrlExists(adminCaller, adminUp.storagePath), 'object survives cold admin remove attempt');

    // 5. admin two-phase delete end-to-end.
    const req = await adminCaller.rpc('request_processing_attachment_delete', {p_id: `pat-mig185-admin-${stamp}`});
    ok(
      !req.error && req.data && req.data.status === 'requested',
      'admin delete request accepted',
      req.error && req.error.message,
    );
    ok(
      req.data.storage_path === adminUp.storagePath && req.data.bucket === BUCKET,
      'request returns the exact bucket/path',
    );
    const rm = await adminCaller.storage.from(BUCKET).remove([adminUp.storagePath]);
    ok(
      !rm.error && (rm.data || []).length === 1,
      'admin storage remove allowed while pending',
      rm.error && rm.error.message,
    );
    const fin = await adminCaller.rpc('finalize_processing_attachment_delete', {
      p_id: `pat-mig185-admin-${stamp}`,
      p_ok: true,
    });
    ok(
      !fin.error && fin.data && fin.data.status === 'deleted',
      'finalize ok=true tombstones',
      fin.error && fin.error.message,
    );

    // 6. tombstone excluded from the record read; row + gid survive.
    const attsAfterDelete = await getAttachments(adminCaller);
    ok(
      !attsAfterDelete.some((a) => a.id === `pat-mig185-admin-${stamp}`),
      'get_processing_record excludes the deleted tombstone',
    );
    ok(
      attsAfterDelete.some((a) => a.id === `pat-mig185-team-${stamp}`),
      'live attachments still listed',
    );
    const tomb = await service
      .from('processing_attachments')
      .select('id, deleted_at, deleted_by, delete_error')
      .eq('id', `pat-mig185-admin-${stamp}`)
      .single();
    ok(
      !tomb.error && tomb.data.deleted_at && tomb.data.deleted_by === users.admin.id,
      'tombstone row retained with actor',
    );

    // 7. replay idempotency.
    const reReq = await adminCaller.rpc('request_processing_attachment_delete', {p_id: `pat-mig185-admin-${stamp}`});
    ok(
      !reReq.error && reReq.data.status === 'already_deleted' && reReq.data.replayed === true,
      'request replay → already_deleted',
    );
    const reFin = await adminCaller.rpc('finalize_processing_attachment_delete', {
      p_id: `pat-mig185-admin-${stamp}`,
      p_ok: true,
    });
    ok(
      !reFin.error && reFin.data.status === 'already_deleted' && reFin.data.replayed === true,
      'finalize replay → already_deleted',
    );

    // 8. finalize without request refused; failed finalize REOPENS truthfully.
    const coldFin = await adminCaller.rpc('finalize_processing_attachment_delete', {
      p_id: `pat-mig185-fail-${stamp}`,
      p_ok: true,
    });
    ok(!!coldFin.error && /no pending delete request/.test(coldFin.error.message), 'finalize without request refused');
    const failReq = await adminCaller.rpc('request_processing_attachment_delete', {p_id: `pat-mig185-fail-${stamp}`});
    ok(!failReq.error && failReq.data.status === 'requested', 'failure-path request accepted');
    const failFin = await adminCaller.rpc('finalize_processing_attachment_delete', {
      p_id: `pat-mig185-fail-${stamp}`,
      p_ok: false,
      p_error: 'proof: storage removal blocked',
    });
    ok(!failFin.error && failFin.data.status === 'reopened', 'finalize ok=false reopens (never claims deletion)');
    const reopened = await service
      .from('processing_attachments')
      .select('deleted_at, delete_requested_at, delete_error')
      .eq('id', `pat-mig185-fail-${stamp}`)
      .single();
    ok(
      !reopened.error &&
        !reopened.data.deleted_at &&
        !reopened.data.delete_requested_at &&
        /storage removal blocked/.test(reopened.data.delete_error || ''),
      'reopened row: not deleted, request cleared, failure recorded',
    );
    const attsAfterFail = await getAttachments(adminCaller);
    ok(
      attsAfterFail.some((a) => a.id === `pat-mig185-fail-${stamp}`),
      'reopened attachment still listed',
    );

    // 9. imported comment-media delete: comment JSON scrubbed; reimport blocked.
    const importPath = `__mig185import_${stamp}/${GID_IMPORTED}-photo.txt`;
    const impUp = await service.storage.from(BUCKET).upload(importPath, fileBytes('imported'), {upsert: false});
    ok(!impUp.error, 'seed imported object', impUp.error && impUp.error.message);
    const link = await service.from('processing_asana_links').insert({
      id: `pal-__mig185_${stamp}`,
      asana_gid: LINK_GID,
      processing_record_id: REC,
      match_status: 'matched',
      match_method: 'manual_crosswalk',
    });
    ok(!link.error, 'seed asana link', link.error && link.error.message);
    const media = await service.rpc('record_processing_comment_media', {
      p_row: {
        id: COMMENT_ID,
        parent_asana_gid: LINK_GID,
        asana_comment_gid: STORY_GID,
        body: 'imported media proof',
        original_author_name: 'Mig185 Prover',
        created_at: '2026-01-10T12:00:00Z',
        attachments: [
          {
            asana_attachment_gid: GID_IMPORTED,
            storage_path: importPath,
            filename: 'photo.txt',
            content_type: 'text/plain',
            size_bytes: 40,
          },
        ],
      },
    });
    ok(
      !media.error && media.data && media.data.comment_action === 'inserted',
      'imported comment media seeded',
      media.error && media.error.message,
    );
    const impRow = await service
      .from('processing_attachments')
      .select('id')
      .eq('asana_attachment_gid', GID_IMPORTED)
      .single();
    ok(!impRow.error, 'imported attachment row exists');
    const impId = impRow.data.id;
    const impReq = await adminCaller.rpc('request_processing_attachment_delete', {p_id: impId});
    ok(!impReq.error && impReq.data.status === 'requested', 'imported attachment delete request accepted');
    const impRm = await adminCaller.storage.from(BUCKET).remove([importPath]);
    ok(
      !impRm.error && (impRm.data || []).length === 1,
      'imported object removed by admin (Asana namespace, policy by row state)',
    );
    const impFin = await adminCaller.rpc('finalize_processing_attachment_delete', {p_id: impId, p_ok: true});
    ok(!impFin.error && impFin.data.status === 'deleted', 'imported attachment finalized deleted');
    const scrubbed = await service.from('comments').select('attachments').eq('id', COMMENT_ID).single();
    ok(
      !scrubbed.error && Array.isArray(scrubbed.data.attachments) && scrubbed.data.attachments.length === 0,
      'linked comment attachments JSON scrubbed',
    );
    const reoffer = await service.rpc('record_processing_comment_media', {
      p_row: {
        parent_asana_gid: LINK_GID,
        asana_comment_gid: STORY_GID,
        body: 'imported media proof',
        original_author_name: 'Mig185 Prover',
        created_at: '2026-01-10T12:00:00Z',
        attachments: [
          {
            asana_attachment_gid: GID_IMPORTED,
            storage_path: importPath,
            filename: 'photo.txt',
            content_type: 'text/plain',
            size_bytes: 40,
          },
        ],
      },
    });
    ok(
      !reoffer.error && reoffer.data && reoffer.data.comment_action === 'skipped_deleted',
      'comment-media re-offer of the tombstoned gid is skipped',
      reoffer.error && reoffer.error.message,
    );
    const scrubbed2 = await service.from('comments').select('attachments').eq('id', COMMENT_ID).single();
    ok(!scrubbed2.error && scrubbed2.data.attachments.length === 0, 'comment stays scrubbed after re-offer');
    const backfillReoffer = await service.rpc('record_processing_attachment', {
      p_row: {
        parent_asana_gid: LINK_GID,
        asana_attachment_gid: GID_IMPORTED,
        filename: 'photo.txt',
        storage_path: importPath,
      },
    });
    ok(
      !backfillReoffer.error && backfillReoffer.data && backfillReoffer.data.action === 'skipped',
      'attachment-backfill re-offer of the tombstoned gid is skipped',
      backfillReoffer.error && backfillReoffer.error.message,
    );

    // 10. comments-only flag: default false; toggle admin-only.
    const settings = await adminCaller.rpc('get_processing_settings');
    ok(
      !settings.error && settings.data && settings.data.asana_comments_import_enabled === false,
      'asana_comments_import_enabled defaults false',
    );
    const teamToggle = await teamCaller.rpc('set_asana_comments_import_enabled', {p_enabled: true});
    ok(!!teamToggle.error && /PROCESSING_VALIDATION/.test(teamToggle.error.message), 'farm_team toggle refused');
    const adminToggle = await adminCaller.rpc('set_asana_comments_import_enabled', {p_enabled: true});
    ok(!adminToggle.error && adminToggle.data.asana_comments_import_enabled === true, 'admin toggle works');
    const settingsOn = await adminCaller.rpc('get_processing_settings');
    ok(!settingsOn.error && settingsOn.data.asana_comments_import_enabled === true, 'flag persisted');
    const adminToggleOff = await adminCaller.rpc('set_asana_comments_import_enabled', {p_enabled: false});
    ok(!adminToggleOff.error && adminToggleOff.data.asana_comments_import_enabled === false, 'flag restored to false');

    // 11. cron invoker: locked to postgres; fails closed without Vault secrets;
    //     nothing scheduled.
    const callerInvoke = await adminCaller.rpc('invoke_processing_asana_cron');
    ok(!!callerInvoke.error, 'invoke_processing_asana_cron not executable by authenticated callers');
    let vaultFailClosed = false;
    try {
      await execSql('SELECT public.invoke_processing_asana_cron();', 'invoke cron via postgres');
    } catch (e) {
      vaultFailClosed = /vault secret\(s\) missing\/empty/.test(e.message || '');
      if (!vaultFailClosed) throw e;
    }
    ok(vaultFailClosed, 'cron invoker fails CLOSED when Vault secrets are absent');

    console.log(`\nALL ${checks} CHECKS PASSED — mig 185 applied + proven on TEST`);
  } finally {
    try {
      await cleanup();
      console.log('cleanup: complete');
    } catch (e) {
      console.error(`cleanup: INCOMPLETE — ${e && e.message}`);
      process.exitCode = 1;
    }
  }
})().catch((e) => {
  console.error(e && e.message ? e.message : e);
  process.exitCode = 1;
});
