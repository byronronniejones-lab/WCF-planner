-- ============================================================================
-- Migration 012: sheep_dailys feeds/minerals jsonb + cattle_feed_inputs seed
-- ----------------------------------------------------------------------------
-- Full cattle parity for sheep:
--   * sheep_dailys gets feeds + minerals jsonb columns (matches cattle_dailys
--     shape); existing rows migrated from bales_of_hay / lbs_of_alfalfa /
--     minerals_given / minerals_pct_eaten into jsonb.
--   * cattle_feed_inputs reused as the shared livestock feed master list.
--     Three sheep-scoped seed rows (Hay, Alfalfa, Sheep Mineral) added with
--     herd_scope = ['rams','ewes','feeders'] so they appear in the admin
--     LivestockFeedInputsPanel + the sheep webform dropdown.
--   * Flat columns (bales_of_hay, lbs_of_alfalfa, minerals_given,
--     minerals_pct_eaten) are KEPT as deprecated — no new writes, no new
--     reads. A future migration can drop them once confidence is high.
--
-- Idempotent: every step guards on existing state. Safe to re-run.
--
-- Apply via Supabase SQL Editor.
-- ============================================================================


-- ===== 1. Add jsonb columns to sheep_dailys ================================
ALTER TABLE sheep_dailys
  ADD COLUMN IF NOT EXISTS feeds    jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS minerals jsonb NOT NULL DEFAULT '[]'::jsonb;


-- ===== 2. Seed sheep-scoped entries in cattle_feed_inputs ==================
-- Deterministic IDs so historical jsonb references resolve after any admin
-- renaming. herd_scope unions sheep flocks with any existing values on
-- re-run so a pre-existing admin edit isn't clobbered.
INSERT INTO cattle_feed_inputs (id, name, category, unit, unit_weight_lbs, herd_scope, status)
VALUES
  ('feed-sheep-hay',     'Hay (Sheep)',     'hay',     'bale', 50, ARRAY['rams','ewes','feeders'], 'active'),
  ('feed-sheep-alfalfa', 'Alfalfa (Sheep)', 'pellet',  'lb',    1, ARRAY['rams','ewes','feeders'], 'active'),
  ('feed-sheep-mineral', 'Sheep Mineral',   'mineral', 'lb',    1, ARRAY['rams','ewes','feeders'], 'active')
ON CONFLICT (id) DO UPDATE SET
  herd_scope = (
    SELECT array_agg(DISTINCT x)
    FROM unnest(cattle_feed_inputs.herd_scope || EXCLUDED.herd_scope) x
  ),
  status = 'active';


-- ===== 3. Backfill feeds jsonb from bales_of_hay + lbs_of_alfalfa =========
UPDATE sheep_dailys
SET feeds =
  CASE WHEN bales_of_hay IS NOT NULL AND bales_of_hay > 0
       THEN jsonb_build_array(jsonb_build_object(
         'feed_input_id', 'feed-sheep-hay',
         'feed_name',     'Hay (Sheep)',
         'category',      'hay',
         'qty',           bales_of_hay,
         'unit',          'bale',
         'lbs_as_fed',    round((bales_of_hay * 50)::numeric, 2),
         'is_creep',      false
       ))
       ELSE '[]'::jsonb
  END
  ||
  CASE WHEN lbs_of_alfalfa IS NOT NULL AND lbs_of_alfalfa > 0
       THEN jsonb_build_array(jsonb_build_object(
         'feed_input_id', 'feed-sheep-alfalfa',
         'feed_name',     'Alfalfa (Sheep)',
         'category',      'pellet',
         'qty',           lbs_of_alfalfa,
         'unit',          'lb',
         'lbs_as_fed',    round(lbs_of_alfalfa::numeric, 2),
         'is_creep',      false
       ))
       ELSE '[]'::jsonb
  END
WHERE feeds = '[]'::jsonb
  AND ((bales_of_hay IS NOT NULL AND bales_of_hay > 0) OR (lbs_of_alfalfa IS NOT NULL AND lbs_of_alfalfa > 0));


-- ===== 4. Backfill minerals jsonb from minerals_given + minerals_pct_eaten
UPDATE sheep_dailys
SET minerals = jsonb_build_array(jsonb_build_object(
  'feed_input_id', 'feed-sheep-mineral',
  'name',          'Sheep Mineral',
  'lbs',           NULL,
  'pct_eaten',     minerals_pct_eaten
))
WHERE minerals = '[]'::jsonb
  AND minerals_given = true;
