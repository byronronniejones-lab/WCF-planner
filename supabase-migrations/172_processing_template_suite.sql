-- ============================================================================
-- 172_processing_template_suite.sql
-- ----------------------------------------------------------------------------
-- Template Suite Completion: seed ONE ACTIVE default template per program
-- (broiler / cattle / pig / sheep) so the record drawer is template-driven, and
-- teach set_processing_field the two new control types (checkbox, url).
--
-- Seeding rules (Codex-gated contract):
--   * A program is seeded ONLY when it has NO template row at all (active or
--     not). Any existing row means an administrator has been here -- NEVER
--     overwrite, deactivate, or version-bump their work.
--   * Idempotent on reapply: the NOT EXISTS guard makes a re-run a no-op.
--   * Deterministic ids ('ptpl-default-<program>') + version 1 support fresh
--     environments and the current empty-PROD state identically.
--   * The embedded field/checklist JSON is the CANONICAL suite from
--     src/lib/processingFields.js defaultProcessingTemplateSuite(); the static
--     guard processing_template_suite_static.test.js asserts equality so the
--     SQL seed and the client Reset-to-default can never drift.
--
-- Field model recap (ownership unchanged): planner-owned facts + formulas are
-- bound/read-only ids; Processor is a TRUE SELECT sourced at runtime from
-- processing_asana_sync_settings.processor_options (optionsSource marker -- no
-- baked options); Customer keeps its handoff-approved colored options while the
-- runtime picker unions the mig-162 settings list with stored legacy values.
--
-- set_processing_field REISSUE: identical contract plus 'checkbox' (boolean)
-- and 'url' (http/https string, <=2000 chars) validation branches.
--
-- created_by: templates require a real profile; the seed reuses the importer
-- actor helper (first admin) -- service/psql applies have no auth.uid().
-- Error class: PROCESSING_VALIDATION:. NO BEGIN/COMMIT (TEST via exec_sql;
-- PROD via psql --single-transaction). Depends on: 156 (templates table),
-- 162 (option lists), 164 (field engine + _processing_import_actor reuse).
-- ============================================================================

