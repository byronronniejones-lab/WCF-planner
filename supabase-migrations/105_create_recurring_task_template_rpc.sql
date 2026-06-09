-- ============================================================================
-- 105_create_recurring_task_template_rpc.sql
-- ----------------------------------------------------------------------------
-- Task Center "New Task" recurring path — server entry point for NON-ADMIN
-- recurring-template creation.
--
-- Context: task_templates RLS is admin-only (037 task_templates_admin_all:
-- USING/WITH CHECK is_admin()). The Task Center New Task modal offers a
-- One-time/Recurring toggle to every authenticated role except Light. Without
-- a server path, management/farm_team/equipment_tech would pick Recurring and
-- then hit an RLS write failure on task_templates. Ronnie's decision (keep the
-- toggle available to all non-Light roles) requires this approved server path.
--
-- Rather than broaden the task_templates table RLS (which would let non-admins
-- UPSERT — and thus overwrite — arbitrary templates, and cannot scope the
-- idempotent retry to "own" rows because the modal does not stamp an owner),
-- we add ONE SECURITY DEFINER RPC that:
--   * requires an authenticated caller whose role is NOT light and NOT
--     inactive (i.e. admin / management / farm_team / equipment_tech),
--   * server-stamps created_by_profile_id from auth.uid() (never trusts a
--     client-supplied owner in the payload),
--   * validates the same fields the table CHECKs enforce (recurrence enum
--     incl. quarterly per mig 039, interval >= 1, required title/assignee/
--     first_due_date),
--   * is idempotent by the client-minted template id (ON CONFLICT DO NOTHING),
--   * is the ONLY non-admin write path; the admin RecurringTemplateModal keeps
--     its direct task_templates_admin_all RLS write for full management.
--
-- Mirrors create_one_time_task_instance (mig 053): SECURITY DEFINER,
-- search_path public, REVOKE PUBLIC/anon + GRANT authenticated. Anon callers
-- have auth.uid() = NULL so the function rejects them; revoking anon EXECUTE is
-- safe here because this RPC is never evaluated in the login/auth RLS path
-- (unlike is_admin, which deliberately keeps anon EXECUTE).
-- ============================================================================

CREATE OR REPLACE FUNCTION public.create_recurring_task_template(
  p_template jsonb
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $create_recurring$
DECLARE
  v_caller uuid := auth.uid();
  v_role text;
  v_id text := p_template->>'id';
  v_title text := p_template->>'title';
  v_description text := p_template->>'description';
  v_assignee_text text := p_template->>'assignee_profile_id';
  v_assignee uuid;
  v_recurrence text := p_template->>'recurrence';
  v_interval_text text := p_template->>'recurrence_interval';
  v_interval int;
  v_first_due_text text := p_template->>'first_due_date';
  v_first_due date;
  v_active boolean := COALESCE((p_template->>'active')::boolean, true);
  v_notes text := p_template->>'notes';
  v_inserted_id text;
BEGIN
  IF v_caller IS NULL THEN
    RAISE EXCEPTION 'create_recurring_task_template: authenticated caller required';
  END IF;

  -- Role gate: every authenticated role EXCEPT light/inactive may create a
  -- recurring template. Light users are contained to their allowlist; inactive
  -- users cannot mutate. This is the server boundary — the modal's toggle
  -- hiding is only UX. A NULL/unknown role fails closed.
  SELECT role INTO v_role FROM public.profiles WHERE id = v_caller;
  IF v_role IS NULL OR v_role IN ('light', 'inactive') THEN
    RAISE EXCEPTION 'create_recurring_task_template: role % may not create recurring tasks', COALESCE(v_role, 'unknown');
  END IF;

  -- Required-field validation (mirror the NewTaskModal validation and the
  -- task_templates CHECK constraints so a bad payload fails loudly here).
  IF v_id IS NULL OR length(trim(v_id)) = 0 THEN
    RAISE EXCEPTION 'create_recurring_task_template: id required';
  END IF;
  IF v_title IS NULL OR length(trim(v_title)) < 3 THEN
    RAISE EXCEPTION 'create_recurring_task_template: title required (min 3 chars)';
  END IF;
  IF v_assignee_text IS NULL OR length(trim(v_assignee_text)) = 0 THEN
    RAISE EXCEPTION 'create_recurring_task_template: assignee_profile_id required';
  END IF;
  IF v_recurrence IS NULL OR v_recurrence NOT IN ('once', 'daily', 'weekly', 'biweekly', 'monthly', 'quarterly') THEN
    RAISE EXCEPTION 'create_recurring_task_template: invalid recurrence %', COALESCE(v_recurrence, '(null)');
  END IF;
  IF v_first_due_text IS NULL OR length(trim(v_first_due_text)) = 0 THEN
    RAISE EXCEPTION 'create_recurring_task_template: first_due_date required';
  END IF;

  v_assignee := v_assignee_text::uuid;
  v_first_due := v_first_due_text::date;
  v_interval := COALESCE(NULLIF(trim(COALESCE(v_interval_text, '')), '')::int, 1);
  IF v_interval < 1 THEN
    RAISE EXCEPTION 'create_recurring_task_template: recurrence_interval must be >= 1';
  END IF;

  -- Assignee must be an eligible (non-inactive) profile, same gate as
  -- create_one_time_task_instance.
  IF NOT EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = v_assignee AND role IS DISTINCT FROM 'inactive'
  ) THEN
    RAISE EXCEPTION 'create_recurring_task_template: assignee % is not eligible', v_assignee;
  END IF;

  -- Idempotent insert by the client-minted id. created_by_profile_id is
  -- server-stamped from the caller; any client-supplied owner in the payload
  -- is ignored.
  INSERT INTO public.task_templates (
    id, title, description, assignee_profile_id,
    recurrence, recurrence_interval, first_due_date,
    notes, active, created_by_profile_id
  )
  VALUES (
    v_id, v_title, NULLIF(trim(COALESCE(v_description, '')), ''), v_assignee,
    v_recurrence, v_interval, v_first_due,
    NULLIF(trim(COALESCE(v_notes, '')), ''), v_active, v_caller
  )
  ON CONFLICT (id) DO NOTHING
  RETURNING id INTO v_inserted_id;

  IF v_inserted_id IS NULL THEN
    -- Replay: id already used (idempotent retry). Return the existing row.
    SELECT id INTO v_inserted_id FROM public.task_templates WHERE id = v_id LIMIT 1;
    RETURN jsonb_build_object(
      'ok', true,
      'idempotent_replay', true,
      'template_id', v_inserted_id
    );
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'idempotent_replay', false,
    'template_id', v_inserted_id,
    'created_by_profile_id', v_caller
  );
END;
$create_recurring$;

REVOKE ALL ON FUNCTION public.create_recurring_task_template(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_recurring_task_template(jsonb) TO authenticated;

NOTIFY pgrst, 'reload schema';

-- ============================================================================
-- End of 105_create_recurring_task_template_rpc.sql
-- ============================================================================
