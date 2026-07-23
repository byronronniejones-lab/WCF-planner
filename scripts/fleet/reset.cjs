#!/usr/bin/env node
// ============================================================================
// scripts/fleet/reset.cjs — target-verified TEST-only destructive reset
// ============================================================================
// Removes a fleet project's bootstrap-owned schema/data/configuration so it can
// be rebuilt from repository source in fresh 'execute' mode. This is a
// DESTRUCTIVE operation, gated hard:
//   - ensureLinked() re-resolves + re-verifies the target is the intended TEST
//     bootstrap project (never PROD / reference / unknown) IMMEDIATELY before
//     the reset — the same guard every mutating fleet op uses.
//   - It drops the public schema, clears synthetic Auth users, clears the TASKS_
//     Vault placeholders, unschedules cron jobs, and drops the wcf_backup role
//     (owns nothing; must be absent so mig 190 takes its CREATE path — the
//     Management-API postgres cannot ALTER an existing BYPASSRLS role).
//   - It verifies the project is empty afterwards and fails closed otherwise.
// It does NOT dump or copy any data/credentials; the rebuild is reproducible
// from repo migrations, not restored from the project.
// ============================================================================
'use strict';

const {ensureLinked} = require('./target.cjs');
const {runSql} = require('./sql.cjs');

const RESET_SQL = `
select cron.unschedule(jobid) from cron.job;
drop schema if exists public cascade;
create schema public;
grant usage on schema public to public;
grant all on schema public to postgres, anon, authenticated, service_role;
-- Restore Supabase's per-object DEFAULT PRIVILEGES for schema public. A fresh
-- Supabase project ships pg_default_acl rows that auto-grant every NEW public
-- table/function/sequence to anon, authenticated, service_role (access is then
-- gated by RLS, not by withholding the GRANT). "drop schema public cascade"
-- above DELETES those pg_default_acl rows along with the schema, so without
-- this every object the rebuild creates would be ungranted: service_role loses
-- EXECUTE on exec_sql (reset TRUNCATE fails) and anon/authenticated lose access
-- to app tables/RPCs (the whole app 403s). Re-establishing the defaults BEFORE
-- the migrations run reproduces the pristine sequence exactly — objects inherit
-- the standard grants, and each migration's own REVOKE (e.g. exec_sql, which is
-- revoked back down to service_role-only) still applies on top.
--
-- Only the FOR ROLE postgres rows are restored: the bootstrap SQL channel runs
-- as postgres (verified), so every rebuilt object is postgres-owned and these
-- are the defaults that apply to it. The parallel FOR ROLE supabase_admin rows
-- a pristine project also carries cannot be set here (postgres is not a member
-- of supabase_admin) and are inert for the fleet — supabase_admin creates no
-- public objects during the rebuild.
alter default privileges for role postgres in schema public grant all on tables to postgres, anon, authenticated, service_role;
alter default privileges for role postgres in schema public grant all on functions to postgres, anon, authenticated, service_role;
alter default privileges for role postgres in schema public grant all on sequences to postgres, anon, authenticated, service_role;
delete from auth.users;
delete from vault.secrets where name like 'TASKS_%';
do $fleet_reset$
begin
  if exists (select 1 from pg_roles where rolname = 'wcf_backup') then
    execute 'drop role wcf_backup';
  end if;
end
$fleet_reset$;`;

const VERIFY_SQL = `select
  (select count(*) from information_schema.tables where table_schema='public' and table_type='BASE TABLE') as tables,
  (select count(*) from auth.users) as users,
  (select count(*) from vault.secrets where name like 'TASKS_%') as vault,
  (select exists(select 1 from pg_roles where rolname='wcf_backup')) as wcf_backup,
  (select count(*) from pg_default_acl d join pg_namespace n on n.oid=d.defaclnamespace
     join pg_roles r on r.oid=d.defaclrole
    where n.nspname='public' and r.rolname='postgres') as default_acls;`;

async function destructiveReset(io, {key, workdir}) {
  const entry = await ensureLinked(io, {key, workdir}); // fail closed on PROD/reference/unknown + verify link
  io.log(`DESTRUCTIVE reset of ${entry.name} (${entry.ref}) — TEST-only, repo-reproducible rebuild follows.`);
  await runSql(io, {key, workdir, sql: RESET_SQL});
  const {rows} = await runSql(io, {key, workdir, sql: VERIFY_SQL});
  const r = rows[0];
  if (
    Number(r.tables) !== 0 ||
    Number(r.users) !== 0 ||
    Number(r.vault) !== 0 ||
    r.wcf_backup === true ||
    r.wcf_backup === 't' ||
    Number(r.default_acls) !== 3
  ) {
    throw new Error(`Reset incomplete for ${entry.name}: ${JSON.stringify(r)}`);
  }
  return {entry, verified: r};
}

module.exports = {RESET_SQL, VERIFY_SQL, destructiveReset};