-- == Seed: Broiler ==
INSERT INTO public.processing_templates (id, program, version, fields, checklist, is_active, created_by)
SELECT 'ptpl-default-broiler', 'broiler', 1,
       '[{"id":"procActual","name":"Actual Processing Date (SF)","type":"date"},{"id":"status","name":"Status (Processing)","type":"single","options":[{"key":"planned","label":"Planned","color":{"bg":"#E8B73E","ink":"#5A4304"}},{"key":"reserved","label":"Reserved","color":{"bg":"#93C896","ink":"#285F33"}},{"key":"in_proccess","label":"In-Proccess","color":{"bg":"#E4924A","ink":"#6F3711"}},{"key":"completed","label":"Completed","color":{"bg":"#E07A6E","ink":"#6E1C15"}},{"key":"tbc","label":"TBC","color":{"bg":"#E59CC0","ink":"#6F2A50"}},{"key":"goal","label":"Goal","color":{"bg":"#6AA6DD","ink":"#173B5E"}}]},{"id":"program","name":"Farm Programs","type":"single","options":[{"key":"broiler","label":"Broiler","color":{"bg":"#E8B73E","ink":"#5A4304"}},{"key":"cattle","label":"Cattle","color":{"bg":"#F0B3A8","ink":"#9F3322"}},{"key":"pig","label":"Pigs","color":{"bg":"#6AA6DD","ink":"#173B5E"}},{"key":"sheep","label":"Lambs","color":{"bg":"#93C896","ink":"#285F33"}}]},{"id":"batchName","name":"Batch Name (Farms)","type":"text"},{"id":"farm","name":"Farm","type":"single","options":[{"key":"wcf","label":"WCF","color":{"bg":"#DDF1EE","ink":"#2E7A73"}}]},{"id":"animals","name":"Animals Processed","type":"number"},{"id":"condemned","name":"Condemed","type":"number"},{"id":"farmArrival","name":"Farm Arrival Date","type":"date"},{"id":"year","name":"Year","type":"single","options":[{"key":"y2026","label":"2026","color":{"bg":"#EDEFF1","ink":"#5B626C"}},{"key":"y2027","label":"2027","color":{"bg":"#EDEFF1","ink":"#5B626C"}}]},{"id":"animalMaster","name":"Status (Animal Master)","type":"single","options":[{"key":"scheduled","label":"Scheduled","color":{"bg":"#EDEFF1","ink":"#5B626C"}},{"key":"on_farm","label":"On Farm","color":{"bg":"#E7EDF8","ink":"#3B6CB7"}},{"key":"inventoried","label":"Inventoried","color":{"bg":"#DDF1EE","ink":"#2E7A73"}}]},{"id":"procPlanned","name":"Planned Processing Date (SF)","type":"date"},{"id":"actualTOF","name":"Actual Time On Farm","type":"formula"},{"id":"plannedTOF","name":"Planned Time on Farm","type":"formula"},{"id":"timeRemaining","name":"Time Remaining Until Processing","type":"formula"},{"id":"productPickup","name":"Product Pick-up Date","type":"date"},{"id":"customer","name":"Customer (Broiler)","type":"multi","options":[{"key":"sonnys","label":"Sonny''s","color":{"bg":"#BFE3CB","ink":"#245737"}},{"key":"coastal_confirmed","label":"Coastal Pastures - CONFIRMED","color":{"bg":"#F0B3A8","ink":"#9F3322"}},{"key":"coastal_potential","label":"Coastal Pastures - POTENTIAL","color":{"bg":"#EFC07E","ink":"#875213"}}]},{"id":"processor","name":"Processor","type":"single","optionsSource":"settings.processor_options"}]'::jsonb,
       '[{"label":"Send Weight & Animal Count","assignee":"Ronnie Jones","assignee_profile_id":null},{"label":"Prepare Cut List","assignee":"Brian Naide","assignee_profile_id":null},{"label":"Add to Processing Spreadsheet by Protein","assignee":"Brett Post","assignee_profile_id":null},{"label":"Create Invoice from Farm to Customer","assignee":"Brett Post","assignee_profile_id":null},{"label":"Inventory in Product and add to Asana","assignee":"Brian Naide","assignee_profile_id":null},{"label":"If Applicable - Send photo of new product label","assignee":"Brian Naide","assignee_profile_id":null},{"label":"Add Inventory to Shopify","assignee":"Isabel Hermann","assignee_profile_id":null},{"label":"Reconcile and Analyze Podio","assignee":"Ronnie Jones","assignee_profile_id":null}]'::jsonb,
       true, public._processing_import_actor()
WHERE NOT EXISTS (SELECT 1 FROM public.processing_templates WHERE program = 'broiler');

