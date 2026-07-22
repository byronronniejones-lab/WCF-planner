// Upload orchestration for the disaster-recovery backup runner.
//
// This module contains the ORDERING and FAILURE logic — the part whose
// correctness a source-regex guard cannot verify (a wrong boolean or a
// misordered phase reads fine in source and fails only at runtime). It performs
// no I/O of its own: every side effect goes through injected `ops`, so the full
// sequence can be tested with in-memory fakes, no credentials, no network, no
// subprocesses, and no filesystem.
//
// The real runner (scripts/dr_backup.cjs) wires the production ops (aws CLI
// uploads, streamed transfers, retention calls) into orchestrateUpload. There
// is deliberately NO flag or environment variable that swaps in fakes: the seam
// is dependency injection at the function boundary, and production always
// passes the real ops.
//
// Load has no side effects, so requiring this module from a test is safe.

'use strict';

const L = require('./dr_layout.cjs');

const REQUIRED_OPS = Object.freeze(['putObject', 'streamObject', 'setB2Retention', 'sleep']);

/**
 * Fail closed on an incomplete ops object. A missing dependency must throw
 * loudly rather than silently skipping a step (which could skip an upload or a
 * retention call and still look like success).
 */
function requireOps(ops, names = REQUIRED_OPS) {
  if (!ops || typeof ops !== 'object') throw new Error('orchestrateUpload: an ops object is required');
  for (const n of names) {
    if (typeof ops[n] !== 'function') throw new Error(`orchestrateUpload: missing required operation "${n}"`);
  }
}

/**
 * Track every spawned child so cancellation can terminate the whole tree. A
 * storage transfer runs two children at once (source read piped into dest
 * write); killing only the parent would leave both alive holding credentials
 * and an open connection to production Storage.
 */
function createChildRegistry() {
  const set = new Set();
  return {
    track(child) {
      set.add(child);
      if (child && typeof child.on === 'function') child.on('close', () => set.delete(child));
      return child;
    },
    killAll(signal = 'SIGKILL') {
      for (const c of set) {
        try {
          c.kill(signal);
        } catch {
          /* already gone */
        }
      }
      set.clear();
    },
    size: () => set.size,
  };
}

/**
 * Idempotent cleanup that terminates children BEFORE removing files. Order
 * matters: a live child could still be writing into the work dir. Composed from
 * injected effects so the ordering is testable without real processes or files.
 */
function createCleanup({killChildren, removeWorkDir}) {
  if (typeof killChildren !== 'function' || typeof removeWorkDir !== 'function') {
    throw new Error('createCleanup: killChildren and removeWorkDir functions are required');
  }
  let cleaned = false;
  return function cleanup() {
    if (cleaned) return;
    cleaned = true;
    killChildren();
    removeWorkDir();
  };
}

/** Run `worker` over `items` with at most `limit` in flight. */
async function runPool(items, limit, worker) {
  const results = [];
  let next = 0;
  const inFlight = Math.max(0, Math.min(limit, items.length));
  const runners = Array.from({length: inFlight}, async () => {
    for (;;) {
      const i = next++;
      if (i >= items.length) return;
      results[i] = await worker(items[i], i);
    }
  });
  await Promise.all(runners);
  return results;
}

/** Bounded retry with exponential backoff; terminal failure throws. */
async function withRetry(attempts, sleep, label, fn) {
  let last;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      return await fn();
    } catch (e) {
      last = e;
      if (attempt < attempts) await sleep(L.backoffMs(attempt));
    }
  }
  throw new Error(`${label} failed after ${attempts} attempts: ${last?.message || last || 'unknown'}`);
}

/**
 * Upload one generation in strict order: PAYLOAD -> STORAGE BODIES -> MANIFESTS.
 *
 * The manifest is both the authoritative record of a generation AND the input
 * to the next run's incremental diff, so it must be published only after every
 * payload and storage transfer has succeeded. Any earlier failure returns
 * immediately with manifestsUploaded=false so the caller never advances the
 * baseline past work that did not complete.
 *
 * plan:
 *   payload        [{provider, key, body}]  database package, one per provider
 *   storageChanged [{bucket, path, size, etag}]  diff-selected objects
 *   manifests      [{provider, key, body}]  db + storage manifests, per provider
 *   runId, databaseOnly, concurrency, retryAttempts
 *
 * ops (all injected; production wires the real aws-CLI implementations):
 *   putObject(provider, key, body)      -> {ok, error?}   (may be sync)
 *   streamObject(obj, provider, destKey)-> Promise         (resolve ok / reject)
 *   setB2Retention(key)                 -> {ok, error?}   (may be sync)
 *   sleep(ms)                           -> Promise
 *
 * returns {ok, transferred, failures[], manifestsUploaded, failedAt?}
 */
async function orchestrateUpload(plan, ops) {
  requireOps(ops);
  const {
    payload = [],
    storageChanged = [],
    manifests = [],
    runId,
    databaseOnly = false,
    concurrency = L.TRANSFER_CONCURRENCY,
    retryAttempts = L.RETRY_ATTEMPTS,
  } = plan || {};

  // Phase 1 — database payload. Must complete before any storage transfer.
  for (const p of payload) {
    const r = await ops.putObject(p.provider, p.key, p.body);
    if (!r || !r.ok) {
      return {
        ok: false,
        transferred: 0,
        failures: [{stage: 'payload', target: `${p.provider} ${p.key}`, error: r && r.error}],
        manifestsUploaded: false,
        failedAt: 'payload',
      };
    }
  }

  // Phase 2 — storage bodies, streamed to BOTH providers. Skipped entirely for
  // a database-only generation.
  let transferred = 0;
  if (!databaseOnly && storageChanged.length > 0) {
    const failures = [];
    await runPool(storageChanged, concurrency, async (obj) => {
      try {
        for (const provider of ['b2', 'r2']) {
          const destKey = L.storageObjectKey(provider, obj.bucket, obj.path, runId);
          await withRetry(retryAttempts, ops.sleep, `${provider} ${obj.bucket}/${obj.path}`, () =>
            ops.streamObject(obj, provider, destKey),
          );
          if (provider === 'b2') {
            const rr = await ops.setB2Retention(destKey);
            if (!rr || !rr.ok) throw new Error(`retention: ${rr && rr.error}`);
          }
        }
        // One provider succeeding must never count the object as transferred:
        // this increments only after BOTH providers AND the B2 retention pass.
        transferred++;
      } catch (e) {
        failures.push({stage: 'storage', object: `${obj.bucket}/${obj.path}`, error: String((e && e.message) || e)});
      }
    });
    if (failures.length > 0) {
      return {ok: false, transferred, failures, manifestsUploaded: false, failedAt: 'storage'};
    }
  }

  // Phase 3 — manifests, ONLY after everything above succeeded.
  for (const m of manifests) {
    const r = await ops.putObject(m.provider, m.key, m.body);
    if (!r || !r.ok) {
      return {
        ok: false,
        transferred,
        failures: [{stage: 'manifest', target: `${m.provider} ${m.key}`, error: r && r.error}],
        manifestsUploaded: false,
        failedAt: 'manifest',
      };
    }
  }

  return {ok: true, transferred, failures: [], manifestsUploaded: true};
}

module.exports = {
  REQUIRED_OPS,
  requireOps,
  createChildRegistry,
  createCleanup,
  runPool,
  withRetry,
  orchestrateUpload,
};
