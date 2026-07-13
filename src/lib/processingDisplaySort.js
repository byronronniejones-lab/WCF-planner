// ============================================================================
// src/lib/processingDisplaySort.js — default Processing section ordering
// ----------------------------------------------------------------------------
// Pure display sort for the rows inside one Processing program section
// (planner-integration lane). Rows use the server-derived `effective_status`
// ('planned' | 'in_process' | 'complete'), but completed rows are NOT pushed
// into a history bucket:
//   1. In Process — oldest processing_date first (longest-running work on top)
//   2. Planned + Complete — processing_date first, so completed batches stay
//      in their natural schedule position instead of being relocated below all
//      future planned rows.
// Undated rows sink to the end of their bucket. An unknown/missing
// effective_status is treated as 'planned', mirroring the server's conservative
// default. Input is never mutated; ties keep their incoming relative order
// (Array.prototype.sort is stable).
// ============================================================================

const BUCKET_RANK = {in_process: 0, planned: 1, complete: 1};

function bucketRank(record) {
  const rank = BUCKET_RANK[record && record.effective_status];
  return rank === undefined ? BUCKET_RANK.planned : rank;
}

// ISO 'YYYY-MM-DD' prefix (dates and timestamps both), or null when unusable.
function isoPrefix(value) {
  const m = String(value || '').match(/^\d{4}-\d{2}-\d{2}/);
  return m ? String(value) : null;
}

// Ascending ISO compare with nulls LAST.
function compareAscNullsLast(a, b) {
  if (a === b) return 0;
  if (a === null) return 1;
  if (b === null) return -1;
  return a < b ? -1 : a > b ? 1 : 0;
}

export function sortProcessingRecordsForDisplay(records) {
  const list = Array.isArray(records) ? records.slice() : [];
  return list.sort((a, b) => {
    const ra = bucketRank(a);
    const rb = bucketRank(b);
    if (ra !== rb) return ra - rb;
    // In Process, Planned, and Complete all sort by processing_date inside
    // their display bucket. Complete intentionally ignores completed_at so a
    // row stays where the processing schedule put it.
    return compareAscNullsLast(isoPrefix(a && a.processing_date), isoPrefix(b && b.processing_date));
  });
}