-- == Seed: Cattle ==
INSERT INTO public.processing_templates (id, program, version, fields, checklist, is_active, created_by)
SELECT 'ptpl-default-cattle', 'cattle', 1,
       '[{"id":"procActual","name":"Actual Processing Date (SF)","type":"date"},{"id":"status","name":"Status (Processing)","type":"single","options":[{"key":"planned","label":"Planned","color":{"bg":"#E8B73E","ink":"#5A4304"}},{"key":"reserved","label":"Reserved","color":{"bg":"#93C896","ink":"#285F33"}},{"key":"in_proccess","label":"In-Proccess","color":{"bg":"#E4924A","ink":"#6F3711"}},{"key":"completed","label":"Completed","color":{"bg":"#E07A6E","ink":"#6E1C15"}},{"key":"tbc","label":"TBC","color":{"bg":"#E59CC0","ink":"#6F2A50"}},{"key":"goal","label":"Goal","color":{"bg":"#6AA6DD","ink":"#173B5E"}}]},{"id":"program","name":"Farm Programs","type":"single","options":[{"key":"broiler","label":"Broiler","color":{"bg":"#E8B73E","ink":"#5A4304"}},{"key":"cattle","label":"Cattle","color":{"bg":"#F0B3A8","ink":"#9F3322"}},{"key":"pig","label":"Pigs","color":{"bg":"#6AA6DD","ink":"#173B5E"}},{"key":"sheep","label":"Lambs","color":{"bg":"#93C896","ink":"#285F33"}}]},{"id":"batchName","name":"Batch Name (Farms)","type":"text"},{"id":"farm","name":"Farm","type":"single","options":[{"key":"wcf","label":"WCF","color":{"bg":"#DDF1EE","ink":"#2E7A73"}}]},{"id":"animals","name":"Animals Processed","type":"number"},{"id":"condemned","name":"Condemed","type":"number"},{"id":"farmArrival","name":"Farm Arrival Date","type":"date"},{"id":"year","name":"Year","type":"single","options":[{"key":"y2026","label":"2026","color":{"bg":"#EDEFF1","ink":"#5B626C"}},{"key":"y2027","label":"2027","color":{"bg":"#EDEFF1","ink":"#5B626C"}}]},{"id":"animalMaster","name":"Status (Animal Master)","type":"single","options":[{"key":"scheduled","label":"Scheduled","color":{"bg":"#EDEFF1","ink":"#5B626C"}},{"key":"on_farm","label":"On Farm","color":{"bg":"#E7EDF8","ink":"#3B6CB7"}},{"key":"inventoried","label":"Inventoried","color":{"bg":"#DDF1EE","ink":"#2E7A73"}}]},{"id":"procPlanned","name":"Planned Processing Date (SF)","type":"date"},{"id":"actualTOF","name":"Actual Time On Farm","type":"formula"},{"id":"plannedTOF","name":"Planned Time on Farm","type":"formula"},{"id":"timeRemaining","name":"Time Remaining Until Processing","type":"formula"},{"id":"productPickup","name":"Product Pick-up Date","type":"date"},{"id":"processor","name":"Processor","type":"single","optionsSource":"settings.processor_options"}]'::jsonb,
       '[{"label":"Send Weight & Animal Count","assignee":"Ronnie Jones","assignee_profile_id":null},{"label":"Prepare Cut List","assignee":"Ronnie Jones","assignee_profile_id":null},{"label":"Create and Post Inventory Intake Sheet","assignee":"Brett Post","assignee_profile_id":null},{"label":"Determine Wholesale Price / Animal","assignee":"Brett Post","assignee_profile_id":null},{"label":"Add to Processing Spreadsheet by Protein","assignee":"Brett Post","assignee_profile_id":null},{"label":"Create Invoice from Farm to Customer","assignee":"Brett Post","assignee_profile_id":null},{"label":"Obtain Product List from Processor & Send to Debbie","assignee":"Isabel Hermann","assignee_profile_id":null},{"label":"Inventory in Product & Send to Debbie","assignee":"Isabel Hermann","assignee_profile_id":null},{"label":"If Applicable - Send photo of new product label to Debbie","assignee":"Isabel Hermann","assignee_profile_id":null},{"label":"Add Inventory to Shopify","assignee":"Jessica Torres","assignee_profile_id":null},{"label":"Reconcile and Analyze Podio","assignee":"Ronnie Jones","assignee_profile_id":null},{"label":"Prepare Cutlist for Processor","assignee":"Ronnie Jones","assignee_profile_id":null},{"label":"Approve Cutlist","assignee":"Isabel Hermann","assignee_profile_id":null},{"label":"Inventory in Product through Asana Inventory Form","assignee":"Jessica Torres","assignee_profile_id":null},{"label":"Schedule/Notify payment of Kill & Processing","assignee":"Ronnie Jones","assignee_profile_id":null},{"label":"Update Status to Inventoried","assignee":"Jessica Torres","assignee_profile_id":null}]'::jsonb,
       true, public._processing_import_actor()
