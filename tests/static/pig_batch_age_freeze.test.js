import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {describe, it, expect} from 'vitest';

// ============================================================================
// Pig batch age freeze on processor-trip empty — Hotfix 3 lock
// ============================================================================
// While Current > 0, age advances daily. Once Current hits 0 AND there is
// at least one processor trip, age freezes at the latest trip date so
// archived batches stop ticking forward. Mortality/transfer-only emptying
// keeps using today (no trip date to pin to).
//
// calcAgeRange is a closure inside PigBatchesView. Locking via source-shape
// assertions: the function must accept asOfDate, and the batch-card render
// path must compute latestTripDate + pass it when currentPigCount === 0.
// ============================================================================

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..', '..');

const src = fs.readFileSync(path.join(ROOT, 'src/pig/PigBatchesView.jsx'), 'utf8');

describe('PigBatchesView age freeze on processor-trip empty', () => {
  it('calcAgeRange accepts an optional asOfDate parameter', () => {
    expect(src).toMatch(/function calcAgeRange\(cycleId,\s*asOfDate\)/);
  });

  it('calcAgeRange uses asOfDate as the reference instead of today when provided', () => {
    // Reference variable computed from asOfDate (with NaN/Date guard)
    expect(src).toMatch(/asOfDate\s+instanceof\s+Date/);
    // Day-delta math uses the ref variable, not `today`
    expect(src).toMatch(/oldestDays\s*=\s*Math\.round\(\(ref\s*-\s*firstDate\)/);
    expect(src).toMatch(/youngestDays\s*=\s*Math\.round\(\(ref\s*-\s*lastDate\)/);
  });

  it('batch card derives latestTripDate from trips before computing ageRange', () => {
    expect(src).toMatch(/const\s+latestTripDate\s*=\s*\n?\s*trips\s*\n?\s*\.map/);
  });

  it('batch card freezes ageRange when currentPigCount === 0 AND a trip date exists', () => {
    // Conditional pins the reference to the trip date, otherwise default today.
    expect(src).toMatch(
      /currentPigCount\s*===\s*0\s*&&\s*latestTripDate\s*\n?\s*\?\s*calcAgeRange\(g\.cycleId,\s*new Date\(latestTripDate\s*\+\s*'T12:00:00'\)\)\s*\n?\s*:\s*calcAgeRange\(g\.cycleId\)/,
    );
  });

  it('does not freeze when there are no trips (mortality/transfer-only emptying)', () => {
    // The condition requires latestTripDate truthy; when trips=[], that's null
    // and calcAgeRange falls through to the default (today). Lock that the
    // freeze branch's && requires both halves, not just the count.
    const m = src.match(
      /currentPigCount\s*===\s*0\s*&&\s*latestTripDate\s*\n?\s*\?\s*calcAgeRange\(g\.cycleId,\s*new Date\(latestTripDate/,
    );
    expect(m).not.toBeNull();
  });

  it('removed the early ageRange computation that ran before currentPigCount was known', () => {
    // The pre-hotfix call site sat between `tl = ...calcBreedingTimeline...`
    // and `const sc = statusColors...`. Make sure that exact early invocation
    // is gone — leaving it would silently shadow the freeze logic.
    expect(src).not.toMatch(
      /const tl = cycle \? calcBreedingTimeline\(cycle\.exposureStart\) : null;\s*\n\s*const ageRange = calcAgeRange\(g\.cycleId\);\s*\n\s*const sc/,
    );
  });
});
