// Processing-batch DELETE/UNSCHEDULE RPC client wrappers for the AUTHENTICATED
// app (CattleBatchPage / SheepBatchPage).
//
// These call the transactional SECDEF RPCs added in migration
// 100_processing_batch_lifecycle_rpcs.sql, which replace the last direct client
// hard-deletes of processing-batch roots:
//   * unschedule_cattle_processing_batch — deletes an empty 'scheduled' cattle
//     batch, defensively unlinks any cattle, and logs record.deleted, atomically.
//   * delete_sheep_processing_batch — clears straggler sheep.processing_batch_id
//     links and deletes the batch, logging record.deleted, in one transaction.
//     The page still runs the per-sheep detach RPCs (migration 081) first.
//
// Both return the RPC's jsonb result unchanged on success and on business-rule
// blocks (e.g. {ok:false, reason:'not_scheduled'}), so callers branch on
// r.ok / r.reason. On a transport/permission error they return
// {ok:false, reason:'rpc_error', error} rather than throwing, matching the
// detach wrappers (the page handlers do not wrap the call in try/catch).

export async function unscheduleCattleProcessingBatch(sb, {batchId, teamMember = null} = {}) {
  const {data, error} = await sb.rpc('unschedule_cattle_processing_batch', {
    p_batch_id: batchId,
    p_team_member: teamMember,
  });
  if (error) return {ok: false, reason: 'rpc_error', error: error.message || String(error)};
  return data || {ok: false, reason: 'no_result'};
}

export async function deleteSheepProcessingBatch(sb, {batchId, teamMember = null} = {}) {
  const {data, error} = await sb.rpc('delete_sheep_processing_batch', {
    p_batch_id: batchId,
    p_team_member: teamMember,
  });
  if (error) return {ok: false, reason: 'rpc_error', error: error.message || String(error)};
  return data || {ok: false, reason: 'no_result'};
}
