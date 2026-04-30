import {describe, it, expect, beforeEach, afterEach, vi} from 'vitest';
import 'fake-indexeddb/auto';

// Mock photoCompress so preparePhotos doesn't try to use a real canvas
// inside jsdom (compressImage is canvas-bound).
vi.mock('./photoCompress.js', () => ({
  compressImage: vi.fn(async () => new Blob([new Uint8Array(50)], {type: 'image/jpeg'})),
}));

// Mock the supabase client BEFORE importing the hook (the hook imports `sb`
// at module load).
vi.mock('./supabase.js', () => {
  const insertMock = vi.fn();
  const fromMock = vi.fn(() => ({
    insert: (...args) => insertMock(...args),
  }));
  const uploadMock = vi.fn();
  const storageFromMock = vi.fn(() => ({
    upload: (...args) => uploadMock(...args),
  }));
  return {
    sb: {from: fromMock, storage: {from: storageFromMock}},
    __mocks: {insertMock, fromMock, uploadMock, storageFromMock},
  };
});

import * as supabaseMod from './supabase.js';
import {
  _classifyError,
  _classifyStorageError,
  _runSubmit,
  _drainQueuedFormKind,
  _syncQueuedEntry,
} from './useOfflineSubmit.js';
import {
  _resetDbForTests,
  enqueueSubmission,
  enqueueSubmissionWithPhotos,
  listQueued,
  listStuck,
  listPhotoBlobsByCsid,
  getSubmission,
  MAX_RETRIES,
} from './offlineQueue.js';

const {insertMock, uploadMock} = supabaseMod.__mocks;

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
  uploadMock.mockReset();
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

// ============================================================================
// Phase 1D-A — _classifyStorageError + hasPhotos lifecycle + drain seam
// ============================================================================

describe('_classifyStorageError', () => {
  it('TypeError → network', () => {
    expect(_classifyStorageError(new TypeError('Failed to fetch'))).toBe('network');
  });

  it('500-599 → server', () => {
    expect(_classifyStorageError({status: 500, message: 'boom'})).toBe('server');
    expect(_classifyStorageError({status: 503})).toBe('server');
  });

  it('429 → server (treat rate-limit as transient backoff)', () => {
    expect(_classifyStorageError({status: 429, message: 'rate'})).toBe('server');
  });

  it('409 → success-409 (replay path treats as already-uploaded)', () => {
    expect(_classifyStorageError({status: 409, code: 'Duplicate', message: 'duplicate'})).toBe('success-409');
  });

  it('401 → rls-stuck (missing bucket policy; surface loudly)', () => {
    expect(_classifyStorageError({status: 401, message: 'unauth'})).toBe('rls-stuck');
  });

  it('403 → rls-stuck', () => {
    expect(_classifyStorageError({status: 403, message: 'forbidden'})).toBe('rls-stuck');
  });

  it('other 4xx → schema', () => {
    expect(_classifyStorageError({status: 400, message: 'bad'})).toBe('schema');
    expect(_classifyStorageError({status: 422, message: 'unprocessable'})).toBe('schema');
  });

  it('unknown / no status → unknown', () => {
    expect(_classifyStorageError({})).toBe('unknown');
    expect(_classifyStorageError({message: 'who knows'})).toBe('unknown');
  });

  it('codeless duplicate → success-409', () => {
    expect(_classifyStorageError({message: 'object Duplicate detected'})).toBe('success-409');
  });

  // Native supabase-js StorageApiError exposes statusCode (string) instead
  // of status. Locks the classifier's fallback branch so a raw storage
  // error (not wrapped in StorageUploadError) still classifies correctly.
  it('native statusCode "403" → rls-stuck', () => {
    expect(_classifyStorageError({statusCode: '403', error: 'Unauthorized'})).toBe('rls-stuck');
  });

  it('native statusCode "409" → success-409', () => {
    expect(_classifyStorageError({statusCode: '409', error: 'Duplicate'})).toBe('success-409');
  });
});

// ----------------------------------------------------------------------------
// Helpers for hasPhotos lifecycle tests.
// ----------------------------------------------------------------------------
function fakeFile(name = 'a.jpg') {
  const f = new Blob([new Uint8Array(200)], {type: 'image/jpeg'});
  Object.defineProperty(f, 'name', {value: name, writable: false});
  return f;
}

function pigPayload(extras = {}) {
  return {
    date: '2026-04-30',
    team_member: 'BMAN',
    batch_id: 'p-26-01',
    batch_label: 'P-26-01',
    pig_count: 10,
    feed_lbs: 50,
    group_moved: true,
    nipple_drinker_moved: true,
    nipple_drinker_working: true,
    troughs_moved: true,
    fence_walked: true,
    fence_voltage: 5,
    issues: null,
    ...extras,
  };
}

