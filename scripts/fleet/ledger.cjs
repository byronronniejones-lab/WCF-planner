#!/usr/bin/env node
// ============================================================================
// scripts/fleet/ledger.cjs — migration ledger + safe adoption/execution
// ============================================================================
// A fleet TEST project records every repository migration in
// public.wcf_fleet_migrations (a reset-safe table NOT in the reset truncate
// whitelist) with its checksum and how it got there:
//
//   'executed'              — this bootstrap ran the body (fresh project); the
//                             ledger row is written in the SAME transaction as
//                             the body, so a version is recorded ONLY after the
//                             migration succeeds and a half-applied migration
//                             can never be marked complete.
//   'adopted-verified'      — the migration was already applied before the
//                             ledger existed; we did NOT rerun the body, we
//                             verified its resulting objects (postconditions)
//                             exist, then recorded it.
//   'adopted-checksum-only' — an already-applied migration with no extractable
//                             positive postcondition (pure data/ALTER/DROP);
//                             recorded by checksum, flagged as unverified — it
//                             is NOT claimed as object-verified.
//
// Adoption REFUSES (throws) when a migration's postconditions are extractable
// but missing — a partially applied migration cannot be adopted as complete.
// Thereafter, a changed migration body is detected by checksum mismatch.
// ============================================================================
'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const ARCHIVE_DIR = path.join(REPO_ROOT, 'supabase-migrations', 'archive');
const PARENT_DIR = path.join(REPO_ROOT, 'supabase-migrations');
const MIGRATION_RX = /^(\d{3})_.+\.sql$/;

const LEDGER_TABLE = 'public.wcf_fleet_migrations';

const LEDGER_DDL = `
create table if not exists public.wcf_fleet_migrations (
  version text primary key,
  kind text not null check (kind in ('migration','handseed','exec_sql','fixture')),
  checksum text not null,
  status text not null check (status in ('executed','adopted-verified','adopted-checksum-only')),
  postcondition_count int not null default 0,
  boundary_before text,
  applied_at timestamptz,
  recorded_at timestamptz not null default now(),
  note text
);`;

function normalize(text) {
  return text.replace(/\r\n/g, '\n');
}

function checksum(text) {
  return crypto.createHash('sha256').update(normalize(text), 'utf8').digest('hex');
}

// Ordered migration list: archive 001-026 then parent 027-190, numeric.
function listMigrations() {
  const read = (dir, source) =>
    fs
      .readdirSync(dir, {withFileTypes: true})
      .filter((d) => d.isFile() && MIGRATION_RX.test(d.name))
      .map((d) => ({
        version: d.name.match(MIGRATION_RX)[1],
        file: d.name,
        path: path.join(dir, d.name),
        source,
      }));
  const all = [...read(ARCHIVE_DIR, 'archive'), ...read(PARENT_DIR, 'parent')];
  all.sort((a, b) => Number(a.version) - Number(b.version));
  // Fail closed on duplicate version numbers across archive/parent.
  const seen = new Set();
  for (const m of all) {
    if (seen.has(m.version)) throw new Error(`Duplicate migration version ${m.version} (${m.file})`);
    seen.add(m.version);
  }
  return all;
}

// ---- postcondition extraction (tables / functions / buckets) ---------------

// Remove -- line comments and /* */ block comments so keywords inside comments
// (e.g. "-- CREATE TABLE IF NOT EXISTS + ALTER") never get parsed as DDL.
function stripSqlComments(sql) {
  return sql.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/--[^\n]*/g, ' ');
}

const SQL_KEYWORDS = new Set([
  'if',
  'not',
  'exists',
  'table',
  'function',
  'or',
  'replace',
  'as',
  'public',
  'temp',
  'temporary',
  'unlogged',
  'index',
  'unique',
  'trigger',
  'type',
  'view',
  'materialized',
  'concurrently',
]);

