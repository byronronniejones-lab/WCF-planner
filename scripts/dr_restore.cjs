// Disaster-recovery ISOLATED RESTORE runner (Build Queue item 1, Phase 1).
//
// Proves a backup generation can be recovered into an ISOLATED, TEMPORARY
// Supabase recovery project — never PROD, never the TEST fleet. Phase 1 is
// tooling + fail-closed design only: it does not create the recovery project,
// does not handle secret VALUES (only caller-supplied file PATHS), and stops at
// the one design fork below that needs an explicit plaintext-handling decision.
//
// SOURCE IS R2. The DB package + manifests + 828 storage bodies are read from
// Cloudflare R2, whose credential already supports reading. The B2 writer key is
// intentionally write-focused and is NOT used or widened here.
//
// SECRET HANDLING. The recovery DSN, the R2 read credential, and the age PRIVATE
// identity are supplied ONLY as file paths OUTSIDE the repository. Their contents
// are never printed, never logged, never placed on a command line, and never
// written into the repo. The age identity in particular must remain in
// 1Password / offline custody and must never reach GitHub, a workflow secret, a
// manifest, or an AI prompt.
//
// GENERATION IS EXPLICIT. There is no "latest": a restore names the exact
// generation (default target 20260724T180923Z, the first complete baseline).
//
// PLAINTEXT / STREAMING FORK (see runDbRestore): the dump is pg_dump custom
// format. A SAFE restore into a managed Supabase project must be SELECTIVE (never
// blindly overwrite Supabase-managed auth/storage schema), and selective restore
// needs the archive TOC (pg_restore -l / -L), which requires a SEEKABLE archive —
// a decrypt-into-pg_restore PIPE is one-pass and cannot do it. So pure streaming
// is unsafe for the required plan; materialising the decrypted dump has real
// plaintext-on-disk implications (it contains auth.users emails + password
// hashes). Phase 1 therefore STOPS here and reports, rather than choosing a
// plaintext design unilaterally.
//
// Exit codes: 0 ok; 1 a step failed; 2 usage/config/guard refusal; 3 a design
// decision is required before proceeding.
'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const {execFileSync, spawn} = require('child_process');
const RL = require('./lib/dr_restore_layout.cjs');

const argv = process.argv.slice(2);
const arg = (k, d = null) => {
  const hit = argv.find((a) => a.startsWith(`--${k}=`));
  return hit ? hit.slice(k.length + 3) : d;
};

// ---------------------------------------------------------------------------
// Caller-supplied secret FILES. We hold paths, never values. readSecretFile
// returns the trimmed content for use in-process; the content is never printed
// and every value read here is registered for stderr redaction.
const SECRET_VALUES = [];
function registerSecret(v) {
  if (typeof v === 'string' && v.length >= 8) SECRET_VALUES.push(v);
  return v;
}
const clean = (t) => RL.redactSecrets(t, SECRET_VALUES);

function refuse(msg, code = 2) {
  console.error(clean(`refusing: ${msg}`));
  process.exit(code);
}

function resolveExternalPath(p, label, {read}) {
  if (!p)
    refuse(
      `--${label} is required (a file path OUTSIDE the repo; contents are never printed${read ? '' : ' or read'})`,
    );
  const abs = path.resolve(p);
  const repoRoot = path.resolve(__dirname, '..');
  if (abs.startsWith(repoRoot + path.sep)) {
    refuse(`--${label} must live OUTSIDE the repository (got a path inside ${path.basename(repoRoot)})`);
  }
  if (!fs.existsSync(abs)) refuse(`--${label} file not found (path is not printed for safety)`);
  return abs;
}

function readSecretFile(p, label) {
  const abs = resolveExternalPath(p, label, {read: true});
  const raw = fs.readFileSync(abs, 'utf8').trim();
  if (!raw) refuse(`--${label} file is empty`);
  return raw;
}

// The age PRIVATE identity is handled by PATH ONLY. Phase 1 never reads it, and
// the (later) decrypt passes the path to `age -d -i <path>` so the key material
// never enters this process, a log, a manifest, or an argv value. Validate the
// path exists and lives outside the repo; never read or print its contents.
function assertAgeIdentityPath() {
  return resolveExternalPath(arg('age-identity'), 'age-identity', {read: false});
}

// ---------------------------------------------------------------------------
// Modes: preflight (read-only, verify source + manifests + checksums, no writes,
// no plaintext) and execute (adds the actual restore; DB restore stops at the
// plaintext fork in Phase 1).
const mode = arg('mode', 'preflight');
if (!['preflight', 'execute'].includes(mode)) refuse(`--mode must be preflight or execute (got "${mode}")`);

