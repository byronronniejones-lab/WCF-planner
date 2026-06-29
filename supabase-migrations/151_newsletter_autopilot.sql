-- ============================================================================
-- 151_newsletter_autopilot.sql
-- ----------------------------------------------------------------------------
-- Monthly Newsletter — Autopilot rebuild data contracts.
--
-- Migration 144 owns the data model + the three anon RPCs; 146 owns the
-- service-context automation RPCs. This file extends BOTH for the autopilot
-- workflow (one "Prepare issue" action + an editorial brief + real settings
-- controls + honest source coverage). It adds NO new anon surface: every RPC
-- here is admin-only (authenticated + _newsletter_assert_admin) or
-- service_role-only, so mig 144's "exactly three anon RPCs" invariant holds.
--
-- What it adds:
--   1. newsletter_settings: real-control columns — tone_preset, length_detail,
--      photo_min, photo_target, past_issue_context_count. (ai_provider/ai_model/
--      tone already exist from 144.)
--   2. newsletter_issues.source_coverage jsonb — the harvest writes one entry
--      per scanned source (status scanned/empty/unavailable/error) so the admin
--      brief can show coverage honestly instead of silent empties.
--   3. get_newsletter_settings / update_newsletter_settings — return + accept the
--      new controls (old 6-arg update is dropped; the client passes all args).
--   4. _newsletter_issue_summary — surfaces sourceCoverage on the admin issue.
--   5. get_newsletter_generation_input — adds recent published-issue context
--      (titles + included-fact titles + body text) and tone_preset/length_detail
--      so the Edge Function prompt can match voice and avoid repetition.
--   6. set_newsletter_harvest_coverage(issue, coverage) — service_role; the
--      harvest persists per-source coverage.
--   7. get_newsletter_recent_published_admin(limit) — admin read of recent
--      published issues' included facts (for the brief's repetition warnings).
--
-- The editorial brief (ranked highlights, why, evidence, repetition warnings,
-- photo gaps, readiness) is assembled in the pure JS module
-- src/lib/newsletterBrief.js from data these RPCs return — it is derived from
-- admin-only data the admin already fetches, so it stays out of SQL and is
-- unit-tested in vitest.
--
-- NO BEGIN/COMMIT (TEST applies via exec_sql; PROD applies with psql
-- --single-transaction). pgcrypto stays schema-qualified (extensions.*).
-- Apply order: TEST first, PROD after lane approval.
-- Depends on: mig 144 (tables + _newsletter_assert_admin + _newsletter_issue_summary),
-- mig 146 (get_newsletter_generation_input).
-- ============================================================================

CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions;

-- ── 1. newsletter_settings: real-control columns ────────────────────────────
-- tone_preset is the selector state; `tone` (mig 144) stays the resolved
-- instruction string the prompt uses (a preset writes a canonical tone, and a
-- custom tone overrides). length_detail scales draft depth. photo_min/target and
-- past_issue_context_count drive the brief + prompt context.
ALTER TABLE public.newsletter_settings
  ADD COLUMN IF NOT EXISTS tone_preset text NOT NULL DEFAULT 'warm_credible';
ALTER TABLE public.newsletter_settings
  ADD COLUMN IF NOT EXISTS length_detail text NOT NULL DEFAULT 'standard'
    CONSTRAINT newsletter_settings_length_detail_chk
    CHECK (length_detail IN ('brief', 'standard', 'detailed'));
ALTER TABLE public.newsletter_settings
  ADD COLUMN IF NOT EXISTS photo_min int NOT NULL DEFAULT 3
    CONSTRAINT newsletter_settings_photo_min_chk CHECK (photo_min BETWEEN 0 AND 12);
ALTER TABLE public.newsletter_settings
  ADD COLUMN IF NOT EXISTS photo_target int NOT NULL DEFAULT 6
    CONSTRAINT newsletter_settings_photo_target_chk CHECK (photo_target BETWEEN 0 AND 12);
ALTER TABLE public.newsletter_settings
  ADD COLUMN IF NOT EXISTS past_issue_context_count int NOT NULL DEFAULT 3
    CONSTRAINT newsletter_settings_past_ctx_chk CHECK (past_issue_context_count BETWEEN 0 AND 12);

