// Anon / public-webform side-effect wrappers for /webforms/tasks. Pure
// helpers belong in tasks.js; admin-side wrappers belong in
// tasksAdminApi.js; logged-in completion wrappers (C2) belong in
// tasksUserApi.js.
//
// Functions here are anon-callable — they target the SECURITY DEFINER
// RPCs in mig 041 (list_eligible_assignees, submit_task_instance) and
// the anon-readable webform_config rows that drive the form's filters.

import {TASKS_PUBLIC_ASSIGNEE_AVAILABILITY_KEY, normalizePublicAssigneeAvailability} from './tasks.js';

/**
 * Fetch the eligible-assignee list. Returns rows of {id, full_name}.
 * The RPC returns ONLY id + full_name — no role, no email leak. anon-
 * callable; defense-in-depth at the SQL level (`role != 'inactive'`
 * filter inside the function).
 */
export async function listEligibleAssignees(sb) {
  const {data, error} = await sb.rpc('list_eligible_assignees');
  if (error) throw new Error(`listEligibleAssignees: ${error.message}`);
  return Array.isArray(data) ? data : [];
}

/**
 * Anon-readable filter for the assignee dropdown. Server-side validation
 * happens in submit_task_instance; this read is the UI affordance.
 */
export async function loadPublicAssigneeAvailability(sb) {
  const {data: row} = await sb
    .from('webform_config')
    .select('data')
    .eq('key', TASKS_PUBLIC_ASSIGNEE_AVAILABILITY_KEY)
    .maybeSingle();
  return normalizePublicAssigneeAvailability(row && row.data ? row.data : null);
}
