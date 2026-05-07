import {test, expect} from './fixtures.js';
import {createClient} from '@supabase/supabase-js';

// ============================================================================
// pig_session_metrics RPC — mig 049 contract verification
// ============================================================================
// Public-safe aggregate metrics RPC for pig weigh-in sessions. Anon caller
// gets aggregates only for status='draft' pig sessions; authenticated/admin
// gets aggregates for any pig session including history. Non-pig sessions
// always return available=false.
//
// Coverage:
//   1. Anon scope: draft pig session returns aggregates; complete pig
//      session, non-pig session, and missing session_id all return
//      available=false with null fields and no error.
//   2. Authenticated/service-role scope: complete pig sessions return
//      aggregates (admin history path).
//   3. Aggregate correctness: weighed_count, avg_weight, group_adg
//      (rank-matched, including unequal-count), age range (with farrowings
//      and theoretical fallback), feed_per_pig, feed_pig_count ledger math,
//      not-yet-born clamp.
//   4. Slug resolution: case-mismatched session.batch_id resolves to the
//      sub through pig_slug normalization.
//   5. Aggregates-only contract: response keys exactly match the documented
//      shape; no raw entry IDs, no full feeder group, no full breeding
//      cycle.
// ============================================================================

function newAnon() {
  return createClient(process.env.VITE_SUPABASE_URL, process.env.VITE_SUPABASE_ANON_KEY, {
    auth: {autoRefreshToken: false, persistSession: false},
  });
}

const PARENT_BATCH_NAME = 'P-26-09';
const SUB_NAME = 'P-26-09A';
const SUB_SLUG = 'p-26-09a';
const SUB_ID = 'sub-rpc-09a';
const PARENT_ID = 'group-rpc-09';
const CYCLE_ID = 'cy-rpc-09';
const FARROW_DATE = '2026-04-15';
const SESSION_DATE = '2026-08-04'; // exactly 111 days after farrow

async function seedFeedersWithCycle(supabaseAdmin, overrides = {}) {
  const sub = {
    id: SUB_ID,
    name: SUB_NAME,
    giltCount: 5,
    boarCount: 5,
    originalPigCount: 10,
    legacyFeedLbs: 50,
    notes: '',
    ...(overrides.subOverrides || {}),
  };
  const group = {
    id: PARENT_ID,
    batchName: PARENT_BATCH_NAME,
    cycleId: CYCLE_ID,
    giltCount: 5,
    boarCount: 5,
    originalPigCount: 10,
    startDate: '2026-06-01',
    legacyFeedLbs: 0,
    status: 'active',
    subBatches: [sub],
    processingTrips: overrides.processingTrips || [],
    pigMortalities: overrides.pigMortalities || [],
    ...(overrides.groupOverrides || {}),
  };
  await supabaseAdmin.from('app_store').upsert({key: 'ppp-feeders-v1', data: [group]}, {onConflict: 'key'});

  const cycle = {
    id: CYCLE_ID,
    group: '1',
    exposureStart: '2025-12-20', // farrowingStart = 2026-04-15, end = 2026-05-29
    sowCount: 5,
    customSuffix: '',
    ...(overrides.cycleOverrides || {}),
  };
  await supabaseAdmin.from('app_store').upsert({key: 'ppp-breeding-v1', data: [cycle]}, {onConflict: 'key'});

  const farrowings =
    overrides.farrowings === undefined ? [{id: 'f1', group: '1', farrowingDate: FARROW_DATE}] : overrides.farrowings;
  await supabaseAdmin.from('app_store').upsert({key: 'ppp-farrowing-v1', data: farrowings}, {onConflict: 'key'});

  await supabaseAdmin
    .from('app_store')
    .upsert({key: 'ppp-breeders-v1', data: overrides.breeders || []}, {onConflict: 'key'});

  return {group, sub, cycle, farrowings};
}

