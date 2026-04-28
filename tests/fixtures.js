import { test as base } from '@playwright/test';
import { getTestAdminClient, resetTestDatabase } from './setup/reset.js';
import { seedP2601Scenario } from './scenarios/p2601_seed.js';
import {
  seedCattleSendToProcessor,
  seedCattleMultiCowPreAttached,
  seedCattlePreAttachedForFallback,
} from './scenarios/cattle_processor_seed.js';
import {
  seedSheepSendToProcessor,
  seedSheepBatchPreAttached,
  seedSheepPreAttachedForFallback,
} from './scenarios/sheep_processor_seed.js';
import { seedBroilerTimeline } from './scenarios/broiler_timeline_seed.js';
import { seedPigFCRScenario } from './scenarios/pig_fcr_seed.js';
import { seedFuelBillScenario } from './scenarios/fuel_bill_seed.js';
import { seedFuelReconcile } from './scenarios/fuel_reconcile_seed.js';
import { seedHomeDashboardEquipment } from './scenarios/home_dashboard_equipment_seed.js';

// ============================================================================
// Per-spec fixtures: authenticated page (via global.setup storageState),
// test-side Supabase admin client (service_role), and a reset hook.
//
// Usage:
//   import { test, expect } from '../fixtures.js';
//
//   test.beforeAll(async ({ resetDb, supabaseAdmin }) => {
//     await resetDb();
//     await supabaseAdmin.from('app_store').insert({ key: 'k', data: {} });
//   });
//
//   test('something', async ({ page }) => { ... });
// ============================================================================

