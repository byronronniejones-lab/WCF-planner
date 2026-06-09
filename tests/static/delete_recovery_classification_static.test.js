import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {describe, expect, it} from 'vitest';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..', '..');

const EXPECTED_DELETE_TABLE_COUNTS = new Map([
  // Saved views (mig 095). cattle_breeding_cycles + sheep_lambing_records literal
  // deletes moved to audited RPCs in commit 235647c (no runtime delete remains);
  // cattle_calving_records moved to its RPC in mig 079 (removed below via the
  // override helper).
  ['app_saved_views', 1],
  ['cattle_calving_records', 2],
  ['cattle_comments', 2],
  ['cattle_feed_inputs', 1],
  ['cattle_feed_tests', 1],
  ['cattle_forecast_heifer_includes', 1],
  ['cattle_forecast_hidden', 1],
  ['cattle_processing_batches', 1],
  ['equipment_fuelings', 1],
  ['equipment_maintenance_events', 1],
  ['equipment_material_clears', 1],
  ['equipment_service_materials', 1],
  ['fuel_bills', 2],
  ['fuel_supplies', 1],
  ['layer_batches', 1],
  ['layer_housings', 1],
  ['profiles', 1],
  ['sheep_comments', 1],
  ['sheep_processing_batches', 1],
  ['task_templates', 2],
  ['weigh_in_sessions', 1],
  ['weigh_ins', 4],
]);

const DELETE_RECOVERY_CLASS = new Map([
  ['app_saved_views', 'saved-view-preference'],
  ['cattle_calving_records', 'animal-record-child'],
  ['cattle_comments', 'legacy-record-comment'],
  ['cattle_feed_inputs', 'admin-feed-config'],
  ['cattle_feed_tests', 'admin-feed-config'],
  ['cattle_forecast_heifer_includes', 'forecast-preference'],
  ['cattle_forecast_hidden', 'forecast-preference'],
  ['cattle_processing_batches', 'processing-workflow'],
  ['equipment_fuelings', 'equipment-log'],
  ['equipment_maintenance_events', 'equipment-log'],
  ['equipment_material_clears', 'admin-equipment-config'],
  ['equipment_service_materials', 'admin-equipment-config'],
  ['fuel_bills', 'document-index'],
  ['fuel_supplies', 'fuel-admin-config'],
  ['layer_batches', 'layer-workflow'],
  ['layer_housings', 'layer-workflow'],
  ['profiles', 'admin-user-management'],
  ['sheep_comments', 'legacy-record-comment'],
  ['sheep_processing_batches', 'processing-workflow'],
  ['task_templates', 'task-template-admin'],
  ['weigh_in_sessions', 'weigh-in-workflow'],
  ['weigh_ins', 'weigh-in-workflow'],
]);

const SOFT_DELETE_PROTECTED_ROOTS = [
  'cattle',
  'cattle_dailys',
  'egg_dailys',
  'layer_dailys',
  'pig_dailys',
  'poultry_dailys',
  'sheep',
  'sheep_dailys',
];

const EXPECTED_SOFT_DELETE_CONTRACTS = [
  {
    api: 'src/lib/cattleDeleteApi.js',
    migration: 'supabase-migrations/069_cattle_animal_soft_delete.sql',
    table: 'cattle',
    rpcNames: ['soft_delete_cattle_animal', 'restore_cattle_animal'],
    apiExports: ['softDeleteCattleAnimal', 'restoreCattleAnimal'],
  },
  {
    api: 'src/lib/sheepDeleteApi.js',
    migration: 'supabase-migrations/074_sheep_animal_soft_delete.sql',
    table: 'sheep',
    rpcNames: ['soft_delete_sheep_animal', 'restore_sheep_animal'],
    apiExports: ['softDeleteSheepAnimal', 'restoreSheepAnimal'],
  },
  {
    api: 'src/lib/dailyReportsApi.js',
    migration: 'supabase-migrations/067_daily_soft_delete.sql',
    table: 'daily roots',
    rpcNames: ['soft_delete_daily_report', 'restore_daily_report'],
    apiExports: ['softDeleteDailyReport', 'restoreDailyReport'],
  },
];

