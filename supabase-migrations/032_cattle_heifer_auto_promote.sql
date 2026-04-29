-- ============================================================================
-- Migration 032: cattle heifer → cow auto-promote on calving
-- ----------------------------------------------------------------------------
-- Cattle herd small-win, 2026-04-29.
--
-- (1) AFTER-INSERT trigger on `cattle_calving_records`. When a calving record
--     is inserted whose `dam_tag` resolves to a cattle row currently
--     classified as `sex='heifer'`, automatically flip her to `sex='cow'`
--     and write an auto-promote audit comment to `cattle_comments` with
--     `source='calving'`. No DELETE/UPDATE trigger — heifer status is not
--     restored if a calving record is deleted (per locked Codex spec).
--
-- (2) One-time backfill: any existing heifer with at least one prior
--     calving record is promoted to cow + an audit comment is written.
--     Idempotent — re-running finds no heifers-with-prior-calvings.
--
-- Two-comments-on-first-heifer-calving is by design + acceptable per Codex
-- review:
--   * The existing JS calving-stat comment (written by addCalvingRecord
--     in CattleHerdsView) carries the calving-event details: total born,
--     deaths, calf tag, complications.
--   * The trigger-generated auto-promote comment carries the classification
--     change. Distinct events; both belong on the timeline.
--
-- Function security:
--   `SECURITY DEFINER` so the trigger writes to `cattle` and
--   `cattle_comments` with the migration owner's privileges, regardless of
--   the calling session's RLS context. `SET search_path = public` locks the
--   schema lookup so a malicious search_path manipulation can't redirect
--   the trigger to a shadow table. No RLS policy changes are made — the
--   trigger is the only path that mutates `cattle.sex` based on calving
--   events.
--
-- Idempotent: `CREATE OR REPLACE` on the function, `DROP TRIGGER IF EXISTS`
-- + `CREATE TRIGGER` on the trigger, `INSERT ... ON CONFLICT DO NOTHING`
-- where applicable, and the backfill loop only finds heifers-with-calvings
-- on the first run.
-- ============================================================================

BEGIN;

-- gen_random_uuid() lives in pgcrypto. Supabase enables it by default but
-- the migration declares the dependency explicitly so a fresh project
-- without prior migrations doesn't fail on first apply.
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ----------------------------------------------------------------------------
-- (1) Trigger function + trigger
-- ----------------------------------------------------------------------------

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
BEGIN
  IF NEW.dam_tag IS NULL THEN
    RETURN NEW;
  END IF;

  -- Look up the dam by current tag. The cattle.tag column has a unique
  -- index when present; nullable for unweaned calves. Retagged mommas
  -- whose old tag matches NEW.dam_tag but whose current tag has changed
  -- would not match here — same gap that the existing calfCount() UI
  -- helper has, documented as out-of-scope for this build.
  SELECT id, tag, sex
    INTO cow_id, cow_tag, cow_sex
    FROM cattle
   WHERE tag = NEW.dam_tag
   LIMIT 1;

  IF cow_id IS NULL OR cow_sex <> 'heifer' THEN
    RETURN NEW;
  END IF;

  UPDATE cattle SET sex = 'cow' WHERE id = cow_id;

  INSERT INTO cattle_comments (id, cattle_id, cattle_tag, comment, source, reference_id)
  VALUES (
    replace(gen_random_uuid()::text, '-', ''),
    cow_id,
    cow_tag,
    'Automatically promoted from heifer to cow on calving record.',
    'calving',
    NEW.id
  );

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS cattle_calving_promote_heifer ON cattle_calving_records;
CREATE TRIGGER cattle_calving_promote_heifer
  AFTER INSERT ON cattle_calving_records
  FOR EACH ROW
  EXECUTE FUNCTION cattle_promote_heifer_on_calving();

-- ----------------------------------------------------------------------------
-- (2) One-time backfill
-- ----------------------------------------------------------------------------
-- Any cattle row with sex='heifer' AND at least one matching cattle_calving_records
-- row (by tag) gets promoted to 'cow' + an audit comment. Idempotent: a
-- second run finds zero heifers-with-calvings.

DO $$
DECLARE
  promoted_cow RECORD;
BEGIN
  FOR promoted_cow IN
    SELECT DISTINCT c.id AS cattle_id, c.tag AS cattle_tag
      FROM cattle c
      JOIN cattle_calving_records cr ON cr.dam_tag = c.tag
     WHERE c.sex = 'heifer'
  LOOP
    UPDATE cattle SET sex = 'cow' WHERE id = promoted_cow.cattle_id;

    INSERT INTO cattle_comments (id, cattle_id, cattle_tag, comment, source, reference_id)
    VALUES (
      replace(gen_random_uuid()::text, '-', ''),
      promoted_cow.cattle_id,
      promoted_cow.cattle_tag,
      'Automatically promoted from heifer to cow (backfill 2026-04-29 — existing calving records found).',
      'calving',
      NULL
    );
  END LOOP;
END $$;

COMMIT;
