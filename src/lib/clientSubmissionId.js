// Client-generated idempotency key for the offline submission queue. Persists
// with each enqueued submission and replays unchanged across retries; the
// queue worker passes it to PostgREST as the `onConflict` target so a
// duplicate retry collapses to a no-op rather than an error.
//
// crypto.randomUUID() is the preferred path (HTTPS or localhost). The
// fallback covers older runners and edge cases where the secure-context
// guarantee isn't met. Stability across retries comes from the caller
// (generate once at submit time, persist with the queued row, replay the
// same id) — this module only guarantees uniqueness per call.

export function newClientSubmissionId() {
  if (typeof globalThis.crypto !== 'undefined' && typeof globalThis.crypto.randomUUID === 'function') {
    return globalThis.crypto.randomUUID();
  }
  // Fallback: timestamp + 12 bytes of random base36. Wide collision margin
  // for a single farm's submission volume.
  const ts = Date.now().toString(36);
  const r1 = Math.random().toString(36).slice(2, 10);
  const r2 = Math.random().toString(36).slice(2, 10);
  return `csid-${ts}-${r1}${r2}`;
}
