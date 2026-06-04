import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {describe, it, expect} from 'vitest';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..', '..');

function src(rel) {
  return fs.readFileSync(path.join(ROOT, rel), 'utf8');
}

describe('persistent list view state hotfix', () => {
  it('uses same-tab sessionStorage, not permanent localStorage, for scan filters', () => {
    const hook = src('src/lib/usePersistentViewState.js');
    expect(hook).toContain('window.sessionStorage');
    expect(hook).toContain("'wcf:view-state:'");
    expect(hook).not.toContain('localStorage');
  });

  it('persists cattle herd filters, sort, and view mode', () => {
    const view = src('src/cattle/CattleHerdsView.jsx');
    expect(view).toContain("usePersistentViewState('cattle.herds.viewMode'");
    expect(view).toContain("usePersistentViewState('cattle.herds.filters'");
    expect(view).toContain("usePersistentViewState('cattle.herds.sortRules'");
  });

  it('persists animal list and daily-report scan filters that navigate to records', () => {
    const files = [
      ['src/sheep/SheepFlocksView.jsx', 'sheep.flocks.search'],
      ['src/cattle/CattleDailysView.jsx', 'cattle.dailys.herdFilter'],
      ['src/sheep/SheepDailysView.jsx', 'sheep.dailys.flockFilter'],
      ['src/pig/PigDailysView.jsx', 'pig.dailys.batchFilter'],
      ['src/broiler/BroilerDailysView.jsx', 'broiler.dailys.batchFilter'],
      ['src/layer/LayerDailysView.jsx', 'layer.dailys.groupFilter'],
      ['src/layer/EggDailysView.jsx', 'layer.eggs.teamFilter'],
    ];
    for (const [rel, key] of files) {
      const view = src(rel);
      expect(view).toContain("from '../lib/usePersistentViewState.js'");
      expect(view).toContain(key);
    }
  });

  it('persists weigh-in, task, forecast, activity, and fuel-log scan filters', () => {
    const files = [
      ['src/cattle/CattleWeighInsView.jsx', 'cattle.weighins.statusFilter'],
      ['src/sheep/SheepWeighInsView.jsx', 'sheep.weighins.statusFilter'],
      ['src/livestock/LivestockWeighInsView.jsx', '.weighins.statusFilter'],
      ['src/tasks/MyTasksTab.jsx', 'tasks.my.filter'],
      ['src/tasks/CompletedTab.jsx', 'tasks.completed.filter'],
      ['src/cattle/CattleForecastView.jsx', 'cattle.forecast.yearFilter'],
      ['src/activity/ActivityLogView.jsx', 'activity.log.entityFilter'],
      ['src/equipment/EquipmentFuelLogView.jsx', 'equipment.fuelLog.equipmentFilter'],
    ];
    for (const [rel, key] of files) {
      const view = src(rel);
      expect(view).toContain('usePersistentViewState');
      expect(view).toContain(key);
    }
  });
});
