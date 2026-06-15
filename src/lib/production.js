import {shouldAutoProcessBroilerBatch} from './broiler.js';

export const PRODUCTION_PROGRAMS = [
  {key: 'cattle', label: 'Cattle', eventLabel: 'cattle', unit: 'cattle', quantityLabel: 'Processed'},
  {key: 'broiler', label: 'Broilers', eventLabel: 'birds', unit: 'birds', quantityLabel: 'Processed'},
  {key: 'pig', label: 'Pigs', eventLabel: 'pigs', unit: 'pigs', quantityLabel: 'Processed'},
  {key: 'sheep', label: 'Sheep/Lamb', eventLabel: 'lambs', unit: 'lambs', quantityLabel: 'Processed'},
  {key: 'egg', label: 'Eggs/doz', eventLabel: 'doz', unit: 'dozens', quantityLabel: 'Dozens'},
];

export const HOME_PRODUCTION_PROGRAMS = ['broiler', 'egg', 'pig', 'cattle', 'sheep'];
export const PAGE_PRODUCTION_PROGRAMS = ['cattle', 'broiler', 'pig', 'sheep', 'egg'];

export const PROGRAM_BY_KEY = Object.fromEntries(PRODUCTION_PROGRAMS.map((program) => [program.key, program]));

export function normalizeProductionProgram(value) {
  const raw = String(value || '')
    .trim()
    .toLowerCase();
  if (!raw) return null;
  if (['chicken', 'broiler', 'broilers', 'bird', 'birds'].includes(raw)) return 'broiler';
  if (['pig', 'pigs', 'pork', 'feeder pig', 'feeder pigs'].includes(raw)) return 'pig';
  if (['cattle', 'cow', 'beef', 'steer', 'steers'].includes(raw)) return 'cattle';
  if (['lamb', 'lambs', 'sheep', 'mutton'].includes(raw)) return 'sheep';
  if (['egg', 'eggs', 'dozen', 'dozens'].includes(raw)) return 'egg';
  return null;
}

export function normalizeBatchName(value) {
  return String(value || '')
    .trim()
    .replace(/\s+/g, ' ')
    .toUpperCase();
}

export function isoDate(value) {
  if (!value) return null;
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value.toISOString().slice(0, 10);
  const str = String(value).trim();
  const match = str.match(/^(\d{4})-(\d{2})-(\d{2})/);
  return match ? `${match[1]}-${match[2]}-${match[3]}` : null;
}

export function numeric(value) {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  const parsed = Number(String(value).replace(/,/g, '').trim());
  return Number.isFinite(parsed) ? parsed : null;
}

function jsonArrayLength(value) {
  if (Array.isArray(value)) return value.length;
  if (!value) return 0;
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value);
      return Array.isArray(parsed) ? parsed.length : 0;
    } catch {
      return 0;
    }
  }
  return 0;
}

function makeEvent({
  id,
  program,
  date,
  batchName,
  quantity,
  source,
  sourceTable,
  sourceId,
  sourceLabel,
  raw = null,
  zeroIsReal = false,
}) {
  const cleanProgram = normalizeProductionProgram(program);
  const cleanDate = isoDate(date);
  const cleanQuantity = numeric(quantity);
  if (!cleanProgram || !cleanDate || cleanQuantity === null) return null;
  if (cleanQuantity < 0) return null;
  if (!zeroIsReal && cleanQuantity === 0) return null;
  return {
    id: String(id || `${source}:${cleanProgram}:${cleanDate}:${normalizeBatchName(batchName)}:${cleanQuantity}`),
    program: cleanProgram,
    date: cleanDate,
    year: cleanDate.slice(0, 4),
    batchName: String(batchName || '').trim(),
    batchKey: normalizeBatchName(batchName),
    quantity: cleanQuantity,
    source,
    sourceTable,
    sourceId: sourceId == null ? null : String(sourceId),
    sourceLabel,
    raw,
  };
}

export function buildBroilerProductionEvents(batches = [], {today} = {}) {
  return (batches || [])
    .map((batch, index) => {
      const date = isoDate(batch.processingDate || batch.processing_date);
      const quantity = numeric(batch.totalToProcessor ?? batch.total_to_processor);
      const status = String(batch.status || '').toLowerCase();
      const asOf = isoDate(today) || new Date().toISOString().slice(0, 10);
      const processed =
        status === 'processed' || shouldAutoProcessBroilerBatch(batch, today) || (!status && date && date <= asOf);
      if (!processed) return null;
      return makeEvent({
        id: `planner:broiler:${batch.id || batch.name || index}`,
        program: 'broiler',
        date,
        batchName: batch.name || batch.batchName || batch.batch_name,
        quantity,
        source: 'planner',
        sourceTable: 'app_store.ppp-v4',
        sourceId: batch.id || batch.name || index,
        sourceLabel: 'Planner',
        raw: batch,
      });
    })
    .filter(Boolean);
}

