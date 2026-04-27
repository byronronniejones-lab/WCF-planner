import { test as setup, expect } from '@playwright/test';
import fs from 'fs';
import path from 'path';

// ============================================================================
// One-time auth setup — runs as the 'setup' project before any spec.
// Signs in as the test admin user, persists localStorage + cookies into
// tests/.auth/admin.json. The 'chromium' project uses storageState: that
// file so authenticated specs skip the login UI.
//
// Selectors target LoginScreen.jsx — labels lack `for=` attributes so we use
// placeholder + role queries.
// ============================================================================

const authDir = path.resolve('tests/.auth');
const authFile = path.join(authDir, 'admin.json');

setup('authenticate as admin', async ({ page }) => {
  if (!fs.existsSync(authDir)) fs.mkdirSync(authDir, { recursive: true });

  const email = process.env.VITE_TEST_ADMIN_EMAIL;
  const password = process.env.VITE_TEST_ADMIN_PASSWORD;
  if (!email || !password) {
    throw new Error(
      'global.setup: VITE_TEST_ADMIN_EMAIL + VITE_TEST_ADMIN_PASSWORD must ' +
      'be set in .env.test.local (gitignored). The Phase A1 setup ' +
      'instructions list both values.'
    );
  }

  await page.goto('/');

  // Backend sentinel (Codex-mandated): assert the loaded app is actually
  // pointed at the test Supabase project before attempting login. If a
  // reused PROD dev server is serving us, this fires loudly instead of
  // letting login fail with "Invalid credentials" downstream.
  const testUrl = process.env.VITE_SUPABASE_URL || '';
  const expectedRef = testUrl.match(/https?:\/\/([^.]+)\./)?.[1];
  if (!expectedRef) {
    throw new Error(
      'global.setup: VITE_SUPABASE_URL missing or unparseable. Check .env.test.'
    );
  }
  const loadedUrl = await page.evaluate(() => window.__WCF_SUPABASE_URL);
  if (!loadedUrl || !loadedUrl.includes(expectedRef)) {
    throw new Error(
      `global.setup: dev server is serving the wrong backend. ` +
      `Expected URL containing "${expectedRef}" but got "${loadedUrl}". ` +
      `Likely cause: a PROD-mode \`npm run dev\` is running on port 5173. ` +
      `Kill it and re-run.`
    );
  }

  await page
    .getByPlaceholder('your@email.com')
    .first()
    .fill(email);
  await page.getByPlaceholder('••••••••').fill(password);
  await page.getByRole('button', { name: /^sign in$/i }).click();

  // After successful sign-in, LoginScreen unmounts and the dashboard renders.
  // The login branding "Broiler, Layer & Pig Planner" is unique to LoginScreen,
  // so its disappearance is the cleanest readiness signal.
  await expect(
    page.locator('text=Broiler, Layer & Pig Planner')
  ).toHaveCount(0, { timeout: 15_000 });

  await page.context().storageState({ path: authFile });
});
