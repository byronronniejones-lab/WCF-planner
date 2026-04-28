import {describe, expect, it} from 'vitest';
import {VALID_BREED_STATUS, parseImportDate, parseImportNumber, normTagStr} from './bulkImport.js';

describe('VALID_BREED_STATUS', () => {
  it('exports the three breeding-status canonical values', () => {
    expect(VALID_BREED_STATUS).toEqual(['Open', 'Pregnant', 'N/A']);
  });
});

describe('parseImportDate', () => {
  it('returns {value: null} for null / empty', () => {
    expect(parseImportDate(null)).toEqual({value: null});
    expect(parseImportDate('')).toEqual({value: null});
    expect(parseImportDate(undefined)).toEqual({value: null});
  });

  it('passes through ISO YYYY-MM-DD strings', () => {
    expect(parseImportDate('2026-04-28')).toEqual({value: '2026-04-28'});
  });

  it('parses M/D/YYYY and M/D/YY (2-digit year → +2000)', () => {
    expect(parseImportDate('4/28/2026')).toEqual({value: '2026-04-28'});
    expect(parseImportDate('4/28/26')).toEqual({value: '2026-04-28'});
    expect(parseImportDate('4-28-2026')).toEqual({value: '2026-04-28'});
  });

  it('parses Date objects', () => {
    expect(parseImportDate(new Date('2026-04-28T12:00:00Z'))).toEqual({value: '2026-04-28'});
  });

  it('parses Excel serial-number dates (epoch shift -25569 days)', () => {
    // 2026-04-28 in Excel serial = 46140 (verified via Excel: =DATE(2026,4,28))
    expect(parseImportDate(46140)).toEqual({value: '2026-04-28'});
  });

  it('returns {error} for unparseable strings', () => {
    expect(parseImportDate('not a date')).toMatchObject({error: expect.stringContaining('cannot parse date')});
  });

  it('returns {error} for invalid Date objects', () => {
    expect(parseImportDate(new Date('garbage'))).toMatchObject({error: 'invalid date'});
  });
});

describe('parseImportNumber', () => {
  it('returns {value: null} for null / empty', () => {
    expect(parseImportNumber(null)).toEqual({value: null});
    expect(parseImportNumber('')).toEqual({value: null});
    expect(parseImportNumber('   ')).toEqual({value: null});
  });

  it('passes through numbers', () => {
    expect(parseImportNumber(1234.5)).toEqual({value: 1234.5});
    expect(parseImportNumber(0)).toEqual({value: 0});
  });

  it('strips $, commas, whitespace before parsing', () => {
    expect(parseImportNumber('$1,234.50')).toEqual({value: 1234.5});
    expect(parseImportNumber(' 100 ')).toEqual({value: 100});
  });

  it('returns {error} for non-numeric strings', () => {
    expect(parseImportNumber('abc')).toMatchObject({error: expect.stringContaining('cannot parse number')});
  });
});

describe('normTagStr', () => {
  it('returns empty string for null / undefined', () => {
    expect(normTagStr(null)).toBe('');
    expect(normTagStr(undefined)).toBe('');
  });

  it('trims surrounding whitespace', () => {
    expect(normTagStr('  T-123  ')).toBe('T-123');
  });

  it('coerces non-strings to string before trim', () => {
    expect(normTagStr(456)).toBe('456');
  });
});
