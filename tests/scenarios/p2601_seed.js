// ============================================================================
// P-26-01 scenario seed — for tests/pig_batch_math.spec.js
// ============================================================================
// Builds the foundational state for the pig batch math regression spec:
//
//   Parent batch P-26-01:
//     - giltCount=10, boarCount=10, originalPigCount=20
//     - 1 mortality on sub A (pre-existing)
//     - feedAllocatedToTransfers derived from breeders (not stored)
//     - status=active, no trips yet (Send-to-Trip is the workflow under test)
//
//   Sub A (P-26-01A): 10 gilts. 1 mortality, 2 transferred to breeding.
//   Sub B (P-26-01B): 10 boars. No mortality, no transfers.
//
//   2 breeders (ppp-breeders-v1) with transferredFromBatch:
//     subBatchName=P-26-01A, feedAllocationLbs=500 each → 1000 lbs total credit on sub A.
//
//   pig_dailys: 4 rows × 2500 lbs each on sub A (10000 lbs) + 4 × 2500 on sub B (10000 lbs).
//     Total raw feed = 20000 lbs across batch.
//
//   Draft weigh_in_session for pigs with 5 weigh_ins on sub A at 250 lbs each.
//     None flagged sent_to_trip yet — the spec drives that via the UI.
//
// Math (pre-Send-to-Trip):
//   Parent: started=20, transferred=2, mortality=1 → finishers=17
//   Parent: rawFeed=20000, credits=1000 → adjustedFeed=19000
//   Parent: lbs/pig = 19000/17 ≈ 1117.6 → rounds to 1118
//
// Math (post-Send-to-Trip 5 pigs to sub A):
//   Sub A: started=10, transferred=2, mortality=1, tripPigs=5 → current=2
//   Sub B: started=10 → current=10
//   Parent: current = 12
//   Parent: lbs/pig still 1118 (finishers denominator unchanged by trips —
//     it tracks intent, not current)
//
// The spec asserts these specific numbers and the subAttributions schema.
// ============================================================================

import { assertTestDatabase } from '../setup/assertTestDatabase.js';

// Throw on any Supabase write/read error so the test fails at arrange time
// with a precise message instead of later at a confusing UI assertion.
function must(result, label) {
  if (result?.error) {
    throw new Error(`seedP2601 [${label}]: ${result.error.message}`);
  }
  return result;
}

const BATCH_ID = 'p2601-test';
const SUB_A_ID = 'p2601a-test';
const SUB_B_ID = 'p2601b-test';
const BATCH_NAME = 'P-26-01';
const SUB_A_NAME = 'P-26-01A';
const SUB_B_NAME = 'P-26-01B';

const FEED_PER_DAILY_LBS = 2500;
const DAILYS_PER_SUB = 4; // 4×2500 = 10000 per sub, 20000 total

const TRANSFER_CREDIT_PER_BREEDER_LBS = 500; // 2 breeders × 500 = 1000 credit on sub A
const FCR_USED = 3.5;

