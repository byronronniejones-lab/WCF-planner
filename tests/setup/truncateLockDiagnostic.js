import {assertTestDatabase} from './assertTestDatabase.js';

// ============================================================================
// TRUNCATE lock diagnostic (TEST-only, sanitized, non-destructive)
// ============================================================================
// When resetTestDatabase's TRUNCATE fails with a statement/lock timeout, the
// cause is almost always another session holding a conflicting lock on a
// truncated table (e.g. a lingering ACCESS SHARE from the previous test's app
// query while TRUNCATE wants ACCESS EXCLUSIVE). This captures a one-shot
// sanitized snapshot of the blocking sessions so the cause is evidence, not
// inference.
//
// Hard limits:
//   • TEST-ONLY — refuses unless assertTestDatabase passes (WCF_TEST_DATABASE=1
//     and the URL is not the prod project ref).
//   • Read-only snapshot. It never terminates a session (no pg_terminate_backend)
//     and never changes a server setting (no SET statement_timeout).
//   • Redacted BY CONSTRUCTION: the query selects only infrastructure columns
//     (pid, state, wait event, ages, application_name, relation, lock mode). It
//     NEVER selects a.query (the SQL text), query parameters, usename, or
//     client_addr, so no SQL, secrets, DSNs, JWTs, or application data leave.

// Fires only for the lock/timeout conditions — not for arbitrary TRUNCATE
// errors, so the diagnostic query cannot run on unrelated failures.
export function isLockTimeoutError(message) {
  return /canceling statement due to (statement|lock) timeout|deadlock detected/i.test(String(message || ''));
}

// exec_sql returns void (cannot return rows), so the snapshot is assembled
// server-side and delivered as a single RAISEd message via error.message.
export const TRUNCATE_BLOCKER_DIAGNOSTIC_SQL = `DO $$
DECLARE rec record; msg text := 'TRUNCATE blocker snapshot:'; cnt int := 0;
BEGIN
  FOR rec IN
    SELECT a.pid,
           a.state,
           a.wait_event_type AS wet,
           a.wait_event      AS we,
           a.application_name AS app,
           round(extract(epoch FROM (now() - a.xact_start)))::text  AS xact_age,
           round(extract(epoch FROM (now() - a.query_start)))::text AS query_age,
           c.relname AS rel,
           l.mode    AS lock_mode
    FROM pg_stat_activity a
    LEFT JOIN pg_locks l ON l.pid = a.pid AND l.locktype = 'relation'
    LEFT JOIN pg_class c ON c.oid = l.relation AND c.relnamespace = 'public'::regnamespace
    WHERE a.pid <> pg_backend_pid()
      AND a.datname = current_database()
      AND a.state IN ('active', 'idle in transaction')
    ORDER BY a.xact_start NULLS LAST
    LIMIT 5
  LOOP
    cnt := cnt + 1;
    msg := msg || format(
      ' [pid=%s state=%s wait=%s/%s app=%s xactAgeS=%s queryAgeS=%s rel=%s mode=%s]',
      rec.pid, rec.state, coalesce(rec.wet, '-'), coalesce(rec.we, '-'), coalesce(rec.app, '-'),
      coalesce(rec.xact_age, '-'), coalesce(rec.query_age, '-'), coalesce(rec.rel, '-'), coalesce(rec.lock_mode, '-'));
  END LOOP;
  IF cnt = 0 THEN
    msg := msg || ' (no active / idle-in-transaction sessions at snapshot)';
  END IF;
  RAISE EXCEPTION '%', msg;
END $$;`;

// Capture the sanitized blocker snapshot. Returns the snapshot text, or null if
// it could not be taken. Refuses (throws) against a non-test target.
export async function captureTruncateBlockerDiagnostic(client) {
  assertTestDatabase(process.env.VITE_SUPABASE_URL || '');
  const {error} = await client.rpc('exec_sql', {sql: TRUNCATE_BLOCKER_DIAGNOSTIC_SQL});
  // The snapshot is delivered as the RAISEd error.message. A null error would
  // mean the RAISE did not fire (unexpected) — treat as no snapshot.
  return error?.message || null;
}
