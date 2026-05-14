import {describe, it, expect} from 'vitest';
import {
  TEAM_AVAILABILITY_FORM_KEYS,
  normalizeAvailability,
  availableNamesFor,
  setHidden,
  cleanAvailabilityForDeletedId,
  loadAvailability,
  saveAvailability,
  dailysOrderIndex,
  sortByDailysOrder,
} from './teamAvailability.js';

const ROSTER = [
  {id: 'tm-alice', name: 'ALICE'},
  {id: 'tm-bob', name: 'BOB'},
  {id: 'tm-carl', name: 'CARL'},
];

describe('TEAM_AVAILABILITY_FORM_KEYS', () => {
  it('lists the 10 expected form keys (alphabetic for stable membership)', () => {
    expect(TEAM_AVAILABILITY_FORM_KEYS).toEqual([
      'add-feed',
      'broiler-dailys',
      'cattle-dailys',
      'egg-dailys',
      'fuel-supply',
      'layer-dailys',
      'pig-dailys',
      'sheep-dailys',
      'tasks-public',
      'weigh-ins',
    ]);
  });
});

describe('dailysOrderIndex / sortByDailysOrder — admin display ordering', () => {
  // Mirrors src/webforms/WebformHub.jsx tile sequence: Add Feed → Weigh-Ins
  // → Submit a Task → Broiler → Layer → Egg → Pig → Cattle → Sheep. Fuel
  // Supply is not on /dailys, so it sits at the end of the admin surfaces.
  const EXPECTED_FORM_KEY_ORDER = [
    'add-feed',
    'weigh-ins',
    'tasks-public',
    'broiler-dailys',
    'layer-dailys',
    'egg-dailys',
    'pig-dailys',
    'cattle-dailys',
    'sheep-dailys',
    'fuel-supply',
  ];

  it('assigns the same index to a formKey and its -webform alias', () => {
    expect(dailysOrderIndex('add-feed')).toBe(dailysOrderIndex('add-feed-webform'));
    expect(dailysOrderIndex('weigh-ins')).toBe(dailysOrderIndex('weighins-webform'));
    expect(dailysOrderIndex('tasks-public')).toBe(dailysOrderIndex('tasks-public-webform'));
    expect(dailysOrderIndex('fuel-supply')).toBe(dailysOrderIndex('fuel-supply-webform'));
  });

  it('returns a sentinel after-known index for unknown keys', () => {
    const known = dailysOrderIndex('sheep-dailys');
    const unknown = dailysOrderIndex('future-feature-form');
    expect(unknown).toBeGreaterThan(known);
  });

  it('sorts TEAM_AVAILABILITY_FORM_KEYS into the canonical /dailys order', () => {
    expect(sortByDailysOrder(TEAM_AVAILABILITY_FORM_KEYS)).toEqual(EXPECTED_FORM_KEY_ORDER);
  });

  it('sorts the stored webform IDs (PROD has 8) into the same /dailys order', () => {
    // PROD webform_config.full_config.webforms ids as of 2026-05-14. The
    // stored ordering is historical; this lane drives the displayed
    // ordering instead. tasks-public and fuel-supply have no entries in
    // the stored webforms list (availability-only).
    const storedIds = [
      'pig-dailys',
      'broiler-dailys',
      'layer-dailys',
      'egg-dailys',
      'add-feed-webform',
      'cattle-dailys',
      'sheep-dailys',
      'weighins-webform',
    ];
    expect(sortByDailysOrder(storedIds)).toEqual([
      'add-feed-webform',
      'weighins-webform',
      'broiler-dailys',
      'layer-dailys',
      'egg-dailys',
      'pig-dailys',
      'cattle-dailys',
      'sheep-dailys',
    ]);
  });

  it('uses the getKey extractor for arrays of objects (webformsConfig.webforms)', () => {
    const webforms = [
      {id: 'sheep-dailys', name: 'Sheep Daily Report'},
      {id: 'add-feed-webform', name: 'Add Feed Webform'},
      {id: 'cattle-dailys', name: 'Cattle Daily Report'},
    ];
    const sorted = sortByDailysOrder(webforms, (w) => w.id);
    expect(sorted.map((w) => w.id)).toEqual(['add-feed-webform', 'cattle-dailys', 'sheep-dailys']);
  });

  it('places unknown keys after known ones in stable original order', () => {
    const mixed = ['cattle-dailys', 'future-z', 'add-feed', 'future-a'];
    expect(sortByDailysOrder(mixed)).toEqual(['add-feed', 'cattle-dailys', 'future-z', 'future-a']);
  });

  it('does not mutate the input array', () => {
    const input = ['sheep-dailys', 'add-feed'];
    const copy = input.slice();
    sortByDailysOrder(input);
    expect(input).toEqual(copy);
  });
});

