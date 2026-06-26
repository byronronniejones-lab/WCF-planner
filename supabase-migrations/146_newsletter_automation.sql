-- ============================================================================
-- 146_newsletter_automation.sql
-- ----------------------------------------------------------------------------
-- Monthly Newsletter — Checkpoint B automation layer.
--
-- Migration 144 owns the data model + access boundary and the three anon read
-- RPCs. This file owns the SERVER-SIDE automation surface the newsletter-harvest
-- Edge Function and the monthly cron use:
--
--   1. ensure_newsletter_issue(year_month)            — idempotent create-or-get
--   2. replace_newsletter_harvest_facts(issue, facts) — upsert harvested facts
--   3. get_newsletter_generation_input(issue)         — facts+intake+settings
--   4. apply_newsletter_ai_draft(issue, payload, ...) — persist AI/template draft
--   5. log_newsletter_run(...)                         — newsletter_runs audit row
--   6. list_newsletter_runs_admin(issue)              — admin run-history read
--   7. create_newsletter_reminder_task(year_month)    — coordinated monthly task
--   8. invoke_newsletter_cron()                        — Vault read + http_post
--
-- SECURITY MODEL (mirrors mig 039 tasks-cron + mig 144):
--   - Functions 1-5 and 7 are SERVICE-CONTEXT RPCs: REVOKE from anon +
--     authenticated, GRANT EXECUTE TO service_role ONLY. The Edge Function
--     authenticates the caller (cron secret OR is_admin on the user JWT) and
--     THEN calls these with the service-role client — exactly the
--     generate_task_instances pattern. They carry NO auth.uid() admin gate
--     because the service-role grant IS the boundary (service_role has no
--     auth.uid()).
--   - Function 6 is an admin READ: authenticated + _newsletter_assert_admin().
--   - Function 8 is postgres-only (pg_cron runs it).
--   - The five newsletter_* tables stay deny-all RLS (mig 144). Nothing here
--     widens the anon surface — mig 144's exactly-three anon RPCs are unchanged.
--
-- EDITORIAL BOUNDARY (defense in depth): replace_newsletter_harvest_facts drops
-- any candidate whose text trips the finance/mortality denylist, matching the
-- JS detector guard (src/lib/newsletterFacts.js isForbiddenFact). A forbidden
-- fact reaching the DB means a bug/tamper upstream; it is silently NOT inserted.
--
-- NO BEGIN/COMMIT: TEST applies via exec_sql (rejects them); PROD applies with
-- psql --single-transaction. NO apply-time Vault preflight (unlike mig 039) so
-- TEST apply succeeds before the newsletter Vault secrets exist — invoke_*
-- reads Vault at CALL time and raises only if invoked unconfigured.
--
-- GATE: the monthly cron.schedule is intentionally NOT executed here (see the
-- commented block at the end). Cron enablement requires the Edge Function
-- deploy + Vault secrets + Ronnie approval; enabling it is a separate gated
-- step, not part of TEST apply.
--
-- Apply order: TEST first (after 144/145), PROD after lane approval.
-- Depends on: mig 144 (newsletter tables + _newsletter_assert_admin /
-- _newsletter_issue_summary), mig 036 (task_instances), pg_cron + pg_net.
-- ============================================================================

CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions;

-- ── 1. ensure_newsletter_issue ──────────────────────────────────────────────
-- Idempotent create-or-get for a month. Used by the monthly automation (cron
-- has no auth.uid(), so created_by/updated_by stay NULL for service mints).
CREATE OR REPLACE FUNCTION public.ensure_newsletter_issue(p_year_month text)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_start date;
  v_end   date;
  v_id    text;
BEGIN
  IF p_year_month IS NULL OR p_year_month !~ '^[0-9]{4}-(0[1-9]|1[0-2])$' THEN
    RAISE EXCEPTION 'NEWSLETTER_VALIDATION: year_month must be YYYY-MM (month 01-12)';
  END IF;

  v_id := 'nli-' || p_year_month;

  SELECT id INTO v_id FROM public.newsletter_issues WHERE id = v_id;
  IF FOUND THEN
    RETURN v_id;
  END IF;

  v_id    := 'nli-' || p_year_month;
  v_start := to_date(p_year_month || '-01', 'YYYY-MM-DD');
  v_end   := (v_start + interval '1 month' - interval '1 day')::date;

  INSERT INTO public.newsletter_issues (
    id, year_month, slug, title, status, period_start, period_end,
    noindex, preview_token, preview_enabled, preview_expires_at
  )
  VALUES (
    v_id, p_year_month, p_year_month,
    'White Creek Farm ' || to_char(v_start, 'FMMonth YYYY') || ' Review',
    'draft', v_start, v_end,
    true, encode(extensions.gen_random_bytes(16), 'hex'), true, now() + interval '30 days'
  )
  ON CONFLICT (id) DO NOTHING;

  RETURN v_id;
