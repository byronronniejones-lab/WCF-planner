import {describe, it, expect} from 'vitest';
import fs from 'fs';
import path from 'path';
import {fileURLToPath} from 'url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

function read(rel) {
  return fs.readFileSync(path.join(ROOT, rel), 'utf8');
}

const cattleHome = read('src/cattle/CattleHomeView.jsx');
const sheepHome = read('src/sheep/SheepHomeView.jsx');

describe('animal home dashboards - cold-boot readiness', () => {
  it('CattleHomeView fails closed on required boot read errors', () => {
    expect(cattleHome).toMatch(/import\s+InlineNotice\s+from\s+['"]\.\.\/shared\/InlineNotice\.jsx['"]/);
    expect(cattleHome).toMatch(/const\s+\[loadError,\s*setLoadError\]\s*=\s*useState\(null\)/);
    expect(cattleHome).toMatch(/async\s+function\s+loadAll\(\)/);
    expect(cattleHome).toContain('loadCattleWeighInsCached(sb, {throwOnError: true})');

    for (const table of [
      'cattle',
      'cattle_dailys',
      'cattle_calving_records',
      'cattle_nutrition_targets',
      'cattle_processing_batches',
    ]) {
      expect(cattleHome, `CattleHomeView must throw on ${table} errors`).toContain(`throw new Error('${table}: ' +`);
    }

    for (const clearCall of [
      'setCattle([]);',
      'setDailys([]);',
      'setWeighIns([]);',
      'setCalving([]);',
      'setTargets({});',
      'setForecastTile(null);',
    ]) {
      expect(cattleHome, `CattleHomeView must clear ${clearCall} on catch`).toContain(clearCall);
    }
  });

  it('CattleHomeView exposes loaded/error retry markers and hides false empty content', () => {
    expect(cattleHome).toContain("data-cattle-home-loaded={loading || loadError ? 'false' : 'true'}");
    expect(cattleHome).toContain('data-cattle-home-load-retry="1"');
    expect(cattleHome).toMatch(/data-cattle-home-load-retry="1"[\s\S]*?onClick=\{loadAll\}/);
    expect(cattleHome).toMatch(/<InlineNotice\s+notice=\{loadError\}/);
    expect(cattleHome).toMatch(/!\s*loadError\s*&&\s*forecastTile\s*&&/);
    expect(cattleHome).toMatch(/!\s*loadError\s*&&\s*activeHerdsWithCows\.length\s*>\s*0\s*&&/);
    expect(cattleHome).toContain('!loading && !loadError && totalCattle === 0');
  });

  it('SheepHomeView fails closed on required boot read errors', () => {
    expect(sheepHome).toMatch(/import\s+InlineNotice\s+from\s+['"]\.\.\/shared\/InlineNotice\.jsx['"]/);
    expect(sheepHome).toMatch(/const\s+\[loadError,\s*setLoadError\]\s*=\s*useState\(null\)/);
    expect(sheepHome).toMatch(/async\s+function\s+loadAll\(\)/);

    for (const table of ['weigh_in_sessions', 'weigh_ins', 'sheep', 'sheep_dailys']) {
      expect(sheepHome, `SheepHomeView must throw on ${table} errors`).toContain(`throw new Error('${table}: ' +`);
    }

    for (const clearCall of [
      'setSheep([]);',
      'setDailys([]);',
      'setWeighIns([]);',
      'setBatchCounts({total: 0, planned: 0});',
    ]) {
      expect(sheepHome, `SheepHomeView must clear ${clearCall} on catch`).toContain(clearCall);
    }
  });

  it('SheepHomeView exposes loaded/error retry markers and hides false empty content', () => {
    expect(sheepHome).toContain("data-sheep-home-loaded={loading || loadError ? 'false' : 'true'}");
    expect(sheepHome).toContain('data-sheep-home-load-retry="1"');
    expect(sheepHome).toMatch(/data-sheep-home-load-retry="1"[\s\S]*?onClick=\{loadAll\}/);
    expect(sheepHome).toMatch(/<InlineNotice\s+notice=\{loadError\}/);
    expect(sheepHome).toMatch(/!\s*loading\s*&&\s*!\s*loadError\s*&&\s*\(/);
    expect(sheepHome).toContain('!loading && !loadError && totalSheep === 0');
  });
});
