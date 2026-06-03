-- Non-destructive preflight for supabase-migrations/084_daily_report_unique_indexes.sql.
--
-- Run against TEST or PROD before applying the migration. Any returned rows
-- must be reviewed and resolved before the unique indexes can be created.
-- Add Feed rows and soft-deleted rows are excluded to match the index contract.

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
SELECT
  table_name,
  report_date,
  identity_field,
  identity_value,
  row_count,
  row_ids
FROM duplicate_identities
ORDER BY table_name, report_date, identity_value;
