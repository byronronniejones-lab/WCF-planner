// IndexedDB-backed offline queue for webform submissions and photo blobs.
// Wraps `idb` with the minimum surface the useOfflineSubmit hook needs:
// enqueue, list-by-status, mark-sync-result, retry, discard.
//
// Stores:
//   - submissions: queued webform rows. Key = client_submission_id (text).
//   - photo_blobs: photo bytes for hasPhotos form-kinds. Schema declared in
//                  Phase 1B; writes wired in Phase 1D-A. Key = the
//                  deterministic bucket path including the .jpg suffix
//                  (`${form_kind}/${client_submission_id}/${photo_key}.jpg`)
//                  so the IDB key matches the storage object's key 1:1 —
//                  no transform needed at upload time.
//
// Status flow:
//   queued    → ready for the next sync attempt
//   syncing   → an attempt is in flight (lock against double-fire from
//               online event + 60s tick + manual button overlapping)
//   failed    → 3 retries exhausted; surfaces in the StuckSubmissions modal
//   (synced rows are deleted from the store, not retained — auditability
//    lives in Supabase, not the device.)
//
// Don't add a "synced" status. It is tempting to keep the row for
// "successfully sent" history, but the queue is for retry coordination,
// not telemetry. Deletion on success keeps the IDB store small and
// makes "stuckRows.length" the authoritative outstanding count.

import {openDB} from 'idb';

export const DB_NAME = 'wcf-offline-queue';
export const DB_VERSION = 1;
export const STORE_SUBMISSIONS = 'submissions';
export const STORE_PHOTO_BLOBS = 'photo_blobs';
export const MAX_RETRIES = 3;

let dbPromise = null;

export function getDb() {
  if (!dbPromise) {
    dbPromise = openDB(DB_NAME, DB_VERSION, {
      upgrade(db) {
        if (!db.objectStoreNames.contains(STORE_SUBMISSIONS)) {
          const s = db.createObjectStore(STORE_SUBMISSIONS, {keyPath: 'csid'});
          s.createIndex('by_form_kind', 'form_kind', {unique: false});
          s.createIndex('by_status', 'status', {unique: false});
          s.createIndex('by_form_kind_status', ['form_kind', 'status'], {unique: false});
        }
        if (!db.objectStoreNames.contains(STORE_PHOTO_BLOBS)) {
          const p = db.createObjectStore(STORE_PHOTO_BLOBS, {keyPath: 'key'});
          p.createIndex('by_csid', 'csid', {unique: false});
          p.createIndex('by_form_kind', 'form_kind', {unique: false});
        }
      },
    });
  }
  return dbPromise;
}

// Test-only — release the cached connection so a fake-indexeddb reset
// between tests gets picked up. Not exported through the index.
export function _resetDbForTests() {
  if (dbPromise) {
    dbPromise.then((db) => db.close()).catch(() => {});
  }
  dbPromise = null;
}

/**
 * Enqueue a new submission. Returns the persisted entry.
 *
 * @param {object} entry
 * @param {string} entry.formKind — registry key (offlineForms.js)
 * @param {string} entry.csid — client_submission_id
 * @param {object} entry.payload — original form payload (for re-render)
 * @param {object} entry.record — the row to upsert (id + csid baked in)
 */
export async function enqueueSubmission({formKind, csid, payload, record}) {
  if (!formKind || !csid || !record) {
    throw new Error('offlineQueue.enqueue: formKind, csid, and record are required');
  }
  const db = await getDb();
  const now = Date.now();
  const entry = {
    csid,
    form_kind: formKind,
    payload: payload ?? null,
    record,
    status: 'queued',
    retry_count: 0,
    last_error: null,
    created_at: now,
    last_attempt_at: null,
  };
  await db.put(STORE_SUBMISSIONS, entry);
  return entry;
}

export async function getSubmission(csid) {
  const db = await getDb();
  return (await db.get(STORE_SUBMISSIONS, csid)) ?? null;
}

export async function listByFormKind(formKind) {
  const db = await getDb();
  return await db.getAllFromIndex(STORE_SUBMISSIONS, 'by_form_kind', formKind);
}

