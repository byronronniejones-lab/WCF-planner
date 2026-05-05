// Pure helpers for the Tasks module. NO React, NO supabase, NO side effects.
// Side-effect wrappers live in tasksAdminApi.js / tasksUserApi.js / tasksPublicApi.js.

// Mig 039 task_templates.recurrence CHECK enum (mig 036 minus the 'quarterly'
// addition that landed in 039). Keep order matching the spec — the admin
// dropdown renders them in this order, and 'once' is the safest default.
export const RECURRENCE_OPTIONS = ['once', 'daily', 'weekly', 'biweekly', 'monthly', 'quarterly'];

// Filter predicate for the admin "open task instances" list. Mirrors the
// status state machine from mig 036 (open → completed; reopen path TBD in
// later checkpoints).
export function isOpenTaskInstance(ti) {
  return !!(ti && ti.status === 'open');
}

// ── Public tasks webform — assignee availability ──────────────────────────
// Storage: webform_config.tasks_public_assignee_availability
// Shape:   {hiddenProfileIds: [<profile uuid>, ...]}
//
// Roster IDs (gated via team_availability.forms['tasks-public'].hiddenIds)
// and profile UUIDs (gated here) MUST NOT mix in the same hiddenIds array.
// Submitted-by is a roster display name; assignee is a profiles.id uuid.

export const TASKS_PUBLIC_ASSIGNEE_AVAILABILITY_KEY = 'tasks_public_assignee_availability';

// ── Task request photos (C3.1b) ───────────────────────────────────────────
// Bucket name + path-shape helpers shared by both the public form
// (anon upload) and the admin Tasks Center (authenticated upload).
// One photo max per request; deterministic filename so a queued/replay
// upload to the same storage path is idempotent.

export const TASK_REQUEST_PHOTOS_BUCKET = 'task-request-photos';

// Default filename for the single photo allowed per task. Deterministic
// so the offline-replay path can re-upload without minting a new name.
// (Storage's INSERT semantics treat the same path as an upsert when
// upsert:true is passed; we rely on that for replay safety.)
export const TASK_REQUEST_PHOTO_DEFAULT_FILENAME = 'photo-1.jpg';

/**
 * Storage upload arg (no bucket prefix). Caller passes this to
 * supabase.storage.from(TASK_REQUEST_PHOTOS_BUCKET).upload(<path>, blob).
 */
export function buildTaskRequestPhotoStoragePath(instanceId, filename) {
  if (typeof instanceId !== 'string' || !instanceId) {
    throw new Error('buildTaskRequestPhotoStoragePath: instanceId required');
  }
  const fname = filename || TASK_REQUEST_PHOTO_DEFAULT_FILENAME;
  return `${instanceId}/${fname}`;
}

/**
 * DB column value (with bucket prefix). Stored on
 * task_instances.request_photo_path. The mig 042 RPC validates against
 * `task-request-photos/<id>/` prefix exactly.
 */
export function buildTaskRequestPhotoDbPath(instanceId, filename) {
  return `${TASK_REQUEST_PHOTOS_BUCKET}/${buildTaskRequestPhotoStoragePath(instanceId, filename)}`;
}

/**
 * Strip the bucket prefix off a DB-stored path so the result is the
 * storage upload arg. Used by the admin signed-URL flow:
 *   const storagePath = stripTaskRequestPhotoBucket(ti.request_photo_path);
 *   supabase.storage.from(BUCKET).createSignedUrl(storagePath, ttl);
 * Returns null if the path is missing or doesn't start with the bucket
 * prefix (orphan / malformed value).
 */
export function stripTaskRequestPhotoBucket(dbPath) {
  if (typeof dbPath !== 'string' || !dbPath) return null;
  const prefix = `${TASK_REQUEST_PHOTOS_BUCKET}/`;
  if (!dbPath.startsWith(prefix)) return null;
  return dbPath.slice(prefix.length);
}

// ── Task completion photos (C2) ──────────────────────────────────────────
// Bucket name + path-shape helpers for the assignee-uploaded photo at
// task completion time. Separate bucket from task-request-photos
// (request photos go in upstream during submit; completion photos go
// in here at the end of the task lifecycle). The shape is locked by
// mig 038's bucket policy + mig 040's complete_task_instance RPC
// validation:
//
//   storage upload arg:  '<assignee_uid>/<instance_id>/<filename>'
//   DB column value:     'task-photos/<assignee_uid>/<instance_id>/<filename>'
//
// CRITICAL: the prefix uses the row's assignee_profile_id, NOT the
// completer's auth.uid(). When admin completes someone else's task,
// the path still goes under the assignee's directory (Codex C3
// amendment 5). Callers MUST pass `ti.assignee_profile_id`, not the
// current user's id.

export const TASK_PHOTOS_BUCKET = 'task-photos';
export const TASK_COMPLETION_PHOTO_DEFAULT_FILENAME = 'completion-1.jpg';

