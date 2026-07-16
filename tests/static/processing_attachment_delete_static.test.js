import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {describe, it, expect} from 'vitest';

// Static guards for migration 185: the two-phase ADMIN-ONLY attachment delete
// contract, tombstone resurrection blocks, the comments-only automation flag,
// and the (unscheduled) pg_cron invocation contract. Upload gating is asserted
// UNCHANGED — Ronnie decision 2026-07-16: only deletion is admin-only.

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..', '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

const mig = read('supabase-migrations/185_processing_attachments_admin_and_comment_cron.sql');

describe('mig 185 — upload stays operational (no upload change rides this lane)', () => {
  it('does not touch the mig-166 upload policy or add_processing_attachment', () => {
    // No policy DDL against the operational INSERT policy and no reissue of the
    // upload RPC — comments may reference them, DDL may not.
    expect(mig).not.toMatch(/(CREATE|DROP|ALTER) POLICY[\s\S]{0,200}?processing_attachments_operational_insert/);
    expect(mig).not.toMatch(/CREATE POLICY[\s\S]{0,400}?FOR INSERT/);
    expect(mig).not.toContain('FUNCTION public.add_processing_attachment');
  });
});

describe('mig 185 — two-phase delete lifecycle', () => {
  it('adds the request/tombstone columns idempotently', () => {
    for (const col of ['delete_requested_at', 'delete_requested_by', 'deleted_at', 'deleted_by', 'delete_error']) {
      expect(mig).toContain(`ADD COLUMN IF NOT EXISTS ${col}`);
    }
  });

  it('request RPC: admin-gated, row-locked, idempotent replay, returns the exact bucket/path', () => {
    expect(mig).toContain('CREATE OR REPLACE FUNCTION public.request_processing_attachment_delete(p_id text)');
    expect(mig).toMatch(/request_processing_attachment_delete[\s\S]*?v_role <> 'admin'/);
    expect(mig).toMatch(/request_processing_attachment_delete[\s\S]*?FOR UPDATE/);
    expect(mig).toContain("'status', 'already_deleted', 'replayed', true");
    expect(mig).toContain("'bucket', 'processing-attachments'");
    expect(mig).toContain("'storage_path', v_row.storage_path");
  });

  it('storage DELETE policy: admin + requested-delete state for that EXACT path (SECDEF helper)', () => {
    expect(mig).toContain('CREATE OR REPLACE FUNCTION public._processing_attachment_delete_ok(p_name text)');
    expect(mig).toMatch(/_processing_attachment_delete_ok[\s\S]*?delete_requested_at IS NOT NULL/);
    expect(mig).toMatch(/_processing_attachment_delete_ok[\s\S]*?deleted_at IS NULL/);
    expect(mig).toContain('processing_attachments_admin_delete');
    expect(mig).toMatch(/FOR DELETE\s+TO authenticated/);
    expect(mig).toMatch(/public\.profile_role\(\) = 'admin'\s*AND public\._processing_attachment_delete_ok\(name\)/);
    // No generic/unscoped storage delete: exactly one DELETE policy, no
    // bucket-only USING clause.
    expect(mig.match(/FOR DELETE/g)).toHaveLength(1);
    expect(mig).not.toMatch(/USING \(bucket_id = 'processing-attachments'\)/);
  });

  it('finalize RPC: truthful terminal outcomes — tombstone+scrub on ok, REOPEN (never claim) on failure', () => {
    expect(mig).toContain(
      'CREATE OR REPLACE FUNCTION public.finalize_processing_attachment_delete(\n  p_id text, p_ok boolean, p_error text DEFAULT NULL\n)',
    );
    expect(mig).toMatch(/finalize_processing_attachment_delete[\s\S]*?v_role <> 'admin'/);
    // success: tombstone + comment JSON scrub + Activity
    expect(mig).toContain('SET deleted_at = now(), deleted_by = v_caller, delete_error = NULL');
    expect(mig).toMatch(/UPDATE public\.comments c[\s\S]*?jsonb_array_elements\(COALESCE\(c\.attachments/);
    expect(mig).toContain("'Deleted attachment: ' || v_row.filename");
    // failure: reopen + recorded error + truthful Activity
    expect(mig).toContain('SET delete_requested_at = NULL');
    expect(mig).toContain("'Attachment delete failed: ' || v_row.filename");
    expect(mig).toContain("'delete_attachment_failed'");
    // no pending request → refused (finalize can't be called cold)
    expect(mig).toContain('no pending delete request for this attachment');
  });

  it('get_processing_record excludes tombstones; tombstoned gids cannot re-enter comments or the index', () => {
    expect(mig).toMatch(
      /FROM public\.processing_attachments a\s*\n\s*WHERE a\.record_id = p_id AND a\.deleted_at IS NULL/,
    );
    // record_processing_comment_media: tombstone guards on BOTH loops
    expect(mig).toContain("'skipped_deleted'");
    expect(mig).toMatch(
      /t\.asana_attachment_gid = v_meta->>'asana_attachment_gid'\s*\n\s*AND t\.deleted_at IS NOT NULL/,
    );
    expect(mig).toMatch(/IF v_att_row\.deleted_at IS NOT NULL THEN\s*\n\s*CONTINUE;/);
  });
});

describe('mig 185 — comments-only automation flag + cron contract (NOT scheduled)', () => {
  it('adds asana_comments_import_enabled DEFAULT false and an admin-only toggle', () => {
    expect(mig).toContain('ADD COLUMN IF NOT EXISTS asana_comments_import_enabled boolean NOT NULL DEFAULT false');
    expect(mig).toContain('CREATE OR REPLACE FUNCTION public.set_asana_comments_import_enabled(p_enabled boolean)');
    expect(mig).toMatch(/set_asana_comments_import_enabled[\s\S]*?v_role <> 'admin'/);
  });

  it('invoke_processing_asana_cron reads Vault at call time, posts {mode:cron}, postgres-only EXECUTE', () => {
    expect(mig).toContain('CREATE OR REPLACE FUNCTION public.invoke_processing_asana_cron()');
    for (const name of [
      'PROCESSING_ASANA_CRON_FUNCTION_URL',
      'PROCESSING_ASANA_CRON_SECRET',
      'PROCESSING_ASANA_CRON_SERVICE_ROLE_KEY',
    ]) {
      expect(mig).toContain(`FROM vault.decrypted_secrets WHERE name = '${name}'`);
    }
    expect(mig).toContain("body    := jsonb_build_object('mode','cron')");
    expect(mig).toContain(
      'REVOKE ALL ON FUNCTION public.invoke_processing_asana_cron() FROM PUBLIC, anon, authenticated',
    );
    expect(mig).toContain('GRANT EXECUTE ON FUNCTION public.invoke_processing_asana_cron() TO postgres');
  });

  it('creates NO schedule: every cron.schedule reference is commented out (activation is a separate gate)', () => {
    const lines = mig.split('\n').filter((l) => l.includes('cron.schedule') || l.includes('cron.unschedule'));
    expect(lines.length).toBeGreaterThan(0);
    for (const line of lines) {
      expect(line.trimStart().startsWith('--'), `uncommented cron line: ${line}`).toBe(true);
    }
  });

  it('never BEGIN/COMMITs (exec_sql TEST apply / psql --single-transaction PROD apply)', () => {
    expect(mig).not.toMatch(/^\s*BEGIN;/m);
    expect(mig).not.toMatch(/^\s*COMMIT;/m);
  });
});
