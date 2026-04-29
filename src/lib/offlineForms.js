// Form-kind registry for the offline submission queue. Each entry maps a
// stable form_kind string to its destination Supabase table + a
// buildRecord(payload, ids) function that assembles the row to upsert.
//
// Phase 1B ships the canary entry (fuel_supply). Phase 1C fans out to
// weigh_ins, add_feed, pig_dailys with one entry per form. Phase 2 adds
// hasPhotos:true on equipment_fueling + the 5 daily-report forms.
//
// Locked decisions (PROJECT.md §8 Initiative C v1 plan capture):
//   - client_submission_id is generated client-side, persisted on the row.
//   - Replay uses .upsert(record, {onConflict: 'client_submission_id',
//     ignoreDuplicates: true}). Don't rename the conflict-target key.
//   - Photos jsonb column shape mirrors equipment_fuelings.photos:
//       [{name, path, mime, size_bytes, captured_at}]
//     Phase 1B canary has hasPhotos:false; Phase 2 wires the first
//     hasPhotos:true entry.
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