function extractPostconditions(sql) {
  sql = stripSqlComments(sql);
  const pcs = [];
  const add = (type, name) => {
    if (name && !SQL_KEYWORDS.has(name.toLowerCase())) pcs.push({type, name: name.toLowerCase()});
  };
  // public tables (unqualified or public-qualified)
  for (const m of sql.matchAll(/create\s+table\s+(?:if\s+not\s+exists\s+)?(?:public\.)?"?([a-z_][a-z0-9_]*)"?/gi))
    add('table', m[1]);
  // functions by name
  for (const m of sql.matchAll(/create\s+(?:or\s+replace\s+)?function\s+(?:public\.)?"?([a-z_][a-z0-9_]*)"?\s*\(/gi))
    add('function', m[1]);
  // storage buckets: insert into storage.buckets ... values ('id' | id=>'id'
  for (const m of sql.matchAll(/storage\.buckets[\s\S]{0,120}?values\s*\(\s*'([^']+)'/gi)) add('bucket', m[1]);
  for (const m of sql.matchAll(/storage\.create_bucket\s*\(\s*'([^']+)'/gi)) add('bucket', m[1]);
  // de-dup
  const key = (p) => `${p.type}:${p.name}`;
  const seen = new Set();
  return pcs.filter((p) => (seen.has(key(p)) ? false : (seen.add(key(p)), true)));
}

// One snapshot query -> object sets. Also returns the signature-level function
// set the attestation uses so overload drift can't hide behind name counts.
const SNAPSHOT_SQL = `select jsonb_build_object(
  'base_tables', (select coalesce(jsonb_agg(table_name order by table_name),'[]'::jsonb) from information_schema.tables where table_schema='public' and table_type='BASE TABLE'),
  'all_relations', (select coalesce(jsonb_agg(table_name order by table_name),'[]'::jsonb) from information_schema.tables where table_schema='public'),
  'function_names', (select coalesce(jsonb_agg(distinct proname order by proname),'[]'::jsonb) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public'),
  'function_signatures', (select coalesce(jsonb_agg(sig order by sig),'[]'::jsonb) from (select proname||'('||pg_get_function_identity_arguments(p.oid)||')' as sig from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public') s),
  'buckets', (select coalesce(jsonb_agg(id order by id),'[]'::jsonb) from storage.buckets),
  'extensions', (select coalesce(jsonb_agg(extname order by extname),'[]'::jsonb) from pg_extension)
) as snap;`;

async function snapshotObjects(io, {key, workdir}, {runSql}) {
  const {rows} = await runSql(io, {key, workdir, sql: SNAPSHOT_SQL});
  const snap = rows[0].snap;
  return {
    baseTables: new Set(snap.base_tables),
    allRelations: new Set(snap.all_relations),
    functionNames: new Set(snap.function_names.map((s) => String(s).toLowerCase())),
    functionSignatures: new Set(snap.function_signatures),
    buckets: new Set(snap.buckets),
    extensions: new Set(snap.extensions || []),
    raw: snap,
  };
}

// Objects a LATER migration legitimately drops (create-then-drop supersession),
// so an earlier migration's now-absent postcondition is EXPECTED, not partial.
function extractDrops(sql) {
  sql = stripSqlComments(sql);
  const dropped = {table: new Set(), function: new Set()};
  for (const m of sql.matchAll(/drop\s+table\s+(?:if\s+exists\s+)?(?:public\.)?"?([a-z_][a-z0-9_]*)"?/gi))
    if (!SQL_KEYWORDS.has(m[1].toLowerCase())) dropped.table.add(m[1].toLowerCase());
  for (const m of sql.matchAll(/drop\s+function\s+(?:if\s+exists\s+)?(?:public\.)?"?([a-z_][a-z0-9_]*)"?/gi))
    if (!SQL_KEYWORDS.has(m[1].toLowerCase())) dropped.function.add(m[1].toLowerCase());
  return dropped;
}

// Build the union of all objects any migration drops. superseded = {table:Set, function:Set}.
function buildSupersededSet(migrations, readFile) {
  const superseded = {table: new Set(), function: new Set()};
  for (const m of migrations) {
    const d = extractDrops(readFile(m.path));
    d.table.forEach((t) => superseded.table.add(t));
    d.function.forEach((f) => superseded.function.add(f));
  }
  return superseded;
}

function verifyPostconditions(pcs, snap, superseded = {table: new Set(), function: new Set()}) {
  const missing = [];
  const superseededHit = [];
  for (const pc of pcs) {
    const has =
      pc.type === 'table'
        ? snap.baseTables.has(pc.name) || snap.allRelations.has(pc.name)
        : pc.type === 'function'
          ? snap.functionNames.has(pc.name)
          : pc.type === 'bucket'
            ? snap.buckets.has(pc.name)
            : true;
    if (has) continue;
    // absent but a later migration drops it => superseded, not partial
    if (
      (pc.type === 'table' && superseded.table.has(pc.name)) ||
      (pc.type === 'function' && superseded.function.has(pc.name))
    ) {
      superseededHit.push(pc);
    } else {
      missing.push(pc);
    }
  }
  return {ok: missing.length === 0, missing, superseded: superseededHit};
}

// Classify one already-applied migration for adoption. Pure.
function classifyAdoption(migrationSql, snap, superseded) {
  const pcs = extractPostconditions(migrationSql);
  if (pcs.length === 0) return {status: 'adopted-checksum-only', postconditionCount: 0, missing: [], superseded: []};
  const {ok, missing, superseded: sup} = verifyPostconditions(pcs, snap, superseded);
  if (!ok) return {status: 'refused', postconditionCount: pcs.length, missing, superseded: sup};
  // verified: at least one live postcondition confirmed, or all superseded
  const liveConfirmed = pcs.length - sup.length;
  return {
    status: liveConfirmed > 0 ? 'adopted-verified' : 'adopted-checksum-only',
    postconditionCount: pcs.length,
    missing: [],
    superseded: sup,
  };
}

// SQL to upsert a ledger row. On conflict the recorded CHECKSUM is preserved
// (immutable, so a later changed migration body is still detected as drift by
// reconcile) and 'executed' provenance is STICKY (a fresh-execute record can
// never be silently downgraded to adopted-* by a later idempotent rerun).
function ledgerUpsertSql({version, kind, sum, status, postconditionCount = 0, boundaryBefore = null, note = null}) {
  const esc = (v) => (v == null ? 'null' : `'${String(v).replace(/'/g, "''")}'`);
  return `insert into public.wcf_fleet_migrations (version, kind, checksum, status, postcondition_count, boundary_before, applied_at, recorded_at, note)
values (${esc(version)}, ${esc(kind)}, ${esc(sum)}, ${esc(status)}, ${Number(postconditionCount)}, ${esc(boundaryBefore)}, now(), now(), ${esc(note)})
on conflict (version) do update set kind=excluded.kind, status=case when public.wcf_fleet_migrations.status='executed' then 'executed' else excluded.status end, postcondition_count=excluded.postcondition_count, boundary_before=excluded.boundary_before, recorded_at=now(), note=excluded.note;`;
}

// Reconcile the repo migration set against a ledger snapshot. Pure.
// ledgerRows: [{version, checksum, status}]. Returns drift report.
function reconcile(migrations, ledgerRows) {
  const byVersion = new Map(ledgerRows.map((r) => [r.version, r]));
  const repoVersions = new Set(migrations.map((m) => m.version));
  const changed = [];
  const missingFromLedger = [];
  for (const m of migrations) {
    const sum = checksum(fs.readFileSync(m.path, 'utf8'));
    const row = byVersion.get(m.version);
    if (!row) missingFromLedger.push(m.version);
    else if (row.checksum !== sum) changed.push({version: m.version, ledger: row.checksum, repo: sum});
  }
  const extra = ledgerRows.filter((r) => r.kind === 'migration' && !repoVersions.has(r.version)).map((r) => r.version);
  const ordered = migrations.map((m) => m.version).join(',');
  return {
    changed,
    missingFromLedger,
    extra,
    expectedOrder: ordered,
    ok: changed.length === 0 && missingFromLedger.length === 0 && extra.length === 0,
  };
}

module.exports = {
  LEDGER_TABLE,
  LEDGER_DDL,
  REPO_ROOT,
  normalize,
  checksum,
  listMigrations,
  extractPostconditions,
  extractDrops,
  buildSupersededSet,
  SNAPSHOT_SQL,
  snapshotObjects,
  verifyPostconditions,
  classifyAdoption,
  ledgerUpsertSql,
  reconcile,
};
