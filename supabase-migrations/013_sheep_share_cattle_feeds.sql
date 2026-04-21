-- ============================================================================
-- Migration 013: collapse sheep-specific feeds into the shared cattle list
-- ----------------------------------------------------------------------------
-- Per-session popouts on 2026-04-21:
--   * Delete the 3 "(Sheep)" seed entries added by migration 012.
--   * Extend herd_scope on every active cattle_feed_inputs row to include
--     rams/ewes/feeders, so sheep can pick from the same master list cattle
--     uses (no more sheep-only duplicates cluttering the admin Feed tab).
--   * Remap historical sheep_dailys jsonb references from the deleted sheep
--     seeds to specific cattle feeds:
--       feed-sheep-hay      → ALFALFA  (hay, 1104.97 lb/bale)
--       feed-sheep-alfalfa  → ALFALFA PELLETS  (pellet, 1 lb)
--       feed-sheep-mineral  → Salt  (mineral, 1 lb)
--     Hay rows recompute lbs_as_fed using ALFALFA's unit_weight_lbs so the
--     nutrition math stays internally consistent. Alfalfa pellets unchanged
--     (both feeds are 1 lb/unit). Minerals unchanged (pct_eaten preserved).
--
-- Idempotent: delete and update steps guard on existing state.
--
-- Apply via Supabase SQL Editor. Assumes migration 012 already applied.
-- ============================================================================


-- ===== 1. Extend herd_scope on every active cattle feed ===================
-- Union existing herd_scope with sheep flocks. De-duplicates automatically.
-- Skips the 3 "(Sheep)" seeds — those are being deleted below.
UPDATE cattle_feed_inputs
SET herd_scope = (
  SELECT array_agg(DISTINCT x)
  FROM unnest(herd_scope || ARRAY['rams','ewes','feeders']) x
)
WHERE status = 'active'
  AND id NOT IN ('feed-sheep-hay','feed-sheep-alfalfa','feed-sheep-mineral')
  AND NOT (herd_scope @> ARRAY['rams','ewes','feeders']);


-- ===== 2. Remap historical sheep_dailys.feeds jsonb =======================
-- Build new feeds array per row, swapping feed-sheep-hay / feed-sheep-alfalfa
-- entries for their cattle-list targets. Passes through any other entries
-- untouched. Recomputes lbs_as_fed for hay using ALFALFA's unit_weight_lbs.
UPDATE sheep_dailys sd
SET feeds = (
  SELECT COALESCE(jsonb_agg(
    CASE f->>'feed_input_id'
      WHEN 'feed-sheep-hay' THEN jsonb_build_object(
        'feed_input_id', (SELECT id FROM cattle_feed_inputs WHERE name = 'ALFALFA' AND category = 'hay' LIMIT 1),
        'feed_name',     'ALFALFA',
        'category',      'hay',
        'qty',           (f->'qty'),
        'unit',          'bale',
        'lbs_as_fed',    round(((f->>'qty')::numeric * COALESCE((SELECT unit_weight_lbs FROM cattle_feed_inputs WHERE name = 'ALFALFA' AND category = 'hay' LIMIT 1), 1))::numeric, 2),
        'is_creep',      false
      )
      WHEN 'feed-sheep-alfalfa' THEN jsonb_build_object(
        'feed_input_id', (SELECT id FROM cattle_feed_inputs WHERE name = 'ALFALFA PELLETS' AND category = 'pellet' LIMIT 1),
        'feed_name',     'ALFALFA PELLETS',
        'category',      'pellet',
        'qty',           (f->'qty'),
        'unit',          'lb',
        'lbs_as_fed',    (f->'lbs_as_fed'),
        'is_creep',      false
      )
      ELSE f
    END
  ), '[]'::jsonb)
  FROM jsonb_array_elements(sd.feeds) f
)
WHERE sd.feeds @> '[{"feed_input_id":"feed-sheep-hay"}]'::jsonb
   OR sd.feeds @> '[{"feed_input_id":"feed-sheep-alfalfa"}]'::jsonb;


-- ===== 3. Remap historical sheep_dailys.minerals jsonb ====================
UPDATE sheep_dailys sd
SET minerals = (
  SELECT COALESCE(jsonb_agg(
    CASE m->>'feed_input_id'
      WHEN 'feed-sheep-mineral' THEN jsonb_build_object(
        'feed_input_id', (SELECT id FROM cattle_feed_inputs WHERE name = 'Salt' AND category = 'mineral' LIMIT 1),
        'name',          'Salt',
        'lbs',           (m->'lbs'),
        'pct_eaten',     (m->'pct_eaten')
      )
      ELSE m
    END
  ), '[]'::jsonb)
  FROM jsonb_array_elements(sd.minerals) m
)
WHERE sd.minerals @> '[{"feed_input_id":"feed-sheep-mineral"}]'::jsonb;


-- ===== 4. Delete the 3 "(Sheep)" seed entries ==============================
DELETE FROM cattle_feed_inputs
WHERE id IN ('feed-sheep-hay','feed-sheep-alfalfa','feed-sheep-mineral');
