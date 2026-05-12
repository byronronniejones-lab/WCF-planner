// scripts/audit_pig_p26_01.cjs
//
// Read-only audit of P-26-01 batch accounting.
// Pulls: ppp-feeders-v1 (group + subs), ppp-breeders-v1 (transfers from P-26-01),
// pig_dailys (sub-name match), weigh_in_sessions + weigh_ins (trip-source counts).
//
// Usage: node scripts/audit_pig_p26_01.cjs
// No writes. Pure read.

const fs = require('fs');
const path = require('path');

function loadEnv() {
  const p = path.join(__dirname, '.env');
  if (!fs.existsSync(p)) return;
  for (const line of fs.readFileSync(p, 'utf8').split(/\r?\n/)) {
    const m = /^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*?)\s*$/.exec(line);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
}
loadEnv();

const TARGET_BATCH = 'P-26-01';

function slugify(s) {
  return String(s || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}
function nameMatches(d, names) {
  const lbl = String(d.batch_label || '')
    .trim()
    .toLowerCase();
  const bid = String(d.batch_id || '')
    .trim()
    .toLowerCase();
  const lblSlug = slugify(lbl);
  const bidSlug = slugify(bid);
  for (const n of names) {
    const ln = n.trim().toLowerCase();
    const sn = slugify(ln);
    if (lbl === ln || bid === ln || lblSlug === sn || bidSlug === sn) return true;
  }
  return false;
}
function n(v) {
  const x = parseFloat(v);
  return Number.isFinite(x) ? x : 0;
}

async function main() {
  const {createClient} = require('@supabase/supabase-js');
  const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: {persistSession: false},
  });

  // 1) Feeder group + subs
  const f = await sb.from('app_store').select('data').eq('key', 'ppp-feeders-v1').maybeSingle();
  if (f.error) {
    console.error('feeders read error:', f.error);
    process.exit(1);
  }
  const groups = f.data && Array.isArray(f.data.data) ? f.data.data : [];
  const g = groups.find((x) => x.batchName === TARGET_BATCH);
  if (!g) {
    console.error('Batch', TARGET_BATCH, 'not found.');
    process.exit(2);
  }
  const subs = g.subBatches || [];

  // 2) Breeders with transferredFromBatch.batchName == TARGET_BATCH
  const b = await sb.from('app_store').select('data').eq('key', 'ppp-breeders-v1').maybeSingle();
  const breeders = b.data && Array.isArray(b.data.data) ? b.data.data : [];
  const transfers = breeders.filter(
    (br) => br && br.transferredFromBatch && br.transferredFromBatch.batchName === TARGET_BATCH,
  );

  // 3) pig_dailys (paginated)
  const pdAll = [];
  for (let from = 0; ; from += 1000) {
    const {data, error} = await sb
      .from('pig_dailys')
      .select('*')
      .range(from, from + 999);
    if (error) {
      console.error('pig_dailys read error:', error);
      process.exit(1);
    }
    if (!data || data.length === 0) break;
    pdAll.push(...data);
    if (data.length < 1000) break;
  }
  const subNamesAll = subs.map((s) => s.name);
  const parentDailys = pdAll.filter((d) => nameMatches(d, [TARGET_BATCH]));
  const subDailys = subs.map((s) => ({sub: s, rows: pdAll.filter((d) => nameMatches(d, [s.name]))}));

  // 4) Trip source counts via weigh_ins.sent_to_trip_id + weigh_in_sessions.batch_id
  const tripIds = (g.processingTrips || []).map((t) => t.id);
  const wiAll = [];
  if (tripIds.length > 0) {
    // pull in batches of 200 to keep .in() friendly
    for (let i = 0; i < tripIds.length; i += 200) {
      const slice = tripIds.slice(i, i + 200);
      const {data, error} = await sb
        .from('weigh_ins')
        .select(
          'id,session_id,sent_to_trip_id,sent_to_group_id,weight,note,transferred_to_breeding,transfer_breeder_id,feed_allocation_lbs',
        )
        .in('sent_to_trip_id', slice);
      if (error) {
        console.error('weigh_ins read error:', error);
        process.exit(1);
      }
      if (data) wiAll.push(...data);
    }
  }
  const sessIds = Array.from(new Set(wiAll.map((w) => w.session_id))).filter(Boolean);
  const sessMap = {};
  if (sessIds.length > 0) {
    const {data: sessions, error} = await sb
      .from('weigh_in_sessions')
      .select('id,batch_id,date,species')
      .in('id', sessIds);
    if (error) {
      console.error('weigh_in_sessions read error:', error);
      process.exit(1);
    }
    (sessions || []).forEach((s) => {
      sessMap[s.id] = s;
    });
  }

  // ---- BUILD AUDIT TABLE ----
  function transfersForSub(subName) {
    return transfers.filter((t) => t.transferredFromBatch && t.transferredFromBatch.subBatchName === subName);
  }
  function tripsBySubFor(trip) {
    // Returns {subName: count} for one trip, derived from weigh_ins -> session.batch_id
    const myWi = wiAll.filter((w) => w.sent_to_trip_id === trip.id);
    const counts = {};
    let liveTotal = 0;
    for (const w of myWi) {
      const sess = sessMap[w.session_id];
      const bid = sess && sess.batch_id;
      const key = bid || '(unknown)';
      counts[key] = (counts[key] || 0) + 1;
      liveTotal += n(w.weight);
    }
    return {counts, liveSum: liveTotal, weighinCount: myWi.length};
  }

  // Aggregate per-sub trip metrics
  const subTripAgg = {}; // {subName: {pigCount, liveSum}}
  let parentTripPigCount = 0;
  let parentTripLiveSum = 0;
  for (const tr of g.processingTrips || []) {
    const tripPigCount = parseInt(tr.pigCount) || 0;
    const tripLive = (tr.liveWeights || '')
      .split(/[\s,]+/)
      .map(parseFloat)
      .filter((v) => !isNaN(v) && v > 0)
      .reduce((a, b) => a + b, 0);
    parentTripPigCount += tripPigCount;
    parentTripLiveSum += tripLive;
    const {counts, liveSum, weighinCount} = tripsBySubFor(tr);
    // If we have weigh_in attribution, prefer those exact counts; otherwise the trip is unattributed to subs.
    if (Object.keys(counts).length > 0 && weighinCount > 0) {
      // Distribute trip live by weigh_in weight
      for (const [bid, cnt] of Object.entries(counts)) {
        if (!subTripAgg[bid]) subTripAgg[bid] = {pigCount: 0, liveSum: 0, weighinCount: 0};
        subTripAgg[bid].pigCount += cnt;
        subTripAgg[bid].weighinCount += cnt;
      }
      // Live distribution: prorate trip live weight across subs by weigh_in count proportion (weigh_ins
      // carry their own weight, but for the purposes of accounting trip-level live we use trip.liveWeights
      // as the source of truth and prorate by weigh_in count).
      for (const [bid, cnt] of Object.entries(counts)) {
        if (weighinCount > 0) subTripAgg[bid].liveSum += tripLive * (cnt / weighinCount);
      }
    } else {
      // Unattributed — log but don't try to assign
      if (!subTripAgg.__unattributed__) subTripAgg.__unattributed__ = {pigCount: 0, liveSum: 0, weighinCount: 0};
      subTripAgg.__unattributed__.pigCount += tripPigCount;
      subTripAgg.__unattributed__.liveSum += tripLive;
    }
  }

  // Resolve subTripAgg keys (which are batch_id strings) back to sub names
  // The session.batch_id appears to use slug-form like "p-26-01-a-gilts-" — match against sub names.
  const subBySlug = {};
  for (const s of subs) subBySlug[slugify(s.name)] = s.name;
  // Also try matching on raw batch_id strings stored on sessions
  function resolveBidToSubName(bid) {
    if (!bid) return null;
    if (subBySlug[bid]) return subBySlug[bid];
    if (subBySlug[slugify(bid)]) return subBySlug[slugify(bid)];
    // Some sessions might use the parent batch slug
    if (slugify(bid) === slugify(TARGET_BATCH)) return TARGET_BATCH;
    return bid; // unresolved — leave as raw
  }
  const subTripAggByName = {
    __unattributed__: subTripAgg.__unattributed__ || {pigCount: 0, liveSum: 0, weighinCount: 0},
  };
  for (const [bid, agg] of Object.entries(subTripAgg)) {
    if (bid === '__unattributed__') continue;
    const resolved = resolveBidToSubName(bid);
    const key = resolved || bid;
    if (!subTripAggByName[key]) subTripAggByName[key] = {pigCount: 0, liveSum: 0, weighinCount: 0};
    subTripAggByName[key].pigCount += agg.pigCount;
    subTripAggByName[key].liveSum += agg.liveSum;
    subTripAggByName[key].weighinCount += agg.weighinCount;
  }

  // ---- PRINT ----
  console.log('='.repeat(78));
  console.log('AUDIT: ' + TARGET_BATCH);
  console.log('='.repeat(78));
  console.log('');
  console.log('Parent group:');
  console.log('  batchName            :', g.batchName);
  console.log('  status               :', g.status);
  console.log('  giltCount (stored)   :', g.giltCount);
  console.log('  boarCount (stored)   :', g.boarCount);
  console.log('  originalPigCount     :', g.originalPigCount);
  console.log('  legacyFeedLbs        :', g.legacyFeedLbs || 0);
  console.log('  feedAllocatedToTransfers:', g.feedAllocatedToTransfers || 0);
  console.log('  pigMortalities count :', (g.pigMortalities || []).length);
  console.log('  processingTrips      :', (g.processingTrips || []).length);
  console.log('');

  console.log('Processing trips:');
  for (const tr of g.processingTrips || []) {
    const tripLive = (tr.liveWeights || '')
      .split(/[\s,]+/)
      .map(parseFloat)
      .filter((v) => !isNaN(v) && v > 0)
      .reduce((a, b) => a + b, 0);
    const sources = tripsBySubFor(tr);
    console.log(
      '  [' + tr.date + ']',
      'pigCount=' + (tr.pigCount || 0),
      'live=' + Math.round(tripLive),
      'hang=' + (tr.hangingWeight || 0),
      'sources:',
      JSON.stringify(sources.counts),
    );
  }
  console.log('  Trip totals: pigs=' + parentTripPigCount, 'live=' + Math.round(parentTripLiveSum));
  console.log('');

  console.log('Breeding transfers (count + feed allocation, by source sub):');
  const trBySub = {};
  for (const t of transfers) {
    const sub = (t.transferredFromBatch && t.transferredFromBatch.subBatchName) || '(none)';
    if (!trBySub[sub]) trBySub[sub] = {count: 0, feedSum: 0, items: []};
    trBySub[sub].count++;
    trBySub[sub].feedSum += n(t.transferredFromBatch.feedAllocationLbs);
    trBySub[sub].items.push({
      tag: t.tag,
      sex: t.sex,
      feedAllocLb: t.transferredFromBatch.feedAllocationLbs,
      fcrUsed: t.transferredFromBatch.fcrUsed,
      weighin: t.transferredFromBatch.sourceWeighInId,
      date: t.transferredFromBatch.transferDate,
    });
  }
  for (const [sub, agg] of Object.entries(trBySub)) {
    console.log('  ' + sub + ': ' + agg.count + ' transferred, ' + Math.round(agg.feedSum) + ' lbs feed credit');
    for (const it of agg.items)
      console.log(
        '    -',
        it.tag || '(no tag)',
        it.sex || '?',
        '@',
        it.weighin || '?',
        '·',
        Math.round(n(it.feedAllocLb)) + 'lb / FCR ' + (it.fcrUsed || '?'),
      );
  }
  if (Object.keys(trBySub).length === 0) console.log('  (none)');
  console.log('');

  console.log('Mortality entries (by sub):');
  const mortBySub = {};
  for (const m of g.pigMortalities || []) {
    const k = m.sub_batch_name || '(parent)';
    if (!mortBySub[k]) mortBySub[k] = 0;
    mortBySub[k] += parseInt(m.count) || 0;
  }
  for (const [k, v] of Object.entries(mortBySub)) console.log('  ' + k + ': ' + v);
  if (Object.keys(mortBySub).length === 0) console.log('  (none)');
  console.log('');

  console.log('Sub-batches:');
  console.log('-'.repeat(78));
  let sumStartedFromSubs = 0;
  let sumSubFeedRaw = 0;
  let sumSubTransferFeed = 0;
  for (const s of subs) {
    const sd = subDailys.find((x) => x.sub.id === s.id) || {rows: []};
    const subFeedRaw = sd.rows.reduce((a, d) => a + n(d.feed_lbs), 0);
    const latestDaily =
      [...sd.rows].sort(
        (a, b) =>
          String(b.date).localeCompare(String(a.date)) ||
          String(b.submitted_at || '').localeCompare(String(a.submitted_at || '')),
      )[0] || null;
    const tr = trBySub[s.name] || {count: 0, feedSum: 0};
    const trip = subTripAggByName[s.name] || {pigCount: 0, liveSum: 0};
    const mort = mortBySub[s.name] || 0;
    // Stored counts
    const stGilt = parseInt(s.giltCount) || 0;
    const stBoar = parseInt(s.boarCount) || 0;
    const stOrig = parseInt(s.originalPigCount) || 0;
    sumStartedFromSubs += stOrig;
    sumSubFeedRaw += subFeedRaw;
    sumSubTransferFeed += tr.feedSum;
    // Ledger remaining (using current stored "started" — which has been mutated by transfer)
    const ledgerRemainingFromStored = stOrig - trip.pigCount - tr.count - mort;
    // Ledger remaining if originalPigCount was un-mutated (add transfers back into the start)
    const reconstructedStart = stOrig + tr.count;
    const ledgerRemainingReconstructed = reconstructedStart - trip.pigCount - tr.count - mort;
    // Lbs/pig under each plausible denominator
    const subFeedAdj = subFeedRaw - tr.feedSum;
    const lbsPerPigStored = stOrig > 0 ? subFeedRaw / stOrig : null;
    const lbsPerPigStoredAdj = stOrig > 0 ? subFeedAdj / stOrig : null;
    const lbsPerPigReconstructed = reconstructedStart > 0 ? subFeedAdj / reconstructedStart : null;
    const lbsPerPigProcessedOnly = trip.pigCount > 0 ? subFeedAdj / trip.pigCount : null;
    console.log('SUB:', s.name);
    console.log('  status                    :', s.status);
    console.log('  stored giltCount          :', stGilt);
    console.log('  stored boarCount          :', stBoar);
    console.log('  stored originalPigCount   :', stOrig, ' (mutated by Transfer-to-Breeding)');
    console.log('  reconstructed start       :', reconstructedStart, ' (= stored + transfers)');
    console.log(
      '  latest daily pig_count    :',
      latestDaily ? `${latestDaily.pig_count} on ${latestDaily.date}` : '(no dailys)',
    );
    console.log('  daily reports             :', sd.rows.length);
    console.log('  trip pigs (attributed)    :', trip.pigCount);
    console.log('  trip live wt (prorated)   :', Math.round(trip.liveSum));
    console.log('  breeding transfers (count):', tr.count);
    console.log('  breeding transfer feed lb :', Math.round(tr.feedSum));
    console.log('  mortality                 :', mort);
    console.log('  raw feed (dailys+legacy)  :', Math.round(subFeedRaw + n(s.legacyFeedLbs)));
    console.log('  feed credited to transfers:', Math.round(tr.feedSum));
    console.log('  adjusted feed (raw − cred):', Math.round(subFeedRaw + n(s.legacyFeedLbs) - tr.feedSum));
    console.log('  ledger remaining (stored) :', ledgerRemainingFromStored);
    console.log('  ledger remaining (recon)  :', ledgerRemainingReconstructed);
    console.log('  lbs/pig — stored orig     :', lbsPerPigStored?.toFixed(0) || '—');
    console.log('  lbs/pig — adj/stored orig :', lbsPerPigStoredAdj?.toFixed(0) || '—');
    console.log('  lbs/pig — adj/reconstruc  :', lbsPerPigReconstructed?.toFixed(0) || '—');
    console.log('  lbs/pig — adj/trip-only   :', lbsPerPigProcessedOnly?.toFixed(0) || '—');
    console.log('');
  }

  console.log('Reconciliation totals:');
  console.log('  sum(sub stored origPigCount)   :', sumStartedFromSubs);
  console.log('  sum(sub raw feed)              :', Math.round(sumSubFeedRaw));
  console.log('  sum(sub transfer feed credit)  :', Math.round(sumSubTransferFeed));
  console.log('  parent legacy feed             :', Math.round(n(g.legacyFeedLbs)));
  console.log('  parent feedAllocatedToTransfers:', Math.round(n(g.feedAllocatedToTransfers)));
  console.log('  parent rawFeed (sum subs+legacy):', Math.round(sumSubFeedRaw + n(g.legacyFeedLbs)));
  console.log(
    '  parent totalFeed (raw − allocOut):',
    Math.round(sumSubFeedRaw + n(g.legacyFeedLbs) - n(g.feedAllocatedToTransfers)),
  );
  console.log(
    '  diff (alloc-on-parent vs sum-of-sub-credits):',
    Math.round(n(g.feedAllocatedToTransfers) - sumSubTransferFeed),
  );
  console.log('');
  console.log('Trip totals (parent processingTrips):');
  console.log('  parent total pigs processed   :', parentTripPigCount);
  console.log('  parent total live weight      :', Math.round(parentTripLiveSum));
  if (subTripAggByName.__unattributed__ && subTripAggByName.__unattributed__.pigCount > 0) {
    console.log(
      '  ⚠ unattributed trip pigs      :',
      subTripAggByName.__unattributed__.pigCount,
      '(no weigh_in source — pre-Send-to-Trip)',
    );
  }

  console.log('');
  console.log('='.repeat(78));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
