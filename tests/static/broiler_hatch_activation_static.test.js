import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {describe, it, expect} from 'vitest';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..', '..');

const mainSrc = fs.readFileSync(path.join(ROOT, 'src/main.jsx'), 'utf8');
const broilerSrc = fs.readFileSync(path.join(ROOT, 'src/lib/broiler.js'), 'utf8');
const broilerListSrc = fs.readFileSync(path.join(ROOT, 'src/broiler/BroilerListView.jsx'), 'utf8');

describe('broiler hatch-date auto-activation hotfix', () => {
  it('exports the planned hatch-date promotion predicate from broiler.js', () => {
    expect(broilerSrc).toMatch(/export function shouldAutoActivateBroilerBatch/);
    expect(broilerSrc).toMatch(/batch\.status !== 'planned'/);
    expect(broilerSrc).toMatch(/today >= hatchDate/);
  });

  it('loadAllData persists planned -> active promotion for due hatch dates', () => {
    expect(mainSrc).toMatch(/shouldAutoActivateBroilerBatch\(nb\)/);
    expect(mainSrc).toMatch(/nb = \{\.\.\.nb, status: 'active'\}/);
    expect(mainSrc).toMatch(/perLbStarterCost = loadedFeedCosts\.starter/);
    expect(mainSrc).toMatch(/perLbStandardCost = loadedFeedCosts\.grower/);
  });

  it('updates store[ppp-v4] before webform mirror sync reads it', () => {
    const promoteIdx = mainSrc.indexOf("store['ppp-v4'] = migrated");
    const syncIdx = mainSrc.indexOf("buildBroilerPublicMirror(store['ppp-v4'] || [])");
    expect(promoteIdx).toBeGreaterThan(-1);
    expect(syncIdx).toBeGreaterThan(promoteIdx);
  });

  it('the broiler list displays the computed status, not the stale stored status', () => {
    expect(broilerListSrc).toMatch(/const autoSt = calcPoultryStatus\(b\)/);
    expect(broilerListSrc).toMatch(/<span style=\{S\.badge\(S2\.bg, S2\.tx\)\}>\{autoSt\}<\/span>/);
  });
});
