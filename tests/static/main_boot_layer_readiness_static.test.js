import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {describe, it, expect} from 'vitest';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..', '..');
const mainSrc = fs.readFileSync(path.join(ROOT, 'src/main.jsx'), 'utf8');

// Boot-order contract: the layer global load must be coupled to dataLoaded so
// routes never render with empty layerBatches/layerHousings on a cold direct
// load — WITHOUT serializing it (kept parallel via the existing boot await) and
// WITHOUT gating the app on a layer query failure.
describe('main.jsx boot — layer load coupled to dataLoaded', () => {
  it('captures the layer load as a named promise (not fire-and-forget)', () => {
    expect(mainSrc).toMatch(/var layerDataPromise = Promise\.all\(\[lbPromise, lhPromise\]\)/);
  });

  it('still sets layer state + syncWebformConfig inside the layer load path, after housing data resolves', () => {
    expect(mainSrc).toMatch(
      /layerDataPromise = Promise\.all\([\s\S]*?setLayerBatches\(lbData\);[\s\S]*?setLayerHousings\(lhData2\);[\s\S]*?syncWebformConfig\(/,
    );
  });

  it('awaits layerDataPromise alongside the dailys before setDataLoaded(true)', () => {
    expect(mainSrc).toMatch(
      /await Promise\.all\(\[\s*pigDailysPromise,\s*poultryDailysPromise,\s*layerDataPromise,?\s*\]\)/,
    );
    expect(mainSrc).toMatch(/await Promise\.all\(\[[\s\S]*?layerDataPromise[\s\S]*?\]\);[\s\S]*?setDataLoaded\(true\)/);
  });

  it('layer load failure cannot strand boot — local catch falls back to empty arrays', () => {
    expect(mainSrc).toMatch(
      /layerDataPromise = Promise\.all[\s\S]*?\.catch\(function \(e\) \{[\s\S]*?setLayerBatches\(\[\]\);[\s\S]*?setLayerHousings\(\[\]\);/,
    );
  });

  it('does NOT move pig readiness behind the slow daily await (feedersLoaded stays before it)', () => {
    expect(mainSrc).toMatch(/setFeedersLoaded\(true\);[\s\S]*?pigDailysPromise = \(async/);
  });
});