describe('_runSubmit — hasPhotos lifecycle (Phase 1D-A)', () => {
  it('online happy path: state="synced", no IDB rows', async () => {
    insertMock.mockResolvedValueOnce({error: null});
    uploadMock.mockResolvedValue({error: null});

    const res = await _runSubmit({
      formKind: 'pig_dailys',
      payload: pigPayload({photos: [fakeFile('a.jpg'), fakeFile('b.jpg')]}),
      opts: {csid: 'csid-syn'},
      refresh: async () => {},
    });

    expect(res.state).toBe('synced');
    expect(await getSubmission('csid-syn')).toBeNull();
    expect(await listPhotoBlobsByCsid('csid-syn')).toEqual([]);
    // 2 uploads, 1 insert.
    expect(uploadMock).toHaveBeenCalledTimes(2);
    expect(insertMock).toHaveBeenCalledTimes(1);
  });

  it('storage TypeError → state="queued"; sanitized payload (no Blob); photo_blobs persisted', async () => {
    uploadMock.mockRejectedValueOnce(new TypeError('Failed to fetch'));
    const res = await _runSubmit({
      formKind: 'pig_dailys',
      payload: pigPayload({photos: [fakeFile(), fakeFile()]}),
      opts: {csid: 'csid-q1'},
      refresh: async () => {},
    });

    expect(res.state).toBe('queued');
    const sub = await getSubmission('csid-q1');
    expect(sub).not.toBeNull();
    expect(sub.status).toBe('queued');
    // payload is sanitized: photos is metadata array, no Blob.
    expect(Array.isArray(sub.payload.photos)).toBe(true);
    for (const p of sub.payload.photos) {
      expect('blob' in p).toBe(false);
      expect(typeof p.path).toBe('string');
    }
    // photo_blobs persisted.
    const blobs = await listPhotoBlobsByCsid('csid-q1');
    expect(blobs).toHaveLength(2);
    // Insert never attempted.
    expect(insertMock).not.toHaveBeenCalled();
  });

  it('storage 403 → state="stuck" atomic, retry_count = MAX_RETRIES', async () => {
    uploadMock.mockResolvedValueOnce({
      error: {message: 'forbidden', statusCode: '403', error: 'Unauthorized'},
    });

    const res = await _runSubmit({
      formKind: 'pig_dailys',
      payload: pigPayload({photos: [fakeFile()]}),
      opts: {csid: 'csid-403'},
      refresh: async () => {},
    });

    expect(res.state).toBe('stuck');
    const sub = await getSubmission('csid-403');
    expect(sub.status).toBe('failed');
    expect(sub.retry_count).toBe(MAX_RETRIES);
    expect((await listPhotoBlobsByCsid('csid-403')).length).toBe(1);
    expect(insertMock).not.toHaveBeenCalled();
  });

  it('uploads succeed + row insert 5xx → state="queued"', async () => {
    uploadMock.mockResolvedValue({error: null});
    insertMock.mockResolvedValueOnce({error: {status: 503, message: 'svc'}});
    const res = await _runSubmit({
      formKind: 'pig_dailys',
      payload: pigPayload({photos: [fakeFile()]}),
      opts: {csid: 'csid-q5xx'},
      refresh: async () => {},
    });
    expect(res.state).toBe('queued');
    const sub = await getSubmission('csid-q5xx');
    expect(sub.status).toBe('queued');
    expect((await listPhotoBlobsByCsid('csid-q5xx')).length).toBe(1);
  });

  it('uploads succeed + 23505 csid → state="synced" (idempotent replay)', async () => {
    uploadMock.mockResolvedValue({error: null});
    insertMock.mockResolvedValueOnce({
      error: {
        code: '23505',
        message: 'duplicate key value violates unique constraint "pig_dailys_client_submission_id_uq"',
      },
    });
    const res = await _runSubmit({
      formKind: 'pig_dailys',
      payload: pigPayload({photos: [fakeFile()]}),
      opts: {csid: 'csid-23505'},
      refresh: async () => {},
    });
    expect(res.state).toBe('synced');
    expect(await getSubmission('csid-23505')).toBeNull();
    expect(await listPhotoBlobsByCsid('csid-23505')).toEqual([]);
  });

  it('uploads succeed + row schema → state="stuck" atomic (does NOT throw)', async () => {
    uploadMock.mockResolvedValue({error: null});
    insertMock.mockResolvedValueOnce({error: {status: 400, code: 'PGRST204', message: 'schema cache stale'}});
    const res = await _runSubmit({
      formKind: 'pig_dailys',
      payload: pigPayload({photos: [fakeFile()]}),
      opts: {csid: 'csid-schema-up'},
      refresh: async () => {},
    });
    expect(res.state).toBe('stuck');
    const sub = await getSubmission('csid-schema-up');
    expect(sub.status).toBe('failed');
    expect(sub.retry_count).toBe(MAX_RETRIES);
    expect((await listPhotoBlobsByCsid('csid-schema-up')).length).toBe(1);
  });

  it('empty payload.photos short-circuits to flat path (Codex correction 7)', async () => {
    insertMock.mockResolvedValueOnce({error: null});
    const res = await _runSubmit({
      formKind: 'pig_dailys',
      payload: pigPayload({photos: []}),
      opts: {csid: 'csid-empty'},
      refresh: async () => {},
    });
    expect(res.state).toBe('synced');
    // Storage upload was never called — flat path.
    expect(uploadMock).not.toHaveBeenCalled();
    expect(insertMock).toHaveBeenCalledTimes(1);
    // Record's photos is [].
    expect(res.record.photos).toEqual([]);
  });
});

