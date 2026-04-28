import {describe, it, expect, beforeEach, afterEach} from 'vitest';
import {assertTestDatabase, _PROD_PROJECT_REF} from './assertTestDatabase.js';

describe('assertTestDatabase', () => {
  let originalFlag;

  beforeEach(() => {
    originalFlag = process.env.WCF_TEST_DATABASE;
  });

  afterEach(() => {
    if (originalFlag === undefined) delete process.env.WCF_TEST_DATABASE;
    else process.env.WCF_TEST_DATABASE = originalFlag;
  });

  it('throws when WCF_TEST_DATABASE is missing', () => {
    delete process.env.WCF_TEST_DATABASE;
    expect(() => assertTestDatabase('https://abc123.supabase.co')).toThrow(/WCF_TEST_DATABASE/);
  });

  it('throws when WCF_TEST_DATABASE is set but not exactly "1"', () => {
    process.env.WCF_TEST_DATABASE = 'true';
    expect(() => assertTestDatabase('https://abc123.supabase.co')).toThrow(/WCF_TEST_DATABASE/);
    process.env.WCF_TEST_DATABASE = '0';
    expect(() => assertTestDatabase('https://abc123.supabase.co')).toThrow(/WCF_TEST_DATABASE/);
    process.env.WCF_TEST_DATABASE = ' 1';
    expect(() => assertTestDatabase('https://abc123.supabase.co')).toThrow(/WCF_TEST_DATABASE/);
  });

  it('throws when URL matches the prod project ref', () => {
    process.env.WCF_TEST_DATABASE = '1';
    expect(() => assertTestDatabase(`https://${_PROD_PROJECT_REF}.supabase.co`)).toThrow(/production project ref/);
  });

  it('throws when URL contains the prod ref anywhere in the string', () => {
    process.env.WCF_TEST_DATABASE = '1';
    expect(() => assertTestDatabase(`https://prefix-${_PROD_PROJECT_REF}-suffix.supabase.co`)).toThrow(
      /production project ref/,
    );
  });

  it('throws when URL is empty, null, undefined, or non-string', () => {
    process.env.WCF_TEST_DATABASE = '1';
    expect(() => assertTestDatabase('')).toThrow(/non-empty string/);
    expect(() => assertTestDatabase(undefined)).toThrow(/non-empty string/);
    expect(() => assertTestDatabase(null)).toThrow(/non-empty string/);
    expect(() => assertTestDatabase(123)).toThrow(/non-empty string/);
  });

  it('passes when flag is "1" and URL is a non-prod project', () => {
    process.env.WCF_TEST_DATABASE = '1';
    expect(() => assertTestDatabase('https://abc123def456.supabase.co')).not.toThrow();
  });

  it('passes when URL has trailing slash and no prod ref', () => {
    process.env.WCF_TEST_DATABASE = '1';
    expect(() => assertTestDatabase('https://abc.supabase.co/')).not.toThrow();
  });
});
