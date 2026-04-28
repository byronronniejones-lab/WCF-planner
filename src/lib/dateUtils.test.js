import {describe, it, expect} from 'vitest';
import {addDays, toISO, fmt, fmtS, todayISO} from './dateUtils.js';

describe('addDays', () => {
  it('adds days to an ISO date string and returns a Date object', () => {
    const result = addDays('2026-04-25', 5);
    expect(result).toBeInstanceOf(Date);
    expect(toISO(result)).toBe('2026-04-30');
  });

  it('handles negative days (subtraction)', () => {
    expect(toISO(addDays('2026-04-25', -7))).toBe('2026-04-18');
  });

  it('handles month-boundary crossing', () => {
    expect(toISO(addDays('2026-04-28', 5))).toBe('2026-05-03');
  });

  it('handles year-boundary crossing', () => {
    expect(toISO(addDays('2026-12-30', 5))).toBe('2027-01-04');
  });

  it('zero days returns the same date (noon-anchor avoids timezone drift)', () => {
    // The 'T12:00:00' anchor in addDays means a 0-day shift never crosses
    // midnight in any reasonable runner timezone.
    expect(toISO(addDays('2026-04-25', 0))).toBe('2026-04-25');
  });

  it('accepts a Date object as input', () => {
    const start = new Date('2026-04-25T12:00:00');
    expect(toISO(addDays(start, 1))).toBe('2026-04-26');
  });
});

describe('toISO', () => {
  it('returns YYYY-MM-DD from a Date', () => {
    expect(toISO(new Date('2026-04-25T12:00:00Z'))).toBe('2026-04-25');
  });

  it('strips the time portion from a full ISO timestamp string', () => {
    expect(toISO('2026-04-25T15:30:00Z')).toBe('2026-04-25');
  });
});

describe('fmt (mm/dd/yy)', () => {
  it('formats a YYYY-MM-DD string as mm/dd/yy', () => {
    expect(fmt('2026-04-25')).toBe('04/25/26');
  });

  it('zero-pads single-digit months and days', () => {
    expect(fmt('2026-01-05')).toBe('01/05/26');
  });

  it('accepts a full ISO timestamp and uses only the date portion', () => {
    expect(fmt('2026-04-25T15:30:00Z')).toBe('04/25/26');
  });

  it('returns "—" for null, undefined, or empty input', () => {
    expect(fmt(null)).toBe('—');
    expect(fmt(undefined)).toBe('—');
    expect(fmt('')).toBe('—');
  });

  it('returns "—" for malformed input', () => {
    expect(fmt('not-a-date')).toBe('—');
  });
});

describe('fmtS (mm/dd, no year)', () => {
  it('formats a YYYY-MM-DD string as mm/dd', () => {
    expect(fmtS('2026-04-25')).toBe('04/25');
  });

  it('zero-pads single-digit months and days', () => {
    expect(fmtS('2026-01-05')).toBe('01/05');
  });

  it('returns "—" for null/empty/malformed', () => {
    expect(fmtS(null)).toBe('—');
    expect(fmtS('')).toBe('—');
    expect(fmtS('not-a-date')).toBe('—');
  });
});

describe('todayISO', () => {
  it('returns a YYYY-MM-DD formatted string', () => {
    expect(todayISO()).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('matches toISO(new Date()) at the same instant', () => {
    expect(todayISO()).toBe(toISO(new Date()));
  });
});
