import {beforeEach, describe, expect, it, vi} from 'vitest';
import {
  TRUNCATE_BLOCKER_DIAGNOSTIC_SQL,
  captureTruncateBlockerDiagnostic,
  isLockTimeoutError,
} from './truncateLockDiagnostic.js';

beforeEach(() => {
  process.env.WCF_TEST_DATABASE = '1';
  process.env.VITE_SUPABASE_URL = 'http://test.local';
});

describe('isLockTimeoutError', () => {
  it('matches statement/lock timeout and deadlock', () => {
    expect(isLockTimeoutError('canceling statement due to statement timeout')).toBe(true);
    expect(isLockTimeoutError('canceling statement due to lock timeout')).toBe(true);
    expect(isLockTimeoutError('deadlock detected')).toBe(true);
  });
  it('does not match unrelated TRUNCATE errors (diagnostic stays scoped)', () => {
    expect(isLockTimeoutError('permission denied for relation cattle')).toBe(false);
    expect(isLockTimeoutError('relation "foo" does not exist')).toBe(false);
    expect(isLockTimeoutError('')).toBe(false);
    expect(isLockTimeoutError(null)).toBe(false);
  });
});

describe('TRUNCATE_BLOCKER_DIAGNOSTIC_SQL redaction by construction', () => {
  it('reads only the blocker catalogs', () => {
    expect(TRUNCATE_BLOCKER_DIAGNOSTIC_SQL).toContain('pg_stat_activity');
    expect(TRUNCATE_BLOCKER_DIAGNOSTIC_SQL).toContain('pg_locks');
  });
  it('selects the requested sanitized fields', () => {
    for (const col of [
      'a.pid',
      'a.state',
      'a.wait_event',
      'a.application_name',
      'xact_start',
      'query_start',
      'l.mode',
    ]) {
      expect(TRUNCATE_BLOCKER_DIAGNOSTIC_SQL).toContain(col);
    }
  });
  it('never selects SQL text, credentials, user, or client address', () => {
    // The query column is the SQL text of the blocker — it can contain params,
    // JWTs, and application data, so it must never be read.
    expect(TRUNCATE_BLOCKER_DIAGNOSTIC_SQL).not.toMatch(/\ba\.query\b/);
    expect(TRUNCATE_BLOCKER_DIAGNOSTIC_SQL).not.toContain('usename');
    expect(TRUNCATE_BLOCKER_DIAGNOSTIC_SQL).not.toContain('client_addr');
    expect(TRUNCATE_BLOCKER_DIAGNOSTIC_SQL).not.toContain('query_start,'); // guard against `a.query, ...`
  });
  it('is read-only — no session kill or timeout change', () => {
    expect(TRUNCATE_BLOCKER_DIAGNOSTIC_SQL).not.toContain('pg_terminate_backend');
    expect(TRUNCATE_BLOCKER_DIAGNOSTIC_SQL).not.toContain('pg_cancel_backend');
    expect(TRUNCATE_BLOCKER_DIAGNOSTIC_SQL).not.toMatch(/SET\s+statement_timeout/i);
  });
});

describe('captureTruncateBlockerDiagnostic TEST-only enforcement', () => {
  it('hard-refuses against a production target', async () => {
    process.env.VITE_SUPABASE_URL = 'https://pzfujbjtayhkdlxiblwe.supabase.co';
    const client = {rpc: vi.fn()};
    await expect(captureTruncateBlockerDiagnostic(client)).rejects.toThrow(/production project ref/);
    expect(client.rpc).not.toHaveBeenCalled(); // refused BEFORE any query
  });

  it('hard-refuses when the test-db guard is off', async () => {
    process.env.WCF_TEST_DATABASE = '0';
    const client = {rpc: vi.fn()};
    await expect(captureTruncateBlockerDiagnostic(client)).rejects.toThrow(/WCF_TEST_DATABASE/);
    expect(client.rpc).not.toHaveBeenCalled();
  });

  it('returns the RAISEd snapshot text on TEST', async () => {
    const client = {
      rpc: vi.fn(async () => ({error: {message: 'TRUNCATE blocker snapshot: [pid=42 state=active ...]'}})),
    };
    const snap = await captureTruncateBlockerDiagnostic(client);
    expect(snap).toMatch(/blocker snapshot/);
    expect(client.rpc).toHaveBeenCalledWith('exec_sql', {sql: TRUNCATE_BLOCKER_DIAGNOSTIC_SQL});
  });
});
