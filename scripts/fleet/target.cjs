#!/usr/bin/env node
// ============================================================================
// scripts/fleet/target.cjs — link a worktree to an explicit TEST target and
// verify the link BEFORE and AFTER, every time.
// ============================================================================
// `supabase db query --linked` acts on whatever supabase/.temp/project-ref
// says. That makes a stale/wrong link the single most dangerous failure mode,
// so every SQL/Storage operation funnels through ensureLinked():
//   1. assertBootstrapTarget(key) — refuse PROD / reference / unknown up front.
//   2. Read the CURRENT linked ref. If it already equals the intended TEST ref,
//      skip the (network) re-link; otherwise `supabase link --project-ref`.
//   3. Re-read the linked ref and assertLinkedRefMatches() — ALWAYS, even when
//      we skipped the re-link, so a drifted or PROD link fails closed.
// The worktree is never left linked to PROD because we only ever link to an
// asserted TEST bootstrap ref.
// ============================================================================
'use strict';

const path = require('path');
const {assertBootstrapTarget, assertLinkedRefMatches} = require('./projects.cjs');
const {redactError} = require('./redact.cjs');

function linkRefPath(workdir) {
  return path.join(workdir, 'supabase', '.temp', 'project-ref');
}

function readLinkedRef(io, workdir) {
  const raw = io.readFileSafe(linkRefPath(workdir));
  return raw == null ? null : raw.trim();
}

// Ensure `workdir` is linked to the intended TEST target and prove it. Returns
// the registry entry. Throws (fail closed) on any guard failure.
async function ensureLinked(io, {key, workdir}) {
  const entry = assertBootstrapTarget(key); // PROD/reference/unknown -> throw
  const before = readLinkedRef(io, workdir);
  if (before !== entry.ref) {
    io.log(`Linking ${path.basename(workdir)} -> ${entry.name} (${entry.ref})${before ? ` (was ${before})` : ''}...`);
    const res = await io.run('supabase', ['link', '--project-ref', entry.ref, '--workdir', workdir, '--yes']);
    if (res.code !== 0) {
      throw redactError(
        new Error(`supabase link failed for ${entry.name} (${entry.ref}): ${res.stderr || res.stdout}`),
      );
    }
  }
  const after = readLinkedRef(io, workdir);
  assertLinkedRefMatches(entry.ref, after); // wrong/PROD/empty -> throw
  return entry;
}

module.exports = {linkRefPath, readLinkedRef, ensureLinked};