export function buildCompletionPhotoStoragePath(assigneeUid, instanceId, filename) {
  if (typeof assigneeUid !== 'string' || !assigneeUid) {
    throw new Error('buildCompletionPhotoStoragePath: assigneeUid required');
  }
  if (typeof instanceId !== 'string' || !instanceId) {
    throw new Error('buildCompletionPhotoStoragePath: instanceId required');
  }
  const fname = filename || TASK_COMPLETION_PHOTO_DEFAULT_FILENAME;
  return `${assigneeUid}/${instanceId}/${fname}`;
}

export function buildCompletionPhotoDbPath(assigneeUid, instanceId, filename) {
  return `${TASK_PHOTOS_BUCKET}/${buildCompletionPhotoStoragePath(assigneeUid, instanceId, filename)}`;
}

export function stripCompletionPhotoBucket(dbPath) {
  if (typeof dbPath !== 'string' || !dbPath) return null;
  const prefix = `${TASK_PHOTOS_BUCKET}/`;
  if (!dbPath.startsWith(prefix)) return null;
  return dbPath.slice(prefix.length);
}

// ── Storage retry-safety: duplicate-as-success ──────────────────────────
// task-photos and task-request-photos are intentionally append-only —
// neither bucket has a storage.objects UPDATE policy, so `upsert:true`
// would fail at the policy layer (Supabase docs:
// https://supabase.com/docs/guides/storage/security/access-control —
// upsert needs SELECT + UPDATE). Codex C2 review caught this and
// chose the alternative: keep buckets append-only, use upsert:false,
// and treat the deterministic-path "Duplicate / 409 / already exists"
// response as idempotent success. The bytes that landed first stay
// authoritative; the retry call's caller proceeds with the canonical
// dbPath as if the upload had just succeeded.
//
// Recognizes the storage error shape across SDK + raw HTTP variants.
export function isStorageDuplicateError(err) {
  if (!err) return false;
  // SDK surfaces statusCode as '409' or 409 depending on transport.
  if (err.statusCode === '409' || err.statusCode === 409) return true;
  // Some shapes carry .error: 'Duplicate'.
  if (typeof err.error === 'string' && err.error.toLowerCase() === 'duplicate') return true;
  // Defensive: .name = 'Duplicate' on certain SDK error wrappers.
  if (typeof err.name === 'string' && err.name.toLowerCase() === 'duplicate') return true;
  // Fallback: message text. Storage HTTP body is "The resource already
  // exists"; SDK wrappers usually pass that through.
  if (typeof err.message === 'string' && /already exists/i.test(err.message)) return true;
  return false;
}

/**
 * Coerce any input into the canonical `{hiddenProfileIds: []}` shape.
 * Garbage / null / arrays / wrong types collapse to an empty list. The
 * `hiddenProfileIds` array is filtered to non-empty strings and de-
 * duplicated. Order is preserved otherwise.
 */
export function normalizePublicAssigneeAvailability(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return {hiddenProfileIds: []};
  }
  const ids = Array.isArray(raw.hiddenProfileIds) ? raw.hiddenProfileIds : [];
  const cleaned = ids.filter((id) => typeof id === 'string' && id.length > 0);
  return {hiddenProfileIds: Array.from(new Set(cleaned))};
}

/**
 * Predicate: is the given profile id currently hidden from the public
 * assignee dropdown? Orphan ids (in hiddenProfileIds but not in any
 * profiles row) are tolerated — they have no effect on visible profiles.
 */
export function isPublicAssigneeHidden(profileId, availability) {
  if (typeof profileId !== 'string' || !profileId) return false;
  const norm = normalizePublicAssigneeAvailability(availability);
  return norm.hiddenProfileIds.includes(profileId);
}

/**
 * Toggle a profile id's hidden state. Immutable update; returns a fresh
 * canonical-shape object. Idempotent on re-toggle to the same state.
 */
export function setPublicAssigneeHidden(availability, profileId, hidden) {
  if (typeof profileId !== 'string' || !profileId) {
    throw new Error('setPublicAssigneeHidden: profileId required');
  }
  const norm = normalizePublicAssigneeAvailability(availability);
  const cur = new Set(norm.hiddenProfileIds);
  if (hidden) cur.add(profileId);
  else cur.delete(profileId);
  return {hiddenProfileIds: Array.from(cur)};
}

/**
 * Apply the assignee availability filter to a list of profiles. Each
 * profile must have an `id` field; the rest is opaque pass-through. The
 * input shape isn't normalized (callers usually pre-filter to active
 * users), but orphan-id tolerance means an unknown id in hiddenProfileIds
 * is a no-op.
 */
export function visiblePublicAssignees(profiles, availability) {
  const list = Array.isArray(profiles) ? profiles : [];
  const norm = normalizePublicAssigneeAvailability(availability);
  if (norm.hiddenProfileIds.length === 0) return list.slice();
  const hidden = new Set(norm.hiddenProfileIds);
  return list.filter((p) => p && p.id && !hidden.has(p.id));
}
