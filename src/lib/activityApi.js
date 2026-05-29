// Activity Layer client API — read-only audit history + audit-event writes.
//
// This is the LIVE surface today:
//   * listActivityEvents → list_activity_events(entity_type, entity_id,
//     limit). Audit reads for a single entity; rows carry
//     mentioned_profile_ids[] + mentioned_profile_names[]. Used by
//     RecordActivityLog (the read-only Activity log on record pages).
//   * recordActivityEvent / recordFieldChange / recordStatusChange →
//     record_activity_event(...). Audit writes (field.updated,
//     status.changed, record.created/deleted/restored). Best-effort,
//     not transactional (mig 066).
//   * renderMentionSegments → pure renderer that chips "@Name" spans by
//     matching mentioned_profile_names[]; reused by the Comments layer.
//
// The legacy global Activity composer (ActivityModal/ActivityPanel) was
// retired. Its client helpers — countActivityForEntity, postActivityComment,
// editActivityEvent, deleteActivityEvent — were removed. User discussion now
// lives in CommentsSection (the comments_foundation layer, mig 071); Activity
// is read-only audit/system history. The underlying post/edit/delete/count
// SECDEF RPCs still exist in PROD (historical migrations 058/060) but have no
// client caller.
//
// The platform contract: clients NEVER hit `.from('activity_events')` or
// `.from('activity_mentions')` directly. RLS lockdown on the tables blocks it
// anyway (REVOKE ALL from authenticated), but the static lock also rejects any
// such reference in src/. The RPC layer is the only path; the SECDEF resolver
// re-checks the source entity's read gate.
//
// Mention rendering (mig 060 contract): the visible body is freeform plain
// text — users only ever see "@DisplayName", never uuids. renderMentionSegments
// chips "@Name" spans by matching mentioned_profile_names[] returned from
// list_activity_events. Best-effort: ambiguous names (two teammates with the
// same display name) all render as chips with the first matching profile id.

export const ACTIVITY_CHANGE_EVENT = 'wcf-activity-change';

export function fireActivityChangeEvent(entityType, entityId) {
  if (typeof window === 'undefined' || !window.dispatchEvent) return;
  try {
    window.dispatchEvent(new CustomEvent(ACTIVITY_CHANGE_EVENT, {detail: {entityType, entityId}}));
  } catch (_e) {
    /* CustomEvent not supported in some test envs */
  }
}

/**
 * List activity events for one entity (newest first). Each row carries
 * both `mentioned_profile_ids` and `mentioned_profile_names` arrays
 * (same length, same order) for chip rendering. Soft-deleted rows are
 * INCLUDED so the panel can render "(comment deleted)" placeholders.
 */
export async function listActivityEvents(sb, entityType, entityId, {limit = 50} = {}) {
  if (!sb) return [];
  if (!entityType || !entityId) return [];
  const {data, error} = await sb.rpc('list_activity_events', {
    p_entity_type: entityType,
    p_entity_id: entityId,
    p_limit: limit,
  });
  if (error) throw new Error(`listActivityEvents: ${error.message || String(error)}`);
  return data || [];
}

// ── Activity Layer: general event recording (mig 066) ───────────────────
//
// Platform write path for the WCF Activity Layer. Every user-initiated
// mutation should flow through recordActivityEvent or one of the
// convenience wrappers below. Do NOT use for autosave ticks or
// intermediate state — only for intentional saved changes.
//
// Allowed event types (server-enforced):
//   field.updated, status.changed, record.created,
//   record.deleted, record.restored

export async function recordActivityEvent(sb, {entityType, entityId, eventType, entityLabel, body, payload}) {
  if (!sb) throw new Error('recordActivityEvent: sb required');
  if (!entityType || !entityId) throw new Error('recordActivityEvent: entityType + entityId required');
  if (!eventType) throw new Error('recordActivityEvent: eventType required');
  const {data, error} = await sb.rpc('record_activity_event', {
    p_entity_type: entityType,
    p_entity_id: entityId,
    p_event_type: eventType,
    p_entity_label: entityLabel || null,
    p_body: body || null,
    p_payload: payload || {},
  });
  if (error) throw new Error(`recordActivityEvent: ${error.message || String(error)}`);
  fireActivityChangeEvent(entityType, entityId);
  return data;
}

