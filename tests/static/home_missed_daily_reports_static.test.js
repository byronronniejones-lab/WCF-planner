import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {describe, it, expect} from 'vitest';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..', '..');

const dashSrc = fs.readFileSync(path.join(ROOT, 'src/dashboard/HomeDashboard.jsx'), 'utf8');

describe('HomeDashboard — pig breeding stock missed dailys', () => {
  it('destructures breeders from usePig()', () => {
    expect(dashSrc).toMatch(/\bbreeders\b/);
    expect(dashSrc).toMatch(/usePig\(\)/);
  });

  it('computes hasActiveSows from non-archived Sow/Gilt breeders', () => {
    expect(dashSrc).toContain('hasActiveSows');
    expect(dashSrc).toMatch(/!b\.archived\s*&&\s*\(b\.sex === 'Sow' \|\| b\.sex === 'Gilt'\)/);
  });

  it('computes hasActiveBoars from non-archived Boar breeders', () => {
    expect(dashSrc).toContain('hasActiveBoars');
    expect(dashSrc).toMatch(/!b\.archived\s*&&\s*b\.sex === 'Boar'/);
  });

  it('checks pigCheck for sows label (lowercase match)', () => {
    expect(dashSrc).toContain("pigCheck.has('sows')");
  });

  it('checks pigCheck for boars label (lowercase match)', () => {
    expect(dashSrc).toContain("pigCheck.has('boars')");
  });

  it('uses pig-stock-sows stable key prefix', () => {
    expect(dashSrc).toContain('pig-stock-sows|');
  });

  it('uses pig-stock-boars stable key prefix', () => {
    expect(dashSrc).toContain('pig-stock-boars|');
  });

  it('pushes SOWS missed row with pig icon and Pig type', () => {
    expect(dashSrc).toMatch(/label:\s*'SOWS'/);
    expect(dashSrc).toMatch(/SOWS.*iconKey:\s*ANIMAL_ICON_KEYS\.pig/s);
  });

  it('pushes BOARS missed row with pig icon and Pig type', () => {
    expect(dashSrc).toMatch(/label:\s*'BOARS'/);
    expect(dashSrc).toMatch(/BOARS.*iconKey:\s*ANIMAL_ICON_KEYS\.pig/s);
  });

  it('does not flag SOWS when hasActiveSows is false', () => {
    expect(dashSrc).toMatch(/if\s*\(hasActiveSows\)/);
  });

  it('does not flag BOARS when hasActiveBoars is false', () => {
    expect(dashSrc).toMatch(/if\s*\(hasActiveBoars\)/);
  });

  it('respects missedCleared for sows key', () => {
    expect(dashSrc).toMatch(/pig-stock-sows.*missedCleared/s);
  });

  it('respects missedCleared for boars key', () => {
    expect(dashSrc).toMatch(/pig-stock-boars.*missedCleared/s);
  });
});

describe('HomeDashboard — green banner includes breeding stock', () => {
  it('uses hasAnyActivePig for the all-clear condition', () => {
    expect(dashSrc).toContain('hasAnyActivePig');
  });

  it('hasAnyActivePig includes active feeder groups', () => {
    expect(dashSrc).toMatch(/hasAnyActivePig[\s\S]*?feederGroups\.some/);
  });

  it('hasAnyActivePig includes non-archived breeders', () => {
    expect(dashSrc).toMatch(/hasAnyActivePig[\s\S]*?breeders.*!b\.archived/);
  });

  it('green banner references hasAnyActivePig not activePigBatches2', () => {
    expect(dashSrc).toMatch(/allMissed\.length === 0[\s\S]*?hasAnyActivePig/);
    expect(dashSrc).not.toMatch(/allMissed\.length === 0[\s\S]*?activePigBatches2/);
  });
});

describe('HomeDashboard — existing feeder group behavior unchanged', () => {
  it('still checks feederGroups for active status', () => {
    expect(dashSrc).toMatch(/feederGroups[\s\S]*?\.filter\(\(g\)\s*=>\s*g\.status === 'active'\)/);
  });

  it('still checks sub-batches for active status', () => {
    expect(dashSrc).toMatch(/activeSubs\s*=\s*subs\.filter/);
  });
});
