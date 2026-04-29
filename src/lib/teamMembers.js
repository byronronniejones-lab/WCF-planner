// Team-member master roster — canonical helpers.
//
// Storage:
//   - Canonical: webform_config.team_roster — [{id, name, active}]
//   - Legacy mirror: webform_config.team_members — string[] of active names
//     (preserved indefinitely so unmigrated readers keep working)
//
// Read order: prefer team_roster; fall back to legacy team_members.
// Write order: central admin save writes BOTH (canonical first, then mirror).
//
// IDs are stable random tokens minted at first registration. They never
// derive from the name — names are editable display text and may be reused
// or corrected without changing the underlying id. Two different people
// can share a name and stay distinct.
//
// Public-form code paths NEVER write the roster. Lazy migration from the
// legacy `string[]` shape only happens via the admin editor's save path.
// This keeps anonymous users from rewriting JSONB and avoids stomping
// concurrent admin edits.
//
// All writes use read-fresh-then-merge per the §7 webform_config rule —
// the helper centralizes that pattern so callers don't need to reimplement.

const ROSTER_KEY = 'team_roster';
const LEGACY_NAMES_KEY = 'team_members';

// ── ID minting ─────────────────────────────────────────────────────────────

export function newRosterId() {
  if (typeof globalThis.crypto !== 'undefined' && typeof globalThis.crypto.randomUUID === 'function') {
    return `tm-${globalThis.crypto.randomUUID()}`;
  }
  // Fallback: timestamp + random (matches the clientSubmissionId pattern).
  const ts = Date.now().toString(36);
  const r = Math.random().toString(36).slice(2, 10) + Math.random().toString(36).slice(2, 10);
  return `tm-${ts}-${r}`;
}

// ── normalization ──────────────────────────────────────────────────────────

function isObjectEntry(e) {
  return e && typeof e === 'object' && typeof e.name === 'string' && e.name.length > 0;
}

/**
 * Accepts:
 *   - undefined / null  → []
 *   - string[] (legacy) → mints id per name, active:true
 *   - object[] (new)    → preserves id/name/active, mints missing ids,
 *                         coerces active to boolean (default true)
 *   - anything else     → []
 *
 * Dedupes by id (case-sensitive). Sorts alpha by name for stable display.
 */
export function normalizeRoster(raw) {
  if (!Array.isArray(raw)) return [];
  const seen = new Map();
  for (const entry of raw) {
    if (typeof entry === 'string') {
      const name = entry.trim();
      if (!name) continue;
      // Mint a fresh id for each legacy string. Same name appearing twice in
      // a legacy array yields two roster entries — caller (admin) can later
      // merge if the duplication is unwanted.
      const id = newRosterId();
      seen.set(id, {id, name, active: true});
      continue;
    }
    if (!isObjectEntry(entry)) continue;
    const id = typeof entry.id === 'string' && entry.id.length > 0 ? entry.id : newRosterId();
    const name = entry.name.trim();
    if (!name) continue;
    const active = entry.active !== false; // default true; only explicit false flips
    if (!seen.has(id)) {
      seen.set(id, {id, name, active});
    }
  }
  return Array.from(seen.values()).sort((a, b) => a.name.localeCompare(b.name));
}

// ── reads ──────────────────────────────────────────────────────────────────

export function activeNames(roster) {
  return normalizeRoster(roster)
    .filter((e) => e.active)
    .map((e) => e.name);
}

export function allNames(roster) {
  return normalizeRoster(roster).map((e) => e.name);
}

export function findByName(roster, name) {
  if (typeof name !== 'string') return null;
  const trimmed = name.trim();
  if (!trimmed) return null;
  for (const e of normalizeRoster(roster)) {
    if (e.name === trimmed) return e;
  }
  return null;
}

export function findById(roster, id) {
  if (typeof id !== 'string') return null;
  for (const e of normalizeRoster(roster)) {
    if (e.id === id) return e;
  }
  return null;
}

// ── writes (central editor only) ───────────────────────────────────────────

export function addMember(roster, name) {
  const trimmed = typeof name === 'string' ? name.trim() : '';
  if (!trimmed) {
    throw new Error('addMember: name required');
  }
  const norm = normalizeRoster(roster);
  // Case-insensitive collision against ALL entries (active + inactive).
  const lc = trimmed.toLowerCase();
  if (norm.some((e) => e.name.toLowerCase() === lc)) {
    throw new Error(`addMember: "${trimmed}" already in roster`);
  }
  const next = [...norm, {id: newRosterId(), name: trimmed, active: true}];
  return next.sort((a, b) => a.name.localeCompare(b.name));
}

export function setActive(roster, id, active) {
  const norm = normalizeRoster(roster);
  let found = false;
  const next = norm.map((e) => {
    if (e.id === id) {
      found = true;
      return {...e, active: !!active};
    }
    return e;
  });
  if (!found) {
    throw new Error(`setActive: id ${JSON.stringify(id)} not in roster`);
  }
  return next;
}

