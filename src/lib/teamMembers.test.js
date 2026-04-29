import {describe, it, expect} from 'vitest';
import {
  newRosterId,
  normalizeRoster,
  activeNames,
  findByName,
  findById,
  addMember,
  removeMember,
  renameMember,
  loadRoster,
  saveRoster,
} from './teamMembers.js';

describe('newRosterId', () => {
  it('returns a tm-prefixed string', () => {
    const id = newRosterId();
    expect(id).toMatch(/^tm-/);
  });

  it('two consecutive calls produce different ids', () => {
    expect(newRosterId()).not.toBe(newRosterId());
  });
});

describe('normalizeRoster', () => {
  it('returns [] for null/undefined/non-array', () => {
    expect(normalizeRoster(null)).toEqual([]);
    expect(normalizeRoster(undefined)).toEqual([]);
    expect(normalizeRoster({})).toEqual([]);
    expect(normalizeRoster('BMAN')).toEqual([]);
  });

  it('converts legacy string[] to object[] with minted ids and no active field', () => {
    const out = normalizeRoster(['BMAN', 'BRIAN']);
    expect(out).toHaveLength(2);
    expect(out.every((e) => e.id.startsWith('tm-'))).toBe(true);
    // No active field on the slim shape.
    expect(out.every((e) => !('active' in e))).toBe(true);
    expect(out.map((e) => e.name).sort()).toEqual(['BMAN', 'BRIAN']);
  });

  it('preserves canonical {id, name} shape', () => {
    const input = [
      {id: 'tm-a', name: 'BMAN'},
      {id: 'tm-b', name: 'BRIAN'},
    ];
    const out = normalizeRoster(input);
    expect(out).toEqual([
      {id: 'tm-a', name: 'BMAN'},
      {id: 'tm-b', name: 'BRIAN'},
    ]);
  });

  it('passively drops legacy {active: false} entries', () => {
    const out = normalizeRoster([
      {id: 'tm-a', name: 'BMAN', active: true},
      {id: 'tm-b', name: 'OLDGUY', active: false},
      {id: 'tm-c', name: 'BRIAN', active: true},
    ]);
    expect(out.map((e) => e.name)).toEqual(['BMAN', 'BRIAN']);
    // Active field stripped from output entries (lazy migration to slim shape).
    expect(out.every((e) => !('active' in e))).toBe(true);
  });

  it('keeps legacy {active: true} entries (active stripped from output)', () => {
    const out = normalizeRoster([{id: 'tm-a', name: 'BMAN', active: true}]);
    expect(out).toEqual([{id: 'tm-a', name: 'BMAN'}]);
  });

  it('only `active === false` (strict) drops the entry', () => {
    // `active: 0` / `null` / missing all stay (no soft-delete by truthiness).
    const out = normalizeRoster([
      {id: 'tm-a', name: 'A', active: false},
      {id: 'tm-b', name: 'B', active: 0},
      {id: 'tm-c', name: 'C', active: null},
      {id: 'tm-d', name: 'D'},
    ]);
    expect(out.map((e) => e.name)).toEqual(['B', 'C', 'D']);
  });

  it('alpha-sorts by name', () => {
    const out = normalizeRoster([
      {id: 'tm-1', name: 'ZED'},
      {id: 'tm-2', name: 'ALICE'},
      {id: 'tm-3', name: 'BOB'},
    ]);
    expect(out.map((e) => e.name)).toEqual(['ALICE', 'BOB', 'ZED']);
  });

  it('mints id if missing on object entry', () => {
    const out = normalizeRoster([{name: 'BMAN'}]);
    expect(out).toHaveLength(1);
    expect(out[0].id).toMatch(/^tm-/);
  });

  it('drops object entries with missing/empty name', () => {
    const out = normalizeRoster([{id: 'tm-a', name: ''}, {id: 'tm-b'}, {id: 'tm-c', name: 'BMAN'}]);
    expect(out).toHaveLength(1);
    expect(out[0].name).toBe('BMAN');
  });

  it('drops empty/whitespace-only legacy strings', () => {
    expect(normalizeRoster(['', '   ', 'BMAN'])).toHaveLength(1);
  });

  it('dedupes by id (case-sensitive); first instance wins', () => {
    const out = normalizeRoster([
      {id: 'tm-a', name: 'First'},
      {id: 'tm-a', name: 'Second'},
    ]);
    expect(out).toHaveLength(1);
    expect(out[0].name).toBe('First');
  });

  it('trims names', () => {
    const out = normalizeRoster([{id: 'tm-a', name: '  BMAN  '}]);
    expect(out[0].name).toBe('BMAN');
  });
});

