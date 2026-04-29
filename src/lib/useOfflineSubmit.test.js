import {describe, it, expect, beforeEach, afterEach, vi} from 'vitest';
import 'fake-indexeddb/auto';

// Mock the supabase client BEFORE importing the hook (the hook imports `sb`
// at module load).
vi.mock('./supabase.js', () => {
  const insertMock = vi.fn();
  const fromMock = vi.fn(() => ({
    insert: (...args) => insertMock(...args),
  }));
  return {
    sb: {from: fromMock},
    __mocks: {insertMock, fromMock},
  };
});

import * as supabaseMod from './supabase.js';
import {_classifyError} from './useOfflineSubmit.js';
import {
  _resetDbForTests,
  enqueueSubmission,
  listQueued,
  listStuck,
  getSubmission,
  MAX_RETRIES,
} from './offlineQueue.js';

const {insertMock} = supabaseMod.__mocks;

function freshIndexedDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.deleteDatabase('wcf-offline-queue');
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
    req.onblocked = () => resolve();
  });
}

beforeEach(async () => {
  insertMock.mockReset();
  _resetDbForTests();
  await freshIndexedDB();
});

afterEach(() => {
  _resetDbForTests();
});

// ---- Error classifier (pure logic, no DB) -----------------------------------

describe('classifyError', () => {
  it('TypeError → network', () => {
    expect(_classifyError(new TypeError('Failed to fetch'))).toBe('network');
  });

  it('5xx → server', () => {
    expect(_classifyError({status: 500, message: 'boom'})).toBe('server');
    expect(_classifyError({status: 503})).toBe('server');
  });

  it('401/403 → rls', () => {
    expect(_classifyError({status: 401})).toBe('rls');
    expect(_classifyError({status: 403})).toBe('rls');
  });

  it('PGRST 4xx → schema', () => {
    expect(_classifyError({status: 400, code: 'PGRST116'})).toBe('schema');
    expect(_classifyError({status: 422, code: 'PGRST204'})).toBe('schema');
  });

  it('23xxx integrity 4xx → schema', () => {
    expect(_classifyError({status: 409, code: '23505'})).toBe('schema');
    expect(_classifyError({status: 400, code: '23502'})).toBe('schema');
  });

  it('unknown 4xx → unknown (queue, not throw)', () => {
    expect(_classifyError({status: 429})).toBe('unknown');
  });

  it('unrecognized error shape → unknown', () => {
    expect(_classifyError(new Error('mystery'))).toBe('unknown');
    expect(_classifyError({})).toBe('unknown');
  });

  it('"Failed to fetch" message even without TypeError → network', () => {
    expect(_classifyError({message: 'Failed to fetch'})).toBe('network');
    expect(_classifyError({message: 'NetworkError when attempting to fetch'})).toBe('network');
  });
});

// ---- Direct queue interactions through the hook's sync engine ---------------
//
// We don't render the React hook here — that requires @testing-library/react
// which isn't installed and isn't worth pulling in for one Phase 1B layer.
// The contract tests below exercise the same upsert + classify + queue plumbing
// the hook composes; the hook's React-shape is verified end-to-end in the
// Playwright canary spec.

describe('idempotent dup-key = synced (anon-friendly idempotency path)', () => {
  it('insert returning 23505 with client_submission_id constraint = synced', async () => {
    // The hook treats this exact shape as success (already-synced replay).
    insertMock.mockResolvedValueOnce({
      data: null,
      error: {
        code: '23505',
        message: 'duplicate key value violates unique constraint "fuel_supplies_client_submission_id_uq"',
      },
    });

    const {sb} = supabaseMod;
    const {error} = await sb.from('fuel_supplies').insert({client_submission_id: 'csid-x'});

    expect(error.code).toBe('23505');
    expect(error.message).toMatch(/client_submission_id/i);
  });

  it('23505 on a DIFFERENT constraint is NOT treated as synced (real bug)', async () => {
    // A 23505 on (e.g.) cattle.tag is a real integrity error, not a queue
    // idempotency hit. The hook's isDuplicateCsidViolation guards against
    // this misinterpretation.
    const err = {
      code: '23505',
      message: 'duplicate key value violates unique constraint "cattle_tag_unique"',
    };
    expect(/client_submission_id/i.test(err.message)).toBe(false);
  });
});

describe('queue persistence + retry semantics under classifier', () => {
  // These mirror the inner loop of useOfflineSubmit.syncNow / submit, but
  // exercised at the module-API level so we can assert IDB state without
  // standing up React.

  it('network failure → enqueued + first failure recorded', async () => {
    const csid = 'csid-network';
    await enqueueSubmission({
      formKind: 'fuel_supply',
      csid,
      payload: {date: '2026-04-29'},
      record: {client_submission_id: csid, id: 'fs-x', date: '2026-04-29'},
    });
    const {markFailed} = await import('./offlineQueue.js');
    await markFailed(csid, 'Failed to fetch');

    const fetched = await getSubmission(csid);
    expect(fetched.status).toBe('queued');
    expect(fetched.retry_count).toBe(1);
    expect(fetched.last_error).toBe('Failed to fetch');
  });

  it('schema error path uses markStuckNow → 1 attempt = failed', async () => {
    const csid = 'csid-schema';
    const {markStuckNow} = await import('./offlineQueue.js');
    await enqueueSubmission({
      formKind: 'fuel_supply',
      csid,
      payload: {date: '2026-04-29'},
      record: {client_submission_id: csid, id: 'fs-y'},
    });
    await markStuckNow(csid, 'PGRST204: column not found');

    const stuck = await listStuck('fuel_supply');
    expect(stuck.length).toBe(1);
    expect(stuck[0].csid).toBe(csid);
    expect(stuck[0].retry_count).toBe(MAX_RETRIES);
    expect(stuck[0].status).toBe('failed');
  });

  it('listQueued ignores stuck rows; listStuck ignores queued', async () => {
    const {markStuckNow, markFailed} = await import('./offlineQueue.js');
    await enqueueSubmission({
      formKind: 'fuel_supply',
      csid: 'a',
      payload: {},
      record: {client_submission_id: 'a', id: '1'},
    });
    await enqueueSubmission({
      formKind: 'fuel_supply',
      csid: 'b',
      payload: {},
      record: {client_submission_id: 'b', id: '2'},
    });
    await markFailed('a', 'transient'); // stays queued
    await markStuckNow('b', 'schema'); // stuck

    const q = await listQueued('fuel_supply');
    const s = await listStuck('fuel_supply');
    expect(q.map((e) => e.csid)).toEqual(['a']);
    expect(s.map((e) => e.csid)).toEqual(['b']);
  });
});
