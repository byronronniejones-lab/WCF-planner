-- ============================================================================
-- 163_processing_attachments_storage.sql
-- Sub-lane 6 of the Processing finish-out: the private 'processing-attachments'
-- Storage bucket that the Asana attachment byte-copy path depends on.
--
-- ⚠️ STORAGE GATE — this migration is HELD. It is NOT applied to TEST or PROD
-- until Ronnie/Codex explicitly approve the Storage gate. Creating the bucket is
-- what turns on attachment byte-copy: the Edge action `attachment_backfill`
-- (and sync_once's attachment pass) currently no-op with an "upload skipped" log
-- because svc.storage.from('processing-attachments').upload(...) fails on the
-- missing bucket, and record_processing_attachment requires a NOT-NULL
-- storage_path. Applying this migration is the ONLY thing standing between the
-- (already-built, idempotent) importer and copying Asana attachment bytes.
--
-- Model: mirrors 073_comment_photos_storage_rls.sql, but SELECT is narrowed to
-- the Processing operational boundary (not all-authenticated).
--   • Private bucket (public = false) — reads go through signed URLs.
--   • Operational SELECT policy — ONLY farm_team / management / admin (via
--     public.profile_role(), the same boundary as _processing_require_operational)
--     may mint signed URLs for the read-only drawer attachment list. light /
--     equipment_tech / inactive get no read; no anon access. profile_role() is
--     granted to authenticated (mig 058) and is already used in RLS USING clauses
--     (e.g. 069/074 soft-delete policies).
--   • NO authenticated INSERT — attachment rows/objects are written ONLY by the
--     Edge importer under the service role (which bypasses RLS). In-app upload is
--     deferred; add an INSERT policy here when that ships.
--
-- Idempotent: ON CONFLICT DO NOTHING + policy existence guards (Postgres has no
-- CREATE POLICY IF NOT EXISTS).
-- ============================================================================

-- Private bucket for Asana-imported processing attachments.
INSERT INTO storage.buckets (id, name, public)
VALUES ('processing-attachments', 'processing-attachments', false)
ON CONFLICT (id) DO NOTHING;

-- Operational SELECT — only farm_team / management / admin may fetch signed URLs
-- for the read-only attachment list on a processing record. Mirrors the
-- _processing_require_operational() boundary. No anon access; no read for
-- light/equipment_tech/inactive (attachments are private; reads go through signed
-- URLs from an authenticated operational session).
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'storage'
      AND tablename = 'objects'
      AND policyname = 'processing_attachments_operational_select'
  ) THEN
    CREATE POLICY processing_attachments_operational_select ON storage.objects
      FOR SELECT TO authenticated
      USING (
        bucket_id = 'processing-attachments'
        AND public.profile_role() IN ('farm_team', 'management', 'admin')
      );
  END IF;
END $$;