describe('activeNames', () => {
  it('returns every visible name sorted', () => {
    const roster = [
      {id: 'tm-a', name: 'ALICE'},
      {id: 'tm-b', name: 'BOB'},
      {id: 'tm-c', name: 'CARL'},
    ];
    expect(activeNames(roster)).toEqual(['ALICE', 'BOB', 'CARL']);
  });

  it('drops legacy {active: false} entries', () => {
    const roster = [
      {id: 'tm-a', name: 'ALICE', active: true},
      {id: 'tm-b', name: 'BOB', active: false},
      {id: 'tm-c', name: 'CARL', active: true},
    ];
    expect(activeNames(roster)).toEqual(['ALICE', 'CARL']);
  });

  it('also accepts legacy string[]', () => {
    expect(activeNames(['BMAN', 'BRIAN'])).toEqual(['BMAN', 'BRIAN']);
  });
});

describe('findByName / findById', () => {
  const roster = [
    {id: 'tm-a', name: 'ALICE'},
    {id: 'tm-b', name: 'BOB'},
  ];

  it('findByName matches exact (trimmed) name', () => {
    expect(findByName(roster, 'ALICE').id).toBe('tm-a');
    expect(findByName(roster, '  ALICE  ').id).toBe('tm-a');
  });

  it('findByName returns null for missing/empty', () => {
    expect(findByName(roster, 'ZED')).toBeNull();
    expect(findByName(roster, '')).toBeNull();
    expect(findByName(roster, null)).toBeNull();
  });

  it('findById matches exact id', () => {
    expect(findById(roster, 'tm-b').name).toBe('BOB');
    expect(findById(roster, 'tm-zzz')).toBeNull();
  });
});

describe('addMember', () => {
  it('appends with minted id and slim shape (no active field)', () => {
    const next = addMember([], 'BMAN');
    expect(next).toHaveLength(1);
    expect(next[0]).toEqual({id: expect.stringMatching(/^tm-/), name: 'BMAN'});
    expect('active' in next[0]).toBe(false);
  });

  it('throws on empty/whitespace name', () => {
    expect(() => addMember([], '')).toThrow();
    expect(() => addMember([], '   ')).toThrow();
  });

  it('throws on case-insensitive collision against existing entry', () => {
    const roster = [{id: 'tm-a', name: 'BMAN'}];
    expect(() => addMember(roster, 'BMAN')).toThrow();
    expect(() => addMember(roster, 'bman')).toThrow();
  });

  it('keeps result alpha-sorted by name', () => {
    let r = addMember([], 'ZED');
    r = addMember(r, 'ALICE');
    r = addMember(r, 'BOB');
    expect(r.map((e) => e.name)).toEqual(['ALICE', 'BOB', 'ZED']);
  });
});

