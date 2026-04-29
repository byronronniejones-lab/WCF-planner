// IndexedDB-backed offline queue for webform submissions and (Phase 2)
// photo blobs. Wraps `idb` with the minimum surface the useOfflineSubmit
// hook needs: enqueue, list-by-status, mark-sync-result, retry, discard.
//
// Stores:
//   - submissions: queued webform rows. Key = client_submission_id (text).
//   - photo_blobs: schema declared in Phase 1B; writes wired in Phase 2.
//                  Key = `${form_kind}/${client_submission_id}/${photo_key}`
//                  to mirror the locked storage path scheme.
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
 * Mark a submission successfully synced — removes it from the store.
 * Auditability lives in Supabase; we don't keep "done" rows on the device.
 */
export async function markSynced(csid) {
  const db = await getDb();
  await db.delete(STORE_SUBMISSIONS, csid);
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
 * Operator-driven discard. Removes the row outright; caller should warn
 * that the submission is dropped, not deferred.
 */
export async function discardSubmission(csid) {
  const db = await getDb();
  await db.delete(STORE_SUBMISSIONS, csid);
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
