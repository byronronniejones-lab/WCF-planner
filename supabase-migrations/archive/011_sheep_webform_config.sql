-- ============================================================================
-- Migration 011: seed sheep-dailys into webform_config.full_config
-- ----------------------------------------------------------------------------
-- The webform_config row keyed 'full_config' holds the public-webform
-- definitions (sections + fields + per-form team members) shared between
-- WebformHub (public) and AdminAddReportModal (admin). Prior to this
-- migration it had entries for broiler / layer / egg / pig / cattle only.
-- This migration appends the sheep-dailys entry — idempotent: the WHERE
-- clause short-circuits if the sheep entry is already present, so reruns
-- after an admin edits the sections via WebformsAdminView are safe.
--
-- Field shape mirrors src/lib/defaults.js DEFAULT_WEBFORMS_CONFIG. After
-- this seed lands, the admin panel (/admin > Webforms > Sheep Daily Report)
-- can enable/disable fields, toggle required, set per-form team members, etc.
--
-- Apply via Supabase SQL Editor.
-- ============================================================================

UPDATE webform_config
SET data = jsonb_set(
  data,
  '{webforms}',
  (data->'webforms') || jsonb_build_array(jsonb_build_object(
    'id',            'sheep-dailys',
    'teamMembers',   '[]'::jsonb,
    'name',          'Sheep Daily Report',
    'description',   'Daily care report for sheep flocks',
    'table',         'sheep_dailys',
    'allowAddGroup', false,
    'sections', jsonb_build_array(
      jsonb_build_object(
        'id','s-info','title','Report Info','system',true,
        'fields', jsonb_build_array(
          jsonb_build_object('id','date',       'label','Date',       'type','date',       'required',true, 'system',true,'enabled',true),
          jsonb_build_object('id','team_member','label','Team Member','type','team_picker','required',true, 'system',true,'enabled',true)
        )
      ),
      jsonb_build_object(
        'id','s-flock','title','Sheep Flock','system',true,
        'fields', jsonb_build_array(
          jsonb_build_object('id','flock','label','Flock (rams/ewes/feeders)','type','flock_picker','required',true,'system',true,'enabled',true)
        )
      ),
      jsonb_build_object(
        'id','s-feed','title','Feed','system',false,
        'fields', jsonb_build_array(
          jsonb_build_object('id','bales_of_hay',  'label','Bales of Hay', 'type','number','required',false,'system',false,'enabled',true),
          jsonb_build_object('id','lbs_of_alfalfa','label','Alfalfa (lbs)','type','number','required',false,'system',false,'enabled',true)
        )
      ),
      jsonb_build_object(
        'id','s-minerals','title','Minerals','system',false,
        'fields', jsonb_build_array(
          jsonb_build_object('id','minerals_given',    'label','Minerals given?',     'type','yes_no','required',false,'system',false,'enabled',true),
          jsonb_build_object('id','minerals_pct_eaten','label','% of Minerals Eaten','type','number','required',false,'system',false,'enabled',true)
        )
      ),
      jsonb_build_object(
        'id','s-checks','title','Daily Checks','system',false,
        'fields', jsonb_build_array(
          jsonb_build_object('id','fence_voltage_kv','label','Fence Voltage (kV)','type','number','required',false,'system',false,'enabled',true),
          jsonb_build_object('id','waterers_working','label','Waterers working?','type','yes_no','required',false,'system',false,'enabled',true)
        )
      ),
      jsonb_build_object(
        'id','s-mortality','title','Mortality','system',false,
        'fields', jsonb_build_array(
          jsonb_build_object('id','mortality_count','label','Mortality count','type','number','required',false,'system',false,'enabled',true)
        )
      ),
      jsonb_build_object(
        'id','s-comments','title','Comments','system',false,
        'fields', jsonb_build_array(
          jsonb_build_object('id','comments','label','Comments / Issues','type','textarea','required',false,'system',false,'enabled',true)
        )
      )
    )
  ))
)
WHERE key = 'full_config'
  AND NOT (data->'webforms' @> '[{"id":"sheep-dailys"}]'::jsonb);