describe('normalizeAvailability', () => {
  it('returns {forms: {}} for null/undefined/non-object/array', () => {
    expect(normalizeAvailability(null)).toEqual({forms: {}});
    expect(normalizeAvailability(undefined)).toEqual({forms: {}});
    expect(normalizeAvailability('garbage')).toEqual({forms: {}});
    expect(normalizeAvailability(42)).toEqual({forms: {}});
    expect(normalizeAvailability([])).toEqual({forms: {}});
  });

  it('preserves a clean canonical shape', () => {
    const input = {
      forms: {
        'cattle-dailys': {hiddenIds: ['tm-bob']},
        'fuel-supply': {hiddenIds: []},
      },
    };
    expect(normalizeAvailability(input)).toEqual(input);
  });

  it('drops malformed per-form values', () => {
    const out = normalizeAvailability({
      forms: {
        'cattle-dailys': {hiddenIds: ['tm-a']},
        'sheep-dailys': null,
        'pig-dailys': 'garbage',
        'egg-dailys': [],
      },
    });
    expect(out).toEqual({forms: {'cattle-dailys': {hiddenIds: ['tm-a']}}});
  });

  it('filters non-string hiddenIds + dedupes', () => {
    const out = normalizeAvailability({
      forms: {
        'cattle-dailys': {hiddenIds: ['tm-a', null, 'tm-a', '', 'tm-b', 42]},
      },
    });
    expect(out.forms['cattle-dailys'].hiddenIds.sort()).toEqual(['tm-a', 'tm-b']);
  });

  it('coerces missing hiddenIds to []', () => {
    const out = normalizeAvailability({forms: {'cattle-dailys': {}}});
    expect(out).toEqual({forms: {'cattle-dailys': {hiddenIds: []}}});
  });
});

describe('availableNamesFor', () => {
  it('returns all active names when availability is empty', () => {
    expect(availableNamesFor('cattle-dailys', ROSTER, undefined)).toEqual(['ALICE', 'BOB', 'CARL']);
    expect(availableNamesFor('cattle-dailys', ROSTER, null)).toEqual(['ALICE', 'BOB', 'CARL']);
    expect(availableNamesFor('cattle-dailys', ROSTER, {forms: {}})).toEqual(['ALICE', 'BOB', 'CARL']);
  });

  it('hides matched ids for a form', () => {
    const av = {forms: {'cattle-dailys': {hiddenIds: ['tm-bob']}}};
    expect(availableNamesFor('cattle-dailys', ROSTER, av)).toEqual(['ALICE', 'CARL']);
  });

  it('per-form isolation: hidden on cattle-dailys still visible on sheep-dailys', () => {
    const av = {forms: {'cattle-dailys': {hiddenIds: ['tm-bob']}}};
    expect(availableNamesFor('sheep-dailys', ROSTER, av)).toEqual(['ALICE', 'BOB', 'CARL']);
    expect(availableNamesFor('fuel-supply', ROSTER, av)).toEqual(['ALICE', 'BOB', 'CARL']);
  });

  it('inactive entries are excluded regardless of availability', () => {
    const rosterWithInactive = [
      {id: 'tm-a', name: 'ALICE', active: true},
      {id: 'tm-b', name: 'OLDGUY', active: false},
    ];
    expect(availableNamesFor('cattle-dailys', rosterWithInactive, {forms: {}})).toEqual(['ALICE']);
  });

  it('orphan ids in hiddenIds are tolerated (no-op)', () => {
    const av = {forms: {'cattle-dailys': {hiddenIds: ['tm-orphan-no-match']}}};
    expect(availableNamesFor('cattle-dailys', ROSTER, av)).toEqual(['ALICE', 'BOB', 'CARL']);
  });

  it('unknown formKey → all active names', () => {
    const av = {forms: {'cattle-dailys': {hiddenIds: ['tm-bob']}}};
    expect(availableNamesFor('does-not-exist', ROSTER, av)).toEqual(['ALICE', 'BOB', 'CARL']);
  });
});

