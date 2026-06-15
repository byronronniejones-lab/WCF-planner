const PAGE_SIZE = 1000;

function missingRelation(error) {
  return /does not exist|schema cache|could not find/i.test((error && error.message) || '');
}

async function fetchPaged(buildQuery) {
  let rows = [];
  let from = 0;
  while (true) {
    const {data, error} = await buildQuery().range(from, from + PAGE_SIZE - 1);
    if (error) throw error;
    if (!data || data.length === 0) break;
    rows = rows.concat(data);
    if (data.length < PAGE_SIZE) break;
    from += PAGE_SIZE;
  }
  return rows;
}

async function fetchAppStoreProductionRows(sb) {
  const {data, error} = await sb.from('app_store').select('key,data').in('key', ['ppp-v4', 'ppp-feeders-v1']);
  if (error) throw error;
  const store = Object.fromEntries((data || []).map((row) => [row.key, row.data]));
  return {
    batches: Array.isArray(store['ppp-v4']) ? store['ppp-v4'] : [],
    feederGroups: Array.isArray(store['ppp-feeders-v1']) ? store['ppp-feeders-v1'] : [],
  };
}

async function fetchLegacyEvents(sb, {fromDate = null, toDate = null} = {}) {
  const {data, error} = await sb.rpc('list_production_legacy_events', {
    p_from_date: fromDate,
    p_to_date: toDate,
  });
  if (error) {
    if (missingRelation(error)) return [];
    throw error;
  }
  return data || [];
}

async function fetchProcessingBatches(sb, table, {fromDate = null, toDate = null} = {}) {
  return fetchPaged(() => {
    let query = sb.from(table).select('*').not('actual_process_date', 'is', null).order('actual_process_date', {
      ascending: false,
    });
    if (fromDate) query = query.gte('actual_process_date', fromDate);
    if (toDate) query = query.lte('actual_process_date', toDate);
    return query;
  }).catch((error) => {
    if (missingRelation(error)) return [];
    throw error;
  });
}

async function fetchEggDailys(sb, {fromDate = null, toDate = null} = {}) {
  return fetchPaged(() => {
    let query = sb
      .from('egg_dailys')
      .select(
        'id,date,group1_name,group1_count,group2_name,group2_count,group3_name,group3_count,group4_name,group4_count',
      )
      .is('deleted_at', null)
      .order('date', {ascending: false});
    if (fromDate) query = query.gte('date', fromDate);
    if (toDate) query = query.lte('date', toDate);
    return query;
  }).catch((error) => {
    if (missingRelation(error)) return [];
    throw error;
  });
}

export async function loadProductionSources(sb, {fromDate = null, toDate = null} = {}) {
  const [appStore, legacyEvents, cattleProcessingBatches, sheepProcessingBatches, eggDailys] = await Promise.all([
    fetchAppStoreProductionRows(sb),
    fetchLegacyEvents(sb, {fromDate, toDate}),
    fetchProcessingBatches(sb, 'cattle_processing_batches', {fromDate, toDate}),
    fetchProcessingBatches(sb, 'sheep_processing_batches', {fromDate, toDate}),
    fetchEggDailys(sb, {fromDate, toDate}),
  ]);

  return {
    ...appStore,
    legacyEvents,
    cattleProcessingBatches,
    sheepProcessingBatches,
    eggDailys,
  };
}
