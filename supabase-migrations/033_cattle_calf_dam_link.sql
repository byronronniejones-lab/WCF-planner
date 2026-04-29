-- ============================================================================
-- Migration 033: cattle calf dam-link on calving record insert
-- ----------------------------------------------------------------------------
-- Cattle calf dam-link fix, 2026-04-29.
--
-- Background:
--   `cattle_calving_records.dam_tag` is written when a calving record is
--   added (via `addCalvingRecord` in `CattleHerdsView.jsx`), and `calf_tag`
--   is captured from the form. The matching calf's `cattle` row, however,
--   is not updated — so calf detail pages and herd tiles read
--   `cattle.dam_tag` and find nothing, even though the calving record
--   knows the dam.
--
--   This is purely metadata reconciliation — no classification change,
--   no audit-comment write. Distinct from migration 032 (heifer→cow
--   promotion + audit comment), which lives as a sibling trigger.
--
-- (1) AFTER-INSERT trigger on `cattle_calving_records`. When a calving
--     record is inserted whose `calf_tag` resolves to a cattle row whose
--     `dam_tag` is null/blank, set the calf row's `dam_tag = NEW.dam_tag`.
--     Never overwrites a non-blank existing `dam_tag` (could be
--     hand-corrected admin data).
--
-- (2) One-time backfill: for every existing calving record with a
--     `calf_tag`, set the matching cattle row's `dam_tag` if currently
--     null/blank. Deterministic when multiple calving records reference
--     the same calf_tag with different dam_tags — picks the earliest by
--     (calving_date, created_at, id) via row_number(). Idempotent —
--     re-running finds zero rows to update.
--
-- Trigger ordering note:
--   Both mig 032 (`cattle_calving_promote_heifer`) and mig 033
--   (`cattle_calving_link_calf_dam`) are AFTER INSERT triggers on
--   `cattle_calving_records`. PostgreSQL fires AFTER triggers in
--   alphabetical order of trigger name; `cattle_calving_link_calf_dam`
--   sorts before `cattle_calving_promote_heifer`, so calf-link fires
--   first. Both touch different rows (link → calf, promote → dam) so
--   ordering doesn't matter for correctness — documented for future
--   readers.
--
-- Function security:
--   `SECURITY DEFINER` so the trigger writes to `cattle` with the
--   migration owner's privileges, regardless of the calling session's
--   RLS context. `SET search_path = public` locks the schema lookup.
--   No RLS policy changes — trigger is the only path that links calf
--   dam_tag based on calving events.
--
-- Out of scope (deliberate):
--   - `cattle_calving_records.calf_id` (column exists from mig 001 but is
--     unused by app code; no consumers, no value in populating).
--   - Audit comment on calf timeline (metadata reconciliation, not a
--     state change worth surfacing — the existing JS path already
--     publishes a comment on the dam's timeline).
-- ============================================================================

BEGIN;

-- ----------------------------------------------------------------------------
-- (1) Trigger function + trigger
-- ----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION cattle_link_calf_dam_on_calving()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  calf_id_match     text;
  calf_existing_dam text;
BEGIN
  -- Skip when no calf_tag was captured (most common path — many calving
  -- records are filed without a tag because the calf hasn't been tagged
  -- yet).
  IF NEW.calf_tag IS NULL OR NEW.calf_tag = '' THEN
    RETURN NEW;
  END IF;

  -- Defensive: dam_tag is column-NOT NULL in mig 001 schema, but check
  -- anyway since SECURITY DEFINER paths shouldn't trust upstream
  -- invariants.
  IF NEW.dam_tag IS NULL OR NEW.dam_tag = '' THEN
    RETURN NEW;
  END IF;

  SELECT id, dam_tag
    INTO calf_id_match, calf_existing_dam
    FROM cattle
   WHERE tag = NEW.calf_tag
   LIMIT 1;

  IF calf_id_match IS NULL THEN
    RETURN NEW;
  END IF;

  -- Only set when currently null/blank — never overwrite a non-blank
  -- value (hand-corrected dam, prior calving record with different
  -- dam_tag). First writer wins; data conflicts surface to admin
  -- naturally.
  IF calf_existing_dam IS NULL OR calf_existing_dam = '' THEN
    UPDATE cattle SET dam_tag = NEW.dam_tag WHERE id = calf_id_match;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS cattle_calving_link_calf_dam ON cattle_calving_records;
CREATE TRIGGER cattle_calving_link_calf_dam
  AFTER INSERT ON cattle_calving_records
  FOR EACH ROW
  EXECUTE FUNCTION cattle_link_calf_dam_on_calving();

-- ----------------------------------------------------------------------------
-- (2) One-time backfill
-- ----------------------------------------------------------------------------
-- Deterministic source-row pick when more than one calving record
-- references the same calf_tag with different dam_tags: prefer earliest
-- calving_date, tie-break by created_at, then id. Only updates calf rows
-- with currently null/blank dam_tag — never overwrites.

DO $$
BEGIN
  WITH ranked AS (
    SELECT
      calf_tag,
      dam_tag,
      row_number() OVER (
        PARTITION BY calf_tag
        ORDER BY calving_date ASC NULLS LAST,
                 created_at  ASC NULLS LAST,
                 id          ASC
      ) AS rn
    FROM cattle_calving_records
    WHERE calf_tag IS NOT NULL
      AND calf_tag <> ''
      AND dam_tag  IS NOT NULL
      AND dam_tag  <> ''
  )
  UPDATE cattle c
     SET dam_tag = r.dam_tag
    FROM ranked r
   WHERE r.rn = 1
     AND c.tag = r.calf_tag
     AND (c.dam_tag IS NULL OR c.dam_tag = '');
END $$;

COMMIT;
