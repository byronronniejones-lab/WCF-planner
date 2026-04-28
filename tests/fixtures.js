import { test as base } from '@playwright/test';
import { getTestAdminClient, resetTestDatabase } from './setup/reset.js';
import { seedP2601Scenario } from './scenarios/p2601_seed.js';
import {
  seedCattleSendToProcessor,
  seedCattleMultiCowPreAttached,
  seedCattlePreAttachedForFallback,
} from './scenarios/cattle_processor_seed.js';

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
  supabaseAdmin: async ({}, use) => {
    await use(getTestAdminClient());
  },
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
});

export { expect } from '@playwright/test';