export async function seedP2601Scenario(supabaseAdmin) {
  assertTestDatabase(process.env.VITE_SUPABASE_URL || '');

  // Test admin email comes from .env.test.local (same value global.setup.js
  // logs in with). Refusing to default keeps the seed reproducible across
  // setups instead of silently green only on one developer's machine.
  const adminEmail = process.env.VITE_TEST_ADMIN_EMAIL;
  if (!adminEmail) {
    throw new Error(
      'seedP2601: VITE_TEST_ADMIN_EMAIL must be set in .env.test.local.'
    );
  }

  // --- 1. profiles row for the test admin (idempotent). The bootstrap
  // doesn't auto-create profile rows from auth.users, so the spec needs
  // this to advance past LoginScreen.
  const usersResult = await supabaseAdmin.auth.admin.listUsers();
  if (usersResult.error) {
    throw new Error(`seedP2601 [auth.listUsers]: ${usersResult.error.message}`);
  }
  const adminUser = usersResult.data?.users?.find((u) => u.email === adminEmail);
  if (!adminUser) {
    throw new Error(
      `seedP2601: test admin user "${adminEmail}" missing from auth.users. ` +
      'Re-create via Supabase Auth dashboard.'
    );
  }
  must(
    await supabaseAdmin.from('profiles').upsert(
      { id: adminUser.id, email: adminUser.email, role: 'admin' },
      { onConflict: 'id' }
    ),
    'profiles upsert'
  );

  // --- 2. ppp-feeders-v1: parent + 2 subs, 1 mortality on sub A, no trips.
  const feederGroup = {
    id: BATCH_ID,
    batchName: BATCH_NAME,
    cycleId: '',
    giltCount: 10,
    boarCount: 10,
    originalPigCount: 20,
    startDate: '2026-01-01',
    status: 'active',
    notes: '',
    perLbFeedCost: 0.30,
    legacyFeedLbs: 0,
    feedAllocatedToTransfers: 0,
    pigMortalities: [
      {
        id: 'mort-test-1',
        date: '2026-02-15',
        sub_batch_id: SUB_A_ID,
        sub_batch_name: SUB_A_NAME,
        count: 1,
        comment: 'seeded by p2601_seed.js',
        team_member: adminEmail,
        created_at: '2026-02-15T12:00:00Z',
      },
    ],
    processingTrips: [],
    subBatches: [
      {
        id: SUB_A_ID,
        name: SUB_A_NAME,
        status: 'active',
        giltCount: 10,
        boarCount: 0,
        originalPigCount: 10,
        notes: '',
        legacyFeedLbs: 0,
      },
      {
        id: SUB_B_ID,
        name: SUB_B_NAME,
        status: 'active',
        giltCount: 0,
        boarCount: 10,
        originalPigCount: 10,
        notes: '',
        legacyFeedLbs: 0,
      },
    ],
  };
  must(
    await supabaseAdmin.from('app_store').upsert({
      key: 'ppp-feeders-v1',
      data: [feederGroup],
    }),
    'app_store ppp-feeders-v1 upsert'
  );

  // --- 3. ppp-breeders-v1: 2 transferred-from-batch entries on sub A.
  // The pig batch math reads breeders[].transferredFromBatch to compute
  // per-sub transfer credits (not the parent-aggregate field).
  const breeders = [
    {
      id: 'br-test-1',
      tag: '1001',
      sex: 'Gilt',
      group: '1',
      status: 'Sow Group',
      breed: '',
      origin: BATCH_NAME,
      birthDate: '2025-08-01',
      lastWeight: 250,
      archived: false,
      weighins: [],
      transferredFromBatch: {
        batchName: BATCH_NAME,
        subBatchName: SUB_A_NAME,
        transferDate: '2026-03-01',
        feedAllocationLbs: TRANSFER_CREDIT_PER_BREEDER_LBS,
        fcrUsed: FCR_USED,
        sourceWeighInId: 'src-wi-test-1',
      },
    },
    {
      id: 'br-test-2',
      tag: '1002',
      sex: 'Gilt',
      group: '1',
      status: 'Sow Group',
      breed: '',
      origin: BATCH_NAME,
      birthDate: '2025-08-01',
      lastWeight: 255,
      archived: false,
      weighins: [],
      transferredFromBatch: {
        batchName: BATCH_NAME,
        subBatchName: SUB_A_NAME,
        transferDate: '2026-03-01',
        feedAllocationLbs: TRANSFER_CREDIT_PER_BREEDER_LBS,
        fcrUsed: FCR_USED,
        sourceWeighInId: 'src-wi-test-2',
      },
    },
  ];
  must(
    await supabaseAdmin.from('app_store').upsert({
      key: 'ppp-breeders-v1',
      data: breeders,
    }),
    'app_store ppp-breeders-v1 upsert'
  );

  // --- 4. pig_dailys: 4 rows on sub A + 4 rows on sub B, 2500 lbs each.
  // dailysForName matches case-insensitive on batch_label OR batch_id slug,
  // so setting batch_label to the sub name is sufficient.
  const dailyRows = [];
  const baseDate = new Date('2026-04-01');
  let dayCursor = 0;
  for (const subName of [SUB_A_NAME, SUB_B_NAME]) {
    for (let i = 0; i < DAILYS_PER_SUB; i++) {
      const d = new Date(baseDate);
      d.setUTCDate(d.getUTCDate() + dayCursor++);
      dailyRows.push({
        id: `pd-test-${subName}-${i}`,
        date: d.toISOString().slice(0, 10),
        team_member: adminEmail,
        batch_id: subName.toLowerCase().replace(/[^a-z0-9]+/g, '-'),
        batch_label: subName,
        pig_count: subName === SUB_A_NAME ? 9 : 10, // post-mortality count for A
        feed_lbs: FEED_PER_DAILY_LBS,
        group_moved: true,
        nipple_drinker_moved: true,
        nipple_drinker_working: true,
        troughs_moved: true,
        fence_walked: true,
        source: null,
      });
    }
  }
  must(
    await supabaseAdmin.from('pig_dailys').insert(dailyRows),
    'pig_dailys insert'
  );

  // --- 5. Draft weigh_in_session for pigs + 5 weigh_ins on sub A.
  // Entries are NOT flagged sent_to_trip — the spec drives that via UI.
  // Schema: weigh_in_sessions uses started_at (timestamptz, default now) +
  // a date column (date, not null). weigh_ins uses entered_at (timestamptz).
  const sessionId = 'wis-test-p2601';
  // session.batch_id MUST be the sub-batch slug as pigSlug computes it, not
  // a hand-typed dashed form. pigSlug('P-26-01A') is 'p-26-01a' (no dash
  // before 'a' — the regex /[^a-z0-9]+/g treats the uppercase letter as
  // alphanumeric, so it merges with the digits beside it).
  // LivestockWeighInsView.sendEntriesToTrip resolves which sub the entries
  // belong to by matching pigSlug(session.batch_id) against pigSlug(sb.name)
  // — without this, subAttributions stays empty.
  must(
    await supabaseAdmin.from('weigh_in_sessions').insert({
      id: sessionId,
      species: 'pig',
      date: '2026-04-26',
      team_member: adminEmail,
      herd: BATCH_NAME,
      batch_id: 'p-26-01a',
      status: 'draft',
      started_at: '2026-04-26T08:00:00Z',
    }),
    'weigh_in_sessions insert'
  );
  const weighIns = [];
  for (let i = 0; i < 5; i++) {
    weighIns.push({
      id: `wi-test-p2601-${i}`,
      session_id: sessionId,
      tag: String(2000 + i),
      weight: 250,
      note: null,
      new_tag_flag: false,
      entered_at: '2026-04-26T08:00:00Z',
    });
  }
  must(
    await supabaseAdmin.from('weigh_ins').insert(weighIns),
    'weigh_ins insert'
  );

  return {
    batchId: BATCH_ID,
    subAId: SUB_A_ID,
    subBId: SUB_B_ID,
    batchName: BATCH_NAME,
    subAName: SUB_A_NAME,
    subBName: SUB_B_NAME,
    sessionId,
    entryIds: weighIns.map((w) => w.id),
    expected: {
      preTripFinishers: 17,
      preTripAdjustedFeed: 19000,
      preTripLbsPerPig: 1118, // Math.round(19000 / 17)
      postTripCurrent: 12, // 20 − 5 − 2 − 1
      tripCount: 5,
    },
  };
}
