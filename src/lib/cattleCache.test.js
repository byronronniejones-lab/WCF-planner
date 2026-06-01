import {describe, it, expect, beforeEach} from 'vitest';
import {loadCattleWeighInsCached, invalidateCattleWeighInsCache} from './cattleCache.js';

// ── Cold-Boot Readiness CP2 — weigh-ins read-failure visibility ──────────────
// Locks the throwOnError contract added so the Cattle Forecast loader can route
// a raced/errored cold-boot weigh-ins read through its bounded retry instead of
// silently caching [] (the "0 finish candidates until reload" symptom). The
// two-query pattern (weigh_in_sessions → weigh_ins) and the wcfSelectAll
// pagination contract are preserved; this only adds error surfacing.

// Minimal thenable Supabase query stub. Every chainable method returns `this`
// and awaiting resolves to the configured {data, error}. A fresh stub is built
// per sb.from() call (matching real PostgREST builders).
function query(result) {
  return {
    select() {
      return this;
    },
    eq() {
      return this;
    },
    in() {
      return this;
    },
    is() {
      return this;
    },
    order() {
      return this;
    },
    range() {
      return this;
    },
    then(resolve) {
      resolve(result);
    },
  };
}

function makeSb({sessions, weighIns}) {
  return {
    from(table) {
      if (table === 'weigh_in_sessions') return query(sessions);
      if (table === 'weigh_ins') return query(weighIns);
      throw new Error('unexpected table: ' + table);
    },
  };
}

const OK_SESSIONS = {data: [{id: 'sess-1'}], error: null};
const OK_WEIGH_INS = {
  data: [
    {id: 'w1', entered_at: '2026-05-01T12:00:00Z'},
    {id: 'w2', entered_at: '2026-05-04T12:00:00Z'},
  ],
  error: null,
};

describe('loadCattleWeighInsCached — read-failure visibility (CP2)', () => {
  beforeEach(() => {
    invalidateCattleWeighInsCache();
  });

  it('throws on a sessions read error when throwOnError is set', async () => {
    const sb = makeSb({sessions: {data: null, error: {message: 'boom'}}, weighIns: OK_WEIGH_INS});
    await expect(loadCattleWeighInsCached(sb, {throwOnError: true})).rejects.toThrow(/sessions/);
  });

  it('throws on a weigh_ins page read error when throwOnError is set', async () => {
    const sb = makeSb({sessions: OK_SESSIONS, weighIns: {data: null, error: {message: 'page down'}}});
    await expect(loadCattleWeighInsCached(sb, {throwOnError: true})).rejects.toThrow(/weigh_ins/);
  });

  it('does NOT poison the cache on a failed read — the next call reads fresh', async () => {
    const badSb = makeSb({sessions: {data: null, error: {message: 'boom'}}, weighIns: OK_WEIGH_INS});
    await expect(loadCattleWeighInsCached(badSb, {throwOnError: true})).rejects.toThrow();
    // A subsequent successful read must return real rows, proving the failure
    // was never cached as an empty/poisoned result.
    const goodSb = makeSb({sessions: OK_SESSIONS, weighIns: OK_WEIGH_INS});
    const rows = await loadCattleWeighInsCached(goodSb, {throwOnError: true});
    expect(rows.map((r) => r.id)).toEqual(['w2', 'w1']); // sorted entered_at desc
  });

  it('treats a genuinely empty farm (no cattle sessions) as a legit empty, not a failure', async () => {
    const sb = makeSb({sessions: {data: [], error: null}, weighIns: OK_WEIGH_INS});
    const rows = await loadCattleWeighInsCached(sb, {throwOnError: true});
    expect(rows).toEqual([]);
  });

  it('default callers keep the soft contract: a sessions error resolves to [] without throwing', async () => {
    const sb = makeSb({sessions: {data: null, error: {message: 'boom'}}, weighIns: OK_WEIGH_INS});
    const rows = await loadCattleWeighInsCached(sb);
    expect(rows).toEqual([]);
  });

  it('returns weigh-ins sorted newest-first on a clean read', async () => {
    const sb = makeSb({sessions: OK_SESSIONS, weighIns: OK_WEIGH_INS});
    const rows = await loadCattleWeighInsCached(sb);
    expect(rows.map((r) => r.id)).toEqual(['w2', 'w1']);
  });
});
