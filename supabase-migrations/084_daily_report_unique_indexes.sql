-- ============================================================================
-- 084_daily_report_unique_indexes.sql
-- ----------------------------------------------------------------------------
-- Database-enforced duplicate prevention for full daily reports.
--
-- App contract:
--   - poultry/pig/layer: one active full daily report per date + batch_label.
--   - cattle: one active full daily report per date + herd.
--   - sheep: one active full daily report per date + flock.
--   - Add Feed rows (source='add_feed_webform') are excluded.
--   - egg_dailys intentionally stay client warning/pre-submit only.
--
-- PROD gate:
--   Run scripts/daily_duplicate_identity_report.sql first. This migration
--   refuses to create indexes while duplicate active identities remain.
-- ============================================================================

DO $$
DECLARE
  v_blockers jsonb;
BEGIN
  WITH duplicate_identities AS (
    SELECT
      'poultry_dailys'::text AS table_name,
      date::text AS report_date,
      'batch_label'::text AS identity_field,
      batch_label::text AS identity_value,
      count(*)::int AS row_count,
      array_agg(id::text ORDER BY id::text) AS row_ids
    FROM public.poultry_dailys
    WHERE deleted_at IS NULL
      AND source IS DISTINCT FROM 'add_feed_webform'
      AND NULLIF(BTRIM(batch_label), '') IS NOT NULL
    GROUP BY date, batch_label
    HAVING count(*) > 1

    UNION ALL

    SELECT
      'pig_dailys'::text AS table_name,
      date::text AS report_date,
      'batch_label'::text AS identity_field,
      batch_label::text AS identity_value,
      count(*)::int AS row_count,
      array_agg(id::text ORDER BY id::text) AS row_ids
    FROM public.pig_dailys
    WHERE deleted_at IS NULL
      AND source IS DISTINCT FROM 'add_feed_webform'
      AND NULLIF(BTRIM(batch_label), '') IS NOT NULL
    GROUP BY date, batch_label
    HAVING count(*) > 1

    UNION ALL

    SELECT
      'layer_dailys'::text AS table_name,
      date::text AS report_date,
      'batch_label'::text AS identity_field,
      batch_label::text AS identity_value,
      count(*)::int AS row_count,
      array_agg(id::text ORDER BY id::text) AS row_ids
    FROM public.layer_dailys
    WHERE deleted_at IS NULL
      AND source IS DISTINCT FROM 'add_feed_webform'
      AND NULLIF(BTRIM(batch_label), '') IS NOT NULL
    GROUP BY date, batch_label
    HAVING count(*) > 1

    UNION ALL

    SELECT
      'cattle_dailys'::text AS table_name,
      date::text AS report_date,
      'herd'::text AS identity_field,
      herd::text AS identity_value,
      count(*)::int AS row_count,
      array_agg(id::text ORDER BY id::text) AS row_ids
    FROM public.cattle_dailys
    WHERE deleted_at IS NULL
      AND source IS DISTINCT FROM 'add_feed_webform'
      AND NULLIF(BTRIM(herd), '') IS NOT NULL
    GROUP BY date, herd
    HAVING count(*) > 1

    UNION ALL

    SELECT
      'sheep_dailys'::text AS table_name,
      date::text AS report_date,
      'flock'::text AS identity_field,
      flock::text AS identity_value,
      count(*)::int AS row_count,
      array_agg(id::text ORDER BY id::text) AS row_ids
    FROM public.sheep_dailys
    WHERE deleted_at IS NULL
      AND source IS DISTINCT FROM 'add_feed_webform'
      AND NULLIF(BTRIM(flock), '') IS NOT NULL
    GROUP BY date, flock
    HAVING count(*) > 1
  )
  SELECT COALESCE(
    jsonb_agg(
      jsonb_build_object(
        'table', table_name,
        'date', report_date,
        'identity_field', identity_field,
        'identity_value', identity_value,
        'row_count', row_count,
        'row_ids', row_ids
      )
      ORDER BY table_name, report_date, identity_value
    ),
    '[]'::jsonb
  )
  INTO v_blockers
  FROM duplicate_identities;

  IF jsonb_array_length(v_blockers) > 0 THEN
    RAISE EXCEPTION
      'daily report unique indexes blocked: clean duplicate active daily identities first: %',
      v_blockers;
  END IF;
END
$$;

CREATE UNIQUE INDEX IF NOT EXISTS poultry_dailys_active_daily_identity_uq
  ON public.poultry_dailys (date, batch_label)
  WHERE deleted_at IS NULL
    AND source IS DISTINCT FROM 'add_feed_webform'
    AND NULLIF(BTRIM(batch_label), '') IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS pig_dailys_active_daily_identity_uq
  ON public.pig_dailys (date, batch_label)
  WHERE deleted_at IS NULL
    AND source IS DISTINCT FROM 'add_feed_webform'
    AND NULLIF(BTRIM(batch_label), '') IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS layer_dailys_active_daily_identity_uq
  ON public.layer_dailys (date, batch_label)
  WHERE deleted_at IS NULL
    AND source IS DISTINCT FROM 'add_feed_webform'
    AND NULLIF(BTRIM(batch_label), '') IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS cattle_dailys_active_daily_identity_uq
  ON public.cattle_dailys (date, herd)
  WHERE deleted_at IS NULL
    AND source IS DISTINCT FROM 'add_feed_webform'
    AND NULLIF(BTRIM(herd), '') IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS sheep_dailys_active_daily_identity_uq
  ON public.sheep_dailys (date, flock)
  WHERE deleted_at IS NULL
    AND source IS DISTINCT FROM 'add_feed_webform'
    AND NULLIF(BTRIM(flock), '') IS NOT NULL;

-- No PostgREST schema reload needed: this migration adds indexes only.

-- ============================================================================
-- End of 084_daily_report_unique_indexes.sql
-- ============================================================================
