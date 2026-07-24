// Pure layout/policy logic for the disaster-recovery RESTORE runner (Phase 1).
//
// Everything here is a pure function with no I/O, no network, and no secrets, so
// the destination guards, generation pinning, and manifest/checksum verification
// can be unit-tested without a database, a provider, or any credential. The
// runner (scripts/dr_restore.cjs) is the only caller.
//
// SAFETY POSTURE — this module is the last line of defence against a restore
// writing to the wrong database. A restore is a bulk overwrite; pointed at the
// wrong project it would be catastrophic and, for PROD, irreversible. So the
// destination guard is deny-by-default: it refuses unless an explicit recovery
// project reference, URL, DSN, and a confirmation string tied to that exact
// reference all agree, AND none of them names a known PROD/TEST project.
//
// Key layout is shared with the backup runner via dr_layout.cjs so a restore
// fetches EXACTLY the keys a backup wrote; drift there would silently fetch the
// wrong or a non-existent object.

'use strict';

const L = require('./dr_layout.cjs');

// Known project references that a restore must NEVER target. Dashboard-confirmed
// (see PROJECT.md fleet inventory). PROD is the production database; test-main is
// quarantined; TEST A-D are the isolated browser fleet. The recovery project must
// be a NEW project whose reference is not in this set.
const FORBIDDEN_PROJECT_REFS = Object.freeze({
  pzfujbjtayhkdlxiblwe: 'PROD (Farm Planner)',
  msxvjupafhkcrerulolv: 'wcf-planner-test-main (quarantined)',
  dkigsoyejzjwldqtqkkn: 'TEST A',
  hiaisktuuropjnbfytwx: 'TEST B',
  fopyfgcspicjmzngvsxp: 'TEST C',
  ycwnlcgdwaimmxbjbyry: 'TEST D',
});

// A Supabase project reference is 20 lowercase alphanumerics.
const PROJECT_REF_RE = /^[a-z0-9]{20}$/;

// The confirmation string a caller must supply, tied to the exact recovery ref.
// Deliberately verbose so it cannot be typed by muscle memory or reused across
// projects.
function requiredConfirmation(projectRef) {
  return `RESTORE INTO ${projectRef}`;
}

/**
 * Deny-by-default recovery-destination guard. Returns {ok:true} or throws with a
 * message that NEVER contains the DSN (it carries a password). Every check must
 * pass; a single disagreement refuses the whole restore.
 */
function assertRecoveryDestination({projectRef, projectUrl, dsn, confirmation} = {}) {
  const need = {projectRef, projectUrl, dsn, confirmation};
  for (const [k, v] of Object.entries(need)) {
    if (typeof v !== 'string' || v.trim() === '') {
      throw new Error(`refusing restore: missing required destination field "${k}"`);
    }
  }
  if (!PROJECT_REF_RE.test(projectRef)) {
    throw new Error(`refusing restore: projectRef "${projectRef}" is not a valid 20-char Supabase reference`);
  }
  if (FORBIDDEN_PROJECT_REFS[projectRef]) {
    throw new Error(
      `refusing restore: ${projectRef} is ${FORBIDDEN_PROJECT_REFS[projectRef]} — never a restore target`,
    );
  }
  // Defence in depth: the DSN and URL must NOT contain any forbidden reference,
  // even as a substring, so a mistyped recovery ref that still points at PROD/
  // TEST cannot slip through. Do not echo the DSN itself.
  for (const [ref, label] of Object.entries(FORBIDDEN_PROJECT_REFS)) {
    if (dsn.includes(ref)) throw new Error(`refusing restore: DSN references ${label}`);
    if (projectUrl.includes(ref)) throw new Error(`refusing restore: project URL references ${label}`);
  }
  // The DSN and URL must actually belong to the declared recovery project, so a
  // caller cannot pass a safe-looking ref while the DSN targets something else.
  if (!dsn.includes(projectRef)) {
    throw new Error(`refusing restore: DSN does not reference the declared recovery project ${projectRef}`);
  }
  if (!projectUrl.includes(projectRef)) {
    throw new Error(`refusing restore: project URL does not reference the declared recovery project ${projectRef}`);
  }
  // A recovery restore only ever targets the direct database host of a managed
  // project. Refuse anything that is not a supabase.co/.com host to keep the
  // write path off arbitrary databases.
  if (!/supabase\.(co|com)/i.test(dsn)) {
    throw new Error('refusing restore: DSN host is not a managed Supabase host');
  }
  const expected = requiredConfirmation(projectRef);
  if (confirmation !== expected) {
    throw new Error(`refusing restore: confirmation string must be exactly "${expected}"`);
  }
  return {ok: true, projectRef};
}

/**
 * Pin an EXPLICIT backup generation. There is deliberately no "latest": a restore
 * must name the exact generation it intends to recover, so a silent pointer move
 * can never restore an unexpected snapshot. Reuses the backup runId validator.
 */
function requireExplicitGeneration(runId) {
  if (typeof runId !== 'string' || runId.trim() === '') {
    throw new Error('refusing restore: an explicit generation (YYYYMMDDTHHMMSSZ) is required — no "latest"');
  }
  if (/latest|current|newest/i.test(runId)) {
    throw new Error(`refusing restore: symbolic generation "${runId}" is not allowed; pin an exact run id`);
  }
  L.runIdParts(runId); // throws unless it matches YYYYMMDDTHHMMSSZ
  return runId;
}

