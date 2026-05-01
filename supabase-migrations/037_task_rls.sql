-- ============================================================================
-- Migration 037: Tasks module v1 — is_admin() helper + RLS policies + indexes
-- ----------------------------------------------------------------------------
-- DB-only build. After this migration lands, the Tasks tables exposed in 036
-- become reachable from authenticated sessions per the locked policy shape:
--
--   task_templates     — admin-only CRUD (FOR ALL via is_admin()).
--   task_instances     — admin-only CRUD + assignee SELECT-own.
--   task_cron_runs     — admin-only SELECT. Append-only via service role.
--
-- Anon role gains nothing here — Phase E's mig 041 is what exposes the anon
-- public-submit RPC. No anon SELECT on either task table; assignee dropdown
-- on the public form will read via list_eligible_assignees() RPC, NOT a
-- direct SELECT on profiles or task_templates.
--
-- The `public.is_admin()` SECURITY DEFINER helper is the single source of
-- truth for the admin role check. Reused by RLS policies AND by the Tasks
-- v1 RPCs in mig 040 + 041. Codex blocker 1 (rev 4): inline subqueries
-- against `profiles` from policies were rejected — this helper replaces
-- them with a hardened, reusable contract.
--
-- Helper hardening:
--   - SECURITY DEFINER + SET search_path = public — mig 034/035 convention.
--   - STABLE — policies/RLS planner can cache within a statement.
--   - REVOKE FROM PUBLIC + explicit GRANT TO authenticated. Anon CAN call
--     this function (Supabase default privileges grant EXECUTE on public
--     functions to anon as a distinct role; an explicit REVOKE FROM anon
--     causes PostgREST to return schema-cache errors that cascade into
--     Auth signInWithPassword failures — see the "Grant strategy" comment
--     above the REVOKE/GRANT block for details). The security boundary
--     for anon is upheld by the function body itself: `auth.uid()` is NULL
--     for anon, so the EXISTS lookup never matches and the function
--     returns `false`. No information leak — there's no enumeration vector
--     since the function never references a specific user id.
--
-- Indexes:
--   * (assignee_profile_id, status, due_date) on task_instances —
--     assignee dashboard query (Phase D /my-tasks).
--   * Partial unique (template_id, due_date) WHERE template_id IS NOT NULL
--     — generator idempotency. If two paths (cron + admin "Run Cron Now")
--     fire concurrently, the unique index is the safety net against
--     double-mint. Partial because public-webform / admin-manual rows
--     have NULL template_id and would otherwise violate uniqueness.
--   * (status, due_date) on task_instances — weekly-summary aggregation
--     query (Phase F) + admin overdue list ordering.
--
-- Idempotent: CREATE OR REPLACE FUNCTION + DO-block guarded CREATE POLICY +
-- CREATE INDEX IF NOT EXISTS. Re-runs are no-ops.
-- ============================================================================

BEGIN;

-- ----------------------------------------------------------------------------
-- (1) public.is_admin() — single source of truth for the admin role check
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
STABLE
AS $is_admin$
  SELECT EXISTS (
    SELECT 1 FROM public.profiles
     WHERE id = auth.uid() AND role = 'admin'
  )
$is_admin$;

