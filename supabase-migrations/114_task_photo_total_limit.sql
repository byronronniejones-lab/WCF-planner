-- ============================================================================
-- 114_task_photo_total_limit.sql
-- ----------------------------------------------------------------------------
-- Tasks photo parity: cap task_instance_photos at 5 total rows per task.
--
-- Earlier Tasks v2 migrations allowed 5 creation photos plus 5 completion
-- photos. Comments/log attachments are capped at 5 total, so tasks now match
-- that behavior. The existing (instance_id, kind, sort_order) unique index
-- stays in place for idempotent slot reclaim; this trigger adds the total cap.
-- ============================================================================

CREATE OR REPLACE FUNCTION public._enforce_task_instance_photos_max_5_total()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_count int;
BEGIN
  IF NEW.instance_id IS NULL THEN
    RETURN NEW;
  END IF;

  -- Serialize inserts for one task instance so two concurrent uploads cannot
  -- both observe the same remaining slot.
  PERFORM pg_advisory_xact_lock(hashtext('task_instance_photos'), hashtext(NEW.instance_id));

  -- V2 RPCs intentionally INSERT then ON CONFLICT DO UPDATE to reclaim the
  -- legacy mirror slot. If that exact slot already exists, this INSERT will not
  -- increase the total row count, so allow the conflict/update path to proceed.
  IF TG_OP = 'INSERT' AND EXISTS (
    SELECT 1
    FROM public.task_instance_photos
    WHERE instance_id = NEW.instance_id
      AND kind = NEW.kind
      AND sort_order = NEW.sort_order
  ) THEN
    RETURN NEW;
  END IF;

  -- A same-instance update cannot increase the total number of photos.
  IF TG_OP = 'UPDATE' AND OLD.instance_id = NEW.instance_id THEN
    RETURN NEW;
  END IF;

  SELECT count(*)
    INTO v_count
    FROM public.task_instance_photos
    WHERE instance_id = NEW.instance_id;

  IF v_count >= 5 THEN
    RAISE EXCEPTION 'task_instance_photos: max 5 photos per task';
  END IF;

  RETURN NEW;
END;
$fn$;

DROP TRIGGER IF EXISTS task_instance_photos_max_5_total
  ON public.task_instance_photos;
CREATE TRIGGER task_instance_photos_max_5_total
  BEFORE INSERT OR UPDATE OF instance_id, kind, sort_order
  ON public.task_instance_photos
  FOR EACH ROW
  EXECUTE FUNCTION public._enforce_task_instance_photos_max_5_total();

REVOKE ALL ON FUNCTION public._enforce_task_instance_photos_max_5_total()
  FROM PUBLIC, anon, authenticated;

NOTIFY pgrst, 'reload schema';

-- ============================================================================
-- End of 114_task_photo_total_limit.sql
-- ============================================================================