export async function listStuck(formKind) {
  const db = await getDb();
  const all = await db.getAllFromIndex(STORE_SUBMISSIONS, 'by_form_kind_status', [formKind, 'failed']);
  return all;
}

export async function listQueued(formKind) {
  const db = await getDb();
  return await db.getAllFromIndex(STORE_SUBMISSIONS, 'by_form_kind_status', [formKind, 'queued']);
}

export async function markSyncing(csid) {
  return await mutate(csid, (entry) => {
    entry.status = 'syncing';
    entry.last_attempt_at = Date.now();
  });
}

/**
 * Mark a submission successfully synced — removes the submission row AND
 * cascades to delete any photo_blobs persisted under the same csid.
 * Auditability lives in Supabase; we don't keep "done" rows on the device.
 *
 * Phase 1D-A: cascade is unconditional. No-photo csids never have blobs;
 * the index lookup just returns an empty list and the delete loop is a
 * no-op.
 */
export async function markSynced(csid) {
  const db = await getDb();
  const tx = db.transaction([STORE_SUBMISSIONS, STORE_PHOTO_BLOBS], 'readwrite');
  await tx.objectStore(STORE_SUBMISSIONS).delete(csid);
  const photoStore = tx.objectStore(STORE_PHOTO_BLOBS);
  const photoIdx = photoStore.index('by_csid');
  const photoKeys = await photoIdx.getAllKeys(csid);
  for (const key of photoKeys) {
    await photoStore.delete(key);
  }
  await tx.done;
}

/**
 * Record a failed attempt. Bumps retry_count. If retries hit MAX_RETRIES,
 * marks the row 'failed' (stuck); otherwise resets to 'queued' for the
 * next sync trigger.
 *
 * Returns the updated entry (or null if the row was already deleted).
 */
export async function markFailed(csid, errorMessage) {
  return await mutate(csid, (entry) => {
    entry.retry_count = (entry.retry_count ?? 0) + 1;
    entry.last_error = errorMessage ?? null;
    entry.last_attempt_at = Date.now();
    entry.status = entry.retry_count >= MAX_RETRIES ? 'failed' : 'queued';
  });
}

/**
 * Mark a row as stuck immediately, bypassing the retry budget. Used when
 * the sync worker hits a schema/validation error during a background
 * pass — those are real bugs, not transient failures, and silently
 * retrying them 3 times wastes network and delays the operator-visible
 * surface.
 */
export async function markStuckNow(csid, errorMessage) {
  return await mutate(csid, (entry) => {
    entry.retry_count = MAX_RETRIES;
    entry.last_error = errorMessage ?? null;
    entry.last_attempt_at = Date.now();
    entry.status = 'failed';
  });
}

export const STALE_SYNCING_MS = 30_000;

/**
 * Reset stale 'syncing' rows back to 'queued' so they get picked up
 * by the next sync pass. Handles tab/browser close, reload, or crash
 * mid-sync — rows that flipped to 'syncing' but never reached
 * markSynced / markFailed would otherwise sit in limbo (listQueued
 * filters by status='queued', listStuck by status='failed', so a
 * 'syncing' row appears in neither).
 *
 * Threshold (default 30s) is generous against any plausible single-
 * upsert duration but small enough that an interrupted attempt
 * recovers within one 60s background tick. Fresh in-flight rows
 * within the window stay 'syncing' so concurrent passes (online
 * event + tick + manual button) don't step on each other.
 *
 * Returns the csids that were recovered. Doesn't bump retry_count —
 * an interrupted attempt is not a failed attempt.
 */
export async function recoverStaleSyncing(formKind, {staleAfterMs = STALE_SYNCING_MS} = {}) {
  const db = await getDb();
  const tx = db.transaction(STORE_SUBMISSIONS, 'readwrite');
  const store = tx.objectStore(STORE_SUBMISSIONS);
  const idx = store.index('by_form_kind_status');
  const all = await idx.getAll([formKind, 'syncing']);
  const cutoff = Date.now() - staleAfterMs;
  const recovered = [];
  for (const entry of all) {
    if (!entry.last_attempt_at || entry.last_attempt_at <= cutoff) {
      entry.status = 'queued';
      await store.put(entry);
      recovered.push(entry.csid);
    }
  }
  await tx.done;
  return recovered;
}

