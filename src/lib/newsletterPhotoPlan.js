// ============================================================================
// newsletterPhotoPlan — weave fulfilled shot-list slots into the draft (CP-C).
// ----------------------------------------------------------------------------
// src/lib-only (not a _shared/Deno parity module). When the admin assigns an
// approved photo to a plan slot, "Place planned photos" inserts a normal
// (whitelisted) photo block for each fulfilled slot at the matching section — so
// photos land where the AI planned them, without any new block type.
// ============================================================================

function asArray(v) {
  return Array.isArray(v) ? v : [];
}

// Index of the heading block whose text matches the slot's section (so the photo
// is inserted right after it). -1 if no section match.
function findSectionIndex(blocks, section) {
  const s = (typeof section === 'string' ? section : '').trim().toLowerCase();
  if (!s) return -1;
  for (let i = 0; i < blocks.length; i++) {
    const b = blocks[i];
    if (b && b.type === 'heading' && typeof b.text === 'string' && b.text.toLowerCase().includes(s)) return i;
  }
  return -1;
}

// Insert before a trailing divider (the composer ends with divider + closing) so
// a photo doesn't land after the sign-off; else append.
function trailingInsertIndex(blocks) {
  for (let i = blocks.length - 1; i >= 0; i--) {
    if (blocks[i] && blocks[i].type === 'divider') return i;
  }
  return blocks.length;
}

// Return a NEW blocks array with a photo block added for each fulfilled slot
// (photoId set) that isn't already placed. Placement: after the matching section
// heading, else before the closing. Pure — no mutation of the input.
export function placePlannedPhotos(blocks, plan) {
  const list = asArray(blocks).slice();
  const placed = new Set(list.filter((b) => b && b.type === 'photo' && b.photoId).map((b) => b.photoId));
  for (const slot of asArray(plan)) {
    if (!slot || !slot.photoId || placed.has(slot.photoId)) continue;
    const block = {type: 'photo', photoId: slot.photoId};
    const idx = findSectionIndex(list, slot.section);
    if (idx >= 0) list.splice(idx + 1, 0, block);
    else list.splice(trailingInsertIndex(list), 0, block);
    placed.add(slot.photoId);
  }
  return list;
}

export function unfulfilledSlots(plan) {
  return asArray(plan).filter((s) => s && !s.photoId);
}

export function fulfilledSlots(plan) {
  return asArray(plan).filter((s) => s && s.photoId);
}

// How many fulfilled slots are NOT yet represented by a photo block in the draft
// (i.e. "Place planned photos" has work to do).
export function pendingPlacementCount(blocks, plan) {
  const placed = new Set(
    asArray(blocks)
      .filter((b) => b && b.type === 'photo' && b.photoId)
      .map((b) => b.photoId),
  );
  return fulfilledSlots(plan).filter((s) => !placed.has(s.photoId)).length;
}
