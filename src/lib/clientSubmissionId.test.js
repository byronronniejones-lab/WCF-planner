import {describe, it, expect, beforeEach, afterEach, vi} from 'vitest';
import {newClientSubmissionId} from './clientSubmissionId.js';

describe('newClientSubmissionId', () => {
  it('returns a non-empty string', () => {
    const id = newClientSubmissionId();
    expect(typeof id).toBe('string');
    expect(id.length).toBeGreaterThan(0);
  });

  it('two consecutive calls produce different values', () => {
    const a = newClientSubmissionId();
    const b = newClientSubmissionId();
    expect(a).not.toBe(b);
  });

  it('uses crypto.randomUUID when available (returns RFC4122 shape)', () => {
    const spy = vi.spyOn(globalThis.crypto, 'randomUUID');
    const id = newClientSubmissionId();
    expect(spy).toHaveBeenCalledOnce();
    // RFC 4122: 8-4-4-4-12 hex
    expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);
    spy.mockRestore();
  });

  describe('fallback path (no crypto.randomUUID)', () => {
    let originalCrypto;

    beforeEach(() => {
      originalCrypto = globalThis.crypto;
      // Simulate an environment without crypto.randomUUID
      Object.defineProperty(globalThis, 'crypto', {value: undefined, configurable: true});
    });

    afterEach(() => {
      Object.defineProperty(globalThis, 'crypto', {value: originalCrypto, configurable: true});
    });

    it('still returns a non-empty string', () => {
      const id = newClientSubmissionId();
      expect(typeof id).toBe('string');
      expect(id.length).toBeGreaterThan(0);
    });

    it('two fallback calls still differ', () => {
      const a = newClientSubmissionId();
      const b = newClientSubmissionId();
      expect(a).not.toBe(b);
    });

    it('fallback prefix marks the path for telemetry / debugging', () => {
      expect(newClientSubmissionId()).toMatch(/^csid-/);
    });
  });
});