/**
 * Operator-driven retry from the stuck-submissions modal. Resets retry_count
 * to 0 and flips status back to 'queued'. Last error is cleared so the modal
 * shows fresh telemetry on the next failure.
 */
export async function retrySubmission(csid) {
  return await mutate(csid, (entry) => {
    entry.retry_count = 0;
    entry.last_error = null;
    entry.status = 'queued';
  });
}

/**
 * Operator-driven discard. Removes the submission row AND any photo_blobs
 * persisted under the same csid. Caller should warn that the submission
 * is dropped, not deferred. Bucket objects (if any uploaded prior to the
 * stuck state) are NOT auto-deleted — operator/admin cleans up if needed.
 */
export async function discardSubmission(csid) {
  const db = await getDb();
  const tx = db.transaction([STORE_SUBMISSIONS, STORE_PHOTO_BLOBS], 'readwrite');
  await tx.objectStore(STORE_SUBMISSIONS).delete(csid);
  const photoStore = tx.objectStore(STORE_PHOTO_BLOBS);
  const photoIdx = photoStore.index('by_csid');
  const photoKeys = await photoIdx.getAllKeys(csid);
  for (const key of photoKeys) {
    await photoStore.delete(key);
  }
  await tx.done;
}

// ============================================================================
// Phase 1D-A — photo_blobs writes + atomic submission+blobs enqueue
// ============================================================================
// The submissions store holds row data only (no Blobs/Files). Photo bytes
// live exclusively in STORE_PHOTO_BLOBS. The two stores are coordinated via
// a single readwrite transaction so a tab/IDB error mid-write can't leave
// half-queued state.

/**
 * Bulk-put prepared photos under one csid. Each entry's primary key is its
 * deterministic path; the by_csid + by_form_kind indices stay in sync.
 *
 * @param {object} args
 * @param {string} args.csid
 * @param {string} args.formKind
 * @param {Array<{photo_key: string, path: string, blob: Blob, mime: string,
 *   size_bytes: number, name: string, captured_at: string}>} args.photos
 */
export async function enqueuePhotoBlobs({csid, formKind, photos}) {
  if (!csid || !formKind) {
    throw new Error('offlineQueue.enqueuePhotoBlobs: csid + formKind required');
  }
  if (!Array.isArray(photos) || photos.length === 0) return;
  const db = await getDb();
  const tx = db.transaction(STORE_PHOTO_BLOBS, 'readwrite');
  const store = tx.objectStore(STORE_PHOTO_BLOBS);
  for (const p of photos) {
    if (!p.photo_key || !p.path || !p.blob) {
      throw new Error('offlineQueue.enqueuePhotoBlobs: photo_key/path/blob required');
    }
    await store.put({
      key: p.path,
      csid,
      form_kind: formKind,
      photo_key: p.photo_key,
      blob: p.blob,
      mime: p.mime ?? 'image/jpeg',
      size_bytes: p.size_bytes ?? 0,
      name: p.name ?? null,
      captured_at: p.captured_at ?? new Date().toISOString(),
    });
  }
  await tx.done;
}

/**
 * Read all photo_blobs persisted for a csid, in stable photo_key order
 * ('photo-1' < 'photo-2' < ...).
 */
export async function listPhotoBlobsByCsid(csid) {
  const db = await getDb();
  const all = await db.getAllFromIndex(STORE_PHOTO_BLOBS, 'by_csid', csid);
  // Sort by the numeric tail of photo_key so 'photo-10' doesn't sort before
  // 'photo-2'. Falls back to lexical compare for non-numeric tails.
  return all.slice().sort((a, b) => {
    const ax = parseInt(String(a.photo_key).replace(/^photo-/, ''), 10);
    const bx = parseInt(String(b.photo_key).replace(/^photo-/, ''), 10);
    if (Number.isFinite(ax) && Number.isFinite(bx) && ax !== bx) return ax - bx;
    return String(a.photo_key).localeCompare(String(b.photo_key));
  });
}

