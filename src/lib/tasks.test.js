import {describe, it, expect} from 'vitest';
import {RECURRENCE_OPTIONS, isOpenTaskInstance} from './tasks.js';

// Pure helpers — see ./tasks.js. Tests stay equally pure.

describe('RECURRENCE_OPTIONS', () => {
  it('lists exactly the recurrence values mig 039 allows', () => {
    // Mig 036 declared ('once','daily','weekly','biweekly','monthly');
    // mig 039 added 'quarterly'. Order matters for the admin dropdown — keep
    // 'once' first so it's the safest default for new templates.
    expect(RECURRENCE_OPTIONS).toEqual(['once', 'daily', 'weekly', 'biweekly', 'monthly', 'quarterly']);
  });

  it('is frozen-in-spirit (no duplicates, no empty strings)', () => {
    expect(new Set(RECURRENCE_OPTIONS).size).toBe(RECURRENCE_OPTIONS.length);
    expect(RECURRENCE_OPTIONS.every((s) => typeof s === 'string' && s.length > 0)).toBe(true);
  });
});

describe('isOpenTaskInstance', () => {
  it('accepts status="open"', () => {
    expect(isOpenTaskInstance({status: 'open'})).toBe(true);
  });

  it('rejects completed/missed/null/undefined/non-objects', () => {
    expect(isOpenTaskInstance({status: 'completed'})).toBe(false);
    expect(isOpenTaskInstance({status: 'missed'})).toBe(false);
    expect(isOpenTaskInstance({})).toBe(false);
    expect(isOpenTaskInstance(null)).toBe(false);
    expect(isOpenTaskInstance(undefined)).toBe(false);
  });
});
