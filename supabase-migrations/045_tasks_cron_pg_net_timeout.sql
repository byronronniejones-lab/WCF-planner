-- ============================================================================
-- Migration 045: tasks-cron pg_net delivery timeout bump (5s → 15s)
-- ----------------------------------------------------------------------------
-- 2026-05-05. Hardening follow-up to mig 039.
--
-- Phase B PROD P7 verification (2026-05-05) showed the daily 04:00 UTC fire's
-- net._http_response row was timed_out=true with status_code NULL — but
-- task_cron_runs proved the Edge Function had completed cleanly ~125 ms AFTER
-- pg_net's hard 5000 ms deadline expired. Function execution (Layer 3) was
-- healthy; only Layer 2 (pg_net delivery) was unhealthy.
--
-- This migration replaces public.invoke_tasks_cron() with the same definition
-- plus an explicit `timeout_milliseconds := 15000` arg on the net.http_post
-- call so Layer 2 can record the actual HTTP 200 on a slow cold-start day
-- instead of giving up before the function responds.
--
-- Contract preserved verbatim (PROJECT.md §7, mig 039):
--   - SECURITY DEFINER + SET search_path = public
--   - Reads TASKS_CRON_FUNCTION_URL / TASKS_CRON_SECRET /
--     TASKS_CRON_SERVICE_ROLE_KEY from vault.decrypted_secrets
--   - Posts {Authorization: Bearer <jwt>, x-cron-secret: <secret>,
--     Content-Type: application/json} headers + {"mode":"cron"} body
--   - Returns net.http_post request id (bigint)
--   - REVOKE ALL FROM PUBLIC/anon/authenticated; GRANT EXECUTE TO postgres
--
-- Idempotent: CREATE OR REPLACE on the function; REVOKE/GRANT re-asserted
-- (no-op when already correct).
-- ============================================================================

BEGIN;

CREATE OR REPLACE FUNCTION public.invoke_tasks_cron()
RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $invoke_tasks_cron$
DECLARE
  v_url    text;
  v_secret text;
  v_jwt    text;
  v_req_id bigint;
BEGIN
  SELECT decrypted_secret INTO v_url    FROM vault.decrypted_secrets WHERE name = 'TASKS_CRON_FUNCTION_URL';
  SELECT decrypted_secret INTO v_secret FROM vault.decrypted_secrets WHERE name = 'TASKS_CRON_SECRET';
  SELECT decrypted_secret INTO v_jwt    FROM vault.decrypted_secrets WHERE name = 'TASKS_CRON_SERVICE_ROLE_KEY';
  IF coalesce(length(v_url), 0) = 0 OR coalesce(length(v_secret), 0) = 0 OR coalesce(length(v_jwt), 0) = 0 THEN
    RAISE EXCEPTION 'invoke_tasks_cron: vault secret(s) missing/empty';
  END IF;
  SELECT net.http_post(
    url                  := v_url,
    headers              := jsonb_build_object(
                              'Authorization', 'Bearer ' || v_jwt,
                              'x-cron-secret', v_secret,
                              'Content-Type',  'application/json'
                            ),
    body                 := jsonb_build_object('mode','cron'),
    timeout_milliseconds := 15000
  ) INTO v_req_id;
  RETURN v_req_id;
END;
$invoke_tasks_cron$;

REVOKE ALL ON FUNCTION public.invoke_tasks_cron() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.invoke_tasks_cron() FROM anon;
REVOKE ALL ON FUNCTION public.invoke_tasks_cron() FROM authenticated;
GRANT EXECUTE ON FUNCTION public.invoke_tasks_cron() TO postgres;

COMMIT;