export function buildFieldChangeSummary(changes) {
  if (!Array.isArray(changes) || changes.length === 0) return {body: '', changes: []};
  const parts = changes.map((c) => {
    const label = c.label || c.field;
    if (!c.new_present && c.old_present) return 'Cleared ' + label;
    if (c.new_present && !c.old_present) return 'Set ' + label;
    const excerpt = typeof c.to === 'string' && c.to.length > 80 ? c.to.slice(0, 80) + '…' : c.to;
    return 'Updated ' + label + (excerpt != null ? ': ' + excerpt : '');
  });
  return {body: parts.join('; '), changes};
}

export async function recordFieldChange(sb, {entityType, entityId, entityLabel, changes}) {
  const summary = buildFieldChangeSummary(changes);
  return recordActivityEvent(sb, {
    entityType,
    entityId,
    eventType: 'field.updated',
    entityLabel,
    body: summary.body,
    payload: {changes: summary.changes},
  });
}

export async function recordStatusChange(sb, {entityType, entityId, entityLabel, from, to}) {
  const body = 'Status changed from ' + (from || '(none)') + ' to ' + (to || '(none)');
  return recordActivityEvent(sb, {
    entityType,
    entityId,
    eventType: 'status.changed',
    entityLabel,
    body,
    payload: {changes: [{field: 'status', label: 'Status', from, to, old_present: !!from, new_present: !!to}]},
  });
}

// ── Mention rendering helper (pure, exported for reuse + testing) ──────

/**
 * Split a comment body into renderable segments. Each "@Name" span whose
 * Name matches an entry in mentionedProfileNames becomes a chip; the
 * rest is plain text.
 *
 * Output is an array of:
 *   {type: 'text', text: '...'}
 *   {type: 'mention', display: 'Mak', profileId: 'uuid-or-null'}
 *
 * Multi-word names work (the picker inserts the full literal string).
 * Longest-match-wins so "@Test Admin" doesn't get partially eaten by
 * "@Test" if both names exist.
 *
 * Ambiguous case: if two mentioned profiles share the same display
 * name, all "@Name" spans chip with the FIRST profileId in the array.
 * The notification fan-out (server-side) is unaffected — every uuid
 * the user picked is notified separately. profileId may be null if
 * the renderer is called without the ids array (text-only chipping).
 */
export function renderMentionSegments(body, mentionedProfileNames = [], mentionedProfileIds = []) {
  if (!body || typeof body !== 'string') return [];
  if (!Array.isArray(mentionedProfileNames) || mentionedProfileNames.length === 0) {
    return [{type: 'text', text: body}];
  }
  // Pair name → first profile id. Names array can contain duplicates;
  // keep the first occurrence so the chip carries a stable id.
  const nameToId = new Map();
  for (let i = 0; i < mentionedProfileNames.length; i++) {
    const n = mentionedProfileNames[i];
    if (!n || nameToId.has(n)) continue;
    nameToId.set(n, mentionedProfileIds[i] || null);
  }
  // Longest-match-wins so multi-word names beat shorter substrings.
  const sortedNames = [...nameToId.keys()].filter((n) => n.length > 0).sort((a, b) => b.length - a.length);
  if (sortedNames.length === 0) return [{type: 'text', text: body}];

  const out = [];
  let i = 0;
  while (i < body.length) {
    if (body[i] !== '@') {
      // Accumulate plain text until the next '@'.
      let j = i + 1;
      while (j < body.length && body[j] !== '@') j++;
      out.push({type: 'text', text: body.slice(i, j)});
      i = j;
      continue;
    }
    // body[i] === '@' — try to match a known mention name starting here.
    let matched = null;
    for (const name of sortedNames) {
      if (body.startsWith('@' + name, i)) {
        // Word-boundary on the right side: next char must be end-of-string
        // or non-name punctuation so "@Nick" doesn't match inside "@Nickname".
        const tailIdx = i + 1 + name.length;
        const tail = body[tailIdx];
        if (tail === undefined || /[\s.,!?;:)\]}'"-]/.test(tail)) {
          matched = name;
          break;
        }
      }
    }
    if (matched) {
      out.push({type: 'mention', display: matched, profileId: nameToId.get(matched)});
      i += 1 + matched.length;
    } else {
      // Lone @ not followed by a known mention — render as plain text.
      out.push({type: 'text', text: '@'});
      i += 1;
    }
  }
  // Collapse adjacent text segments for cleaner output.
  const collapsed = [];
  for (const seg of out) {
    const last = collapsed[collapsed.length - 1];
    if (seg.type === 'text' && last && last.type === 'text') {
      last.text += seg.text;
    } else {
      collapsed.push(seg);
    }
  }
  return collapsed;
}
