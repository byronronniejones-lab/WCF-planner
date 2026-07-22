// Pure layout/policy logic for the disaster-recovery backup runner.
//
// Everything here is a pure function with no I/O, no network, and no secrets,
// so the object-key layout, retention policy, incremental diff, and redaction
// rules can be unit-tested without touching PROD or a provider. The runner
// (scripts/dr_backup.cjs) is the only caller.
//
// Verified provider configuration this encodes:
//   B2  wcf-planner-dr-primary-2026, s3.us-east-005.backblazeb2.com,
//       Object Lock ON, default governance 2 days. Per-object retention is
//       applied explicitly by tier (below) because the bucket default is only
//       2 days and daily/monthly/storage generations must outlive that.
//   R2  wcf-planner-dr-secondary-2026, prefix lock rules already configured
//       (all 2d, db/daily 35d, db/monthly 365d, storage 35d). R2 has no object
//       versioning, so every R2 key carries the run timestamp for uniqueness.
//
// RETENTION SEMANTICS — READ THIS BEFORE QUOTING A GENERATION COUNT.
// The values below are a MINIMUM IMMUTABILITY WINDOW: how long an object
// CANNOT be deleted. They are NOT an expiry schedule and they do NOT cap how
// many generations exist.
//
// By explicit decision for the initial release, B2 has NO lifecycle rule and
// the writer key has neither deleteFiles nor bypassGovernance. Nothing in this
// system ever deletes anything. Once the immutability window lapses an object
// simply becomes deletable-in-principle and then stays stored INDEFINITELY.
//
// So "48 hourly / 35 daily / 12 monthly generations" is NOT enforced anywhere
// and must not be described as if it were. Actual behaviour is: every
// generation is kept forever until a separately gated lifecycle policy is
// adopted. At ~2.2 MB per hourly generation that is roughly 19 GB per year.

'use strict';

// MINIMUM IMMUTABILITY in days, by tier. B2 sends these as explicit per-object
// governance retain-until dates; R2 relies on its verified prefix lock rules.
// See the retention-semantics note above: this is a delete-protection floor,
// not an expiry policy.
const MIN_IMMUTABLE_DAYS = Object.freeze({
  hourly: 2,
  daily: 35,
  monthly: 365,
  storage: 35,
});

// Physical retention is unbounded by design for the initial release. Exported
// so tests and reports can assert the distinction rather than restating prose.
const PHYSICAL_RETENTION = Object.freeze({
  policy: 'indefinite',
  enforcedGenerationCaps: null,
  reason: 'no B2 lifecycle rule and no delete capability; expiry requires a separately gated policy',
});

/** Split a run id (20260721T124914Z) into date parts. Throws on malformed input. */
function runIdParts(runId) {
  if (typeof runId !== 'string' || !/^\d{8}T\d{6}Z$/.test(runId)) {
    throw new Error(`invalid runId: expected YYYYMMDDTHHMMSSZ, got ${JSON.stringify(runId)}`);
  }
  return {yyyy: runId.slice(0, 4), mm: runId.slice(4, 6), dd: runId.slice(6, 8)};
}

/**
 * Canonical object keys for one database generation.
 * hourly  -> db/hourly/YYYY/MM/DD/...
 * daily   -> db/daily/YYYY/MM/...
 * monthly -> db/monthly/YYYY/...
 */
function databaseKeys(runId, tier = 'hourly') {
  const {yyyy, mm, dd} = runIdParts(runId);
  if (!Object.prototype.hasOwnProperty.call(MIN_IMMUTABLE_DAYS, tier) || tier === 'storage') {
    throw new Error(`invalid database tier: ${tier}`);
  }
  const prefix =
    tier === 'hourly'
      ? `db/hourly/${yyyy}/${mm}/${dd}`
      : tier === 'daily'
        ? `db/daily/${yyyy}/${mm}`
        : `db/monthly/${yyyy}`;
  return {
    dump: `${prefix}/wcf-db-${runId}.dump.age`,
    manifest: `${prefix}/wcf-db-${runId}.manifest.json`,
  };
}

