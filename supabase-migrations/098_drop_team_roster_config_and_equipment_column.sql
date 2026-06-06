-- ============================================================================
-- 098_drop_team_roster_config_and_equipment_column.sql
-- ----------------------------------------------------------------------------
-- Phase 3 (team-roster teardown). Every form submitter is now locked to the
-- signed-in user and all frontend roster code + the roster admin UI were
-- removed (commit 029b55c); submit_task_instance lost its roster check in
-- mig 097. This retires the now-dead backend storage:
--
--   * DELETE the retired webform_config roster keys:
--       - team_roster            (canonical roster)
--       - team_members           (legacy active-name mirror)
--       - team_availability      (per-form visibility filters)
--       - per_form_team_members  (retired per-form filtering)
--       - weighins_team_members  (retired per-species filtering)
--   * DROP equipment.team_members (operator-assignment JSONB column added in
--     archive/022; zero frontend references after the teardown, no views /
--     policies / functions depend on it).
--
-- Irreversible — the dead roster data is discarded. No live RPC or frontend
-- reads any of these keys/column.
--
-- Apply order: TEST first, PROD after explicit approval.
-- ============================================================================

DELETE FROM public.webform_config
 WHERE key IN (
   'team_roster',
   'team_members',
   'team_availability',
   'per_form_team_members',
   'weighins_team_members'
 );

ALTER TABLE public.equipment DROP COLUMN IF EXISTS team_members;

NOTIFY pgrst, 'reload schema';

-- ============================================================================
-- End of 098_drop_team_roster_config_and_equipment_column.sql
-- ============================================================================