describe('setHidden', () => {
  it('hides an id (mints {hiddenIds: []} for new formKey)', () => {
    const out = setHidden({forms: {}}, 'cattle-dailys', 'tm-bob', true);
    expect(out).toEqual({forms: {'cattle-dailys': {hiddenIds: ['tm-bob']}}});
  });

  it('unhides an id', () => {
    const av = {forms: {'cattle-dailys': {hiddenIds: ['tm-bob', 'tm-carl']}}};
    const out = setHidden(av, 'cattle-dailys', 'tm-bob', false);
    expect(out.forms['cattle-dailys'].hiddenIds).toEqual(['tm-carl']);
  });

  it('hide+unhide is idempotent', () => {
    const av = {forms: {}};
    const a = setHidden(av, 'cattle-dailys', 'tm-bob', true);
    const b = setHidden(a, 'cattle-dailys', 'tm-bob', false);
    expect(b.forms['cattle-dailys'].hiddenIds).toEqual([]);
  });

  it('hiding the same id twice is idempotent (set semantics)', () => {
    let av = setHidden({forms: {}}, 'cattle-dailys', 'tm-bob', true);
    av = setHidden(av, 'cattle-dailys', 'tm-bob', true);
    expect(av.forms['cattle-dailys'].hiddenIds).toEqual(['tm-bob']);
  });

  it('does not mutate input', () => {
    const av = {forms: {'cattle-dailys': {hiddenIds: ['tm-bob']}}};
    const next = setHidden(av, 'cattle-dailys', 'tm-carl', true);
    expect(av.forms['cattle-dailys'].hiddenIds).toEqual(['tm-bob']);
    expect(next.forms['cattle-dailys'].hiddenIds.sort()).toEqual(['tm-bob', 'tm-carl']);
  });

  it('throws on missing formKey or id', () => {
    expect(() => setHidden({forms: {}}, '', 'tm-a', true)).toThrow();
    expect(() => setHidden({forms: {}}, 'cattle-dailys', '', true)).toThrow();
  });
});

describe('cleanAvailabilityForDeletedId', () => {
  it('strips id from every formKey hiddenIds', () => {
    const av = {
      forms: {
        'cattle-dailys': {hiddenIds: ['tm-x', 'tm-y']},
        'sheep-dailys': {hiddenIds: ['tm-x']},
        'fuel-supply': {hiddenIds: ['tm-z']},
      },
    };
    const out = cleanAvailabilityForDeletedId(av, 'tm-x');
    expect(out).toEqual({
      forms: {
        'cattle-dailys': {hiddenIds: ['tm-y']},
        'sheep-dailys': {hiddenIds: []},
        'fuel-supply': {hiddenIds: ['tm-z']},
      },
    });
  });

  it('preserves empty hiddenIds arrays (stable shape)', () => {
    const av = {forms: {'cattle-dailys': {hiddenIds: ['tm-x']}}};
    const out = cleanAvailabilityForDeletedId(av, 'tm-x');
    expect(out).toEqual({forms: {'cattle-dailys': {hiddenIds: []}}});
  });

  it('idempotent on already-cleaned input', () => {
    const av = {forms: {'cattle-dailys': {hiddenIds: ['tm-y']}}};
    const out1 = cleanAvailabilityForDeletedId(av, 'tm-x');
    const out2 = cleanAvailabilityForDeletedId(out1, 'tm-x');
    expect(out1).toEqual(out2);
  });

  it('handles empty availability gracefully', () => {
    expect(cleanAvailabilityForDeletedId({forms: {}}, 'tm-x')).toEqual({forms: {}});
    expect(cleanAvailabilityForDeletedId(null, 'tm-x')).toEqual({forms: {}});
  });

  it('throws on missing id', () => {
    expect(() => cleanAvailabilityForDeletedId({forms: {}}, '')).toThrow();
    expect(() => cleanAvailabilityForDeletedId({forms: {}}, null)).toThrow();
  });
});

