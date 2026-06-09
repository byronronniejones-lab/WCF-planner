// Static guard for migration 105 — create_recurring_task_template SECDEF RPC.
//
// Lane 15 fix: task_templates RLS is admin-only (037), but the Task Center New
// Task modal offers a Recurring toggle to every authenticated role except
// Light. The approved server path is this SECURITY DEFINER RPC, which role-
// gates non-light/non-inactive callers and server-stamps the owner. This guard
// locks the load-bearing shape of the migration plus the wrapper/modal wiring
// so the security properties can't silently regress.
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {dirname, join} from 'node:path';
import {describe, it, expect} from 'vitest';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const mig = readFileSync(join(root, 'supabase-migrations', '105_create_recurring_task_template_rpc.sql'), 'utf8');
const wrapper = readFileSync(join(root, 'src', 'lib', 'tasksCenterMutationsApi.js'), 'utf8');
const modal = readFileSync(join(root, 'src', 'tasks', 'NewTaskModal.jsx'), 'utf8');

describe('migration 105 — create_recurring_task_template RPC shape', () => {
  it('is a SECURITY DEFINER function with a locked public search_path', () => {
    expect(mig).toMatch(
      /CREATE OR REPLACE FUNCTION public\.create_recurring_task_template\s*\(\s*\n?\s*p_template jsonb/,
    );
    expect(mig).toMatch(/SECURITY DEFINER/);
    expect(mig).toMatch(/SET search_path = public/);
  });

  it('requires an authenticated caller and fails closed on a NULL/unknown role', () => {
    expect(mig).toMatch(/v_caller uuid := auth\.uid\(\)/);
    expect(mig).toMatch(/IF v_caller IS NULL THEN[\s\S]*?authenticated caller required/);
    // NULL/unknown role is rejected (fail closed).
    expect(mig).toMatch(/IF v_role IS NULL OR v_role IN \('light', 'inactive'\) THEN/);
  });

  it('role-gates: light and inactive are rejected, other authenticated roles allowed', () => {
    // The gate reads the caller's own profile role and rejects light/inactive.
    expect(mig).toMatch(/SELECT role INTO v_role FROM public\.profiles WHERE id = v_caller/);
    expect(mig).toMatch(/may not create recurring tasks/);
  });

  it('server-stamps created_by_profile_id from the caller (never trusts the payload owner)', () => {
    // The INSERT sets created_by_profile_id to v_caller (auth.uid()), and the
    // RPC never reads a created_by_profile_id out of p_template.
    expect(mig).toMatch(/created_by_profile_id\s*\n?\s*\)/);
    expect(mig).toMatch(/v_active, v_caller\s*\n?\s*\)/);
    expect(mig).not.toMatch(/p_template->>'created_by_profile_id'/);
  });

  it('is idempotent by the client-minted id (ON CONFLICT DO NOTHING)', () => {
    expect(mig).toMatch(/ON CONFLICT \(id\) DO NOTHING/);
    expect(mig).toMatch(/idempotent_replay/);
  });

  it('validates the recurrence enum including quarterly (matches the mig-039 CHECK)', () => {
    expect(mig).toMatch(/'once', 'daily', 'weekly', 'biweekly', 'monthly', 'quarterly'/);
    expect(mig).toMatch(/recurrence_interval must be >= 1/);
  });

  it('revokes anon/PUBLIC, grants authenticated, and reloads the PostgREST schema', () => {
    expect(mig).toMatch(/REVOKE ALL ON FUNCTION public\.create_recurring_task_template\(jsonb\) FROM PUBLIC, anon/);
    expect(mig).toMatch(/GRANT EXECUTE ON FUNCTION public\.create_recurring_task_template\(jsonb\) TO authenticated/);
    expect(mig).toMatch(/NOTIFY pgrst, 'reload schema'/);
  });
});

describe('createRecurringTaskTemplateV2 wrapper wires to the RPC', () => {
  it('calls sb.rpc(create_recurring_task_template) with p_template', () => {
    expect(wrapper).toMatch(/export async function createRecurringTaskTemplateV2/);
    expect(wrapper).toMatch(/sb\.rpc\('create_recurring_task_template', \{p_template: template\}\)/);
  });

  it('NewTaskModal recurring path uses the wrapper, not the admin-only direct upsert', () => {
    expect(modal).toMatch(/createRecurringTaskTemplateV2\s*\(/);
    expect(modal).not.toMatch(/upsertRecurringTaskTemplate/);
  });
});
