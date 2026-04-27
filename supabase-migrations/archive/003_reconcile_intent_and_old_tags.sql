-- ============================================================================
-- 003: Reconcile intent + old-tag history + anon-writable cattle
-- ============================================================================
-- Supports the two-button cattle weigh-in webform:
--   * "+ New Cow"        → webform creates the cattle row inline
--                          (uses anon INSERT below)
--   * "+ Replacement Tag" → entry saved with new_tag_flag=true; resolved later
--                          either inside the same webform session or via the
--                          admin Cattle ▸ Weigh-Ins reconcile dropdown.
--                          Resolution swaps the cow's tag (anon UPDATE below)
--                          and appends the prior tag to cattle.old_tags.
--
-- Tradeoff: opening anon INSERT + UPDATE on `cattle` lets anyone with the
-- public webform URL create or rename cow records. Threat model is internal
-- staff only; admin can clean up junk if it ever happens. Tighter alternative
-- (Edge Function with service-role validation) deferred until needed.
--
-- Apply via Supabase SQL Editor when ready. Idempotent.
-- ============================================================================

-- 1. Tag-history field on each cow.
--    Each entry: {"tag": "42", "changed_at": "2026-04-16T17:23:00Z"}
ALTER TABLE cattle
  ADD COLUMN IF NOT EXISTS old_tags jsonb NOT NULL DEFAULT '[]'::jsonb;

-- 2. Capture the staff member's intent on each weigh-in entry so we know
--    which reconcile path to render (mostly informational; the gate uses
--    new_tag_flag for blocking Complete).
ALTER TABLE weigh_ins
  ADD COLUMN IF NOT EXISTS reconcile_intent text
    CHECK (reconcile_intent IN ('new_cow','replacement'));

-- 3. Anon write policies on cattle (SELECT was already open from migration 001).
--    INSERT lets the webform create a "+ New Cow" inline.
--    UPDATE lets the webform / admin perform the tag swap on Replacement Tag
--    reconcile and append to old_tags. DELETE remains authenticated-only.
DROP POLICY IF EXISTS cattle_anon_insert ON cattle;
CREATE POLICY cattle_anon_insert ON cattle FOR INSERT WITH CHECK (true);

DROP POLICY IF EXISTS cattle_anon_update ON cattle;
CREATE POLICY cattle_anon_update ON cattle FOR UPDATE USING (true) WITH CHECK (true);