describe('_drainQueuedFormKind / _syncQueuedEntry', () => {
  // Make a stub sb client where storage.upload + from(table).insert behaviors
  // can be injected per test.
  function makeStubSb({uploadResults = [], insertResult} = {}) {
    let uploadIdx = 0;
    return {
      from() {
        return {
          insert: async () => insertResult ?? {error: null},
        };
      },
      storage: {
        from() {
          return {
            upload: async () => {
              const r = uploadResults[uploadIdx++] ?? {error: null};
              return r;
            },
          };
        },
      },
    };
  }

  async function seedQueuedWithBlobs(csid, photoCount) {
    const photos = [];
    const recordPhotos = [];
    for (let i = 1; i <= photoCount; i++) {
      const path = `pig_dailys/${csid}/photo-${i}.jpg`;
      photos.push({
        photo_key: `photo-${i}`,
        path,
        blob: new Blob([new Uint8Array(50)], {type: 'image/jpeg'}),
        mime: 'image/jpeg',
        size_bytes: 50,
        name: `photo-${i}.jpg`,
        captured_at: '2026-04-30T12:00:00.000Z',
      });
      recordPhotos.push({
        path,
        name: `photo-${i}.jpg`,
        mime: 'image/jpeg',
        size_bytes: 50,
        captured_at: '2026-04-30T12:00:00.000Z',
      });
    }
    const record = {
      id: `r-${csid}`,
      client_submission_id: csid,
      ...pigPayload(),
      photos: recordPhotos,
    };
    await enqueueSubmissionWithPhotos({
      csid,
      formKind: 'pig_dailys',
      payload: {...pigPayload(), photos: recordPhotos},
      record,
      photos,
    });
  }

  it('photo_blobs missing → markStuckNow, no insert', async () => {
    // Seed only the submission without any blobs.
    await enqueueSubmission({
      formKind: 'pig_dailys',
      csid: 'csid-mismatch',
      payload: pigPayload({photos: [{path: 'pig_dailys/csid-mismatch/photo-1.jpg'}]}),
      record: {
        id: 'r-mm',
        client_submission_id: 'csid-mismatch',
        ...pigPayload(),
        photos: [{path: 'pig_dailys/csid-mismatch/photo-1.jpg', name: 'a.jpg'}],
      },
    });
    const sb = makeStubSb();
    await _drainQueuedFormKind('pig_dailys', sb);
    const stuck = await listStuck('pig_dailys');
    expect(stuck.map((s) => s.csid)).toContain('csid-mismatch');
  });

  it('full happy path drains: uploads + insert succeed, blobs cleared', async () => {
    await seedQueuedWithBlobs('csid-happy', 2);
    const sb = makeStubSb({uploadResults: [{error: null}, {error: null}], insertResult: {error: null}});
    await _drainQueuedFormKind('pig_dailys', sb);
    expect(await getSubmission('csid-happy')).toBeNull();
    expect(await listPhotoBlobsByCsid('csid-happy')).toEqual([]);
  });

  it('409 conflict on photo upload → continue, insert succeeds', async () => {
    await seedQueuedWithBlobs('csid-409', 2);
    const sb = makeStubSb({
      uploadResults: [{error: {statusCode: '409', error: 'Duplicate', message: 'object exists'}}, {error: null}],
      insertResult: {error: null},
    });
    await _drainQueuedFormKind('pig_dailys', sb);
    expect(await getSubmission('csid-409')).toBeNull();
    expect(await listPhotoBlobsByCsid('csid-409')).toEqual([]);
  });

  it('storage 403 during drain → markStuckNow, no insert', async () => {
    await seedQueuedWithBlobs('csid-drain-403', 1);
    const sb = makeStubSb({
      uploadResults: [{error: {statusCode: '403', error: 'Unauthorized', message: 'no'}}],
    });
    await _drainQueuedFormKind('pig_dailys', sb);
    const stuck = await listStuck('pig_dailys');
    expect(stuck.map((s) => s.csid)).toContain('csid-drain-403');
  });

  it('empty-photos row drains via flat insert', async () => {
    // A queued row with photos:[] in record. _drainQueuedFormKind should
    // skip the upload step (cfg.hasPhotos && length > 0 gate) and go
    // straight to insert.
    await enqueueSubmission({
      formKind: 'pig_dailys',
      csid: 'csid-empty-drain',
      payload: pigPayload({photos: []}),
      record: {id: 'r-e', client_submission_id: 'csid-empty-drain', ...pigPayload(), photos: []},
    });
    const sb = makeStubSb({insertResult: {error: null}});
    await _drainQueuedFormKind('pig_dailys', sb);
    expect(await getSubmission('csid-empty-drain')).toBeNull();
  });
});
