import {describe, it, expect} from 'vitest';
import {dueDatesThrough, addMonthsAnchored} from './tasksRecurrence.js';

// Tests for the Tasks v1 Phase B recurrence math. Locks the contract Codex
// approved in plan rev 3:
//   - dueDatesThrough(template, throughISO) returns ALL anchored occurrences
//     between first_due_date and throughISO inclusive.
//   - Catch-up is implicit (cron passes throughISO=today+3, so any active
//     template with first_due_date in the past gets backfilled).
//   - Anchored monthly/quarterly: each occurrence computed from the ORIGINAL
//     first_due_date, never chained from the previous clamped result.
//   - biweekly * recurrence_interval multiplies the 14-day base.

describe('addMonthsAnchored', () => {
  it('preserves day of month when target month has it', () => {
    expect(addMonthsAnchored('2026-01-15', 1)).toBe('2026-02-15');
    expect(addMonthsAnchored('2026-01-15', 12)).toBe('2027-01-15');
  });

  it('clamps to last day of target month when source day exceeds it', () => {
    // Jan 31 + 1 month = Feb 28 (non-leap), Feb 29 (leap).
    expect(addMonthsAnchored('2026-01-31', 1)).toBe('2026-02-28');
    expect(addMonthsAnchored('2024-01-31', 1)).toBe('2024-02-29');
  });

  it('returns to original day when target month allows it (anchored, not chained)', () => {
    // Jan 31 + 2 months = Mar 31. If we'd chained from Feb 28, we'd land on
    // Mar 28. Anchored math returns Mar 31.
    expect(addMonthsAnchored('2026-01-31', 2)).toBe('2026-03-31');
    expect(addMonthsAnchored('2026-01-31', 3)).toBe('2026-04-30'); // Apr has 30
    expect(addMonthsAnchored('2026-01-31', 4)).toBe('2026-05-31');
  });

  it('handles year wrap', () => {
    expect(addMonthsAnchored('2026-11-15', 3)).toBe('2027-02-15');
    expect(addMonthsAnchored('2026-12-31', 1)).toBe('2027-01-31');
  });

  it('handles leap-year quarterly anchor (Feb 29 → Feb 28 in non-leap year)', () => {
    expect(addMonthsAnchored('2024-02-29', 3)).toBe('2024-05-29');
    expect(addMonthsAnchored('2024-02-29', 6)).toBe('2024-08-29');
    expect(addMonthsAnchored('2024-02-29', 12)).toBe('2025-02-28');
  });
});

describe('dueDatesThrough — once', () => {
  it('emits the first_due_date when it is at/before throughISO', () => {
    expect(dueDatesThrough({recurrence: 'once', first_due_date: '2026-05-01'}, '2026-05-15')).toEqual(['2026-05-01']);
    expect(dueDatesThrough({recurrence: 'once', first_due_date: '2026-05-15'}, '2026-05-15')).toEqual(['2026-05-15']);
  });

  it('emits empty when first_due_date is after throughISO', () => {
    expect(dueDatesThrough({recurrence: 'once', first_due_date: '2026-06-01'}, '2026-05-15')).toEqual([]);
  });
});

describe('dueDatesThrough — daily', () => {
  it('emits every day from first_due_date through throughISO', () => {
    const out = dueDatesThrough({recurrence: 'daily', first_due_date: '2026-05-01'}, '2026-05-04');
    expect(out).toEqual(['2026-05-01', '2026-05-02', '2026-05-03', '2026-05-04']);
  });

  it('honors recurrence_interval > 1 (every N days)', () => {
    const out = dueDatesThrough(
      {recurrence: 'daily', recurrence_interval: 3, first_due_date: '2026-05-01'},
      '2026-05-10',
    );
    expect(out).toEqual(['2026-05-01', '2026-05-04', '2026-05-07', '2026-05-10']);
  });
});

describe('dueDatesThrough — weekly', () => {
  it('emits every 7 days', () => {
    const out = dueDatesThrough({recurrence: 'weekly', first_due_date: '2026-05-01'}, '2026-05-29');
    expect(out).toEqual(['2026-05-01', '2026-05-08', '2026-05-15', '2026-05-22', '2026-05-29']);
  });

  it('honors recurrence_interval > 1 (every N weeks)', () => {
    const out = dueDatesThrough(
      {recurrence: 'weekly', recurrence_interval: 2, first_due_date: '2026-05-01'},
      '2026-06-12',
    );
    expect(out).toEqual(['2026-05-01', '2026-05-15', '2026-05-29', '2026-06-12']);
  });
});

describe('dueDatesThrough — biweekly (locked: interval * 14d base)', () => {
  it('emits every 14 days at default interval=1', () => {
    const out = dueDatesThrough({recurrence: 'biweekly', first_due_date: '2026-05-01'}, '2026-06-12');
    expect(out).toEqual(['2026-05-01', '2026-05-15', '2026-05-29', '2026-06-12']);
  });

  it('biweekly * recurrence_interval=2 = 28-day step (Codex Q2 lock)', () => {
    const out = dueDatesThrough(
      {recurrence: 'biweekly', recurrence_interval: 2, first_due_date: '2026-05-01'},
      '2026-07-24',
    );
    expect(out).toEqual(['2026-05-01', '2026-05-29', '2026-06-26', '2026-07-24']);
  });
});

