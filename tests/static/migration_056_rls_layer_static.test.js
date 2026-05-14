import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {describe, it, expect} from 'vitest';

// Static lock for supabase-migrations/056_rls_layer_tables_and_backups.sql.
// Ensures the migration's intent stays intact across edits:
//   - RLS enabled on the 2 live + 18 backup tables.
//   - Live-table grants are EXPLICIT per role (revision 1).
//   - Backup-table block is guarded with to_regclass so missing tables
//     don't fail the apply (revision 2).
//   - PUBLIC grants revoked everywhere as belt-and-suspenders (revision 3).
//   - Anon write surface stays minimal: column-scoped UPDATE on the two
//     anchor columns of layer_housings + status='active' policy filter.
//
// Lock against accidental simplifications that would re-open the advisory.

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..', '..');
const sql = fs.readFileSync(path.join(ROOT, 'supabase-migrations/056_rls_layer_tables_and_backups.sql'), 'utf8');

const BACKUP_TABLES = [
  '_backup_app_store',
  '_backup_app_store_apr11_brooderin',
  '_backup_app_store_apr11_brooderin_v3',
  '_backup_app_store_apr11_feedcost',
  '_backup_egg_dailys',
  '_backup_layer_batches',
  '_backup_layer_batches_apr11_2026',
  '_backup_layer_batches_apr11_feedcost',
  '_backup_layer_batches_apr11_l2601',
  '_backup_layer_batches_apr11_phase2',
  '_backup_layer_dailys',
  '_backup_layer_dailys_apr11_batchid',
  '_backup_layer_dailys_apr11_batchid_v2',
  '_backup_layer_dailys_apr11_podio_insert',
  '_backup_layer_housings',
  '_backup_layer_housings_apr11_l2601',
  '_backup_layer_housings_apr11pm',
  '_backup_webform_config',
];

