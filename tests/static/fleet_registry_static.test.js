import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {describe, it, expect} from 'vitest';
import registry from '../../scripts/fleet/projects.cjs';

// ============================================================================
// Fleet registry — static contract locks
// ============================================================================
// 1. The PROD project ref must stay identical across the three guard files
//    (fleet registry, assertTestDatabase.js, test_db_lease_run.cjs) so a rename
//    can never let a fleet op slip past one guard.
// 2. The registry is TOOLING-only: it must never be imported by src/ (browser
//    bundle), which would embed project refs where secure CI routing should own
//    them.
// ============================================================================

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..', '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

describe('PROD ref stays in lockstep across all guards', () => {
  const fromRegistry = registry.PROD_PROJECT_REF;
  const fromGuard = read('tests/setup/assertTestDatabase.js').match(/const PROD_PROJECT_REF = '([a-z0-9]+)'/);
  const fromWrapper = read('scripts/test_db_lease_run.cjs').match(/const PROD_PROJECT_REF = '([a-z0-9]+)'/);

  it('registry pins the canonical PROD ref', () => {
    expect(fromRegistry).toBe('pzfujbjtayhkdlxiblwe');
  });

  it('assertTestDatabase.js agrees', () => {
    expect(fromGuard).not.toBeNull();
    expect(fromGuard[1]).toBe(fromRegistry);
  });

  it('test_db_lease_run.cjs agrees', () => {
    expect(fromWrapper).not.toBeNull();
    expect(fromWrapper[1]).toBe(fromRegistry);
  });
});

describe('registry is a tooling-only boundary (never in the browser bundle)', () => {
  function walk(dir) {
    const out = [];
    for (const entry of fs.readdirSync(dir, {withFileTypes: true})) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) out.push(...walk(full));
      else if (/\.(js|jsx|ts|tsx|cjs|mjs)$/.test(entry.name)) out.push(full);
    }
    return out;
  }

  it('no file under src/ imports the fleet registry', () => {
    const offenders = walk(path.join(ROOT, 'src')).filter((f) => /fleet\/projects/.test(read(path.relative(ROOT, f))));
    expect(offenders).toEqual([]);
  });

  it('no src/ file hard-codes a TEST A-D project ref (routing owns credentials)', () => {
    const testRefs = ['dkigsoyejzjwldqtqkkn', 'hiaisktuuropjnbfytwx', 'fopyfgcspicjmzngvsxp', 'ycwnlcgdwaimmxbjbyry'];
    const offenders = [];
    for (const f of walk(path.join(ROOT, 'src'))) {
      const body = read(path.relative(ROOT, f));
      if (testRefs.some((r) => body.includes(r))) offenders.push(path.relative(ROOT, f));
    }
    expect(offenders).toEqual([]);
  });
});

describe('registry containment invariants', () => {
  it('exactly TEST A-D are bootstrap targets; prod is prohibited; test-main is reference', () => {
    const {PROJECTS, BOOTSTRAP_KEYS} = registry;
    expect(BOOTSTRAP_KEYS.slice().sort()).toEqual(['test-a', 'test-b', 'test-c', 'test-d']);
    expect(PROJECTS.prod.role).toBe('prod-prohibited');
    expect(PROJECTS['test-main'].role).toBe('reference');
  });
});