-- ── 2. newsletter_issues.source_coverage ────────────────────────────────────
-- Array of {key, label, status, count, detail}. status ∈
-- scanned|empty|unavailable|error. The harvest writes it (set_newsletter_
-- harvest_coverage); the admin brief reads it. Default '[]' so existing issues
-- and a not-yet-run issue render an honest "not scanned yet" coverage.
ALTER TABLE public.newsletter_issues
  ADD COLUMN IF NOT EXISTS source_coverage jsonb NOT NULL DEFAULT '[]'::jsonb;

-- Photo plan (shot-list). The draft generation proposes shots FROM the issue's
-- content; the admin fulfills each slot with an approved photo, which then drops
-- into the planned spot in the draft. Array of {id, idea, section, photoId|null}.
-- No new block type: an unfulfilled slot lives only here; only a fulfilled slot
-- becomes a (whitelisted) photo block, so the public renderer is untouched.
ALTER TABLE public.newsletter_issues
  ADD COLUMN IF NOT EXISTS photo_plan jsonb NOT NULL DEFAULT '[]'::jsonb;

-- ── 3. Settings read/update (extended) ──────────────────────────────────────

CREATE OR REPLACE FUNCTION public.get_newsletter_settings()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v jsonb;
BEGIN
  PERFORM public._newsletter_assert_admin();
  SELECT jsonb_build_object(
    'aiProvider', s.ai_provider,
    'aiModel', s.ai_model,
    'tone', s.tone,
    'tonePreset', s.tone_preset,
    'lengthDetail', s.length_detail,
    'photoMin', s.photo_min,
    'photoTarget', s.photo_target,
    'pastIssueContextCount', s.past_issue_context_count,
    'taskAssigneeProfileId', s.task_assignee_profile_id,
    'draftGenDay', s.draft_gen_day,
    'publishTargetDay', s.publish_target_day,
    'updatedAt', s.updated_at
  ) INTO v FROM public.newsletter_settings s WHERE s.id = 'singleton';
  RETURN COALESCE(v, '{}'::jsonb);
END
$fn$;

REVOKE ALL ON FUNCTION public.get_newsletter_settings() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_newsletter_settings() TO authenticated;

-- Drop the mig 144 six-arg signature so PostgREST never has to choose between
-- overloads (the client now always passes the full control set).
DROP FUNCTION IF EXISTS public.update_newsletter_settings(text, text, text, uuid, int, int);

