// Farm-born pig batch creation from farrowing records.
//
// Normal farm-born pig batches are created from the FIRST farrowing record of a
// breeding cycle — not from the manual /pig/batches Add Batch flow. Creation is
// create-only and idempotent by cycleId: a cycle gets exactly one feeder group,
// and later farrowing records (or edits) never overwrite an existing batch's
// counts, subBatches, trips, or transfers. Deleting/editing-away a farrowing
// record never deletes the batch.
//
// Generated batches do NOT fake a sex split: giltCount/boarCount stay 0 and a
// neutral started count (sum of alive piglets across the cycle's farrowing
// records at creation) is stored in originalPigCount with farmBorn:true. The
// display + ledger read that neutral count via pig.js batchStartedCount().

import {buildCycleSeqMap, cycleLabel, cycleRecords} from './pig.js';

// Deterministic id for a cycle's farm-born batch. Detection is by cycleId
// first (so manually-linked batches are reused); this id is the create target.
export function farrowBatchId(cycle) {
  return 'farrowing-cycle-' + (cycle && cycle.id);
}

// Match a single farrowing record to its breeding cycle using the SAME
// group + farrowing-window(+14d) rule as pig.js cycleRecords. Returns the
// cycle or null (unlinked / out-of-window records create nothing).
export function matchCycleForFarrowing(record, breedingCycles) {
  if (!record || record.group == null || !record.farrowingDate) return null;
  for (const c of breedingCycles || []) {
    if (!c || c.group !== record.group) continue;
    if (cycleRecords(c, [record]).length === 1) return c;
  }
  return null;
}

// Per-record alive count: prefer the stamped `alive`, else derive from
// totalBorn − deaths (historical/imported records predate the `alive` stamp),
// else 0. Never negative.
export function recordAliveCount(r) {
  if (!r) return 0;
  if (r.alive != null && r.alive !== '' && !Number.isNaN(Number(r.alive))) {
    return Math.max(0, parseInt(r.alive) || 0);
  }
  return Math.max(0, (parseInt(r.totalBorn) || 0) - (parseInt(r.deaths) || 0));
}

function aliveForCycle(cycle, farrowingRecs) {
  return cycleRecords(cycle, farrowingRecs || []).reduce((s, r) => s + recordAliveCount(r), 0);
}

function earliestFarrowDate(cycle, farrowingRecs) {
  const dates = cycleRecords(cycle, farrowingRecs || [])
    .map((r) => r.farrowingDate)
    .filter(Boolean)
    .sort();
  return dates[0] || (cycle && cycle.exposureStart) || '';
}

// Generated batch name: P-<YY-NN> from buildCycleSeqMap when the cycle has a
// sequence suffix; otherwise fall back to the cycle label.
export function farrowBatchName(cycle, breedingCycles) {
  const seqMap = buildCycleSeqMap(breedingCycles || []);
  const suffix = seqMap[cycle && cycle.id];
  if (suffix) return 'P-' + suffix;
  return cycleLabel(cycle, seqMap) || 'Farm-born ' + (cycle && cycle.id);
}

// Ensure exactly one feeder group exists for `cycle`. Create-only + idempotent:
//   - reuse an existing batch linked by cycleId (manual OR generated) untouched;
//   - else reuse a batch already at the deterministic id;
//   - else append a new neutral-count farm-born batch.
// Returns {next, created, batch}. Never mutates or removes existing batches.
export function ensureFarrowBatchForCycle(feederGroups, cycle, farrowingRecs, breedingCycles) {
  const groups = Array.isArray(feederGroups) ? feederGroups : [];
  if (!cycle || !cycle.id) return {next: groups, created: false, batch: null};

  const linked =
    groups.find((g) => g && g.cycleId === cycle.id) || groups.find((g) => g && g.id === farrowBatchId(cycle));
  if (linked) return {next: groups, created: false, batch: linked};

  const batch = {
    id: farrowBatchId(cycle),
    batchName: farrowBatchName(cycle, breedingCycles),
    cycleId: cycle.id,
    farmBorn: true,
    giltCount: 0,
    boarCount: 0,
    originalPigCount: aliveForCycle(cycle, farrowingRecs),
    startDate: earliestFarrowDate(cycle, farrowingRecs),
    status: 'active',
    perLbFeedCost: 0,
    legacyFeedLbs: 0,
    notes: '',
    subBatches: [],
    processingTrips: [],
    pigMortalities: [],
  };
  return {next: [...groups, batch], created: true, batch};
}