/** Key for the storage inventory manifest of one run. */
function storageManifestKey(runId) {
  const {yyyy, mm, dd} = runIdParts(runId);
  return `storage/manifests/${yyyy}/${mm}/${dd}/storage-${runId}.json`;
}

/**
 * Storage object key. B2 mirrors the exact source path and relies on native
 * file versioning for history. R2 has NO versioning, so the run timestamp is
 * appended to keep every generation of a replaced file distinct.
 */
function storageObjectKey(provider, bucket, objectPath, runId) {
  if (provider !== 'b2' && provider !== 'r2') throw new Error(`invalid provider: ${provider}`);
  if (!bucket || !objectPath) throw new Error('bucket and objectPath are required');
  const base = `storage/objects/${bucket}/${objectPath}`;
  if (provider === 'b2') return base;
  runIdParts(runId); // validate shape before it becomes part of a key
  return `${base}@${runId}`;
}

/** Immutability tier implied by an object key. Used to pick the B2 retain-until date. */
function tierForKey(key) {
  if (key.startsWith('db/hourly/')) return 'hourly';
  if (key.startsWith('db/daily/')) return 'daily';
  if (key.startsWith('db/monthly/')) return 'monthly';
  if (key.startsWith('storage/')) return 'storage';
  throw new Error(`cannot determine retention tier for key: ${key}`);
}

/**
 * Minimum immutability in days for an object key. This is a delete-protection
 * floor, NOT an expiry schedule -- nothing deletes the object afterwards.
 */
function minImmutableDaysForKey(key) {
  return MIN_IMMUTABLE_DAYS[tierForKey(key)];
}

/**
 * B2 governance retain-until timestamp for a key, as an ISO-8601 UTC string.
 * `now` is injected so this is deterministic under test.
 */
function retainUntilForKey(key, now) {
  const base = now instanceof Date ? now : new Date(now);
  if (Number.isNaN(base.getTime())) throw new Error('invalid `now` timestamp');
  const days = minImmutableDaysForKey(key);
  return new Date(base.getTime() + days * 86400000).toISOString().replace(/\.\d{3}Z$/, 'Z');
}

/**
 * Incremental diff between the current storage inventory and a previous
 * manifest. Identity is (bucket, path); change is detected on (size, eTag),
 * because an overwrite changes at least one of them.
 */
function diffStorageObjects(current, previous) {
  const idOf = (o) => `${o.bucket} ${o.path}`;
  const sigOf = (o) => `${o.size} ${o.etag}`;
  const prevList = Array.isArray(previous) ? previous : [];
  const prevMap = new Map(prevList.map((o) => [idOf(o), sigOf(o)]));
  const currentIds = new Set(current.map(idOf));
  return {
    changed: current.filter((o) => prevMap.get(idOf(o)) !== sigOf(o)),
    unchanged: current.filter((o) => prevMap.get(idOf(o)) === sigOf(o)),
    removed: prevList.filter((o) => !currentIds.has(idOf(o))),
  };
}

/**
 * Remove secret values from arbitrary text before it is printed or logged.
 * Child-process stderr is the main risk: psql and the AWS CLI both echo
 * connection strings and endpoints on failure.
 */
function redactSecrets(text, secrets) {
  let out = String(text ?? '');
  const list = (Array.isArray(secrets) ? secrets : [])
    .filter((s) => typeof s === 'string' && s.length >= 8)
    .sort((a, b) => b.length - a.length); // longest first so substrings can't unmask
  for (const secret of list) out = out.split(secret).join('[REDACTED]');
  // Belt and braces: scrub any surviving credential-shaped URI.
  out = out.replace(/([a-z][a-z0-9+.-]*:\/\/)[^\s/@]+:[^\s/@]+@/gi, '$1[REDACTED]@');
  return out;
}

/**
 * Configuration required before --execute may run. Returning the MISSING names
 * (never values) lets the runner refuse with an actionable message and lets a
 * test assert fail-closed behavior.
 */