export function buildPigProductionEvents(feederGroups = []) {
  return (feederGroups || [])
    .flatMap((group, groupIndex) =>
      (group.processingTrips || []).map((trip, tripIndex) =>
        makeEvent({
          id: `planner:pig:${group.id || group.batchName || groupIndex}:${trip.id || tripIndex}`,
          program: 'pig',
          date: trip.date,
          batchName: group.batchName || group.name || trip.batchName,
          quantity: trip.pigCount,
          source: 'planner',
          sourceTable: 'app_store.ppp-feeders-v1.processingTrips',
          sourceId: trip.id || `${group.id || groupIndex}:${tripIndex}`,
          sourceLabel: 'Planner',
          raw: {group, trip},
        }),
      ),
    )
    .filter(Boolean);
}

export function buildCattleProductionEvents(batches = []) {
  return (batches || [])
    .map((batch, index) =>
      makeEvent({
        id: `planner:cattle:${batch.id || index}`,
        program: 'cattle',
        date: batch.actual_process_date,
        batchName: batch.name || batch.batch_name,
        quantity: jsonArrayLength(batch.cows_detail),
        source: 'planner',
        sourceTable: 'cattle_processing_batches',
        sourceId: batch.id || index,
        sourceLabel: 'Planner',
        raw: batch,
      }),
    )
    .filter(Boolean);
}

export function buildSheepProductionEvents(batches = []) {
  return (batches || [])
    .map((batch, index) =>
      makeEvent({
        id: `planner:sheep:${batch.id || index}`,
        program: 'sheep',
        date: batch.actual_process_date,
        batchName: batch.name || batch.batch_name,
        quantity: jsonArrayLength(batch.sheep_detail),
        source: 'planner',
        sourceTable: 'sheep_processing_batches',
        sourceId: batch.id || index,
        sourceLabel: 'Planner',
        raw: batch,
      }),
    )
    .filter(Boolean);
}

export function eggCountForDaily(row) {
  return (
    (numeric(row.group1_count) || 0) +
    (numeric(row.group2_count) || 0) +
    (numeric(row.group3_count) || 0) +
    (numeric(row.group4_count) || 0)
  );
}

export function buildEggProductionEvents(eggDailys = []) {
  return (eggDailys || [])
    .map((daily, index) =>
      makeEvent({
        id: `planner:egg:${daily.id || daily.date || index}`,
        program: 'egg',
        date: daily.date,
        batchName: [daily.group1_name, daily.group2_name, daily.group3_name, daily.group4_name]
          .filter(Boolean)
          .join(', '),
        quantity: eggCountForDaily(daily),
        source: 'planner',
        sourceTable: 'egg_dailys',
        sourceId: daily.id || index,
        sourceLabel: 'Planner',
        raw: daily,
      }),
    )
    .filter(Boolean);
}

export function buildLegacyProductionEvents(rows = []) {
  return (rows || [])
    .map((row, index) => {
      const reviewStatus = row.review_status || 'approved';
      if (reviewStatus === 'rejected') return null;
      return makeEvent({
        id: `legacy:${row.id || row.source_key || index}`,
        program: row.program || row.raw_program,
        date: row.event_date || row.date,
        batchName: row.batch_name || row.batchName,
        quantity: row.quantity ?? row.count,
        source: 'legacy',
        sourceTable: 'production_legacy_events',
        sourceId: row.id || row.source_key || index,
        sourceLabel: 'Legacy spreadsheet',
        raw: row,
        zeroIsReal: true,
      });
    })
    .filter(Boolean);
}

function exactEventKey(event) {
  return [event.program, event.date, event.batchKey, event.quantity].join('|');
}

function looseEventKey(event) {
  return [event.program, event.date, event.quantity].join('|');
}

function indexEvents(events, keyFn) {
  const map = new Map();
  for (const event of events) {
    const key = keyFn(event);
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(event);
  }
  return map;
}

export function reconcileProductionEvents({plannerEvents = [], legacyEvents = []} = {}) {
  const combined = plannerEvents.map((event) => ({...event, reconciliationStatus: 'planner'}));
  const audit = [];
  const plannerByExact = indexEvents(plannerEvents, exactEventKey);
  const plannerByLoose = indexEvents(plannerEvents, looseEventKey);

  for (const legacyEvent of legacyEvents) {
    const exactMatches = legacyEvent.batchKey ? plannerByExact.get(exactEventKey(legacyEvent)) || [] : [];
    if (exactMatches.length === 1) {
      audit.push({
        legacyEvent,
        plannerEvent: exactMatches[0],
        status: 'matched',
        counted: false,
        reason: 'Same program, date, batch, and count already exist in Planner.',
      });
      continue;
    }

    const looseMatches = plannerByLoose.get(looseEventKey(legacyEvent)) || [];
    if (looseMatches.length === 1) {
      audit.push({
        legacyEvent,
        plannerEvent: looseMatches[0],
        status: 'matched_loose',
        counted: false,
        reason: 'Same program, date, and count already exist in Planner; legacy batch name is blank or different.',
      });
      continue;
    }
    if (looseMatches.length > 1) {
      audit.push({
        legacyEvent,
        plannerEvent: null,
        status: 'possible_duplicate',
        counted: false,
        reason:
          'Multiple Planner events share this program, date, and count. Legacy row is held out to avoid double counting.',
      });
      continue;
    }

    const identityMatches = plannerEvents.filter((event) => {
      if (event.program !== legacyEvent.program || event.date !== legacyEvent.date) return false;
      if (legacyEvent.batchKey) return event.batchKey === legacyEvent.batchKey;
      return event.quantity !== legacyEvent.quantity;
    });
    if (identityMatches.length > 0) {
      audit.push({
        legacyEvent,
        plannerEvent: identityMatches[0],
        status: 'conflict',
        counted: false,
        reason: 'Planner has the same event identity with a different count. Planner wins until reviewed.',
      });
      continue;
    }

    combined.push({...legacyEvent, reconciliationStatus: 'legacy_only'});
    audit.push({
      legacyEvent,
      plannerEvent: null,
      status: 'legacy_only',
      counted: true,
      reason: 'Only found in the legacy spreadsheet backfill.',
    });
  }

  return {
    events: combined.sort((a, b) => b.date.localeCompare(a.date) || a.program.localeCompare(b.program)),
    audit,
  };
}

