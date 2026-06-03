-- ============================================================================
-- 085_daily_duplicate_cleanup.sql
-- ----------------------------------------------------------------------------
-- One-time historical de-duplication of full daily reports, prerequisite for
-- the 084 active-daily unique indexes (084 fail-closes while duplicate active
-- identities exist). PROD held 120 duplicate (date, identity) groups / 130
-- redundant rows (mostly Podio imports + app-era re-submissions) predating
-- daily duplicate enforcement.
--
-- Dedupe key: (date, identity) where identity = batch_label (poultry/pig/layer)
--   / herd (cattle) / flock (sheep). Submitter (team_member) is intentionally
--   IGNORED in the key, because the unique indexes key on (date, identity) only
--   and 34 groups had mixed submitters.
--
-- Survivor rule (Ronnie, 2026-06-03): keep the row with the highest numerical
--   activity = feed + grit + mortalities, then tie-break:
--     1. highest numeric score
--           poultry / layer : feed_lbs + grit_lbs + mortality_count
--           pig             : feed_lbs            (no grit/mortality columns)
--           cattle          : mortality_count     (feed/minerals are jsonb)
--           sheep           : bales_of_hay + lbs_of_alfalfa + mortality_count
--        (NULLs counted as 0)
--     2. most-complete (most populated fields)
--     3. most-recent submitted_at
--     4. lowest id (final determinism)
--   All non-survivors are SOFT-deleted (deleted_at = now(), deleted_by = NULL),
--   so they remain recoverable via Admin -> Recently Deleted. No hard deletes.
--
-- Excludes Add Feed quick-log rows (source = 'add_feed_webform') and already
-- soft-deleted rows, matching the 084 index predicates.
--
-- Apply: TEST first, then PROD, BOTH with psql --single-transaction
-- (-1) ON_ERROR_STOP=1 so the whole cleanup is atomic. Do NOT add BEGIN/COMMIT
-- here (keeps it exec_sql-compatible; the -1 flag supplies atomicity).
-- Run 084 immediately after; the guard at the end asserts 0 duplicates remain.
-- ============================================================================

-- ── poultry_dailys ──────────────────────────────────────────────────────────
WITH scored AS (
  SELECT t.id,
         (COALESCE(t.feed_lbs,0) + COALESCE(t.grit_lbs,0) + COALESCE(t.mortality_count,0))::numeric AS score,
         (SELECT count(*) FROM jsonb_each(to_jsonb(t)) e WHERE e.value NOT IN ('null'::jsonb, '""'::jsonb)) AS fld,
         t.submitted_at AS sub, t.date AS d, t.batch_label AS idy
  FROM public.poultry_dailys t
  WHERE t.deleted_at IS NULL AND t.source IS DISTINCT FROM 'add_feed_webform'
    AND NULLIF(BTRIM(t.batch_label), '') IS NOT NULL
),
ranked AS (
  SELECT id, row_number() OVER (PARTITION BY d, idy ORDER BY score DESC NULLS LAST, fld DESC, sub DESC NULLS LAST, id ASC) AS rn
  FROM scored
)
UPDATE public.poultry_dailys u SET deleted_at = now(), deleted_by = NULL
FROM ranked r WHERE u.id = r.id AND r.rn > 1;

-- ── pig_dailys ──────────────────────────────────────────────────────────────
WITH scored AS (
  SELECT t.id,
         COALESCE(t.feed_lbs,0)::numeric AS score,
         (SELECT count(*) FROM jsonb_each(to_jsonb(t)) e WHERE e.value NOT IN ('null'::jsonb, '""'::jsonb)) AS fld,
         t.submitted_at AS sub, t.date AS d, t.batch_label AS idy
  FROM public.pig_dailys t
  WHERE t.deleted_at IS NULL AND t.source IS DISTINCT FROM 'add_feed_webform'
    AND NULLIF(BTRIM(t.batch_label), '') IS NOT NULL
),
ranked AS (
  SELECT id, row_number() OVER (PARTITION BY d, idy ORDER BY score DESC NULLS LAST, fld DESC, sub DESC NULLS LAST, id ASC) AS rn
  FROM scored
)
UPDATE public.pig_dailys u SET deleted_at = now(), deleted_by = NULL
FROM ranked r WHERE u.id = r.id AND r.rn > 1;