/**
 * R2 object keys for one generation. The DB package + manifests carry the runId
 * in their filename so they are not @-suffixed; storage bodies share a path
 * across generations so they ARE @runId-suffixed. Reuses dr_layout so restore
 * and backup can never disagree on where an object lives.
 */
function restoreSourceKeys(runId, tier = 'hourly') {
  const db = L.databaseKeys(runId, tier);
  return {
    dbPackage: db.dump,
    dbManifest: db.manifest,
    storageManifest: L.storageManifestKey(runId),
    storageObjectKey: (bucket, objectPath) => L.storageObjectKey('r2', bucket, objectPath, runId),
  };
}

const SHA256_RE = /^[0-9a-f]{64}$/;

/**
 * Structural + coverage verification of the fetched manifest BEFORE any restore.
 * The backup writes the SAME manifest to the db-manifest and storage-manifest
 * keys, so one object carries both database{} and storage{}. Returns collected
 * errors rather than throwing so the runner can print them all at once.
 */
function verifyManifest(manifest, {runId, tier}) {
  const errors = [];
  if (!manifest || typeof manifest !== 'object')
    return {ok: false, errors: ['manifest missing or not an object'], objects: []};
  if (manifest.run_id !== runId) errors.push(`manifest run_id ${manifest.run_id} != requested ${runId}`);
  if (manifest.tier !== tier) errors.push(`manifest tier ${manifest.tier} != requested ${tier}`);
  if (manifest.coverage !== 'database-and-storage') {
    errors.push(`coverage is "${manifest.coverage}" — a database-only generation cannot prove a full restore`);
  }
  const db = manifest.database || {};
  if (!SHA256_RE.test(db.dump_sha256 || '')) errors.push('database.dump_sha256 missing or malformed');
  if (!SHA256_RE.test(db.encrypted_sha256 || '')) errors.push('database.encrypted_sha256 missing or malformed');
  if (db.encryption !== 'age-asymmetric') errors.push(`database.encryption is "${db.encryption}", not age-asymmetric`);
  if (!Number.isInteger(db.dump_bytes) || db.dump_bytes <= 0)
    errors.push('database.dump_bytes missing or non-positive');

  const st = manifest.storage || {};
  const objects = Array.isArray(st.objects) ? st.objects : [];
  if (!Array.isArray(st.objects)) errors.push('storage.objects is missing');
  else if (st.objects.length !== st.total_objects) {
    errors.push(`storage.total_objects ${st.total_objects} != objects[] length ${st.objects.length}`);
  }
  for (const o of objects) {
    if (!o || typeof o.bucket !== 'string' || typeof o.path !== 'string' || !Number.isInteger(o.size)) {
      errors.push(`malformed storage object entry: ${JSON.stringify(o)?.slice(0, 80)}`);
      break;
    }
  }
  return {ok: errors.length === 0, errors, objects};
}

/**
 * Compare an observed sha256 against the manifest's expected value. Throws on
 * mismatch (fail-closed). Used for the encrypted package BEFORE decrypt and the
 * decrypted dump AFTER decrypt. Only prefixes are shown; a hash is not a secret
 * but there is no reason to print it in full.
 */
function assertSha256(actualHex, expectedHex, label) {
  if (!SHA256_RE.test(expectedHex || '')) {
    throw new Error(`refusing restore: no valid expected checksum for ${label}`);
  }
  if (actualHex !== expectedHex) {
    throw new Error(
      `refusing restore: ${label} checksum mismatch (expected ${String(expectedHex).slice(0, 12)}…, got ${String(actualHex).slice(0, 12)}…)`,
    );
  }
  return true;
}

/**
 * Verify a completed Storage restore against the manifest: exact count, and each
 * manifested (bucket,path) present with the recorded byte size. Returns collected
 * problems. Checksum note: R2 storage bodies were copied byte-for-byte from
 * Supabase and the manifest records the source eTag + size; size + path + count
 * are the verifiable invariants here (there is no separately stored per-object
 * sha for storage bodies), so the runner also re-hashes on download where it can.
 */
function verifyStorageCoverage(manifestObjects, restored) {
  const errors = [];
  const wantCount = manifestObjects.length;
  const gotCount = restored.length;
  if (gotCount !== wantCount) errors.push(`restored ${gotCount} storage objects, manifest lists ${wantCount}`);
  const restoredBySig = new Map(restored.map((r) => [`${r.bucket} ${r.path}`, r]));
  for (const m of manifestObjects) {
    const hit = restoredBySig.get(`${m.bucket} ${m.path}`);
    if (!hit) {
      errors.push(`missing after restore: ${m.bucket}/${m.path}`);
      continue;
    }
    if (Number.isInteger(m.size) && Number.isInteger(hit.size) && hit.size !== m.size) {
      errors.push(`size mismatch ${m.bucket}/${m.path}: manifest ${m.size} vs restored ${hit.size}`);
    }
  }
  return {ok: errors.length === 0, errors};
}

module.exports = {
  FORBIDDEN_PROJECT_REFS,
  PROJECT_REF_RE,
  requiredConfirmation,
  assertRecoveryDestination,
  requireExplicitGeneration,
  restoreSourceKeys,
  verifyManifest,
  assertSha256,
  verifyStorageCoverage,
  // Re-exported so the runner has one redaction owner shared with the backup lane.
  redactSecrets: L.redactSecrets,
};
