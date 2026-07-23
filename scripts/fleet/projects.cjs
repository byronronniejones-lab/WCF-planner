#!/usr/bin/env node
// ============================================================================
// scripts/fleet/projects.cjs — TEST fleet project registry + fail-closed guard
// ============================================================================
// Single source of truth for the Supabase project name/ref map used by the
// fleet bootstrap, drift attestation, and per-project lease routing. This is
// TOOLING/CI code only — it is NEVER imported by src/ (browser bundle). The
// browser build gets its URL/keys from CI secrets, not from these refs.
//
// The map is an explicit ALLOWLIST (TEST A-D are the only bootstrap targets)
// plus a DENYLIST anchor (PROD Farm Planner). Every remote-mutating helper in
// the fleet toolkit resolves its target through assertBootstrapTarget() so an
// unknown, ambiguous, reference, or PROD target fails closed BEFORE any network
// call.
//
// The PROD ref literal is kept in lockstep with:
//   - tests/setup/assertTestDatabase.js  (const PROD_PROJECT_REF)
//   - scripts/test_db_lease_run.cjs      (const PROD_PROJECT_REF)
// A static test (tests/static/fleet_registry_static.test.js) locks all three
// together so they can never drift.
//
// Refs below are non-secret project identifiers (they appear in project URLs);
// they are safe to commit. NO key, password, JWT, or connection string lives
// here. Confirmed against `supabase projects list` for org
// zfvnozibtxdoygzwekrs on 2026-07-23.
// ============================================================================
'use strict';

// PROD — ABSOLUTELY PROHIBITED. Never a bootstrap/seed/reset/migrate/probe/
// deploy target. Kept identical to assertTestDatabase.js + test_db_lease_run.cjs.
const PROD_PROJECT_REF = 'pzfujbjtayhkdlxiblwe';

// Canonical registry. Keys are the stable logical identifiers used by CLI
// targeting, lease groups, and CI environments. `role`:
//   'prod-prohibited' — hard stop, never touched by this toolkit.
//   'reference'       — read-only known-good baseline (wcf-planner-test-main).
//   'bootstrap'       — TEST A-D, authorized for TEST-only bootstrap writes.
const PROJECTS = Object.freeze({
  prod: Object.freeze({
    key: 'prod',
    ref: PROD_PROJECT_REF,
    name: 'Farm Planner',
    region: 'us-west-2',
    role: 'prod-prohibited',
    lease: null,
    lane: null,
    shard: null,
  }),
  // QUARANTINED 2026-07-23: Supabase Disk I/O Budget depletion. Read-only
  // inspection only; never a browser-test/lease/CI target while quarantined.
  // lease is null so lease routing refuses it; role stays 'reference'.
  'test-main': Object.freeze({
    key: 'test-main',
    ref: 'msxvjupafhkcrerulolv',
    name: 'wcf-planner-test-main',
    region: 'us-east-1',
    role: 'reference',
    quarantined: true,
    lease: null,
    lane: 'quarantined',
    shard: null,
  }),
  'test-a': Object.freeze({
    key: 'test-a',
    ref: 'dkigsoyejzjwldqtqkkn',
    name: 'TEST A',
    region: 'us-east-1',
    role: 'bootstrap',
    lease: 'wcf-test-db-a',
    lane: 1,
    shard: 1,
  }),
  'test-b': Object.freeze({
    key: 'test-b',
    ref: 'hiaisktuuropjnbfytwx',
    name: 'TEST B',
    region: 'us-east-1',
    role: 'bootstrap',
    lease: 'wcf-test-db-b',
    lane: 1,
    shard: 2,
  }),
  'test-c': Object.freeze({
    key: 'test-c',
    ref: 'fopyfgcspicjmzngvsxp',
    name: 'TEST C',
    region: 'us-east-1',
    role: 'bootstrap',
    lease: 'wcf-test-db-c',
    lane: 2,
    shard: 1,
  }),
  'test-d': Object.freeze({
    key: 'test-d',
    ref: 'ycwnlcgdwaimmxbjbyry',
    name: 'TEST D',
    region: 'us-east-1',
    role: 'bootstrap',
    lease: 'wcf-test-db-d',
    lane: 2,
    shard: 2,
  }),
});

const BOOTSTRAP_KEYS = Object.freeze(['test-a', 'test-b', 'test-c', 'test-d']);

class TargetError extends Error {
  constructor(message) {
    super(message);
    this.name = 'TargetError';
  }
}

