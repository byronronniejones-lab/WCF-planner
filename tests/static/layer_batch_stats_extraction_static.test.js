import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {describe, it, expect} from 'vitest';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..', '..');

const viewSrc = fs.readFileSync(path.join(ROOT, 'src/layer/LayerBatchesView.jsx'), 'utf8');
const helperSrc = fs.readFileSync(path.join(ROOT, 'src/layer/layerBatchStats.js'), 'utf8');
const registrySrc = fs.readFileSync(path.join(ROOT, 'src/lib/activityRegistry.js'), 'utf8');
const mainSrc = fs.readFileSync(path.join(ROOT, 'src/main.jsx'), 'utf8');

describe('layerBatchStats helper module — surface', () => {
  it('exports HOUSING_CAPS, getHousingCap, inRange, calcPhaseFromAge, computeBatchStats, computeHousingStats', () => {
    expect(helperSrc).toContain('export const HOUSING_CAPS');
    expect(helperSrc).toContain('export function getHousingCap');
    expect(helperSrc).toContain('export function inRange');
    expect(helperSrc).toContain('export function calcPhaseFromAge');
    expect(helperSrc).toContain('export function computeBatchStats');
    expect(helperSrc).toContain('export function computeHousingStats');
  });

  it('is presentation- and side-effect-free (no React, no Supabase, no Activity)', () => {
    expect(helperSrc).not.toMatch(/from\s+['"]react['"]/);
    expect(helperSrc).not.toMatch(/from\s+['"]@supabase/);
    expect(helperSrc).not.toMatch(/useState|useEffect|useRef|JSX|render/);
    expect(helperSrc).not.toContain('ActivityPanel');
    expect(helperSrc).not.toContain('ActivityModal');
    expect(helperSrc).not.toContain('recordActivityEvent');
    expect(helperSrc).not.toContain('recordFieldChange');
    expect(helperSrc).not.toContain("from('");
    expect(helperSrc).not.toContain('.update(');
    expect(helperSrc).not.toContain('.insert(');
    expect(helperSrc).not.toContain('.delete(');
  });

  it('preserves feed phase thresholds 21 and 140', () => {
    expect(helperSrc).toContain('days < 21');
    expect(helperSrc).toContain('days < 140');
  });

  it('falls back to LAYER when anchor and storedType are missing', () => {
    expect(helperSrc).toMatch(/storedType\s*\|\|\s*'LAYER'/);
  });
});

describe('LayerBatchesView — uses the extracted helpers', () => {
  it('imports getHousingCap, computeBatchStats, and computeHousingStats', () => {
    expect(viewSrc).toMatch(/import\s+\{[^}]*getHousingCap[^}]*\}\s+from\s+['"]\.\/layerBatchStats\.js['"]/);
    expect(viewSrc).toMatch(/import\s+\{[^}]*computeBatchStats[^}]*\}\s+from\s+['"]\.\/layerBatchStats\.js['"]/);
    expect(viewSrc).toMatch(/import\s+\{[^}]*computeHousingStats[^}]*\}\s+from\s+['"]\.\/layerBatchStats\.js['"]/);
  });

  it('no longer defines HOUSING_CAPS or getHousingCap inline', () => {
    expect(viewSrc).not.toMatch(/^\s*const\s+HOUSING_CAPS\s*=\s*\{/m);
    expect(viewSrc).not.toMatch(/^\s*const\s+getHousingCap\s*=/m);
  });

  it('no longer defines inRange or calcPhaseFromAge inline', () => {
    expect(viewSrc).not.toMatch(/function\s+inRange\s*\(/);
    expect(viewSrc).not.toMatch(/function\s+calcPhaseFromAge\s*\(/);
  });

  it('calls computeBatchStats and computeHousingStats inside the load effect', () => {
    expect(viewSrc).toContain('setBatchStats(computeBatchStats(');
    expect(viewSrc).toContain('setHousingStats(computeHousingStats(');
  });

  it('preserves the existing computeProjectedCount/computeHousingDisplayCount/computeLayerFeedCost imports', () => {
    expect(viewSrc).toContain('computeProjectedCount');
    expect(viewSrc).toContain('computeHousingDisplayCount');
    expect(viewSrc).toContain('computeLayerFeedCost');
    expect(viewSrc).toContain("from '../lib/layerHousing.js'");
  });
});

describe('LayerBatchesView — no premature record-page migration (this lane is preflight only)', () => {
  it('still uses ActivityPanel + ActivityModal as legacy inline surfaces', () => {
    expect(viewSrc).toContain('ActivityPanel');
    expect(viewSrc).toContain('ActivityModal');
  });

  it('still listens for wcf-entity-deep-link for layer.batch and layer.housing', () => {
    expect(viewSrc).toContain('wcf-entity-deep-link');
    expect(viewSrc).toContain("entityType !== 'layer.batch'");
    expect(viewSrc).toContain("entityType !== 'layer.housing'");
  });

  it('does not yet import RecordCollaborationSection', () => {
    expect(viewSrc).not.toContain('RecordCollaborationSection');
  });

  it('does not yet introduce /layer/batches/<id> or /layer/housings/<id> routing in this view', () => {
    expect(viewSrc).not.toContain("navigate('/layer/batches/'");
    expect(viewSrc).not.toContain("navigate('/layer/housings/'");
  });

  it('activityRegistry routes for layer.batch + layer.housing still point at the list view, not a per-record route', () => {
    expect(registrySrc).toMatch(/LAYER_BATCH[\s\S]*?route:\s*\(_id\)\s*=>\s*'\/layer\/batches'/);
    expect(registrySrc).toMatch(/LAYER_HOUSING[\s\S]*?route:\s*\(_id\)\s*=>\s*'\/layer\/batches'/);
  });

  it('main.jsx URL adapter does not yet detect a /layer/batches/<id> or /layer/housings/<id> subpath', () => {
    expect(mainSrc).not.toContain("location.pathname.startsWith('/layer/batches/')");
    expect(mainSrc).not.toContain("location.pathname.startsWith('/layer/housings/')");
  });
});
