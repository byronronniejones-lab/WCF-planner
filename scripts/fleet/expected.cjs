#!/usr/bin/env node
// ============================================================================
// scripts/fleet/expected.cjs — repo-derived expected inventory (non-circular)
// ============================================================================
// The attested project can NEVER be its own oracle. This module derives the
// expected APPLICATION inventory deterministically from repository-owned
// definitions where practical:
//   - tables:     the 9 hand-created seed tables + net (create - drop) across
//                 all migrations in order;
//   - buckets:    net storage-bucket creations across all migrations;
//   - extensions: `create extension` across all migrations.
// Function SIGNATURES cannot be derived from source practically (identity-arg
// types, overload/replace/drop churn), so they are validated by CROSS-EXECUTION
// agreement between an independent fresh-execute project and the project under
// test — recorded in expected-fleet.json, which is a REVIEWED source artifact
// regenerated only by scripts/fleet/gen_baseline.cjs from a NAMED fresh-execute
// source, never by attestation of the project being judged.
//
// Fleet metadata (wcf_fleet_marker, wcf_fleet_migrations) is separated from
// application objects so it can never mask or be mistaken for application drift.
// ============================================================================
'use strict';

const fs = require('fs');
const {listMigrations, extractPostconditions, extractDrops} = require('./ledger.cjs');

// The nine tables created by hand in the dashboard before any migration existed
// (see scripts/build_test_bootstrap.js). Repository-owned by that generator.
const HANDSEED_TABLES = Object.freeze([
  'profiles',
  'app_store',
  'webform_config',
  'poultry_dailys',
  'layer_dailys',
  'egg_dailys',
  'pig_dailys',
  'layer_batches',
  'layer_housings',
]);

// Tables the fleet bootstrap itself adds — NOT application objects. Kept out of
// the application inventory so application drift can never hide behind them.
const FLEET_METADATA_TABLES = Object.freeze(['wcf_fleet_marker', 'wcf_fleet_migrations']);

function extractExtensions(sql) {
  const out = [];
  for (const m of sql
    .replace(/--[^\n]*/g, ' ')
    .matchAll(/create\s+extension\s+(?:if\s+not\s+exists\s+)?"?([a-z_][a-z0-9_-]*)"?/gi))
    out.push(m[1].toLowerCase());
  return out;
}

// Deterministic repo-derived expected inventory. Pure (reads migration files).
function computeRepoExpected() {
  const migrations = listMigrations();
  const tables = new Set(HANDSEED_TABLES);
  const buckets = new Set();
  const extensions = new Set();
  for (const m of migrations) {
    const sql = fs.readFileSync(m.path, 'utf8');
    // Drops BEFORE creates within a migration, so the common idempotent
    // "DROP TABLE IF EXISTS x; CREATE TABLE x" recreate nets to PRESENT
    // (e.g. mig 183 password_reset_throttle). Cross-migration order is
    // preserved by the outer loop (create@129 then drop@148 -> absent).
    const drops = extractDrops(sql);
    drops.table.forEach((t) => tables.delete(t));
    for (const pc of extractPostconditions(sql)) {
      if (pc.type === 'table') tables.add(pc.name);
      if (pc.type === 'bucket') buckets.add(pc.name);
    }
    for (const ext of extractExtensions(sql)) extensions.add(ext);
  }
  // application tables exclude any fleet-metadata table (defensive)
  for (const t of FLEET_METADATA_TABLES) tables.delete(t);
  return {
    base_tables: [...tables].sort(),
    buckets: [...buckets].sort(),
    extensions: [...extensions].sort(),
  };
}

// Split a live snapshot's relations into application vs fleet-metadata.
function partitionRelations(allRelations) {
  const meta = FLEET_METADATA_TABLES.filter((t) => allRelations.includes(t));
  const app = allRelations.filter((t) => !FLEET_METADATA_TABLES.includes(t));
  return {application: app.sort(), fleetMetadata: meta.sort()};
}

module.exports = {HANDSEED_TABLES, FLEET_METADATA_TABLES, extractExtensions, computeRepoExpected, partitionRelations};
