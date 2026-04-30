import {describe, it, expect} from 'vitest';
import {FORM_KINDS, getFormConfig, buildRecord, _REGISTRY} from './offlineForms.js';

describe('FORM_KINDS', () => {
  it('contains the Phase 1B canary entry', () => {
    expect(FORM_KINDS).toContain('fuel_supply');
  });

  it('contains the Phase 1C-B PigDailys entry', () => {
    expect(FORM_KINDS).toContain('pig_dailys');
  });

  it('is frozen so accidental mutation is loud', () => {
    expect(Object.isFrozen(FORM_KINDS)).toBe(true);
  });
});

describe('getFormConfig', () => {
  it('returns the fuel_supply entry', () => {
    const cfg = getFormConfig('fuel_supply');
    expect(cfg.table).toBe('fuel_supplies');
    expect(cfg.hasPhotos).toBe(false);
    expect(typeof cfg.buildRecord).toBe('function');
  });

  it('throws on unknown form_kind (no silent fall-through)', () => {
    expect(() => getFormConfig('typo_form')).toThrow(/unknown form_kind/);
    expect(() => getFormConfig(undefined)).toThrow(/unknown form_kind/);
    expect(() => getFormConfig(null)).toThrow(/unknown form_kind/);
  });
});

describe('buildRecord — fuel_supply', () => {
  const payload = {
    date: '2026-04-29',
    gallons: 12.5,
    fuel_type: 'diesel',
    destination: 'gas_can',
    team_member: 'BMAN',
    notes: 'topped off the cans',
  };
  const ids = {id: 'fs-abc-123', csid: 'csid-xyz-789'};

  it('returns id + client_submission_id at the top of the record', () => {
    const rec = buildRecord('fuel_supply', payload, ids);
    expect(rec.id).toBe('fs-abc-123');
    expect(rec.client_submission_id).toBe('csid-xyz-789');
  });

  it('stamps source=webform (matches existing FuelSupplyWebform behavior)', () => {
    expect(buildRecord('fuel_supply', payload, ids).source).toBe('webform');
  });

  it('passes through all payload fields verbatim', () => {
    const rec = buildRecord('fuel_supply', payload, ids);
    expect(rec.date).toBe('2026-04-29');
    expect(rec.gallons).toBe(12.5);
    expect(rec.fuel_type).toBe('diesel');
    expect(rec.destination).toBe('gas_can');
    expect(rec.team_member).toBe('BMAN');
    expect(rec.notes).toBe('topped off the cans');
  });

  it('coerces missing fuel_type to null (existing behavior)', () => {
    const rec = buildRecord('fuel_supply', {...payload, fuel_type: undefined}, ids);
    expect(rec.fuel_type).toBeNull();
  });

  it('coerces missing notes to null (existing behavior)', () => {
    const rec = buildRecord('fuel_supply', {...payload, notes: undefined}, ids);
    expect(rec.notes).toBeNull();
  });

  it('replays produce byte-identical records when ids are stable', () => {
    const a = buildRecord('fuel_supply', payload, ids);
    const b = buildRecord('fuel_supply', payload, ids);
    expect(a).toEqual(b);
  });
});

