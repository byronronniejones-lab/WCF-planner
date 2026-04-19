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
// ============================================================================

import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = 'https://pzfujbjtayhkdlxiblwe.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InB6ZnVqYmp0YXloa2RseGlibHdlIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzUyMzYxOTMsImV4cCI6MjA5MDgxMjE5M30.I_Pvb_Hwt9VpavB-Q-wFOmodRhSOqD1r6B9_gQfy5U8';

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
