// ============================================================================
// newsletterCronAuth — fail-closed cron-secret comparison for the
// newsletter-harvest Edge Function (CP-B).
// ----------------------------------------------------------------------------
// Pure ESM. NO imports. NO Node/Deno APIs. A byte-identical copy lives at
//   supabase/functions/_shared/newsletterCronAuth.js
// (the Edge Function imports the shared copy). Drift is locked by
// tests/static/newsletter_shared_parity.test.js; behavior is locked by
// src/lib/newsletterCronAuth.test.js.
//
// SECURITY: cronAuthOk FAILS CLOSED. If either expected secret is missing/empty
// (the project has not configured the NEWSLETTER_CRON_* Vault secrets yet), NO
// request can authenticate as cron — not even one that sends empty/blank
// headers. Without the guard, safeEqual('', '') returns true, so empty env
// secrets + empty request headers would be an auth bypass.
// ============================================================================

// Length-first then constant-ish byte compare. Hides obvious length-leak
// signal; not JS-layer constant-time but adequate for a 96-char hex secret.
export function safeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  if (a.length !== b.length) return false;
  let mismatch = 0;
  for (let i = 0; i < a.length; i += 1) mismatch |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return mismatch === 0;
}

// True only when BOTH expected secrets are configured (non-empty) AND the
// presented bearer + cron secret match them exactly.
export function cronAuthOk(bearer, cronSecret, expectedKey, expectedSecret) {
  if (!expectedKey || !expectedSecret) return false; // fail closed: secrets unconfigured
  return safeEqual(bearer, expectedKey) && safeEqual(cronSecret, expectedSecret);
}