describe('buildRecord — pig_dailys', () => {
  const payload = {
    date: '2026-04-29',
    team_member: 'BMAN',
    batch_id: 'p-26-01',
    batch_label: 'P-26-01',
    pig_count: 20,
    feed_lbs: 250,
    group_moved: true,
    nipple_drinker_moved: true,
    nipple_drinker_working: true,
    troughs_moved: true,
    fence_walked: true,
    fence_voltage: 4.2,
    issues: 'No issues',
  };
  const ids = {id: 'pd-abc-123', csid: 'csid-pd-xyz'};

  it('returns id + client_submission_id at the top of the record', () => {
    const rec = buildRecord('pig_dailys', payload, ids);
    expect(rec.id).toBe('pd-abc-123');
    expect(rec.client_submission_id).toBe('csid-pd-xyz');
  });

  it('passes through every documented column', () => {
    const rec = buildRecord('pig_dailys', payload, ids);
    expect(rec.date).toBe('2026-04-29');
    expect(rec.team_member).toBe('BMAN');
    expect(rec.batch_id).toBe('p-26-01');
    expect(rec.batch_label).toBe('P-26-01');
    expect(rec.pig_count).toBe(20);
    expect(rec.feed_lbs).toBe(250);
    expect(rec.group_moved).toBe(true);
    expect(rec.nipple_drinker_moved).toBe(true);
    expect(rec.nipple_drinker_working).toBe(true);
    expect(rec.troughs_moved).toBe(true);
    expect(rec.fence_walked).toBe(true);
    expect(rec.fence_voltage).toBe(4.2);
    expect(rec.issues).toBe('No issues');
  });

  it('always emits photos as an empty array (Phase 1C-B is no-photo only)', () => {
    const rec = buildRecord('pig_dailys', payload, ids);
    expect(rec.photos).toEqual([]);
  });

  it('NEVER includes feed_type (pig_dailys lacks the column)', () => {
    const rec = buildRecord('pig_dailys', {...payload, feed_type: 'STARTER'}, ids);
    expect('feed_type' in rec).toBe(false);
  });

  it('NEVER includes a source field (current PigDailys rows omit source)', () => {
    const rec = buildRecord('pig_dailys', payload, ids);
    expect('source' in rec).toBe(false);
  });

  it('stamps a fresh submitted_at on each call (replay snapshots the original)', () => {
    const rec = buildRecord('pig_dailys', payload, ids);
    expect(typeof rec.submitted_at).toBe('string');
    expect(/^\d{4}-\d{2}-\d{2}T/.test(rec.submitted_at)).toBe(true);
  });

  it('passes integer 0 + falsey values through unchanged (no parseInt mangling)', () => {
    const zeroPayload = {
      ...payload,
      pig_count: 0,
      feed_lbs: 0,
      group_moved: false,
      nipple_drinker_moved: false,
      nipple_drinker_working: false,
      troughs_moved: false,
      fence_walked: false,
      fence_voltage: 0,
      issues: null,
    };
    const rec = buildRecord('pig_dailys', zeroPayload, ids);
    expect(rec.pig_count).toBe(0);
    expect(rec.feed_lbs).toBe(0);
    expect(rec.group_moved).toBe(false);
    expect(rec.nipple_drinker_moved).toBe(false);
    expect(rec.nipple_drinker_working).toBe(false);
    expect(rec.troughs_moved).toBe(false);
    expect(rec.fence_walked).toBe(false);
    expect(rec.fence_voltage).toBe(0);
    expect(rec.issues).toBeNull();
  });
});

describe('registry shape', () => {
  it('every entry has table + hasPhotos + buildRecord', () => {
    for (const kind of FORM_KINDS) {
      const cfg = _REGISTRY[kind];
      expect(typeof cfg.table).toBe('string');
      expect(typeof cfg.hasPhotos).toBe('boolean');
      expect(typeof cfg.buildRecord).toBe('function');
    }
  });

  it('every entry is frozen', () => {
    for (const kind of FORM_KINDS) {
      expect(Object.isFrozen(_REGISTRY[kind])).toBe(true);
    }
  });
});

// ============================================================================
// Phase 1D-B — exact row-shape locks for the 3 new WebformHub form-kinds
// ============================================================================
// Codex amendment 5: vitest must assert COMPLETE object shape (key set + value
// shape) so the form-side payload can't drift from the registry-side row.
// Locked decisions per amendment 5:
//   - poultry_dailys: NO source field (current rows omit it).
//   - cattle_dailys / sheep_dailys: source: 'daily_webform'.
//   - photos: [] when payload.photos absent.
//   - submitted_at / id / client_submission_id always present via buildRecord.
//   - sheep mortality_count default stays 0.
//   - cattle/sheep feeds + minerals are payload pass-through (no re-lookup
//     during replay — the form stamps nutrition_snapshot once).

