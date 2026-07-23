#!/usr/bin/env node
// ============================================================================
// scripts/fleet/gen_baseline.cjs — regenerate the reviewed drift baseline
// ============================================================================
// Regenerating scripts/fleet/expected-fleet.json is an EXPLICIT, REVIEWED source
// change — never an automatic "accept current remote state" step, and never
// done by attestation of the project being judged. This generator:
//   - accepts a NAMED source project that must have been FRESH-EXECUTED
//     (every migration run once, 0 adopted/checksum-only ledger rows);
//   - REFUSES if the source's application tables / buckets / extensions do not
//     match the repo-migration-derived set (so a drifted source can never bless
//     application drift into the baseline);
//   - separates fleet metadata from application objects;
//   - records function SIGNATURES from the fresh-execute source (not source-
//     parseable), to be cross-validated against a second independent project.
// It writes only when invoked with confirm=true.
// ============================================================================
'use strict';

const fs = require('fs');
const path = require('path');
const {assertBootstrapTarget} = require('./projects.cjs');
const {snapshotObjects} = require('./ledger.cjs');
const {runSql} = require('./sql.cjs');
const {computeRepoExpected, partitionRelations, FLEET_METADATA_TABLES} = require('./expected.cjs');
const {countingDefinition} = require('./attest.cjs');

const OUT_PATH = path.join(__dirname, 'expected-fleet.json');

function setDiff(a, b) {
  const A = new Set(a);
  const B = new Set(b);
  return {onlyA: [...A].filter((x) => !B.has(x)), onlyB: [...B].filter((x) => !A.has(x))};
}

// Verify the source's ledger is a clean fresh-execute (no adopted/checksum-only).
async function assertFreshExecuteSource(io, {key, workdir}) {
  const {rows} = await runSql(io, {
    key,
    workdir,
    sql: `select status, count(*)::int n from public.wcf_fleet_migrations where kind='migration' group by status;`,
  });
  const byStatus = Object.fromEntries(rows.map((r) => [r.status, r.n]));
  const nonExecuted = Object.entries(byStatus).filter(([s]) => s !== 'executed');
  if (nonExecuted.length) {
    throw new Error(
      `Refusing baseline from ${key}: ledger has non-executed rows ${JSON.stringify(byStatus)}. A baseline source must be a clean fresh-execute project.`,
    );
  }
  return byStatus;
}

async function generateBaseline(io, {sourceKey, workdir, confirm = false}) {
  const entry = assertBootstrapTarget(sourceKey);
  const ledgerStatus = await assertFreshExecuteSource(io, {key: sourceKey, workdir});
  const snap = await snapshotObjects(io, {key: sourceKey, workdir}, {runSql});
  const parts = partitionRelations([...snap.allRelations]);
  const appBaseTables = [...snap.baseTables].filter((t) => !FLEET_METADATA_TABLES.includes(t)).sort();
  const repo = computeRepoExpected();

  // Anti-circularity: source application tables + buckets MUST match the repo-
  // derived set exactly (a drifted source cannot be blessed). Extensions use a
  // SUBSET rule: every migration-required extension must be present, but the
  // live project legitimately carries Supabase platform-default extensions the
  // repo never creates (pg_stat_statements, plpgsql, supabase_vault, uuid-ossp).
  const tD = setDiff(appBaseTables, repo.base_tables);
  const bD = setDiff([...snap.buckets], repo.buckets);
  const repoExtMissing = repo.extensions.filter((e) => !snap.extensions.has(e));
  const mismatch = tD.onlyA.length || tD.onlyB.length || bD.onlyA.length || bD.onlyB.length || repoExtMissing.length;
  if (mismatch) {
    throw new Error(
      `Refusing baseline from ${sourceKey}: application objects diverge from repo-derived set. ` +
        `tables±=${JSON.stringify(tD)} buckets±=${JSON.stringify(bD)} missing-required-extensions=${JSON.stringify(repoExtMissing)}`,
    );
  }

  const baseline = {
    note: 'REVIEWED source artifact. Regenerated ONLY by scripts/fleet/gen_baseline.cjs from a NAMED fresh-execute source — never from the project being attested, never auto-accepted. Application tables/buckets/extensions are repo-migration-derived; function signatures are fresh-execute + cross-validated. Fleet metadata is separated.',
    provenance: {
      generated_from_key: entry.key,
      generated_from_ref: entry.ref,
      mode: 'fresh-execute',
      ledger_status: ledgerStatus,
    },
    fleet_metadata_tables: [...FLEET_METADATA_TABLES],
    repo_derived_check: repo,
    application: {
      base_tables: appBaseTables,
      all_relations: parts.application,
      function_signatures: [...snap.functionSignatures].sort(),
      buckets: [...snap.buckets].sort(),
      extensions: [...snap.extensions].sort(),
    },
    counting_definition: countingDefinition(),
  };
  if (confirm) fs.writeFileSync(OUT_PATH, JSON.stringify(baseline, null, 2) + '\n');
  return {written: !!confirm, path: OUT_PATH, baseline};
}

module.exports = {OUT_PATH, generateBaseline, assertFreshExecuteSource};
