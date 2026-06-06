-- ============================================================================
-- 099_daily_photos_authenticated_insert.sql
-- ----------------------------------------------------------------------------
-- Phase 3 follow-up. The daily-report photo webforms are now login-required
-- (submitter locked to the signed-in user; roster teardown), so photo uploads
-- run as the authenticated role, not anon. Migration 031 granted only
-- daily_photos_anon_insert + daily_photos_auth_select on the daily-photos
-- bucket, so authenticated INSERTs fail RLS ("new row violates row-level
-- security policy"). This adds the missing authenticated INSERT policy,
-- mirroring the auth-insert grants already on fuel-bills / task-photos /
-- task-request-photos / comment-photos.
--
-- The anon INSERT policy (mig 031) is left in place; it is harmless and a
-- separate cleanup once no anon upload path remains.
--
-- Idempotent: DO-block guard on pg_policies (Postgres lacks CREATE POLICY IF
-- NOT EXISTS). No BEGIN/COMMIT, so this applies via exec_sql on TEST; PROD
-- runs it under psql --single-transaction.
--
-- Apply order: TEST first, PROD after explicit approval.
-- ============================================================================

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'storage'
      AND tablename = 'objects'
      AND policyname = 'daily_photos_auth_insert'
  ) THEN
    CREATE POLICY daily_photos_auth_insert ON storage.objects
      FOR INSERT TO authenticated
      WITH CHECK (bucket_id = 'daily-photos');
  END IF;
END $$;

-- ============================================================================
-- End of 099_daily_photos_authenticated_insert.sql
-- ============================================================================
