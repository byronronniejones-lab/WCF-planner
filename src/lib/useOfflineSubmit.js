// React hook that wraps the offline queue for a single form. Coordinates:
//   - immediate-online happy path (try the insert, return 'synced')
//   - failure-classified queueing (network/5xx/RLS → queue, schema → throw)
//   - background sync (online event + 60s tick + manual button)
//   - stuck-row surfacing on mount + after each sync pass
//
// Failure classification (order matters):
//   1. Network / TypeError ("Failed to fetch", etc.) → enqueue + return 'queued'.
//   2. Duplicate key (code 23505) on `client_submission_id` → SUCCESS (the
//      row is already there from a prior replay; treat as 'synced'). This
//      is the anon-friendly idempotency path — see comment block on
//      `attemptInsert` below.
//   3. PostgREST status >= 500 → enqueue (transient backend or auth blip).
//   4. RLS denial (status 401/403/code starting with '42') → enqueue.
//      Reasoning: anon RLS misfires intermittently on the test environment
//      under load; better to retry than to drop the row.
//   5. PostgREST 4xx with a code matching schema/validation patterns
//      (PGRST*, 23xxx other than the dup-key path above) → throw. These
//      are real bugs; surfacing is correct.
//   6. Anything else → enqueue (safe default).
//
// Idempotency contract:
//   - The original Codex plan said `.upsert(..., {onConflict, ignoreDuplicates: true})`
//     but that breaks under anon RLS: PostgREST's ON CONFLICT path requires
//     SELECT privilege on the conflict-target column, and the public webform
//     tables (fuel_supplies / equipment_fuelings / weigh_ins / weigh_in_sessions)
//     all grant anon INSERT only. We use plain `.insert(record)` instead and
//     rely on the unique index alone for dedup; the resulting 23505 on a
//     replay is the "already synced" signal. Same idempotency guarantee, no
//     RLS expansion required.
//
// Don't trust navigator.onLine as a gate (it's a lie when DNS resolves but
// the host is unreachable). Treat the network attempt itself as the source
// of truth; use the 'online' event only as a sync trigger.

import {useCallback, useEffect, useRef, useState} from 'react';

import {sb} from './supabase.js';
import {newClientSubmissionId} from './clientSubmissionId.js';
import {buildRecord, getFormConfig} from './offlineForms.js';
import {
  enqueueSubmission,
  listQueued,
  listStuck,
  markSyncing,
  markSynced,
  markFailed,
  markStuckNow,
  recoverStaleSyncing,
  retrySubmission,
  discardSubmission,
} from './offlineQueue.js';

const TICK_INTERVAL_MS = 60_000;

// Postgres unique-constraint violation. With our non-partial unique index
// on client_submission_id (mig 030), a duplicate replay of an already-
// synced row raises this code. The hook treats it as success.
const DUPLICATE_KEY_CODE = '23505';

function isDuplicateCsidViolation(err) {
  if (!err) return false;
  if (String(err.code) !== DUPLICATE_KEY_CODE) return false;
  // Be precise about WHICH constraint — a 23505 on an unrelated index
  // (e.g. cattle.tag) is a real bug, not an idempotency hit.
  const msg = String(err.message || '');
  return /client_submission_id/i.test(msg);
}

function classifyError(err) {
  // Plain network failure — fetch throws TypeError ("Failed to fetch") on
  // offline / DNS / aborted-connection.
  if (err instanceof TypeError) return 'network';
  if (err && err.name === 'TypeError') return 'network';
  if (err && err.message && /failed to fetch|network ?error|load failed/i.test(err.message)) return 'network';

  // PostgREST error shape — supabase-js v2 returns {message, code, details, hint, status}
  const status = err && err.status != null ? Number(err.status) : null;
  const code = err && err.code != null ? String(err.code) : '';

  if (status != null) {
    if (status >= 500) return 'server';
    if (status === 401 || status === 403) return 'rls';
    // 4xx schema/validation: PGRST116 = no rows, PGRST204 = no schema cache,
    // 23xxx (other than dup-csid handled above) = integrity constraints.
    // These are real bugs the operator can't fix.
    if (status >= 400 && status < 500) {
      if (/^PGRST/i.test(code) || /^23/.test(code) || /^22/.test(code)) return 'schema';
      // Unknown 4xx — queue rather than drop. Operator can discard from the
      // stuck modal if it really is stuck.
      return 'unknown';
    }
  }

  return 'unknown';
}

// Plain insert — anon RLS friendly. See top-of-file comment for why we
// don't use upsert + ignoreDuplicates here.
async function attemptInsert(formKind, record) {
  const cfg = getFormConfig(formKind);
  const {data, error} = await sb.from(cfg.table).insert(record);
  return {data, error};
}

/**
 * @param {string} formKind — registry key (e.g. 'fuel_supply').
 * @returns {{
 *   submit: (payload: object) => Promise<{state: 'synced' | 'queued', csid: string, id: string, record: object}>,
 *   syncNow: () => Promise<void>,
 *   stuckRows: Array<object>,
 *   queuedCount: number,
 *   refresh: () => Promise<void>,
 *   retryStuck: (csid: string) => Promise<void>,
 *   discardStuck: (csid: string) => Promise<void>,
 *   syncing: boolean,
 * }}
 */
