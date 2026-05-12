// Static lock: migration 055 (stamp_broiler_batch_avg RPC) must keep its
// load-bearing shape so the public broiler completion path stays anon-safe.
//
// The RPC is the ONLY anon-reachable surface that mutates app_store from
// the public form. If it loses SECURITY DEFINER, the anon grant, the
// FOR UPDATE lock, the strict status='complete' gate, or the search_path
// pin, the public completion silently regresses to the pre-055 state
// where week4Lbs / week6Lbs never landed.

import {readFileSync, existsSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {dirname, resolve} from 'node:path';
import {describe, it, expect} from 'vitest';

const HERE = dirname(fileURLToPath(import.meta.url));
const MIG_PATH = resolve(HERE, '../../supabase-migrations/055_broiler_batch_avg_rpc.sql');

describe('migration 055 stamp_broiler_batch_avg static lock', () => {
  it('migration file exists', () => {
    expect(existsSync(MIG_PATH)).toBe(true);
  });

  const source = existsSync(MIG_PATH) ? readFileSync(MIG_PATH, 'utf8') : '';

  it('declares the function with the expected name + signature', () => {
    expect(source).toMatch(
      /CREATE OR REPLACE FUNCTION public\.stamp_broiler_batch_avg\s*\(\s*session_id_in\s+text\s*\)/,
    );
  });

  it('is SECURITY DEFINER with a pinned search_path', () => {
    expect(source).toMatch(/SECURITY DEFINER/);
    expect(source).toMatch(/SET\s+search_path\s*=\s*public/);
  });

  it('grants EXECUTE to anon and authenticated only (REVOKE from public first)', () => {
    expect(source).toMatch(/REVOKE ALL ON FUNCTION public\.stamp_broiler_batch_avg\(text\) FROM public/);
    expect(source).toMatch(/GRANT EXECUTE ON FUNCTION public\.stamp_broiler_batch_avg\(text\) TO anon, authenticated/);
  });

  it('requires status = complete (strict gate)', () => {
    expect(source).toMatch(/status IS DISTINCT FROM 'complete'/);
  });

  it('requires species = broiler', () => {
    expect(source).toMatch(/species IS DISTINCT FROM 'broiler'/);
  });

  it('only stamps weeks 4 or 6', () => {
    expect(source).toMatch(/NOT IN \(4, 6\)/);
  });

  it('takes FOR UPDATE on the ppp-v4 row', () => {
    expect(source).toMatch(/WHERE\s+key\s*=\s*'ppp-v4'\s*\n\s*FOR UPDATE/);
  });

  it('returns applied:false for benign no-ops (no RAISE)', () => {
    expect(source).toMatch(/'no valid weights'/);
    expect(source).toMatch(/'ppp-v4 missing'/);
    expect(source).toMatch(/'batch not found in ppp-v4'/);
  });

  it('uses tagged dollar-quote so test-bootstrap exec_sql can apply it', () => {
    expect(source).toMatch(/\$broiler_batch_avg\$/);
  });
});
