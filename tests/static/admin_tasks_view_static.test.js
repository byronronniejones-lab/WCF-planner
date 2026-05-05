import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {describe, it, expect} from 'vitest';

// ============================================================================
// Admin Tasks Center — C1 + C1.1 static-shape lock
// ============================================================================
// Locks the post-product-correction shape so cron UI can't crawl back in,
// and so the dual-purpose New Task modal stays the way Ronnie reviewed.
//
// What's locked:
//   1. UnauthorizedRedirect.jsx exists and reads authState + setView.
//   2. main.jsx wraps AdminTasksView in UnauthorizedRedirect with
//      requireAdmin: true at the route mount.
//   3. AdminTasksView contains no `requires_photo` code (mig 039 dropped
//      that column).
//   4. AdminTasksView exposes ZERO cron surfaces:
//        - no "Run Cron Now" button text
//        - no "task_cron_runs" or audit-footer copy
//        - no runCronNow/loadCronAuditTail wrapper imports
//   5. Routes wire adminTasks → /admin/tasks.
//   6. Header dropdown surfaces Tasks Center under the role==='admin' gate.
//   7. AdminTasksView accepts loadUsers and hydrates on mount when allUsers
//      is empty.
//   8. Section / button / empty-copy strings match the post-correction
//      product spec exactly:
//        - "Open Tasks" header
//        - "No open tasks." empty copy (no cron mention)
//        - "+ New Task" button
//        - "Recurring Tasks" section header
//   9. Modal defaults to one-time (recurring: false in emptyTaskForm).
//  10. Modal renders a "Make recurring" toggle that gates the recurrence
//      fields.
//  11. Save path branches:
//        - one-time → createOneTimeTaskInstance with submission_source
//          'admin_manual' and template_id null
//        - recurring → upsertTaskTemplate
// ============================================================================

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..', '..');

const guardSrc = fs.readFileSync(path.join(ROOT, 'src/shared/UnauthorizedRedirect.jsx'), 'utf8');
const viewSrc = fs.readFileSync(path.join(ROOT, 'src/admin/AdminTasksView.jsx'), 'utf8');
const apiSrc = fs.readFileSync(path.join(ROOT, 'src/lib/tasksAdminApi.js'), 'utf8');
const mainSrc = fs.readFileSync(path.join(ROOT, 'src/main.jsx'), 'utf8');
const routesSrc = fs.readFileSync(path.join(ROOT, 'src/lib/routes.js'), 'utf8');
const headerSrc = fs.readFileSync(path.join(ROOT, 'src/shared/Header.jsx'), 'utf8');

// Strip JS/JSX comments so a doc-string mentioning a removed feature
// doesn't trip a "feature is gone" lock. Catches both block + line forms.
function stripComments(src) {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
}
const viewCode = stripComments(viewSrc);
const apiCode = stripComments(apiSrc);

describe('UnauthorizedRedirect guard component', () => {
  it('reads authState and redirects via setView', () => {
    expect(guardSrc).toMatch(/authState/);
    expect(guardSrc).toMatch(/setView/);
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
    expect(viewCode).not.toMatch(/requires_photo/);
  });
});

describe('AdminTasksView exposes ZERO cron surfaces (C1.1 product correction)', () => {
  it('does not render a "Run Cron Now" button', () => {
    // Lock against the literal user-facing string. Comments still allowed.
    expect(viewCode).not.toMatch(/Run Cron Now/);
  });

  it('does not import runCronNow or loadCronAuditTail from the wrapper module', () => {
    expect(viewCode).not.toMatch(/\brunCronNow\b/);
    expect(viewCode).not.toMatch(/\bloadCronAuditTail\b/);
  });

  it('does not render task_cron_runs or audit-footer copy', () => {
    expect(viewCode).not.toMatch(/task_cron_runs/);
    expect(viewCode).not.toMatch(/cron audit/i);
  });

  it('the wrapper module no longer exports runCronNow / loadCronAuditTail', () => {
    expect(apiCode).not.toMatch(/export\s+async\s+function\s+runCronNow\b/);
    expect(apiCode).not.toMatch(/export\s+async\s+function\s+loadCronAuditTail\b/);
  });
});

describe('Routes wiring', () => {
  it('adminTasks → /admin/tasks in routes.js', () => {
    expect(routesSrc).toMatch(/adminTasks:\s*'\/admin\/tasks'/);
  });
});

describe('Header dropdown surfaces Tasks Center under the role==="admin" gate', () => {
  it('Tasks Center button calls setView("adminTasks")', () => {
    expect(headerSrc).toMatch(/setView\(\s*'adminTasks'\s*\)/);
    expect(headerSrc).toMatch(/Tasks Center/);
  });
});

describe('AdminTasksView hydrates profiles on direct /admin/tasks navigation', () => {
  it('main.jsx passes loadUsers as a prop to AdminTasksView', () => {
    expect(mainSrc).toMatch(/createElement\(AdminTasksView,\s*\{[^}]*\bloadUsers\b[^}]*\}\)/);
  });

  it('AdminTasksView accepts loadUsers in its props', () => {
    expect(viewSrc).toMatch(/function AdminTasksView\(\{[^}]*\bloadUsers\b[^}]*\}\)/);
  });

  it('AdminTasksView calls loadUsers on mount when allUsers is empty', () => {
    expect(viewSrc).toMatch(/loadUsers\(\)/);
    expect(viewSrc).toMatch(/allUsers\.length\s*>\s*0/);
  });
});

