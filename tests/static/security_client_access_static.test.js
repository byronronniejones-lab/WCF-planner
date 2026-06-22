import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {describe, it, expect} from 'vitest';

// ============================================================================
// Client access-control hardening (P0 security hotfix)
// ============================================================================
// Two client privilege-escalation findings from the 2026-06-22 security audit:
//
//   A. loadUser's catch path used to fail OPEN — a profile/data-load failure
//      set role:'admin', elevating any logged-in user to client-side admin.
//      It must fail CLOSED to a least-privilege role and never to admin.
//
//   B. The /admin (webforms) route rendered WebformsAdminView directly, gated
//      only by a hidden Header nav button. A non-admin who typed/bookmarked the
//      URL reached the admin config surface. It must route through
//      UnauthorizedRedirect{requireAdmin:true} like the clientErrors route.
//
// These are client defense-in-depth guards; server RLS/RPC remains the real
// boundary. This static guard locks the two client fixes so they cannot
// silently regress.
// ============================================================================

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..', '..');
const mainSrc = fs.readFileSync(path.join(ROOT, 'src/main.jsx'), 'utf8');
const guardSrc = fs.readFileSync(path.join(ROOT, 'src/shared/UnauthorizedRedirect.jsx'), 'utf8');

// Isolate the loadUser function body (from its declaration to the next
// top-level function) so assertions target only that function.
const luStart = mainSrc.indexOf('async function loadUser');
const luEnd = mainSrc.indexOf('async function loadAllData');
const loadUserSrc = luStart > -1 && luEnd > luStart ? mainSrc.slice(luStart, luEnd) : '';
// Isolate just the catch block of loadUser.
const catchIdx = loadUserSrc.indexOf('} catch');
const loadUserCatchSrc = catchIdx > -1 ? loadUserSrc.slice(catchIdx) : '';

describe('A — loadUser catch path fails closed (never elevates role)', () => {
  it('locates the loadUser function and its catch block', () => {
    expect(luStart).toBeGreaterThan(-1);
    expect(loadUserCatchSrc.length).toBeGreaterThan(0);
  });

  it('the catch path NEVER sets role:admin (fail-open elevation removed)', () => {
    expect(loadUserCatchSrc).not.toMatch(/role:\s*['"]admin['"]/);
  });

  it('the catch path NEVER sets a privileged role (no admin/management)', () => {
    expect(loadUserCatchSrc).not.toMatch(/role:\s*['"]management['"]/);
  });

  it('the catch path uses least-privilege role:inactive', () => {
    expect(loadUserCatchSrc).toMatch(/role:\s*['"]inactive['"]/);
  });

  it('the catch path still resolves the pig readiness signal (no Loading-forever regression)', () => {
    expect(loadUserCatchSrc).toMatch(/setFeedersLoaded\(true\)/);
    expect(loadUserCatchSrc).toMatch(/setDataLoaded\(true\)/);
  });
});

describe('B — /admin webforms route is admin-gated via UnauthorizedRedirect', () => {
  // Slice from the webforms route check to the following PIG DAILY WEBFORM marker.
  const wfStart = mainSrc.indexOf("if (view === 'webforms')");
  const wfEnd = mainSrc.indexOf('PIG DAILY WEBFORM', wfStart);
  const webformsBlock = wfStart > -1 && wfEnd > wfStart ? mainSrc.slice(wfStart, wfEnd) : '';

  it('locates the webforms route block', () => {
    expect(wfStart).toBeGreaterThan(-1);
    expect(webformsBlock.length).toBeGreaterThan(0);
  });

  it('renders WebformsAdminView through UnauthorizedRedirect', () => {
    expect(webformsBlock).toMatch(/UnauthorizedRedirect/);
    expect(webformsBlock).toMatch(/WebformsAdminView/);
  });

  it('the webforms guard requires admin and falls back to home', () => {
    expect(webformsBlock).toMatch(/requireAdmin:\s*true/);
    expect(webformsBlock).toMatch(/fallbackView:\s*['"]home['"]/);
  });

  it('does NOT render WebformsAdminView unguarded (no bare createElement of the admin view)', () => {
    // The only WebformsAdminView render must be the one nested inside the guard.
    expect(webformsBlock).not.toMatch(/return React\.createElement\(WebformsAdminView,/);
  });
});

describe('clientErrors route remains admin-gated (regression guard)', () => {
  const ceStart = mainSrc.indexOf("if (view === 'clientErrors')");
  const ceBlock = ceStart > -1 ? mainSrc.slice(ceStart, ceStart + 300) : '';

  it('clientErrors still routes through UnauthorizedRedirect with requireAdmin:true', () => {
    expect(ceStart).toBeGreaterThan(-1);
    expect(ceBlock).toMatch(/UnauthorizedRedirect/);
    expect(ceBlock).toMatch(/requireAdmin:\s*true/);
  });
});

describe('UnauthorizedRedirect enforces admin-only when requireAdmin is set', () => {
  it('denies any non-admin role under requireAdmin', () => {
    expect(guardSrc).toMatch(/requireAdmin\s*&&\s*authState\.role\s*!==\s*['"]admin['"]/);
  });
});
