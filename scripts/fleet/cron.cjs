#!/usr/bin/env node
// ============================================================================
// scripts/fleet/cron.cjs — TEST-environment override for placeholder-backed
// pg_cron jobs, plus the readiness classification the attestation needs.
// ============================================================================
// Migrations 039/046 create pg_cron jobs (tasks-cron-daily, tasks-summary-
// weekly) that call invoke_tasks_cron()/invoke_tasks_summary(), which
// net.http_post to the URL stored in Vault. In the fleet those Vault values are
// non-operational PLACEHOLDERS pointing at RFC-6761 `.invalid` hosts. A `.invalid`
// host cannot be REACHED, but leaving the job ACTIVE would still trigger a
// scheduled DNS lookup + connect attempt. So the bootstrap disables these jobs
// as an explicit TEST override (row preserved, active=false) and the attestation
// FAILS readiness if a placeholder-backed job is still active.
//
// Readiness classification per integration:
//   placeholder value + job disabled           -> structurally-ready
//   operational value + explicitly-approved job -> operational (not used here)
//   placeholder value + job ACTIVE              -> NOT READY
//   missing value                               -> NOT READY
// ============================================================================
'use strict';

const {runSql} = require('./sql.cjs');
const {VAULT_PLACEHOLDERS} = require('./seeds.cjs');

// The migration-created cron jobs that read the placeholder Vault secrets and
// perform outbound net.http_post. These must be inactive in a TEST project.
const PLACEHOLDER_CRON_JOBS = Object.freeze([
  {
    jobname: 'tasks-cron-daily',
    integration: 'tasks-cron',
    reads: ['TASKS_CRON_FUNCTION_URL', 'TASKS_CRON_SECRET', 'TASKS_CRON_SERVICE_ROLE_KEY'],
  },
  {
    jobname: 'tasks-summary-weekly',
    integration: 'tasks-summary',
    reads: ['TASKS_SUMMARY_FUNCTION_URL', 'TASKS_CRON_SECRET', 'TASKS_CRON_SERVICE_ROLE_KEY'],
  },
]);

const PLACEHOLDER_NAMES = new Set(VAULT_PLACEHOLDERS.map((v) => v.name));

async function inventoryCronJobs(io, {key, workdir}) {
  const {rows} = await runSql(io, {
    key,
    workdir,
    sql: 'select jobid, jobname, active, schedule from cron.job order by jobname;',
  });
  return rows;
}

// Disable every placeholder-backed job (active=false, preserving the row).
// Idempotent. Returns the post-state of the targeted jobs.
async function disablePlaceholderCronJobs(io, {key, workdir}) {
  const names = PLACEHOLDER_CRON_JOBS.map((j) => `'${j.jobname}'`).join(',');
  await runSql(io, {
    key,
    workdir,
    sql: `select cron.alter_job(jobid, active := false) from cron.job where jobname in (${names}) and active;`,
  });
  const {rows} = await runSql(io, {
    key,
    workdir,
    sql: `select jobname, active from cron.job where jobname in (${names}) order by jobname;`,
  });
  return rows;
}

// Vault + cron classification for the readiness report. Pure given the two
// snapshots. Returns {ready, integrations:[{integration, state, detail}]}.
function classifyCronVault({vaultRows, cronRows}) {
  // vaultRows: [{name}] present in vault.secrets. cronRows: [{jobname, active}].
  const present = new Set((vaultRows || []).map((r) => r.name));
  const activeByName = new Map((cronRows || []).map((r) => [r.jobname, r.active === true || r.active === 't']));
  const integrations = [];
  let ready = true;
  for (const job of PLACEHOLDER_CRON_JOBS) {
    const missing = job.reads.filter((n) => !present.has(n));
    const jobActive = activeByName.get(job.jobname);
    let state;
    if (missing.length) {
      state = 'not-ready-missing-config';
      ready = false;
    } else if (jobActive) {
      // every read is a known placeholder AND the job is live -> unsafe
      state = 'not-ready-placeholder-with-active-job';
      ready = false;
    } else {
      // placeholder values, job disabled (or absent) -> structurally ready
      state = 'structurally-ready-placeholder-disabled';
    }
    integrations.push({integration: job.integration, jobname: job.jobname, state, jobActive: !!jobActive, missing});
  }
  return {ready, integrations};
}

module.exports = {
  PLACEHOLDER_CRON_JOBS,
  PLACEHOLDER_NAMES,
  inventoryCronJobs,
  disablePlaceholderCronJobs,
  classifyCronVault,
};
