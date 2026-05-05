import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {describe, it, expect} from 'vitest';

// ============================================================================
// Admin Tasks Center — C1 static-shape lock
// ============================================================================
// Codex amendment for this lane:
//   "component-level guard (new src/shared/UnauthorizedRedirect.jsx,
//    redirects non-admin to home — does NOT rely on header dropdown
//    gating alone)."
//
// This spec locks the shape so the guard can't be silently removed:
//   1. UnauthorizedRedirect.jsx exists and exports a component that
//      reads authState + redirects via setView.
//   2. main.jsx wraps AdminTasksView in UnauthorizedRedirect with
//      requireAdmin: true at the route mount.
//   3. AdminTasksView.jsx does NOT render any `requires_photo` field
//      (mig 039 dropped that column).
//   4. The Run Cron Now button calls tasks-cron with admin mode and
//      NO probe flag.
//   5. routes.js maps adminTasks → /admin/tasks.
// ============================================================================

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..', '..');

const guardSrc = fs.readFileSync(path.join(ROOT, 'src/shared/UnauthorizedRedirect.jsx'), 'utf8');
const viewSrc = fs.readFileSync(path.join(ROOT, 'src/admin/AdminTasksView.jsx'), 'utf8');
const apiSrc = fs.readFileSync(path.join(ROOT, 'src/lib/tasksAdminApi.js'), 'utf8');
const mainSrc = fs.readFileSync(path.join(ROOT, 'src/main.jsx'), 'utf8');
const routesSrc = fs.readFileSync(path.join(ROOT, 'src/lib/routes.js'), 'utf8');
const headerSrc = fs.readFileSync(path.join(ROOT, 'src/shared/Header.jsx'), 'utf8');

describe('UnauthorizedRedirect guard component', () => {
  it('reads authState and redirects via setView', () => {
    expect(guardSrc).toMatch(/authState/);
    expect(guardSrc).toMatch(/setView/);
    // The guard must NOT pass through children when role !== 'admin' under
    // requireAdmin — locking the explicit role check string.
    expect(guardSrc).toMatch(/role\s*!==\s*'admin'/);
  });

  it('renders nothing while authState === null (loading)', () => {
    expect(guardSrc).toMatch(/authState\s*===\s*null/);
  });
});

describe('main.jsx mounts AdminTasksView through the guard', () => {
  it('imports UnauthorizedRedirect and AdminTasksView', () => {
    expect(mainSrc).toMatch(/from '\.\/shared\/UnauthorizedRedirect\.jsx'/);
    expect(mainSrc).toMatch(/from '\.\/admin\/AdminTasksView\.jsx'/);
  });

  it("wraps view==='adminTasks' in UnauthorizedRedirect with requireAdmin: true", () => {
    // Match the mount block: view check → createElement(UnauthorizedRedirect, ..., createElement(AdminTasksView, ...))
    expect(mainSrc).toMatch(
      /view\s*===\s*'adminTasks'[\s\S]{0,400}UnauthorizedRedirect[\s\S]{0,200}requireAdmin:\s*true[\s\S]{0,200}AdminTasksView/,
    );
  });

  it("includes 'adminTasks' in VALID_VIEWS so the URL→view sync doesn't fall back to home", () => {
    expect(mainSrc).toMatch(/'adminTasks'/);
  });
});

describe('AdminTasksView renders no requires_photo field anywhere', () => {
  it('source contains no requires_photo as a code identifier (comments allowed)', () => {
    // Strip line + block comments so a doc-string mentioning the column
    // doesn't trip the lock; only catch actual JSX/JS code use.
    const stripped = viewSrc.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
    expect(stripped).not.toMatch(/requires_photo/);
  });
});

describe('Run Cron Now wiring', () => {
  it('runCronNow invokes tasks-cron in admin mode with no probe flag', () => {
    expect(apiSrc).toMatch(/sb\.functions\.invoke\(\s*'tasks-cron'\s*,\s*\{\s*body:\s*ADMIN_INVOKE_BODY\s*\}/);
    expect(apiSrc).toMatch(/ADMIN_INVOKE_BODY\s*=\s*\{\s*mode:\s*'admin'\s*\}/);
    // Defense in depth: no `probe: true` in the actual call body. Comments
    // mentioning the prior probe-only audit path are allowed; a literal
    // `probe: true` on the invoke arg is not.
    const stripped = apiSrc.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
    expect(stripped).not.toMatch(/probe\s*:\s*true/);
  });
});

describe('Routes wiring', () => {
  it('adminTasks → /admin/tasks in routes.js', () => {
    expect(routesSrc).toMatch(/adminTasks:\s*'\/admin\/tasks'/);
  });
});

describe('Header dropdown surfaces Tasks Center under the role==="admin" gate', () => {
  it('Tasks Center button calls setView("adminTasks")', () => {
    // The button must live under the existing admin block; we look for the
    // setView call colocated with a Tasks Center label.
    expect(headerSrc).toMatch(/setView\(\s*'adminTasks'\s*\)/);
    expect(headerSrc).toMatch(/Tasks Center/);
  });
});

describe('AdminTasksView hydrates profiles on direct /admin/tasks navigation', () => {
  // allUsers lives in AuthContext and is only populated when something
  // explicitly calls loadUsers (Header → Users modal does, but a bookmark
  // / URL-bar / page-reload to /admin/tasks does not). The view itself
  // must kick loadUsers on mount when allUsers is empty so the assignee
  // dropdown isn't blank.
  it('main.jsx passes loadUsers as a prop to AdminTasksView', () => {
    expect(mainSrc).toMatch(/createElement\(AdminTasksView,\s*\{[^}]*\bloadUsers\b[^}]*\}\)/);
  });

  it('AdminTasksView accepts loadUsers in its props', () => {
    expect(viewSrc).toMatch(/function AdminTasksView\(\{[^}]*\bloadUsers\b[^}]*\}\)/);
  });

  it('AdminTasksView calls loadUsers on mount when allUsers is empty', () => {
    // Two halves to lock:
    //   (a) some effect in the file calls loadUsers()
    //   (b) the call is gated on allUsers being empty so it doesn't loop
    expect(viewSrc).toMatch(/loadUsers\(\)/);
    expect(viewSrc).toMatch(/allUsers\.length\s*>\s*0/);
  });
});
