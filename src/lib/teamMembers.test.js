import {describe, it, expect, vi} from 'vitest';
import {
  newRosterId,
  normalizeRoster,
  activeNames,
  allNames,
  findByName,
  findById,
  addMember,
  setActive,
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

  it('converts legacy string[] to object[] with minted ids', () => {
    const out = normalizeRoster(['BMAN', 'BRIAN']);
    expect(out).toHaveLength(2);
    expect(out.every((e) => e.id.startsWith('tm-'))).toBe(true);
    expect(out.every((e) => e.active === true)).toBe(true);
    expect(out.map((e) => e.name).sort()).toEqual(['BMAN', 'BRIAN']);
  });

  it('preserves canonical object[] shape', () => {
    const input = [
      {id: 'tm-a', name: 'BMAN', active: true},
      {id: 'tm-b', name: 'OLDGUY', active: false},
    ];
    const out = normalizeRoster(input);
    expect(out).toEqual([
      {id: 'tm-a', name: 'BMAN', active: true},
      {id: 'tm-b', name: 'OLDGUY', active: false},
    ]);
  });

  it('alpha-sorts by name', () => {
    const out = normalizeRoster([
      {id: 'tm-1', name: 'ZED', active: true},
      {id: 'tm-2', name: 'ALICE', active: true},
      {id: 'tm-3', name: 'BOB', active: true},
    ]);
    expect(out.map((e) => e.name)).toEqual(['ALICE', 'BOB', 'ZED']);
  });

  it('mints id if missing on object entry', () => {
    const out = normalizeRoster([{name: 'BMAN', active: true}]);
    expect(out).toHaveLength(1);
    expect(out[0].id).toMatch(/^tm-/);
  });

  it('drops object entries with missing/empty name', () => {
    const out = normalizeRoster([
      {id: 'tm-a', name: '', active: true},
      {id: 'tm-b', active: true},
      {id: 'tm-c', name: 'BMAN', active: true},
    ]);
    expect(out).toHaveLength(1);
    expect(out[0].name).toBe('BMAN');
  });

  it('drops empty/whitespace-only legacy strings', () => {
    expect(normalizeRoster(['', '   ', 'BMAN'])).toHaveLength(1);
  });

  it('defaults active to true when missing on object entry', () => {
    const out = normalizeRoster([{id: 'tm-a', name: 'BMAN'}]);
    expect(out[0].active).toBe(true);
  });

  it('only flips active false on explicit false', () => {
    const out = normalizeRoster([
      {id: 'tm-a', name: 'A', active: false},
      {id: 'tm-b', name: 'B', active: 0}, // truthy-ish bug — treated as true (default)
      {id: 'tm-c', name: 'C', active: null},
    ]);
    // Only explicit `false` flips. null/0/missing → true.
    expect(out.find((e) => e.name === 'A').active).toBe(false);
    expect(out.find((e) => e.name === 'B').active).toBe(true);
    expect(out.find((e) => e.name === 'C').active).toBe(true);
  });

  it('dedupes by id (case-sensitive); first instance wins', () => {
    const out = normalizeRoster([
      {id: 'tm-a', name: 'First', active: true},
      {id: 'tm-a', name: 'Second', active: false},
    ]);
    expect(out).toHaveLength(1);
    expect(out[0].name).toBe('First');
  });

  it('trims names', () => {
    const out = normalizeRoster([{id: 'tm-a', name: '  BMAN  ', active: true}]);
    expect(out[0].name).toBe('BMAN');
  });
});

describe('activeNames / allNames', () => {
  const roster = [
    {id: 'tm-a', name: 'ALICE', active: true},
    {id: 'tm-b', name: 'BOB', active: false},
    {id: 'tm-c', name: 'CARL', active: true},
  ];

  it('activeNames returns active-only sorted', () => {
    expect(activeNames(roster)).toEqual(['ALICE', 'CARL']);
  });

  it('allNames returns every name sorted', () => {
    expect(allNames(roster)).toEqual(['ALICE', 'BOB', 'CARL']);
  });

  it('activeNames also accepts legacy string[]', () => {
    expect(activeNames(['BMAN', 'BRIAN'])).toEqual(['BMAN', 'BRIAN']);
  });
});

