// React hook that wraps the offline queue for a single parent-aware RPC
// submission. Mirrors useOfflineSubmit's lifecycle but the submit path is
// `sb.rpc(record.rpc, record.args)` instead of `sb.from(table).insert(record)`.
//
// Why a separate hook (not a flag on useOfflineSubmit):
//   - Failure classification differs at one critical point: 23505 from a
//     plain anon insert means "already-synced replay" (the unique index
//     gave the dedup guarantee post-insert). 23505 from an RPC means the
//     function body itself raised one. The RPC contract (mig 034) is
//     "no 23505 ever surfaces to the caller" via ON CONFLICT DO NOTHING +
//     fallback SELECT — if it does, that's a bug, not idempotency. We
//     surface it via stuck modal.
//   - Idempotent-replay signal arrives in the data envelope, not as an
//     error. RPC returns {data: {idempotent_replay: true, ...}, error: null}
//     on a replay. Falls into the no-error path naturally.
//   - The queued record shape is {rpc, args} not a flat row.
//
// Failure classification (order matters):
//   1. Network / TypeError → enqueue, return 'queued'.
//   2. Duplicate-csid (23505 with client_submission_id) → DO NOT treat as
//      success here. The RPC's ON CONFLICT DO NOTHING + fallback SELECT
//      is supposed to make this impossible; if it shows up, it's a real
//      schema-class bug worth surfacing.
//   3. PostgREST status >= 500 → enqueue.
//   4. RLS denial (status 401/403) → enqueue.
//   5. PostgREST 4xx with PGRST/22*/23* code → throw (schema/validation
//      bug). On replay, markStuckNow instead of markFailed (don't burn
//      retry budget on deterministic failures).
//   6. Anything else → enqueue (safe default).

import {useCallback, useEffect, useRef, useState} from 'react';

import {sb} from './supabase.js';
import {newClientSubmissionId} from './clientSubmissionId.js';
import {buildRpcRequest, getRpcFormConfig} from './offlineRpcForms.js';
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

function classifyError(err) {
  if (err instanceof TypeError) return 'network';
  if (err && err.name === 'TypeError') return 'network';
  if (err && err.message && /failed to fetch|network ?error|load failed/i.test(err.message)) return 'network';

  const status = err && err.status != null ? Number(err.status) : null;
  const code = err && err.code != null ? String(err.code) : '';

  if (status != null) {
    if (status >= 500) return 'server';
    if (status === 401 || status === 403) return 'rls';
    if (status >= 400 && status < 500) {
      // P0001 = PL/pgSQL `RAISE EXCEPTION` default SQLSTATE (raise_exception).
      // Mig 034's submit_add_feed_batch and mig 035's
      // submit_weigh_in_session_batch use bare RAISE EXCEPTION for every
      // validation path (missing csid / id / date / team_member / 0 entries
      // / bad species / bad status / bad broiler_week). PostgREST surfaces
      // those as status=400 + code='P0001'. Without the explicit match
      // they would fall to 'unknown' → enqueue, which would burn retry
      // budget on a deterministic input bug.
      if (/^PGRST/i.test(code) || /^23/.test(code) || /^22/.test(code) || code === 'P0001') return 'schema';
      return 'unknown';
    }
  }

  // Codeless errors with a 23xxx / P0001 code (some PostgREST shapes drop the status).
  if (/^23/.test(code) || /^22/.test(code) || /^PGRST/i.test(code) || code === 'P0001') return 'schema';

  return 'unknown';
}

async function attemptRpc(formKind, record) {
  // record = {rpc, args}; the RPC name is per-form via the registry but
  // we read it from the record so re-applying a queued entry uses the
  // exact same call shape that was stored.
  const cfg = getRpcFormConfig(formKind);
  if (record.rpc !== cfg.rpc) {
    // Defensive: a queued entry's rpc field must match the registry.
    // If a future refactor renames the RPC without migrating queued
    // entries, this catches it loudly. Marked _schemaClass so syncNow's
    // catch routes it to markStuckNow (deterministic — retry won't help).
    const e = new Error(
      `useOfflineRpcSubmit: rpc mismatch for ${formKind} — queued entry expects ${record.rpc}, registry has ${cfg.rpc}`,
    );
    e._schemaClass = true;
    throw e;
  }
  const {data, error} = await sb.rpc(record.rpc, record.args);
  return {data, error};
}

/**
 * @param {string} formKind — RPC registry key (e.g. 'add_feed_batch').
 * @returns {{
 *   submit: (payload: object) => Promise<{state: 'synced' | 'queued', csid: string, parentId: string, record: object, data: object | null}>,
 *   syncNow: () => Promise<void>,
 *   stuckRows: Array<object>,
 *   queuedCount: number,
 *   refresh: () => Promise<void>,
 *   retryStuck: (csid: string) => Promise<void>,
 *   discardStuck: (csid: string) => Promise<void>,
 *   syncing: boolean,
 * }}
 */
