// ============================================================================
// Hard guard against running destructive tests against the production
// Supabase project.
// ============================================================================
// Codex review (2026-04-28) flagged this as load-bearing: any helper that
// mutates state (truncate / reset / seed) MUST call assertTestDatabase()
// before doing anything destructive. Two simultaneous conditions required:
//
//   1. process.env.WCF_TEST_DATABASE === '1' — explicit operator opt-in.
//   2. Supabase URL must NOT contain the prod project ref — defensive check
//      so even an over-eager export of the flag can't reach prod.
//
// Throws on failure. Caller catches or lets it propagate.
//
// Test coverage: assertTestDatabase.test.js (vitest).
// ============================================================================

const PROD_PROJECT_REF = 'pzfujbjtayhkdlxiblwe';

export function assertTestDatabase(supabaseUrl) {
  if (process.env.WCF_TEST_DATABASE !== '1') {
    throw new Error(
      'assertTestDatabase: WCF_TEST_DATABASE env var is not exactly "1". ' +
        'Refusing destructive operations. Set WCF_TEST_DATABASE=1 in ' +
        '.env.test.local to acknowledge a non-production Supabase target.',
    );
  }
  if (typeof supabaseUrl !== 'string' || supabaseUrl.length === 0) {
    throw new Error('assertTestDatabase: supabaseUrl must be a non-empty string. Got: ' + String(supabaseUrl));
  }
  if (supabaseUrl.includes(PROD_PROJECT_REF)) {
    throw new Error(
      `assertTestDatabase: Supabase URL "${supabaseUrl}" matches the ` +
        `production project ref "${PROD_PROJECT_REF}". Use a separate test project.`,
    );
  }
}

export const _PROD_PROJECT_REF = PROD_PROJECT_REF;
