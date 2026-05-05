// Pure helpers for the Tasks module. NO React, NO supabase, NO side effects.
// Side-effect wrappers live in tasksAdminApi.js / tasksUserApi.js / tasksPublicApi.js.

// Mig 039 task_templates.recurrence CHECK enum (mig 036 minus the 'quarterly'
// addition that landed in 039). Keep order matching the spec — the admin
// dropdown renders them in this order, and 'once' is the safest default.
export const RECURRENCE_OPTIONS = ['once', 'daily', 'weekly', 'biweekly', 'monthly', 'quarterly'];

// Filter predicate for the admin "open task instances" list. Mirrors the
// status state machine from mig 036 (open → completed; reopen path TBD in
// later checkpoints).
export function isOpenTaskInstance(ti) {
  return !!(ti && ti.status === 'open');
}
