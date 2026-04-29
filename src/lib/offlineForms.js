// Form-kind registry for the offline submission queue. Each entry maps a
// stable form_kind string to its destination Supabase table + a
// buildRecord(payload, ids) function that assembles the row to insert.
//
// Phase 1B ships the canary entry (fuel_supply). Phase 1C fans out to
// weigh_ins, pig_dailys, etc. with one entry per form. Add Feed is a
// special case — see "Multi-row submissions" below. Phase 2 adds
// hasPhotos:true on equipment_fueling + the 5 daily-report forms.
//
// Idempotency contract (revised 2026-04-29 Phase 1B canary):
//   - client_submission_id is generated client-side, persisted on the row.
//   - Anon webforms use plain `.insert(record)` and treat code 23505
//     referencing the unique index `*_client_submission_id_uq` as
//     already-synced. The unique index alone gives the dedup guarantee.
//     The original Phase 1A plan called for `.upsert(record, {onConflict:
//     'client_submission_id', ignoreDuplicates: true})` but PostgREST's
//     ON CONFLICT path requires SELECT privilege on the conflict-target
//     column, and the public webform tables grant anon INSERT only.
//     Authenticated callers (admin scripts) can still upsert.
//   - The unique index is non-partial (mig 030); legacy null csids
//     coexist by NULLS DISTINCT.
//
// Multi-row submissions (Add Feed and any future parent-scoped form):
//   - The flat per-row queue model in this registry CANNOT be used
//     directly for forms that produce N child rows from one operator
//     submission (atomicity + photo attribution both break). Those
//     forms instead call a SECURITY DEFINER RPC that owns idempotency
//     at the parent level — `submit_add_feed_batch` for /addfeed (mig
//     034). Children link via daily_submission_id; child
//     client_submission_id stays NULL. The RPC's race-safe ON CONFLICT
//     DO NOTHING RETURNING + fallback SELECT pattern returns
//     deterministic idempotent success without surfacing 23505.
//     See PROJECT.md §7 daily_submissions entry.
//   - Add Feed is intentionally NOT a registry entry — it doesn't need
//     useOfflineSubmit because the RPC's atomicity semantics differ
//     from the flat insert model. A future build can add a parent-aware
//     queue layer if /addfeed needs offline support.
//
// Photos jsonb column shape mirrors equipment_fuelings.photos:
//   [{name, path, mime, size_bytes, captured_at}]
//
// Don't rely on a fall-through "default form_kind" — getFormConfig throws
// on unknown kinds so a typo in a hook call is loud, not silent.

const REGISTRY = Object.freeze({
  fuel_supply: Object.freeze({
    table: 'fuel_supplies',
    hasPhotos: false,
    /**
     * @param {object} payload — form-collected fields
     *   {date, gallons, fuel_type, destination, team_member, notes}
     * @param {object} ids
     * @param {string} ids.id — client-generated row id (stable across retries)
     * @param {string} ids.csid — client_submission_id (stable across retries)
     */
    buildRecord(payload, {id, csid}) {
      return {
        id,
        client_submission_id: csid,
        date: payload.date,
        gallons: payload.gallons,
        fuel_type: payload.fuel_type ?? null,
        destination: payload.destination,
        team_member: payload.team_member,
        notes: payload.notes ?? null,
        source: 'webform',
      };
    },
  }),

  // Phase 1C-B: PigDailys no-photo offline queue.
  //
  // Important shape rules:
  //   - NO `source` field — current PigDailys rows omit it; preserve the
  //     existing row shape exactly. The §7 contract for the
  //     `*_dailys.source` column treats null as the default, and existing
  //     dashboards filter by `source === 'add_feed_webform'` (not by
  //     'webform'). Adding a value here would change row semantics.
  //   - NO `feed_type` — pig_dailys has no such column (§7).
  //   - `photos: []` literal — Phase 1C-B is no-photo only. The form layer
  //     gates the queue path on `wfPhotos.length === 0`; a photo-attached
  //     submission stays fully online and does NOT touch this registry.
  //     Photo offline support is the Phase 1D photo queue's job.
  //   - Numeric coercion (parseInt/parseFloat) happens at the form layer,
  //     not here. The registry passes payload values through unchanged so
  //     replay produces byte-identical rows.
  pig_dailys: Object.freeze({
    table: 'pig_dailys',
    hasPhotos: false,
    /**
     * @param {object} payload — form-collected fields. The form coerces
     *   numerics before calling submit(); this registry just passes
     *   through. Expected keys:
     *     {date, team_member, batch_id, batch_label,
     *      pig_count, feed_lbs,
     *      group_moved, nipple_drinker_moved, nipple_drinker_working,
     *      troughs_moved, fence_walked, fence_voltage,
     *      issues}
     * @param {object} ids
     * @param {string} ids.id — client-generated row id (stable across retries)
     * @param {string} ids.csid — client_submission_id (stable across retries)
     */
    buildRecord(payload, {id, csid}) {
      return {
        id,
        client_submission_id: csid,
        submitted_at: new Date().toISOString(),
        date: payload.date,
        team_member: payload.team_member,
        batch_id: payload.batch_id,
        batch_label: payload.batch_label,
        pig_count: payload.pig_count,
        feed_lbs: payload.feed_lbs,
        group_moved: payload.group_moved,
        nipple_drinker_moved: payload.nipple_drinker_moved,
        nipple_drinker_working: payload.nipple_drinker_working,
        troughs_moved: payload.troughs_moved,
        fence_walked: payload.fence_walked,
        fence_voltage: payload.fence_voltage,
        issues: payload.issues,
        photos: [],
      };
    },
  }),
});

export const FORM_KINDS = Object.freeze(Object.keys(REGISTRY));

export function getFormConfig(formKind) {
  const entry = REGISTRY[formKind];
  if (!entry) {
    throw new Error(`offlineForms: unknown form_kind ${JSON.stringify(formKind)}`);
  }
  return entry;
}

export function buildRecord(formKind, payload, ids) {
  return getFormConfig(formKind).buildRecord(payload, ids);
}

// Only exported for tests; production callers go through getFormConfig.
export const _REGISTRY = REGISTRY;
