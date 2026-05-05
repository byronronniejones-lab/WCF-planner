// Logged-in / assignee-side side-effect wrappers for /my-tasks (C2).
// Pure helpers belong in tasks.js; admin-only-config wrappers belong
// in tasksAdminApi.js; public-webform wrappers belong in
// tasksPublicApi.js.
//
// This module also owns the signed-URL helpers for both task-photos
// (completion) and task-request-photos (submit-time) since BOTH are
// authenticated reads — admin and assignee surfaces alike. Codex C2
// amendment 3: MyTasksView must not import from tasksAdminApi, so
// the request-photo signed-URL helper lives here and the admin view
// imports it from this module.

import {
  TASK_PHOTOS_BUCKET,
  TASK_COMPLETION_PHOTO_DEFAULT_FILENAME,
  TASK_REQUEST_PHOTOS_BUCKET,
  buildCompletionPhotoStoragePath,
  buildCompletionPhotoDbPath,
  stripCompletionPhotoBucket,
  stripTaskRequestPhotoBucket,
  isStorageDuplicateError,
} from './tasks.js';
import {compressImage} from './photoCompress.js';

/**
 * Read open task_instances assigned to the current authenticated
 * user. The assignee_self_select RLS policy from mig 037 lets the
 * caller see their own rows; the SELECT is a plain anon-context
 * query — no SECDEF needed because RLS already gates it. Sort by
 * due_date ascending so soonest-first.
 */
export async function loadOpenTasksForAssignee(sb, assigneeProfileId) {
  if (!assigneeProfileId) return [];
  const {data, error} = await sb
    .from('task_instances')
    .select('*')
    .eq('assignee_profile_id', assigneeProfileId)
    .eq('status', 'open')
    .order('due_date', {ascending: true})
    .order('title', {ascending: true});
  if (error) throw new Error(`loadOpenTasksForAssignee: ${error.message}`);
  return data || [];
}

/**
 * Compress + upload a completion photo to the task-photos bucket at
 * the canonical '<assigneeUid>/<instanceId>/completion-1.jpg' path.
 * Returns the bucket-prefixed DB path on success.
 *
 * Retry-safety (Codex C2 review): the task-photos bucket is
 * intentionally append-only — mig 038 grants authenticated INSERT +
 * SELECT only, no UPDATE. Supabase storage's `upsert:true` requires
 * UPDATE policy to overwrite, so we keep upsert:false here and treat
 * a Duplicate / 409 / "already exists" response as idempotent
 * success: the bytes that landed first stay authoritative, and we
 * return the same deterministic dbPath as if this attempt had been
 * the original. Mirrors the storage SDK behavior across both the
 * sb.storage.from(...).upload SDK call and a raw HTTP call.
 *
 * IMPORTANT: caller MUST pass the ROW's assignee_profile_id, not the
 * current user's auth.uid(). The RPC's path-shape validation uses
 * the row assignee — admin completing someone else's task still
 * writes to the assignee's directory (Codex C3 amendment 5).
 */
export async function uploadCompletionPhoto(sb, assigneeUid, instanceId, blobOrFile) {
  if (!assigneeUid) {
    throw new Error('uploadCompletionPhoto: assigneeUid required');
  }
  if (!instanceId) {
    throw new Error('uploadCompletionPhoto: instanceId required');
  }
  if (!blobOrFile) {
    throw new Error('uploadCompletionPhoto: blobOrFile required');
  }
  const compressed = await compressImage(blobOrFile);
  const filename = TASK_COMPLETION_PHOTO_DEFAULT_FILENAME;
  const storagePath = buildCompletionPhotoStoragePath(assigneeUid, instanceId, filename);
  const dbPath = buildCompletionPhotoDbPath(assigneeUid, instanceId, filename);
  const {error} = await sb.storage
    .from(TASK_PHOTOS_BUCKET)
    .upload(storagePath, compressed, {contentType: compressed.type || 'image/jpeg', upsert: false});
  if (error && !isStorageDuplicateError(error)) {
    throw new Error(`uploadCompletionPhoto: ${error.message || String(error)}`);
  }
  return dbPath;
}

/**
 * Mark a task instance complete. Wraps the SECDEF
 * complete_task_instance RPC (mig 040). The RPC validates:
 *   - caller is auth.uid() of assignee OR an admin (is_admin())
 *   - completion_photo_path (when present) matches
 *     'task-photos/<row.assignee_profile_id>/<id>/<filename>'
 * Returns {ok, idempotent_replay, instance_id, completed_at,
 *          completed_by_profile_id, completion_photo_path}.
 */
export async function completeTaskInstance(sb, instanceId, completionPhotoDbPath) {
  const {data, error} = await sb.rpc('complete_task_instance', {
    p_instance_id: instanceId,
    p_completion_photo_path: completionPhotoDbPath || null,
  });
  if (error) {
    throw new Error(`completeTaskInstance: ${error.message || String(error)}`);
  }
  return data;
}

/**
 * Generate a short-lived signed URL for an authenticated user (admin
 * OR assignee) to view a request photo uploaded at submit time. Lazy:
 * callers fetch this on click, not eagerly per row. Returns null for
 * missing or wrong-bucket paths.
 *
 * Moved from tasksAdminApi.js per Codex C2 amendment 3 — request
 * photos are read by both admin and assignee surfaces; the helper
 * belongs on the user side. AdminTasksView imports from here.
 */
export async function getRequestPhotoSignedUrl(sb, dbPath, ttlSeconds = 600) {
  const storagePath = stripTaskRequestPhotoBucket(dbPath);
  if (!storagePath) return null;
  const {data, error} = await sb.storage.from(TASK_REQUEST_PHOTOS_BUCKET).createSignedUrl(storagePath, ttlSeconds);
  if (error) {
    throw new Error(`getRequestPhotoSignedUrl: ${error.message || String(error)}`);
  }
  return data && data.signedUrl ? data.signedUrl : null;
}

/**
 * Same shape as getRequestPhotoSignedUrl but for the task-photos
 * bucket (completion photos). Used by future surfaces that show
 * completion photos to admins or assignees post-completion.
 */
export async function getCompletionPhotoSignedUrl(sb, dbPath, ttlSeconds = 600) {
  const storagePath = stripCompletionPhotoBucket(dbPath);
  if (!storagePath) return null;
  const {data, error} = await sb.storage.from(TASK_PHOTOS_BUCKET).createSignedUrl(storagePath, ttlSeconds);
  if (error) {
    throw new Error(`getCompletionPhotoSignedUrl: ${error.message || String(error)}`);
  }
  return data && data.signedUrl ? data.signedUrl : null;
}
