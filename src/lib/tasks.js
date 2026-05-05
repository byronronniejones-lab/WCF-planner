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