export function renameMember(roster, id, newName) {
  const trimmed = typeof newName === 'string' ? newName.trim() : '';
  if (!trimmed) {
    throw new Error('renameMember: newName required');
  }
  const norm = normalizeRoster(roster);
  const target = norm.find((e) => e.id === id);
  if (!target) {
    throw new Error(`renameMember: id ${JSON.stringify(id)} not in roster`);
  }
  const lc = trimmed.toLowerCase();
  const collision = norm.find((e) => e.id !== id && e.name.toLowerCase() === lc);
  if (collision) {
    throw new Error(`renameMember: "${trimmed}" already in roster`);
  }
  const next = norm.map((e) => (e.id === id ? {...e, name: trimmed} : e));
  return next.sort((a, b) => a.name.localeCompare(b.name));
}

// ── persistence ────────────────────────────────────────────────────────────

/**
 * Reads the roster from webform_config. Prefers team_roster (canonical),
 * falls back to team_members (legacy string[]). Always returns the
 * normalized object[] shape — callers don't need to handle the legacy
 * format.
 *
 * Read-only: never writes. Lazy-conversion from legacy → canonical only
 * happens via saveRoster (admin path).
 */
export async function loadRoster(sb) {
  const {data: rosterRow} = await sb.from('webform_config').select('data').eq('key', ROSTER_KEY).maybeSingle();
  if (rosterRow && Array.isArray(rosterRow.data)) {
    return normalizeRoster(rosterRow.data);
  }
  const {data: legacyRow} = await sb.from('webform_config').select('data').eq('key', LEGACY_NAMES_KEY).maybeSingle();
  if (legacyRow && Array.isArray(legacyRow.data)) {
    return normalizeRoster(legacyRow.data);
  }
  return [];
}

/**
 * Persist the roster. Writes BOTH:
 *   - webform_config.team_roster  (canonical [{id,name,active}])
 *   - webform_config.team_members (legacy mirror — active names only)
 *
 * Read-fresh-then-merge: re-fetches the canonical row right before upsert
 * and reconciles. Two cases:
 *
 *   1. Canonical row exists. Merge by id — local wins on collisions
 *      (admin's edit is the intent), fresh-only entries are preserved
 *      (concurrent admin add from another tab/session).
 *
 *   2. Canonical row does NOT exist yet. This is the FIRST canonical save
 *      after a legacy-only DB. `loadRoster` already minted random ids for
 *      every legacy name on the read that produced `nextRoster`, so the
 *      local roster IS the truth. **Do NOT merge against the legacy
 *      `team_members` string[]** here: a fresh `normalizeRoster` of the
 *      legacy mirror would mint DIFFERENT random ids for the same names,
 *      and the id-based merge would produce duplicate roster entries
 *      (Codex-flagged 2026-04-29 pre-commit). Skip the legacy fallback
 *      entirely on the first canonical save.
 *
 *      Concurrent-tab risk on first save: minimal — the only writer is
 *      the central editor, and any concurrent admin tab that loaded the
 *      same legacy mirror at roughly the same time also holds different
 *      random ids in its local state. Whichever tab lands second sees
 *      the now-canonical row and merges by id correctly. The first-save
 *      shortcut only fires while the canonical row is genuinely missing.
 *
 * Returns the persisted roster.
 */
export async function saveRoster(sb, nextRoster) {
  const local = normalizeRoster(nextRoster);
  const {data: freshRow} = await sb.from('webform_config').select('data').eq('key', ROSTER_KEY).maybeSingle();

  let merged;
  if (freshRow && Array.isArray(freshRow.data)) {
    const fresh = normalizeRoster(freshRow.data);
    const localById = new Map(local.map((e) => [e.id, e]));
    merged = [...local];
    for (const f of fresh) {
      if (!localById.has(f.id)) {
        merged.push(f);
      }
    }
    merged.sort((a, b) => a.name.localeCompare(b.name));
  } else {
    // First canonical save — local is authoritative. See doc comment above
    // for why we skip the legacy-fallback merge here.
    merged = local;
  }

  const activeMirror = merged.filter((e) => e.active).map((e) => e.name);

  const {error: rErr} = await sb.from('webform_config').upsert({key: ROSTER_KEY, data: merged}, {onConflict: 'key'});
  if (rErr) throw new Error(`saveRoster: roster write failed: ${rErr.message}`);

  const {error: mErr} = await sb
    .from('webform_config')
    .upsert({key: LEGACY_NAMES_KEY, data: activeMirror}, {onConflict: 'key'});
  if (mErr) throw new Error(`saveRoster: legacy mirror write failed: ${mErr.message}`);

  return merged;
}