-- ── layer_dailys ────────────────────────────────────────────────────────────
WITH scored AS (
  SELECT t.id,
         (COALESCE(t.feed_lbs,0) + COALESCE(t.grit_lbs,0) + COALESCE(t.mortality_count,0))::numeric AS score,
         (SELECT count(*) FROM jsonb_each(to_jsonb(t)) e WHERE e.value NOT IN ('null'::jsonb, '""'::jsonb)) AS fld,
         t.submitted_at AS sub, t.date AS d, t.batch_label AS idy
  FROM public.layer_dailys t
  WHERE t.deleted_at IS NULL AND t.source IS DISTINCT FROM 'add_feed_webform'
    AND NULLIF(BTRIM(t.batch_label), '') IS NOT NULL
),
ranked AS (
  SELECT id, row_number() OVER (PARTITION BY d, idy ORDER BY score DESC NULLS LAST, fld DESC, sub DESC NULLS LAST, id ASC) AS rn
  FROM scored
)
UPDATE public.layer_dailys u SET deleted_at = now(), deleted_by = NULL
FROM ranked r WHERE u.id = r.id AND r.rn > 1;

-- ── cattle_dailys ───────────────────────────────────────────────────────────
WITH scored AS (
  SELECT t.id,
         COALESCE(t.mortality_count,0)::numeric AS score,
         (SELECT count(*) FROM jsonb_each(to_jsonb(t)) e WHERE e.value NOT IN ('null'::jsonb, '""'::jsonb)) AS fld,
         t.submitted_at AS sub, t.date AS d, t.herd AS idy
  FROM public.cattle_dailys t
  WHERE t.deleted_at IS NULL AND t.source IS DISTINCT FROM 'add_feed_webform'
    AND NULLIF(BTRIM(t.herd), '') IS NOT NULL
),
ranked AS (
  SELECT id, row_number() OVER (PARTITION BY d, idy ORDER BY score DESC NULLS LAST, fld DESC, sub DESC NULLS LAST, id ASC) AS rn
  FROM scored
)
UPDATE public.cattle_dailys u SET deleted_at = now(), deleted_by = NULL
FROM ranked r WHERE u.id = r.id AND r.rn > 1;

-- ── sheep_dailys ────────────────────────────────────────────────────────────
WITH scored AS (
  SELECT t.id,
         (COALESCE(t.bales_of_hay,0) + COALESCE(t.lbs_of_alfalfa,0) + COALESCE(t.mortality_count,0))::numeric AS score,
         (SELECT count(*) FROM jsonb_each(to_jsonb(t)) e WHERE e.value NOT IN ('null'::jsonb, '""'::jsonb)) AS fld,
         t.submitted_at AS sub, t.date AS d, t.flock AS idy
  FROM public.sheep_dailys t
  WHERE t.deleted_at IS NULL AND t.source IS DISTINCT FROM 'add_feed_webform'
    AND NULLIF(BTRIM(t.flock), '') IS NOT NULL
),
ranked AS (
  SELECT id, row_number() OVER (PARTITION BY d, idy ORDER BY score DESC NULLS LAST, fld DESC, sub DESC NULLS LAST, id ASC) AS rn
  FROM scored
)
UPDATE public.sheep_dailys u SET deleted_at = now(), deleted_by = NULL
FROM ranked r WHERE u.id = r.id AND r.rn > 1;

-- ── Self-verifying guard: zero active duplicate identities must remain ───────
DO $$
DECLARE
  v_remaining int;
BEGIN
  WITH dups AS (
    SELECT 1 FROM public.poultry_dailys WHERE deleted_at IS NULL AND source IS DISTINCT FROM 'add_feed_webform' AND NULLIF(BTRIM(batch_label),'') IS NOT NULL GROUP BY date, batch_label HAVING count(*) > 1
    UNION ALL SELECT 1 FROM public.pig_dailys     WHERE deleted_at IS NULL AND source IS DISTINCT FROM 'add_feed_webform' AND NULLIF(BTRIM(batch_label),'') IS NOT NULL GROUP BY date, batch_label HAVING count(*) > 1
    UNION ALL SELECT 1 FROM public.layer_dailys   WHERE deleted_at IS NULL AND source IS DISTINCT FROM 'add_feed_webform' AND NULLIF(BTRIM(batch_label),'') IS NOT NULL GROUP BY date, batch_label HAVING count(*) > 1
    UNION ALL SELECT 1 FROM public.cattle_dailys  WHERE deleted_at IS NULL AND source IS DISTINCT FROM 'add_feed_webform' AND NULLIF(BTRIM(herd),'')        IS NOT NULL GROUP BY date, herd        HAVING count(*) > 1
    UNION ALL SELECT 1 FROM public.sheep_dailys   WHERE deleted_at IS NULL AND source IS DISTINCT FROM 'add_feed_webform' AND NULLIF(BTRIM(flock),'')       IS NOT NULL GROUP BY date, flock       HAVING count(*) > 1
  )
  SELECT count(*) INTO v_remaining FROM dups;
  IF v_remaining > 0 THEN
    RAISE EXCEPTION '085 cleanup left % duplicate active daily identities; 084 would still fail', v_remaining;
  END IF;
END
$$;

-- ============================================================================
-- End of 085_daily_duplicate_cleanup.sql
-- ============================================================================
