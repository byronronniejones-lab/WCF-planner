-- ============================================================================
-- Migration 039: Tasks module v1 — Phase B schema cleanup + cron generator
-- ----------------------------------------------------------------------------
-- DB-only build. Builds on Phase A (migs 036-038, shipped 4874f1d). Adds:
--
--   1. Drop `requires_photo` from task_templates and task_instances. Tasks v1
--      product decision: NO required-photo behavior anywhere. completion_photo_path
--      stays as a dormant column for a possible Phase D opt-in (decided later).
--   2. Extend task_templates.recurrence CHECK to include 'quarterly'.
--   3. Required extensions: pg_cron, pg_net, pgcrypto.
--   4. Vault preflight: RAISE EXCEPTION if any of the three TASKS_CRON_* secrets
--      are missing or empty.
--   5. public.invoke_tasks_cron() — owns Vault reads + net.http_post call.
--      Cron schedule body is a one-liner SELECT against this helper.
--   6. public.generate_task_instances(text, date[]) — owns the partial-unique-
--      index ON CONFLICT (template_id, due_date) WHERE template_id IS NOT NULL
--      DO NOTHING contract. The Edge Function calls this once per template.
--   7. cron.schedule for tasks-cron-daily at '0 4 * * *'.
--
-- DELIBERATELY NOT TOUCHED:
--   - is_admin() body or grants (mig 037 owns it).
--   - task-photos bucket or its policies (mig 038 owns it).
--   - completion_photo_path column (kept dormant).
--   - Weekly-summary schedule. The Mon 13:00 UTC slot is locked for Phase F;
--     this migration MUST NOT silently schedule a no-op there.
--
-- Audit model (three layers, no overlap):
--   Layer 1 — cron.job_run_details: did the schedule fire?
--   Layer 2 — net._http_response: did the http_post deliver?
--   Layer 3 — task_cron_runs: did the function execute its logic?
--   This migration owns the first two via the cron schedule + invoke helper;
--   the Edge Function owns the third.
--
-- Vault contract (locked):
--   Names:    TASKS_CRON_FUNCTION_URL, TASKS_CRON_SECRET, TASKS_CRON_SERVICE_ROLE_KEY.
--   Read via vault.decrypted_secrets (NOT vault.read_secret — that helper does
--   not exist in supabase Vault).
--   The Edge Function compares the cron-path Authorization bearer to
--   env.TASKS_CRON_SERVICE_ROLE_KEY (provisioned via `supabase secrets set`).
--   Vault stores the same value under TASKS_CRON_SERVICE_ROLE_KEY because
--   pg_cron has no access to function env vars and must read it from Vault
--   to set the Authorization header. We do NOT compare against the
--   auto-injected env.SUPABASE_SERVICE_ROLE_KEY because new Supabase
--   projects inject the 41-char sb_secret_* format there, which won't
--   match the 219-char legacy JWT pg_cron sends.
--
-- Idempotent: every step is IF EXISTS / IF NOT EXISTS / unschedule-then-
-- schedule. Safe to re-apply.
-- ============================================================================

BEGIN;

-- ----------------------------------------------------------------------------
-- (1) Drop requires_photo from task_templates and task_instances
-- ----------------------------------------------------------------------------
ALTER TABLE public.task_templates DROP COLUMN IF EXISTS requires_photo;
ALTER TABLE public.task_instances DROP COLUMN IF EXISTS requires_photo;

-- ----------------------------------------------------------------------------
-- (2) Extend task_templates.recurrence CHECK to include 'quarterly'
-- ----------------------------------------------------------------------------
-- Mig 036 declared the CHECK inline so Postgres auto-named it. Codex blocker:
-- ILIKE '%recurrence%' matches BOTH task_templates_recurrence_check (the
-- enum constraint we want to extend) AND task_templates_recurrence_interval_check
-- (the >= 1 invariant on a different column). Narrow discovery to the exact
-- name with an enum-literal fallback for any Postgres-naming-quirk edge case.
-- The interval check stays untouched.
DO $rec_check$
DECLARE
  v_constraint_name text;