describe('findByName / findById', () => {
  const roster = [
    {id: 'tm-a', name: 'ALICE', active: true},
    {id: 'tm-b', name: 'BOB', active: false},
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
  it('appends with minted id, active:true', () => {
    const next = addMember([], 'BMAN');
    expect(next).toHaveLength(1);
    expect(next[0]).toMatchObject({name: 'BMAN', active: true});
    expect(next[0].id).toMatch(/^tm-/);
  });

  it('throws on empty/whitespace name', () => {
    expect(() => addMember([], '')).toThrow();
    expect(() => addMember([], '   ')).toThrow();
  });

  it('throws on case-insensitive collision (active or inactive)', () => {
    const roster = [{id: 'tm-a', name: 'BMAN', active: true}];
    expect(() => addMember(roster, 'BMAN')).toThrow();
    expect(() => addMember(roster, 'bman')).toThrow();

    const inactiveRoster = [{id: 'tm-b', name: 'OLDGUY', active: false}];
    expect(() => addMember(inactiveRoster, 'OLDGUY')).toThrow();
    expect(() => addMember(inactiveRoster, 'oldguy')).toThrow();
  });

  it('keeps result alpha-sorted by name', () => {
    let r = addMember([], 'ZED');
    r = addMember(r, 'ALICE');
    r = addMember(r, 'BOB');
    expect(r.map((e) => e.name)).toEqual(['ALICE', 'BOB', 'ZED']);
  });
});

describe('setActive', () => {
  it('flips an entry active', () => {
    const roster = [{id: 'tm-a', name: 'BMAN', active: true}];
    expect(setActive(roster, 'tm-a', false)[0].active).toBe(false);
    expect(setActive(roster, 'tm-a', true)[0].active).toBe(true);
  });

  it('throws if id not found', () => {
    expect(() => setActive([], 'tm-zzz', false)).toThrow();
  });

  it('coerces truthy/falsy to boolean', () => {
    const roster = [{id: 'tm-a', name: 'BMAN', active: true}];
    expect(setActive(roster, 'tm-a', 0)[0].active).toBe(false);
    expect(setActive(roster, 'tm-a', 1)[0].active).toBe(true);
  });
});

describe('renameMember', () => {
  const roster = [
    {id: 'tm-a', name: 'ALICE', active: true},
    {id: 'tm-b', name: 'BOB', active: true},
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
  it('reads canonical team_roster when present', async () => {
    const sb = makeMockSb({
      rosterRow: {data: [{id: 'tm-a', name: 'BMAN', active: true}]},
    });
    const r = await loadRoster(sb);
    expect(r).toEqual([{id: 'tm-a', name: 'BMAN', active: true}]);
  });

  it('falls back to legacy team_members string[] when canonical missing', async () => {
    const sb = makeMockSb({rosterRow: null, legacyRow: {data: ['BMAN', 'BRIAN']}});
    const r = await loadRoster(sb);
    expect(r).toHaveLength(2);
    expect(r.every((e) => e.active === true)).toBe(true);
    expect(r.map((e) => e.name).sort()).toEqual(['BMAN', 'BRIAN']);
  });

  it('returns [] when both sources missing', async () => {
    const sb = makeMockSb();
    expect(await loadRoster(sb)).toEqual([]);
  });
});

describe('saveRoster', () => {
  it('writes both canonical + legacy mirror', async () => {
    const sb = makeMockSb();
    const next = [{id: 'tm-a', name: 'BMAN', active: true}];
    await saveRoster(sb, next);

    expect(sb._upserts).toHaveLength(2);
    expect(sb._upserts[0].row).toEqual({
      key: 'team_roster',
      data: [{id: 'tm-a', name: 'BMAN', active: true}],
    });
    expect(sb._upserts[1].row).toEqual({
      key: 'team_members',
      data: ['BMAN'], // active-name mirror
    });
  });

  it('legacy mirror excludes inactive names', async () => {
    const sb = makeMockSb();
    await saveRoster(sb, [
      {id: 'tm-a', name: 'BMAN', active: true},
      {id: 'tm-b', name: 'OLDGUY', active: false},
    ]);
    expect(sb._upserts[1].row.data).toEqual(['BMAN']);
  });

  it('merges with fresh DB state to avoid clobbering concurrent admin adds', async () => {
    const sb = makeMockSb({
      rosterRow: {
        data: [
          {id: 'tm-local', name: 'ALICE', active: true},
          {id: 'tm-concurrent', name: 'CONCURRENT', active: true}, // added by another tab
        ],
      },
    });
    // Local roster only knows about ALICE; doesn't have CONCURRENT.
    const localNext = [{id: 'tm-local', name: 'ALICE', active: true}];
    const persisted = await saveRoster(sb, localNext);

    // Persisted result must include the concurrent add — locked merge contract.
    expect(persisted.map((e) => e.id).sort()).toEqual(['tm-concurrent', 'tm-local']);
    expect(persisted.map((e) => e.name).sort()).toEqual(['ALICE', 'CONCURRENT']);
  });

  it('local intent wins over fresh on id collision (admin edit overrides)', async () => {
    const sb = makeMockSb({
      rosterRow: {data: [{id: 'tm-a', name: 'OLDNAME', active: true}]},
    });
    const localNext = [{id: 'tm-a', name: 'NEWNAME', active: true}];
    const persisted = await saveRoster(sb, localNext);
    expect(persisted).toEqual([{id: 'tm-a', name: 'NEWNAME', active: true}]);
  });

  it('throws on canonical write failure', async () => {
    const sb = makeMockSb({upsertResult: {error: {message: 'boom'}}});
    await expect(saveRoster(sb, [{id: 'tm-a', name: 'X', active: true}])).rejects.toThrow(/boom/);
  });

  // Codex regression — pre-commit 2026-04-29.
  it('first canonical save against legacy-only DB does NOT duplicate names (Codex regression)', async () => {
    // Prod state: only legacy team_members exists; team_roster missing.
    const sb = makeMockSb({rosterRow: null, legacyRow: {data: ['Ronnie', 'Alex']}});

    // Admin loads — loadRoster mints random ids for the legacy names.
    const loaded = await loadRoster(sb);
    expect(loaded).toHaveLength(2);
    expect(loaded.map((e) => e.name).sort()).toEqual(['Alex', 'Ronnie']);
    expect(loaded.every((e) => e.active === true)).toBe(true);
    expect(loaded.every((e) => e.id.startsWith('tm-'))).toBe(true);

    // Admin saves without changing names. The pre-fix bug: saveRoster's
    // legacy fallback would normalizeRoster again, mint NEW random ids
    // for Ronnie + Alex, and the id-based merge would keep all four
    // entries (2x Ronnie, 2x Alex). Post-fix: first canonical save skips
    // the legacy fallback entirely.
    const persisted = await saveRoster(sb, loaded);

    // Persisted roster: exactly 2 entries, one per name.
    expect(persisted).toHaveLength(2);
    expect(persisted.map((e) => e.name).sort()).toEqual(['Alex', 'Ronnie']);
    expect(persisted.every((e) => e.active === true)).toBe(true);

    // The ids should match what loadRoster minted — local wins.
    const loadedIds = loaded.map((e) => e.id).sort();
    const persistedIds = persisted.map((e) => e.id).sort();
    expect(persistedIds).toEqual(loadedIds);

    // Verify the upserts: canonical roster + legacy mirror, both
    // de-duplicated.
    const canonicalUpsert = sb._upserts.find((u) => u.row.key === 'team_roster');
    expect(canonicalUpsert).toBeTruthy();
    expect(canonicalUpsert.row.data).toHaveLength(2);

    const mirrorUpsert = sb._upserts.find((u) => u.row.key === 'team_members');
    expect(mirrorUpsert).toBeTruthy();
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
      // Two calls differ even on the fallback path.
      expect(newRosterId()).not.toBe(id);
    } finally {
      Object.defineProperty(globalThis, 'crypto', {value: orig, configurable: true});
    }
  });
});