/**
 * Bulk-delete photo_blobs by csid. Used by markSynced + discardSubmission
 * cascades, but exported so the queue worker can also clean up after a
 * synced row that was inserted via the no-photo flat path but somehow
 * has stale blobs (defense-in-depth).
 */
export async function deletePhotoBlobsByCsid(csid) {
  const db = await getDb();
  const tx = db.transaction(STORE_PHOTO_BLOBS, 'readwrite');
  const store = tx.objectStore(STORE_PHOTO_BLOBS);
  const idx = store.index('by_csid');
  const keys = await idx.getAllKeys(csid);
  for (const key of keys) {
    await store.delete(key);
  }
  await tx.done;
}

/**
 * Atomic enqueue: writes the submission row AND every photo_blob in a
 * SINGLE readwrite transaction over both stores. Either both land or
 * neither (transaction abort on any error).
 *
 * Status defaults to 'queued' (transient failure path); pass status:'failed'
 * with retry_count:MAX_RETRIES to short-circuit straight to stuck (used
 * for storage 401/403 + row schema-after-upload).
 *
 * @param {object} args
 * @param {string} args.csid
 * @param {string} args.formKind
 * @param {object} args.payload — sanitized, NO File/Blob references
 * @param {object} args.record — daily-row record with photos jsonb (paths only)
 * @param {Array} args.photos — PreparedPhoto[]; may be empty for no-photo paths
 *   though no-photo paths typically use enqueueSubmission directly
 * @param {'queued' | 'failed'} [args.status='queued']
 * @param {number} [args.retryCount=0]
 * @param {string} [args.lastError=null]
 */
export async function enqueueSubmissionWithPhotos({
  csid,
  formKind,
  payload,
  record,
  photos,
  status = 'queued',
  retryCount = 0,
  lastError = null,
}) {
  if (!csid || !formKind || !record) {
    throw new Error('offlineQueue.enqueueSubmissionWithPhotos: csid, formKind, record required');
  }
  // Validate photos UPFRONT before opening the transaction. An auto-commit
  // semantics quirk in IDB means a partial loop after a successful put may
  // still commit the prior puts even if the function throws. Pre-validation
  // makes the atomicity contract trivially correct: we only open the
  // transaction once the entire input is verified.
  const photosList = Array.isArray(photos) ? photos : [];
  for (const p of photosList) {
    if (!p || !p.photo_key || !p.path || !p.blob) {
      throw new Error('offlineQueue.enqueueSubmissionWithPhotos: photo_key/path/blob required on every entry');
    }
  }
  const db = await getDb();
  const now = Date.now();
  const tx = db.transaction([STORE_SUBMISSIONS, STORE_PHOTO_BLOBS], 'readwrite');
  await tx.objectStore(STORE_SUBMISSIONS).put({
    csid,
    form_kind: formKind,
    payload: payload ?? null,
    record,
    status,
    retry_count: retryCount,
    last_error: lastError,
    created_at: now,
    last_attempt_at: status === 'queued' ? null : now,
  });
  if (photosList.length > 0) {
    const photoStore = tx.objectStore(STORE_PHOTO_BLOBS);
    for (const p of photosList) {
      await photoStore.put({
        key: p.path,
        csid,
        form_kind: formKind,
        photo_key: p.photo_key,
        blob: p.blob,
        mime: p.mime ?? 'image/jpeg',
        size_bytes: p.size_bytes ?? 0,
        name: p.name ?? null,
        captured_at: p.captured_at ?? new Date().toISOString(),
      });
    }
  }
  await tx.done;
}

async function mutate(csid, fn) {
  const db = await getDb();
  const tx = db.transaction(STORE_SUBMISSIONS, 'readwrite');
  const store = tx.objectStore(STORE_SUBMISSIONS);
  const entry = await store.get(csid);
  if (!entry) {
    await tx.done;
    return null;
  }
  fn(entry);
  await store.put(entry);
  await tx.done;
  return entry;
}
