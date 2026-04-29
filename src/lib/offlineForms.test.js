import {describe, it, expect} from 'vitest';
import {FORM_KINDS, getFormConfig, buildRecord, _REGISTRY} from './offlineForms.js';

describe('FORM_KINDS', () => {
  it('contains the Phase 1B canary entry', () => {
    expect(FORM_KINDS).toContain('fuel_supply');
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
