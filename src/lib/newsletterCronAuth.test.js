import {describe, it, expect} from 'vitest';
import {safeEqual, cronAuthOk} from './newsletterCronAuth.js';

describe('safeEqual', () => {
  it('matches equal strings only', () => {
    expect(safeEqual('abc', 'abc')).toBe(true);
    expect(safeEqual('abc', 'abd')).toBe(false);
    expect(safeEqual('abc', 'ab')).toBe(false);
    expect(safeEqual(null, null)).toBe(false);
    expect(safeEqual(undefined, 'x')).toBe(false);
  });
});

describe('cronAuthOk — fail closed', () => {
  const KEY = 'k'.repeat(40);
  const SECRET = 's'.repeat(96);

  it('authenticates only with both correct, configured secrets', () => {
    expect(cronAuthOk(KEY, SECRET, KEY, SECRET)).toBe(true);
  });

  it('rejects a wrong bearer or wrong cron secret', () => {
    expect(cronAuthOk('wrong', SECRET, KEY, SECRET)).toBe(false);
    expect(cronAuthOk(KEY, 'wrong', KEY, SECRET)).toBe(false);
  });

  it('CANNOT authenticate when the expected key is missing/empty (even with empty headers)', () => {
    expect(cronAuthOk('', '', '', SECRET)).toBe(false);
    expect(cronAuthOk('', SECRET, '', SECRET)).toBe(false);
  });

  it('CANNOT authenticate when the expected cron secret is missing/empty (even with empty headers)', () => {
    expect(cronAuthOk('', '', KEY, '')).toBe(false);
    expect(cronAuthOk(KEY, '', KEY, '')).toBe(false);
  });

  it('CANNOT authenticate when BOTH expected secrets are empty and the request sends empty headers', () => {
    // The bypass guarded against: safeEqual('', '') is true, so without the
    // unconfigured-secret guard this would wrongly authenticate.
    expect(cronAuthOk('', '', '', '')).toBe(false);
    expect(cronAuthOk(undefined, undefined, '', '')).toBe(false);
  });
});