// Explicit generation, no "latest".
const generation = RL.requireExplicitGeneration(arg('generation', '20260724T180923Z'));
const tier = arg('tier', 'hourly');

// Destination is described by a recovery-config JSON file (OUTSIDE the repo)
// carrying {projectRef, projectUrl, dsn}; dsn is a secret. Plus an explicit
// --confirm string tied to the exact recovery reference.
function loadRecoveryConfig() {
  const raw = readSecretFile(arg('recovery-config'), 'recovery-config');
  let cfg;
  try {
    cfg = JSON.parse(raw);
  } catch {
    refuse('--recovery-config is not valid JSON (contents not printed)');
  }
  registerSecret(cfg.dsn);
  const confirmation = arg('confirm');
  // Deny-by-default destination guard. Throws (never prints the DSN) on any
  // disagreement; a mistyped ref that still points at PROD/TEST is refused.
  try {
    RL.assertRecoveryDestination({
      projectRef: cfg.projectRef,
      projectUrl: cfg.projectUrl,
      dsn: cfg.dsn,
      confirmation,
    });
  } catch (e) {
    refuse(clean(e.message));
  }
  return cfg;
}

// R2 read credential file: JSON {accessKeyId, secretAccessKey, endpoint, bucket,
// region}. Values registered for redaction; never printed.
function loadR2Cred() {
  const raw = readSecretFile(arg('r2-cred'), 'r2-cred');
  let c;
  try {
    c = JSON.parse(raw);
  } catch {
    refuse('--r2-cred is not valid JSON (contents not printed)');
  }
  for (const k of ['accessKeyId', 'secretAccessKey', 'endpoint', 'bucket']) {
    if (!c[k]) refuse(`--r2-cred is missing "${k}"`);
  }
  registerSecret(c.accessKeyId);
  registerSecret(c.secretAccessKey);
  return c;
}

function hasBinary(bin) {
  try {
    execFileSync(bin, ['--version'], {stdio: 'ignore'});
    return true;
  } catch {
    return false;
  }
}

/** Read-only R2 environment for the AWS CLI. Credentials by env only, never argv. */
function r2Env(cred) {
  return {
    ...process.env,
    AWS_ACCESS_KEY_ID: cred.accessKeyId,
    AWS_SECRET_ACCESS_KEY: cred.secretAccessKey,
    AWS_DEFAULT_REGION: cred.region || 'auto',
    AWS_REQUEST_CHECKSUM_CALCULATION: 'when_required',
  };
}
function r2Endpoint(cred) {
  const raw = cred.endpoint;
  return raw.startsWith('http') ? raw : `https://${raw}`;
}

// Read-only R2 operations the restore is allowed to use. An unrecognised op is
// refused rather than assumed safe (mirrors the backup runner's allowlist stance).
const R2_READ_OPS = Object.freeze(['get-object', 'head-object', 'list-objects-v2']);
function assertR2ReadOnly(op) {
  if (!R2_READ_OPS.includes(op))
    throw new Error(`refusing R2 op "${op}": restore reads only (${R2_READ_OPS.join(', ')})`);
  return op;
}

/** Download an R2 object to a Buffer (small objects: manifests). Read-only. */
function r2GetObjectBuffer(cred, key) {
  assertR2ReadOnly('get-object');
  const tmp = path.join(require('os').tmpdir(), `wcf-dr-r2-${crypto.randomBytes(6).toString('hex')}`);
  try {
    execFileSync(
      'aws',
      ['s3api', 'get-object', '--bucket', cred.bucket, '--key', key, '--endpoint-url', r2Endpoint(cred), tmp],
      {stdio: ['ignore', 'ignore', 'pipe'], env: r2Env(cred)},
    );
    return fs.readFileSync(tmp);
  } finally {
    try {
      fs.rmSync(tmp, {force: true});
    } catch {
      /* best effort */
    }
  }
}

/** Stream an R2 object through a sha256 hash WITHOUT staging plaintext. Read-only. */
function r2HashObject(cred, key) {
  return new Promise((resolve, reject) => {
    assertR2ReadOnly('get-object');
    const child = spawn('aws', ['s3', 'cp', `s3://${cred.bucket}/${key}`, '-', '--endpoint-url', r2Endpoint(cred)], {
      stdio: ['ignore', 'pipe', 'pipe'],
      env: r2Env(cred),
    });
    const h = crypto.createHash('sha256');
    let bytes = 0;
    let err = '';
    child.stdout.on('data', (c) => {
      h.update(c);
      bytes += c.length;
    });
    child.stderr.on('data', (c) => (err += c.toString()));
    child.on('close', (code) => {
      if (code !== 0) return reject(new Error(`r2 read exited ${code}: ${clean(err).slice(-300)}`));
      resolve({sha256: h.digest('hex'), bytes});
    });
  });
}