describe('Migration 056 — shape locks', () => {
  it('wraps the whole apply in BEGIN/COMMIT', () => {
    expect(sql).toMatch(/BEGIN;[\s\S]*COMMIT;/);
  });

  it('enables RLS on the two live tables', () => {
    expect(sql).toMatch(/ALTER TABLE public\.layer_batches ENABLE ROW LEVEL SECURITY;/);
    expect(sql).toMatch(/ALTER TABLE public\.layer_housings ENABLE ROW LEVEL SECURITY;/);
  });

  it('revokes PUBLIC privileges on both live tables (defense-in-depth)', () => {
    expect(sql).toMatch(/REVOKE ALL ON public\.layer_batches FROM PUBLIC;/);
    expect(sql).toMatch(/REVOKE ALL ON public\.layer_housings FROM PUBLIC;/);
  });

  it('declares the layer_batches anon grant matrix explicitly: SELECT only', () => {
    expect(sql).toMatch(/REVOKE INSERT, UPDATE, DELETE ON public\.layer_batches FROM anon;/);
    expect(sql).toMatch(/GRANT SELECT ON public\.layer_batches TO anon;/);
    // Anon must not appear with write privileges anywhere on layer_batches.
    const anonWriteGrants = sql.match(/GRANT (INSERT|UPDATE|DELETE)[^;]*ON public\.layer_batches TO anon/g) || [];
    expect(anonWriteGrants).toEqual([]);
  });

  it('declares the layer_batches authenticated grant matrix explicitly: full CRUD', () => {
    expect(sql).toMatch(/GRANT SELECT, INSERT, UPDATE, DELETE ON public\.layer_batches TO authenticated;/);
  });

  it('declares the layer_housings anon grant matrix explicitly: SELECT + column-scoped UPDATE only', () => {
    expect(sql).toMatch(/REVOKE INSERT, DELETE ON public\.layer_housings FROM anon;/);
    expect(sql).toMatch(/REVOKE UPDATE ON public\.layer_housings FROM anon;/);
    expect(sql).toMatch(/GRANT SELECT ON public\.layer_housings TO anon;/);
    expect(sql).toMatch(/GRANT UPDATE \(current_count, current_count_date\) ON public\.layer_housings TO anon;/);
  });

  it('declares the layer_housings authenticated grant matrix explicitly: full CRUD', () => {
    expect(sql).toMatch(/GRANT SELECT, INSERT, UPDATE, DELETE ON public\.layer_housings TO authenticated;/);
  });

  it('layer_housings anon UPDATE policy is scoped to active rows', () => {
    const block = sql.match(/CREATE POLICY layer_housings_anon_update[\s\S]*?;/);
    expect(block, 'expected layer_housings_anon_update policy block').not.toBeNull();
    expect(block[0]).not.toMatch(/USING \(true\)/);
    expect(block[0]).toMatch(/USING \(status = 'active'\)/);
    expect(block[0]).toMatch(/WITH CHECK \(status = 'active'\)/);
  });

  it('each policy is dropped before creation so re-apply is idempotent', () => {
    const policies = [
      'layer_batches_anon_select',
      'layer_batches_authenticated_all',
      'layer_housings_anon_select',
      'layer_housings_anon_update',
      'layer_housings_authenticated_all',
    ];
    for (const p of policies) {
      expect(sql).toMatch(new RegExp(`DROP POLICY IF EXISTS ${p}`));
      expect(sql).toMatch(new RegExp(`CREATE POLICY ${p}`));
    }
  });

  it('authenticated keeps full CRUD on both live tables', () => {
    expect(sql).toMatch(
      /CREATE POLICY layer_batches_authenticated_all[\s\S]*?FOR ALL[\s\S]*?TO authenticated[\s\S]*?USING \(true\)[\s\S]*?WITH CHECK \(true\)/,
    );
    expect(sql).toMatch(
      /CREATE POLICY layer_housings_authenticated_all[\s\S]*?FOR ALL[\s\S]*?TO authenticated[\s\S]*?USING \(true\)[\s\S]*?WITH CHECK \(true\)/,
    );
  });

  it('backup-table block guards each table with to_regclass so TEST cannot fail on missing snapshots', () => {
    // The block must run inside a DO $$ ... $$ wrapper, iterate over a
    // backups array, and guard each operation with to_regclass.
    expect(sql).toMatch(/DO\s*\$\$[\s\S]*?to_regclass\([\s\S]*?\$\$\s*;/);
    expect(sql).toMatch(/IF to_regclass\('public\.' \|\| quote_ident\(t\)\) IS NOT NULL/);
    // Three actions per backup: ENABLE RLS, REVOKE FROM PUBLIC, REVOKE FROM anon/authenticated.
    expect(sql).toMatch(/EXECUTE format\('ALTER TABLE public\.%I ENABLE ROW LEVEL SECURITY', t\)/);
    expect(sql).toMatch(/EXECUTE format\('REVOKE ALL ON public\.%I FROM PUBLIC', t\)/);
    expect(sql).toMatch(/EXECUTE format\('REVOKE ALL ON public\.%I FROM anon, authenticated', t\)/);
  });

  it('the backups array enumerates all 18 snapshot tables', () => {
    expect(BACKUP_TABLES).toHaveLength(18);
    for (const t of BACKUP_TABLES) {
      // Each must appear as a quoted entry inside the DO block's array literal.
      expect(sql, `expected ${t} in DO block backups array`).toMatch(new RegExp(`'${t}'`));
    }
  });

  it('does not enable RLS on backup tables outside the guarded DO block', () => {
    // Catches accidental refactors that reintroduce unconditional
    // ALTER TABLE public._backup_X ENABLE ROW LEVEL SECURITY which would
    // fail the apply on TEST if the snapshot is missing.
    const unguardedRls = sql.match(/^ALTER TABLE public\._backup_[a-z0-9_]+ ENABLE ROW LEVEL SECURITY;/gm) || [];
    expect(unguardedRls).toEqual([]);
  });

  it('does not grant anon any write privilege beyond the two anchor columns on layer_housings', () => {
    const anonGrants = sql.match(/GRANT [^;]+ ON public\.layer_housings TO anon/g) || [];
    expect(anonGrants).toEqual([
      'GRANT SELECT ON public.layer_housings TO anon',
      'GRANT UPDATE (current_count, current_count_date) ON public.layer_housings TO anon',
    ]);
  });
});
