// Admin-only side-effect wrappers for the Tasks Center. Pure helpers belong
// in tasks.js; assignee-side completion wrappers belong in tasksUserApi.js;
// public-webform wrappers belong in tasksPublicApi.js. Keep this module
// admin-surface only so the four-module split (per PROJECT.md §8 plan
// rev 5) stays clean.
//
// C1.1 product-correction: cron-surface wrappers (runCronNow,
// loadCronAuditTail) were removed alongside the operator-facing UI for
// cron runs. The Edge Function and audit table stay intact — admins
// just don't drive them through this module anymore.
//
// C3 added: load/savePublicAssigneeAvailability for the Public Tasks
// availability tile. Roster-side filtering for the Submitted-by dropdown
// goes through teamAvailability.js (forms['tasks-public'].hiddenIds);
// profile-uuid filtering for the Assignee dropdown lives in a separate
// webform_config key — see tasks.js for the canonical key name + shape.

import {
  TASKS_PUBLIC_ASSIGNEE_AVAILABILITY_KEY,
  normalizePublicAssigneeAvailability,
  TASK_REQUEST_PHOTOS_BUCKET,
  TASK_REQUEST_PHOTO_DEFAULT_FILENAME,
  buildTaskRequestPhotoStoragePath,
  buildTaskRequestPhotoDbPath,
  isStorageDuplicateError,
} from './tasks.js';
import {compressImage} from './photoCompress.js';

export async function loadTaskTemplates(sb) {
  const {data, error} = await sb.from('task_templates').select('*').order('title', {ascending: true});
  if (error) throw new Error(`loadTaskTemplates: ${error.message}`);
  return data || [];
}

export async function loadOpenTaskInstances(sb) {
  const {data, error} = await sb
    .from('task_instances')
    .select('*')
    .eq('status', 'open')
    .order('due_date', {ascending: true})
    .order('title', {ascending: true});
  if (error) throw new Error(`loadOpenTaskInstances: ${error.message}`);
  return data || [];
}

export async function upsertTaskTemplate(sb, template) {
  const {data, error} = await sb.from('task_templates').upsert(template).select().single();
  if (error) throw new Error(`upsertTaskTemplate: ${error.message}`);
  return data;
}

export async function deleteTaskTemplate(sb, id) {
  const {error} = await sb.from('task_templates').delete().eq('id', id);
  if (error) throw new Error(`deleteTaskTemplate: ${error.message}`);
}

// ── Public Tasks assignee availability (admin-managed) ──────────────────

export async function loadPublicAssigneeAvailability(sb) {
  const {data: row} = await sb
    .from('webform_config')
    .select('data')
    .eq('key', TASKS_PUBLIC_ASSIGNEE_AVAILABILITY_KEY)
    .maybeSingle();
  return normalizePublicAssigneeAvailability(row && row.data ? row.data : null);
}

/**
 * Persist the public-tasks assignee availability. Read-fresh-then-merge
 * per PROJECT.md §7 line 543 (webform_config jsonb keys must re-fetch
 * before upsert). Local-wins on the full list — matches
 * saveAvailability's per-formKey local-wins philosophy. Single-admin
 * tile usage in practice; if concurrent admins both write here, last
 * writer's snapshot is what persists.
 *
 * Returns the persisted availability.
 */
export async function savePublicAssigneeAvailability(sb, nextAvailability) {
  const local = normalizePublicAssigneeAvailability(nextAvailability);
  // §7 read-fresh-then-write contract: fetch the latest stored row even
  // though local-wins overwrites it. The fetch validates the key path
  // and lets future merge strategies plug in without changing the call
  // site.
  await sb.from('webform_config').select('data').eq('key', TASKS_PUBLIC_ASSIGNEE_AVAILABILITY_KEY).maybeSingle();

  const {error} = await sb
    .from('webform_config')
    .upsert({key: TASKS_PUBLIC_ASSIGNEE_AVAILABILITY_KEY, data: local}, {onConflict: 'key'});
  if (error) throw new Error(`savePublicAssigneeAvailability: write failed: ${error.message}`);
  return local;
}