CREATE OR REPLACE FUNCTION public.update_newsletter_settings(
  p_ai_provider             text DEFAULT NULL,
  p_ai_model                text DEFAULT NULL,
  p_tone                    text DEFAULT NULL,
  p_tone_preset             text DEFAULT NULL,
  p_length_detail           text DEFAULT NULL,
  p_photo_min               int  DEFAULT NULL,
  p_photo_target            int  DEFAULT NULL,
  p_past_issue_context_count int DEFAULT NULL,
  p_task_assignee           uuid DEFAULT NULL,
  p_draft_gen_day           int  DEFAULT NULL,
  p_publish_target_day      int  DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
BEGIN
  PERFORM public._newsletter_assert_admin();

  IF p_length_detail IS NOT NULL AND p_length_detail NOT IN ('brief', 'standard', 'detailed') THEN
    RAISE EXCEPTION 'NEWSLETTER_VALIDATION: length_detail must be brief, standard, or detailed';
  END IF;

  UPDATE public.newsletter_settings
     SET ai_provider              = COALESCE(NULLIF(btrim(p_ai_provider), ''), ai_provider),
         ai_model                 = COALESCE(NULLIF(btrim(p_ai_model), ''), ai_model),
         tone                     = COALESCE(NULLIF(btrim(p_tone), ''), tone),
         tone_preset              = COALESCE(NULLIF(btrim(p_tone_preset), ''), tone_preset),
         length_detail            = COALESCE(NULLIF(btrim(p_length_detail), ''), length_detail),
         -- Clamp photo_min/target into [0,12]; keep target >= min so the brief's
         -- "need more photos" math never goes negative.
         photo_min                = LEAST(GREATEST(COALESCE(p_photo_min, photo_min), 0), 12),
         photo_target             = LEAST(GREATEST(COALESCE(p_photo_target, photo_target), 0), 12),
         past_issue_context_count = LEAST(GREATEST(COALESCE(p_past_issue_context_count, past_issue_context_count), 0), 12),
         task_assignee_profile_id = COALESCE(p_task_assignee, task_assignee_profile_id),
         draft_gen_day            = COALESCE(p_draft_gen_day, draft_gen_day),
         publish_target_day       = COALESCE(p_publish_target_day, publish_target_day),
         updated_by               = auth.uid(),
         updated_at               = now()
   WHERE id = 'singleton';

  -- Keep target >= min after both are clamped (a low target below min would make
  -- the readiness "photoCountOk" and "needMore" disagree).
  UPDATE public.newsletter_settings
     SET photo_target = GREATEST(photo_target, photo_min)
   WHERE id = 'singleton';

  RETURN public.get_newsletter_settings();
END
$fn$;

REVOKE ALL ON FUNCTION public.update_newsletter_settings(text, text, text, text, text, int, int, int, uuid, int, int)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.update_newsletter_settings(text, text, text, text, text, int, int, int, uuid, int, int)
  TO authenticated;

-- ── 4. _newsletter_issue_summary: surface sourceCoverage ────────────────────
-- Re-defines the mig 144 helper to append sourceCoverage. All other fields are
-- unchanged, so every admin issue read (get_newsletter_issue_admin and the
-- write RPCs that return the summary) now carries coverage with no extra call.
CREATE OR REPLACE FUNCTION public._newsletter_issue_summary(p_id text)
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
    'id', i.id,
    'yearMonth', i.year_month,
    'slug', i.slug,
    'title', i.title,
    'status', i.status,
    'periodStart', i.period_start,
    'periodEnd', i.period_end,
    'noindex', i.noindex,
    'previewToken', i.preview_token,
    'previewEnabled', i.preview_enabled,
    'previewExpiresAt', i.preview_expires_at,
    'draftPayload', i.draft_payload,
    'publishedPayload', i.published_payload,
    'intakeAnswers', i.intake_answers,
    'sourceCoverage', i.source_coverage,
    'photoPlan', i.photo_plan,
    'generatedAt', i.generated_at,
    'publishedAt', i.published_at,
    'updatedAfterPublishAt', i.updated_after_publish_at,
    'createdAt', i.created_at,
    'updatedAt', i.updated_at,
    'facts', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id', f.id,
        'detectorKey', f.detector_key,
        'program', f.program,
        'title', f.title,
        'summary', f.summary,
        'metricValue', f.metric_value,
        'displayValue', f.display_value,
        'sourceRefs', f.source_refs,
        'comparison', f.comparison,
        'confidence', f.confidence,
        'included', f.included,
        'isManual', f.is_manual,
        'evidence', f.evidence_payload,
        'sortOrder', f.sort_order
      ) ORDER BY f.sort_order, f.created_at)
      FROM public.newsletter_fact_candidates f
      WHERE f.issue_id = i.id
    ), '[]'::jsonb),
    'photos', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id', p.id,
        'storagePath', p.storage_path,
        'sourcePrivatePath', p.source_private_path,
        'caption', p.caption,
        'altText', p.alt_text,
        'creditFirstName', p.credit_first_name,
        'isCover', p.is_cover,
        'sortOrder', p.sort_order,
        'approved', p.approved
      ) ORDER BY p.sort_order, p.uploaded_at)
      FROM public.newsletter_photos p
      WHERE p.issue_id = i.id
    ), '[]'::jsonb)
  )
  INTO v
  FROM public.newsletter_issues i
  WHERE i.id = p_id;

  RETURN v;
END
$fn$;

REVOKE ALL ON FUNCTION public._newsletter_issue_summary(text)
  FROM PUBLIC, anon, authenticated;

