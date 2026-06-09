// Feed-input DELETE RPC client wrapper for the ADMIN feed panel
// (LivestockFeedInputsPanel).
//
// Calls the transactional SECDEF RPC added in migration
// 108_delete_feed_input_rpc.sql, which replaces the last direct client
// hard-delete of a feed-input root. The RPC, in one transaction:
//   * deletes the cattle_feed_inputs root (WHERE id = p_input_id),
//   * cascades the child cattle_feed_tests rows away via the feed_input_id
//     ON DELETE CASCADE FK,
//   * writes ONE record.deleted Activity event scoped to the synthetic
//     cattle.forecast singleton stream (entity_id = 'cattle-forecast'), with the
//     SAME body + payload shape the client recordFeedInputDeletedActivity used,
//     so the audit lands on the same global stream the feed create/update events
//     already use.
//
// p_input_id is the feed input's TEXT id slug (e.g. 'rye-baleage'), matching the
// cattle_feed_inputs.id column — NOT a uuid (see the migration header for the
// full rationale on the brief's uuid→text correction).
//
// The storage PDF bulk-removal is intentionally NOT done here — the caller runs
// it as a best-effort step AFTER this RPC succeeds, so a failed delete never
// orphan-removes the children's PDFs. The RPC now guarantees the Activity audit,
// so the caller no longer needs the best-effort client recordFeedInputDeletedActivity
// on this permanent-delete path.
//
// Returns the RPC's jsonb result unchanged on success and on business-rule
// blocks (e.g. {ok:false, reason:'no_input'}), so callers branch on r.ok /
// r.reason. On a transport/permission error it returns
// {ok:false, reason:'rpc_error', error} rather than throwing, matching the
// fuel-bill + layer-batch + processing-batch delete wrappers.

export async function deleteFeedInput(sb, inputId) {
  const {data, error} = await sb.rpc('delete_feed_input', {p_input_id: inputId});
  if (error) return {ok: false, reason: 'rpc_error', error: error.message || String(error)};
  return data || {ok: false, reason: 'no_result'};
}
