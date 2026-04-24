-- Two equipment tweaks:
--
-- 1. Per-piece operator list. Each equipment row carries a list of team-member
--    names (pulled from webform_config.team_members) indicating who typically
--    runs that piece. Surfaced on the admin editor + /equipment/<slug> detail
--    page. Shape: ["BRIAN","DAVID","MAK"].
--
-- 2. Rename equipment.status='retired' → 'sold'. The 6 currently-retired pieces
--    (JD-317, JD-333, JD-Gator, Kubota-RTV, Polaris-Ranger, Great-Plains-Drill)
--    were actually sold, not parked. Admin UI + Fleet view labeling updated
--    to match. Column is free-text (no CHECK constraint), so just UPDATE.
ALTER TABLE equipment
  ADD COLUMN IF NOT EXISTS team_members JSONB NOT NULL DEFAULT '[]'::jsonb;

UPDATE equipment SET status = 'sold' WHERE status = 'retired';
