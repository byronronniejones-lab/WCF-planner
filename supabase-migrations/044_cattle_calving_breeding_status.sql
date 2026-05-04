-- ============================================================================
-- Migration 044: cattle calving → breeding_status auto-flip to OPEN
-- ----------------------------------------------------------------------------
-- Cattle herd correction, 2026-05-04.
--
-- Extends mig 032's `cattle_promote_heifer_on_calving` trigger so that on a
-- new cattle_calving_records insert:
--   (1) heifer dam → still auto-promotes to sex='cow' (mig 032 behavior,
--       preserved verbatim — separate audit comment, distinct from the
--       breeding_status change).
--   (2) cow OR heifer dam whose breeding_status='PREGNANT' is flipped to
--       'OPEN', and a calving-source audit comment is written. A heifer who
--       is also pregnant gets BOTH audit comments (one for the promote, one
--       for the status flip) — distinct events, both belong on the timeline.
--
-- One-time backfill: any existing cattle row with breeding_status='PREGNANT'
-- that has at least one matching cattle_calving_records row (by tag) and no
-- prior 'Breeding status set to OPEN%' calving comment is flipped to OPEN +
-- gets a backfill audit comment. Idempotent — re-running finds zero rows
-- because the comment-existence guard kicks in after the first run, even if
-- a cow is later re-pregged and re-calved (the trigger handles that path).
--
-- Function security mirrors mig 032: SECURITY DEFINER + SET search_path =
-- public locks schema lookup so RLS context can't redirect the trigger.
--
-- Idempotent: CREATE OR REPLACE on the function, DROP TRIGGER IF EXISTS +
-- CREATE TRIGGER, NOT EXISTS guard on the backfill loop.
-- ============================================================================

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE OR REPLACE FUNCTION cattle_promote_heifer_on_calving()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  cow_id text;
  cow_tag text;
  cow_sex text;
  cow_bs text;
BEGIN
  IF NEW.dam_tag IS NULL THEN
    RETURN NEW;
  END IF;

  -- Look up the dam by current tag. Same retag gap as mig 032 — out of scope
  -- here; we rely on the calving-form to capture the dam's current tag.
  SELECT id, tag, sex, breeding_status
    INTO cow_id, cow_tag, cow_sex, cow_bs
    FROM cattle
   WHERE tag = NEW.dam_tag
   LIMIT 1;

  IF cow_id IS NULL THEN
    RETURN NEW;
  END IF;

  -- (1) Heifer → cow promotion (mig 032 behavior).
  IF cow_sex = 'heifer' THEN
    UPDATE cattle SET sex = 'cow' WHERE id = cow_id;
    cow_sex := 'cow';

    INSERT INTO cattle_comments (id, cattle_id, cattle_tag, comment, source, reference_id)
    VALUES (
      replace(gen_random_uuid()::text, '-', ''),
      cow_id,
      cow_tag,
      'Automatically promoted from heifer to cow on calving record.',
      'calving',
      NEW.id
    );
  END IF;

  -- (2) PREGNANT → OPEN flip (mig 044 addition). Both heifers and cows
  -- pass through this branch — the dam's prior breeding_status alone
  -- gates the action.
  IF cow_bs = 'PREGNANT' THEN
    UPDATE cattle SET breeding_status = 'OPEN' WHERE id = cow_id;

    INSERT INTO cattle_comments (id, cattle_id, cattle_tag, comment, source, reference_id)
    VALUES (
      replace(gen_random_uuid()::text, '-', ''),
      cow_id,
      cow_tag,
      'Breeding status set to OPEN on calving record.',
      'calving',
      NEW.id
    );
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS cattle_calving_promote_heifer ON cattle_calving_records;
CREATE TRIGGER cattle_calving_promote_heifer
  AFTER INSERT ON cattle_calving_records
  FOR EACH ROW
  EXECUTE FUNCTION cattle_promote_heifer_on_calving();

-- ----------------------------------------------------------------------------
-- One-time backfill: existing PREGNANT cows with calving records → OPEN.
-- ----------------------------------------------------------------------------
-- Guard: skip cows that already have a 'Breeding status set to OPEN%'
-- calving-source audit comment, so re-running the migration is a no-op
-- and a re-pregged + re-calved cow handled by the trigger isn't double-flipped.

DO $$
DECLARE
  flipped_cow RECORD;
BEGIN
  FOR flipped_cow IN
    SELECT DISTINCT c.id AS cattle_id, c.tag AS cattle_tag
      FROM cattle c
      JOIN cattle_calving_records cr ON cr.dam_tag = c.tag
     WHERE c.breeding_status = 'PREGNANT'
       AND NOT EXISTS (
         SELECT 1 FROM cattle_comments cc
          WHERE cc.cattle_id = c.id
            AND cc.source = 'calving'
            AND cc.comment LIKE 'Breeding status set to OPEN%'
       )
  LOOP
    UPDATE cattle SET breeding_status = 'OPEN' WHERE id = flipped_cow.cattle_id;

    INSERT INTO cattle_comments (id, cattle_id, cattle_tag, comment, source, reference_id)
    VALUES (
      replace(gen_random_uuid()::text, '-', ''),
      flipped_cow.cattle_id,
      flipped_cow.cattle_tag,
      'Breeding status set to OPEN (backfill 2026-05-04 — existing calving records found).',
      'calving',
      NULL
    );
  END LOOP;
END $$;

COMMIT;
