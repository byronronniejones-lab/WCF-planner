import {describe, it, expect} from 'vitest';
import registry from '../scripts/fleet/projects.cjs';

// ============================================================================
// Fleet project registry + fail-closed target guard — DB-free unit tests.
// ============================================================================
// These lock the containment contract: only TEST A-D are bootstrap targets,
// PROD and the reference project are rejected, identity can never be inferred
// from a bare ref, and link verification refuses a wrong/PROD linked ref.
// ============================================================================

const {
  PROD_PROJECT_REF,
  PROJECTS,
  BOOTSTRAP_KEYS,
  TargetError,
  normalizeKey,
  isProdRef,
  assertNotProdRef,
  assertBootstrapTarget,
  keyForRef,
  assertLinkedRefMatches,
} = registry;

describe('registry shape', () => {
  it('pins the PROD ref and the four TEST bootstrap refs (CLI-confirmed)', () => {
    expect(PROD_PROJECT_REF).toBe('pzfujbjtayhkdlxiblwe');
    expect(PROJECTS.prod.ref).toBe('pzfujbjtayhkdlxiblwe');
    expect(PROJECTS['test-main'].ref).toBe('msxvjupafhkcrerulolv');
    expect(PROJECTS['test-a'].ref).toBe('dkigsoyejzjwldqtqkkn');
    expect(PROJECTS['test-b'].ref).toBe('hiaisktuuropjnbfytwx');
    expect(PROJECTS['test-c'].ref).toBe('fopyfgcspicjmzngvsxp');
    expect(PROJECTS['test-d'].ref).toBe('ycwnlcgdwaimmxbjbyry');
  });

  it('has unique refs and unique lease groups across the fleet', () => {
    const refs = Object.values(PROJECTS).map((p) => p.ref);
    expect(new Set(refs).size).toBe(refs.length);
    const leases = Object.values(PROJECTS)
      .map((p) => p.lease)
      .filter(Boolean);
    expect(new Set(leases).size).toBe(leases.length);
  });

  it('marks exactly TEST A-D as bootstrap targets and prod as prohibited', () => {
    expect(BOOTSTRAP_KEYS).toEqual(['test-a', 'test-b', 'test-c', 'test-d']);
    expect(PROJECTS.prod.role).toBe('prod-prohibited');
    expect(PROJECTS['test-main'].role).toBe('reference');
    for (const k of BOOTSTRAP_KEYS) expect(PROJECTS[k].role).toBe('bootstrap');
  });

  it('assigns the locked A/B lane-1 and C/D lane-2 shard capacity', () => {
    expect([PROJECTS['test-a'].lane, PROJECTS['test-a'].shard]).toEqual([1, 1]);
    expect([PROJECTS['test-b'].lane, PROJECTS['test-b'].shard]).toEqual([1, 2]);
    expect([PROJECTS['test-c'].lane, PROJECTS['test-c'].shard]).toEqual([2, 1]);
    expect([PROJECTS['test-d'].lane, PROJECTS['test-d'].shard]).toEqual([2, 2]);
  });
});

describe('normalizeKey', () => {
  it('accepts canonical keys, display names, and short spellings', () => {
    expect(normalizeKey('test-a')).toBe('test-a');
    expect(normalizeKey('TEST A')).toBe('test-a');
    expect(normalizeKey('a')).toBe('test-a');
    expect(normalizeKey('main')).toBe('test-main');
    expect(normalizeKey('Farm Planner')).toBe('prod');
  });

  it('rejects missing / empty / non-string tokens (no default target)', () => {
    for (const bad of ['', '   ', null, undefined, 42, {}]) {
      expect(() => normalizeKey(bad)).toThrow(TargetError);
    }
  });

  it('rejects an unknown token instead of guessing', () => {
    expect(() => normalizeKey('test-e')).toThrow(/Unknown fleet target/);
    expect(() => normalizeKey('staging')).toThrow(TargetError);
  });

  it('refuses to resolve identity from a bare project ref (never infer from a ref)', () => {
    expect(() => normalizeKey('pzfujbjtayhkdlxiblwe')).toThrow(TargetError); // PROD ref
    expect(() => normalizeKey('dkigsoyejzjwldqtqkkn')).toThrow(TargetError); // TEST A ref
  });
});

describe('assertBootstrapTarget', () => {
  it('accepts each TEST A-D target and returns its entry', () => {
    expect(assertBootstrapTarget('test-a').ref).toBe('dkigsoyejzjwldqtqkkn');
    expect(assertBootstrapTarget('TEST D').ref).toBe('ycwnlcgdwaimmxbjbyry');
  });

  it('rejects PROD by name and by every spelling', () => {
    for (const t of ['prod', 'Farm Planner', 'farm-planner']) {
      expect(() => assertBootstrapTarget(t)).toThrow(/PROD|PRODUCTION/i);
    }
  });

  it('rejects the read-only reference project', () => {
    expect(() => assertBootstrapTarget('test-main')).toThrow(/not an authorized TEST bootstrap project|reference/i);
    expect(() => assertBootstrapTarget('wcf-planner-test-main')).toThrow(TargetError);
  });

  it('rejects unknown and missing targets', () => {
    expect(() => assertBootstrapTarget('test-e')).toThrow(TargetError);
    expect(() => assertBootstrapTarget('')).toThrow(TargetError);
    expect(() => assertBootstrapTarget(undefined)).toThrow(TargetError);
  });
});

describe('PROD ref helpers', () => {
  it('isProdRef / assertNotProdRef fail closed on PROD', () => {
    expect(isProdRef('pzfujbjtayhkdlxiblwe')).toBe(true);
    expect(isProdRef('dkigsoyejzjwldqtqkkn')).toBe(false);
    expect(() => assertNotProdRef('pzfujbjtayhkdlxiblwe')).toThrow(/PROD/i);
    expect(assertNotProdRef('dkigsoyejzjwldqtqkkn')).toBeUndefined();
  });

  it('keyForRef maps known refs and returns null for unknown', () => {
    expect(keyForRef('dkigsoyejzjwldqtqkkn')).toBe('test-a');
    expect(keyForRef('pzfujbjtayhkdlxiblwe')).toBe('prod');
    expect(keyForRef('zzzzzzzzzzzzzzzzzzzz')).toBeNull();
  });
});

describe('assertLinkedRefMatches (post-link verification)', () => {
  it('passes when the linked ref equals the intended TEST ref', () => {
    expect(assertLinkedRefMatches('dkigsoyejzjwldqtqkkn', 'dkigsoyejzjwldqtqkkn')).toBe(true);
  });

  it('fails closed when the linked ref does not match the intended target', () => {
    expect(() => assertLinkedRefMatches('dkigsoyejzjwldqtqkkn', 'hiaisktuuropjnbfytwx')).toThrow(/does not match/i);
  });

  it('fails closed when the linked ref is PROD, even if intended was PROD', () => {
    expect(() => assertLinkedRefMatches('pzfujbjtayhkdlxiblwe', 'pzfujbjtayhkdlxiblwe')).toThrow(/PROD/i);
  });

  it('fails closed on an empty/missing linked ref', () => {
    expect(() => assertLinkedRefMatches('dkigsoyejzjwldqtqkkn', '')).toThrow(TargetError);
    expect(() => assertLinkedRefMatches('dkigsoyejzjwldqtqkkn', null)).toThrow(TargetError);
  });
});
