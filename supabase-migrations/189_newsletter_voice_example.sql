-- 189_newsletter_voice_example.sql
-- ============================================================================
-- Newsletter — complete editorial steering: voice reference + tone semantics.
-- ----------------------------------------------------------------------------
-- This lane makes the admin Steer step the single place Ronnie controls voice,
-- tone, and length, and lets the REAL AI prompt use Ronnie's own writing sample
-- as a style reference for the FIRST issue (before any past issue exists to
-- supply voice). Two contracts change here:
--
--   1. A new admin-only newsletter_settings.voice_example text column: Ronnie's
--      writing sample, used by the Edge Function prompt as STYLE reference only.
--      It is exposed ONLY through the existing admin SECURITY DEFINER settings
--      read (get_newsletter_settings) and the service_role-only generation input
--      (get_newsletter_generation_input). It is NEVER in any anon/public/preview/
--      archive/issue payload. Deny-all RLS on the table is unchanged; no anon
--      surface is added. Bounded to 12,000 chars by a column CHECK backstop.
--
--   2. Correct the legacy tone precedence. mig 144 shipped newsletter_settings.
--      tone as NOT NULL with a non-empty legacy default, and the prompt resolver
--      (resolveTone) always prefers a non-empty custom tone over tone_preset.
--      Result: the legacy default silently overrode every preset — the preset
--      selector was effectively dead. Here we make tone an OPTIONAL custom
--      override: drop the NOT NULL + default, normalize ONLY the exact shipped
--      legacy default value to NULL (genuinely customized values are preserved),
--      and change the update RPC so an empty custom tone CLEARS the override
--      (letting tone_preset drive the draft) while NULL input still preserves it.
--
-- No second custom-tone column is added — the existing tone column IS the
-- optional custom override; only its semantics/precedence are corrected.
--
-- Boundary invariants preserved:
--   * newsletter_settings stays deny-all RLS; access only via SECDEF RPCs.
--   * _newsletter_assert_admin() still gates every admin settings RPC.
--   * The anon surface stays EXACTLY three RPCs (list_published_newsletters,
--     get_published_newsletter, get_newsletter_preview) — untouched here.
--   * get_newsletter_generation_input stays service_role-only; voice_example is
--     returned ONLY inside its private settings object.
--   * The update RPC signature is replaced cleanly (old dropped) so PostgREST has
--     no overload ambiguity.
--
-- NO BEGIN/COMMIT (TEST applies via exec_sql, which rejects them; PROD applies
-- with psql --single-transaction which already wraps the file). Apply order:
-- TEST first, PROD after lane approval.
-- Depends on: mig 144 (newsletter_settings + _newsletter_assert_admin),
-- mig 151 (update_newsletter_settings 11-arg + get_newsletter_generation_input),
-- mig 153 (get_newsletter_settings final).
-- ============================================================================

-- ── 1. voice_example column (admin-only writing sample; 12k backstop) ────────
ALTER TABLE public.newsletter_settings
  ADD COLUMN IF NOT EXISTS voice_example text
    CONSTRAINT newsletter_settings_voice_example_len_chk
    CHECK (voice_example IS NULL OR char_length(voice_example) <= 12000);

-- ── 2. Correct legacy tone precedence ───────────────────────────────────────
-- Make tone an optional custom override: drop the default + NOT NULL so an empty
-- override can be stored as NULL and the preset can take over.
ALTER TABLE public.newsletter_settings ALTER COLUMN tone DROP DEFAULT;
ALTER TABLE public.newsletter_settings ALTER COLUMN tone DROP NOT NULL;

-- Normalize ONLY the exact shipped legacy default to NULL. A genuinely
-- customized tone (anything other than this exact string) is preserved.
UPDATE public.newsletter_settings
   SET tone = NULL
 WHERE tone = 'warm-but-credible owner-facing farm update';

-- ── 3. update_newsletter_settings: + voice_example, fixed tone/voice clearing ─
-- Drop the mig 151 eleven-arg signature so PostgREST never has to choose between
-- overloads. The new signature appends p_voice_example.
DROP FUNCTION IF EXISTS public.update_newsletter_settings(text, text, text, text, text, int, int, int, uuid, int, int);

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
  p_publish_target_day      int  DEFAULT NULL,
  p_voice_example           text DEFAULT NULL
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

  -- Friendly length guard (the column CHECK is the hard backstop).
  IF p_voice_example IS NOT NULL AND char_length(btrim(p_voice_example)) > 12000 THEN
    RAISE EXCEPTION 'NEWSLETTER_VALIDATION: writing example is too long (max 12000 characters)';
  END IF;

  UPDATE public.newsletter_settings
     SET ai_provider              = COALESCE(NULLIF(btrim(p_ai_provider), ''), ai_provider),
         ai_model                 = COALESCE(NULLIF(btrim(p_ai_model), ''), ai_model),
         -- tone is now an OPTIONAL custom override:
         --   NULL input  -> preserve current value
         --   ''  input   -> clear the override (preset drives resolveTone)
         --   text input  -> set the custom override
         tone                     = CASE
                                      WHEN p_tone IS NULL THEN tone
                                      WHEN btrim(p_tone) = '' THEN NULL
                                      ELSE btrim(p_tone)
                                    END,
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
         -- voice_example: same NULL=preserve / ''=clear / text=set semantics.
         voice_example            = CASE
                                      WHEN p_voice_example IS NULL THEN voice_example
                                      WHEN btrim(p_voice_example) = '' THEN NULL
                                      ELSE btrim(p_voice_example)
                                    END,
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

REVOKE ALL ON FUNCTION public.update_newsletter_settings(text, text, text, text, text, int, int, int, uuid, int, int, text)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.update_newsletter_settings(text, text, text, text, text, int, int, int, uuid, int, int, text)
  TO authenticated;

-- ── 4. get_newsletter_settings: expose voiceExample (admin-only) ────────────
-- Same 0-arg signature (plain CREATE OR REPLACE). Admin-only read — this is the
-- ONLY place the sample is surfaced to the client (the Steer/Settings textarea).
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
    'archiveAccessToken', s.archive_access_token,
    'archiveAccessExpiresAt', s.archive_access_expires_at,
    'voiceExample', s.voice_example,
    'updatedAt', s.updated_at
  ) INTO v FROM public.newsletter_settings s WHERE s.id = 'singleton';
  RETURN COALESCE(v, '{}'::jsonb);
END
$fn$;

REVOKE ALL ON FUNCTION public.get_newsletter_settings() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_newsletter_settings() TO authenticated;

-- ── 5. get_newsletter_generation_input: thread voiceExample (service_role) ──
-- Same (text) signature (plain CREATE OR REPLACE). voiceExample is returned ONLY
-- inside the private settings object of this service_role-only RPC — never anon.
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
      'aiModel', s.ai_model,
      'voiceExample', s.voice_example
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

NOTIFY pgrst, 'reload schema';
