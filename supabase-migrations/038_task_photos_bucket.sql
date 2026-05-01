-- ============================================================================
-- Migration 038: Tasks module v1 — task-photos storage bucket (private)
-- ----------------------------------------------------------------------------
-- DB-only build. Creates a NEW private storage bucket for completion photos
-- on Tasks v1 instances. Mirrors the daily-photos bucket shape (mig 031).
--
-- Bucket: task-photos
--   * public: false. No anon SELECT.
--   * Anon INSERT: NOT permitted in v1. Public task submission is one-shot
--     (Phase E mig 041 RPC) and does NOT capture a photo at submit time.
--     Photo is captured at COMPLETION by the authenticated assignee (Phase
--     D), not by the public submitter. So the only writer needed is
--     `authenticated`.
--   * Authenticated INSERT + SELECT permitted, scoped to bucket_id =
--     'task-photos'. Assignee uploads at completion; admin reads via
--     signed URL (10-min expiry, mirrors fuel-bills + daily-photos pattern).
--
-- Path scheme (locked in plan packet, owner: complete_task_instance RPC
-- in mig 040):
--   task-photos/<assignee_uid>/<instance_id>/photo.jpg
-- Deterministic; never overwritten because reopen is OUT OF SCOPE for v1.
-- DB stores the path on task_instances.completion_photo_path; reads use
-- signed URLs only — never publicUrl.
--
-- No anon UPDATE, no anon DELETE, no authenticated UPDATE / DELETE. The
-- absence of those policies makes the bucket effectively append-only from
-- the application surface; admin can DELETE via service-role tooling if
-- needed (e.g., a future task-archive cleanup script).
--
-- Idempotent: bucket creation uses ON CONFLICT DO NOTHING. Policy creation
-- wraps each CREATE POLICY in a DO block that checks pg_policies first
-- (Postgres has no CREATE POLICY IF NOT EXISTS).
-- ============================================================================

BEGIN;

-- ----------------------------------------------------------------------------
-- (1) Create the private task-photos bucket
-- ----------------------------------------------------------------------------
INSERT INTO storage.buckets (id, name, public)
VALUES ('task-photos', 'task-photos', false)
ON CONFLICT (id) DO NOTHING;

-- ----------------------------------------------------------------------------
-- (2) Authenticated INSERT into task-photos
-- ----------------------------------------------------------------------------
-- Assignee uploads completion photo from /my-tasks (Phase D). Scoped tightly
-- to bucket_id='task-photos' so this policy can never grant write access to
-- any other bucket.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
     WHERE schemaname = 'storage'
       AND tablename = 'objects'
       AND policyname = 'task_photos_auth_insert'
  ) THEN
    CREATE POLICY task_photos_auth_insert ON storage.objects
      FOR INSERT TO authenticated
      WITH CHECK (bucket_id = 'task-photos');
  END IF;
END $$;

-- ----------------------------------------------------------------------------
-- (3) Authenticated SELECT on task-photos
-- ----------------------------------------------------------------------------
-- Admin views display completion photos via signed URLs generated against
-- an authenticated session. Non-admin assignees only need to read their
-- OWN completed-task photos via the same path. RLS on task_instances
-- already gates which instance rows a non-admin can see; the bucket
-- policy is permissive within the bucket so a signed URL works.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
     WHERE schemaname = 'storage'
       AND tablename = 'objects'
       AND policyname = 'task_photos_auth_select'
  ) THEN
    CREATE POLICY task_photos_auth_select ON storage.objects
      FOR SELECT TO authenticated
      USING (bucket_id = 'task-photos');
  END IF;
END $$;

-- ----------------------------------------------------------------------------
-- DELIBERATELY NOT ADDED:
--   * public SELECT on task-photos — would expose all completion photos to
--     the open web. Same rationale as mig 031 daily-photos: admin-context
--     content stays private; signed URLs are the only read path.
--   * anon INSERT on task-photos — public task submission (Phase E) does
--     NOT include a photo. Capture happens at COMPLETION (Phase D) by an
--     authenticated assignee.
--   * anon / authenticated UPDATE / DELETE — reopen path is out of scope
--     for v1; deterministic completion path means no overwrite needed.
--     Admin scrubbing goes through service-role tooling.
-- ----------------------------------------------------------------------------

COMMIT;
