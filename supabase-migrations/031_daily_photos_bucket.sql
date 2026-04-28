-- ============================================================================
-- Migration 031: daily-photos storage bucket (private)
-- ----------------------------------------------------------------------------
-- Initiative C Phase 1A — DB-only groundwork. Creates a NEW private storage
-- bucket for daily-report photos, separate from the existing
-- equipment-maintenance-docs bucket.
--
-- Bucket scope split (locked in plan packet):
--   * equipment-maintenance-docs (existing, mig 016/018) — public-readable;
--     anon INSERT permitted. Holds equipment manuals, admin docs, and
--     /fueling/<slug> webform photos.
--   * daily-photos (NEW, this migration) — PRIVATE. Anon INSERT permitted
--     for the public daily-report webforms. Reads are gated to authenticated
--     sessions via signed URLs (10-min expiry, mirroring fuel-bills bucket
--     pattern from migration 026). DB stores the storage path only — never
--     publicUrl.
--
-- Why split: §7's manuals-vs-documents principle (admin paperwork must not
-- leak onto operator-facing surfaces) extends to daily-report photos, which
-- may capture animal welfare context, employee identities, or other content
-- that shouldn't be public-readable like equipment manuals are.
--
-- ----------------------------------------------------------------------------
-- POLICY CAPTURE: NOT INCLUDED IN THIS MIGRATION (deliberately)
-- ----------------------------------------------------------------------------
-- The Phase 1A plan called for capturing existing webform-relevant prod
-- policies into migration history via DO-block idempotent CREATE POLICY.
-- Recon (2026-04-28 eve+) showed every policy from Ronnie's pg_policies
-- export is ALREADY captured in existing migration files (001, 009, 016,
-- 018, 024, 026). There's nothing to re-capture; restating them would be
-- duplicative noise in migration history.
--
-- The 3 hand-created prod tables (pig_dailys, poultry_dailys, layer_dailys
-- — see PROJECT.md §3) have NO policies in the export, indicating RLS is
-- likely disabled on them in prod. Per the "do not broaden anon
-- permissions" guardrail this migration deliberately does NOT add policies
-- to those tables. If a future build wants to enable RLS on them, that's
-- its own scoped change.
--
-- ----------------------------------------------------------------------------
-- Idempotent: bucket creation uses ON CONFLICT DO NOTHING. Policy creation
-- wraps each CREATE POLICY in a DO block that checks pg_policies first
-- (Postgres does not support CREATE POLICY IF NOT EXISTS).
-- ============================================================================

BEGIN;

-- ----------------------------------------------------------------------------
-- (1) Create the private daily-photos bucket
-- ----------------------------------------------------------------------------
INSERT INTO storage.buckets (id, name, public)
VALUES ('daily-photos', 'daily-photos', false)
ON CONFLICT (id) DO NOTHING;

-- ----------------------------------------------------------------------------
-- (2) Anon INSERT into daily-photos
-- ----------------------------------------------------------------------------
-- Public webforms (anon role) need to upload photos as part of the queued
-- submission flow. Scoped tightly to bucket_id='daily-photos' so this
-- policy can never grant write access to other buckets.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'storage'
      AND tablename = 'objects'
      AND policyname = 'daily_photos_anon_insert'
  ) THEN
    CREATE POLICY daily_photos_anon_insert ON storage.objects
      FOR INSERT TO anon
      WITH CHECK (bucket_id = 'daily-photos');
  END IF;
END $$;

-- ----------------------------------------------------------------------------
-- (3) Authenticated SELECT on daily-photos
-- ----------------------------------------------------------------------------
-- Admin views display daily-report photos via signed URLs generated against
-- an authenticated session. No anon SELECT — operators uploading anonymously
-- never need to read back their submissions; the queued submission flow
-- writes path-only to the DB row and surfaces success without a re-fetch.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'storage'
      AND tablename = 'objects'
      AND policyname = 'daily_photos_auth_select'
  ) THEN
    CREATE POLICY daily_photos_auth_select ON storage.objects
      FOR SELECT TO authenticated
      USING (bucket_id = 'daily-photos');
  END IF;
END $$;

-- ----------------------------------------------------------------------------
-- DELIBERATELY NOT ADDED:
--
--   * public SELECT on daily-photos — would expose all uploads to the open
--     web. Operator-context content stays private. Admin-context views
--     fetch via signed URL + authenticated SELECT.
--
--   * anon UPDATE / DELETE on daily-photos — operators submit-and-walk-away;
--     no client-side need to mutate their uploads. Admin can DELETE via the
--     existing service-role tooling if needed.
--
--   * authenticated UPDATE / DELETE on daily-photos — out of scope for v1.
--     Add if a future admin tool needs in-place edits or delete-cascade
--     when a daily-report row is deleted.
--
--   * anon UPDATE on equipment — recon (2026-04-28 eve+) proved this update
--     is silently failing in prod for ~6 active pieces (drift between
--     equipment.current_* and the latest fueling reading). Per the locked
--     plan, the offline queue replay does NOT retry this update. Equipment
--     reading reconciliation belongs in an admin/authenticated path, NOT
--     here. Tracked as a separate follow-up.
-- ----------------------------------------------------------------------------

COMMIT;
