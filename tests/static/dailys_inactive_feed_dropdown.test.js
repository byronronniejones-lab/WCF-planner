import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {describe, it, expect} from 'vitest';

// Static lock: when a historical cattle/sheep daily report references a
// feed (or mineral) input that has since been marked `status='inactive'`,
// the edit-form dropdown must surface that legacy feed as a disabled
// "(inactive)" selected option. Selection lists still exclude inactives
// for new picks. Loaded array stays unfiltered so save-time .find() can
// rebuild the snapshot from the historical id.
//
// Locks against accidental simplifications that would either (a) drop
// the disabled-option fallback and re-introduce a blank dropdown when
// editing legacy rows, or (b) make inactive feeds available for new
// rows again.

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..', '..');
const cattleSrc = fs.readFileSync(path.join(ROOT, 'src/cattle/CattleDailysView.jsx'), 'utf8');
const sheepSrc = fs.readFileSync(path.join(ROOT, 'src/sheep/SheepDailysView.jsx'), 'utf8');

describe('Cattle daily edit dropdowns — inactive historical feed fallback', () => {
  it('feeds dropdown computes a showHistoricalInactive flag from status', () => {
    expect(cattleSrc).toMatch(/const showHistoricalInactive =\s*fiRow && fiRow\.status === 'inactive' &&/);
  });

  it('minerals dropdown computes a showHistoricalInactiveMineral flag from status', () => {
    expect(cattleSrc).toMatch(/const showHistoricalInactiveMineral =\s*miRow && miRow\.status === 'inactive' &&/);
  });

  it('feeds dropdown renders a disabled "(inactive)" option when the flag is on', () => {
    expect(cattleSrc).toMatch(/\{showHistoricalInactive && \(\s*<option value=\{fiRow\.id\} disabled>/);
    expect(cattleSrc).toMatch(/\(inactive\)/);
  });

  it('minerals dropdown renders a disabled "(inactive)" option when the flag is on', () => {
    expect(cattleSrc).toMatch(/\{showHistoricalInactiveMineral && \(\s*<option value=\{miRow\.id\} disabled>/);
  });

  it('feedsForHerd selection list still excludes inactive rows', () => {
    expect(cattleSrc).toMatch(/f\.status !== 'inactive' &&\s*f\.category !== 'mineral'/);
  });

  it('feedInputs loads unfiltered so historical .find lookups resolve inactive rows', () => {
    // Critical contract: the load-time filter MUST NOT exclude inactive
    // entries from the in-memory array, or the save-time .find()
    // resolution + the disabled-option fallback both break.
    expect(cattleSrc).not.toMatch(
      /cattle_feed_inputs[\s\S]{0,200}\.eq\(['"]status['"],\s*['"]active['"]\)|cattle_feed_inputs[\s\S]{0,200}filter\([^)]*status\s*===?\s*['"]active['"]/,
    );
  });
});

describe('Sheep daily edit dropdowns — inactive historical feed fallback', () => {
  it('feeds dropdown computes a showHistoricalInactive flag from status', () => {
    expect(sheepSrc).toMatch(/const showHistoricalInactive =\s*fiRow && fiRow\.status === 'inactive' &&/);
  });

  it('minerals dropdown computes a showHistoricalInactiveMineral flag from status', () => {
    expect(sheepSrc).toMatch(/const showHistoricalInactiveMineral =\s*miRow && miRow\.status === 'inactive' &&/);
  });

  it('feeds dropdown renders a disabled "(inactive)" option when the flag is on', () => {
    expect(sheepSrc).toMatch(/\{showHistoricalInactive && \(\s*<option value=\{fiRow\.id\} disabled>/);
    expect(sheepSrc).toMatch(/\(inactive\)/);
  });

  it('minerals dropdown renders a disabled "(inactive)" option when the flag is on', () => {
    expect(sheepSrc).toMatch(/\{showHistoricalInactiveMineral && \(\s*<option value=\{miRow\.id\} disabled>/);
  });

  it('feedsForFlock selection list still excludes inactive rows', () => {
    expect(sheepSrc).toMatch(/f\.status !== 'inactive' &&\s*f\.category !== 'mineral'/);
  });
});