-- ── 5. get_newsletter_generation_input: + past-issue context + new settings ──
-- The Edge Function builds its AI prompt from this. Past published issues let
-- the model match White Creek Farm's voice and avoid repeating last month's
-- accomplishments. Recency-limited by settings.past_issue_context_count.
CREATE OR REPLACE FUNCTION public.get_newsletter_generation_input(p_issue_id text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
STABLE
AS $fn$
DECLARE
  v          jsonb;
  v_past_n   int;
  v_past     jsonb;
BEGIN
  SELECT past_issue_context_count INTO v_past_n
    FROM public.newsletter_settings WHERE id = 'singleton';
  v_past_n := COALESCE(v_past_n, 3);

  -- Recent published issues (excluding this one): title, included-fact titles,
  -- and the heading/paragraph/callout body text, so the prompt can match voice
  -- and dodge repetition. Body text is read from the published structured blocks
  -- (never raw HTML).
  -- camelCase keys to match the rest of the newsletter API (the Edge Function
  -- prompt builder reads factTitles / bodyText / yearMonth).
  SELECT COALESCE(jsonb_agg(
           jsonb_build_object(
             'yearMonth', ni.year_month,
             'title', ni.title,
             'publishedAt', ni.published_at,
             'factTitles', COALESCE((
               SELECT jsonb_agg(DISTINCT f.title)
               FROM public.newsletter_fact_candidates f
               WHERE f.issue_id = ni.id AND f.included
             ), '[]'::jsonb),
             'bodyText', COALESCE((
               SELECT string_agg(b->>'text', ' ')
               FROM jsonb_array_elements(COALESCE(ni.published_payload->'blocks', '[]'::jsonb)) b
               WHERE b->>'type' IN ('heading', 'paragraph', 'callout') AND COALESCE(b->>'text', '') <> ''
             ), '')
           ) ORDER BY ni.published_at DESC
         ), '[]'::jsonb)
    INTO v_past
  FROM (
    SELECT id, year_month, title, published_at, published_payload
    FROM public.newsletter_issues
    WHERE status = 'published' AND id <> p_issue_id
    ORDER BY published_at DESC
    LIMIT v_past_n
  ) ni;

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
      'tonePreset', s.tone_preset,
      'lengthDetail', s.length_detail,
      'aiProvider', s.ai_provider,
      'aiModel', s.ai_model
    ),
    'pastIssues', v_past,
    -- The current draft + existing plan let the Edge Function revise in place
    -- (apply revision notes to the current blocks) and merge a refreshed photo
    -- plan without dropping slots the admin already fulfilled.
    'currentDraft', i.draft_payload,
    'photoPlan', i.photo_plan,
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

-- ── 6. set_newsletter_harvest_coverage (service_role) ───────────────────────
-- The harvest persists one coverage entry per source it tried to scan. Mirrors
-- the mig 146 service-context pattern: no auth.uid() gate; the service_role
-- grant IS the boundary.
CREATE OR REPLACE FUNCTION public.set_newsletter_harvest_coverage(
  p_issue_id text,
  p_coverage jsonb
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
BEGIN
  IF p_coverage IS NULL OR jsonb_typeof(p_coverage) <> 'array' THEN
    RAISE EXCEPTION 'NEWSLETTER_VALIDATION: coverage must be a JSON array';
  END IF;

  UPDATE public.newsletter_issues
     SET source_coverage = p_coverage,
         updated_at      = now()
   WHERE id = p_issue_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'NEWSLETTER_VALIDATION: issue not found';
  END IF;
END
$fn$;

REVOKE ALL ON FUNCTION public.set_newsletter_harvest_coverage(text, jsonb)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.set_newsletter_harvest_coverage(text, jsonb) TO service_role;

-- ── 7. get_newsletter_recent_published_admin (admin read) ───────────────────
-- Recent published issues with their included facts — the brief uses this to
-- warn when this month repeats a recent accomplishment (same detector key) and
-- whether the number is identical (truly repetitive) or has moved.
CREATE OR REPLACE FUNCTION public.get_newsletter_recent_published_admin(
  p_limit       int DEFAULT 3,
  p_exclude_id  text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v jsonb;
  v_lim int;
BEGIN
  PERFORM public._newsletter_assert_admin();
  v_lim := LEAST(GREATEST(COALESCE(p_limit, 3), 0), 12);

  SELECT COALESCE(jsonb_agg(row ORDER BY row.published_at DESC), '[]'::jsonb)
    INTO v
  FROM (
    SELECT
      ni.year_month   AS year_month,
      ni.title        AS title,
      ni.published_at AS published_at,
      COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
          'detectorKey', f.detector_key,
          'title', f.title,
          'displayValue', f.display_value,
          'program', f.program
        ) ORDER BY f.sort_order)
        FROM public.newsletter_fact_candidates f
        WHERE f.issue_id = ni.id AND f.included
      ), '[]'::jsonb) AS facts
    FROM public.newsletter_issues ni
    WHERE ni.status = 'published'
      AND (p_exclude_id IS NULL OR ni.id <> p_exclude_id)
    ORDER BY ni.published_at DESC
    LIMIT v_lim
  ) row;

  RETURN v;
