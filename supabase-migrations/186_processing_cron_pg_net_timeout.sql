-- ============================================================================
-- 186_processing_cron_pg_net_timeout.sql
-- ----------------------------------------------------------------------------
-- 2026-07-16. Hardening follow-up to mig 185, mirroring mig 045 (tasks-cron).
--
-- The first PROD invoke_processing_asana_cron() proof showed
-- net._http_response timed_out=true with status_code NULL: pg_net's default
-- 5000 ms deadline expired long before the comments-only traversal finishes
-- (a full sync_comments pass over ~110 linked tasks takes ~60-70 s).
--
-- This migration replaces public.invoke_processing_asana_cron() with the same
-- definition plus an explicit `timeout_milliseconds := 120000` on the
-- net.http_post call, so the hourly pg_cron fire can record the function's
-- actual HTTP 200 instead of aborting the delivery wait mid-run.
--
-- Contract preserved verbatim (mig 185):
--   - SECURITY DEFINER + SET search_path = public
--   - Reads PROCESSING_ASANA_CRON_FUNCTION_URL / PROCESSING_ASANA_CRON_SECRET /
--     PROCESSING_ASANA_CRON_SERVICE_ROLE_KEY from vault.decrypted_secrets at
--     CALL time (btrim-hardened; fails closed when missing/empty)
--   - Posts {mode:'cron'} with Bearer + x-cron-secret headers
--   - Returns the net.http_post request id (bigint)
--   - REVOKE ALL FROM PUBLIC/anon/authenticated; GRANT EXECUTE TO postgres
--
-- Idempotent: CREATE OR REPLACE; grants re-asserted.
-- NO BEGIN/COMMIT (TEST applies via exec_sql; PROD via psql --single-transaction).
-- ============================================================================

CREATE OR REPLACE FUNCTION public.invoke_processing_asana_cron()
RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_url    text;
  v_secret text;
  v_jwt    text;
  v_req_id bigint;
BEGIN
  -- Trim at call time: paste-deploy of a Vault secret often picks up a trailing
  -- newline/space, which would corrupt the Bearer header. NULLIF(btrim(...),'')
  -- also collapses a whitespace-only secret to NULL so the guard below fires.
  SELECT NULLIF(btrim(decrypted_secret), '') INTO v_url
    FROM vault.decrypted_secrets WHERE name = 'PROCESSING_ASANA_CRON_FUNCTION_URL';
  SELECT NULLIF(btrim(decrypted_secret), '') INTO v_secret
    FROM vault.decrypted_secrets WHERE name = 'PROCESSING_ASANA_CRON_SECRET';
  SELECT NULLIF(btrim(decrypted_secret), '') INTO v_jwt
    FROM vault.decrypted_secrets WHERE name = 'PROCESSING_ASANA_CRON_SERVICE_ROLE_KEY';
  IF v_url IS NULL OR v_secret IS NULL OR v_jwt IS NULL THEN
    RAISE EXCEPTION 'invoke_processing_asana_cron: vault secret(s) missing/empty';
  END IF;
  SELECT net.http_post(
    url                  := v_url,
    headers              := jsonb_build_object(
                              'Authorization', 'Bearer ' || v_jwt,
                              'x-cron-secret', v_secret,
                              'Content-Type',  'application/json'
                            ),
    body                 := jsonb_build_object('mode','cron'),
    -- A full comments-only pass over ~110 linked tasks runs ~60-70 s; 120 s
    -- lets pg_net record the real terminal status on a slow day instead of
    -- aborting the delivery wait mid-run.
    timeout_milliseconds := 120000
  ) INTO v_req_id;
  RETURN v_req_id;
END
$fn$;

REVOKE ALL ON FUNCTION public.invoke_processing_asana_cron() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.invoke_processing_asana_cron() TO postgres;

-- ============================================================================
-- End of 186_processing_cron_pg_net_timeout.sql
-- ============================================================================