BEGIN
  SELECT conname INTO v_constraint_name
    FROM pg_constraint
   WHERE conrelid = 'public.task_templates'::regclass
     AND contype = 'c'
     AND (
       conname = 'task_templates_recurrence_check'
       OR (
         pg_get_constraintdef(oid) LIKE '%''once''%'
         AND pg_get_constraintdef(oid) LIKE '%''daily''%'
         AND pg_get_constraintdef(oid) LIKE '%''monthly''%'
       )
     )
   LIMIT 1;
  IF v_constraint_name IS NOT NULL THEN
    EXECUTE format('ALTER TABLE public.task_templates DROP CONSTRAINT %I', v_constraint_name);
  END IF;
END $rec_check$;

ALTER TABLE public.task_templates
  ADD CONSTRAINT task_templates_recurrence_check
  CHECK (recurrence IN ('once','daily','weekly','biweekly','monthly','quarterly'));

-- ----------------------------------------------------------------------------
-- (3) Required extensions
-- ----------------------------------------------------------------------------
CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ----------------------------------------------------------------------------
-- (4) Vault preflight — RAISE EXCEPTION if any TASKS_CRON_* secret is empty
-- ----------------------------------------------------------------------------
-- Codex amendment rev 2: vault.decrypted_secrets, not vault.read_secret.
-- Hard fail at apply time so a misconfigured project can't ship a cron
-- schedule that silently 4xx/5xx every fire forever.
DO $preflight$
DECLARE
  v_url    text;
  v_secret text;
  v_jwt    text;
BEGIN
  SELECT decrypted_secret INTO v_url    FROM vault.decrypted_secrets WHERE name = 'TASKS_CRON_FUNCTION_URL';
  SELECT decrypted_secret INTO v_secret FROM vault.decrypted_secrets WHERE name = 'TASKS_CRON_SECRET';
  SELECT decrypted_secret INTO v_jwt    FROM vault.decrypted_secrets WHERE name = 'TASKS_CRON_SERVICE_ROLE_KEY';
  IF coalesce(length(v_url),    0) = 0 THEN RAISE EXCEPTION 'mig 039: TASKS_CRON_FUNCTION_URL missing or empty in vault.decrypted_secrets'; END IF;
  IF coalesce(length(v_secret), 0) = 0 THEN RAISE EXCEPTION 'mig 039: TASKS_CRON_SECRET missing or empty in vault.decrypted_secrets'; END IF;
  IF coalesce(length(v_jwt),    0) = 0 THEN RAISE EXCEPTION 'mig 039: TASKS_CRON_SERVICE_ROLE_KEY missing or empty in vault.decrypted_secrets'; END IF;
END $preflight$;

-- ----------------------------------------------------------------------------
-- (5) public.invoke_tasks_cron() — Vault reads + http_post in one helper
-- ----------------------------------------------------------------------------
-- Cron schedule body becomes a clean one-liner SELECT against this helper.
-- Secret material lives in one auditable function with one search_path;
-- rotation = update Vault, no code edits.
--
-- Returns: net.http_post request id (bigint). pg_net is async — this id is
-- the ONLY signal pg_cron can act on at the SQL layer. Function-execution
-- audit lives separately in task_cron_runs (Edge Function-owned writes only).
-- Delivery audit lives in net._http_response.
CREATE OR REPLACE FUNCTION public.invoke_tasks_cron()
RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $invoke_tasks_cron$
DECLARE
  v_url    text;
  v_secret text;
  v_jwt    text;
  v_req_id bigint;
BEGIN
  SELECT decrypted_secret INTO v_url    FROM vault.decrypted_secrets WHERE name = 'TASKS_CRON_FUNCTION_URL';
  SELECT decrypted_secret INTO v_secret FROM vault.decrypted_secrets WHERE name = 'TASKS_CRON_SECRET';
  SELECT decrypted_secret INTO v_jwt    FROM vault.decrypted_secrets WHERE name = 'TASKS_CRON_SERVICE_ROLE_KEY';
  IF coalesce(length(v_url), 0) = 0 OR coalesce(length(v_secret), 0) = 0 OR coalesce(length(v_jwt), 0) = 0 THEN
    RAISE EXCEPTION 'invoke_tasks_cron: vault secret(s) missing/empty';
  END IF;
  SELECT net.http_post(
    url     := v_url,
    headers := jsonb_build_object(
                 'Authorization', 'Bearer ' || v_jwt,
                 'x-cron-secret', v_secret,
                 'Content-Type',  'application/json'
               ),
    body    := jsonb_build_object('mode','cron')
  ) INTO v_req_id;
  RETURN v_req_id;