const say = (s = '') => console.log(s);

/**
 * PREFLIGHT — read-only. Verifies the recovery destination guard, the R2 source,
 * the manifest structure/coverage, and the encrypted package checksum, and
 * reports the restore plan. Writes nothing and decrypts nothing.
 */
async function runPreflight(cfg, r2) {
  const keys = RL.restoreSourceKeys(generation, tier);
  say(`\nDR restore PREFLIGHT — generation ${generation} (tier ${tier})`);
  say('='.repeat(64));
  say(`  destination: recovery project ${cfg.projectRef} (guard passed; DSN not shown)`);
  say(`  source: R2 bucket ${r2.bucket} (read-only)`);

  // Manifest (db + storage share the same content; verify the db-manifest key).
  const manifestBuf = r2GetObjectBuffer(r2, keys.dbManifest);
  let manifest;
  try {
    manifest = JSON.parse(manifestBuf.toString('utf8'));
  } catch {
    refuse('fetched manifest is not valid JSON', 1);
  }
  const mv = RL.verifyManifest(manifest, {runId: generation, tier});
  if (!mv.ok) {
    say('  MANIFEST VERIFICATION FAILED:');
    for (const e of mv.errors) say(`    - ${e}`);
    refuse('manifest verification failed; not proceeding', 1);
  }
  say(`  manifest OK: coverage ${manifest.coverage}, ${mv.objects.length} storage objects`);

  // Encrypted package integrity BEFORE any decrypt: hash the ciphertext stream
  // and compare to the manifest's recorded encrypted_sha256. No plaintext.
  const enc = await r2HashObject(r2, keys.dbPackage);
  RL.assertSha256(enc.sha256, manifest.database.encrypted_sha256, 'encrypted database package');
  say(`  encrypted package OK: ${enc.bytes} bytes, sha256 matches manifest`);
  say(`  plan: restore DB (${manifest.database.dump_bytes} plaintext bytes) + ${mv.objects.length} storage objects`);
  say(`  NOT covered by the package (must be re-entered/reconciled, never copied blindly):`);
  const nb = manifest.not_backed_up || {};
  say(
    `    ${(nb.vault_secret_names || []).length} vault secrets, ${(nb.cron_jobs || []).length} cron schedules, ${(nb.extensions || []).length} extensions, Edge/Netlify env`,
  );
  return {manifest, objects: mv.objects};
}

/**
 * DB RESTORE — Phase 1 DESIGN FORK. The custom-format dump requires a SELECTIVE,
 * non-clobbering restore into a managed Supabase project (auth/storage schemas
 * are Supabase-owned). Selective restore needs the archive TOC (pg_restore -l/-L)
 * on a SEEKABLE archive, which a decrypt→pg_restore pipe cannot provide. So the
 * safe plan cannot be pure-streamed, and materialising the decrypted dump has
 * plaintext-on-disk implications (auth.users emails + password hashes). Stop and
 * report; do not choose a plaintext-handling design unilaterally.
 */
function runDbRestore(_ageIdentityPath) {
  console.error(
    clean(
      'DESIGN DECISION REQUIRED before DB restore: streaming (decrypt→pg_restore pipe) ' +
        'cannot do the SELECTIVE, non-clobbering restore a managed Supabase project needs ' +
        '(TOC/-L filtering requires a seekable archive). Materialising the decrypted dump ' +
        'means transient plaintext on disk (auth.users emails + password hashes). ' +
        'Choose the plaintext-handling design (e.g. tmpfs/ramdisk + 0600 + secure-delete) ' +
        'before Phase 2 implements this step.',
    ),
  );
  process.exit(3);
}

(async () => {
  if (mode === 'execute' || mode === 'preflight') {
    if (!hasBinary('aws')) {
      refuse('the AWS CLI (S3-compatible client) is required on PATH to read R2. Phase 1 does not install it.');
    }
    if (!hasBinary('age')) refuse('age is required on PATH for the (later) decrypt step.');
  }
  const cfg = loadRecoveryConfig();
  const r2 = loadR2Cred();
  // Validate the age identity PATH now (never read it) so the full input contract
  // is enforced up front for both modes; the decrypt (Phase 2) passes it to age.
  const ageIdentityPath = assertAgeIdentityPath();
  await runPreflight(cfg, r2);
  if (mode === 'preflight') {
    say('  age identity: staged (path validated; contents never read)');
    say('\npreflight complete — read-only, nothing written or decrypted.\n');
    process.exit(0);
  }
  // execute: DB restore stops at the plaintext fork in Phase 1.
  runDbRestore(ageIdentityPath);
})().catch((e) => {
  refuse(e && e.message ? e.message : 'unknown restore error', 1);
});