WHERE NOT EXISTS (SELECT 1 FROM public.processing_templates WHERE program = 'cattle');

-- == Seed: Pig ==
INSERT INTO public.processing_templates (id, program, version, fields, checklist, is_active, created_by)
SELECT 'ptpl-default-pig', 'pig', 1,
       '[{"id":"procActual","name":"Actual Processing Date (SF)","type":"date"},{"id":"status","name":"Status (Processing)","type":"single","options":[{"key":"planned","label":"Planned","color":{"bg":"#E8B73E","ink":"#5A4304"}},{"key":"reserved","label":"Reserved","color":{"bg":"#93C896","ink":"#285F33"}},{"key":"in_proccess","label":"In-Proccess","color":{"bg":"#E4924A","ink":"#6F3711"}},{"key":"completed","label":"Completed","color":{"bg":"#E07A6E","ink":"#6E1C15"}},{"key":"tbc","label":"TBC","color":{"bg":"#E59CC0","ink":"#6F2A50"}},{"key":"goal","label":"Goal","color":{"bg":"#6AA6DD","ink":"#173B5E"}}]},{"id":"program","name":"Farm Programs","type":"single","options":[{"key":"broiler","label":"Broiler","color":{"bg":"#E8B73E","ink":"#5A4304"}},{"key":"cattle","label":"Cattle","color":{"bg":"#F0B3A8","ink":"#9F3322"}},{"key":"pig","label":"Pigs","color":{"bg":"#6AA6DD","ink":"#173B5E"}},{"key":"sheep","label":"Lambs","color":{"bg":"#93C896","ink":"#285F33"}}]},{"id":"batchName","name":"Batch Name (Farms)","type":"text"},{"id":"farm","name":"Farm","type":"single","options":[{"key":"wcf","label":"WCF","color":{"bg":"#DDF1EE","ink":"#2E7A73"}}]},{"id":"animals","name":"Animals Processed","type":"number"},{"id":"condemned","name":"Condemed","type":"number"},{"id":"farmArrival","name":"Farm Arrival Date","type":"date"},{"id":"year","name":"Year","type":"single","options":[{"key":"y2026","label":"2026","color":{"bg":"#EDEFF1","ink":"#5B626C"}},{"key":"y2027","label":"2027","color":{"bg":"#EDEFF1","ink":"#5B626C"}}]},{"id":"animalMaster","name":"Status (Animal Master)","type":"single","options":[{"key":"scheduled","label":"Scheduled","color":{"bg":"#EDEFF1","ink":"#5B626C"}},{"key":"on_farm","label":"On Farm","color":{"bg":"#E7EDF8","ink":"#3B6CB7"}},{"key":"inventoried","label":"Inventoried","color":{"bg":"#DDF1EE","ink":"#2E7A73"}}]},{"id":"procPlanned","name":"Planned Processing Date (SF)","type":"date"},{"id":"actualTOF","name":"Actual Time On Farm","type":"formula"},{"id":"plannedTOF","name":"Planned Time on Farm","type":"formula"},{"id":"timeRemaining","name":"Time Remaining Until Processing","type":"formula"},{"id":"productPickup","name":"Product Pick-up Date","type":"date"},{"id":"processor","name":"Processor","type":"single","optionsSource":"settings.processor_options"}]'::jsonb,
       '[{"label":"Send Weight & Animal Count","assignee":"Ronnie Jones","assignee_profile_id":null},{"label":"Prepare Cut List","assignee":"Ronnie Jones","assignee_profile_id":null},{"label":"Add to Processing Spreadsheet by Protein","assignee":"Brett Post","assignee_profile_id":null},{"label":"Create Invoice from Farm to Customer","assignee":"Brett Post","assignee_profile_id":null},{"label":"Inventory in Product and add to Asana","assignee":"Isabel Hermann","assignee_profile_id":null},{"label":"If Applicable - Send photo of new product label","assignee":"Isabel Hermann","assignee_profile_id":null},{"label":"Add Inventory to Shopify","assignee":"Jessica Torres","assignee_profile_id":null},{"label":"Reconcile and Analyze Podio","assignee":"Ronnie Jones","assignee_profile_id":null},{"label":"Inventory in Product through Asana Inventory Form","assignee":"Jessica Torres","assignee_profile_id":null},{"label":"If Applicable - Send photo of new product label to Debbie","assignee":"Isabel Hermann","assignee_profile_id":null},{"label":"Update Status to Inventoried","assignee":"Jessica Torres","assignee_profile_id":null}]'::jsonb,
       true, public._processing_import_actor()