export function useOfflineSubmit(formKind) {
  const [stuckRows, setStuckRows] = useState([]);
  const [queuedCount, setQueuedCount] = useState(0);
  const [syncing, setSyncing] = useState(false);
  const mountedRef = useRef(true);
  const inFlightRef = useRef(false);

  // Validate the form_kind once at mount — typos blow up loud, not silent.
  useEffect(() => {
    getFormConfig(formKind);
  }, [formKind]);

  const refresh = useCallback(async () => {
    const [queued, stuck] = await Promise.all([listQueued(formKind), listStuck(formKind)]);
    if (!mountedRef.current) return;
    setQueuedCount(queued.length);
    setStuckRows(stuck);
  }, [formKind]);

  const syncNow = useCallback(async () => {
    if (inFlightRef.current) return;
    inFlightRef.current = true;
    if (mountedRef.current) setSyncing(true);
    try {
      // Recover any rows orphaned in 'syncing' from a prior tab/crash
      // mid-flight. Fresh in-flight rows (within the threshold) stay
      // 'syncing' so concurrent same-tab passes don't step on each other.
      await recoverStaleSyncing(formKind);

      const queued = await listQueued(formKind);
      for (const entry of queued) {
        await markSyncing(entry.csid);
        try {
          const {error} = await attemptInsert(formKind, entry.record);
          if (error) {
            // Duplicate-csid replay = already synced (the row landed on
            // a prior attempt; this one is the post-recovery retry that
            // hit the unique index instead of a network failure).
            if (isDuplicateCsidViolation(error)) {
              await markSynced(entry.csid);
            } else {
              const kind = classifyError(error);
              if (kind === 'schema') {
                // Real bug — escalate to stuck immediately so the operator
                // sees it. Don't burn the retry budget on a deterministic
                // failure.
                await markStuckNow(entry.csid, error.message ?? 'schema error');
              } else {
                await markFailed(entry.csid, error.message ?? `${kind} error`);
              }
            }
          } else {
            await markSynced(entry.csid);
          }
        } catch (err) {
          await markFailed(entry.csid, err && err.message ? err.message : String(err));
        }
      }
    } finally {
      inFlightRef.current = false;
      if (mountedRef.current) setSyncing(false);
      await refresh();
    }
  }, [formKind, refresh]);

  const submit = useCallback(
    async (payload, opts = {}) => {
      const csid = newClientSubmissionId();
      const id = opts.id ?? `${formKind}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const record = buildRecord(formKind, payload, {id, csid});

      // Try the network first. Fast happy path.
      try {
        const {error} = await attemptInsert(formKind, record);
        if (!error) {
          return {state: 'synced', csid, id, record};
        }
        // Duplicate-csid = already-synced (idempotent replay of a row that
        // landed on a previous attempt). Fresh submits won't hit this
        // because the csid is freshly generated above.
        if (isDuplicateCsidViolation(error)) {
          return {state: 'synced', csid, id, record};
        }
        const kind = classifyError(error);
        if (kind === 'schema') {
          throw new Error(`offlineSubmit: schema/validation error: ${error.message ?? error.code ?? 'unknown'}`);
        }
        // Transient — queue it.
        await enqueueSubmission({formKind, csid, payload, record});
        await markFailed(csid, error.message ?? `${kind} error`);
        await refresh();
        return {state: 'queued', csid, id, record};
      } catch (err) {
        const kind = classifyError(err);
        if (kind === 'schema') {
          throw err;
        }
        await enqueueSubmission({formKind, csid, payload, record});
        await markFailed(csid, err && err.message ? err.message : String(err));
        await refresh();
        return {state: 'queued', csid, id, record};
      }
    },
    [formKind, refresh],
  );

  const retryStuck = useCallback(
    async (csid) => {
      await retrySubmission(csid);
      await refresh();
      // Fire a sync pass immediately so the operator sees the result.
      await syncNow();
    },
    [refresh, syncNow],
  );

  const discardStuck = useCallback(
    async (csid) => {
      await discardSubmission(csid);
      await refresh();
    },
    [refresh],
  );

  // Mount: load existing stuck/queued state, fire one sync pass.
  useEffect(() => {
    mountedRef.current = true;
    refresh();
    syncNow();
    return () => {
      mountedRef.current = false;
    };
  }, [refresh, syncNow]);

  // Background triggers: online event + 60s tick.
  useEffect(() => {
    function handleOnline() {
      syncNow();
    }
    if (typeof window !== 'undefined') {
      window.addEventListener('online', handleOnline);
    }
    const id = setInterval(() => {
      // navigator.onLine is advisory, not authoritative — fire sync regardless;
      // the upsert call itself is the source of truth.
      syncNow();
    }, TICK_INTERVAL_MS);
    return () => {
      if (typeof window !== 'undefined') window.removeEventListener('online', handleOnline);
      clearInterval(id);
    };
  }, [syncNow]);

  return {
    submit,
    syncNow,
    stuckRows,
    queuedCount,
    refresh,
    retryStuck,
    discardStuck,
    syncing,
  };
}

// Internal helper exported for tests
export const _classifyError = classifyError;
