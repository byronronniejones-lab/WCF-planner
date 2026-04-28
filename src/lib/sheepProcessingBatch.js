// Shared helpers for attaching sheep weigh-in entries to a processing batch.
// Mirrors src/lib/cattleProcessingBatch.js semantics for sheep:
//   * Started counts (sheep.flock) are NOT mutated by transfer/processor
//     events — they're stamped onto weigh_ins.prior_herd_or_flock at
//     attach time and read back at detach time.
//   * Detach helper uses the same fallback hierarchy:
//       1. weigh_ins.prior_herd_or_flock
//       2. latest sheep_transfers row (reason='processing_batch')
//       3. block with reason='no_prior_flock' — never silently default
//   * On detach, both target_processing_batch_id AND send_to_processor are
//     cleared on every matching weigh_in row (the chip-clear lesson learned
//     from cattle commit 448152e applied here from day 1).

export function recomputeBatchTotals(rows) {
  const live = rows.reduce((s, r) => s + (parseFloat(r.live_weight) || 0), 0);
  const hang = rows.reduce((s, r) => s + (parseFloat(r.hanging_weight) || 0), 0);
  return {
    total_live_weight: live > 0 ? Math.round(live * 10) / 10 : null,
    total_hanging_weight: hang > 0 ? Math.round(hang * 10) / 10 : null,
  };
}

// Walk sheep.tag + old_tags the same way the webform and admin tab do when
// resolving prior-tag history. Excludes source='import' (selling-farm tags
// can collide with WCF's own numbering — same rule as cattle).
function findSheepByAnyTag(sheepList, tag) {
  if (!tag) return null;
  const t = String(tag).trim();
  const byCurrent = sheepList.find((s) => s.tag === t);
  if (byCurrent) return byCurrent;
  return (
    sheepList.find(
      (s) => Array.isArray(s.old_tags) && s.old_tags.some((ot) => ot && ot.tag === t && ot.source !== 'import'),
    ) || null
  );
}

// Create a new planned processing batch with the supplied name + date.
// Returns the inserted row. No sheep_detail yet — attachEntriesToBatch
// handles that in the next step.
export async function createProcessingBatch(sb, {name, plannedDate}) {
  const id = String(Date.now()) + Math.random().toString(36).slice(2, 6);
  const rec = {
    id,
    name: (name || '').trim(),
    planned_process_date: plannedDate || null,
    actual_process_date: null,
    processing_cost: null,
    notes: null,
    status: 'planned',
    sheep_detail: [],
    total_live_weight: null,
    total_hanging_weight: null,
  };
  const {error} = await sb.from('sheep_processing_batches').insert(rec);
  if (error) throw new Error('Could not create batch: ' + error.message);
  return rec;
}

// Attach a set of weigh-in entries to an existing processing batch:
//   * Append each entry's sheep to batch.sheep_detail with live_weight = entry.weight.
//   * Set sheep.flock='processed' + sheep.processing_batch_id=batch.id.
//   * Insert a sheep_transfers row per sheep (reason='processing_batch').
//   * Stamp weigh_ins.target_processing_batch_id + prior_herd_or_flock for audit.
//   * Batch status stays 'planned' — processing happens later at the processor.
//
// Returns {attached, skipped}. Skipped entries include the reason:
//   'no_sheep_for_tag' | 'already_in_batch' | 'tagless'
export async function attachEntriesToBatch(sb, {batch, entries, sheepList, teamMember}) {
  const attached = [];
  const skipped = [];
  const existingRows = Array.isArray(batch.sheep_detail) ? batch.sheep_detail.slice() : [];
  const existingIds = new Set(existingRows.map((r) => r.sheep_id));

  for (const e of entries) {
    if (!e.tag) {
      skipped.push({entry: e, reason: 'tagless'});
      continue;
    }
    const sheep = findSheepByAnyTag(sheepList, e.tag);
    if (!sheep) {
      skipped.push({entry: e, reason: 'no_sheep_for_tag'});
      continue;
    }
    if (existingIds.has(sheep.id)) {
      skipped.push({entry: e, reason: 'already_in_batch'});
      continue;
    }
    existingRows.push({
      sheep_id: sheep.id,
      tag: sheep.tag || e.tag || null,
      live_weight: parseFloat(e.weight) || null,
      hanging_weight: null,
    });
    existingIds.add(sheep.id);
    attached.push({entry: e, sheep});
  }

  const totals = recomputeBatchTotals(existingRows);
  const batchUpdate = await sb
    .from('sheep_processing_batches')
    .update({sheep_detail: existingRows, ...totals})
    .eq('id', batch.id);
  if (batchUpdate.error) throw new Error('Could not update batch: ' + batchUpdate.error.message);

  for (const {entry, sheep} of attached) {
    // Stamp the weigh_in's prior_herd_or_flock BEFORE moving the sheep to
    // 'processed', and ONLY when transitioning non-processed → processed
    // (mirrors the cattle Codex Edge Case #1 fix).
    const wiUpdate = {target_processing_batch_id: batch.id};
    if (sheep.flock && sheep.flock !== 'processed') wiUpdate.prior_herd_or_flock = sheep.flock;
    try {
      await sb.from('weigh_ins').update(wiUpdate).eq('id', entry.id);
    } catch (err) {
      /* columns only exist post-migrations 015 / 027 */
    }

    await sb.from('sheep').update({processing_batch_id: batch.id, flock: 'processed'}).eq('id', sheep.id);
    if (sheep.flock !== 'processed') {
      try {
        await sb.from('sheep_transfers').insert({
          id: String(Date.now()) + Math.random().toString(36).slice(2, 6),
          sheep_id: sheep.id,
          from_flock: sheep.flock,
          to_flock: 'processed',
          reason: 'processing_batch',
          reference_id: batch.id,
          team_member: teamMember || null,
        });
      } catch (err) {
        /* sheep_transfers only exists post-migration-029 */
      }
    }
  }

  return {attached, skipped};
}