async function seedSession(
  supabaseAdmin,
  {sessionId, batchId, status = 'draft', species = 'pig', date = SESSION_DATE, weights = []},
) {
  await supabaseAdmin.from('weigh_in_sessions').insert({
    id: sessionId,
    species,
    date,
    batch_id: batchId,
    started_at: new Date().toISOString(),
    team_member: 'BMAN',
    status,
  });
  if (weights.length > 0) {
    const rows = weights.map((w, i) => ({
      id: `${sessionId}-e${i + 1}`,
      session_id: sessionId,
      weight: w,
    }));
    const {error} = await supabaseAdmin.from('weigh_ins').insert(rows);
    if (error) throw new Error(`weigh_ins insert: ${error.message}`);
  }
}

async function seedPigDailys(supabaseAdmin, rows) {
  if (!rows.length) return;
  await supabaseAdmin.from('pig_dailys').insert(
    rows.map((r, i) => ({
      id: `pdr-${i + 1}-${Date.now()}`,
      ...r,
    })),
  );
}

// ── Anon scope tests ────────────────────────────────────────────────────────

test('anon + draft pig session returns aggregates with available=true', async ({supabaseAdmin, resetDb}) => {
  await resetDb();
  await seedFeedersWithCycle(supabaseAdmin);
  await seedSession(supabaseAdmin, {
    sessionId: 's-draft-1',
    batchId: SUB_SLUG,
    weights: [200, 210, 220, 230, 240],
  });

  const anon = newAnon();
  const {data, error} = await anon.rpc('pig_session_metrics', {session_id_in: 's-draft-1'});
  expect(error).toBeNull();
  expect(data.available).toBe(true);
  expect(data.scope).toBe('anon');
  expect(data.species).toBe('pig');
  expect(data.weighed_count).toBe(5);
  expect(Number(data.avg_weight_lbs)).toBe(220);
});

test('anon + complete pig session returns available=false (R1: fail closed)', async ({supabaseAdmin, resetDb}) => {
  await resetDb();
  await seedFeedersWithCycle(supabaseAdmin);
  await seedSession(supabaseAdmin, {
    sessionId: 's-complete-1',
    batchId: SUB_SLUG,
    status: 'complete',
    weights: [240, 250, 260],
  });

  const anon = newAnon();
  const {data, error} = await anon.rpc('pig_session_metrics', {session_id_in: 's-complete-1'});
  expect(error).toBeNull();
  expect(data.available).toBe(false);
  expect(data.scope).toBe('anon');
  expect(data.species).toBe('pig');
  expect(data.weighed_count).toBe(0);
  expect(data.avg_weight_lbs).toBeNull();
});

test('anon + non-pig session returns available=false with species echoed', async ({supabaseAdmin, resetDb}) => {
  await resetDb();
  await seedSession(supabaseAdmin, {
    sessionId: 's-cattle-1',
    batchId: 'cattle-batch',
    species: 'cattle',
    status: 'draft',
    weights: [],
  });

  const anon = newAnon();
  const {data, error} = await anon.rpc('pig_session_metrics', {session_id_in: 's-cattle-1'});
  expect(error).toBeNull();
  expect(data.available).toBe(false);
  expect(data.species).toBe('cattle');
  expect(data.avg_weight_lbs).toBeNull();
});

test('anon + nonexistent session_id returns available=false (no error)', async ({resetDb}) => {
  await resetDb();
  const anon = newAnon();
  const {data, error} = await anon.rpc('pig_session_metrics', {session_id_in: 's-does-not-exist'});
  expect(error).toBeNull();
  expect(data.available).toBe(false);
  expect(data.species).toBeNull();
});

// ── Authenticated/service-role scope ────────────────────────────────────────

test('service_role caller sees complete pig session aggregates', async ({supabaseAdmin, resetDb}) => {
  await resetDb();
  await seedFeedersWithCycle(supabaseAdmin);
  await seedSession(supabaseAdmin, {
    sessionId: 's-complete-2',
    batchId: SUB_SLUG,
    status: 'complete',
    weights: [240, 260, 280],
  });

  const {data, error} = await supabaseAdmin.rpc('pig_session_metrics', {session_id_in: 's-complete-2'});
  expect(error).toBeNull();
  expect(data.available).toBe(true);
  expect(data.scope).toBe('authenticated');
  expect(data.weighed_count).toBe(3);
  expect(Number(data.avg_weight_lbs)).toBe(260);
});