// Destination + encryption config. Required for EVERY execute and for preflight
// (the age recipient encrypts the db package; B2/R2 are the two backup targets).
// This is intentionally the base set that a database-only run also needs, which
// is why the Supabase Storage READ credential is NOT here — see
// STORAGE_SOURCE_CONFIG below.
const REQUIRED_EXECUTE_CONFIG = Object.freeze([
  'DR_AGE_RECIPIENT',
  'DR_B2_BUCKET',
  'DR_B2_ENDPOINT',
  'DR_B2_KEY_ID',
  'DR_B2_APPLICATION_KEY',
  'DR_R2_BUCKET',
  'DR_R2_ENDPOINT',
  'DR_R2_ACCESS_KEY_ID',
  'DR_R2_SECRET_ACCESS_KEY',
]);

// Supabase Storage READ credential. Required ONLY when a run actually transfers
// storage bodies (a full execute with changed objects). A --database-only run
// deliberately does not need it, so requiring it unconditionally would wrongly
// block the database-only escape hatch.
const STORAGE_SOURCE_CONFIG = Object.freeze([
  'DR_STORAGE_S3_ACCESS_KEY_ID',
  'DR_STORAGE_S3_SECRET_ACCESS_KEY',
  'DR_STORAGE_S3_ENDPOINT',
  'DR_STORAGE_S3_REGION',
]);

// ---------------------------------------------------------------------------
// Supabase Storage read-only enforcement.
//
// A generated Supabase Storage S3 key CANNOT be scoped: it grants full S3
// access across EVERY bucket, bypasses RLS, and offers no read-only or
// per-bucket option (confirmed against Supabase's S3 authentication docs).
// So the same credential this runner uses to COPY files out could also
// overwrite or delete all 3+ GB of production Storage.
//
// The runner must therefore never issue anything but reads against Supabase.
// These lists make that a mechanical, testable property instead of a habit.
//
// SCOPE OF THIS PROTECTION — be precise about it: this stops OUR code from
// writing, including by future regression. It does NOT protect against an
// attacker who has obtained the key, because they would call the API directly.
// Credential containment (GitHub Environment + protected branch) is what
// addresses that; this guard addresses accident and drift.
const SUPABASE_READ_OPS = Object.freeze(['get-object', 'head-object', 'list-objects-v2', 'head-bucket']);
const SUPABASE_FORBIDDEN_OPS = Object.freeze([
  'put-object',
  'copy-object',
  'delete-object',
  'delete-objects',
  'create-multipart-upload',
  'upload-part',
  'upload-part-copy',
  'complete-multipart-upload',
  'put-bucket-policy',
  'delete-bucket',
]);

/**
 * Throws unless `op` is an explicitly allowed read against Supabase Storage.
 * Allowlist, not denylist: an unrecognised operation is refused rather than
 * assumed safe.
 */
function assertSupabaseReadOnly(op) {
  if (!SUPABASE_READ_OPS.includes(op)) {
    throw new Error(
      `refusing Supabase Storage operation "${op}": the backup path is read-only. ` +
        `Allowed: ${SUPABASE_READ_OPS.join(', ')}.`,
    );
  }
  return op;
}

/**
 * Guard for the STREAMING source read, which the s3api allowlist above cannot
 * cover: streaming uses the high-level `aws s3 cp` because s3api put-object
 * needs a seekable body and a pipe is not seekable.
 *
 * `aws s3 cp A B` is an upload or a download purely by argument order, so a
 * transposition would turn a backup read into a write against production
 * Storage. This asserts the Supabase URI is the SOURCE and the destination is
 * stdout, which is the only shape a backup ever needs.
 */
function assertSupabaseDownloadOnly(source, dest) {
  if (typeof source !== 'string' || !source.startsWith('s3://')) {
    throw new Error(`refusing Supabase read: source must be an s3:// URI, got ${JSON.stringify(source)}`);
  }
  if (dest !== '-') {
    throw new Error(
      `refusing Supabase operation: destination must be stdout ("-"), got ${JSON.stringify(dest)}. ` +
        `Anything else would make this an UPLOAD to production Storage.`,
    );
  }
  return true;
}

