#!/usr/bin/env node
// ============================================================================
// scripts/fleet/sql.cjs — run SQL against a verified-TEST target via the
// Supabase Management API (`supabase db query --linked`, executes as postgres).
// ============================================================================
// This is the bootstrap channel: it needs only the keyring access token (no DB
// password) and can run DDL, DO-blocks, and EXECUTE that the legacy exec_sql
// RPC path could not. Every call re-verifies the link through ensureLinked()
// first, so it can never run against PROD or a drifted target.
// ============================================================================
'use strict';

const path = require('path');
const os = require('os');
const {ensureLinked} = require('./target.cjs');
const {redactError} = require('./redact.cjs');

// Windows caps a single command-line argument near 32 KB. SQL longer than this
// threshold is spilled to an owner-only temp file and run via -f instead of an
// inline arg. Chosen well below the limit for safety margin.
const INLINE_MAX = 7000;
let tmpCounter = 0;

function parseRows(stdout) {
  if (!stdout) return [];
  const start = stdout.search(/[[{]/);
  if (start === -1) return [];
  let json;
  try {
    json = JSON.parse(stdout.slice(start));
  } catch {
    // Trailing noise after the JSON body — retry on a trimmed tail.
    const trimmed = stdout.slice(start).trim();
    json = JSON.parse(trimmed);
  }
  if (Array.isArray(json)) return json;
  if (json && Array.isArray(json.rows)) return json.rows;
  return [];
}

async function runSqlFile(io, {key, workdir, file, timeoutMs = 300000}) {
  const entry = await ensureLinked(io, {key, workdir});
  const res = await io.run(
    'supabase',
    ['db', 'query', '--linked', '--workdir', workdir, '--agent', 'no', '-o', 'json', '-f', file],
    {timeoutMs},
  );
  if (res.code !== 0) {
    throw redactError(
      new Error(
        `db query (file ${path.basename(file)}) failed on ${entry.name} (${entry.ref}): ${res.stderr || res.stdout}`,
      ),
    );
  }
  return {entry, rows: parseRows(res.stdout), raw: res.stdout};
}

async function runSql(io, {key, workdir, sql, timeoutMs = 120000}) {
  // ALWAYS route SQL through a temp file + `-f`. Passing SQL as an inline
  // positional arg breaks whenever it starts with a `--` comment (the CLI
  // parses it as a flag) and also hits the OS argv length limit for large SQL.
  // A short read-only query with no leading dash may still go inline as a fast
  // path, but anything comment-leading or large uses the file.
  const inlineSafe = sql.length <= INLINE_MAX && !/^\s*-/.test(sql) && !sql.includes('\n--');
  if (inlineSafe) {
    const entry = await ensureLinked(io, {key, workdir});
    const res = await io.run(
      'supabase',
      ['db', 'query', '--linked', '--workdir', workdir, '--agent', 'no', '-o', 'json', sql],
      {timeoutMs},
    );
    if (res.code !== 0)
      throw redactError(new Error(`db query failed on ${entry.name} (${entry.ref}): ${res.stderr || res.stdout}`));
    return {entry, rows: parseRows(res.stdout), raw: res.stdout};
  }
  tmpCounter += 1;
  const file = path.join(os.tmpdir(), `wcf-fleet-sql-${process.pid}-${tmpCounter}.sql`);
  io.writeFile(file, sql, {mode: 0o600});
  try {
    return await runSqlFile(io, {key, workdir, file, timeoutMs});
  } finally {
    io.removeFile(file);
  }
}

// Convenience: run a single-row/single-value query and return that scalar.
async function scalar(io, opts) {
  const {rows} = await runSql(io, opts);
  if (!rows.length) return null;
  const first = rows[0];
  const keys = Object.keys(first);
  return keys.length ? first[keys[0]] : null;
}

module.exports = {parseRows, runSqlFile, runSql, scalar};
