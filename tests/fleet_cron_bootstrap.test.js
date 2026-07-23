import {describe, it, expect} from 'vitest';
import {classifyCronVault, PLACEHOLDER_CRON_JOBS} from '../scripts/fleet/cron.cjs';
import {planMigrationSteps} from '../scripts/fleet/bootstrap.cjs';
import {listMigrations, checksum, reconcile} from '../scripts/fleet/ledger.cjs';
import {VAULT_PLACEHOLDERS} from '../scripts/fleet/seeds.cjs';

// ============================================================================
// Negative / interruption / mutation tests for the required fail-closed cases.
// ============================================================================

const ALL_VAULT = VAULT_PLACEHOLDERS.map((v) => ({name: v.name}));

describe('cron/vault readiness classification (no false-green)', () => {
  it('placeholder values + jobs DISABLED => structurally ready', () => {
    const cronRows = [
      {jobname: 'tasks-cron-daily', active: false},
      {jobname: 'tasks-summary-weekly', active: false},
    ];
    const r = classifyCronVault({vaultRows: ALL_VAULT, cronRows});
    expect(r.ready).toBe(true);
    expect(r.integrations.every((i) => i.state === 'structurally-ready-placeholder-disabled')).toBe(true);
  });

  it('placeholder values + a job STILL ACTIVE => NOT READY', () => {
    const cronRows = [
      {jobname: 'tasks-cron-daily', active: true}, // still firing net.http_post
      {jobname: 'tasks-summary-weekly', active: false},
    ];
    const r = classifyCronVault({vaultRows: ALL_VAULT, cronRows});
    expect(r.ready).toBe(false);
    expect(r.integrations.find((i) => i.jobname === 'tasks-cron-daily').state).toBe(
      'not-ready-placeholder-with-active-job',
    );
  });

  it('missing vault config => NOT READY', () => {
    const r = classifyCronVault({vaultRows: [], cronRows: [{jobname: 'tasks-cron-daily', active: false}]});
    expect(r.ready).toBe(false);
    expect(r.integrations.some((i) => i.state === 'not-ready-missing-config')).toBe(true);
  });

  it('maps every placeholder-backed job to a known integration', () => {
    expect(PLACEHOLDER_CRON_JOBS.map((j) => j.integration).sort()).toEqual(['tasks-cron', 'tasks-summary']);
  });
});

describe('execute resume + prerequisite boundary (interruption safety)', () => {
  const migs = listMigrations();

  it('injects the pig-pasture fixture immediately before migration 137', () => {
    const steps = planMigrationSteps(migs, new Set());
    const idx137 = steps.findIndex((s) => s.kind === 'migration' && s.version === '137');
    expect(idx137).toBeGreaterThan(0);
    expect(steps[idx137 - 1]).toMatchObject({kind: 'fixture', version: 'pig-pastures'});
  });

  it('skips migrations already recorded in the ledger (resume after interruption)', () => {
    // Simulate interruption after everything up to and including 136 committed.
    const done = new Set(migs.filter((m) => Number(m.version) <= 136).map((m) => m.version));
    const steps = planMigrationSteps(migs, done);
    const migSteps = steps.filter((s) => s.kind === 'migration');
    // no already-done version reappears
    expect(migSteps.some((s) => Number(s.version) <= 136)).toBe(false);
    // resumes exactly at 137
    expect(migSteps[0].version).toBe('137');
    // and the pasture fixture still precedes 137 on resume
    const idx137 = steps.findIndex((s) => s.kind === 'migration' && s.version === '137');
    expect(steps[idx137 - 1]).toMatchObject({kind: 'fixture'});
  });

  it('emits migrations in strictly ascending order', () => {
    const migSteps = planMigrationSteps(migs, new Set()).filter((s) => s.kind === 'migration');
    for (let i = 1; i < migSteps.length; i++)
      expect(Number(migSteps[i].version)).toBeGreaterThan(Number(migSteps[i - 1].version));
  });
});

describe('mutation detection (ledger checksum drift)', () => {
  it('flags a tampered migration body after adoption', () => {
    const three = listMigrations().slice(0, 3);
    const rows = three.map((m) => ({
      version: m.version,
      kind: 'migration',
      checksum: checksum(require('fs').readFileSync(m.path, 'utf8')),
    }));
    // tamper: pretend migration 002's recorded checksum differs from the repo file
    rows[1].checksum = '0'.repeat(64);
    const rep = reconcile(three, rows);
    expect(rep.ok).toBe(false);
    expect(rep.changed.map((c) => c.version)).toContain(three[1].version);
  });
});