// ── Task request photos (admin path) ───────────────────────────────────
//
// Admin Tasks Center New Task modal supports ONE optional photo on
// one-time tasks (recurring templates do not — Codex amendment 4).
// Upload is synchronous: the modal's Save handler awaits this before
// calling createOneTimeTaskInstance, and on failure the row is NOT
// inserted (no orphan task pointing at a missing photo). No offline
// queue on the admin side — admin is always authenticated + online.

/**
 * Compress the chosen photo + upload to the task-request-photos bucket
 * at the deterministic '<instanceId>/photo-1.jpg' path. Returns the
 * bucket-prefixed DB path on success.
 *
 * Retry-safety (Codex C2 review supersedes the C3.1b upsert:true
 * approach): the task-request-photos bucket is intentionally append-
 * only — mig 042 grants anon/authenticated INSERT + authenticated
 * SELECT only, no UPDATE. Supabase storage's `upsert:true` requires
 * UPDATE policy, so we keep upsert:false and treat Duplicate / 409 /
 * "already exists" as idempotent success. The bytes from the first
 * attempt stay authoritative; the retry call returns the same
 * canonical dbPath without writing.
 *
 * Why this still satisfies the original C3.1b retry concern: the
 * modal holds a stable oneTimeInstanceId across Save retries, so
 * both attempts hit the SAME deterministic storage path. The first
 * attempt persists; the second attempt's storage error is caught
 * and treated as success; createOneTimeTaskInstance proceeds with
 * the path; the admin sees a clean Save outcome.
 */
export async function uploadTaskRequestPhoto(sb, instanceId, blobOrFile) {
  if (!instanceId) {
    throw new Error('uploadTaskRequestPhoto: instanceId required');
  }
  if (!blobOrFile) {
    throw new Error('uploadTaskRequestPhoto: blobOrFile required');
  }
  const compressed = await compressImage(blobOrFile);
  const filename = TASK_REQUEST_PHOTO_DEFAULT_FILENAME;
  const storagePath = buildTaskRequestPhotoStoragePath(instanceId, filename);
  const dbPath = buildTaskRequestPhotoDbPath(instanceId, filename);
  const {error} = await sb.storage
    .from(TASK_REQUEST_PHOTOS_BUCKET)
    .upload(storagePath, compressed, {contentType: compressed.type || 'image/jpeg', upsert: false});
  if (error && !isStorageDuplicateError(error)) {
    throw new Error(`uploadTaskRequestPhoto: ${error.message || String(error)}`);
  }
  return dbPath;
}

// (getRequestPhotoSignedUrl moved to tasksUserApi.js per Codex C2
// amendment 3. Both admin and assignee surfaces read request photos
// via that single helper. AdminTasksView imports it from
// tasksUserApi.js.)

// One-time admin-created task instance. Inserts directly into task_instances
// with template_id=null and submission_source='admin_manual'. Existing admin
// RLS already covers admin INSERT; no migration needed for this path.
//
// Caller mints a stable id (the modal holds it across Save retries) so a
// retry on a network blip doesn't double-insert. If the first INSERT did
// land and the second attempt arrives with the same id, Postgres raises
// 23505 unique_violation on the PK; we treat that as "already created"
// and SELECT the row back instead of failing the user.
export async function createOneTimeTaskInstance(sb, payload) {
  const {data, error} = await sb.from('task_instances').insert(payload).select().single();
  if (!error) return data;
  if (error.code === '23505' && payload && payload.id) {
    const {data: existing, error: selErr} = await sb
      .from('task_instances')
      .select('*')
      .eq('id', payload.id)
      .maybeSingle();
    if (selErr) throw new Error(`createOneTimeTaskInstance replay select: ${selErr.message}`);
    if (existing) return existing;
  }
  throw new Error(`createOneTimeTaskInstance: ${error.message}`);
}