// ── Rank-matched group ADG (R2 correction) ─────────────────────────────────

test('group_adg uses rank-matched pairing across two prior sessions', async ({supabaseAdmin, resetDb}) => {
  await resetDb();
  await seedFeedersWithCycle(supabaseAdmin);

  // Prior session at 2026-07-05, weights [200, 210, 220, 230, 240]; mean 220.
  await seedSession(supabaseAdmin, {
    sessionId: 's-prior-1',
    batchId: SUB_SLUG,
    status: 'complete',
    date: '2026-07-05',
    weights: [200, 210, 220, 230, 240],
  });
  // Current session at 2026-08-04 (30 days later), weights [230, 240, 250, 260, 270]; mean 250.
  await seedSession(supabaseAdmin, {
    sessionId: 's-current-1',
    batchId: SUB_SLUG,
    status: 'draft',
    date: '2026-08-04',
    weights: [230, 240, 250, 260, 270],
  });

  const anon = newAnon();
  const {data} = await anon.rpc('pig_session_metrics', {session_id_in: 's-current-1'});
  expect(data.available).toBe(true);
  expect(data.prior_session_id).toBe('s-prior-1');
  // Rank-matched pairs (ascending): (200,230)+30, (210,240)+30, (220,250)+30,
  // (230,260)+30, (240,270)+30. Avg gain 30 lb / 30 days = 1.0 lb/day.
  expect(Number(data.group_adg_lbs_per_day)).toBeCloseTo(1.0, 6);
});

test('group_adg with UNEQUAL counts pairs the lowest-N ranks (Codex R2 lock)', async ({supabaseAdmin, resetDb}) => {
  await resetDb();
  await seedFeedersWithCycle(supabaseAdmin);

  // Prior session has 3 pigs.
  await seedSession(supabaseAdmin, {
    sessionId: 's-prior-2',
    batchId: SUB_SLUG,
    status: 'complete',
    date: '2026-07-05',
    weights: [200, 220, 240],
  });
  // Current session has 5 pigs (more recovered/added). Rank-matched pairing
  // joins min(N_prior, N_current) = 3 pairs from the LOWEST ranks of each:
  //   prior ranks 1,2,3 = 200, 220, 240
  //   current ranks 1,2,3 = 210, 230, 250 (the bottom 3 of [210,230,250,260,270])
  // Pair gains: +10, +10, +10. Avg 10 / 30 days = 0.333... lb/day.
  // A naive avg(current) - avg(prior) shortcut would give 250-220=30 / 30 = 1.0,
  // proving the rank-matched algorithm is in use.
  await seedSession(supabaseAdmin, {
    sessionId: 's-current-2',
    batchId: SUB_SLUG,
    status: 'draft',
    date: '2026-08-04',
    weights: [210, 230, 250, 260, 270],
  });

  const anon = newAnon();
  const {data} = await anon.rpc('pig_session_metrics', {session_id_in: 's-current-2'});
  expect(data.available).toBe(true);
  expect(data.prior_session_id).toBe('s-prior-2');
  expect(Number(data.group_adg_lbs_per_day)).toBeCloseTo(10 / 30, 6);
  // Negative lock: not the avg-minus-avg shortcut.
  expect(Number(data.group_adg_lbs_per_day)).not.toBeCloseTo(1.0, 4);
});

test('group_adg is null when no prior pig session exists for this batch_id slug', async ({supabaseAdmin, resetDb}) => {
  await resetDb();
  await seedFeedersWithCycle(supabaseAdmin);
  await seedSession(supabaseAdmin, {
    sessionId: 's-only-1',
    batchId: SUB_SLUG,
    weights: [240, 250],
  });
  const anon = newAnon();
  const {data} = await anon.rpc('pig_session_metrics', {session_id_in: 's-only-1'});
  expect(data.available).toBe(true);
  expect(data.prior_session_id).toBeNull();
  expect(data.group_adg_lbs_per_day).toBeNull();
});