describe('dueDatesThrough — monthly (anchored)', () => {
  it('emits every month, anchor preserved when target month allows it', () => {
    const out = dueDatesThrough({recurrence: 'monthly', first_due_date: '2026-01-31'}, '2026-06-30');
    // Anchored: each step uses Jan 31 + N months, NOT chained from prior result.
    expect(out).toEqual(['2026-01-31', '2026-02-28', '2026-03-31', '2026-04-30', '2026-05-31', '2026-06-30']);
  });

  it('honors recurrence_interval > 1 (every N months)', () => {
    const out = dueDatesThrough(
      {recurrence: 'monthly', recurrence_interval: 2, first_due_date: '2026-01-15'},
      '2026-09-15',
    );
    expect(out).toEqual(['2026-01-15', '2026-03-15', '2026-05-15', '2026-07-15', '2026-09-15']);
  });
});

describe('dueDatesThrough — quarterly (anchored)', () => {
  it('emits every 3 months from first_due_date', () => {
    const out = dueDatesThrough({recurrence: 'quarterly', first_due_date: '2026-02-15'}, '2027-02-15');
    expect(out).toEqual(['2026-02-15', '2026-05-15', '2026-08-15', '2026-11-15', '2027-02-15']);
  });

  it('handles leap-year anchor (Feb 29 → Feb 28 in non-leap)', () => {
    const out = dueDatesThrough({recurrence: 'quarterly', first_due_date: '2024-02-29'}, '2025-05-29');
    expect(out).toEqual(['2024-02-29', '2024-05-29', '2024-08-29', '2024-11-29', '2025-02-28', '2025-05-29']);
  });

  it('honors recurrence_interval > 1 (every N * 3 months)', () => {
    const out = dueDatesThrough(
      {recurrence: 'quarterly', recurrence_interval: 2, first_due_date: '2026-01-15'},
      '2027-07-15',
    );
    // 6-month step.
    expect(out).toEqual(['2026-01-15', '2026-07-15', '2027-01-15', '2027-07-15']);
  });
});

describe('dueDatesThrough — bounds', () => {
  it('returns empty when first_due_date is after throughISO', () => {
    expect(dueDatesThrough({recurrence: 'daily', first_due_date: '2026-06-01'}, '2026-05-15')).toEqual([]);
  });

  it('emits exactly one entry when first_due_date === throughISO', () => {
    expect(dueDatesThrough({recurrence: 'daily', first_due_date: '2026-05-15'}, '2026-05-15')).toEqual(['2026-05-15']);
    expect(dueDatesThrough({recurrence: 'monthly', first_due_date: '2026-05-15'}, '2026-05-15')).toEqual([
      '2026-05-15',
    ]);
  });

  it('returns empty for missing inputs', () => {
    expect(dueDatesThrough(null, '2026-05-15')).toEqual([]);
    expect(dueDatesThrough({recurrence: 'daily', first_due_date: '2026-05-01'}, null)).toEqual([]);
    expect(dueDatesThrough({recurrence: 'daily'}, '2026-05-15')).toEqual([]);
  });

  it('returns empty for unknown recurrence values', () => {
    expect(dueDatesThrough({recurrence: 'yearly', first_due_date: '2026-01-01'}, '2027-01-01')).toEqual([]);
  });

  it('coerces invalid recurrence_interval to default 1', () => {
    expect(
      dueDatesThrough({recurrence: 'daily', recurrence_interval: 0, first_due_date: '2026-05-01'}, '2026-05-03'),
    ).toEqual(['2026-05-01', '2026-05-02', '2026-05-03']);
    expect(
      dueDatesThrough({recurrence: 'daily', recurrence_interval: -3, first_due_date: '2026-05-01'}, '2026-05-03'),
    ).toEqual(['2026-05-01', '2026-05-02', '2026-05-03']);
    expect(
      dueDatesThrough({recurrence: 'daily', recurrence_interval: 'bogus', first_due_date: '2026-05-01'}, '2026-05-03'),
    ).toEqual(['2026-05-01', '2026-05-02', '2026-05-03']);
  });
});

describe('dueDatesThrough — catch-up', () => {
  it('a daily template with first_due_date 6 months ago produces ~180+ entries (drives 90-cap branch)', () => {
    // first_due_date = 2025-11-01, throughISO = 2026-05-04 → 185 days.
    const out = dueDatesThrough({recurrence: 'daily', first_due_date: '2025-11-01'}, '2026-05-04');
    expect(out.length).toBe(185);
    expect(out[0]).toBe('2025-11-01');
    expect(out[out.length - 1]).toBe('2026-05-04');
  });

  it('canonical \\ existing = missing — set difference math the cron caller will run', () => {
    const canonical = dueDatesThrough({recurrence: 'daily', first_due_date: '2026-05-01'}, '2026-05-07');
    const existing = new Set(['2026-05-02', '2026-05-04', '2026-05-06']);
    const missing = canonical.filter((d) => !existing.has(d));
    expect(missing).toEqual(['2026-05-01', '2026-05-03', '2026-05-05', '2026-05-07']);

    // Same input twice → same canonical → after caller intersects, zero missing.
    const second = dueDatesThrough({recurrence: 'daily', first_due_date: '2026-05-01'}, '2026-05-07');
    const allExisting = new Set(canonical);
    const secondMissing = second.filter((d) => !allExisting.has(d));
    expect(secondMissing).toEqual([]);
  });
});