// Detach a sheep from her processing batch. Same shape + fallback as
// detachCowFromBatch in cattleProcessingBatch.js. See that file for the
// full rationale comment block.
//
// Returns {ok, reason, sheep, priorFlock, batchId, weighInIdsCleared}.
// reason values:
//   'detached'        — happy path
//   'no_sheep'        — sheepId resolves to no row
//   'no_batch'        — batchId resolves to no row
//   'not_in_batch'    — sheep.processing_batch_id !== batchId
//   'no_prior_flock'  — neither weigh_ins.prior_herd_or_flock nor an audit row found
export async function detachSheepFromBatch(sb, sheepId, batchId, opts = {}) {
  if (!sheepId || !batchId) return {ok: false, reason: 'bad_args'};
  const teamMember = opts.teamMember || null;

  const sheepR = await sb.from('sheep').select('*').eq('id', sheepId).maybeSingle();
  if (sheepR.error || !sheepR.data) return {ok: false, reason: 'no_sheep', sheepId};
  const sheep = sheepR.data;
  if (sheep.processing_batch_id !== batchId) {
    return {ok: false, reason: 'not_in_batch', sheep, batchId};
  }

  const batchR = await sb.from('sheep_processing_batches').select('*').eq('id', batchId).maybeSingle();
  if (batchR.error || !batchR.data) return {ok: false, reason: 'no_batch', sheep, batchId};
  const batch = batchR.data;

  // Step 1a: read prior_herd_or_flock from any weigh_in that attached this
  // sheep to this batch. There may be more than one (multi-session); prefer
  // the most recent.
  const wisR = await sb
    .from('weigh_ins')
    .select('id, prior_herd_or_flock, entered_at, send_to_processor, target_processing_batch_id, tag')
    .eq('target_processing_batch_id', batchId)
    .eq('tag', sheep.tag || '')
    .order('entered_at', {ascending: false});
  const wis = wisR.data || [];
  let priorFlock = null;
  for (const w of wis) {
    if (w.prior_herd_or_flock) {
      priorFlock = w.prior_herd_or_flock;
      break;
    }
  }

  // Step 1b: fall back to most recent matching audit row.
  if (!priorFlock) {
    const trfR = await sb
      .from('sheep_transfers')
      .select('from_flock, transferred_at')
      .eq('sheep_id', sheep.id)
      .eq('reason', 'processing_batch')
      .eq('reference_id', batchId)
      .order('transferred_at', {ascending: false})
      .limit(1);
    if (trfR.data && trfR.data.length > 0 && trfR.data[0].from_flock) {
      priorFlock = trfR.data[0].from_flock;
    }
  }

  // Step 1c: nothing found — block with reason rather than guess.
  if (!priorFlock) {
    return {ok: false, reason: 'no_prior_flock', sheep, batchId};
  }

  // Step 2: remove this sheep from batch.sheep_detail, recompute totals.
  const newDetail = (Array.isArray(batch.sheep_detail) ? batch.sheep_detail : []).filter(
    (r) => r.sheep_id !== sheep.id,
  );
  const totals = recomputeBatchTotals(newDetail);
  const batchUpd = await sb
    .from('sheep_processing_batches')
    .update({sheep_detail: newDetail, ...totals})
    .eq('id', batchId);
  if (batchUpd.error) return {ok: false, reason: 'batch_update_failed', error: batchUpd.error.message, sheep, batchId};

  // Step 3: revert sheep.
  const sheepUpd = await sb.from('sheep').update({flock: priorFlock, processing_batch_id: null}).eq('id', sheep.id);
  if (sheepUpd.error) return {ok: false, reason: 'sheep_update_failed', error: sheepUpd.error.message, sheep, batchId};

  // Step 4: audit row.
  try {
    await sb.from('sheep_transfers').insert({
      id: String(Date.now()) + Math.random().toString(36).slice(2, 6),
      sheep_id: sheep.id,
      from_flock: 'processed',
      to_flock: priorFlock,
      reason: 'processing_batch_undo',
      reference_id: batchId,
      team_member: teamMember,
    });
  } catch (err) {
    /* audit log nice-to-have */
  }

  // Step 5: clear matching weigh_ins (BOTH target + flag — see cattle fix
  // in commit 448152e for the rationale).
  const cleared = [];
  for (const w of wis) {
    try {
      await sb
        .from('weigh_ins')
        .update({
          target_processing_batch_id: null,
          send_to_processor: false,
        })
        .eq('id', w.id);
      cleared.push(w.id);
    } catch (err) {
      /* tolerated */
    }
  }

  return {ok: true, reason: 'detached', sheep, priorFlock, batchId, weighInIdsCleared: cleared};
}
