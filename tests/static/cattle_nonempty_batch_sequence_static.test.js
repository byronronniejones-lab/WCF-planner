import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {describe, expect, it} from 'vitest';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const migration = fs.readFileSync(
  path.join(ROOT, 'supabase-migrations/182_cattle_nonempty_batch_sequence.sql'),
  'utf8',
);
const view = fs.readFileSync(path.join(ROOT, 'src/cattle/CattleBatchesView.jsx'), 'utf8');
const helper = fs.readFileSync(path.join(ROOT, 'src/lib/cattleProcessingBatch.js'), 'utf8');
const modal = fs.readFileSync(path.join(ROOT, 'src/cattle/CattleSendToProcessorModal.jsx'), 'utf8');

describe('migration 182 — atomic non-empty cattle batch sequence', () => {
  it('is authenticated management/admin-only and validates a stale plan under locks', () => {
    expect(migration).toContain('reconcile_cattle_scheduled_batches');
    expect(migration).toMatch(/v_role NOT IN \('admin', 'management'\)/);
    expect(migration).toMatch(/ORDER BY b\.id\s+FOR UPDATE/);
    expect(migration).toMatch(/v_row\.status IS DISTINCT FROM 'scheduled'/);
    expect(migration).toMatch(/v_row\.name IS DISTINCT FROM v_expected/);
    expect(migration).toContain('pg_advisory_xact_lock(182001)');
  });

  it('refuses to delete any batch with attached detail or cattle references', () => {
    expect(migration).toMatch(/jsonb_array_length\(COALESCE\(v_row\.cows_detail, '\[\]'::jsonb\)\) <> 0/);
    expect(migration).toMatch(/c\.processing_batch_id = v_id/);
    expect(migration).toContain('refusing to drop non-empty batch');
  });

  it('deletes empty rows before collision-safe chained renames and audits both', () => {
    const deleteAt = migration.indexOf('DELETE FROM public.cattle_processing_batches');
    const temporaryAt = migration.indexOf("SET name = '__cattle_reconcile__'");
    const finalAt = migration.indexOf('SET name = v_target');
    expect(deleteAt).toBeGreaterThan(-1);
    expect(temporaryAt).toBeGreaterThan(deleteAt);
    expect(finalAt).toBeGreaterThan(temporaryAt);
    expect(migration).toContain('auto_unschedule_zero_cows');
    expect(migration).toContain('auto_close_zero_month_gap');
    expect(migration).toContain('PERFORM public.reconcile_planner_to_processing();');
  });

  it('keeps the RPC unavailable to anon and public', () => {
    expect(migration).toMatch(
      /REVOKE ALL ON FUNCTION public\.reconcile_cattle_scheduled_batches\(jsonb, text\) FROM PUBLIC, anon/,
    );
    expect(migration).toMatch(
      /GRANT EXECUTE ON FUNCTION public\.reconcile_cattle_scheduled_batches\(jsonb, text\) TO authenticated/,
    );
  });
});

describe('client wiring — fail closed and reconcile before promotion', () => {
  it('only auto-reconciles after every forecast input loaded successfully', () => {
    expect(view).toContain('forecastInputsReliable');
    expect(view).toMatch(/setForecastInputsReliable\(forecastSidecarErrors\.length === 0\)/);
    expect(view).toMatch(/!canEdit \|\| !forecastInputsReliable \|\| !plan \|\| plan\.safe !== true/);
  });

  it('uses the SECDEF RPC wrapper from both Batches and Send-to-Processor', () => {
    expect(helper).toContain("sb.rpc('reconcile_cattle_scheduled_batches'");
    expect(view).toContain('await reconcileCattleScheduledBatches');
    expect(modal).toContain('await reconcileCattleScheduledBatches');
    expect(modal.indexOf('await reconcileCattleScheduledBatches')).toBeLessThan(
      modal.indexOf('await attachCattleToProcessingBatch'),
    );
  });
});