/**
 * Exponential backoff delay in ms for attempt N (1-based), with a cap.
 * Pure so the schedule is unit-testable without waiting.
 */
function backoffMs(attempt, baseMs = 500, capMs = 8000) {
  if (!Number.isInteger(attempt) || attempt < 1) throw new Error(`invalid attempt: ${attempt}`);
  return Math.min(capMs, baseMs * 2 ** (attempt - 1));
}

const RETRY_ATTEMPTS = 3;
const TRANSFER_CONCURRENCY = 4;

function missingFrom(names, env) {
  const source = env || {};
  return names.filter((name) => {
    const v = source[name];
    return typeof v !== 'string' || v.trim() === '';
  });
}

function missingExecuteConfig(env) {
  return missingFrom(REQUIRED_EXECUTE_CONFIG, env);
}

function missingStorageSourceConfig(env) {
  return missingFrom(STORAGE_SOURCE_CONFIG, env);
}

/**
 * PURE execution decision. The single authority for "may this run proceed, and
 * with what coverage" — extracted so the rule is tested behaviorally rather than
 * by matching source spelling. A wrong boolean here is a defect a regex guard
 * cannot see, which is exactly the class of bug that slipped through before.
 *
 * Inputs:
 *   mode          'preflight' | 'dry-run' | 'execute'
 *   changedCount  number of storage objects the diff selected for transfer
 *   databaseOnly  explicit escape hatch: back up the database, not files
 *   env           process.env-shaped object (values are read, never logged)
 *
 * Returns a decision object; callers act on `phase`:
 *   {phase:'preflight', entersOrchestration:false}
 *   {phase:'dry-run',   entersOrchestration:false, uploads:false}
 *   {phase:'refuse',    entersOrchestration:false, missing:[...names]}
 *   {phase:'execute',   entersOrchestration:true,  uploads:true,
 *                       coverage, transfersStorage}
 */
function decideExecution({mode, changedCount = 0, databaseOnly = false, env = {}} = {}) {
  if (mode === 'preflight') {
    return {phase: 'preflight', entersOrchestration: false, uploads: false};
  }
  if (mode !== 'execute') {
    return {phase: 'dry-run', entersOrchestration: false, uploads: false};
  }

  // Only a full execute with pending objects needs the read credential. When
  // there is nothing to transfer (changedCount 0) or the operator asked for
  // database-only, the source credential is irrelevant.
  const transfersStorage = changedCount > 0 && !databaseOnly;
  if (transfersStorage) {
    const missing = missingStorageSourceConfig(env);
    if (missing.length > 0) {
      return {
        phase: 'refuse',
        entersOrchestration: false,
        uploads: false,
        missing,
        reason: 'storage-source credential incomplete',
      };
    }
  }

  return {
    phase: 'execute',
    entersOrchestration: true,
    uploads: true,
    transfersStorage,
    coverage: databaseOnly ? 'database-only' : 'database-and-storage',
  };
}

module.exports = {
  MIN_IMMUTABLE_DAYS,
  PHYSICAL_RETENTION,
  SUPABASE_READ_OPS,
  SUPABASE_FORBIDDEN_OPS,
  RETRY_ATTEMPTS,
  TRANSFER_CONCURRENCY,
  assertSupabaseReadOnly,
  assertSupabaseDownloadOnly,
  backoffMs,
  REQUIRED_EXECUTE_CONFIG,
  STORAGE_SOURCE_CONFIG,
  missingStorageSourceConfig,
  decideExecution,
  runIdParts,
  databaseKeys,
  storageManifestKey,
  storageObjectKey,
  tierForKey,
  minImmutableDaysForKey,
  retainUntilForKey,
  diffStorageObjects,
  redactSecrets,
  missingExecuteConfig,
};