export const test = base.extend({
  // eslint-disable-next-line no-empty-pattern -- canonical Playwright fixture pattern
  supabaseAdmin: async ({}, use) => {
    await use(getTestAdminClient());
  },
  // eslint-disable-next-line no-empty-pattern -- canonical Playwright fixture pattern
  resetDb: async ({}, use) => {
    await use(async () => {
      await resetTestDatabase();
    });
  },
  // p2601Scenario — resets the test DB then seeds the P-26-01 pig batch
  // scenario fresh for the spec. beforeEach-style isolation per Codex's
  // A4 review (pick beforeEach reset + reseed; accumulating state would
  // make accounting regressions harder to interpret).
  p2601Scenario: async ({ supabaseAdmin }, use) => {
    await resetTestDatabase();
    const ids = await seedP2601Scenario(supabaseAdmin);
    await use(ids);
  },
  // cattleSendToProcessorScenario — happy-path A5 setup (3 finishers + empty
  // planned batch + draft session + 3 flagged weigh-ins). Used by the tests
  // that exercise the full UI attach + the "no manual bypass" assertion.
  cattleSendToProcessorScenario: async ({ supabaseAdmin }, use) => {
    await resetTestDatabase();
    const ids = await seedCattleSendToProcessor(supabaseAdmin);
    await use(ids);
  },
  // cattleMultiCowPreAttachedScenario — 3 cows pre-attached with valid
  // prior_herd_or_flock + audit rows. Used by the multi-cow detach loop
  // tests (session-delete + batch-delete) so the iteration is actually
  // exercised — single-cow seeds would let those loops "pass" with N=1.
  cattleMultiCowPreAttachedScenario: async ({ supabaseAdmin }, use) => {
    await resetTestDatabase();
    const ids = await seedCattleMultiCowPreAttached(supabaseAdmin);
    await use(ids);
  },
  // cattlePreAttachedScenario — pre-attached state for the §7 detach fallback
  // hierarchy tests. Returns a factory because the same spec exercises three
  // modes (with_audit_row | null_from_herd | no_audit_row) and Playwright
  // fixtures don't natively parameterise; the factory lets each test pick
  // its mode after the reset.
  cattlePreAttachedScenario: async ({ supabaseAdmin }, use) => {
    await use(async (mode) => {
      await resetTestDatabase();
      return seedCattlePreAttachedForFallback(supabaseAdmin, { mode });
    });
  },
  // sheepSendToProcessorScenario — happy-path A6 setup. Factory accepts an
  // optional `flock` so Test 9 (looser-gate regression) can reuse the same
  // shape with flock='rams' instead of the default 'feeders'.
  sheepSendToProcessorScenario: async ({ supabaseAdmin }, use) => {
    await use(async ({ flock = 'feeders' } = {}) => {
      await resetTestDatabase();
      return seedSheepSendToProcessor(supabaseAdmin, { flock });
    });
  },
  // sheepBatchPreAttachedScenario — 3 sheep pre-attached with valid
  // prior_herd_or_flock + audit rows. Used by the multi-row detach loop
  // tests (session-delete + batch-delete).
  sheepBatchPreAttachedScenario: async ({ supabaseAdmin }, use) => {
    await resetTestDatabase();
    const ids = await seedSheepBatchPreAttached(supabaseAdmin);
    await use(ids);
  },
  // sheepPreAttachedScenario — fallback-hierarchy state. Factory pattern
  // mirrors cattlePreAttachedScenario; modes: with_audit_row |
  // null_from_flock | no_audit_row.
  sheepPreAttachedScenario: async ({ supabaseAdmin }, use) => {
    await use(async (mode) => {
      await resetTestDatabase();
      return seedSheepPreAttachedForFallback(supabaseAdmin, { mode });
    });
  },
  // broilerTimelineScenario — A7 range / auto-scroll / today-line setup.
  // Factory accepts { withActiveLayer, withRetirement } so Tests 1 and 2
  // share the seed but pick different layer compositions.
  broilerTimelineScenario: async ({ supabaseAdmin }, use) => {
    await use(async (opts = {}) => {
      await resetTestDatabase();
      return seedBroilerTimeline(supabaseAdmin, opts);
    });
  },
  // pigFCRScenario — A9 fcrCached clear-on-null contract setup. Factory
  // accepts { withCredits, withCachedValue } so the three modes (populate,
  // clear-on-null, delete-trip-clear) reuse one seed shape.
  pigFCRScenario: async ({ supabaseAdmin }, use) => {
    await use(async (opts = {}) => {
      await resetTestDatabase();
      return seedPigFCRScenario(supabaseAdmin, opts);
    });
  },
  // fuelBillScenario — A8a PDF parser end-to-end setup. Reset clears
  // fuel_bills + fuel_bill_lines + storage objects in the fuel-bills
  // bucket; seed ensures the admin profile exists. The PDF file itself
  // is checked in at tests/fixtures/ODBIN-0195942_2.PDF.
  fuelBillScenario: async ({ supabaseAdmin }, use) => {
    await resetTestDatabase();
    const ids = await seedFuelBillScenario(supabaseAdmin);
    await use(ids);
  },
  // fuelReconcileScenario — A8b banding + cell-exclusion setup. Factory
  // accepts { band, fuelType?, includeCellRow? } so the four tests reuse
  // one seed shape; each picks its own band / cell-row mode.
  fuelReconcileScenario: async ({ supabaseAdmin }, use) => {
    await use(async (opts = {}) => {
      await resetTestDatabase();
      return seedFuelReconcile(supabaseAdmin, opts);
    });
  },
  // homeDashboardEquipmentScenario — A1 follow-up (HomeDashboard equipment
  // attention regression coverage). Factory accepts { kind: 'overdue' |
  // 'upcoming' | 'missed_fueling' | 'fillup_streak' | 'warranty' } and
  // seeds exactly one piece of equipment positioned to trigger that kind.
  homeDashboardEquipmentScenario: async ({ supabaseAdmin }, use) => {
    await use(async (opts = {}) => {
      await resetTestDatabase();
      return seedHomeDashboardEquipment(supabaseAdmin, opts);
    });
  },
});

export { expect } from '@playwright/test';
