// Admin-only side-effect wrappers for the Tasks Center. Pure helpers belong
// in tasks.js; assignee-side completion wrappers belong in tasksUserApi.js;
// public-webform wrappers belong in tasksPublicApi.js. Keep this module
// admin-surface only so the four-module split (per PROJECT.md §8 plan
// rev 5) stays clean.
//
// C1.1 product-correction: cron-surface wrappers (runCronNow,
// loadCronAuditTail) were removed alongside the operator-facing UI for
// cron runs. The Edge Function and audit table stay intact — admins
// just don't drive them through this module anymore.
//
// C3 added: load/savePublicAssigneeAvailability for the Public Tasks
// availability tile. Roster-side filtering for the Submitted-by dropdown
// goes through teamAvailability.js (forms['tasks-public'].hiddenIds);
// profile-uuid filtering for the Assignee dropdown lives in a separate
// webform_config key — see tasks.js for the canonical key name + shape.

import {TASKS_PUBLIC_ASSIGNEE_AVAILABILITY_KEY, normalizePublicAssigneeAvailability} from './tasks.js';

export async function loadTaskTemplates(sb) {
  const {data, error} = await sb.from('task_templates').select('*').order('title', {ascending: true});
  if (error) throw new Error(`loadTaskTemplates: ${error.message}`);
  return data || [];
}

export async function loadOpenTaskInstances(sb) {
  const {data, error} = await sb
    .from('task_instances')
    .select('*')
    .eq('status', 'open')
    .order('due_date', {ascending: true})
    .order('title', {ascending: true});
  if (error) throw new Error(`loadOpenTaskInstances: ${error.message}`);
  return data || [];
}

export async function upsertTaskTemplate(sb, template) {
  const {data, error} = await sb.from('task_templates').upsert(template).select().single();
  if (error) throw new Error(`upsertTaskTemplate: ${error.message}`);
  return data;
}

export async function deleteTaskTemplate(sb, id) {
  const {error} = await sb.from('task_templates').delete().eq('id', id);
  if (error) throw new Error(`deleteTaskTemplate: ${error.message}`);
}

// ── Public Tasks assignee availability (admin-managed) ──────────────────

export async function loadPublicAssigneeAvailability(sb) {
  const {data: row} = await sb
    .from('webform_config')
    .select('data')
    .eq('key', TASKS_PUBLIC_ASSIGNEE_AVAILABILITY_KEY)
    .maybeSingle();
  return normalizePublicAssigneeAvailability(row && row.data ? row.data : null);
}

/**
 * Persist the public-tasks assignee availability. Read-fresh-then-merge
 * per PROJECT.md §7 line 543 (webform_config jsonb keys must re-fetch
 * before upsert). Local-wins on the full list — matches
 * saveAvailability's per-formKey local-wins philosophy. Single-admin
 * tile usage in practice; if concurrent admins both write here, last
 * writer's snapshot is what persists.
 *
 * Returns the persisted availability.
 */
export async function savePublicAssigneeAvailability(sb, nextAvailability) {
  const local = normalizePublicAssigneeAvailability(nextAvailability);
  // §7 read-fresh-then-write contract: fetch the latest stored row even
  // though local-wins overwrites it. The fetch validates the key path
  // and lets future merge strategies plug in without changing the call
  // site.
  await sb.from('webform_config').select('data').eq('key', TASKS_PUBLIC_ASSIGNEE_AVAILABILITY_KEY).maybeSingle();

  const {error} = await sb
    .from('webform_config')
    .upsert({key: TASKS_PUBLIC_ASSIGNEE_AVAILABILITY_KEY, data: local}, {onConflict: 'key'});
  if (error) throw new Error(`savePublicAssigneeAvailability: write failed: ${error.message}`);
  return local;
}

// One-time admin-created task instance. Inserts directly into task_instances
// with template_id=null and submission_source='admin_manual'. Existing admin
// RLS already covers admin INSERT; no migration needed for this path.
//
// Caller mints a stable id (the modal holds it across Save retries) so a
// retry on a network blip doesn't double-insert. If the first INSERT did
// land and the second attempt arrives with the same id, Postgres raises
// 23505 unique_violation on the PK; we treat that as "already created"
// and SELECT the row back instead of failing the user.
export async function createOneTimeTaskInstance(sb, payload) {
  const {data, error} = await sb.from('task_instances').insert(payload).select().single();
  if (!error) return data;
  if (error.code === '23505' && payload && payload.id) {
    const {data: existing, error: selErr} = await sb
      .from('task_instances')
      .select('*')
      .eq('id', payload.id)
      .maybeSingle();
    if (selErr) throw new Error(`createOneTimeTaskInstance replay select: ${selErr.message}`);
    if (existing) return existing;
  }
  throw new Error(`createOneTimeTaskInstance: ${error.message}`);
}
