import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {describe, expect, it} from 'vitest';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..', '..');
const homeSrc = fs.readFileSync(path.join(ROOT, 'src/layer/LayersHomeView.jsx'), 'utf8');
const batchesSrc = fs.readFileSync(path.join(ROOT, 'src/layer/LayerBatchesView.jsx'), 'utf8');

describe('Layer dashboard active-batch lifetime stats', () => {
  it('removes the active-batch 30/90/120 rolling-window toggle', () => {
    expect(homeSrc).toMatch(/ACTIVE BATCHES[\s\S]*?LIFETIME/);
    expect(homeSrc).not.toMatch(/layerDashPeriod/);
    expect(homeSrc).not.toMatch(/setLayerDashPeriod/);
    expect(homeSrc).not.toMatch(/ACTIVE BATCHES[\s\S]{0,200}ROLLING WINDOW/);
  });

  it('computes active batch cards from lifetime start through today', () => {
    expect(homeSrc).toMatch(/lifetimeFromForBatch/);
    expect(homeSrc).toMatch(
      /const lifetimeFrom = lifetimeFromForBatch\(batch\);[\s\S]*computeBatchWindow\(batch, lifetimeFrom, today\)/,
    );
  });

  it('does not render lbs-per-dozen metrics in the layer dashboard or batches tab', () => {
    expect(homeSrc).not.toMatch(/Lbs\/dozen|feedPerDoz/);
    expect(batchesSrc).not.toMatch(/Feed \/ Dozen|feedPerDozen/);
  });

  it('does not repeat housing metrics when a batch has only one housing', () => {
    expect(homeSrc).toMatch(/myHousings\.length > 1 && \(/);
    expect(batchesSrc).toMatch(/batchHousings\.length > 1 && \(/);
  });

  it('keeps Cost / Dozen in the batch summary but removes the duplicate lifetime performance tile', () => {
    expect(batchesSrc).toMatch(/Cost \/ Dozen/);
    expect(batchesSrc).not.toMatch(/Cost \/ Dozen \(lifetime\)/);
  });
});