describe('AdminTasksView product copy (C1.1 strings)', () => {
  it('section header reads "Open Tasks"', () => {
    // Lock the literal — keep the (count) suffix flexible by anchoring
    // only on the header text.
    expect(viewSrc).toMatch(/>\s*Open Tasks\s*\(/);
  });

  it('empty-state copy is exactly "No open tasks." (no cron mention)', () => {
    expect(viewSrc).toMatch(/>\s*No open tasks\.\s*</);
    // Defense in depth: no 04:00 UTC fire copy lingering anywhere.
    expect(viewCode).not.toMatch(/04:00 UTC/);
    expect(viewCode).not.toMatch(/cron fire/i);
  });

  it('primary action button reads "+ New Task" (not "+ New template")', () => {
    expect(viewSrc).toMatch(/\+\s*New Task/);
    expect(viewSrc).not.toMatch(/\+\s*New template/);
  });

  it('recurring-list section header reads "Recurring Tasks"', () => {
    expect(viewSrc).toMatch(/>\s*Recurring Tasks\s*</);
  });

  it('"task instances" wording is gone from user-visible UI', () => {
    // The view must not surface the technical term "task instances" or
    // "Open task instances" anywhere a user would see it. (Internal column
    // names like task_instances are fine in code; covered by stripComments.)
    expect(viewCode).not.toMatch(/Open task instances/);
    expect(viewCode).not.toMatch(/Task templates/);
  });
});

describe('New Task modal defaults to one-time mode with a "Make recurring" toggle', () => {
  it('emptyTaskForm sets recurring: false', () => {
    expect(viewSrc).toMatch(/function emptyTaskForm\(\)\s*\{[\s\S]*?recurring:\s*false/);
  });

  it('renders a "Make recurring" checkbox', () => {
    expect(viewSrc).toMatch(/Make recurring/);
    expect(viewSrc).toMatch(/checked=\{editForm\.recurring\}/);
  });

  it('gates recurrence/interval/active fields on editForm.recurring', () => {
    // The recurrence-mode fields should only render when editForm.recurring
    // is truthy. Look for the conditional render block.
    expect(viewSrc).toMatch(/\{editForm\.recurring\s*&&/);
  });
});

describe('Save path branches one-time vs recurring (C1.1 dual-purpose)', () => {
  it('one-time branch calls createOneTimeTaskInstance with admin_manual source', () => {
    // The recurring=false branch in saveTask must call
    // createOneTimeTaskInstance with submission_source 'admin_manual' and
    // template_id null.
    expect(viewSrc).toMatch(/createOneTimeTaskInstance\(sb,/);
    expect(viewSrc).toMatch(/submission_source:\s*'admin_manual'/);
    expect(viewSrc).toMatch(/template_id:\s*null/);
  });

  it('recurring branch calls upsertTaskTemplate', () => {
    expect(viewSrc).toMatch(/upsertTaskTemplate\(sb,/);
  });

  it('the wrapper module exports createOneTimeTaskInstance', () => {
    expect(apiCode).toMatch(/export\s+async\s+function\s+createOneTimeTaskInstance\b/);
    // It inserts into task_instances, not task_templates.
    expect(apiCode).toMatch(/from\(\s*'task_instances'\s*\)\.insert/);
  });
});

describe('One-time instance id is minted at modal-open and stable across Save retries', () => {
  it('emptyTaskForm declares the oneTimeInstanceId field (default empty)', () => {
    expect(viewSrc).toMatch(/function emptyTaskForm\(\)\s*\{[\s\S]*?oneTimeInstanceId:\s*''/);
  });

  it('startNew mints a stable instance id and stores it on the form', () => {
    // The mint must happen inside startNew (modal-open) and land on the
    // form, not inside saveTask. Lock both halves.
    expect(viewSrc).toMatch(/function startNew\(\)\s*\{[\s\S]*?\.oneTimeInstanceId\s*=\s*mintInstanceId\(\)/);
  });

  it('saveTask one-time branch uses editForm.oneTimeInstanceId, not a fresh mintInstanceId() call', () => {
    // The one-time INSERT payload's id must be `editForm.oneTimeInstanceId`,
    // taken from the form state minted at startNew time. A fresh
    // mintInstanceId() call inside saveTask would defeat the retry-safety
    // contract — block it.
    const code = viewCode;
    // (a) The id field on the one-time payload reads from editForm.
    expect(code).toMatch(/id:\s*editForm\.oneTimeInstanceId/);
    // (b) saveTask must NOT call mintInstanceId() directly.
    const saveBody = code.match(/async function saveTask\(\)\s*\{[\s\S]*?\n\s\s\}/);
    expect(saveBody, 'expected to find saveTask function body').not.toBeNull();
    expect(saveBody[0]).not.toMatch(/mintInstanceId\(\)/);
  });

  it('startEditTemplate path does NOT carry a one-time instance id', () => {
    // Recurring template edits go through upsertTaskTemplate using
    // editForm.id; the oneTimeInstanceId field is only relevant to the
    // one-time branch. Locking that startEditTemplate doesn't write to
    // oneTimeInstanceId — keeps the two id namespaces from getting
    // crossed if a future refactor reuses the field.
    const editFn = viewSrc.match(/function startEditTemplate\([\s\S]*?\}\s*\n\s*\}/);
    expect(editFn, 'expected to find startEditTemplate function').not.toBeNull();
    expect(editFn[0]).not.toMatch(/oneTimeInstanceId/);
  });
});