describe('removeMember', () => {
  it('returns roster minus the entry', () => {
    const roster = [
      {id: 'tm-a', name: 'ALICE'},
      {id: 'tm-b', name: 'BOB'},
    ];
    expect(removeMember(roster, 'tm-a')).toEqual([{id: 'tm-b', name: 'BOB'}]);
  });

  it('preserves alpha sort on remaining entries', () => {
    const roster = [
      {id: 'tm-a', name: 'ALICE'},
      {id: 'tm-b', name: 'BOB'},
      {id: 'tm-c', name: 'CARL'},
    ];
    expect(removeMember(roster, 'tm-b').map((e) => e.name)).toEqual(['ALICE', 'CARL']);
  });

  it('throws on unknown id', () => {
    expect(() => removeMember([], 'tm-zzz')).toThrow();
    expect(() => removeMember([{id: 'tm-a', name: 'X'}], 'tm-zzz')).toThrow();
  });

  it('passively-drops the entry being removed if it had active:false (idempotent)', () => {
    const roster = [
      {id: 'tm-a', name: 'ALICE', active: true},
      {id: 'tm-b', name: 'OLDGUY', active: false},
    ];
    // OLDGUY is already invisible after normalize. removeMember on tm-b throws
    // because the normalized roster doesn't contain it.
    expect(() => removeMember(roster, 'tm-b')).toThrow();
    // ALICE still works.
    expect(removeMember(roster, 'tm-a')).toEqual([]);
  });
});

describe('renameMember', () => {
  const roster = [
    {id: 'tm-a', name: 'ALICE'},
    {id: 'tm-b', name: 'BOB'},
  ];

  it('renames by id', () => {
    const next = renameMember(roster, 'tm-a', 'ALICE2');
    expect(next.find((e) => e.id === 'tm-a').name).toBe('ALICE2');
  });

  it('throws on empty new name', () => {
    expect(() => renameMember(roster, 'tm-a', '')).toThrow();
    expect(() => renameMember(roster, 'tm-a', '   ')).toThrow();
  });

  it('throws if id missing', () => {
    expect(() => renameMember(roster, 'tm-zzz', 'X')).toThrow();
  });

  it('throws on case-insensitive collision with another entry', () => {
    expect(() => renameMember(roster, 'tm-a', 'BOB')).toThrow();
    expect(() => renameMember(roster, 'tm-a', 'bob')).toThrow();
  });

  it('allows renaming to the same case-insensitive name (no-op-ish)', () => {
    const next = renameMember(roster, 'tm-a', 'alice');
    expect(next.find((e) => e.id === 'tm-a').name).toBe('alice');
  });

  it('preserves sort order after rename', () => {
    const next = renameMember(roster, 'tm-a', 'ZED');
    expect(next.map((e) => e.name)).toEqual(['BOB', 'ZED']);
  });
});

// ── Persistence helpers (mocked sb) ────────────────────────────────────────

function makeMockSb({rosterRow = null, legacyRow = null, upsertResult = {error: null}} = {}) {
  const upserts = [];
  function from(table) {
    if (table !== 'webform_config') throw new Error('unexpected table: ' + table);
    return {
      select: () => ({
        eq: (col, key) => ({
          maybeSingle: async () => {
            if (col !== 'key') throw new Error('unexpected col: ' + col);
            if (key === 'team_roster') return {data: rosterRow, error: null};
            if (key === 'team_members') return {data: legacyRow, error: null};
            return {data: null, error: null};
          },
        }),
      }),
      upsert: async (row, opts) => {
        upserts.push({row, opts});
        return upsertResult;
      },
    };
  }
  return {from, _upserts: upserts};
}

describe('loadRoster', () => {
  it('reads canonical team_roster when present (slim shape)', async () => {
    const sb = makeMockSb({
      rosterRow: {data: [{id: 'tm-a', name: 'BMAN'}]},
    });
    const r = await loadRoster(sb);
    expect(r).toEqual([{id: 'tm-a', name: 'BMAN'}]);
  });

  it('drops legacy {active: false} entries on read', async () => {
    const sb = makeMockSb({
      rosterRow: {
        data: [
          {id: 'tm-a', name: 'BMAN', active: true},
          {id: 'tm-b', name: 'OLDGUY', active: false},
        ],
      },
    });
    const r = await loadRoster(sb);
    expect(r).toEqual([{id: 'tm-a', name: 'BMAN'}]);
  });

  it('falls back to legacy team_members string[] when canonical missing', async () => {
    const sb = makeMockSb({rosterRow: null, legacyRow: {data: ['BMAN', 'BRIAN']}});
    const r = await loadRoster(sb);
    expect(r).toHaveLength(2);
    expect(r.every((e) => !('active' in e))).toBe(true);
    expect(r.map((e) => e.name).sort()).toEqual(['BMAN', 'BRIAN']);
  });

  it('returns [] when both sources missing', async () => {
    const sb = makeMockSb();
    expect(await loadRoster(sb)).toEqual([]);
  });
});

