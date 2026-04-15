-- ============================================================================
-- Cattle module — comments timeline
-- ============================================================================
-- Added per Ronnie's clarification on weigh-in flow. Every weigh-in entry
-- with a note auto-publishes to this table. Cow profile also has an explicit
-- "Add Comment" button. Future sources (daily reports, calving) can write here too.
--
-- Apply via Supabase SQL Editor when ready. Idempotent.
-- See CATTLE_DESIGN.md §3.10a for full design.
-- ============================================================================

CREATE TABLE IF NOT EXISTS cattle_comments (
  id              text PRIMARY KEY,
  cattle_id       text REFERENCES cattle(id) ON DELETE CASCADE,
  cattle_tag      text,
  comment         text NOT NULL,
  team_member     text,
  source          text NOT NULL CHECK (source IN ('manual','weigh_in','daily_report','calving')),
  reference_id    text,
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_cattle_comments_cow ON cattle_comments(cattle_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_cattle_comments_tag ON cattle_comments(cattle_tag, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_cattle_comments_source ON cattle_comments(source);

ALTER TABLE cattle_comments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS cattle_comments_anon_insert ON cattle_comments;
-- Anon INSERT so the public weigh-in webform can write comments alongside weigh-ins
CREATE POLICY cattle_comments_anon_insert ON cattle_comments FOR INSERT WITH CHECK (true);

DROP POLICY IF EXISTS cattle_comments_anon_select ON cattle_comments;
-- Anon SELECT so the weigh-in webform can show prior comments if needed
CREATE POLICY cattle_comments_anon_select ON cattle_comments FOR SELECT USING (true);

DROP POLICY IF EXISTS cattle_comments_auth_all ON cattle_comments;
CREATE POLICY cattle_comments_auth_all ON cattle_comments FOR ALL
  TO authenticated USING (true) WITH CHECK (true);