describe('poultry_dailys (broiler) row-shape lock', () => {
  const ids = {id: 'p-test-1', csid: 'csid-poultry-1'};
  const minimumPayload = {
    date: '2026-04-30',
    team_member: 'BMAN',
    batch_label: 'B-26-01',
    feed_type: 'STARTER',
    feed_lbs: 100,
    grit_lbs: 5,
    group_moved: true,
    waterer_checked: true,
    mortality_count: 0,
    mortality_reason: null,
    comments: null,
  };

  it('absent payload.photos yields photos:[] on the row', () => {
    const rec = buildRecord('poultry_dailys', minimumPayload, ids);
    expect(rec.photos).toEqual([]);
  });

  it('NO source field (current poultry_dailys rows omit it)', () => {
    const rec = buildRecord('poultry_dailys', minimumPayload, ids);
    expect('source' in rec).toBe(false);
  });

  it('row carries id + client_submission_id + submitted_at + every payload field', () => {
    const rec = buildRecord('poultry_dailys', minimumPayload, ids);
    expect(rec.id).toBe('p-test-1');
    expect(rec.client_submission_id).toBe('csid-poultry-1');
    expect(typeof rec.submitted_at).toBe('string');
    expect(rec.date).toBe('2026-04-30');
    expect(rec.team_member).toBe('BMAN');
    expect(rec.batch_label).toBe('B-26-01');
    expect(rec.feed_type).toBe('STARTER');
    expect(rec.feed_lbs).toBe(100);
    expect(rec.grit_lbs).toBe(5);
    expect(rec.group_moved).toBe(true);
    expect(rec.waterer_checked).toBe(true);
    expect(rec.mortality_count).toBe(0);
    expect(rec.mortality_reason).toBeNull();
    expect(rec.comments).toBeNull();
    expect(rec.photos).toEqual([]);
  });

  it('payload.photos metadata array passes through to row.photos', () => {
    const photos = [
      {
        path: 'poultry_dailys/x/photo-1.jpg',
        name: 'a.jpg',
        mime: 'image/jpeg',
        size_bytes: 50,
        captured_at: '2026-04-30T12:00:00Z',
      },
    ];
    const rec = buildRecord('poultry_dailys', {...minimumPayload, photos}, ids);
    expect(rec.photos).toEqual(photos);
  });
});

describe('cattle_dailys row-shape lock', () => {
  const ids = {id: 'c-test-1', csid: 'csid-cattle-1'};
  const feedsJ = [
    {
      feed_input_id: 'fi-1',
      feed_name: 'Alfalfa',
      category: 'hay',
      qty: 50,
      unit: 'bale',
      lbs_as_fed: 50,
      is_creep: false,
      nutrition_snapshot: {moisture_pct: 12, nfc_pct: 30, protein_pct: 18},
    },
  ];
  const mineralsJ = [{feed_input_id: 'fi-2', name: 'Salt block', lbs: 5}];
  const minimumPayload = {
    date: '2026-04-30',
    team_member: 'BMAN',
    herd: 'mommas',
    feedsJ,
    mineralsJ,
    fence_voltage: 5,
    water_checked: true,
    mortality_count: 0,
    mortality_reason: null,
    issues: null,
  };

  it('source: "daily_webform" literal', () => {
    const rec = buildRecord('cattle_dailys', minimumPayload, ids);
    expect(rec.source).toBe('daily_webform');
  });

  it('feeds + minerals are payload pass-through (no re-lookup during replay)', () => {
    const rec = buildRecord('cattle_dailys', minimumPayload, ids);
    expect(rec.feeds).toEqual(feedsJ);
    expect(rec.minerals).toEqual(mineralsJ);
    // Locks the snapshot contract: even if cattle_feed_inputs.protein_pct
    // changes between submit and replay, the row's feeds[].nutrition_snapshot
    // stays at the original value because the form composed it once.
    expect(rec.feeds[0].nutrition_snapshot.protein_pct).toBe(18);
  });

  it('absent payload.photos yields photos:[]', () => {
    const rec = buildRecord('cattle_dailys', minimumPayload, ids);
    expect(rec.photos).toEqual([]);
  });

  it('absent feedsJ/mineralsJ default to empty arrays', () => {
    const rec = buildRecord('cattle_dailys', {...minimumPayload, feedsJ: undefined, mineralsJ: undefined}, ids);
    expect(rec.feeds).toEqual([]);
    expect(rec.minerals).toEqual([]);
  });

  it('mortality_count defaults to 0 when absent; mortality_reason defaults to null', () => {
    const rec = buildRecord(
      'cattle_dailys',
      {...minimumPayload, mortality_count: undefined, mortality_reason: undefined},
      ids,
    );
    expect(rec.mortality_count).toBe(0);
    expect(rec.mortality_reason).toBeNull();
  });

  it('row carries id + client_submission_id + submitted_at + every payload field', () => {
    const rec = buildRecord('cattle_dailys', minimumPayload, ids);
    expect(rec.id).toBe('c-test-1');
    expect(rec.client_submission_id).toBe('csid-cattle-1');
    expect(typeof rec.submitted_at).toBe('string');
    expect(rec.date).toBe('2026-04-30');
    expect(rec.team_member).toBe('BMAN');
    expect(rec.herd).toBe('mommas');
    expect(rec.fence_voltage).toBe(5);
    expect(rec.water_checked).toBe(true);
    expect(rec.issues).toBeNull();
  });
});