describe('saveRoster', () => {
  it('writes both canonical (slim shape) + legacy mirror (every name)', async () => {
    const sb = makeMockSb();
    const next = [{id: 'tm-a', name: 'BMAN'}];
    await saveRoster(sb, next);

    expect(sb._upserts).toHaveLength(2);
    expect(sb._upserts[0].row).toEqual({
      key: 'team_roster',
      data: [{id: 'tm-a', name: 'BMAN'}],
    });
    expect(sb._upserts[1].row).toEqual({
      key: 'team_members',
      data: ['BMAN'],
    });
  });

  it('legacy mirror lists every name (no active filter)', async () => {
    const sb = makeMockSb();
    await saveRoster(sb, [
      {id: 'tm-a', name: 'BMAN'},
      {id: 'tm-b', name: 'BRIAN'},
    ]);
    expect(sb._upserts[1].row.data).toEqual(['BMAN', 'BRIAN']);
  });

  it('strips legacy active field from the canonical write (passive migration)', async () => {
    const sb = makeMockSb();
    await saveRoster(sb, [{id: 'tm-a', name: 'BMAN', active: true}]);
    expect(sb._upserts[0].row.data).toEqual([{id: 'tm-a', name: 'BMAN'}]);
  });

  it('passive migration: dropping a legacy {active:false} entry removes it from canonical + mirror', async () => {
    const sb = makeMockSb({
      // Fresh DB still has the legacy active:false entry.
      rosterRow: {
        data: [
          {id: 'tm-a', name: 'BMAN', active: true},
          {id: 'tm-b', name: 'OLDGUY', active: false},
        ],
      },
    });
    // Local roster (post-load + edit) — OLDGUY already filtered by normalize.
    const localNext = [{id: 'tm-a', name: 'BMAN'}];
    const persisted = await saveRoster(sb, localNext);

    // Canonical write contains only BMAN — OLDGUY didn't survive normalize on the merge.
    expect(persisted).toEqual([{id: 'tm-a', name: 'BMAN'}]);
    // Legacy mirror reflects the same — only BMAN.
    expect(sb._upserts.find((u) => u.row.key === 'team_members').row.data).toEqual(['BMAN']);
  });

  it('merges with fresh DB state to avoid clobbering concurrent admin adds', async () => {
    const sb = makeMockSb({
      rosterRow: {
        data: [
          {id: 'tm-local', name: 'ALICE'},
          {id: 'tm-concurrent', name: 'CONCURRENT'},
        ],
      },
    });
    const localNext = [{id: 'tm-local', name: 'ALICE'}];
    const persisted = await saveRoster(sb, localNext);

    expect(persisted.map((e) => e.id).sort()).toEqual(['tm-concurrent', 'tm-local']);
    expect(persisted.map((e) => e.name).sort()).toEqual(['ALICE', 'CONCURRENT']);
  });

  it('removedIds prevents re-adding deleted entries from fresh on merge', async () => {
    // Fresh DB still has all 3 members (concurrent state at delete time).
    const sb = makeMockSb({
      rosterRow: {
        data: [
          {id: 'tm-alice', name: 'ALICE'},
          {id: 'tm-bob', name: 'BOB'},
          {id: 'tm-carl', name: 'CARL'},
        ],
      },
    });
    // Local roster = post-removeMember(tm-bob).
    const localNext = [
      {id: 'tm-alice', name: 'ALICE'},
      {id: 'tm-carl', name: 'CARL'},
    ];
    const persisted = await saveRoster(sb, localNext, {removedIds: ['tm-bob']});

    // tm-bob must NOT be re-added by the fresh-only loop.
    expect(persisted.map((e) => e.id).sort()).toEqual(['tm-alice', 'tm-carl']);
    expect(persisted.map((e) => e.name).sort()).toEqual(['ALICE', 'CARL']);

    // Mirror reflects the same.
    const mirror = sb._upserts.find((u) => u.row.key === 'team_members').row.data;
    expect(mirror).toEqual(['ALICE', 'CARL']);
  });

  it('removedIds accepts a Set as well as an array', async () => {
    const sb = makeMockSb({
      rosterRow: {data: [{id: 'tm-a', name: 'A'}]},
    });
    const persisted = await saveRoster(sb, [], {removedIds: new Set(['tm-a'])});
    expect(persisted).toEqual([]);
  });

  it('without removedIds, fresh-only entries are still preserved (concurrent add path)', async () => {
    // Concurrent admin in tab B added tm-c. Local doesn't have it.
    const sb = makeMockSb({
      rosterRow: {
        data: [
          {id: 'tm-a', name: 'A'},
          {id: 'tm-c', name: 'C'},
        ],
      },
    });
    const localNext = [{id: 'tm-a', name: 'A'}];
    const persisted = await saveRoster(sb, localNext);
    // tm-c preserved.
    expect(persisted.map((e) => e.id).sort()).toEqual(['tm-a', 'tm-c']);
  });

  it('local intent wins over fresh on id collision (admin edit overrides)', async () => {
    const sb = makeMockSb({
      rosterRow: {data: [{id: 'tm-a', name: 'OLDNAME'}]},
    });
    const localNext = [{id: 'tm-a', name: 'NEWNAME'}];
    const persisted = await saveRoster(sb, localNext);
    expect(persisted).toEqual([{id: 'tm-a', name: 'NEWNAME'}]);
  });

  it('throws on canonical write failure', async () => {
    const sb = makeMockSb({upsertResult: {error: {message: 'boom'}}});
    await expect(saveRoster(sb, [{id: 'tm-a', name: 'X'}])).rejects.toThrow(/boom/);
  });

  // Codex regression — pre-commit 2026-04-29.
  it('first canonical save against legacy-only DB does NOT duplicate names (Codex regression)', async () => {
    const sb = makeMockSb({rosterRow: null, legacyRow: {data: ['Ronnie', 'Alex']}});

    const loaded = await loadRoster(sb);
    expect(loaded).toHaveLength(2);
    expect(loaded.map((e) => e.name).sort()).toEqual(['Alex', 'Ronnie']);
    expect(loaded.every((e) => e.id.startsWith('tm-'))).toBe(true);

    const persisted = await saveRoster(sb, loaded);

    expect(persisted).toHaveLength(2);
    expect(persisted.map((e) => e.name).sort()).toEqual(['Alex', 'Ronnie']);

    const loadedIds = loaded.map((e) => e.id).sort();
    const persistedIds = persisted.map((e) => e.id).sort();
    expect(persistedIds).toEqual(loadedIds);

    const canonicalUpsert = sb._upserts.find((u) => u.row.key === 'team_roster');
    expect(canonicalUpsert.row.data).toHaveLength(2);

    const mirrorUpsert = sb._upserts.find((u) => u.row.key === 'team_members');
    expect(mirrorUpsert.row.data).toEqual(['Alex', 'Ronnie']);
  });
});

describe('crypto.randomUUID fallback', () => {
  it('still returns a tm-prefixed id when crypto.randomUUID is missing', () => {
    const orig = globalThis.crypto;
    Object.defineProperty(globalThis, 'crypto', {value: undefined, configurable: true});
    try {
      const id = newRosterId();
      expect(id).toMatch(/^tm-/);
      expect(newRosterId()).not.toBe(id);
    } finally {
      Object.defineProperty(globalThis, 'crypto', {value: orig, configurable: true});
    }
  });
});