END;
$invoke_tasks_cron$;

REVOKE ALL ON FUNCTION public.invoke_tasks_cron() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.invoke_tasks_cron() FROM anon;
REVOKE ALL ON FUNCTION public.invoke_tasks_cron() FROM authenticated;
GRANT EXECUTE ON FUNCTION public.invoke_tasks_cron() TO postgres;

-- ----------------------------------------------------------------------------
-- (6) public.generate_task_instances(text, date[]) — bulk insert + idempotency
-- ----------------------------------------------------------------------------
-- Owns the partial-unique-index ON CONFLICT contract. The Edge Function
-- calls this once per template with the missing-dates array; the function
-- inserts each as a task_instances row, deduping against the partial unique
-- index from mig 037 (template_id, due_date) WHERE template_id IS NOT NULL.
--
-- Single-statement INSERT with ON CONFLICT DO NOTHING does NOT abort on
-- duplicate. GET DIAGNOSTICS captures inserted row count for the caller.
-- Caller computes skipped_count = len(p_dates) - inserted (race losses).
--
-- Service-role bypasses RLS; explicit GRANT TO service_role makes the
-- intended call path loud. Anon / authenticated cannot call this — this is
-- a service-context RPC, NOT a public-submit path.
CREATE OR REPLACE FUNCTION public.generate_task_instances(
  p_template_id text,
  p_dates date[]
)
RETURNS int
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $generate_task_instances$
DECLARE
  v_template public.task_templates;
  v_inserted int;
BEGIN
  IF p_template_id IS NULL OR p_template_id = '' THEN
    RAISE EXCEPTION 'generate_task_instances: p_template_id required';
  END IF;
  IF p_dates IS NULL OR array_length(p_dates, 1) IS NULL THEN
    -- Empty / null array is a no-op; return 0 explicitly so the caller
    -- doesn't have to special-case it.
    RETURN 0;
  END IF;

  SELECT * INTO v_template FROM public.task_templates WHERE id = p_template_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'generate_task_instances: unknown template_id %', p_template_id;
  END IF;
  IF NOT v_template.active THEN
    RAISE EXCEPTION 'generate_task_instances: template % is not active', p_template_id;
  END IF;

  INSERT INTO public.task_instances (
    id,
    template_id,
    assignee_profile_id,
    due_date,
    title,
    description,
    submission_source,
    status
  )
  SELECT
    'ti-' || replace(gen_random_uuid()::text, '-', ''),
    v_template.id,
    v_template.assignee_profile_id,
    d,
    v_template.title,
    v_template.description,
    'generated',
    'open'
  FROM unnest(p_dates) AS d
  ON CONFLICT (template_id, due_date) WHERE template_id IS NOT NULL DO NOTHING;

  GET DIAGNOSTICS v_inserted = ROW_COUNT;
  RETURN v_inserted;
END;
$generate_task_instances$;

REVOKE ALL ON FUNCTION public.generate_task_instances(text, date[]) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.generate_task_instances(text, date[]) FROM anon;
REVOKE ALL ON FUNCTION public.generate_task_instances(text, date[]) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.generate_task_instances(text, date[]) TO service_role;

-- ----------------------------------------------------------------------------
-- (7) cron schedule — tasks-cron-daily at 04:00 UTC
-- ----------------------------------------------------------------------------
-- Idempotent: unschedule the prior job (if any) before re-scheduling so
-- re-applying this migration doesn't accumulate duplicate jobs.
DO $sched$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'tasks-cron-daily') THEN
    PERFORM cron.unschedule('tasks-cron-daily');
  END IF;
END $sched$;

SELECT cron.schedule(
  'tasks-cron-daily',
  '0 4 * * *',
  $cron_body$ SELECT public.invoke_tasks_cron(); $cron_body$
);

-- ----------------------------------------------------------------------------
-- DELIBERATELY NOT SCHEDULED: tasks-cron-weekly
-- ----------------------------------------------------------------------------
-- The Monday 13:00 UTC weekly-summary slot is locked for Phase F. Phase B
-- explicitly does NOT schedule it as a no-op placeholder — silent-success
-- noise risk if Phase F's wiring forgets to overwrite. Phase F owns its own
-- creation.

COMMIT;