function stripComments(src) {
  return src.replace(/(^|\s)\/\/[^\n]*/g, '$1').replace(/\/\*[\s\S]*?\*\//g, '');
}

function listRuntimeSourceFiles(dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, {withFileTypes: true})) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...listRuntimeSourceFiles(full));
      continue;
    }
    if (!entry.isFile() || !/\.(jsx?|cjs|mjs)$/.test(entry.name)) continue;
    if (/\.(test|spec)\.(jsx?|cjs|mjs)$/.test(entry.name)) continue;
    out.push(full);
  }
  return out;
}

function runtimeSourceFiles() {
  return listRuntimeSourceFiles(path.join(ROOT, 'src'));
}

function hasTransactionalCalvingDeleteRpc() {
  return (
    fs.existsSync(path.join(ROOT, 'src/lib/cattleCalvingApi.js')) &&
    fs.existsSync(path.join(ROOT, 'supabase-migrations/079_delete_cattle_calving_record_rpc.sql'))
  );
}

function hasProcessingBatchDeleteRpcs() {
  return (
    fs.existsSync(path.join(ROOT, 'src/lib/processingBatchDeleteApi.js')) &&
    fs.existsSync(path.join(ROOT, 'supabase-migrations/100_processing_batch_lifecycle_rpcs.sql'))
  );
}

function hasWeighInDeleteRpcs() {
  return (
    fs.existsSync(path.join(ROOT, 'src/lib/weighInDeleteApi.js')) &&
    fs.existsSync(path.join(ROOT, 'supabase-migrations/101_weighin_delete_activity_rpcs.sql'))
  );
}

function hasEquipmentLogDeleteRpcs() {
  return (
    fs.existsSync(path.join(ROOT, 'src/lib/equipmentLogDeleteApi.js')) &&
    fs.existsSync(path.join(ROOT, 'supabase-migrations/102_equipment_log_delete_activity_rpcs.sql'))
  );
}

function expectedDeleteTableCounts() {
  const expected = new Map(EXPECTED_DELETE_TABLE_COUNTS);
  if (hasTransactionalCalvingDeleteRpc()) expected.delete('cattle_calving_records');
  // Processing-batch unschedule/delete moved to SECDEF RPCs (mig 100): no
  // runtime client delete remains on either processing-batch root.
  if (hasProcessingBatchDeleteRpcs()) {
    expected.delete('cattle_processing_batches');
    expected.delete('sheep_processing_batches');
  }
  // Weigh-in entry/session delete moved to SECDEF RPCs (mig 101): the
  // weigh_in_sessions delete is gone entirely; weigh_ins drops 4 -> 3 (the
  // broiler grid clear + two anon-webform deletes remain).
  if (hasWeighInDeleteRpcs()) {
    expected.delete('weigh_in_sessions');
    expected.set('weigh_ins', 3);
  }
  // Equipment fueling/maintenance deletes moved to SECDEF RPCs (mig 102): no
  // runtime client delete remains on either equipment-log table.
  if (hasEquipmentLogDeleteRpcs()) {
    expected.delete('equipment_fuelings');
    expected.delete('equipment_maintenance_events');
  }
  return expected;
}

function expectedDeleteRecoveryClass() {
  const expected = new Map(DELETE_RECOVERY_CLASS);
  if (hasTransactionalCalvingDeleteRpc()) expected.delete('cattle_calving_records');
  if (hasProcessingBatchDeleteRpcs()) {
    expected.delete('cattle_processing_batches');
    expected.delete('sheep_processing_batches');
  }
  // weigh_ins (3) still has client deletes and stays classified; only the
  // weigh_in_sessions root delete is fully gone after mig 101.
  if (hasWeighInDeleteRpcs()) {
    expected.delete('weigh_in_sessions');
  }
  if (hasEquipmentLogDeleteRpcs()) {
    expected.delete('equipment_fuelings');
    expected.delete('equipment_maintenance_events');
  }
  return expected;
}

