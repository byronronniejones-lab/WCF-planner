-- Behavioral verification for migration 098 (psql path, used for PROD).
-- RAISEs (aborting with a nonzero exit under ON_ERROR_STOP=1) if either the
-- retired roster webform_config keys survive or equipment.team_members remains.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM public.webform_config
     WHERE key IN ('team_roster','team_members','team_availability',
                   'per_form_team_members','weighins_team_members')
  ) THEN
    RAISE EXCEPTION 'verify 098: roster webform_config keys still present';
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema='public' AND table_name='equipment'
           AND column_name='team_members'
  ) THEN
    RAISE EXCEPTION 'verify 098: equipment.team_members column still exists';
  END IF;

  RAISE NOTICE 'verify 098: ALL PASS (roster keys gone, equipment.team_members dropped)';
END $$;