export function useOfflineRpcSubmit(formKind) {
  const [stuckRows, setStuckRows] = useState([]);
  const [queuedCount, setQueuedCount] = useState(0);
  const [syncing, setSyncing] = useState(false);
  const mountedRef = useRef(true);
  const inFlightRef = useRef(false);

  // Validate the form_kind once at mount — typos blow up loud, not silent.
  useEffect(() => {
    getRpcFormConfig(formKind);
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
      await recoverStaleSyncing(formKind);

      const queued = await listQueued(formKind);
      for (const entry of queued) {
        await markSyncing(entry.csid);
        try {
          const {error} = await attemptRpc(formKind, entry.record);
          if (error) {
            const kind = classifyError(error);
            if (kind === 'schema') {
              await markStuckNow(entry.csid, error.message ?? 'schema error');
            } else {
              await markFailed(entry.csid, error.message ?? `${kind} error`);
            }
          } else {
            // No error means RPC returned cleanly. {idempotent_replay:
            // true} or false both count as 'synced' from the queue's
            // perspective — the row is in the database.
            await markSynced(entry.csid);
          }
        } catch (err) {
          // Synchronously-thrown error from attemptRpc. rpc-mismatch is
          // _schemaClass-marked and routes to stuck immediately (deterministic
          // bug; retry won't help). Other thrown errors (e.g. fetch failure)
          // burn the retry budget normally.
          const kind = err && err._schemaClass ? 'schema' : classifyError(err);
          if (kind === 'schema') {
            await markStuckNow(entry.csid, err && err.message ? err.message : String(err));
          } else {
            await markFailed(entry.csid, err && err.message ? err.message : String(err));
          }
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
      return _runSubmit({formKind, payload, opts, refresh});
    },
    [formKind, refresh],
  );

  const retryStuck = useCallback(
    async (csid) => {
      await retrySubmission(csid);
      await refresh();
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

// Internal helper exported for tests.
export const _classifyError = classifyError;

/**
 * Pure submit runner — extracted so the schema-error contract can be unit-
 * tested without renderHook. The hook's `submit` wraps this with the
 * useCallback identity from `formKind` + `refresh`.
 *
 * Critical control-flow rule (Codex blocker fix):
 *   - The schema-error throw at the bottom of this function is OUTSIDE
 *     the try/catch around attemptRpc. If a PostgREST schema response
 *     comes back via the {error} envelope, we throw directly — the
 *     thrown error is NOT swallowed by an outer catch that would then
 *     mis-classify it as 'unknown' and queue it.
 *   - The try/catch around attemptRpc is ONLY for synchronously-thrown
 *     errors (rpc-mismatch from the registry guard, or fetch throwing
 *     hard). Schema-class synchronous throws are flagged via
 *     `_schemaClass` and re-thrown.
 *
 * Anything classified 'schema' MUST escape; nothing else may.
 */
export async function _runSubmit({formKind, payload, opts = {}, refresh}) {
  const csid = opts.csid ?? newClientSubmissionId();
  const parentId = opts.parentId ?? `${formKind}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const record = buildRpcRequest(formKind, payload, {csid, parentId});

  // Step 1: try the network. attemptRpc CAN throw synchronously
  // (rpc-mismatch defensive guard, or the underlying fetch throws). Those
  // are handled here. PostgREST {error}-envelope responses are NOT thrown
  // — they fall through to step 2.
  let response;
  try {
    response = await attemptRpc(formKind, record);
  } catch (err) {
    const kind = err && err._schemaClass ? 'schema' : classifyError(err);
    if (kind === 'schema') {
      // Deterministic bug (e.g. rpc-mismatch). Don't queue.
      throw err;
    }
    // network / rls / server / unknown — queue.
    await enqueueSubmission({formKind, csid, payload, record});
    await markFailed(csid, err && err.message ? err.message : String(err));
    if (refresh) await refresh();
    return {state: 'queued', csid, parentId, record, data: null};
  }

  // Step 2: attemptRpc returned a {data, error} envelope. Inspect.
  const {data, error} = response;
  if (!error) {
    return {state: 'synced', csid, parentId, record, data};
  }
  const kind = classifyError(error);
  if (kind === 'schema') {
    // Real schema/validation error — don't queue. Wrap so callers can
    // inspect; preserve original code/status so any downstream classifier
    // continues to recognize it as schema.
    const wrapped = new Error(`offlineRpcSubmit: schema/validation error: ${error.message ?? error.code ?? 'unknown'}`);
    wrapped.cause = error;
    wrapped.code = error.code;
    wrapped.status = error.status;
    throw wrapped;
  }
  // Transient (network/rls/server/unknown) — queue.
  await enqueueSubmission({formKind, csid, payload, record});
  await markFailed(csid, error.message ?? `${kind} error`);
  if (refresh) await refresh();
  return {state: 'queued', csid, parentId, record, data: null};
}
