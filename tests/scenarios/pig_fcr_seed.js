// ============================================================================
// Pig FCR cache scenario seed — for tests/pig_fcr_cache.spec.js
// ============================================================================
// A9 closes the §7 contract A4 explicitly deferred:
//
//   `parent.fcrCached` clear-on-null contract. Both persistTrip and
//   deleteTrip MUST `delete next.fcrCached` (not leave the previous value,
//   not assign null) when computePigBatchFCR returns null.
//
// Single parameterized seed:
//
//   seedPigFCRScenario(supabaseAdmin, { withCredits = false,
//                                        withCachedValue = false } = {})
//
//   Parent batch P-FCR-01: legacyFeedLbs=600, no sub-batches.
//     (no subs → computePigBatchFCR walks the parent's dailys; using
//     legacyFeedLbs avoids needing to seed pig_dailys).
//
//   1 existing processing trip:
//     liveWeights '100, 100, 100' → totalLive = 300
//     subAttributions = [{ subId, subBatchName, sex, count }] (non-empty
//       so Test 1 actually exercises spread-then-merge preservation per
//       Codex review — empty arrays trivially "preserve" themselves).
//
//   Computed FCR (no credits):  600 / 300 = 2.000.
//   Computed FCR (with credits): 600 - 600 credits = 0 → null → CLEAR.
//
//   withCredits=true:    2 breeders × 300 lb credit = 600 → adjFeed=0 → null.
//   withCachedValue=true: pre-seed parent.fcrCached = 9.99 (deliberately
//                        distinct from any organic value so a regression
//                        that assigns null instead of deleting fails with
//                        a precise diff).
// ============================================================================

import {assertTestDatabase} from '../setup/assertTestDatabase.js';

function must(result, label) {
  if (result?.error) {
    throw new Error(`pigFCRSeed [${label}]: ${result.error.message}`);
  }
  return result;
}

const BATCH_ID = 'fg-test-fcr-01';
const BATCH_NAME = 'P-FCR-01';
const TRIP_ID = 'trip-test-fcr-01';

// Non-empty subAttributions metadata seeded onto the existing trip so
// Test 1 can prove the spread-then-merge path at PigBatchesView.jsx:396-397
// preserves arbitrary jsonb keys through edit-close. The subId references
// no real sub-batch (this scenario has none), but A9 doesn't render
// sub-batch UI — the metadata round-trips through Supabase as opaque jsonb.
const SEEDED_SUB_ATTRIBUTIONS = [{subId: 'sub-fcr-a', subBatchName: 'P-FCR-01A', sex: 'Gilts', count: 3}];
const STALE_FCR_VALUE = 9.99;
const EXPECTED_FCR = 2.0;

async function ensureAdminProfile(supabaseAdmin) {
  const adminEmail = process.env.VITE_TEST_ADMIN_EMAIL;
  if (!adminEmail) {
    throw new Error('pigFCRSeed: VITE_TEST_ADMIN_EMAIL must be set in .env.test.local.');
  }
  const usersResult = await supabaseAdmin.auth.admin.listUsers();
  if (usersResult.error) {
    throw new Error(`pigFCRSeed [auth.listUsers]: ${usersResult.error.message}`);
  }
  const adminUser = usersResult.data?.users?.find((u) => u.email === adminEmail);
  if (!adminUser) {
    throw new Error(`pigFCRSeed: test admin user "${adminEmail}" missing.`);
  }
  must(
    await supabaseAdmin
      .from('profiles')
      .upsert({id: adminUser.id, email: adminUser.email, role: 'admin'}, {onConflict: 'id'}),
    'profiles upsert',
  );
}

export async function seedPigFCRScenario(supabaseAdmin, {withCredits = false, withCachedValue = false} = {}) {
  assertTestDatabase(process.env.VITE_SUPABASE_URL || '');
  await ensureAdminProfile(supabaseAdmin);

  const trip = {
    id: TRIP_ID,
    date: '2026-04-01',
    pigCount: 3,
    hangingWeight: 240,
    liveWeights: '100, 100, 100',
    notes: '',
    subAttributions: SEEDED_SUB_ATTRIBUTIONS,
  };

  const feederGroup = {
    id: BATCH_ID,
    batchName: BATCH_NAME,
    cycleId: '',
    giltCount: 3,
    boarCount: 0,
    originalPigCount: 3,
    startDate: '2026-01-01',
    status: 'active',
    notes: '',
    perLbFeedCost: 0.3,
    legacyFeedLbs: 600,
    feedAllocatedToTransfers: 0,
    pigMortalities: [],
    processingTrips: [trip],
    subBatches: [],
  };

  if (withCachedValue) {
    feederGroup.fcrCached = STALE_FCR_VALUE;
  }

  must(
    await supabaseAdmin.from('app_store').upsert({
      key: 'ppp-feeders-v1',
      data: [feederGroup],
    }),
    'app_store ppp-feeders-v1 upsert',
  );

  // Breeders carry the transfer-credit signal. computePigBatchFCR reads
  // breeders[].transferredFromBatch.feedAllocationLbs and sums the entries
  // matching the parent batch name. 2 breeders × 300 lb = 600 credit → ties
  // exactly with rawFeed → adjFeed = 0 → helper returns null → cache cleared.
  const breeders = withCredits
    ? [
        {
          id: 'br-test-fcr-1',
          tag: '8001',
          sex: 'Gilt',
          group: '1',
          status: 'Sow Group',
          breed: '',
          origin: BATCH_NAME,
          birthDate: '2025-08-01',
          lastWeight: 240,
          archived: false,
          weighins: [],
          transferredFromBatch: {
            batchName: BATCH_NAME,
            subBatchName: 'P-FCR-01A',
            transferDate: '2026-03-01',
            feedAllocationLbs: 300,
            fcrUsed: 3.5,
            sourceWeighInId: 'src-wi-test-fcr-1',
          },
        },
        {
          id: 'br-test-fcr-2',
          tag: '8002',
          sex: 'Gilt',
          group: '1',
          status: 'Sow Group',
          breed: '',
          origin: BATCH_NAME,
          birthDate: '2025-08-01',
          lastWeight: 245,
          archived: false,
          weighins: [],
          transferredFromBatch: {
            batchName: BATCH_NAME,
            subBatchName: 'P-FCR-01A',
            transferDate: '2026-03-01',
            feedAllocationLbs: 300,
            fcrUsed: 3.5,
            sourceWeighInId: 'src-wi-test-fcr-2',
          },
        },
      ]
    : [];
  must(
    await supabaseAdmin.from('app_store').upsert({
      key: 'ppp-breeders-v1',
      data: breeders,
    }),
    'app_store ppp-breeders-v1 upsert',
  );

  return {
    batchId: BATCH_ID,
    batchName: BATCH_NAME,
    tripId: TRIP_ID,
    seededSubAttributions: SEEDED_SUB_ATTRIBUTIONS,
    expected: {
      fcrPopulated: EXPECTED_FCR,
      // Test 2 + 3 expect key-DELETED, not null. The expected post-state
      // is the absence of the key; no value to compare.
      fcrCleared: undefined,
    },
    options: {withCredits, withCachedValue},
  };
}
