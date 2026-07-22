-- 190: least-privilege PostgreSQL role for disaster-recovery logical backups.
--
-- NOT YET APPLIED ANYWHERE. Draft for review (Build Queue item 1).
--
-- Purpose: give the DR backup runner exactly enough privilege to take a complete
-- pg_dump of public/auth/storage, and nothing else. Today DR_PROD_DB_URL points
-- at the `postgres` role, which can read AND WRITE all of production; a repo or
-- workflow compromise would inherit that. This role reduces the backup path to
-- read-only.
--
-- WHY BYPASSRLS IS REQUIRED, NOT OPTIONAL
-- pg_dump sets `row_security = off`. For a role WITHOUT BYPASSRLS, any
-- RLS-protected table then raises:
--     ERROR: query would be affected by row-level security policy for table "…"
-- 126 of 133 tables in public/auth/storage have RLS enabled, so the dump simply
-- cannot run without it. Verified read-only against PROD:
--     as postgres      (rolbypassrls=t): SET row_security=off; SELECT -> rows
--     as authenticated (rolbypassrls=f): SET row_security=off; SELECT -> ERROR
--
-- DO NOT "FIX" THAT ERROR WITH pg_dump --enable-row-security. That flag makes
-- the dump SUCCEED while returning only policy-visible rows, producing a silent
-- partial backup that looks healthy. A loud failure is the correct behaviour and
-- a static guard forbids that flag in the runner.
--
-- WHY pg_read_all_data RATHER THAN EXPLICIT GRANTS
-- It is evaluated dynamically, so it covers tables, views and sequences that do
-- not exist yet. `GRANT SELECT ON ALL TABLES` is a one-time snapshot and would
-- silently miss every table added by a later migration — the backup would keep
-- succeeding while quietly omitting new data.
--
-- Feasibility verified on TEST before this was written: Supabase permits
-- `postgres` to create a role WITH BYPASSRLS and to GRANT pg_read_all_data
-- (postgres holds rolcreaterole + rolbypassrls, and is a member of
-- pg_read_all_data WITH ADMIN OPTION). The probe role was dropped afterwards.
--
-- NO CREDENTIAL APPEARS IN THIS FILE. The role is created NOLOGIN and cannot
-- connect. Activation is a deliberate out-of-band step under its own gate:
--     ALTER ROLE wcf_backup LOGIN PASSWORD '<generated out of band>';
-- Never add that statement to a migration, and never commit the password.
--
-- Idempotent: safe to re-apply. Re-running will not disturb an already
-- activated role's LOGIN status or password.

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'wcf_backup') THEN
    -- NOLOGIN on purpose: the role is inert until activated out of band.
    CREATE ROLE wcf_backup WITH
      NOLOGIN
      NOSUPERUSER
      NOCREATEDB
      NOCREATEROLE
      NOREPLICATION
      BYPASSRLS;
  ELSE
    -- Re-apply path. Converge the security-relevant attributes WITHOUT touching
    -- LOGIN or PASSWORD. Activation is an out-of-band step, so re-running this
    -- migration must PRESERVE an operator-granted LOGIN rather than revoking it,
    -- and must never reset a live credential.
    ALTER ROLE wcf_backup
      NOSUPERUSER
      NOCREATEDB
      NOCREATEROLE
      NOREPLICATION
      BYPASSRLS;
  END IF;
END
$$;

-- Idempotent by definition: granting an existing membership is a no-op.
GRANT pg_read_all_data TO wcf_backup;

