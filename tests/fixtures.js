import { test as base } from '@playwright/test';
import { getTestAdminClient, resetTestDatabase } from './setup/reset.js';

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
});

export { expect } from '@playwright/test';
