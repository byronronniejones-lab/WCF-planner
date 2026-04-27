// ============================================================================
// Supabase client (single instance, shared across the app)
// ============================================================================
// Phase 2.0.0 of the Vite migration: extracted verbatim from main.jsx.
//
// CRITICAL CONFIG — DO NOT TOUCH (per MIGRATION_PLAN §10):
//   * detectSessionInUrl: false — prevents the public webform pages from
//     auto-signing-in users who land via shared links. SetPasswordScreen
//     compensates by manually parsing the recovery URL hash and calling
//     setSession() itself.
//   * storageKey: 'farm-planner-auth' — preserves existing user sessions
//     across the migration. Changing this would log everyone out.
//   * lock: pass-through — bypasses supabase-js's storage lock to avoid
//     hangs in some browsers / extension contexts.
//
// URL + anon key read from import.meta.env for `vite --mode test` overrides
// (Phase A2, Playwright). Hardcoded prod literals stay as fallback so the
// Netlify production build (no .env present → import.meta.env undefined →
// fallback fires) behaves identically. Verified: zero diff in built bundle
// when env vars are unset.
// ============================================================================

import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL =
  import.meta.env.VITE_SUPABASE_URL ||
  'https://pzfujbjtayhkdlxiblwe.supabase.co';
const SUPABASE_KEY =
  import.meta.env.VITE_SUPABASE_ANON_KEY ||
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InB6ZnVqYmp0YXloa2RseGlibHdlIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzUyMzYxOTMsImV4cCI6MjA5MDgxMjE5M30.I_Pvb_Hwt9VpavB-Q-wFOmodRhSOqD1r6B9_gQfy5U8';

export const sb = createClient(SUPABASE_URL, SUPABASE_KEY, {
  auth: {
    storage: window.localStorage,
    storageKey: 'farm-planner-auth',
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: false,
    lock: (name, acquireTimeout, fn) => fn()
  }
});

// Expose for browser console testing (e.g. sending test emails). Keeping
// the global side-effect in this module so anywhere that imports `sb`
// also gets the window assignment for free.
window.sb = sb;

// Test-harness sentinel: Playwright global.setup asserts this contains the
// test project ref before attempting login. Without this, a reused PROD-mode
// dev server would silently serve the app against production Supabase and
// the smoke spec would fail with "Invalid credentials" instead of a loud
// "wrong backend" error. Gated to DEV-only so the prod bundle never leaks.
if (import.meta.env.DEV) {
  window.__WCF_SUPABASE_URL = SUPABASE_URL;
}