-- Post-condition assertions. Fail loudly rather than leaving a role that
-- silently cannot back up, or one quietly wider than intended.
--
-- SCOPE, STATED PRECISELY: these verify the role's ATTRIBUTES and its ROLE
-- MEMBERSHIPS. They do NOT and cannot prove the role holds no direct object
-- grants and owns no objects — a later migration could GRANT something to it,
-- and that would not be visible here. What is guaranteed is that this migration
-- creates no such grant or ownership, and that the attribute/membership surface
-- is exactly as intended at apply time.
DO $$
DECLARE
  extra_memberships text;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'wcf_backup' AND rolbypassrls) THEN
    RAISE EXCEPTION 'wcf_backup lacks BYPASSRLS; pg_dump would fail on RLS tables';
  END IF;

  -- Every superuser-adjacent attribute must be off. rolreplication is included
  -- deliberately: replication grants the ability to stream the entire cluster,
  -- which is far beyond what a logical backup needs.
  IF EXISTS (
    SELECT 1 FROM pg_roles
    WHERE rolname = 'wcf_backup'
      AND (rolsuper OR rolcreaterole OR rolcreatedb OR rolreplication)
  ) THEN
    RAISE EXCEPTION 'wcf_backup holds an attribute beyond least-privilege backup read (SUPERUSER/CREATEROLE/CREATEDB/REPLICATION)';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_auth_members m
    JOIN pg_roles r ON r.oid = m.roleid
    JOIN pg_roles u ON u.oid = m.member
    WHERE u.rolname = 'wcf_backup' AND r.rolname = 'pg_read_all_data'
  ) THEN
    RAISE EXCEPTION 'wcf_backup is not a member of pg_read_all_data';
  END IF;

  -- pg_read_all_data must be the ONLY membership. An extra one (say
  -- pg_write_all_data, or an application role) would silently widen the backup
  -- credential well past read-only.
  SELECT string_agg(r.rolname, ', ' ORDER BY r.rolname) INTO extra_memberships
  FROM pg_auth_members m
  JOIN pg_roles r ON r.oid = m.roleid
  JOIN pg_roles u ON u.oid = m.member
  WHERE u.rolname = 'wcf_backup' AND r.rolname <> 'pg_read_all_data';

  IF extra_memberships IS NOT NULL THEN
    RAISE EXCEPTION 'wcf_backup has unexpected role membership(s): %', extra_memberships;
  END IF;
END
$$;

-- ---------------------------------------------------------------------------
-- OPERATOR VERIFICATION (read-only; run separately, reveals no credential)
--
--   SELECT rolname, rolcanlogin, rolsuper, rolbypassrls,
--          rolcreatedb, rolcreaterole, rolreplication
--   FROM pg_roles WHERE rolname = 'wcf_backup';
--   -- expect: rolbypassrls = t, everything else f until activation,
--   --         rolcanlogin = t only after the out-of-band ALTER ROLE.
--
--   SELECT r.rolname AS granted_role
--   FROM pg_auth_members m
--   JOIN pg_roles r ON r.oid = m.roleid
--   JOIN pg_roles u ON u.oid = m.member
--   WHERE u.rolname = 'wcf_backup';
--   -- expect exactly: pg_read_all_data
--
-- ACTIVATION (out of band, separate PROD gate, never in a migration):
--   1. Generate:  openssl rand -base64 32     (locally; never echo to chat)
--   2. Apply as postgres:
--        ALTER ROLE wcf_backup LOGIN PASSWORD '<generated>';
--   3. Build the DSN. NOTE the Supavisor pooler username format — it is
--      <role>.<project-ref>, so the user is `wcf_backup.pzfujbjtayhkdlxiblwe`,
--      NOT `wcf_backup`. This is easy to miss and fails at connect time.
--   4. Store as the GitHub ENVIRONMENT secret DR_PROD_DB_URL on `dr-backup`,
--      and keep a copy in 1Password item:
--        WCF Planner — Backup database unlock keys
--   5. Prove it: run a full pg_dump as wcf_backup and compare object counts
--      against a postgres-role dump. Any RLS error means BYPASSRLS did not take.
--
-- ROTATION:  ALTER ROLE wcf_backup PASSWORD '<new>';  then update the secret.
-- REVOCATION: ALTER ROLE wcf_backup NOLOGIN;          -- instant, no DROP needed
-- ---------------------------------------------------------------------------
