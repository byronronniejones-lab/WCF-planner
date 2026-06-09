// Layer-batch DELETE RPC client wrapper for the AUTHENTICATED app
// (LayerBatchPage).
//
// Calls the transactional SECDEF RPC added in migration
// 106_delete_layer_batch_rpc.sql, which replaces the last direct client
// hard-delete of a layer batch root. The RPC, in one transaction:
//   * deletes the child layer_housings rows (WHERE batch_id = p_batch_id),
//   * deletes the layer_batches root (WHERE id = p_batch_id),
//   * writes ONE record.deleted layer.batch Activity event carrying the batch
//     name + the count/names of housings cleared.
// layer_dailys / egg_dailys are intentionally left intact as history.
//
// p_batch_id is the layer batch's TEXT slug id (e.g. 'l-26-01'), matching the
// layer_batches.id column — NOT a uuid (see the migration header for the full
// rationale).
//
// Returns the RPC's jsonb result unchanged on success and on business-rule
// blocks (e.g. {ok:false, reason:'no_batch'}), so callers branch on r.ok /
// r.reason. On a transport/permission error it returns
// {ok:false, reason:'rpc_error', error} rather than throwing, matching the
// processing-batch delete wrappers (the page handler does not wrap the call in
// try/catch).

export async function deleteLayerBatch(sb, batchId) {
  const {data, error} = await sb.rpc('delete_layer_batch', {p_batch_id: batchId});
  if (error) return {ok: false, reason: 'rpc_error', error: error.message || String(error)};
  return data || {ok: false, reason: 'no_result'};
}
