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
  // Phase 1D-A: hasPhotos flipped to true (semantically "supported", not
  // "required"). The hook short-circuits at submit() if payload.photos is
  // empty/absent, falling through to the existing flat path. Existing
  // tests/pig_dailys_offline.spec.js (4 active cases) lock that behavior.
  // (Phase 1C-B's 5th case — the photo-online-only "needs a connection"
  // assertion — was retired in 1D-A when photos became queue-capable.)
  //
  // Important shape rules:
  //   - NO `source` field — current PigDailys rows omit it; preserve the
  //     existing row shape exactly. The §7 contract for the
  //     `*_dailys.source` column treats null as the default, and existing
  //     dashboards filter by `source === 'add_feed_webform'` (not by
  //     'webform'). Adding a value here would change row semantics.
  //   - NO `feed_type` — pig_dailys has no such column (§7).
  //   - `photos` jsonb — paths-only metadata when payload.photos has entries
  //     (per the Phase 1D-A prepared-photo flow). Empty array `[]` for the
  //     no-photo path (preserves the byte-identical row shape Phase 1C-B
  //     locked). Raw File/Blob refs NEVER reach the row — sanitized in the
  //     hook before buildRecord runs.
  //   - Numeric coercion (parseInt/parseFloat) happens at the form layer,
  //     not here. The registry passes payload values through unchanged so
  //     replay produces byte-identical rows.
  // Phase 1D-B: WebformHub broiler / cattle / sheep daily-report photo offline
  // queue. pig_dailys (above-flipped in 1D-A) is reused by both
  // PigDailysWebform standalone (1D-A) and WebformHub /webforms/pig (1D-B).
  // Layer (layer_dailys) deferred to 1D-C — setHousingAnchorFromReport is a
  // load-bearing post-sync DB write and needs an explicit replay-hook design.
  // Egg (egg_dailys) permanently excluded — mig 030 omits egg_dailys.photos.
  //
  // Each new entry's buildRecord mirrors the row shape today's WebformHub
  // submit handlers assemble at the time of direct-insert, MINUS raw Blob
  // refs (sanitized payload contract: payload.photos arrives as metadata
  // only here; the hook strips raw File[] before calling buildRecord).
  // Locked exact shapes:
  //   - poultry_dailys: NO source field (current rows omit it).
  //   - cattle_dailys: source: 'daily_webform' (current row literal).
  //   - sheep_dailys:  source: 'daily_webform'; mortality_count default 0.
  //   - All: photos: [] when payload.photos absent (consistent with pig_dailys).
  //
  // Critical replay invariant: cattle/sheep feeds + minerals jsonb arrays
  // are PASS-THROUGH from payload — the form does the cattle_feed_inputs
  // nutrition-snapshot lookup ONCE before calling submit(). Replay produces
  // byte-identical rows even if cattle_feed_inputs values change between
  // submit and replay (matches the §2.2 cattle Decision 4 snapshot contract:
  // "editing the parent feed in admin does NOT rewrite historical reports").
  poultry_dailys: Object.freeze({
    table: 'poultry_dailys',
    hasPhotos: true,
    /**
     * @param {object} payload
     *   {date, team_member, batch_label,
     *    feed_type, feed_lbs, grit_lbs,
     *    group_moved, waterer_checked,
     *    mortality_count, mortality_reason, comments,
     *    photos?}
     */
    buildRecord(payload, {id, csid}) {
      return {
        id,
        client_submission_id: csid,
        submitted_at: new Date().toISOString(),
        date: payload.date,
        team_member: payload.team_member,
        batch_label: payload.batch_label,
        feed_type: payload.feed_type,
        feed_lbs: payload.feed_lbs,
        grit_lbs: payload.grit_lbs,
        group_moved: payload.group_moved,
        waterer_checked: payload.waterer_checked,
        mortality_count: payload.mortality_count,
        mortality_reason: payload.mortality_reason,
        comments: payload.comments,
        photos: Array.isArray(payload.photos) ? payload.photos : [],
      };
    },
  }),

  cattle_dailys: Object.freeze({
    table: 'cattle_dailys',
    hasPhotos: true,
    /**
     * @param {object} payload
     *   {date, team_member, herd,
     *    feedsJ, mineralsJ,        // pre-built jsonb arrays from form layer
     *    fence_voltage, water_checked,
     *    mortality_count?, mortality_reason?, issues,
     *    photos?}
     */
    buildRecord(payload, {id, csid}) {
      return {
        id,
        client_submission_id: csid,
        submitted_at: new Date().toISOString(),
        date: payload.date,
        team_member: payload.team_member,
        herd: payload.herd,
        feeds: Array.isArray(payload.feedsJ) ? payload.feedsJ : [],
        minerals: Array.isArray(payload.mineralsJ) ? payload.mineralsJ : [],
        fence_voltage: payload.fence_voltage,
        water_checked: payload.water_checked,
        mortality_count: payload.mortality_count != null ? payload.mortality_count : 0,
        mortality_reason: payload.mortality_reason ?? null,
        issues: payload.issues ?? null,
        source: 'daily_webform',
        photos: Array.isArray(payload.photos) ? payload.photos : [],
      };
    },
  }),

  sheep_dailys: Object.freeze({
    table: 'sheep_dailys',
    hasPhotos: true,
    /**
     * @param {object} payload
     *   {date, team_member, flock,
     *    feedsJ, mineralsJ,        // pre-built jsonb arrays
     *    fence_voltage_kv, waterers_working,
     *    mortality_count?,         // defaults to 0
     *    comments,
     *    photos?}
     */
    buildRecord(payload, {id, csid}) {
      return {
        id,
        client_submission_id: csid,
        submitted_at: new Date().toISOString(),
        date: payload.date,
        team_member: payload.team_member,
        flock: payload.flock,
        feeds: Array.isArray(payload.feedsJ) ? payload.feedsJ : [],
        minerals: Array.isArray(payload.mineralsJ) ? payload.mineralsJ : [],
        fence_voltage_kv: payload.fence_voltage_kv,
        waterers_working: !!payload.waterers_working,
        mortality_count: payload.mortality_count != null ? payload.mortality_count : 0,
        comments: payload.comments ?? null,
        source: 'daily_webform',
        photos: Array.isArray(payload.photos) ? payload.photos : [],
      };
    },
  }),

  pig_dailys: Object.freeze({
    table: 'pig_dailys',
    hasPhotos: true,
    /**
     * @param {object} payload — form-collected fields. The form coerces
     *   numerics before calling submit(); this registry just passes
     *   through. Expected keys:
     *     {date, team_member, batch_id, batch_label,
     *      pig_count, feed_lbs,
     *      group_moved, nipple_drinker_moved, nipple_drinker_working,
     *      troughs_moved, fence_walked, fence_voltage,
     *      issues,
     *      photos?}  // photo-meta array (path/name/mime/size_bytes/captured_at)
     *                // OR empty/absent for the no-photo flat path. Raw File/Blob
     *                // never reaches here — hook strips before calling.
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
        photos: Array.isArray(payload.photos) ? payload.photos : [],
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
