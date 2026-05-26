import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {describe, it, expect} from 'vitest';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..', '..');

const broilerList = fs.readFileSync(path.join(ROOT, 'src/broiler/BroilerListView.jsx'), 'utf8');
const layerBatches = fs.readFileSync(path.join(ROOT, 'src/layer/LayerBatchesView.jsx'), 'utf8');
const cattleHerds = fs.readFileSync(path.join(ROOT, 'src/cattle/CattleHerdsView.jsx'), 'utf8');
const sheepFlocks = fs.readFileSync(path.join(ROOT, 'src/sheep/SheepFlocksView.jsx'), 'utf8');
const activityPanel = fs.readFileSync(path.join(ROOT, 'src/shared/ActivityPanel.jsx'), 'utf8');

// CattleHerdsView, SheepFlocksView, and EquipmentFleetView no longer render
// Activity chips/modal — they use dedicated record pages with inline
// Comments + Activity sections.
const SURFACES = [
  {name: 'BroilerListView', src: broilerList, entity: 'broiler.batch', idField: 'b.name'},
  {name: 'LayerBatchesView (batch)', src: layerBatches, entity: 'layer.batch', idField: 'batch.id'},
  {name: 'LayerBatchesView (housing)', src: layerBatches, entity: 'layer.housing', idField: 'h.id'},
];

describe('Activity tile wiring — compact chips', () => {
  for (const s of SURFACES) {
    it(`${s.name} renders ActivityPanel compact for ${s.entity}`, () => {
      expect(s.src).toContain('ActivityPanel');
      expect(s.src).toContain(`entityType: '${s.entity}'`);
      expect(s.src).toContain("mode: 'compact'");
    });
  }
});

describe('Activity tile wiring — ActivityModal', () => {
  for (const {name, src} of [
    {name: 'BroilerListView', src: broilerList},
    {name: 'LayerBatchesView', src: layerBatches},
  ]) {
    it(`${name} renders ActivityModal`, () => {
      expect(src).toContain('ActivityModal');
      expect(src).toContain('activityTarget');
    });
  }
});

describe('Activity tile wiring — stopPropagation', () => {
  for (const s of SURFACES) {
    it(`${s.name} has stopPropagation on ${s.entity} chip`, () => {
      expect(s.src).toContain('stopPropagation');
    });
  }
});

describe('Activity tile wiring — data hooks', () => {
  for (const s of SURFACES) {
    it(`${s.name} has data-activity-surface for ${s.entity}`, () => {
      expect(s.src).toContain(`data-activity-surface="${s.entity}"`);
    });
  }
});

describe('Activity tile wiring — entity IDs', () => {
  it('broiler.batch uses batch.name as entityId', () => {
    expect(broilerList).toMatch(/entityId:\s*b\.name/);
  });

  it('layer.batch uses batch.id', () => {
    expect(layerBatches).toMatch(/entityType:\s*'layer\.batch'[\s\S]*?entityId:\s*batch\.id/);
  });

  it('layer.housing uses h.id', () => {
    expect(layerBatches).toMatch(/entityType:\s*'layer\.housing'[\s\S]*?entityId:\s*h\.id/);
  });
});

describe('Activity tile wiring — authState', () => {
  for (const {name, src} of [
    {name: 'BroilerListView', src: broilerList},
    {name: 'LayerBatchesView', src: layerBatches},
  ]) {
    it(`${name} passes authState to ActivityModal/Panel`, () => {
      expect(src).toContain('authState');
    });
  }
});

describe('No direct activity table access', () => {
  const allSrc = [broilerList, layerBatches, cattleHerds, sheepFlocks];
  it('no view directly queries activity_events or activity_mentions', () => {
    for (const src of allSrc) {
      expect(src).not.toContain("from('activity_events')");
      expect(src).not.toContain("from('activity_mentions')");
    }
  });
});

describe('Cattle + sheep wired in both flat and grouped modes', () => {
  it('CattleHerdsView has cattle.animal chips in both flat and grouped rows', () => {
    const flatIdx = cattleHerds.indexOf('sortedFlat');
    const groupedIdx = cattleHerds.indexOf('herdOpen');
    const flatChip = cattleHerds.indexOf("entityType: 'cattle.animal'");
    const groupedChip = cattleHerds.indexOf("entityType: 'cattle.animal'", flatChip + 1);
    expect(flatChip).toBeGreaterThan(-1);
    expect(groupedChip).toBeGreaterThan(flatChip);
  });
});

describe('ActivityPanel compact click includes entityCtx', () => {
  it('onCompactClick payload includes entityCtx', () => {
    expect(activityPanel).toContain('entityCtx, entityRoute');
  });
});
