#!/usr/bin/env node
// ============================================================================
// scripts/fleet/bundle.cjs — generate + segment the repo bootstrap bundle
// ============================================================================
// scripts/build_test_bootstrap.js concatenates the 9-table hand seed + every
// migration (archive 001-026 + parent 027-190) + a TEST-only exec_sql into
// scripts/test-bootstrap.sql. That file cannot be applied as one transaction
// because three migrations have apply-time DO-block preflights that need
// fixture rows (see seeds.cjs). So we SPLIT the bundle at those boundaries and
// the bootstrap interleaves the synthetic fixture seeds:
//
//   handseed  -> [vault + Simon/Mak seeds] -> pre137 (migs .. 136)
//             -> [pig-pasture seed]         -> post137 (migs 137 ..) -> execsql
//
// Each segment is applied as its own `db query` call (one endpoint-wrapped
// transaction), so inner BEGIN/COMMIT are stripped. There are no CREATE INDEX
// CONCURRENTLY statements in the bundle (the only "concurrently" hits are
// comments), so single-transaction segments are safe.
// ============================================================================
'use strict';

const path = require('path');
const fs = require('fs');

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const BUNDLE_PATH = path.join(REPO_ROOT, 'scripts', 'test-bootstrap.sql');
const GENERATOR = path.join(REPO_ROOT, 'scripts', 'build_test_bootstrap.js');

// The migration number at/after which the pig-pasture fixture must already
// exist (mig 137). Everything strictly below goes in the pre-seed segment.
const PASTURE_BOUNDARY = 137;

const BANNER_SPLIT = /\n-- ={76}\n-- (.+)\n-- ={76}\n/;

function stripInnerTx(sql) {
  return sql.replace(/^\s*BEGIN\s*;\s*$/gim, '').replace(/^\s*COMMIT\s*;\s*$/gim, '');
}

// Generate scripts/test-bootstrap.sql from the repo (idempotent, deterministic).
async function buildBundle(io) {
  const res = await io.run('node', [GENERATOR], {cwd: REPO_ROOT, timeoutMs: 120000});
  if (res.code !== 0) {
    throw new Error(`build_test_bootstrap.js failed (exit ${res.code}): ${res.stderr || res.stdout}`);
  }
  return BUNDLE_PATH;
}

// Split the bundle text into {label, sql} chunks by banner. Returns [] preamble
// dropped. Pure — unit-testable.
function splitChunks(bundleText) {
  const parts = bundleText.split(BANNER_SPLIT);
  const chunks = [];
  for (let i = 1; i < parts.length; i += 2) {
    chunks.push({label: parts[i].trim(), sql: parts[i + 1] || ''});
  }
  return chunks;
}

function migrationNumber(label) {
  // e.g. "037_task_rls.sql", "archive/001_cattle_module.sql"
  const m = label.match(/(?:^|\/)(\d{3})_/);
  return m ? parseInt(m[1], 10) : null;
}

function classify(label) {
  if (/hand_created_tables_seed/i.test(label)) return 'handseed';
  if (/exec_sql/i.test(label)) return 'execsql';
  const n = migrationNumber(label);
  if (n == null) return 'other';
  return n < PASTURE_BOUNDARY ? 'pre137' : 'post137';
}

// Segment the bundle into the four ordered SQL blobs. Each blob has inner
// BEGIN/COMMIT stripped. `other`/unclassified chunks are folded into pre137 in
// document order so nothing is dropped (there should be none in practice).
function segmentBundle(bundleText) {
  const chunks = splitChunks(bundleText);
  const buckets = {handseed: [], pre137: [], post137: [], execsql: []};
  const labels = {handseed: [], pre137: [], post137: [], execsql: []};
  for (const {label, sql} of chunks) {
    const cls = classify(label) === 'other' ? 'pre137' : classify(label);
    buckets[cls].push(stripInnerTx(sql));
    labels[cls].push(label);
  }
  return {
    handseed: buckets.handseed.join('\n'),
    pre137: buckets.pre137.join('\n'),
    post137: buckets.post137.join('\n'),
    execsql: buckets.execsql.join('\n'),
    labels,
    chunkCount: chunks.length,
  };
}

// Convenience: generate + read + segment.
async function buildAndSegment(io) {
  await buildBundle(io);
  const text = fs.readFileSync(BUNDLE_PATH, 'utf8').replace(/\r\n/g, '\n');
  return segmentBundle(text);
}

module.exports = {
  BUNDLE_PATH,
  PASTURE_BOUNDARY,
  buildBundle,
  splitChunks,
  migrationNumber,
  classify,
  segmentBundle,
  buildAndSegment,
  stripInnerTx,
};
