import {describe, it, expect} from 'vitest';
import redactMod from '../scripts/fleet/redact.cjs';

// ============================================================================
// Credential redaction — DB-free unit tests.
// ============================================================================
// Proves credential-shaped values are stripped from errors and reports, and
// that non-secret text (project refs, prose, counts) survives.
// ============================================================================

const {MASK, redact, redactError, assertNoSecrets} = redactMod;

// A syntactically valid but FAKE JWT (three base64url segments). Not a real key.
const FAKE_JWT =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJyb2xlIjoic2VydmljZV9yb2xlIn0.QWJjRGVmR2hpSmtsMTIzNDU2Nzg5MFhZWg';

describe('redact()', () => {
  it('masks JWT-shaped tokens (anon/service-role keys)', () => {
    const out = redact(`key=${FAKE_JWT}`);
    expect(out).not.toContain(FAKE_JWT);
    expect(out).toContain(MASK);
  });

  it('masks sb_/sbp_ token formats', () => {
    expect(redact('sb_secret_abcdef0123456789ABCDEF')).toBe(MASK);
    expect(redact('token sbp_0123456789abcdef0123456789abcdef')).toContain(MASK);
  });

  it('masks postgres connection strings including any embedded password', () => {
    const out = redact('postgresql://postgres.abc:sup3rSecret@aws-0-us-east-1.pooler.supabase.com:6543/postgres');
    expect(out).not.toContain('sup3rSecret');
    expect(out).toContain(MASK);
  });

  it('masks explicit password/apikey/secret assignments', () => {
    expect(redact('password=hunter2longenoughvalue')).toContain(MASK);
    expect(redact('password=hunter2longenoughvalue')).not.toContain('hunter2');
    expect(redact('SERVICE_ROLE_KEY: abcd1234efgh5678ijkl')).toContain(MASK);
  });

  it('masks Authorization: Bearer headers', () => {
    const out = redact('Authorization: Bearer abcDEF123456ghiJKL789');
    expect(out).toContain('Bearer ' + MASK);
    expect(out).not.toContain('abcDEF123456ghiJKL789');
  });

  it('masks long base64/hex runs that look like raw keys', () => {
    expect(redact('X'.repeat(50))).toBe(MASK);
    expect(redact('deadbeef'.repeat(8))).toBe(MASK); // 64 hex chars
  });

  it('leaves non-secret project refs and ordinary prose intact', () => {
    const msg = 'Bootstrapping TEST A (ref dkigsoyejzjwldqtqkkn): 85 tables, 9 buckets, ready.';
    expect(redact(msg)).toBe(msg);
  });

  it('is null/undefined safe', () => {
    expect(redact(null)).toBeNull();
    expect(redact(undefined)).toBeUndefined();
  });
});

describe('redactError()', () => {
  it('returns a new Error with redacted message and stack', () => {
    const err = new Error(`connect failed for postgresql://postgres:pw12345678@db/postgres key=${FAKE_JWT}`);
    const clean = redactError(err);
    expect(clean).toBeInstanceOf(Error);
    expect(clean).not.toBe(err);
    expect(clean.message).not.toContain(FAKE_JWT);
    expect(clean.message).not.toContain('pw12345678');
    expect(clean.message).toContain(MASK);
  });

  it('wraps non-Error inputs', () => {
    expect(redactError(`boom ${FAKE_JWT}`).message).toContain(MASK);
  });
});

describe('assertNoSecrets()', () => {
  it('passes clean strings and throws on credential-shaped ones', () => {
    expect(assertNoSecrets('TEST A ref dkigsoyejzjwldqtqkkn ready')).toBeTruthy();
    expect(() => assertNoSecrets(`report ${FAKE_JWT}`)).toThrow(/credential-shaped/);
  });
});