WHERE NOT EXISTS (SELECT 1 FROM public.processing_templates WHERE program = 'pig');

-- == Seed: Sheep ==
INSERT INTO public.processing_templates (id, program, version, fields, checklist, is_active, created_by)
SELECT 'ptpl-default-sheep', 'sheep', 1,
       '[{"id":"procActual","name":"Actual Processing Date (SF)","type":"date"},{"id":"status","name":"Status (Processing)","type":"single","options":[{"key":"planned","label":"Planned","color":{"bg":"#E8B73E","ink":"#5A4304"}},{"key":"reserved","label":"Reserved","color":{"bg":"#93C896","ink":"#285F33"}},{"key":"in_proccess","label":"In-Proccess","color":{"bg":"#E4924A","ink":"#6F3711"}},{"key":"completed","label":"Completed","color":{"bg":"#E07A6E","ink":"#6E1C15"}},{"key":"tbc","label":"TBC","color":{"bg":"#E59CC0","ink":"#6F2A50"}},{"key":"goal","label":"Goal","color":{"bg":"#6AA6DD","ink":"#173B5E"}}]},{"id":"program","name":"Farm Programs","type":"single","options":[{"key":"broiler","label":"Broiler","color":{"bg":"#E8B73E","ink":"#5A4304"}},{"key":"cattle","label":"Cattle","color":{"bg":"#F0B3A8","ink":"#9F3322"}},{"key":"pig","label":"Pigs","color":{"bg":"#6AA6DD","ink":"#173B5E"}},{"key":"sheep","label":"Lambs","color":{"bg":"#93C896","ink":"#285F33"}}]},{"id":"batchName","name":"Batch Name (Farms)","type":"text"},{"id":"farm","name":"Farm","type":"single","options":[{"key":"wcf","label":"WCF","color":{"bg":"#DDF1EE","ink":"#2E7A73"}}]},{"id":"animals","name":"Animals Processed","type":"number"},{"id":"condemned","name":"Condemed","type":"number"},{"id":"farmArrival","name":"Farm Arrival Date","type":"date"},{"id":"year","name":"Year","type":"single","options":[{"key":"y2026","label":"2026","color":{"bg":"#EDEFF1","ink":"#5B626C"}},{"key":"y2027","label":"2027","color":{"bg":"#EDEFF1","ink":"#5B626C"}}]},{"id":"animalMaster","name":"Status (Animal Master)","type":"single","options":[{"key":"scheduled","label":"Scheduled","color":{"bg":"#EDEFF1","ink":"#5B626C"}},{"key":"on_farm","label":"On Farm","color":{"bg":"#E7EDF8","ink":"#3B6CB7"}},{"key":"inventoried","label":"Inventoried","color":{"bg":"#DDF1EE","ink":"#2E7A73"}}]},{"id":"procPlanned","name":"Planned Processing Date (SF)","type":"date"},{"id":"actualTOF","name":"Actual Time On Farm","type":"formula"},{"id":"plannedTOF","name":"Planned Time on Farm","type":"formula"},{"id":"timeRemaining","name":"Time Remaining Until Processing","type":"formula"},{"id":"productPickup","name":"Product Pick-up Date","type":"date"},{"id":"processor","name":"Processor","type":"single","optionsSource":"settings.processor_options"}]'::jsonb,
       '[{"label":"Send Weight & Animal Count","assignee":"Ronnie Jones","assignee_profile_id":null},{"label":"Prepare Cut List","assignee":"Ronnie Jones","assignee_profile_id":null},{"label":"Add to Processing Spreadsheet by Protein","assignee":"Brett Post","assignee_profile_id":null},{"label":"Create Invoice from Farm to Customer","assignee":"Brett Post","assignee_profile_id":null},{"label":"Inventory in Product and add to Asana","assignee":"Isabel Hermann","assignee_profile_id":null},{"label":"If Applicable - Send photo of new product label","assignee":"Isabel Hermann","assignee_profile_id":null},{"label":"Add Inventory to Shopify","assignee":"Jessica Torres","assignee_profile_id":null},{"label":"Reconcile and Analyze Podio","assignee":"Ronnie Jones","assignee_profile_id":null},{"label":"Update Final Animal Count & Weight","assignee":"Ronnie Jones","assignee_profile_id":null},{"label":"Schedule/Notify payment of Kill & Processing with Jennifer","assignee":"Ronnie Jones","assignee_profile_id":null},{"label":"Obtain Product List from Processor & Save to Egnyte","assignee":"Isabel Hermann","assignee_profile_id":null},{"label":"Inventory in Product through Asana Inventory Form","assignee":"Jessica Torres","assignee_profile_id":null},{"label":"If Applicable - Send photo of new product label to Debbie","assignee":"Isabel Hermann","assignee_profile_id":null},{"label":"Approve Cutlist","assignee":"Isabel Hermann","assignee_profile_id":null},{"label":"Prepare Cutlist for Processor","assignee":"Ronnie Jones","assignee_profile_id":null},{"label":"Update Status to Inventoried","assignee":"Jessica Torres","assignee_profile_id":null}]'::jsonb,
       true, public._processing_import_actor()