END
$fn$;

REVOKE ALL ON FUNCTION public.ensure_newsletter_issue(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ensure_newsletter_issue(text) TO service_role;

-- ── 2. replace_newsletter_harvest_facts ─────────────────────────────────────
-- Replace the auto-harvested (non-manual) fact candidates for an issue from a
-- detector-produced JSON array. Manual facts are preserved. The prior `included`
-- choice for a detector_key is preserved across re-harvest so an admin's
-- keep/exclude survives. Forbidden (finance/mortality) candidates are dropped.
CREATE OR REPLACE FUNCTION public.replace_newsletter_harvest_facts(
  p_issue_id text,
  p_facts    jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_fact      jsonb;
  v_key       text;
  v_title     text;
  v_summary   text;
  v_program   text;
  v_haystack  text;
  v_included  boolean;
  v_id        text;
  v_prev      jsonb;
  -- Whole-word finance/mortality denylist (mirrors isForbiddenFact in JS).
  c_forbidden constant text :=
    '\m(mortalit(y|ies)|died|death|deaths|dead|deceased|perished|cull|culled|culls|loss|losses|price|priced|pricing|cost|costs|revenue|profit|profits|income|expense|expenses|dollar|dollars|sale|sales|sold|invoice|invoiced|paid|payment|earnings)\M';
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.newsletter_issues WHERE id = p_issue_id) THEN
    RAISE EXCEPTION 'NEWSLETTER_VALIDATION: issue not found';
  END IF;
  IF p_facts IS NULL OR jsonb_typeof(p_facts) <> 'array' THEN
    RAISE EXCEPTION 'NEWSLETTER_VALIDATION: facts must be a JSON array';
  END IF;

  -- Snapshot prior included choices (detector_key -> included) so an admin's
  -- keep/exclude survives re-harvest, then clear the non-manual candidates.
  SELECT COALESCE(jsonb_object_agg(detector_key, included), '{}'::jsonb)
    INTO v_prev
    FROM public.newsletter_fact_candidates
   WHERE issue_id = p_issue_id AND NOT is_manual;

  DELETE FROM public.newsletter_fact_candidates
   WHERE issue_id = p_issue_id AND NOT is_manual;

  FOR v_fact IN SELECT * FROM jsonb_array_elements(p_facts)
  LOOP
    v_key     := NULLIF(btrim(v_fact->>'detectorKey'), '');
    v_title   := NULLIF(btrim(v_fact->>'title'), '');
    v_summary := NULLIF(btrim(v_fact->>'summary'), '');
    v_program := COALESCE(NULLIF(btrim(v_fact->>'program'), ''), 'general');

    IF v_key IS NULL OR v_title IS NULL THEN
      CONTINUE; -- malformed candidate
    END IF;

    -- Defense in depth: drop any finance/mortality candidate.
    v_haystack := lower(concat_ws(' ', v_title, v_summary, v_program, v_key,
                                  v_fact->>'displayValue'));
    IF v_haystack ~ c_forbidden OR v_haystack LIKE '%$%' THEN
      CONTINUE;
    END IF;

    v_included := COALESCE((v_prev->>v_key)::boolean, true);

    v_id := 'nlf-' || encode(extensions.gen_random_bytes(8), 'hex');

    INSERT INTO public.newsletter_fact_candidates (
      id, issue_id, detector_key, program, title, summary,
      metric_value, display_value, source_refs, comparison, confidence,
      included, is_manual, evidence_payload, sort_order
    )
    VALUES (
      v_id, p_issue_id, v_key, v_program, v_title, v_summary,
      CASE WHEN jsonb_typeof(v_fact->'metricValue') = 'number'
           THEN (v_fact->>'metricValue')::numeric ELSE NULL END,
      NULLIF(btrim(v_fact->>'displayValue'), ''),
      COALESCE(v_fact->'sourceRefs', '[]'::jsonb),
      COALESCE(v_fact->'comparison', '{}'::jsonb),
      CASE WHEN (v_fact->>'confidence') IN ('high','medium','low')
           THEN v_fact->>'confidence' ELSE 'medium' END,
      v_included, false,
      COALESCE(v_fact->'evidence', '{}'::jsonb),
      COALESCE((v_fact->>'sortOrder')::int, 0)
    )
    ON CONFLICT (issue_id, detector_key) DO NOTHING;
  END LOOP;

  RETURN public._newsletter_issue_summary(p_issue_id);
END
$fn$;

REVOKE ALL ON FUNCTION public.replace_newsletter_harvest_facts(text, jsonb)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.replace_newsletter_harvest_facts(text, jsonb) TO service_role;

-- ── 3. get_newsletter_generation_input ──────────────────────────────────────
-- The AI-draft input bundle: issue meta + INCLUDED facts + intake + tone/model.
-- Returns nothing sensitive beyond the admin-only newsletter data the Edge
-- Function (already authenticated) needs to build the prompt.
CREATE OR REPLACE FUNCTION public.get_newsletter_generation_input(p_issue_id text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
STABLE
AS $fn$
DECLARE
  v jsonb;
BEGIN
  SELECT jsonb_build_object(
    'issue', jsonb_build_object(
      'id', i.id,
      'yearMonth', i.year_month,
      'title', i.title,
      'periodStart', i.period_start,
      'periodEnd', i.period_end
    ),
    'intake', i.intake_answers,
    'settings', jsonb_build_object(
      'tone', s.tone,
      'aiProvider', s.ai_provider,
      'aiModel', s.ai_model
    ),
    'facts', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'detectorKey', f.detector_key,
        'program', f.program,
        'title', f.title,
        'summary', f.summary,
        'metricValue', f.metric_value,
        'displayValue', f.display_value,
        'confidence', f.confidence,
        'evidence', f.evidence_payload
      ) ORDER BY f.sort_order, f.created_at)
      FROM public.newsletter_fact_candidates f
      WHERE f.issue_id = i.id AND f.included
    ), '[]'::jsonb)
  )
  INTO v
  FROM public.newsletter_issues i
  CROSS JOIN public.newsletter_settings s
  WHERE i.id = p_issue_id AND s.id = 'singleton';

  IF v IS NULL THEN
    RAISE EXCEPTION 'NEWSLETTER_VALIDATION: issue not found';
  END IF;
  RETURN v;
