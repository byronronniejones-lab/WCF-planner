// Weigh-in DELETE RPC client wrappers for the AUTHENTICATED record page
// (WeighInSessionPage).
//
// These call the transactional SECDEF RPCs added in migration
// 101_weighin_delete_activity_rpcs.sql, which replace the last direct client
// hard-deletes of weigh-in entries/sessions on that page:
//   * delete_weigh_in_entry — deletes one weigh_ins row and logs record.deleted
//     on the weighin.session entity, atomically.
//   * delete_weigh_in_session — for cattle/sheep clears the session's weigh-in
//     comments, deletes the session (FK cascade removes its weigh_ins rows), and
//     logs record.deleted, all in one transaction.
//
// Auth shape matches the existing weigh_ins / weigh_in_sessions RLS
// (FOR ALL TO authenticated): any authenticated user may delete. The per-animal
// processing-batch detach reverts + "delete anyway?" confirmation, and the
// broiler ppp-v4 recompute, stay client-side in WeighInSessionPage and run
// BEFORE these calls.
//
// Both return the RPC's jsonb result unchanged on success and on business-rule
// results (e.g. {ok:false, reason:'no_session'}), so callers branch on
// r.ok / r.reason. On a transport/permission error they return
// {ok:false, reason:'rpc_error', error} rather than throwing, matching the
// processing-batch delete wrappers.

export async function deleteWeighInEntry(sb, {entryId, entityLabel = null, teamMember = null} = {}) {
  const {data, error} = await sb.rpc('delete_weigh_in_entry', {
    p_entry_id: entryId,
    p_entity_label: entityLabel,
    p_team_member: teamMember,
  });
  if (error) return {ok: false, reason: 'rpc_error', error: error.message || String(error)};
  return data || {ok: false, reason: 'no_result'};
}

export async function deleteWeighInSession(sb, {sessionId, entityLabel = null, teamMember = null} = {}) {
  const {data, error} = await sb.rpc('delete_weigh_in_session', {
    p_session_id: sessionId,
    p_entity_label: entityLabel,
    p_team_member: teamMember,
  });
  if (error) return {ok: false, reason: 'rpc_error', error: error.message || String(error)};
  return data || {ok: false, reason: 'no_result'};
}