WHERE NOT EXISTS (SELECT 1 FROM public.processing_templates WHERE program = 'sheep');

-- == set_processing_field: + checkbox / url control types ==
CREATE OR REPLACE FUNCTION public.set_processing_field(
  p_id       text,
  p_field_id text,
  p_value    jsonb
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $fn$
DECLARE
  v_rec    public.processing_records;
  v_tpl    public.processing_templates;
  v_def    jsonb;
  v_type   text;
  v_name   text;
  v_next   jsonb;
  v_elem   jsonb;
BEGIN
  PERFORM public._processing_require_operational();
  SELECT * INTO v_rec FROM public.processing_records WHERE id = p_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'PROCESSING_VALIDATION: record not found'; END IF;
  IF v_rec.record_type = 'milestone' THEN
    RAISE EXCEPTION 'PROCESSING_VALIDATION: milestones do not take template fields';
  END IF;
  IF p_field_id IS NULL OR p_field_id !~ '^[A-Za-z0-9_-]{1,60}$' THEN
    RAISE EXCEPTION 'PROCESSING_VALIDATION: invalid field id';
  END IF;
  IF p_field_id = ANY (public._processing_reserved_field_ids()) THEN
    RAISE EXCEPTION 'PROCESSING_VALIDATION: field % is source-owned or derived and cannot be edited here', p_field_id;
  END IF;

  SELECT * INTO v_tpl FROM public.processing_templates
   WHERE program = v_rec.program AND is_active = true;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'PROCESSING_VALIDATION: no active template for program %', v_rec.program;
  END IF;
  SELECT f INTO v_def
    FROM jsonb_array_elements(COALESCE(v_tpl.fields, '[]'::jsonb)) AS f
   WHERE f->>'id' = p_field_id
   LIMIT 1;
  IF v_def IS NULL THEN
    RAISE EXCEPTION 'PROCESSING_VALIDATION: field % is not on the active % template', p_field_id, v_rec.program;
  END IF;
  v_type := COALESCE(v_def->>'type', 'text');
  v_name := COALESCE(v_def->>'name', p_field_id);
  IF v_type = 'formula' THEN
    RAISE EXCEPTION 'PROCESSING_VALIDATION: formula fields are derived and read-only';
  END IF;

  IF p_value IS NOT NULL AND jsonb_typeof(p_value) <> 'null' THEN
    IF length(p_value::text) > 4000 THEN
      RAISE EXCEPTION 'PROCESSING_VALIDATION: field value too large';
    END IF;
    IF v_type = 'number' THEN
      IF jsonb_typeof(p_value) <> 'number' THEN
        RAISE EXCEPTION 'PROCESSING_VALIDATION: % expects a number', v_name;
      END IF;
    ELSIF v_type = 'date' THEN
      IF jsonb_typeof(p_value) <> 'string' OR (p_value #>> '{}') !~ '^\d{4}-\d{2}-\d{2}$' THEN
        RAISE EXCEPTION 'PROCESSING_VALIDATION: % expects a YYYY-MM-DD date', v_name;
      END IF;
    ELSIF v_type = 'checkbox' THEN
      IF jsonb_typeof(p_value) <> 'boolean' THEN
        RAISE EXCEPTION 'PROCESSING_VALIDATION: % expects true or false', v_name;
      END IF;
    ELSIF v_type = 'url' THEN
      IF jsonb_typeof(p_value) <> 'string'
         OR (p_value #>> '{}') !~* '^https?://[^[:space:]]+$'
         OR length(p_value #>> '{}') > 2000 THEN
        RAISE EXCEPTION 'PROCESSING_VALIDATION: % expects an http(s) link', v_name;
      END IF;
    ELSIF v_type = 'multi' THEN
      IF jsonb_typeof(p_value) <> 'array' THEN
        RAISE EXCEPTION 'PROCESSING_VALIDATION: % expects a list', v_name;
      END IF;
      FOR v_elem IN SELECT e FROM jsonb_array_elements(p_value) AS e LOOP
        IF jsonb_typeof(v_elem) <> 'string' THEN
          RAISE EXCEPTION 'PROCESSING_VALIDATION: % expects a list of text values', v_name;
        END IF;
      END LOOP;
    ELSIF v_type IN ('text', 'single', 'people') THEN
      IF jsonb_typeof(p_value) <> 'string' THEN
        RAISE EXCEPTION 'PROCESSING_VALIDATION: % expects a text value', v_name;
      END IF;
    ELSE
      RAISE EXCEPTION 'PROCESSING_VALIDATION: unknown field type %', v_type;
    END IF;
  END IF;

  IF p_value IS NULL OR jsonb_typeof(p_value) = 'null' THEN
    v_next := COALESCE(v_rec.fields, '{}'::jsonb) - p_field_id;
  ELSE
    v_next := COALESCE(v_rec.fields, '{}'::jsonb) || jsonb_build_object(p_field_id, p_value);
  END IF;

  UPDATE public.processing_records
     SET fields = v_next, updated_at = now()
   WHERE id = p_id;

  PERFORM public._processing_emit_activity(
    p_id, 'field.updated',
    'Updated field: ' || v_name,
    jsonb_build_object('action', 'set_field', 'field_id', p_field_id, 'field_name', v_name));

  RETURN jsonb_build_object('id', p_id, 'ok', true, 'field_id', p_field_id);
END
$fn$;
REVOKE ALL ON FUNCTION public.set_processing_field(text, text, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_processing_field(text, text, jsonb) TO authenticated;

NOTIFY pgrst, 'reload schema';

-- ============================================================================
-- End of 172_processing_template_suite.sql
-- ============================================================================