END
$fn$;

REVOKE ALL ON FUNCTION public.get_newsletter_generation_input(text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_newsletter_generation_input(text) TO service_role;

-- ── 4. apply_newsletter_ai_draft ────────────────────────────────────────────
-- Persist a generated draft. p_payload must be an object with a `blocks` array
-- (already whitelist-validated by the Edge Function via validateNewsletterBlocks).
-- p_overwrite=false (the monthly pre-seed default) will NOT clobber a draft that
-- already has blocks — it returns the issue unchanged so admin edits survive.
CREATE OR REPLACE FUNCTION public.apply_newsletter_ai_draft(
  p_issue_id  text,
  p_payload   jsonb,
  p_provider  text DEFAULT NULL,
  p_model     text DEFAULT NULL,
  p_overwrite boolean DEFAULT true
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_existing jsonb;
BEGIN
  IF p_payload IS NULL OR jsonb_typeof(p_payload) <> 'object'
     OR jsonb_typeof(p_payload->'blocks') <> 'array' THEN
    RAISE EXCEPTION 'NEWSLETTER_VALIDATION: draft payload must be an object with a blocks array';
  END IF;

  SELECT draft_payload INTO v_existing FROM public.newsletter_issues WHERE id = p_issue_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'NEWSLETTER_VALIDATION: issue not found';
  END IF;

  -- Non-overwrite pre-seed: skip if the admin already has draft blocks.
  IF NOT COALESCE(p_overwrite, true)
     AND v_existing IS NOT NULL
     AND jsonb_typeof(v_existing->'blocks') = 'array'
     AND jsonb_array_length(v_existing->'blocks') > 0 THEN
    RETURN public._newsletter_issue_summary(p_issue_id);
  END IF;

  UPDATE public.newsletter_issues
     SET draft_payload = COALESCE(draft_payload, '{}'::jsonb) || p_payload,
         generated_at  = now(),
         updated_at    = now()
   WHERE id = p_issue_id;

  RETURN public._newsletter_issue_summary(p_issue_id);
END
$fn$;

REVOKE ALL ON FUNCTION public.apply_newsletter_ai_draft(text, jsonb, text, text, boolean)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.apply_newsletter_ai_draft(text, jsonb, text, text, boolean) TO service_role;

-- ── 5. log_newsletter_run ───────────────────────────────────────────────────
-- One audit row per harvest / ai_draft / task_create / publish attempt.
CREATE OR REPLACE FUNCTION public.log_newsletter_run(
  p_issue_id   text,
  p_run_type   text,
  p_provider   text DEFAULT NULL,
  p_model      text DEFAULT NULL,
  p_status     text DEFAULT 'ok',
  p_error      text DEFAULT NULL,
  p_input_hash text DEFAULT NULL
)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_id text;
BEGIN
  IF p_run_type NOT IN ('harvest','ai_draft','task_create','publish') THEN
    RAISE EXCEPTION 'NEWSLETTER_VALIDATION: invalid run_type %', p_run_type;
  END IF;

  v_id := 'nlr-' || encode(extensions.gen_random_bytes(8), 'hex');

  INSERT INTO public.newsletter_runs (
    id, issue_id, run_type, provider, model, input_hash, status, error
  )
  VALUES (
    v_id, p_issue_id, p_run_type, NULLIF(btrim(p_provider), ''),
    NULLIF(btrim(p_model), ''), NULLIF(btrim(p_input_hash), ''),
    CASE WHEN p_status IN ('started','ok','error') THEN p_status ELSE 'ok' END,
    NULLIF(btrim(p_error), '')
  );

  RETURN v_id;
END
$fn$;

REVOKE ALL ON FUNCTION public.log_newsletter_run(text, text, text, text, text, text, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.log_newsletter_run(text, text, text, text, text, text, text) TO service_role;

-- ── 6. list_newsletter_runs_admin (admin read) ──────────────────────────────
CREATE OR REPLACE FUNCTION public.list_newsletter_runs_admin(p_issue_id text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v jsonb;
BEGIN
  PERFORM public._newsletter_assert_admin();

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'id', r.id,
    'runType', r.run_type,
    'provider', r.provider,
    'model', r.model,
    'status', r.status,
    'error', r.error,
    'createdAt', r.created_at
  ) ORDER BY r.created_at DESC), '[]'::jsonb)
  INTO v
  FROM public.newsletter_runs r
  WHERE p_issue_id IS NULL OR r.issue_id = p_issue_id;

  RETURN v;
END
$fn$;

REVOKE ALL ON FUNCTION public.list_newsletter_runs_admin(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.list_newsletter_runs_admin(text) TO authenticated;

-- ── 7. create_newsletter_reminder_task ──────────────────────────────────────
-- The "one coordinated late-month task." Mints a single reminder task_instance
-- for the configured newsletter assignee, idempotent per month via
-- client_submission_id. No-op (no row) if no assignee is configured. Runs in the
-- newsletter service context (no app-side Task API client), so it does not cross
-- the source-level Task API boundary guard.
CREATE OR REPLACE FUNCTION public.create_newsletter_reminder_task(p_year_month text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_assignee uuid;
  v_start    date;
  v_end      date;
  v_csid     text;
  v_id       text;
  v_title    text;
BEGIN
  IF p_year_month IS NULL OR p_year_month !~ '^[0-9]{4}-(0[1-9]|1[0-2])$' THEN
    RAISE EXCEPTION 'NEWSLETTER_VALIDATION: year_month must be YYYY-MM (month 01-12)';
  END IF;

  SELECT task_assignee_profile_id INTO v_assignee
    FROM public.newsletter_settings WHERE id = 'singleton';
  IF v_assignee IS NULL THEN
    RETURN jsonb_build_object('created', false, 'reason', 'no newsletter assignee configured');
  END IF;

  v_start := to_date(p_year_month || '-01', 'YYYY-MM-DD');
  v_end   := (v_start + interval '1 month' - interval '1 day')::date;
  v_csid  := 'nl-reminder-' || p_year_month;
  v_id    := 'ti-nl-' || replace(p_year_month, '-', '');
  v_title := 'Build the ' || to_char(v_start, 'FMMonth YYYY') || ' newsletter';

  -- designation='system' (explicit) so the reminder surfaces in the Tasks
  -- "System" filter + badge for its assignee. It is a one-off coordinated task,
  -- not a recurring system rule, so from_system_rule_id stays NULL; the mig 053
  -- BEFORE INSERT trigger only fills designation when NULL, so this explicit
  -- value survives.
  INSERT INTO public.task_instances (
    id, template_id, assignee_profile_id, due_date, title, description,
    submission_source, status, designation, client_submission_id
  )
  VALUES (
    v_id, NULL, v_assignee, v_end, v_title,
    'Harvest facts, review the AI draft, add photos, and publish the monthly newsletter.',
    'generated', 'open', 'system', v_csid
  )
  ON CONFLICT (client_submission_id) DO NOTHING;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('created', false, 'reason', 'already exists', 'clientSubmissionId', v_csid);
  END IF;
  RETURN jsonb_build_object('created', true, 'taskId', v_id, 'clientSubmissionId', v_csid);
END
$fn$;

REVOKE ALL ON FUNCTION public.create_newsletter_reminder_task(text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.create_newsletter_reminder_task(text) TO service_role;

-- ── 8. invoke_newsletter_cron (Vault read + http_post) ──────────────────────
-- Mirrors mig 039 invoke_tasks_cron: one auditable helper that reads the three
-- newsletter cron secrets from Vault and POSTs {mode:'cron'} to the Edge
-- Function. Returns the pg_net request id. Reads Vault at CALL time only — NO
-- apply-time preflight — so TEST apply succeeds before the secrets exist.
CREATE OR REPLACE FUNCTION public.invoke_newsletter_cron()
RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_url    text;
  v_secret text;
  v_jwt    text;
  v_req_id bigint;
BEGIN
  -- Trim at call time: paste-deploy of a Vault secret often picks up a trailing
  -- newline/space, which would corrupt the Bearer header. NULLIF(btrim(...),'')
  -- also collapses a whitespace-only secret to NULL so the guard below fires.
  SELECT NULLIF(btrim(decrypted_secret), '') INTO v_url
    FROM vault.decrypted_secrets WHERE name = 'NEWSLETTER_CRON_FUNCTION_URL';
  SELECT NULLIF(btrim(decrypted_secret), '') INTO v_secret
    FROM vault.decrypted_secrets WHERE name = 'NEWSLETTER_CRON_SECRET';
  SELECT NULLIF(btrim(decrypted_secret), '') INTO v_jwt
    FROM vault.decrypted_secrets WHERE name = 'NEWSLETTER_CRON_SERVICE_ROLE_KEY';
  IF v_url IS NULL OR v_secret IS NULL OR v_jwt IS NULL THEN
    RAISE EXCEPTION 'invoke_newsletter_cron: vault secret(s) missing/empty';
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
END
$fn$;

REVOKE ALL ON FUNCTION public.invoke_newsletter_cron() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.invoke_newsletter_cron() TO postgres;

-- ----------------------------------------------------------------------------
-- GATE — monthly cron schedule (NOT executed by this migration)
-- ----------------------------------------------------------------------------
-- Enabling the schedule is a separate, Ronnie-approved rollout step that runs
-- AFTER: (a) the newsletter-harvest Edge Function is deployed, and (b) the three
-- NEWSLETTER_CRON_* Vault secrets exist. Run this once, manually, at that point
-- (fires 06:00 UTC on the 25th — late-month, so the issue is pre-seeded before
-- month end):
--
--   DO $sched$
--   BEGIN
--     IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'newsletter-monthly') THEN
--       PERFORM cron.unschedule('newsletter-monthly');
--     END IF;
--   END $sched$;
--   SELECT cron.schedule('newsletter-monthly', '0 6 25 * *',
--                        $cron$ SELECT public.invoke_newsletter_cron(); $cron$);
-- ----------------------------------------------------------------------------

NOTIFY pgrst, 'reload schema';
