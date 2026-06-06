-- Behavioral verification for migration 099 (psql path, used for PROD).
-- RAISEs (aborting with a nonzero exit under ON_ERROR_STOP=1) if the
-- authenticated-INSERT policy on the daily-photos bucket is missing.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
     WHERE schemaname='storage' AND tablename='objects'
           AND policyname='daily_photos_auth_insert'
  ) THEN
    RAISE EXCEPTION 'verify 099: daily_photos_auth_insert policy missing';
  END IF;

  RAISE NOTICE 'verify 099: ALL PASS (daily_photos_auth_insert present)';
END $$;
