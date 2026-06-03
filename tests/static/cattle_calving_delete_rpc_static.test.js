import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {describe, it, expect} from 'vitest';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..', '..');

const mig079 = fs.readFileSync(path.join(ROOT, 'supabase-migrations/079_delete_cattle_calving_record_rpc.sql'), 'utf8');
const apiSrc = fs.readFileSync(path.join(ROOT, 'src/lib/cattleCalvingApi.js'), 'utf8');
const animalSrc = fs.readFileSync(path.join(ROOT, 'src/cattle/CattleAnimalPage.jsx'), 'utf8');
const herdsSrc = fs.readFileSync(path.join(ROOT, 'src/cattle/CattleHerdsView.jsx'), 'utf8');

describe('mig 079 — delete_cattle_calving_record RPC', () => {
  it('is SECURITY DEFINER with pinned search_path', () => {
    expect(mig079).toMatch(/CREATE OR REPLACE FUNCTION public\.delete_cattle_calving_record[\s\S]*?SECURITY DEFINER/);
    expect(mig079).toMatch(/SET search_path = public/);
  });
  it('requires an authenticated active caller but is NOT admin-only (operational)', () => {
    expect(mig079).toMatch(/auth\.uid\(\)/);
    expect(mig079).toMatch(/v_role = 'inactive'/);
    expect(mig079).not.toMatch(/admin role required/);
    expect(mig079).not.toMatch(/v_role <> 'admin'/);
  });
  it('deletes the row AND logs a record.deleted Activity event scoped to the dam in one txn', () => {
    expect(mig079).toMatch(/DELETE FROM public\.cattle_calving_records WHERE id = p_record_id/);
    expect(mig079).toContain("'record.deleted'");
    expect(mig079).toContain("'cattle.animal'");
    expect(mig079).toContain('INSERT INTO public.activity_events');
    // The dam (which persists) is resolved by tag among active cattle.
    expect(mig079).toMatch(/FROM public\.cattle\s+WHERE tag = v_dam_tag AND deleted_at IS NULL/);
  });
  it('returns not_found without writing when the record is gone', () => {
    expect(mig079).toMatch(/IF NOT FOUND THEN[\s\S]*?'not_found'/);
  });
  it('REVOKEs anon and GRANTs authenticated; reloads PostgREST', () => {
    expect(mig079).toMatch(
      /REVOKE ALL ON FUNCTION public\.delete_cattle_calving_record\(text, text\) FROM PUBLIC, anon/,
    );
    expect(mig079).toMatch(
      /GRANT EXECUTE ON FUNCTION public\.delete_cattle_calving_record\(text, text\) TO authenticated/,
    );
    expect(mig079).toMatch(/NOTIFY pgrst, 'reload schema'/);
  });
});

describe('cattleCalvingApi + record-page wiring', () => {
  it('exports deleteCattleCalvingRecord calling the RPC', () => {
    expect(apiSrc).toMatch(/export async function deleteCattleCalvingRecord/);
    expect(apiSrc).toContain("sb.rpc('delete_cattle_calving_record'");
  });
  it('CattleAnimalPage deletes calving records via the RPC, not a client .delete()', () => {
    expect(animalSrc).toContain('deleteCattleCalvingRecord(sb, recId');
    const fn = animalSrc.match(/async function deleteCalvingRecord\([\s\S]*?\n {2}\}/);
    expect(fn).not.toBeNull();
    expect(fn[0]).not.toMatch(/from\('cattle_calving_records'\)\.delete\(\)/);
  });
  it('CattleHerdsView deletes calving records via the RPC, not a client .delete()', () => {
    expect(herdsSrc).toContain('deleteCattleCalvingRecord(sb, recId');
    const fn = herdsSrc.match(/async function deleteCalvingRecord\([\s\S]*?\n {2}\}/);
    expect(fn).not.toBeNull();
    expect(fn[0]).not.toMatch(/from\('cattle_calving_records'\)\.delete\(\)/);
  });
});
