// Admin-only side-effect wrappers for the Tasks Center. Pure helpers belong
// in tasks.js; assignee-side completion wrappers belong in tasksUserApi.js;
// public-webform wrappers belong in tasksPublicApi.js. Keep this module
// admin-surface only so the four-module split (per PROJECT.md §8 plan
// rev 5) stays clean.

const ADMIN_INVOKE_BODY = {mode: 'admin'}; // NO probe:true — this is the
// real-effect Run Cron Now path.

// Invoke the tasks-cron Edge Function in admin mode. The function:
//   - validates the caller's JWT + rpc('is_admin') === true,
//   - runs the same generator that the daily 04:00 UTC cron runs,
//   - returns {ok, generated_count, skipped_count, cap_exceeded[]}.
// Idempotency: a second call inside the same generator window will produce
// generated=0/skipped=0 because the function pre-filters dates against
// the partial-unique-index ON CONFLICT (template_id, due_date) contract
// (mig 037 + mig 039).
export async function runCronNow(sb) {
  const {data, error} = await sb.functions.invoke('tasks-cron', {body: ADMIN_INVOKE_BODY});
  if (error) {
    throw new Error(`runCronNow failed: ${error.message || String(error)}`);
  }
  return data;
}

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

export async function loadCronAuditTail(sb, n = 5) {
  const {data, error} = await sb.from('task_cron_runs').select('*').order('ran_at', {ascending: false}).limit(n);
  if (error) throw new Error(`loadCronAuditTail: ${error.message}`);
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