// Normalize a user/CI-supplied target token to a canonical registry key.
// Accepts the canonical key ('test-a'), the display name ('TEST A'), and a few
// obvious spellings ('testa', 'a'), all case-insensitively. Deliberately does
// NOT accept a bare project ref — identity must be named, never inferred from a
// URL fragment or ref string floating in the environment.
function normalizeKey(token) {
  if (typeof token !== 'string' || token.trim() === '') {
    throw new TargetError(
      `Fleet target is missing or not a string (got: ${JSON.stringify(token)}). ` +
        'An explicit project assignment is required; there is no default or fallback target.',
    );
  }
  const t = token.trim().toLowerCase().replace(/\s+/g, '-').replace(/_/g, '-');
  const direct = {
    prod: 'prod',
    'farm-planner': 'prod',
    'test-main': 'test-main',
    'wcf-planner-test-main': 'test-main',
    main: 'test-main',
    'test-a': 'test-a',
    testa: 'test-a',
    a: 'test-a',
    'test-b': 'test-b',
    testb: 'test-b',
    b: 'test-b',
    'test-c': 'test-c',
    testc: 'test-c',
    c: 'test-c',
    'test-d': 'test-d',
    testd: 'test-d',
    d: 'test-d',
  };
  const key = direct[t];
  if (!key) {
    throw new TargetError(
      `Unknown fleet target "${token}". Known targets: ${Object.keys(PROJECTS).join(', ')}. ` +
        'Refusing to proceed against an unrecognized project (fail closed).',
    );
  }
  return key;
}

// Resolve any known target to its registry entry (including prod/reference).
function resolveTarget(token) {
  return PROJECTS[normalizeKey(token)];
}

function isProdRef(ref) {
  return ref === PROD_PROJECT_REF;
}

// Hard refusal used everywhere a ref is about to be acted on.
function assertNotProdRef(ref) {
  if (isProdRef(ref)) {
    throw new TargetError(
      `Refusing operation: ref "${ref}" is the PRODUCTION project (Farm Planner). ` +
        'PROD is absolutely prohibited for every fleet operation.',
    );
  }
}

// The core gate: resolve a target token and guarantee it is one of the
// authorized TEST A-D bootstrap projects. Throws (fail closed) on unknown,
// ambiguous, missing, reference-only, or PROD targets.
function assertBootstrapTarget(token) {
  const entry = resolveTarget(token); // throws on unknown/missing
  if (entry.role === 'prod-prohibited' || isProdRef(entry.ref)) {
    throw new TargetError(`Refusing: target "${entry.name}" (${entry.ref}) is PRODUCTION. Hard stop.`);
  }
  if (entry.role !== 'bootstrap') {
    throw new TargetError(
      `Refusing: target "${entry.name}" (${entry.key}) is not an authorized TEST bootstrap project. ` +
        `Authorized bootstrap targets: ${BOOTSTRAP_KEYS.join(', ')}. ` +
        `"${entry.name}" is role "${entry.role}" and must not receive bootstrap writes.`,
    );
  }
  if (!BOOTSTRAP_KEYS.includes(entry.key)) {
    throw new TargetError(`Refusing: target "${entry.key}" is not in the bootstrap allowlist.`);
  }
  return entry;
}

// Reverse lookup used to detect a surprising linked ref. Returns null when the
// ref is not in the registry at all (which is itself a fail-closed signal).
function keyForRef(ref) {
  for (const entry of Object.values(PROJECTS)) {
    if (entry.ref === ref) return entry.key;
  }
  return null;
}

// After `supabase link`, the linked ref MUST equal the intended target and MUST
// NOT be PROD. Pure so it is trivially unit-tested.
function assertLinkedRefMatches(intendedRef, actualRef) {
  assertNotProdRef(actualRef);
  if (typeof actualRef !== 'string' || actualRef.trim() === '') {
    throw new TargetError(
      'Link verification failed: no linked project ref found (supabase/.temp/project-ref missing/empty).',
    );
  }
  if (actualRef !== intendedRef) {
    throw new TargetError(
      `Link verification failed: linked ref "${actualRef}" (${keyForRef(actualRef) || 'unknown project'}) ` +
        `does not match the intended target "${intendedRef}" (${keyForRef(intendedRef) || 'unknown'}). Refusing to operate on the wrong project.`,
    );
  }
  return true;
}

module.exports = {
  PROD_PROJECT_REF,
  PROJECTS,
  BOOTSTRAP_KEYS,
  TargetError,
  normalizeKey,
  resolveTarget,
  isProdRef,
  assertNotProdRef,
  assertBootstrapTarget,
  keyForRef,
  assertLinkedRefMatches,
};
