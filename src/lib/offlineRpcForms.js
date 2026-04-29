// Form-kind registry for the parent-aware RPC offline submission queue.
//
// Distinct from src/lib/offlineForms.js (the flat table-insert registry):
//   - Flat path: queue worker calls sb.from(table).insert(record). 23505 on
//     *_client_submission_id_uq is treated as success (replay landed).
//   - RPC path: queue worker calls sb.rpc(record.rpc, record.args). The RPC
//     function owns idempotency internally — it returns {idempotent_replay:
//     true} on a replay rather than raising 23505. A 23505 from this path
//     means the function body itself raised one (a bug), not idempotency.
//     The companion hook useOfflineRpcSubmit treats those as schema-class
//     errors and surfaces them via the stuck modal.
//
// Why a separate registry: forms that produce N child rows from one operator
// submission (e.g. /addfeed broiler 3 batches) cannot use the flat-insert
// model — atomicity + photo attribution both break. They submit via a
// SECURITY DEFINER RPC that wraps parent + children in one transaction.
// The hook needs to know it's calling .rpc() not .from().insert(), and the
// queued record shape differs.
//
// Phase 1C-A ships the AddFeed entry. Future RPC-based forms (e.g. a
// weigh-in batch RPC that needs prior-tag side effects) drop in here as
// additional entries.
//
// Locked decisions:
//   - Child IDs are deterministic from parentId + index ('${parentId}-c${i}').
//     Retry produces byte-identical RPC args without persisting separate
//     child-id state. csid + parentId are minted once at submit() entry by
//     the hook and persisted in the queued record.
//   - Children DO NOT carry client_submission_id (parent owns dedup —
//     mig 030 unique index on each child table's csid would 23505 on
//     insert #2 of any multi-child submission if the parent's csid bled
//     through). Locked by the add_feed_parent_submission spec.
//   - broiler payload routes to poultry_dailys via the program key inside
//     the RPC; we just pass program='broiler'.
//   - pig children OMIT feed_type (pig_dailys has no such column).
//
// buildArgs is pure: same (payload, csid, parentId) → same args. This is
// critical for replay determinism.

const REGISTRY = Object.freeze({
  add_feed_batch: Object.freeze({
    rpc: 'submit_add_feed_batch',
    /**
     * @param {object} payload — normalized AddFeed form state.
     *   {program, date, team_member,
     *    // multi-row (broiler/pig/layer):
     *    batchLabel?, feedType?, feedLbs?, extraGroups?,
     *    // cattle:
     *    cattleHerd?, cattleFeedsJ?,
     *    // sheep:
     *    sheepFlock?, sheepFeedsJ?}
     * @param {object} ids
     * @param {string} ids.csid — client_submission_id (stable across retries)
     * @param {string} ids.parentId — daily_submissions.id (stable)
     * @returns {{rpc: string, args: {parent_in: object, children_in: object[]}}}
     */
    buildArgs(payload, {csid, parentId}) {
      const submittedAt = new Date().toISOString();
      const date = payload.date;
      const teamMember = payload.team_member ?? null;

      let children;
      let parentPayload;

      if (payload.program === 'cattle') {
        children = [
          {
            id: `${parentId}-c0`,
            submitted_at: submittedAt,
            date,
            team_member: teamMember,
            herd: payload.cattleHerd,
            feeds: payload.cattleFeedsJ ?? [],
            minerals: [],
            mortality_count: 0,
            source: 'add_feed_webform',
          },
        ];
        parentPayload = {herd: payload.cattleHerd, feeds: payload.cattleFeedsJ ?? []};
      } else if (payload.program === 'sheep') {
        children = [
          {
            id: `${parentId}-c0`,
            submitted_at: submittedAt,
            date,
            team_member: teamMember,
            flock: payload.sheepFlock,
            feeds: payload.sheepFeedsJ ?? [],
            minerals: [],
            mortality_count: 0,
            source: 'add_feed_webform',
          },
        ];
        parentPayload = {flock: payload.sheepFlock, feeds: payload.sheepFeedsJ ?? []};
      } else {
        // broiler / pig / layer — multi-row form. Each group carries
        // batchLabel + feedType + feedLbs; layer additionally carries a
        // caller-resolved batchId (from AddFeedWebform's layerBatchIdMap
        // lookup). pig derives batch_id from the slug; broiler has no
        // batch_id column.
        const main = {
          batchLabel: payload.batchLabel,
          feedType: payload.feedType ?? null,
          feedLbs: payload.feedLbs,
          batchId: payload.batchId ?? null,
        };
        const extras = (payload.extraGroups ?? []).filter((g) => g && g.batchLabel);
        const all = [main, ...extras];
        children = all.map((g, i) =>
          buildMultiRowChild(payload.program, g, parentId, i, submittedAt, date, teamMember),
        );
        parentPayload = {
          batchLabel: payload.batchLabel,
          feedType: payload.feedType ?? null,
          feedLbs: payload.feedLbs,
          extraGroups: extras,
        };
      }

      return {
        rpc: 'submit_add_feed_batch',
        args: {
          parent_in: {
            id: parentId,
            client_submission_id: csid,
            submitted_at: submittedAt,
            program: payload.program,
            source: 'add_feed_webform',
            team_member: teamMember,
            date,
            payload: parentPayload,
          },
          children_in: children,
        },
      };
    },
  }),
});

function buildMultiRowChild(program, group, parentId, index, submittedAt, date, teamMember) {
  const lbs = parseFloat(group.feedLbs);
  const base = {
    id: `${parentId}-c${index}`,
    submitted_at: submittedAt,
    date,
    team_member: teamMember,
    batch_label: group.batchLabel,
    feed_lbs: Number.isFinite(lbs) ? lbs : 0,
    source: 'add_feed_webform',
  };
  if (program === 'pig') {
    // pig_dailys has no feed_type column — RPC's pig branch ignores any
    // feed_type that arrives anyway, but we don't put it in children_in
    // either to keep the queued record honest.
    return {
      ...base,
      batch_id: (group.batchLabel || '').toLowerCase().replace(/[^a-z0-9]+/g, '-'),
    };
  }
  if (program === 'layer') {
    return {
      ...base,
      // batch_id for layer is resolved client-side from the layer batch map;
      // the RPC accepts whatever we send. The synchronous AddFeedWebform
      // built batch_id from layerBatchIdMap[bl] — that mapping is part of
      // the `payload` that the caller (AddFeedWebform) prepares before
      // calling submit(). Here we just pass through what was prepared.
      batch_id: group.batchId ?? null,
      feed_type: group.feedType ?? null,
    };
  }
  // broiler
  return {
    ...base,
    feed_type: group.feedType ?? null,
  };
}

export const RPC_FORM_KINDS = Object.freeze(Object.keys(REGISTRY));

export function getRpcFormConfig(formKind) {
  const entry = REGISTRY[formKind];
  if (!entry) {
    throw new Error(`offlineRpcForms: unknown form_kind ${JSON.stringify(formKind)}`);
  }
  return entry;
}

export function buildRpcRequest(formKind, payload, ids) {
  return getRpcFormConfig(formKind).buildArgs(payload, ids);
}

// Test-only export.
export const _REGISTRY = REGISTRY;
