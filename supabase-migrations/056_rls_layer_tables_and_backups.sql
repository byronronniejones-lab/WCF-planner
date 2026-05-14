-- Migration 056 — close the Supabase rls_disabled_in_public advisory on
-- the two live hand-created tables (layer_batches, layer_housings) and
-- the 18 _backup_* snapshots. No data shape changes; only RLS enablement,
-- intentional policies, and grant tightening. Fully idempotent: re-running
-- this file is safe at any starting state.
--
-- Pre-state (PROD, 2026-05-14):
--   layer_batches / layer_housings: RLS off, anon holds full CRUD grants,
--   zero policies. An unauthenticated client could DELETE every row.
--   18 _backup_* tables: RLS off, no app code references them in src/.
--   No PUBLIC grants on any of the affected tables (verified read-only).
--
-- Post-state target:
--   layer_batches  — anon SELECT only; authenticated full CRUD; RLS on.
--   layer_housings — anon SELECT + column-scoped UPDATE on current_count
--                    and current_count_date for active rows; authenticated
--                    full CRUD; RLS on.
--   _backup_*      — RLS on, NO policies, anon + authenticated + PUBLIC
--                    grants revoked; service_role still bypasses RLS for
--                    any future restore work.
--
-- Live-table grants are declared EXPLICITLY per role (Codex 2026-05-14
-- revision 1) rather than relying on Supabase's default grants. The
-- backup-table block is guarded with to_regclass so TEST projects that
-- never received some snapshots don't fail the whole apply (revision 2).
-- PUBLIC revokes are belt-and-suspenders (revision 3) — verified empty
-- on PROD but kept so future schema additions can't accidentally inherit
-- write access through PUBLIC.
--
-- Public-form path the matrix preserves:
--   src/webforms/WebformHub.jsx :: layer daily submit
--     -> src/lib/layerHousing.js :: setHousingAnchorFromReport
--        - SELECT layer_housings WHERE status='active'
--        - SELECT layer_batches id/name (fallback batch→housing lookup)
--        - UPDATE layer_housings SET current_count = ?, current_count_date = ?
--   The column-scoped UPDATE grant matches exactly what this hook writes.
--   If PostgREST cannot drive the column-scoped UPDATE under the anon
--   role on TEST, the escape hatch is migration 057: a SECURITY DEFINER
--   stamp_layer_housing_anchor RPC (mirror of mig 055's
--   stamp_broiler_batch_avg) + a code change in setHousingAnchorFromReport
--   and REVOKE anon UPDATE entirely. Not in scope for 056.

BEGIN;

-- ════════════════════════════════════════════════════════════════════
-- layer_batches — anon SELECT only; authenticated full CRUD
-- ════════════════════════════════════════════════════════════════════

ALTER TABLE public.layer_batches ENABLE ROW LEVEL SECURITY;

-- Explicit grant matrix (do not rely on Supabase defaults).
REVOKE ALL ON public.layer_batches FROM PUBLIC;
REVOKE INSERT, UPDATE, DELETE ON public.layer_batches FROM anon;
GRANT SELECT ON public.layer_batches TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.layer_batches TO authenticated;

DROP POLICY IF EXISTS layer_batches_anon_select ON public.layer_batches;
CREATE POLICY layer_batches_anon_select
  ON public.layer_batches
  FOR SELECT
  TO anon
  USING (true);

DROP POLICY IF EXISTS layer_batches_authenticated_all ON public.layer_batches;
CREATE POLICY layer_batches_authenticated_all
  ON public.layer_batches
  FOR ALL
  TO authenticated
  USING (true)
  WITH CHECK (true);

-- ════════════════════════════════════════════════════════════════════
-- layer_housings — anon SELECT + column-scoped UPDATE on active rows;
-- authenticated full CRUD
-- ════════════════════════════════════════════════════════════════════

ALTER TABLE public.layer_housings ENABLE ROW LEVEL SECURITY;

-- Explicit grant matrix. Tear down table-wide write grants on anon
-- first, then grant only the two anchor columns. REVOKE-then-GRANT is
-- the documented pattern for narrowing privileges.
REVOKE ALL ON public.layer_housings FROM PUBLIC;
REVOKE INSERT, DELETE ON public.layer_housings FROM anon;
REVOKE UPDATE ON public.layer_housings FROM anon;
GRANT SELECT ON public.layer_housings TO anon;
GRANT UPDATE (current_count, current_count_date) ON public.layer_housings TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.layer_housings TO authenticated;

DROP POLICY IF EXISTS layer_housings_anon_select ON public.layer_housings;
CREATE POLICY layer_housings_anon_select
  ON public.layer_housings
  FOR SELECT
  TO anon
  USING (true);

-- Update policy: row predicate scoped to active housings so a retired
-- housing cannot be anchor-updated by anon. Combined with the column
-- grant, anon can ONLY set current_count + current_count_date AND ONLY
-- on rows where status='active'.
DROP POLICY IF EXISTS layer_housings_anon_update ON public.layer_housings;
CREATE POLICY layer_housings_anon_update
  ON public.layer_housings
  FOR UPDATE
  TO anon
  USING (status = 'active')
  WITH CHECK (status = 'active');

DROP POLICY IF EXISTS layer_housings_authenticated_all ON public.layer_housings;
CREATE POLICY layer_housings_authenticated_all
  ON public.layer_housings
  FOR ALL
  TO authenticated
  USING (true)
  WITH CHECK (true);

-- ════════════════════════════════════════════════════════════════════
-- Backup snapshots — RLS on, NO policies, anon+authenticated+PUBLIC
-- grants revoked. service_role keeps bypass-on-bypass access for
-- restore work. Each statement is guarded via to_regclass so a TEST
-- project that never received a given snapshot does not fail the apply.
-- ════════════════════════════════════════════════════════════════════

DO $$
DECLARE
  t text;
  backups text[] := ARRAY[
    '_backup_app_store',
    '_backup_app_store_apr11_brooderin',
    '_backup_app_store_apr11_brooderin_v3',
    '_backup_app_store_apr11_feedcost',
    '_backup_egg_dailys',
    '_backup_layer_batches',
    '_backup_layer_batches_apr11_2026',
    '_backup_layer_batches_apr11_feedcost',
    '_backup_layer_batches_apr11_l2601',
    '_backup_layer_batches_apr11_phase2',
    '_backup_layer_dailys',
    '_backup_layer_dailys_apr11_batchid',
    '_backup_layer_dailys_apr11_batchid_v2',
    '_backup_layer_dailys_apr11_podio_insert',
    '_backup_layer_housings',
    '_backup_layer_housings_apr11_l2601',
    '_backup_layer_housings_apr11pm',
    '_backup_webform_config'
  ];
BEGIN
  FOREACH t IN ARRAY backups LOOP
    IF to_regclass('public.' || quote_ident(t)) IS NOT NULL THEN
      EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
      EXECUTE format('REVOKE ALL ON public.%I FROM PUBLIC', t);
      EXECUTE format('REVOKE ALL ON public.%I FROM anon, authenticated', t);
    END IF;
  END LOOP;
END
$$;

COMMIT;
