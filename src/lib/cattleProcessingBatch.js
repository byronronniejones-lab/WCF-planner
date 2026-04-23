// Shared helpers for attaching cattle weigh-in entries to a processing batch.
// Called from both the webform (WeighInsWebform) and the admin tab
// (CattleWeighInsView) so the two surfaces land identical DB state when a
// cattle finisher session is completed with send-to-processor entries.

export function recomputeBatchTotals(rows) {
  const live = rows.reduce((s, r) => s + (parseFloat(r.live_weight) || 0), 0);
  const hang = rows.reduce((s, r) => s + (parseFloat(r.hanging_weight) || 0), 0);
  return {
    total_live_weight: live > 0 ? Math.round(live * 10) / 10 : null,
    total_hanging_weight: hang > 0 ? Math.round(hang * 10) / 10 : null,
  };
}

// Walk cattle.tag + old_tags the same way the webform and admin tab do when
// resolving prior-tag history. Excludes source='import' (selling-farm tags
// can collide with WCF's own numbering).
function findCowByAnyTag(cattleList, tag) {
  if (!tag) return null;
  const t = String(tag).trim();
  const byCurrent = cattleList.find(c => c.tag === t);
  if (byCurrent) return byCurrent;
  return cattleList.find(c => Array.isArray(c.old_tags) && c.old_tags.some(ot => ot && ot.tag === t && ot.source !== 'import')) || null;
}

// Create a new planned processing batch with the supplied name + date.
// Returns the inserted row. No cows_detail yet -- attachEntriesToBatch
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
    cows_detail: [],
    total_live_weight: null,
    total_hanging_weight: null,
  };
  const {error} = await sb.from('cattle_processing_batches').insert(rec);
  if (error) throw new Error('Could not create batch: ' + error.message);
  return rec;
}

// Attach a set of weigh-in entries to an existing processing batch:
//   * Append each entry's cow to batch.cows_detail with live_weight = entry.weight.
//   * Set cattle.herd='processed' + cattle.processing_batch_id=batch.id.
//   * Insert a cattle_transfers row per cow (reason='processing_batch').
//   * Stamp weigh_ins.target_processing_batch_id for audit.
//   * Batch status stays 'planned' -- processing happens later at the processor.
//
// Returns {attached, skipped}. Skipped entries include the reason:
//   'no_cow_for_tag' | 'already_in_batch' | 'tagless'
export async function attachEntriesToBatch(sb, {batch, entries, cattleList, teamMember}) {
  const attached = [];
  const skipped = [];
  const existingRows = Array.isArray(batch.cows_detail) ? batch.cows_detail.slice() : [];
  const existingCowIds = new Set(existingRows.map(r => r.cattle_id));

  for (const e of entries) {
    if (!e.tag) { skipped.push({entry: e, reason: 'tagless'}); continue; }
    const cow = findCowByAnyTag(cattleList, e.tag);
    if (!cow) { skipped.push({entry: e, reason: 'no_cow_for_tag'}); continue; }
    if (existingCowIds.has(cow.id)) { skipped.push({entry: e, reason: 'already_in_batch'}); continue; }
    existingRows.push({
      cattle_id: cow.id,
      tag: cow.tag || e.tag || null,
      live_weight: parseFloat(e.weight) || null,
      hanging_weight: null,
    });
    existingCowIds.add(cow.id);
    attached.push({entry: e, cow});
  }

  const totals = recomputeBatchTotals(existingRows);
  const batchUpdate = await sb.from('cattle_processing_batches')
    .update({cows_detail: existingRows, ...totals})
    .eq('id', batch.id);
  if (batchUpdate.error) throw new Error('Could not update batch: ' + batchUpdate.error.message);

  for (const {entry, cow} of attached) {
    await sb.from('cattle').update({processing_batch_id: batch.id, herd: 'processed'}).eq('id', cow.id);
    if (cow.herd !== 'processed') {
      try {
        await sb.from('cattle_transfers').insert({
          id: String(Date.now()) + Math.random().toString(36).slice(2, 6),
          cattle_id: cow.id,
          from_herd: cow.herd,
          to_herd: 'processed',
          reason: 'processing_batch',
          reference_id: batch.id,
          team_member: teamMember || null,
        });
      } catch (err) { /* cattle_transfers may not exist on legacy schemas */ }
    }
    try {
      await sb.from('weigh_ins').update({target_processing_batch_id: batch.id}).eq('id', entry.id);
    } catch (err) { /* column only exists post-migration-015 */ }
  }

  return {attached, skipped};
}
