import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {describe, it, expect} from 'vitest';

// ============================================================================
// Pig.batch post-migration stabilization — record-page / load-race readiness
// ============================================================================
// The pig.batch hub + record pages render inside the app-level `dataLoaded`
// gate (AuthContext), but loadAllData() sets feederGroups in an earlier tick
// than dataLoaded, so there is a window where dataLoaded is true while
// feederGroups is still its initial value. The record page must show Loading
// until pig data has ACTUALLY loaded — keyed on a real readiness signal
// (PigContext.feedersLoaded), not `feederGroups.length` (which can't tell
// "still loading" from "loaded and genuinely empty" and raced cold-start e2e).
//
// Contract locked here:
//   1. PigContext owns + exposes feedersLoaded / setFeedersLoaded.
//   2. App.loadAllData sets feedersLoaded(true) in the SAME synchronous run as
//      setFeederGroups (before the dailys await) so the two batch into one
//      commit — feedersLoaded === true implies feederGroups is populated. It is
//      set UNCONDITIONALLY after the app_store if/else — a Supabase query error
//      returns {error} (it does NOT throw), so gating on !error would strand
//      the signal false on the error branch and recreate "Loading forever".
//   3. The signal is resolved on every load-resolve path (success-with-data,
//      success-empty, app_store {error}, hard-error catch, loadUser catch) and
//      reset on SIGNED_OUT — never stranded false.
//   4. The record page gates Loading / not-found on feedersLoaded, not
//      feederGroups.length, and exposes a data-pig-feeders-loaded DOM marker.
//   5. A Playwright helper waits on that marker; the flake-heavy specs use it.
// ============================================================================

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..', '..');

const pigCtx = fs.readFileSync(path.join(ROOT, 'src/contexts/PigContext.jsx'), 'utf8');
const mainSrc = fs.readFileSync(path.join(ROOT, 'src/main.jsx'), 'utf8');
const viewSrc = fs.readFileSync(path.join(ROOT, 'src/pig/PigBatchesView.jsx'), 'utf8');
const helperSrc = fs.readFileSync(path.join(ROOT, 'tests/helpers/pigReady.js'), 'utf8');

describe('PigContext — feedersLoaded readiness flag', () => {
  it('declares feedersLoaded state initialized false', () => {
    expect(pigCtx).toMatch(/const \[feedersLoaded, setFeedersLoaded\] = useState\(false\)/);
  });

  it('exposes feedersLoaded + setFeedersLoaded on the context value', () => {
    expect(pigCtx).toMatch(/\bfeedersLoaded,/);
    expect(pigCtx).toMatch(/\bsetFeedersLoaded,/);
  });
});

describe('App.loadAllData — resolves the pig readiness signal', () => {
  it('sets feedersLoaded(true) UNCONDITIONALLY after the app_store load (batched with setFeederGroups, before the dailys await)', () => {
    // The call sits after the app_store if/else block and BEFORE the
    // pig_dailys load comment, in the same synchronous run as setFeederGroups.
    expect(mainSrc).toMatch(/\n\s*setFeedersLoaded\(true\);\s*\n\s*\/\/ Load pig_dailys/);
    // It must NOT be gated on !error — that branch leaves the signal false and
    // recreates "Loading forever" (Supabase query errors return {error}, not a
    // throw, so the catch never sees them).
    expect(mainSrc).not.toMatch(/if \(!error\) setFeedersLoaded\(true\);/);
    // Ordering guard: setFeederGroups appears before this setFeedersLoaded call,
    // which in turn precedes the success-path setDataLoaded(true).
    const feederIdx = mainSrc.indexOf('setFeederGroups(fr.groups)');
    const loadedIdx = mainSrc.indexOf('\n      setFeedersLoaded(true);\n      // Load pig_dailys');
    expect(feederIdx).toBeGreaterThan(-1);
    expect(loadedIdx).toBeGreaterThan(feederIdx);
    const dataLoadedIdx = mainSrc.indexOf('setDataLoaded(true)', loadedIdx);
    expect(dataLoadedIdx).toBeGreaterThan(loadedIdx);
  });

  it('never strands the signal false — resolved on the returned-error path, error catches, reset on SIGNED_OUT', () => {
    // SIGNED_OUT resets it alongside dataLoaded.
    expect(mainSrc).toMatch(/setDataLoaded\(false\);\s*\n\s*setFeedersLoaded\(false\);/);
    // The unconditional post-load set covers the app_store {error} branch
    // (query error returns {error}, not a throw). Plus both error catches
    // (loadAllData catch + loadUser catch) resolve it true so the record page
    // shows not-found instead of Loading forever.
    expect((mainSrc.match(/setFeedersLoaded\(true\)/g) || []).length).toBeGreaterThanOrEqual(3);
  });
});

describe('PigBatchesView — record-page readiness gate + DOM marker', () => {
  it('gates the Loading state on !feedersLoaded (not feederGroups.length)', () => {
    expect(viewSrc).toMatch(/recordMode && !recordGroup && !feedersLoaded/);
    // The old length-based loading guard is gone.
    expect(viewSrc).not.toMatch(/recordMode && !recordGroup && feederGroups\.length === 0/);
  });

  it('gates the not-found state on feedersLoaded (not feederGroups.length > 0)', () => {
    expect(viewSrc).toMatch(/recordMode && !recordGroup && feedersLoaded/);
    expect(viewSrc).not.toMatch(/recordMode && !recordGroup && feederGroups\.length > 0/);
  });

  it('consumes feedersLoaded from usePig and exposes it as a DOM readiness marker', () => {
    expect(viewSrc).toMatch(/\bfeedersLoaded,/);
    expect(viewSrc).toMatch(/data-pig-feeders-loaded=\{feedersLoaded \? 'true' : 'false'\}/);
  });
});

describe('Playwright readiness helper — waits on the real signal, not boot-loader', () => {
  it('waits on the data-pig-feeders-loaded="true" marker with a generous timeout', () => {
    expect(helperSrc).toMatch(/export async function waitForPigFeedersLoaded/);
    expect(helperSrc).toMatch(/\[data-pig-feeders-loaded="true"\]/);
  });

  it('the flake-heavy pig specs import + use the helper after navigation', () => {
    for (const rel of [
      'tests/pig_batch_record_nav.spec.js',
      'tests/pig_batches_planned_trips.spec.js',
      'tests/pig_fcr_cache.spec.js',
      'tests/pig_batch_math.spec.js',
    ]) {
      const spec = fs.readFileSync(path.join(ROOT, rel), 'utf8');
      expect(spec, rel).toMatch(/import \{waitForPigFeedersLoaded\} from '\.\/helpers\/pigReady\.js'/);
      expect(spec, rel).toMatch(/waitForPigFeedersLoaded\(page\)/);
    }
  });

  it('the migrated pig specs no longer gate readiness on the static boot-loader', () => {
    // boot-loader -> 0 only meant React painted its first frame; replaced by
    // the real feedersLoaded marker wait.
    for (const rel of ['tests/pig_batch_record_nav.spec.js', 'tests/pig_batches_planned_trips.spec.js']) {
      const spec = fs.readFileSync(path.join(ROOT, rel), 'utf8');
      expect(spec, rel).not.toContain('#wcf-boot-loader');
    }
  });
});
