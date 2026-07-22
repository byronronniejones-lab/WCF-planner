import {beforeEach, describe, expect, it, vi} from 'vitest';
import {resetTestDatabase} from './reset.js';

// Fake admin client. Each op (TRUNCATE rpc, per-bucket list/remove) takes a
// fixed delay and stamps start/end so overlap is provable. Storage responses
// are per-bucket configurable so we can force list/remove failures.
//   storage: { '<bucket>': { list: (path)=>({data,error}), remove: ()=>({data,error}) } }
function makeClient({rpc = {error: null}, storage = {}, delay = 25} = {}) {
  const events = [];
  const timed = (label, produce) => {
    events.push({type: 'start', label, t: performance.now()});
    return new Promise((resolve, reject) =>
      setTimeout(() => {
        events.push({type: 'end', label, t: performance.now()});
        try {
          resolve(produce());
        } catch (err) {
          reject(err);
        }
      }, delay),
    );
  };
  const bucket = (name) => ({
    list: vi.fn((path = '') => timed(`list:${name}`, () => storage[name]?.list?.(path) ?? {data: [], error: null})),
    remove: vi.fn((paths) => timed(`remove:${name}`, () => storage[name]?.remove?.(paths) ?? {data: [], error: null})),
  });
  return {
    events,
    rpc: vi.fn(() => timed('rpc', () => ({error: rpc.error}))),
    storage: {from: vi.fn((name) => bucket(name))},
  };
}

// A bucket whose top level holds one object, so removal is actually reached.
const oneObjectBucket = (removeResult) => ({
  list: (path) => (path === '' ? {data: [{name: 'dir-1'}], error: null} : {data: [{name: 'file-1'}], error: null}),
  remove: () => removeResult,
});

beforeEach(() => {
  process.env.WCF_TEST_DATABASE = '1';
  process.env.VITE_SUPABASE_URL = 'http://test.local';
});

describe('resetTestDatabase concurrency', () => {
  it('runs TRUNCATE and both storage sweeps concurrently (all start before any ends)', async () => {
    const fake = makeClient();
    await resetTestDatabase(fake);
    const starts = fake.events.filter((e) => e.type === 'start');
    const ends = fake.events.filter((e) => e.type === 'end');
    expect(starts.map((e) => e.label).sort()).toEqual(['list:daily-photos', 'list:fuel-bills', 'rpc']);
    const lastStart = Math.max(...starts.map((e) => e.t));
    const firstEnd = Math.min(...ends.map((e) => e.t));
    expect(lastStart).toBeLessThan(firstEnd);
  });

  it('rejects when the TRUNCATE fails', async () => {
    const fake = makeClient({rpc: {error: {message: 'truncate boom'}}});
    await expect(resetTestDatabase(fake)).rejects.toThrow(/TRUNCATE failed: truncate boom/);
  });

  it('rejects when the fuel-bills list fails', async () => {
    const fake = makeClient({storage: {'fuel-bills': {list: () => ({data: null, error: {message: 'fb list down'}})}}});
    await expect(resetTestDatabase(fake)).rejects.toThrow(/fuel-bills list.*fb list down/);
  });

  it('rejects when the daily-photos list fails', async () => {
    const fake = makeClient({
      storage: {'daily-photos': {list: () => ({data: null, error: {message: 'dp list down'}})}},
    });
    await expect(resetTestDatabase(fake)).rejects.toThrow(/daily-photos list.*dp list down/);
  });

  it('rejects when object removal fails', async () => {
    const fake = makeClient({
      storage: {'fuel-bills': oneObjectBucket({data: null, error: {message: 'remove denied'}})},
    });
    await expect(resetTestDatabase(fake)).rejects.toThrow(/fuel-bills remove.*remove denied/);
  });

  it('one successful sweep does not mask the other sweep failing', async () => {
    // fuel-bills is clean/empty (succeeds); daily-photos list fails. Promise.all
    // must still surface the daily-photos failure.
    const fake = makeClient({
      storage: {'daily-photos': {list: () => ({data: null, error: {message: 'dp down'}})}},
    });
    await expect(resetTestDatabase(fake)).rejects.toThrow(/daily-photos list.*dp down/);
  });

  it('does not leak credentials in the storage error (only bucket + op + api message)', async () => {
    const fake = makeClient({storage: {'fuel-bills': {list: () => ({data: null, error: {message: 'boom'}})}}});
    const err = await resetTestDatabase(fake).catch((e) => e);
    expect(err.message).toContain('fuel-bills');
    expect(err.message).not.toMatch(/service_role|SUPABASE_SERVICE_ROLE_KEY|eyJ|Bearer/);
  });

  it('issues exactly one TRUNCATE naming only public tables with RESTART IDENTITY CASCADE', async () => {
    const fake = makeClient();
    await resetTestDatabase(fake);
    expect(fake.rpc).toHaveBeenCalledTimes(1);
    const [name, args] = fake.rpc.mock.calls[0];
    expect(name).toBe('exec_sql');
    expect(args.sql).toMatch(/^TRUNCATE TABLE public\./);
    expect(args.sql).toContain('RESTART IDENTITY CASCADE');
    expect(args.sql).not.toContain('storage.');
  });

  it('refuses to run when the test-database guard is not satisfied', async () => {
    process.env.WCF_TEST_DATABASE = '0';
    const fake = makeClient();
    await expect(resetTestDatabase(fake)).rejects.toThrow(/WCF_TEST_DATABASE/);
  });
});

// A client whose rpc distinguishes the TRUNCATE call from the diagnostic DO
// block by SQL content, so we can drive the lock-timeout path deterministically.
function lockTimeoutClient({truncateError, diagnosticSnapshot}) {
  const rpc = vi.fn(async (_name, args) => {
    if (/TRUNCATE TABLE/.test(args.sql)) return {error: truncateError};
    if (/pg_stat_activity/.test(args.sql)) return {error: {message: diagnosticSnapshot}};
    return {error: null};
  });
  return {
    rpc,
    storage: {
      from: () => ({list: async () => ({data: [], error: null}), remove: async () => ({data: [], error: null})}),
    },
    _rpc: rpc,
  };
}

describe('TRUNCATE lock diagnostic wiring', () => {
  it('on a lock timeout, captures the sanitized snapshot AND still rejects (fail closed)', async () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const fake = lockTimeoutClient({
      truncateError: {message: 'canceling statement due to statement timeout'},
      diagnosticSnapshot: 'TRUNCATE blocker snapshot: [pid=99 state=active rel=cattle mode=AccessShareLock]',
    });
    await expect(resetTestDatabase(fake)).rejects.toThrow(
      /TRUNCATE failed: canceling statement due to statement timeout/,
    );
    // Diagnostic ran (a second rpc for the DO block) and its snapshot was logged.
    expect(fake._rpc).toHaveBeenCalledTimes(2);
    const logged = errSpy.mock.calls.map((c) => c.join(' ')).join('\n');
    expect(logged).toMatch(/blocker snapshot.*pid=99/);
    errSpy.mockRestore();
  });

  it('does NOT run the diagnostic for a non-lock TRUNCATE error', async () => {
    const fake = lockTimeoutClient({
      truncateError: {message: 'permission denied for relation cattle'},
      diagnosticSnapshot: 'should-not-be-used',
    });
    await expect(resetTestDatabase(fake)).rejects.toThrow(/permission denied/);
    expect(fake._rpc).toHaveBeenCalledTimes(1); // TRUNCATE only, no diagnostic
  });
});
