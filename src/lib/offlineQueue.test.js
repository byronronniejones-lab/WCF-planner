import {describe, it, expect, beforeEach, afterEach} from 'vitest';
import 'fake-indexeddb/auto';

import {
  MAX_RETRIES,
  STALE_SYNCING_MS,
  enqueueSubmission,
  getSubmission,
  listByFormKind,
  listStuck,
  listQueued,
  markSyncing,
  markSynced,
  markFailed,
  recoverStaleSyncing,
  retrySubmission,
  discardSubmission,
  _resetDbForTests,
} from './offlineQueue.js';

function freshIndexedDB() {
  // fake-indexeddb's reset hook varies by version; the safe path is to
  // delete every database and drop the cached connection.
  return new Promise((resolve, reject) => {
    const req = indexedDB.deleteDatabase('wcf-offline-queue');
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
    req.onblocked = () => resolve();
  });
}

beforeEach(async () => {
  _resetDbForTests();
  await freshIndexedDB();
});

afterEach(() => {
  _resetDbForTests();
});

const sampleRecord = {
  id: 'fs-test-1',
  client_submission_id: 'csid-1',
  date: '2026-04-29',
  gallons: 5,
  fuel_type: 'diesel',
  destination: 'gas_can',
  team_member: 'BMAN',
  notes: null,
  source: 'webform',
};

function fixture(overrides = {}) {
  return {
    formKind: 'fuel_supply',
    csid: 'csid-1',
    payload: {date: '2026-04-29', gallons: 5},
    record: sampleRecord,
    ...overrides,
  };
}

describe('enqueueSubmission', () => {
  it('persists a queued entry keyed by csid', async () => {
    const e = await enqueueSubmission(fixture());
    expect(e.status).toBe('queued');
    expect(e.retry_count).toBe(0);
    expect(e.last_error).toBeNull();

    const fetched = await getSubmission('csid-1');
    expect(fetched).toMatchObject({csid: 'csid-1', form_kind: 'fuel_supply', status: 'queued'});
  });

  it('rejects when required fields are missing', async () => {
    await expect(enqueueSubmission({csid: 'x', record: {}})).rejects.toThrow();
    await expect(enqueueSubmission({formKind: 'fuel_supply', record: {}})).rejects.toThrow();
    await expect(enqueueSubmission({formKind: 'fuel_supply', csid: 'x'})).rejects.toThrow();
  });

  it('replays produce identical row state when re-enqueued with the same csid', async () => {
    await enqueueSubmission(fixture());
    await enqueueSubmission(fixture()); // re-enqueue same csid
    const all = await listByFormKind('fuel_supply');
    expect(all.length).toBe(1);
  });
});

describe('list helpers', () => {
  it('listByFormKind returns only entries for the kind', async () => {
    await enqueueSubmission(fixture({csid: 'a'}));
    await enqueueSubmission(fixture({csid: 'b'}));
    expect((await listByFormKind('fuel_supply')).length).toBe(2);
    expect((await listByFormKind('weigh_in')).length).toBe(0);
  });

  it('listQueued + listStuck partition by status', async () => {
    await enqueueSubmission(fixture({csid: 'a'}));
    await enqueueSubmission(fixture({csid: 'b'}));
    // burn b to stuck via 3 failures
    for (let i = 0; i < MAX_RETRIES; i++) await markFailed('b', `attempt ${i}`);

    const queued = await listQueued('fuel_supply');
    const stuck = await listStuck('fuel_supply');
    expect(queued.map((e) => e.csid)).toEqual(['a']);
    expect(stuck.map((e) => e.csid)).toEqual(['b']);
  });
});

describe('markSyncing', () => {
  it('flips status and stamps last_attempt_at', async () => {
    await enqueueSubmission(fixture());
    const before = Date.now();
    const e = await markSyncing('csid-1');
    expect(e.status).toBe('syncing');
    expect(e.last_attempt_at).toBeGreaterThanOrEqual(before);
  });

  it('returns null when the row does not exist', async () => {
    expect(await markSyncing('does-not-exist')).toBeNull();
  });
});

describe('markSynced', () => {
  it('removes the row outright', async () => {
    await enqueueSubmission(fixture());
    await markSynced('csid-1');
    expect(await getSubmission('csid-1')).toBeNull();
  });
});

