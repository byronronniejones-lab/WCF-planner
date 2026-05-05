// Team-member per-form availability filters — canonical helpers.
//
// Storage: webform_config.team_availability — shape:
//   {forms: {<formKey>: {hiddenIds: [<rosterId>, ...]}}}
//
// Membership rules:
//   - `team_roster` is the master active list (see teamMembers.js). This
//     module only narrows it. New active members default to visible
//     everywhere — a formKey absent from `forms` means everyone visible
//     for that form.
//   - `hiddenIds` references stable roster IDs (not names). Renaming a
//     member preserves their hide state. Same-name reuse (delete + re-add)
//     does NOT inherit hide state because the new id differs.
//   - Inactive entries are already excluded by normalizeRoster — this
//     module operates against `activeNames` semantics from the start.
//   - Orphan IDs (in hiddenIds but not in roster) are tolerated:
//     `availableNamesFor` filters by id intersection, so stale ids are
//     no-ops. Cleanup happens at delete time via
//     `cleanAvailabilityForDeletedId` — hygiene, not correctness.
//
// Single-writer contract: only the central admin editor (rendered inside
// WebformsAdminView) writes this key. Public-form code paths NEVER write.
// Read-fresh-then-merge inside `saveAvailability` mirrors the saveRoster
// pattern from teamMembers.js for concurrent-tab safety.

import {normalizeRoster} from './teamMembers.js';

const KEY = 'team_availability';

// The 10 form keys this module gates. Keep alphabetic for stable admin UI
// rendering. Adding a new form is one entry here + one consumer call to
// `availableNamesFor`.
//
// 'tasks-public' (added 2026-05-05 with C3) gates the Submitted-by /
// Assignor dropdown on /webforms/tasks. The Assignee dropdown on the
// same form is gated by a SEPARATE config key
// `webform_config.tasks_public_assignee_availability`
// ({hiddenProfileIds: [<uuid>, ...]}) — roster IDs (here) and profile
// UUIDs (there) MUST NOT mix in the same hiddenIds array.
export const TEAM_AVAILABILITY_FORM_KEYS = [
  'add-feed',
  'broiler-dailys',
  'cattle-dailys',
  'egg-dailys',
  'fuel-supply',
  'layer-dailys',
  'pig-dailys',
  'sheep-dailys',
  'tasks-public',
  'weigh-ins',
];

// ── normalization ──────────────────────────────────────────────────────────

/**
 * Coerces any input into the canonical `{forms: {<key>: {hiddenIds: []}}}`
 * shape. Garbage / null / arrays / wrong types collapse to `{forms: {}}`.
 * Per-form `hiddenIds` arrays are filtered to non-empty strings and
 * de-duplicated.
 */
export function normalizeAvailability(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return {forms: {}};
  }
  const forms = {};
  const inputForms = raw.forms;
  if (inputForms && typeof inputForms === 'object' && !Array.isArray(inputForms)) {
    for (const [key, val] of Object.entries(inputForms)) {
      if (!val || typeof val !== 'object' || Array.isArray(val)) continue;
      const ids = Array.isArray(val.hiddenIds) ? val.hiddenIds : [];
      const cleaned = ids.filter((id) => typeof id === 'string' && id.length > 0);
      forms[key] = {hiddenIds: Array.from(new Set(cleaned))};
    }
  }
  return {forms};
}

// ── reads ──────────────────────────────────────────────────────────────────

/**
 * Returns the visible names for a given form. Active roster names minus
 * those whose id is in `availability.forms[formKey].hiddenIds`. Unknown
 * formKey or missing entry → all active names. Inactive entries are
 * filtered out by the underlying normalizeRoster.
 *
 * Output ordering matches normalizeRoster (alphabetical by name).
 */
export function availableNamesFor(formKey, roster, availability) {
  const norm = normalizeRoster(roster);
  const av = normalizeAvailability(availability);
  const entry = av.forms[formKey];
  if (!entry || entry.hiddenIds.length === 0) {
    return norm.map((e) => e.name);
  }
  const hidden = new Set(entry.hiddenIds);
  return norm.filter((e) => !hidden.has(e.id)).map((e) => e.name);
}

// ── writes (central editor only) ───────────────────────────────────────────

/**
 * Toggle a single (formKey, id) hidden flag. Immutable update; mints a
 * `{hiddenIds: []}` entry if the formKey wasn't present.
 */
export function setHidden(availability, formKey, id, hidden) {
  if (typeof formKey !== 'string' || !formKey) {
    throw new Error('setHidden: formKey required');
  }
  if (typeof id !== 'string' || !id) {
    throw new Error('setHidden: id required');
  }
  const av = normalizeAvailability(availability);
  const cur = new Set(av.forms[formKey]?.hiddenIds || []);
  if (hidden) {
    cur.add(id);
  } else {
    cur.delete(id);
  }
  return {forms: {...av.forms, [formKey]: {hiddenIds: Array.from(cur)}}};
}

/**
 * Strip a roster id from every formKey's hiddenIds. Used by the
 * coordinated delete flow BEFORE the roster save lands, so that no
 * dangling reference remains if save succeeds.
 *
 * Empty `hiddenIds` arrays are preserved (stable shape across delete +
 * re-add). Idempotent — running twice on the same id is a no-op after
 * the first pass.
 */
export function cleanAvailabilityForDeletedId(availability, id) {
  if (typeof id !== 'string' || !id) {
    throw new Error('cleanAvailabilityForDeletedId: id required');
  }
  const av = normalizeAvailability(availability);
  const forms = {};
  for (const [key, val] of Object.entries(av.forms)) {
    forms[key] = {hiddenIds: val.hiddenIds.filter((x) => x !== id)};
  }
  return {forms};
}

// ── persistence ────────────────────────────────────────────────────────────

export async function loadAvailability(sb) {
  const {data: row} = await sb.from('webform_config').select('data').eq('key', KEY).maybeSingle();
  return normalizeAvailability(row && row.data ? row.data : null);
}

/**
 * Persist availability. Read-fresh-then-merge per the §7 webform_config
 * rule: re-fetches the canonical row before upsert and reconciles.
 *
 * Merge: local wins per-formKey. FormKeys present only in fresh are
 * preserved (lets a concurrent admin's edit on a different form survive).
 * FormKeys present in local override fresh entirely — admin's intent on
 * this form is the truth.
 *
 * The realistic concurrency profile is one admin at a time editing one
 * form at a time. Concurrent edits on the SAME formKey from different
 * tabs are rare; per-key local-wins favors predictability (admin's
 * unhide / hide stays as they intended) over per-id union (which would
 * silently un-do unhides when fresh still had the id). Orphan tolerance
 * in `availableNamesFor` is the safety net for any merge edge case.
 *
 * Returns the persisted availability.
 */
export async function saveAvailability(sb, nextAvailability) {
  const local = normalizeAvailability(nextAvailability);
  const {data: freshRow} = await sb.from('webform_config').select('data').eq('key', KEY).maybeSingle();
  const fresh = normalizeAvailability(freshRow && freshRow.data ? freshRow.data : null);

  const merged = {forms: {...fresh.forms, ...local.forms}};

  const {error} = await sb.from('webform_config').upsert({key: KEY, data: merged}, {onConflict: 'key'});
  if (error) throw new Error(`saveAvailability: write failed: ${error.message}`);
  return merged;
}