describe('sheep_dailys row-shape lock', () => {
  const ids = {id: 's-test-1', csid: 'csid-sheep-1'};
  const feedsJ = [
    {feed_input_id: 'fi-1', feed_name: 'Hay', category: 'hay', qty: 1, unit: 'bale', lbs_as_fed: 50, is_creep: false},
  ];
  const mineralsJ = [{feed_input_id: 'fi-2', name: 'Mineral mix', lbs: 2}];
  const minimumPayload = {
    date: '2026-04-30',
    team_member: 'BMAN',
    flock: 'feeders',
    feedsJ,
    mineralsJ,
    fence_voltage_kv: 4.2,
    waterers_working: true,
    comments: null,
  };

  it('source: "daily_webform" literal', () => {
    const rec = buildRecord('sheep_dailys', minimumPayload, ids);
    expect(rec.source).toBe('daily_webform');
  });

  it('mortality_count default stays 0 (codex amendment 5 lock)', () => {
    // sheep submitX hardcodes mortality_count: 0 today; the registry
    // preserves that default when payload omits it.
    const rec = buildRecord('sheep_dailys', minimumPayload, ids);
    expect(rec.mortality_count).toBe(0);
  });

  it('feeds + minerals pass-through', () => {
    const rec = buildRecord('sheep_dailys', minimumPayload, ids);
    expect(rec.feeds).toEqual(feedsJ);
    expect(rec.minerals).toEqual(mineralsJ);
  });

  it('waterers_working coerces to boolean', () => {
    const rec = buildRecord('sheep_dailys', {...minimumPayload, waterers_working: 1}, ids);
    expect(rec.waterers_working).toBe(true);
    const rec2 = buildRecord('sheep_dailys', {...minimumPayload, waterers_working: undefined}, ids);
    expect(rec2.waterers_working).toBe(false);
  });

  it('absent photos → photos:[]', () => {
    const rec = buildRecord('sheep_dailys', minimumPayload, ids);
    expect(rec.photos).toEqual([]);
  });

  it('row carries id + client_submission_id + submitted_at + every payload field', () => {
    const rec = buildRecord('sheep_dailys', minimumPayload, ids);
    expect(rec.id).toBe('s-test-1');
    expect(rec.client_submission_id).toBe('csid-sheep-1');
    expect(typeof rec.submitted_at).toBe('string');
    expect(rec.flock).toBe('feeders');
    expect(rec.fence_voltage_kv).toBe(4.2);
    expect(rec.comments).toBeNull();
  });
});

describe('1D-B exclusions', () => {
  it('layer_dailys NOT registered (deferred to 1D-C; load-bearing housing anchor)', () => {
    expect(FORM_KINDS).not.toContain('layer_dailys');
    expect(() => getFormConfig('layer_dailys')).toThrow(/unknown form_kind/);
  });

  it('egg_dailys NOT registered (no photos column per mig 030)', () => {
    expect(FORM_KINDS).not.toContain('egg_dailys');
    expect(() => getFormConfig('egg_dailys')).toThrow(/unknown form_kind/);
  });
});

describe('1D-B FORM_KINDS membership', () => {
  it('includes the 3 new entries + pig_dailys (existing) + fuel_supply', () => {
    expect(FORM_KINDS).toEqual(
      expect.arrayContaining(['fuel_supply', 'pig_dailys', 'poultry_dailys', 'cattle_dailys', 'sheep_dailys']),
    );
  });
});
