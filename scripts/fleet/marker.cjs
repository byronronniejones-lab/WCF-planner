#!/usr/bin/env node
// ============================================================================
// scripts/fleet/marker.cjs — unmistakable TEST identity marker + drift metadata
// ============================================================================
// A single-row table public.wcf_fleet_marker records that this project is a
// bootstrapped TEST fleet member and WHICH one. It is reset-safe: it is NOT in
// tests/setup/reset.js's TEST_OWNED_TABLES truncate whitelist, so a spec reset
// never removes it. The attestation cross-checks marker.project_ref against the
// linked ref and the assigned target, so a project can prove its own identity.
//
// `details` jsonb carries the audit metadata the drift attestation needs:
//   - disabled_cron_jobs: which placeholder-backed cron jobs were disabled + why
//   - vault_placeholders: the placeholder secret names (operational:false)
//   - fixtures: synthetic apply-time prerequisites created
//   - counting_definition: how the readiness report counts objects
// ============================================================================
'use strict';

const MARKER_TABLE = 'public.wcf_fleet_marker';

const MARKER_DDL = `
create table if not exists public.wcf_fleet_marker (
  id int primary key default 1 check (id = 1),
  environment text not null default 'test' check (environment = 'test'),
  project_key text not null,
  project_ref text not null,
  project_name text not null,
  bootstrap_mode text,
  bootstrap_version text,
  details jsonb not null default '{}'::jsonb,
  bootstrapped_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);`;

function markerUpsertSql({projectKey, projectRef, projectName, mode, version, details}) {
  const esc = (v) => (v == null ? 'null' : `'${String(v).replace(/'/g, "''")}'`);
  const detailsJson = `'${JSON.stringify(details || {}).replace(/'/g, "''")}'::jsonb`;
  return `insert into public.wcf_fleet_marker (id, environment, project_key, project_ref, project_name, bootstrap_mode, bootstrap_version, details, bootstrapped_at, updated_at)
values (1, 'test', ${esc(projectKey)}, ${esc(projectRef)}, ${esc(projectName)}, ${esc(mode)}, ${esc(version)}, ${detailsJson}, now(), now())
on conflict (id) do update set project_key=excluded.project_key, project_ref=excluded.project_ref, project_name=excluded.project_name, bootstrap_mode=excluded.bootstrap_mode, bootstrap_version=excluded.bootstrap_version, details=excluded.details, updated_at=now();`;
}

async function readMarker(io, {key, workdir}, {runSql}) {
  const {rows} = await runSql(io, {
    key,
    workdir,
    sql: `select environment, project_key, project_ref, project_name, bootstrap_mode, bootstrap_version, details from public.wcf_fleet_marker where id = 1;`,
  });
  return rows[0] || null;
}

module.exports = {MARKER_TABLE, MARKER_DDL, markerUpsertSql, readMarker};