// ── Age range ──────────────────────────────────────────────────────────────

test('age range uses actual farrowing record (has_actual_farrowing=true)', async ({supabaseAdmin, resetDb}) => {
  await resetDb();
  await seedFeedersWithCycle(supabaseAdmin);
  await seedSession(supabaseAdmin, {sessionId: 's-age-1', batchId: SUB_SLUG, weights: [240]});

  const anon = newAnon();
  const {data} = await anon.rpc('pig_session_metrics', {session_id_in: 's-age-1'});
  // FARROW_DATE 2026-04-15, SESSION_DATE 2026-08-04 -> 111 days.
  expect(data.has_actual_farrowing).toBe(true);
  expect(data.age_min_days).toBe(111);
  expect(data.age_max_days).toBe(111);
});

test('age range falls back to theoretical window when no farrowing records', async ({supabaseAdmin, resetDb}) => {
  await resetDb();
  await seedFeedersWithCycle(supabaseAdmin, {farrowings: []});
  await seedSession(supabaseAdmin, {sessionId: 's-age-2', batchId: SUB_SLUG, weights: [240]});

  const anon = newAnon();
  const {data} = await anon.rpc('pig_session_metrics', {session_id_in: 's-age-2'});
  // exposureStart 2025-12-20, farrowing window 2026-04-15 -> 2026-05-29.
  // Session 2026-08-04 -> max age 111 (from start), min age 67 (from end).
  expect(data.has_actual_farrowing).toBe(false);
  expect(data.age_max_days).toBe(111);
  expect(data.age_min_days).toBe(67);
});

test('age range clamps to NULL/NULL when session is before any farrowing (R3)', async ({supabaseAdmin, resetDb}) => {
  await resetDb();
  await seedFeedersWithCycle(supabaseAdmin);
  // Session before the farrowing record (2026-04-15).
  await seedSession(supabaseAdmin, {
    sessionId: 's-age-3',
    batchId: SUB_SLUG,
    date: '2026-03-01',
    weights: [],
  });

  const anon = newAnon();
  const {data} = await anon.rpc('pig_session_metrics', {session_id_in: 's-age-3'});
  expect(data.age_min_days).toBeNull();
  expect(data.age_max_days).toBeNull();
});

// ── Feed/pig math ───────────────────────────────────────────────────────────

test('feed_per_pig sums sub.legacyFeedLbs + pig_dailys through session_date and divides by feed_pig_count', async ({
  supabaseAdmin,
  resetDb,
}) => {
  await resetDb();
  await seedFeedersWithCycle(supabaseAdmin);
  // sub.legacyFeedLbs = 50 (seed default). Add three pig_dailys rows (200 lb total).
  await seedPigDailys(supabaseAdmin, [
    {date: '2026-07-01', feed_lbs: 50, batch_label: SUB_NAME, batch_id: SUB_NAME},
    {date: '2026-07-15', feed_lbs: 80, batch_label: SUB_NAME, batch_id: SUB_NAME},
    {date: '2026-08-01', feed_lbs: 70, batch_label: SUB_NAME, batch_id: SUB_NAME},
    // Future row that should NOT be included (after session_date).
    {date: '2026-08-20', feed_lbs: 999, batch_label: SUB_NAME, batch_id: SUB_NAME},
  ]);
  await seedSession(supabaseAdmin, {sessionId: 's-feed-1', batchId: SUB_SLUG, weights: [240]});

  const anon = newAnon();
  const {data} = await anon.rpc('pig_session_metrics', {session_id_in: 's-feed-1'});
  // legacy 50 + dailys 50+80+70 = 250. Future row 999 excluded.
  expect(Number(data.feed_total_lbs)).toBe(250);
  // feed_pig_count = giltCount(5) + boarCount(5) - 0 mortality - 0 trips - 0 transfers = 10
  expect(data.feed_pig_count).toBe(10);
  expect(Number(data.feed_per_pig_lbs)).toBe(25);
  // weighed_count is unrelated to feed_pig_count.
  expect(data.weighed_count).toBe(1);
});

