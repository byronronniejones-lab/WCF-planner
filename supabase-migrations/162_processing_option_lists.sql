-- ============================================================================
-- 162_processing_option_lists.sql
-- Sub-lane 4 of the Processing finish-out: server-backed Customer/Processor
-- option lists.
--
-- Today the Customer chip choices are a hardcoded constant duplicated in
-- ProcessingDrawer.jsx + AddMilestoneModal.jsx, and Processor is free-text with
-- no authored suggestion list. This migration moves both lists into the existing
-- processing_asana_sync_settings singleton so an admin can edit them:
--   • processor_options already exists on the table (156) — previously dead;
--     this wires it up.
--   • customer_options is added here, seeded with the current hardcoded values
--     so nothing changes for users on day one.
--
-- get_processing_settings() already returns the whole row via to_jsonb(s), so
-- both lists surface to operational callers with no RPC change. The lists ONLY
-- drive the editing widgets — there is no CHECK on processing_records.processor
-- or .customer and the setter RPCs do not validate against any allow-list, so
-- legacy/off-list values already persist and keep rendering. Editing an option
-- list never rejects or rewrites stored values.
--
-- Idempotent: ADD COLUMN IF NOT EXISTS + CREATE OR REPLACE. No data migration
-- beyond the column default. TEST-applied via exec_sql; PROD via psql
-- --single-transaction (gated).
-- ============================================================================

-- 1. customer_options on the settings singleton (processor_options already
--    exists from 156). Seed with the values currently hardcoded in the client
--    so behaviour is unchanged until an admin edits them.
ALTER TABLE public.processing_asana_sync_settings
  ADD COLUMN IF NOT EXISTS customer_options jsonb NOT NULL
    DEFAULT '["Sonny''s", "Coastal Pastures - CONFIRMED", "Coastal Pastures - POTENTIAL"]'::jsonb;

-- 2. Admin-only setter: replace one option list wholesale (covers add / edit /
--    remove from the admin UI). Cleans the incoming array — trims each entry,
--    drops blanks, de-dupes preserving first-seen order. Never touches stored
--    record values, so legacy off-list values are preserved. Modelled on
--    set_asana_sync_enabled (156) for the admin gate.
CREATE OR REPLACE FUNCTION public.set_processing_option_list(p_kind text, p_options jsonb)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $fn$
DECLARE v_role text; v_clean jsonb;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'set_processing_option_list: authenticated caller required';
  END IF;
  v_role := public.profile_role();
  IF v_role IS NULL OR v_role <> 'admin' THEN
    RAISE EXCEPTION 'PROCESSING_VALIDATION: caller role % cannot edit option lists', COALESCE(v_role, 'null');
  END IF;
  IF p_kind NOT IN ('processor', 'customer') THEN
    RAISE EXCEPTION 'PROCESSING_VALIDATION: invalid option kind %', COALESCE(p_kind, 'null');
  END IF;
  IF jsonb_typeof(COALESCE(p_options, '[]'::jsonb)) <> 'array' THEN
    RAISE EXCEPTION 'PROCESSING_VALIDATION: options must be a json array';
  END IF;

  WITH raw AS (
    SELECT btrim(elem) AS val, ord
    FROM jsonb_array_elements_text(COALESCE(p_options, '[]'::jsonb)) WITH ORDINALITY AS t(elem, ord)
  ),
  cleaned AS (
    SELECT val, min(ord) AS first_ord
    FROM raw
    WHERE val <> ''
    GROUP BY val
  )
  SELECT COALESCE(jsonb_agg(to_jsonb(val) ORDER BY first_ord), '[]'::jsonb)
    INTO v_clean
    FROM cleaned;

  IF p_kind = 'processor' THEN
    UPDATE public.processing_asana_sync_settings
       SET processor_options = v_clean, updated_by = auth.uid(), updated_at = now()
     WHERE id = 'singleton';
  ELSE
    UPDATE public.processing_asana_sync_settings
       SET customer_options = v_clean, updated_by = auth.uid(), updated_at = now()
     WHERE id = 'singleton';
  END IF;

  RETURN jsonb_build_object('ok', true, 'kind', p_kind, 'options', v_clean);
END
$fn$;
REVOKE ALL ON FUNCTION public.set_processing_option_list(text, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_processing_option_list(text, jsonb) TO authenticated;

NOTIFY pgrst, 'reload schema';