END
$fn$;

REVOKE ALL ON FUNCTION public.get_newsletter_recent_published_admin(int, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_newsletter_recent_published_admin(int, text) TO authenticated;

-- ── 8. set_newsletter_photo_plan (service_role) ─────────────────────────────
-- The draft generation writes the proposed shot-list here. The merge that keeps
-- already-fulfilled slots is done in the Edge Function (JS, unit-tested) before
-- calling this, so this just persists the final array.
CREATE OR REPLACE FUNCTION public.set_newsletter_photo_plan(p_issue_id text, p_plan jsonb)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
BEGIN
  IF p_plan IS NULL OR jsonb_typeof(p_plan) <> 'array' THEN
    RAISE EXCEPTION 'NEWSLETTER_VALIDATION: photo plan must be a JSON array';
  END IF;
  UPDATE public.newsletter_issues
     SET photo_plan = p_plan,
         updated_at  = now()
   WHERE id = p_issue_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'NEWSLETTER_VALIDATION: issue not found';
  END IF;
END
$fn$;

REVOKE ALL ON FUNCTION public.set_newsletter_photo_plan(text, jsonb)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.set_newsletter_photo_plan(text, jsonb) TO service_role;

-- ── 9. set_newsletter_photo_plan_slot (admin) ───────────────────────────────
-- Fulfill (or clear) one shot-list slot with an approved photo. p_photo_id NULL
-- clears the slot. The photo must belong to this issue.
CREATE OR REPLACE FUNCTION public.set_newsletter_photo_plan_slot(
  p_issue_id text,
  p_slot_id  text,
  p_photo_id text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_new jsonb;
BEGIN
  PERFORM public._newsletter_assert_admin();

  IF NOT EXISTS (SELECT 1 FROM public.newsletter_issues WHERE id = p_issue_id) THEN
    RAISE EXCEPTION 'NEWSLETTER_VALIDATION: issue not found';
  END IF;
  IF p_photo_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.newsletter_photos WHERE id = p_photo_id AND issue_id = p_issue_id
  ) THEN
    RAISE EXCEPTION 'NEWSLETTER_VALIDATION: photo not found for issue';
  END IF;

  SELECT COALESCE(jsonb_agg(
           CASE WHEN elem->>'id' = p_slot_id
             THEN jsonb_set(elem, '{photoId}',
                    CASE WHEN p_photo_id IS NULL THEN 'null'::jsonb ELSE to_jsonb(p_photo_id) END, true)
             ELSE elem END
         ), '[]'::jsonb)
    INTO v_new
  FROM jsonb_array_elements(
         (SELECT photo_plan FROM public.newsletter_issues WHERE id = p_issue_id)
       ) elem;

  UPDATE public.newsletter_issues
     SET photo_plan = v_new,
         updated_at  = now()
   WHERE id = p_issue_id;

  RETURN public._newsletter_issue_summary(p_issue_id);
END
$fn$;

REVOKE ALL ON FUNCTION public.set_newsletter_photo_plan_slot(text, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_newsletter_photo_plan_slot(text, text, text) TO authenticated;

NOTIFY pgrst, 'reload schema';