describe('markFailed retry semantics', () => {
  it('increments retry_count and resets to queued under MAX_RETRIES', async () => {
    await enqueueSubmission(fixture());

    const r1 = await markFailed('csid-1', 'transient 1');
    expect(r1.retry_count).toBe(1);
    expect(r1.status).toBe('queued');
    expect(r1.last_error).toBe('transient 1');

    const r2 = await markFailed('csid-1', 'transient 2');
    expect(r2.retry_count).toBe(2);
    expect(r2.status).toBe('queued');
  });

  it(`marks failed/stuck after ${MAX_RETRIES} attempts`, async () => {
    await enqueueSubmission(fixture());
    for (let i = 0; i < MAX_RETRIES - 1; i++) {
      await markFailed('csid-1', `attempt ${i}`);
    }
    const final = await markFailed('csid-1', 'final boom');
    expect(final.retry_count).toBe(MAX_RETRIES);
    expect(final.status).toBe('failed');
    expect(final.last_error).toBe('final boom');
  });

  it('null/undefined error message is allowed (records as null)', async () => {
    await enqueueSubmission(fixture());
    const e = await markFailed('csid-1');
    expect(e.last_error).toBeNull();
  });
});

describe('retrySubmission (operator-driven)', () => {
  it('resets a stuck row back to queued with retry_count=0', async () => {
    await enqueueSubmission(fixture());
    for (let i = 0; i < MAX_RETRIES; i++) await markFailed('csid-1', 'x');
    expect((await getSubmission('csid-1')).status).toBe('failed');

    const retried = await retrySubmission('csid-1');
    expect(retried.status).toBe('queued');
    expect(retried.retry_count).toBe(0);
    expect(retried.last_error).toBeNull();
  });
});

describe('discardSubmission', () => {
  it('removes a stuck row outright', async () => {
    await enqueueSubmission(fixture());
    await discardSubmission('csid-1');
    expect(await getSubmission('csid-1')).toBeNull();
  });
});

describe('recoverStaleSyncing', () => {
  // Codex-flagged limbo bug: a row stuck in 'syncing' from a prior
  // tab/crash never gets retried (listQueued filters by 'queued', listStuck
  // by 'failed'). recoverStaleSyncing resets those rows back to 'queued'
  // before each sync pass.

  it('resets stale syncing rows back to queued (orphan from prior tab)', async () => {
    await enqueueSubmission(fixture({csid: 'orphan'}));
    await markSyncing('orphan');
    // Force the timestamp to be older than the threshold to simulate
    // a tab that died 60 seconds ago.
    const db = await (await import('./offlineQueue.js')).getDb();
    const entry = await db.get('submissions', 'orphan');
    entry.last_attempt_at = Date.now() - (STALE_SYNCING_MS + 5_000);
    await db.put('submissions', entry);

    const recovered = await recoverStaleSyncing('fuel_supply');
    expect(recovered).toEqual(['orphan']);
    expect((await getSubmission('orphan')).status).toBe('queued');
  });

  it('does NOT touch fresh syncing rows within the threshold (concurrent same-tab passes)', async () => {
    await enqueueSubmission(fixture({csid: 'fresh'}));
    await markSyncing('fresh'); // last_attempt_at = now

    const recovered = await recoverStaleSyncing('fuel_supply');
    expect(recovered).toEqual([]);
    expect((await getSubmission('fresh')).status).toBe('syncing');
  });

  it('does not bump retry_count (interrupted ≠ failed)', async () => {
    await enqueueSubmission(fixture({csid: 'orphan2'}));
    await markSyncing('orphan2');
    // Backdate the row past the threshold.
    const db = await (await import('./offlineQueue.js')).getDb();
    const e = await db.get('submissions', 'orphan2');
    e.last_attempt_at = Date.now() - (STALE_SYNCING_MS + 1_000);
    await db.put('submissions', e);

    await recoverStaleSyncing('fuel_supply');
    const after = await getSubmission('orphan2');
    expect(after.status).toBe('queued');
    expect(after.retry_count).toBe(0);
    expect(after.last_error).toBeNull();
  });

  it('respects the formKind filter — only recovers rows for the requested kind', async () => {
    await enqueueSubmission(fixture({csid: 'a', formKind: 'fuel_supply'}));
    await enqueueSubmission(fixture({csid: 'b', formKind: 'weigh_in'}));
    await markSyncing('a');
    await markSyncing('b');
    const db = await (await import('./offlineQueue.js')).getDb();
    for (const csid of ['a', 'b']) {
      const e = await db.get('submissions', csid);
      e.last_attempt_at = Date.now() - (STALE_SYNCING_MS + 1_000);
      await db.put('submissions', e);
    }

    const recovered = await recoverStaleSyncing('fuel_supply');
    expect(recovered).toEqual(['a']);
    expect((await getSubmission('a')).status).toBe('queued');
    expect((await getSubmission('b')).status).toBe('syncing');
  });

  it('accepts a custom staleAfterMs (covers smaller clocks for tests)', async () => {
    await enqueueSubmission(fixture({csid: 'tight'}));
    await markSyncing('tight');
    // 100ms wait then recover with 50ms threshold — should fire.
    await new Promise((r) => setTimeout(r, 110));
    const recovered = await recoverStaleSyncing('fuel_supply', {staleAfterMs: 50});
    expect(recovered).toEqual(['tight']);
  });
});