-- Grant strategy:
--   - REVOKE ALL FROM PUBLIC removes the generic catch-all grant.
--   - GRANT EXECUTE TO authenticated makes the function callable from any
--     authenticated session.
--   - We DELIBERATELY DO NOT add `REVOKE EXECUTE ... FROM anon`. Supabase's
--     default privileges grant EXECUTE on public-schema functions to anon
--     separately, and an explicit REVOKE causes PostgREST to return a
--     schema-cache error to anon callers ("Could not query the database
--     for the schema cache. Retrying.") instead of a clean 403. That
--     PostgREST hiccup cascades into Supabase Auth signInWithPassword
--     calls returning "Database error querying schema" (status 500) for
--     any new session in the same connection-pool window, breaking the
--     login flow site-wide.
--
--   Security boundary is intact regardless: anon CAN call this function,
--   but `auth.uid()` is NULL for anon, so the EXISTS lookup never matches
--   and the function returns `false`. Anon learning "I'm not an admin"
--   provides zero useful information; there's no enumeration vector since
--   the function never references a specific user id.
--
--   The recon at scripts/recon_tasks_rls.cjs accepts `data=false` from
--   anon as the canonical denial signal (matching the boundary above)
--   rather than expecting a 403/error.
REVOKE ALL ON FUNCTION public.is_admin() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_admin() TO authenticated;

-- ----------------------------------------------------------------------------
-- (2) task_templates — admin-only, all commands
-- ----------------------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
     WHERE schemaname = 'public'
       AND tablename = 'task_templates'
       AND policyname = 'task_templates_admin_all'
  ) THEN
    CREATE POLICY task_templates_admin_all ON public.task_templates
      FOR ALL TO authenticated
      USING (public.is_admin())
      WITH CHECK (public.is_admin());
  END IF;
END $$;

-- ----------------------------------------------------------------------------
-- (3) task_instances — admin all-commands + assignee SELECT-own
-- ----------------------------------------------------------------------------
-- Postgres OR-merges policies on the same command. An assignee SELECTing
-- their own row succeeds via task_instances_assignee_self_select even
-- when is_admin() returns false. INSERT / UPDATE / DELETE only succeed
-- under task_instances_admin_all because no other policy matches those
-- commands. Self-completion goes through complete_task_instance() RPC
-- (mig 040), which uses SECURITY DEFINER to bypass RLS — assignee is
-- never granted a direct UPDATE policy on this table.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
     WHERE schemaname = 'public'
       AND tablename = 'task_instances'
       AND policyname = 'task_instances_admin_all'
  ) THEN
    CREATE POLICY task_instances_admin_all ON public.task_instances
      FOR ALL TO authenticated
      USING (public.is_admin())
      WITH CHECK (public.is_admin());
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
     WHERE schemaname = 'public'
       AND tablename = 'task_instances'
       AND policyname = 'task_instances_assignee_self_select'
  ) THEN
    CREATE POLICY task_instances_assignee_self_select ON public.task_instances
      FOR SELECT TO authenticated
      USING (assignee_profile_id = auth.uid());
  END IF;
END $$;

-- ----------------------------------------------------------------------------
-- (4) task_cron_runs — admin SELECT only; service-role bypass for INSERT
-- ----------------------------------------------------------------------------
-- No INSERT / UPDATE / DELETE policies on this table. The cron + admin
-- manual paths both write via the tasks-cron edge function, which uses a
-- service-role client — service_role bypasses RLS by design. Append-only
-- semantics emerge from absence of UPDATE/DELETE policies.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
     WHERE schemaname = 'public'
       AND tablename = 'task_cron_runs'
       AND policyname = 'task_cron_runs_admin_select'
  ) THEN
    CREATE POLICY task_cron_runs_admin_select ON public.task_cron_runs
      FOR SELECT TO authenticated
      USING (public.is_admin());
  END IF;
END $$;

-- ----------------------------------------------------------------------------
-- (5) Indexes
-- ----------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS task_instances_assignee_status_due_idx
  ON public.task_instances (assignee_profile_id, status, due_date);

CREATE UNIQUE INDEX IF NOT EXISTS task_instances_template_due_uq
  ON public.task_instances (template_id, due_date)
  WHERE template_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS task_instances_status_due_idx
  ON public.task_instances (status, due_date);

-- ----------------------------------------------------------------------------
-- DELIBERATELY NOT TOUCHED:
--   * Anon role grants on either task table — Phase A is authenticated-only.
--   * Assignee UPDATE policy — self-completion is RPC-mediated (mig 040).
--   * task-photos bucket policies — mig 038 owns those.
-- ----------------------------------------------------------------------------

COMMIT;