// ── Persistence helpers (mocked sb) ────────────────────────────────────────

function makeMockSb({row = null, upsertResult = {error: null}} = {}) {
  const upserts = [];
  function from(table) {
    if (table !== 'webform_config') throw new Error('unexpected table: ' + table);
    return {
      select: () => ({
        eq: () => ({
          maybeSingle: async () => ({data: row, error: null}),
        }),
      }),
      upsert: async (rowToWrite, opts) => {
        upserts.push({row: rowToWrite, opts});
        return upsertResult;
      },
    };
  }
  return {from, _upserts: upserts};
}

describe('loadAvailability', () => {
  it('returns {forms: {}} when row missing', async () => {
    const sb = makeMockSb();
    expect(await loadAvailability(sb)).toEqual({forms: {}});
  });

  it('normalizes the stored row', async () => {
    const sb = makeMockSb({
      row: {data: {forms: {'cattle-dailys': {hiddenIds: ['tm-a']}}}},
    });
    expect(await loadAvailability(sb)).toEqual({forms: {'cattle-dailys': {hiddenIds: ['tm-a']}}});
  });
});

describe('saveAvailability', () => {
  it('writes the canonical key', async () => {
    const sb = makeMockSb();
    await saveAvailability(sb, {forms: {'cattle-dailys': {hiddenIds: ['tm-a']}}});
    expect(sb._upserts).toHaveLength(1);
    expect(sb._upserts[0].row.key).toBe('team_availability');
    expect(sb._upserts[0].row.data).toEqual({forms: {'cattle-dailys': {hiddenIds: ['tm-a']}}});
  });

  it('preserves concurrent fresh formKeys local does not touch', async () => {
    const sb = makeMockSb({
      row: {data: {forms: {'sheep-dailys': {hiddenIds: ['tm-concurrent']}}}},
    });
    const persisted = await saveAvailability(sb, {forms: {'cattle-dailys': {hiddenIds: ['tm-local']}}});
    expect(persisted.forms['sheep-dailys']).toEqual({hiddenIds: ['tm-concurrent']});
    expect(persisted.forms['cattle-dailys']).toEqual({hiddenIds: ['tm-local']});
  });

  it('local intent wins on per-formKey collision', async () => {
    // Fresh has cattle-dailys hiding tm-fresh. Local re-saves with tm-local
    // hidden (admin reshuffled the form). Local wins → fresh's tm-fresh
    // is overwritten on this formKey.
    const sb = makeMockSb({
      row: {data: {forms: {'cattle-dailys': {hiddenIds: ['tm-fresh']}}}},
    });
    const persisted = await saveAvailability(sb, {forms: {'cattle-dailys': {hiddenIds: ['tm-local']}}});
    expect(persisted.forms['cattle-dailys']).toEqual({hiddenIds: ['tm-local']});
  });

  it('local can clear a formKey by writing empty hiddenIds (unhide intent preserved)', async () => {
    const sb = makeMockSb({
      row: {data: {forms: {'cattle-dailys': {hiddenIds: ['tm-prev']}}}},
    });
    const persisted = await saveAvailability(sb, {forms: {'cattle-dailys': {hiddenIds: []}}});
    expect(persisted.forms['cattle-dailys']).toEqual({hiddenIds: []});
  });

  it('throws on write failure', async () => {
    const sb = makeMockSb({upsertResult: {error: {message: 'boom'}}});
    await expect(saveAvailability(sb, {forms: {}})).rejects.toThrow(/boom/);
  });
});
