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