test('feed_pig_count subtracts mortality and processing-trip attributions', async ({supabaseAdmin, resetDb}) => {
  await resetDb();
  await seedFeedersWithCycle(supabaseAdmin, {
    pigMortalities: [{date: '2026-07-10', count: 2, sub_batch_name: SUB_NAME, comment: 'test'}],
    processingTrips: [
      {
        id: 'trip-1',
        date: '2026-07-20',
        pigCount: 3,
        liveWeights: '240 250 260',
        subAttributions: [{subId: SUB_ID, subBatchName: SUB_NAME, sex: 'Gilts', count: 3}],
      },
    ],
  });
  await seedSession(supabaseAdmin, {sessionId: 's-feed-2', batchId: SUB_SLUG, weights: []});

  const anon = newAnon();
  const {data} = await anon.rpc('pig_session_metrics', {session_id_in: 's-feed-2'});
  // 10 started - 2 mortality - 3 trip = 5 remaining.
  expect(data.feed_pig_count).toBe(5);
});

// ── Slug resolution ─────────────────────────────────────────────────────────

test('session.batch_id case mismatch resolves to sub via pig_slug normalization', async ({supabaseAdmin, resetDb}) => {
  await resetDb();
  await seedFeedersWithCycle(supabaseAdmin); // sub.name = 'P-26-09A'
  // Session uses uppercase form.
  await seedSession(supabaseAdmin, {sessionId: 's-slug-1', batchId: 'P-26-09A', weights: [240]});

  const anon = newAnon();
  const {data} = await anon.rpc('pig_session_metrics', {session_id_in: 's-slug-1'});
  expect(data.sub_batch_id).toBe(SUB_ID);
});

test('session.batch_id with no matching sub returns null sub_batch_id but session aggregates still work', async ({
  supabaseAdmin,
  resetDb,
}) => {
  await resetDb();
  await seedFeedersWithCycle(supabaseAdmin);
  await seedSession(supabaseAdmin, {sessionId: 's-nosub-1', batchId: 'p-99-99x', weights: [240, 260]});

  const anon = newAnon();
  const {data} = await anon.rpc('pig_session_metrics', {session_id_in: 's-nosub-1'});
  expect(data.available).toBe(true);
  expect(data.sub_batch_id).toBeNull();
  expect(data.weighed_count).toBe(2);
  expect(Number(data.avg_weight_lbs)).toBe(250);
  // Without a sub we can't attribute feed.
  expect(data.feed_total_lbs).toBeNull();
  expect(data.feed_per_pig_lbs).toBeNull();
});

// ── Aggregates-only contract ────────────────────────────────────────────────

test('response shape exposes aggregates only (no raw entries, feeder groups, or breeding cycles)', async ({
  supabaseAdmin,
  resetDb,
}) => {
  await resetDb();
  await seedFeedersWithCycle(supabaseAdmin);
  await seedSession(supabaseAdmin, {sessionId: 's-shape-1', batchId: SUB_SLUG, weights: [240, 250]});

  const anon = newAnon();
  const {data} = await anon.rpc('pig_session_metrics', {session_id_in: 's-shape-1'});
  const expectedKeys = [
    'session_id',
    'species',
    'batch_id',
    'sub_batch_id',
    'session_date',
    'weighed_count',
    'avg_weight_lbs',
    'prior_session_id',
    'prior_session_date',
    'group_adg_lbs_per_day',
    'age_min_days',
    'age_max_days',
    'has_actual_farrowing',
    'feed_total_lbs',
    'feed_pig_count',
    'feed_per_pig_lbs',
    'scope',
    'available',
  ].sort();
  expect(Object.keys(data).sort()).toEqual(expectedKeys);
  // Defensive: no raw store leakage.
  for (const key of Object.keys(data)) {
    const v = data[key];
    if (v && typeof v === 'object') {
      // No nested arrays/objects allowed in v1 (all aggregates are scalars
      // or null). If a future field becomes structured, this lock catches
      // unintentional leakage.
      throw new Error(`unexpected nested value at key "${key}": ${JSON.stringify(v)}`);
    }
  }
});