function collectDeleteTables() {
  const deleteRe = /\.from\(\s*(['"])([^'"]+)\1\s*\)(?:(?!\.from\().){0,220}?\.delete\s*\(/gs;
  const tables = new Map();

  for (const file of runtimeSourceFiles()) {
    const code = stripComments(fs.readFileSync(file, 'utf8'));
    for (const match of code.matchAll(deleteRe)) {
      tables.set(match[2], (tables.get(match[2]) ?? 0) + 1);
    }
  }

  return tables;
}

function diffMap(expected, actual) {
  const unexpected = [...actual.keys()].filter((key) => !expected.has(key));
  const missing = [...expected.keys()].filter((key) => !actual.has(key));
  const wrongCounts = [...expected.entries()]
    .filter(([key, count]) => actual.get(key) !== count)
    .map(([key, count]) => `${key}: expected ${count}, saw ${actual.get(key) ?? 0}`);
  return {unexpected, missing, wrongCounts};
}

describe('delete/recovery classification inventory', () => {
  it('keeps every current literal table delete classified for recovery strategy work', () => {
    const tables = collectDeleteTables();
    const expectedCounts = expectedDeleteTableCounts();
    const expectedClasses = expectedDeleteRecoveryClass();
    const {unexpected, missing, wrongCounts} = diffMap(expectedCounts, tables);
    const unclassified = [...tables.keys()].filter((table) => !expectedClasses.has(table));
    const staleClasses = [...expectedClasses.keys()].filter((table) => !tables.has(table));

    expect([...tables.values()].reduce((sum, count) => sum + count, 0)).toBe(
      [...expectedCounts.values()].reduce((sum, count) => sum + count, 0),
    );
    expect(unexpected).toEqual([]);
    expect(missing).toEqual([]);
    expect(wrongCounts).toEqual([]);
    expect(unclassified).toEqual([]);
    expect(staleClasses).toEqual([]);
  });

  it('does not allow hard deletes on soft-delete protected animal and daily roots', () => {
    const tables = collectDeleteTables();
    const offenders = SOFT_DELETE_PROTECTED_ROOTS.filter((table) => tables.has(table));

    expect(offenders).toEqual([]);
  });

  it('keeps soft-delete RPC API wrappers and migrations paired for protected roots', () => {
    for (const contract of EXPECTED_SOFT_DELETE_CONTRACTS) {
      const api = fs.readFileSync(path.join(ROOT, contract.api), 'utf8');
      const migration = fs.readFileSync(path.join(ROOT, contract.migration), 'utf8');

      for (const exportName of contract.apiExports) {
        expect(api, `${contract.table}: ${exportName}`).toContain(`export async function ${exportName}`);
      }
      for (const rpcName of contract.rpcNames) {
        expect(api, `${contract.table}: api calls ${rpcName}`).toContain(`rpc('${rpcName}'`);
        expect(migration, `${contract.table}: migration defines ${rpcName}`).toContain(`public.${rpcName}`);
        expect(migration, `${contract.table}: ${rpcName} is SECDEF`).toMatch(
          new RegExp(`CREATE OR REPLACE FUNCTION public\\.${rpcName}[\\s\\S]*?SECURITY DEFINER`),
        );
      }
    }
  });

  it('locks the cattle calving-record delete as direct-client before 079 and RPC-backed after 079', () => {
    const tables = collectDeleteTables();

    if (!hasTransactionalCalvingDeleteRpc()) {
      expect(tables.get('cattle_calving_records')).toBe(2);
      return;
    }

    const api = fs.readFileSync(path.join(ROOT, 'src/lib/cattleCalvingApi.js'), 'utf8');
    const migration = fs.readFileSync(
      path.join(ROOT, 'supabase-migrations/079_delete_cattle_calving_record_rpc.sql'),
      'utf8',
    );

    expect(tables.has('cattle_calving_records')).toBe(false);
    expect(api).toContain('export async function deleteCattleCalvingRecord');
    expect(api).toContain("rpc('delete_cattle_calving_record'");
    expect(migration).toMatch(
      /CREATE OR REPLACE FUNCTION public\.delete_cattle_calving_record[\s\S]*?SECURITY DEFINER/,
    );
    expect(migration).toMatch(/DELETE FROM public\.cattle_calving_records/);
    expect(migration).toMatch(/INSERT INTO public\.activity_events/);
    expect(migration).toContain(
      'REVOKE ALL ON FUNCTION public.delete_cattle_calving_record(text, text) FROM PUBLIC, anon',
    );
    expect(migration).toContain(
      'GRANT EXECUTE ON FUNCTION public.delete_cattle_calving_record(text, text) TO authenticated',
    );
  });

  it('locks the processing-batch unschedule/delete as RPC-backed after migration 100', () => {
    const tables = collectDeleteTables();

    if (!hasProcessingBatchDeleteRpcs()) {
      expect(tables.get('cattle_processing_batches')).toBe(1);
      expect(tables.get('sheep_processing_batches')).toBe(1);
      return;
    }

    const api = fs.readFileSync(path.join(ROOT, 'src/lib/processingBatchDeleteApi.js'), 'utf8');
    const migration = fs.readFileSync(
      path.join(ROOT, 'supabase-migrations/100_processing_batch_lifecycle_rpcs.sql'),
      'utf8',
    );

    // No runtime client delete remains on either processing-batch root.
    expect(tables.has('cattle_processing_batches')).toBe(false);
    expect(tables.has('sheep_processing_batches')).toBe(false);

    expect(api).toContain('export async function unscheduleCattleProcessingBatch');
    expect(api).toContain("rpc('unschedule_cattle_processing_batch'");
    expect(api).toContain('export async function deleteSheepProcessingBatch');
    expect(api).toContain("rpc('delete_sheep_processing_batch'");

    for (const fn of ['unschedule_cattle_processing_batch', 'delete_sheep_processing_batch']) {
      expect(migration).toMatch(new RegExp(`CREATE OR REPLACE FUNCTION public\\.${fn}[\\s\\S]*?SECURITY DEFINER`));
      expect(migration).toContain(`REVOKE ALL ON FUNCTION public.${fn}(text, text) FROM PUBLIC, anon`);
      expect(migration).toContain(`GRANT EXECUTE ON FUNCTION public.${fn}(text, text) TO authenticated`);
    }
    // Both delete their batch root and log a record.deleted audit event in-txn.
    expect(migration).toMatch(/DELETE FROM public\.cattle_processing_batches/);
    expect(migration).toMatch(/DELETE FROM public\.sheep_processing_batches/);
    expect(migration).toMatch(/INSERT INTO public\.activity_events/);
    expect(migration).toContain("'record.deleted'");
    expect(migration).toContain("NOTIFY pgrst, 'reload schema'");
  });

  it('locks the weigh-in entry/session delete as RPC-backed after migration 101', () => {
    const tables = collectDeleteTables();

    if (!hasWeighInDeleteRpcs()) {
      expect(tables.get('weigh_in_sessions')).toBe(1);
      expect(tables.get('weigh_ins')).toBe(4);
      return;
    }

    const api = fs.readFileSync(path.join(ROOT, 'src/lib/weighInDeleteApi.js'), 'utf8');
    const migration = fs.readFileSync(
      path.join(ROOT, 'supabase-migrations/101_weighin_delete_activity_rpcs.sql'),
      'utf8',
    );

    // The session root delete is fully gone; weigh_ins drops to 3 (broiler grid
    // clear + two anon-webform deletes intentionally left untouched).
    expect(tables.has('weigh_in_sessions')).toBe(false);
    expect(tables.get('weigh_ins')).toBe(3);

    expect(api).toContain('export async function deleteWeighInEntry');
    expect(api).toContain("rpc('delete_weigh_in_entry'");
    expect(api).toContain('export async function deleteWeighInSession');
    expect(api).toContain("rpc('delete_weigh_in_session'");

    for (const fn of ['delete_weigh_in_entry', 'delete_weigh_in_session']) {
      expect(migration).toMatch(new RegExp(`CREATE OR REPLACE FUNCTION public\\.${fn}[\\s\\S]*?SECURITY DEFINER`));
      expect(migration).toContain(`REVOKE ALL ON FUNCTION public.${fn}(text, text, text) FROM PUBLIC, anon`);
      expect(migration).toContain(`GRANT EXECUTE ON FUNCTION public.${fn}(text, text, text) TO authenticated`);
    }
    // Entry + session deletions and their record.deleted audit events are in-txn.
    expect(migration).toMatch(/DELETE FROM public\.weigh_ins/);
    expect(migration).toMatch(/DELETE FROM public\.weigh_in_sessions/);
    expect(migration).toMatch(/INSERT INTO public\.activity_events/);
    expect(migration).toContain("'record.deleted'");
    expect(migration).toContain("NOTIFY pgrst, 'reload schema'");
  });

  it('hardens the weigh-in delete RPCs with FOR UPDATE (migration 103 follow-up)', () => {
    const p = path.join(ROOT, 'supabase-migrations/103_weighin_delete_for_update_hardening.sql');
    if (!fs.existsSync(p)) return; // follow-up not present yet
    const migration = fs.readFileSync(p, 'utf8');
    for (const fn of ['delete_weigh_in_entry', 'delete_weigh_in_session']) {
      expect(migration).toMatch(new RegExp(`CREATE OR REPLACE FUNCTION public\\.${fn}[\\s\\S]*?SECURITY DEFINER`));
    }
    // One FOR UPDATE per function: both the entry read and the session read lock
    // their target row so read+audit+delete is idempotent under concurrency.
    expect((migration.match(/FOR UPDATE/g) || []).length).toBeGreaterThanOrEqual(2);
    expect(migration).toContain("NOTIFY pgrst, 'reload schema'");
  });

  it('locks the equipment fueling/maintenance delete as RPC-backed after migration 102', () => {
    const tables = collectDeleteTables();

    if (!hasEquipmentLogDeleteRpcs()) {
      expect(tables.get('equipment_fuelings')).toBe(1);
      expect(tables.get('equipment_maintenance_events')).toBe(1);
      return;
    }

    const api = fs.readFileSync(path.join(ROOT, 'src/lib/equipmentLogDeleteApi.js'), 'utf8');
    const migration = fs.readFileSync(
      path.join(ROOT, 'supabase-migrations/102_equipment_log_delete_activity_rpcs.sql'),
      'utf8',
    );

    // No runtime client delete remains on either equipment-log table.
    expect(tables.has('equipment_fuelings')).toBe(false);
    expect(tables.has('equipment_maintenance_events')).toBe(false);

    expect(api).toContain('export async function deleteEquipmentFueling');
    expect(api).toContain("rpc('delete_equipment_fueling'");
    expect(api).toContain('export async function deleteEquipmentMaintenanceEvent');
    expect(api).toContain("rpc('delete_equipment_maintenance_event'");

    for (const fn of ['delete_equipment_fueling', 'delete_equipment_maintenance_event']) {
      expect(migration).toMatch(new RegExp(`CREATE OR REPLACE FUNCTION public\\.${fn}[\\s\\S]*?SECURITY DEFINER`));
      expect(migration).toContain(`REVOKE ALL ON FUNCTION public.${fn}(text, text, text) FROM PUBLIC, anon`);
      expect(migration).toContain(`GRANT EXECUTE ON FUNCTION public.${fn}(text, text, text) TO authenticated`);
    }
    // The fueling RPC mirrors the migration-092 privileged-delete role gate; the
    // maintenance RPC stays authenticated-only (its table has no role gate).
    expect(migration).toContain("'admin', 'management', 'farm_team', 'equipment_tech'");
    // Both row reads lock FOR UPDATE so the read+audit+delete is idempotent under
    // concurrency (no double-audit, no false ok on a second 0-row delete).
    expect((migration.match(/FOR UPDATE/g) || []).length).toBeGreaterThanOrEqual(2);
    // Both delete their row + log a record.deleted Activity event in-txn.
    expect(migration).toMatch(/DELETE FROM public\.equipment_fuelings/);
    expect(migration).toMatch(/DELETE FROM public\.equipment_maintenance_events/);
    expect(migration).toMatch(/INSERT INTO public\.activity_events/);
    expect(migration).toContain("'record.deleted'");
    expect(migration).toContain("NOTIFY pgrst, 'reload schema'");
  });

  it('keeps delete recovery classes in the documented allowed vocabulary', () => {
    const allowed = new Set([
      'admin-equipment-config',
      'admin-feed-config',
      'admin-user-management',
      'animal-record-child',
      'custom-editable-table-child',
      'document-index',
      'equipment-log',
      'forecast-preference',
      'fuel-admin-config',
      'layer-workflow',
      'legacy-record-comment',
      'processing-workflow',
      'saved-view-preference',
      'task-template-admin',
      'weigh-in-workflow',
    ]);
    const offenders = [...expectedDeleteRecoveryClass().entries()]
      .filter(([, klass]) => !allowed.has(klass))
      .map(([table, klass]) => `${table}: ${klass}`);

    expect(offenders).toEqual([]);
  });
});
