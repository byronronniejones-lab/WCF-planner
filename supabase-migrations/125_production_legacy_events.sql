-- ============================================================================
-- 125_production_legacy_events.sql
-- ----------------------------------------------------------------------------
-- Production page backfill support.
--
-- Live Planner production is derived at read time from existing sources:
--   broilers: app_store.ppp-v4 processed batches
--   pigs: app_store.ppp-feeders-v1 processingTrips
--   cattle: cattle_processing_batches.actual_process_date + cows_detail
--   sheep: sheep_processing_batches.actual_process_date + sheep_detail
--   eggs: egg_dailys group counts
--
-- This migration stores only legacy/manual backfill rows from the historical
-- Processing Events spreadsheet so the page can reconcile old Podio numbers
-- without double-counting future Planner entries. No combined total is stored.
-- ============================================================================

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS public.production_legacy_events (
  id                text PRIMARY KEY,
  source_key        text NOT NULL UNIQUE,
  event_date        date NOT NULL,
  program           text NOT NULL
                      CHECK (program IN ('broiler', 'pig', 'cattle', 'sheep', 'egg')),
  batch_name        text,
  quantity          numeric(12, 2) NOT NULL CHECK (quantity >= 0),
  quantity_unit     text NOT NULL DEFAULT 'head'
                      CHECK (quantity_unit IN ('head', 'birds', 'eggs', 'dozens')),
  source_file       text NOT NULL DEFAULT 'Processing Events - ALL.xlsx',
  source_row_number int,
  raw_program       text,
  raw_relationship  text,
  review_status     text NOT NULL DEFAULT 'approved'
                      CHECK (review_status IN ('approved', 'pending_review', 'rejected')),
  notes             text,
  imported_at       timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS production_legacy_events_program_date_idx
  ON public.production_legacy_events (program, event_date DESC);

CREATE INDEX IF NOT EXISTS production_legacy_events_review_idx
  ON public.production_legacy_events (review_status, event_date DESC);

REVOKE ALL ON TABLE public.production_legacy_events FROM PUBLIC, anon, authenticated;

ALTER TABLE public.production_legacy_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS production_legacy_events_deny_all ON public.production_legacy_events;
CREATE POLICY production_legacy_events_deny_all ON public.production_legacy_events
  FOR ALL USING (false);

DROP TRIGGER IF EXISTS production_legacy_events_touch ON public.production_legacy_events;
CREATE TRIGGER production_legacy_events_touch BEFORE UPDATE ON public.production_legacy_events
  FOR EACH ROW EXECUTE FUNCTION public.cattle_touch_updated_at();

CREATE OR REPLACE FUNCTION public.list_production_legacy_events(
  p_from_date date DEFAULT NULL,
  p_to_date   date DEFAULT NULL
) RETURNS TABLE (
  id                text,
  source_key        text,
  event_date        date,
  program           text,
  batch_name        text,
  quantity          numeric,
  quantity_unit     text,
  source_file       text,
  source_row_number int,
  raw_program       text,
  raw_relationship  text,
  review_status     text,
  notes             text,
  imported_at       timestamptz,
  updated_at        timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_caller uuid := auth.uid();
  v_role   text;
BEGIN
  IF v_caller IS NULL THEN
    RAISE EXCEPTION 'list_production_legacy_events: authenticated caller required';
  END IF;

  v_role := public.profile_role();
  IF v_role IS NULL OR v_role NOT IN ('farm_team', 'management', 'admin') THEN
    RAISE EXCEPTION 'list_production_legacy_events: caller role % cannot read production', COALESCE(v_role, 'null');
  END IF;

  RETURN QUERY
    SELECT e.id,
           e.source_key,
           e.event_date,
           e.program,
           e.batch_name,
           e.quantity,
           e.quantity_unit,
           e.source_file,
           e.source_row_number,
           e.raw_program,
           e.raw_relationship,
           e.review_status,
           e.notes,
           e.imported_at,
           e.updated_at
      FROM public.production_legacy_events e
     WHERE e.review_status <> 'rejected'
       AND (p_from_date IS NULL OR e.event_date >= p_from_date)
       AND (p_to_date IS NULL OR e.event_date <= p_to_date)
     ORDER BY e.event_date DESC, e.program, e.batch_name NULLS LAST, e.source_row_number NULLS LAST;
END;
$fn$;

REVOKE ALL ON FUNCTION public.list_production_legacy_events(date, date) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.list_production_legacy_events(date, date) TO authenticated;