export function buildPlannerProductionEvents({
  batches = [],
  feederGroups = [],
  cattleProcessingBatches = [],
  sheepProcessingBatches = [],
  eggDailys = [],
  today,
} = {}) {
  return [
    ...buildBroilerProductionEvents(batches, {today}),
    ...buildPigProductionEvents(feederGroups),
    ...buildCattleProductionEvents(cattleProcessingBatches),
    ...buildSheepProductionEvents(sheepProcessingBatches),
    ...buildEggProductionEvents(eggDailys),
  ];
}

export function buildProductionYearRows(events = [], programKey) {
  const totals = new Map();
  for (const event of events) {
    if (event.program !== programKey) continue;
    totals.set(event.year, (totals.get(event.year) || 0) + event.quantity);
  }
  const years = [...totals.keys()].sort();
  return years.map((year, index) => {
    const quantity = totals.get(year) || 0;
    const prevYear = years[index - 1];
    const previous = prevYear ? totals.get(prevYear) : null;
    return {
      year,
      quantity,
      yoy: previous === null || previous === undefined ? null : quantity - previous,
    };
  });
}

export function buildProductionModel(sources = {}) {
  const plannerEvents = buildPlannerProductionEvents(sources);
  const legacyEvents = buildLegacyProductionEvents(sources.legacyEvents || []);
  const reconciliation = reconcileProductionEvents({plannerEvents, legacyEvents});
  const years = [...new Set(reconciliation.events.map((event) => event.year))].sort();
  const programRows = Object.fromEntries(
    PAGE_PRODUCTION_PROGRAMS.map((programKey) => [
      programKey,
      buildProductionYearRows(reconciliation.events, programKey),
    ]),
  );
  return {
    plannerEvents,
    legacyEvents,
    events: reconciliation.events,
    audit: reconciliation.audit,
    years,
    programRows,
  };
}

export function quantityForDisplay(programKey, quantity) {
  if (quantity === null || quantity === undefined) return null;
  return programKey === 'egg' ? quantity / 12 : quantity;
}

export function formatProductionNumber(programKey, quantity) {
  if (quantity === null || quantity === undefined) return '--';
  const display = quantityForDisplay(programKey, quantity);
  if (programKey === 'egg') {
    const rounded = Math.round(display * 10) / 10;
    return rounded.toLocaleString(undefined, {
      minimumFractionDigits: rounded % 1 === 0 ? 0 : 1,
      maximumFractionDigits: 1,
    });
  }
  return Math.round(display).toLocaleString();
}

export function formatProductionDelta(programKey, delta) {
  if (delta === null || delta === undefined) return '--';
  const display = quantityForDisplay(programKey, delta);
  const rounded = programKey === 'egg' ? Math.round(display * 10) / 10 : Math.round(display);
  if (rounded === 0) return '0';
  const abs = Math.abs(rounded).toLocaleString(undefined, {
    minimumFractionDigits: programKey === 'egg' && Math.abs(rounded) % 1 !== 0 ? 1 : 0,
    maximumFractionDigits: programKey === 'egg' ? 1 : 0,
  });
  return `${rounded > 0 ? '+' : '-'}${abs}`;
}

export function formatEventQuantity(event) {
  if (!event) return '--';
  const program = PROGRAM_BY_KEY[event.program];
  const value = formatProductionNumber(event.program, event.quantity);
  return `${value} ${program ? program.eventLabel : ''}`.trim();
}

export function totalsForYear(events = [], year) {
  const yearStr = String(year);
  const totals = new Map();
  for (const event of events) {
    if (event.year !== yearStr) continue;
    totals.set(event.program, (totals.get(event.program) || 0) + event.quantity);
  }
  return totals;
}

export function homeProductionStats(model, year = new Date().getFullYear()) {
  const totals = totalsForYear(model && model.events ? model.events : [], year);
  return HOME_PRODUCTION_PROGRAMS.map((programKey) => ({
    programKey,
    label: PROGRAM_BY_KEY[programKey].label.replace('/doz', ''),
    value: totals.has(programKey) ? formatProductionNumber(programKey, totals.get(programKey)) : '--',
  }));
}
