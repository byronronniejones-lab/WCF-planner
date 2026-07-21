import {readdirSync, readFileSync} from 'node:fs';
import path from 'node:path';
import {describe, expect, it} from 'vitest';

// ============================================================================
// Centralized navigation-readiness contract
// ============================================================================
// tests/fixtures.js wraps page.goto() so an application navigation does not
// resolve until the fail-closed cold-boot gate clears. Two things must hold for
// that to actually protect the suite:
//   1. Specs must obtain `test` from the canonical fixture module. A spec that
//      imports straight from @playwright/test gets the raw page and silently
//      loses the auto-wait — the failure mode is a rotating flake, not an error.
//   2. Any opt-out must be explicit, reasoned, and inventoried here, so an
//      opt-out cannot be added quietly or left behind once it stops being true.

const SPEC_ROOT = 'tests';
const FIXTURES = path.join('tests', 'fixtures.js');

// Root-suite specs that legitimately do NOT use the canonical fixture module.
// Pasture runs under playwright.pasture.config.js against a different port and
// never calls resetTestDatabase; it is a separate lane and explicitly out of
// scope for this contract. ux_audit is a local capture utility that
// playwright.config.js testIgnores from root runs.
const NON_CANONICAL_ALLOWED = new Map([['ux_audit.spec.js', 'local capture utility, testIgnore-d from root runs']]);
const isPastureSpec = (rel) => rel.startsWith('pasture_map_');

// Every spec allowed to disable auto-ready, with the reason it needs to.
// An entry here that no longer opts out FAILS — stale entries would quietly
// re-open the door. An opt-out NOT listed here also fails.
const AUTO_READY_OPT_OUTS = new Map([
  [
    'navigation_readiness.spec.js',
    'the opt-out proof itself — one describe block disables auto-ready to prove the escape hatch works',
  ],
]);

function collectSpecs(dir) {
  const out = [];
  for (const entry of readdirSync(dir, {withFileTypes: true})) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules' || entry.name === '.auth') continue;
      out.push(...collectSpecs(full));
    } else if (entry.name.endsWith('.spec.js')) {
      out.push(path.relative(SPEC_ROOT, full).split(path.sep).join('/'));
    }
  }
  return out;
}

const specFiles = collectSpecs(SPEC_ROOT);
const read = (rel) => readFileSync(path.join(SPEC_ROOT, rel), 'utf8');
const fixtures = readFileSync(FIXTURES, 'utf8');

describe('centralized navigation readiness', () => {
  it('wraps goto on the canonical page fixture and awaits readiness', () => {
    expect(fixtures).toContain("import {waitForAppReady} from './helpers/appReady.js'");
    expect(fixtures).toContain('page.goto = async');
    expect(fixtures).toContain('await waitForAppReady(page)');
    // Returns the native Response rather than swallowing it.
    expect(fixtures).toContain('const response = await nativeGoto(url, options)');
    expect(fixtures).toContain('return response');
  });

  it('gates the auto-wait on the post-navigation app origin', () => {
    // Keying on page.url() after navigation is what makes redirects work and
    // what keeps external origins out.
    expect(fixtures).toContain('appOriginKey(page.url()) === appOrigin');
  });

  it('exposes the opt-out as declared options, not a filename allowlist', () => {
    expect(fixtures).toContain('wcfAutoReady: [true, {option: true}]');
    expect(fixtures).toContain("wcfAutoReadyReason: ['', {option: true}]");
  });

  it('refuses an opt-out that carries no reason', () => {
    // Runtime backstop, in addition to the static inventory below.
    expect(fixtures).toContain('wcfAutoReady:false requires a non-empty wcfAutoReadyReason');
  });

  it('does not retry, reload, or sleep around navigation', () => {
    const wrapper = fixtures.slice(fixtures.indexOf('page.goto = async'), fixtures.indexOf('await use(page)'));
    expect(wrapper).not.toContain('page.reload');
    expect(wrapper).not.toContain('setTimeout');
    expect(wrapper).not.toContain('waitForTimeout');
    expect(wrapper).not.toContain('catch');
  });

  it('routes every in-scope spec through the canonical fixture module', () => {
    const offenders = specFiles.filter((rel) => {
      if (isPastureSpec(rel) || NON_CANONICAL_ALLOWED.has(rel)) return false;
      return !/from '\.\/fixtures\.js'/.test(read(rel));
    });
    expect(offenders).toEqual([]);
  });

  it('keeps the non-canonical allowlist honest', () => {
    const stale = [...NON_CANONICAL_ALLOWED.keys()].filter(
      (rel) => !specFiles.includes(rel) || /from '\.\/fixtures\.js'/.test(read(rel)),
    );
    expect(stale).toEqual([]);
  });

  it('inventories every auto-ready opt-out', () => {
    const declared = specFiles.filter((rel) => /wcfAutoReady:\s*false/.test(read(rel)));
    expect(declared.sort()).toEqual([...AUTO_READY_OPT_OUTS.keys()].sort());
  });

  it('requires each opt-out to declare a non-empty reason at the declaration site', () => {
    const missing = [...AUTO_READY_OPT_OUTS.keys()].filter((rel) => {
      const match = read(rel).match(/wcfAutoReadyReason:\s*(['"`])([\s\S]*?)\1/);
      return !match || match[2].trim() === '';
    });
    expect(missing).toEqual([]);
  });

  it('keeps the opt-out inventory free of stale entries', () => {
    const stale = [...AUTO_READY_OPT_OUTS.keys()].filter(
      (rel) => !specFiles.includes(rel) || !/wcfAutoReady:\s*false/.test(read(rel)),
    );
    expect(stale).toEqual([]);
  });
});
