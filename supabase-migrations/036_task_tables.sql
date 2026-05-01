-- ============================================================================
-- Migration 036: Tasks module v1 — table contracts (Phase A)
-- ----------------------------------------------------------------------------
-- DB-only build. Adds the three tables Tasks v1 depends on. NO RLS policies,
-- NO RPCs, NO storage bucket here — those land in 037 / 038 / later
-- migrations. RLS is enabled on every table so a service-role-only state is
-- the default until 037 grants any role access.
--
-- Locked decisions reflected here (rev 5 plan packet):
--   - Assignee is profiles.id (NOT roster id). Hard FK with ON DELETE
--     RESTRICT so admin can't accidentally orphan tasks by deleting a
--     profile.
--   - One assignee per task in v1 (single column, no junction table).
--   - status enum is {'open','completed'} only — no in_progress / skipped.
--   - Recurrence enum is {'once','daily','weekly','biweekly','monthly'}.
--   - Templates default active=false; admin must explicitly enable post
--     cron-verification (Phase B). Generation cannot start before cron is
--     the floor.
--   - Public submitters cannot impose photo gates: requires_photo on a
--     submission_source='public_webform' instance is locked false by the
--     Phase E RPC body (mig 041). Schema column stays for templates and
--     admin-manual instances.
--   - completion_note / task_audit / reopen / reassignment all DEFERRED
--     from v1 (Codex blocker 6 in plan rev 3).
--
-- task_cron_runs is the operator-facing visibility surface for the 90-cap
-- safety + cron-run audit (Phase B): admin-only SELECT, service-role-only
-- INSERT (the edge function bypasses RLS as function owner). One column
-- captures whether a run came from the cron path or from an admin's "Run
-- Cron Now" button — both routes write here.
--
-- Idempotent: CREATE TABLE IF NOT EXISTS + ALTER TABLE IF EXISTS … ADD
-- COLUMN IF NOT EXISTS where applicable. Safe to re-apply.
-- ============================================================================

BEGIN;

-- ----------------------------------------------------------------------------
-- (1) task_templates — admin-defined task definitions (recurring or one-off)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.task_templates (
  id                       text PRIMARY KEY,
  title                    text NOT NULL,
  description              text,
  assignee_profile_id      uuid NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  recurrence               text NOT NULL CHECK (recurrence IN ('once','daily','weekly','biweekly','monthly')),
  recurrence_interval      int  NOT NULL DEFAULT 1 CHECK (recurrence_interval >= 1),
  first_due_date           date NOT NULL,
  requires_photo           boolean NOT NULL DEFAULT false,
  notes                    text,
  active                   boolean NOT NULL DEFAULT false,  -- admin must enable post cron verification
  created_at               timestamptz NOT NULL DEFAULT now(),
  created_by_profile_id    uuid REFERENCES public.profiles(id)  -- nullable for service-mint paths
);

ALTER TABLE public.task_templates ENABLE ROW LEVEL SECURITY;

-- ----------------------------------------------------------------------------
-- (2) task_instances — generated occurrences + one-off public submissions
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.task_instances (
  id                          text PRIMARY KEY,
  template_id                 text REFERENCES public.task_templates(id) ON DELETE RESTRICT,
  assignee_profile_id         uuid NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  due_date                    date NOT NULL,
  title                       text NOT NULL,                 -- copied from template at gen time; rename-safe
  description                 text,                          -- copied from template at gen time
  requires_photo              boolean NOT NULL DEFAULT false,
  submitted_by_team_member    text,                          -- display-name string for public-webform rows
  submission_source           text NOT NULL DEFAULT 'generated'
                                CHECK (submission_source IN ('generated','public_webform','admin_manual')),
  status                      text NOT NULL DEFAULT 'open'
                                CHECK (status IN ('open','completed')),
  completed_at                timestamptz,
  completed_by_profile_id     uuid REFERENCES public.profiles(id),
  completion_photo_path       text,                          -- task-photos/<assignee_uid>/<instance_id>/photo.jpg
  client_submission_id        text UNIQUE,                   -- anon-submit idempotency key (mig 030 pattern)
  created_at                  timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.task_instances ENABLE ROW LEVEL SECURITY;

-- ----------------------------------------------------------------------------
-- (3) task_cron_runs — append-only cron + admin-manual run audit
-- ----------------------------------------------------------------------------
-- Visibility surface for the 90-instance cap and any cron error_message.
-- Phase C admin Tasks tab reads the latest row to render a "Last cron run"
-- footer. INSERT bypasses RLS as the edge function runs with service-role.
CREATE TABLE IF NOT EXISTS public.task_cron_runs (
  id                text PRIMARY KEY,
  ran_at            timestamptz NOT NULL DEFAULT now(),
  run_mode          text NOT NULL DEFAULT 'cron'
                      CHECK (run_mode IN ('cron','admin')),
  generated_count   int  NOT NULL DEFAULT 0,
  skipped_count     int  NOT NULL DEFAULT 0,
  cap_exceeded      jsonb NOT NULL DEFAULT '[]'::jsonb,  -- [{template_id, horizon_size, capped_at}]
  error_message     text
);

ALTER TABLE public.task_cron_runs ENABLE ROW LEVEL SECURITY;

-- ----------------------------------------------------------------------------
-- DELIBERATELY NOT ADDED IN MIGRATION 036 (lands in 037+):
--   * is_admin() helper        — mig 037
--   * RLS policies             — mig 037
--   * indexes                  — mig 037
--   * task-photos bucket       — mig 038
--   * complete_task_instance() — mig 040 (Phase D)
--   * submit_task_instance()   — mig 041 (Phase E)
--   * list_eligible_assignees()— mig 041 (Phase E)
--   * cron schedule            — mig 039 (Phase B)
--
-- Until mig 037 lands, these tables are reachable only by service-role.
-- That's the deliberate "schema-with-no-exposure" state the rev-5 plan
-- packet locks for Phase A handoff.
-- ----------------------------------------------------------------------------

COMMIT;
