// ============================================================================
// Static lock for Tasks v2 T2 — Task Center route wiring + read-only contract.
// ----------------------------------------------------------------------------
// What this guards:
//
//   1. /tasks route is wired into the router.
//        - src/lib/routes.js maps view='tasks' to '/tasks'.
//   2. main.jsx imports TaskCenterView and mounts it under /tasks via
//      UnauthorizedRedirect with requireAdmin: false.
//   3. main.jsx VALID_VIEWS includes 'tasks' so the URL adapter does not
//      snap the user back to home on first hit.
//   4. T2 components and the tasksCenterApi helper are READ-ONLY:
//        - No calls to any of the six v2 mutation RPCs.
//        - No direct .insert / .update / .delete on task_instances or
//          related tables.
//        - No calls to v1 complete_task_instance.
//        - No imports from tasksAdminApi / tasksUserApi (which carry
//          mutation wrappers).
//        - No storage uploads to task-photos / task-request-photos.
//
// Reverting any of these would silently break a hard gate Codex pinned
// in the T2 brief. The intent is that T3+ commits add a separate
// tasksCenterMutationsApi module; until then T2 components must not
// transact with the database for writes through any path.
// ============================================================================

import {describe, it, expect} from 'vitest';
import fs from 'fs';
import path from 'path';
import {fileURLToPath} from 'url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

const routesJs = fs.readFileSync(path.join(ROOT, 'src/lib/routes.js'), 'utf8');
const mainJsx = fs.readFileSync(path.join(ROOT, 'src/main.jsx'), 'utf8');
const taskCenterView = fs.readFileSync(path.join(ROOT, 'src/tasks/TaskCenterView.jsx'), 'utf8');
const myTasksTab = fs.readFileSync(path.join(ROOT, 'src/tasks/MyTasksTab.jsx'), 'utf8');
const recurringTab = fs.readFileSync(path.join(ROOT, 'src/tasks/RecurringTab.jsx'), 'utf8');
const completedTab = fs.readFileSync(path.join(ROOT, 'src/tasks/CompletedTab.jsx'), 'utf8');
const systemTasksTab = fs.readFileSync(path.join(ROOT, 'src/tasks/SystemTasksTab.jsx'), 'utf8');
const tasksCenterApi = fs.readFileSync(path.join(ROOT, 'src/lib/tasksCenterApi.js'), 'utf8');

const T2_FILES = {
  'TaskCenterView.jsx': taskCenterView,
  'MyTasksTab.jsx': myTasksTab,
  'RecurringTab.jsx': recurringTab,
  'CompletedTab.jsx': completedTab,
  'SystemTasksTab.jsx': systemTasksTab,
  'tasksCenterApi.js': tasksCenterApi,
};

const FORBIDDEN_RPC_NAMES = [
  'complete_task_instance',
  'create_one_time_task_instance',
  'update_task_instance_due_date',
  'assign_task_instance',
  'delete_task_instance',
  'generate_system_task_instance',
];

describe('Tasks v2 T2 — /tasks route wiring', () => {
  it('routes.js maps view "tasks" to /tasks', () => {
    expect(routesJs).toMatch(/tasks:\s*'\/tasks'/);
  });

  it('main.jsx imports TaskCenterView from src/tasks/', () => {
    expect(mainJsx).toMatch(/import\s+TaskCenterView\s+from\s+'\.\/tasks\/TaskCenterView\.jsx'/);
  });

  it('main.jsx VALID_VIEWS includes "tasks"', () => {
    // VALID_VIEWS is a flat array literal in main.jsx; assert the entry
    // is present without depending on its exact ordering.
    const validBlock = mainJsx.match(/VALID_VIEWS\s*=\s*\[([\s\S]*?)\]/);
    expect(validBlock).not.toBeNull();
    expect(validBlock[1]).toMatch(/'tasks'/);
  });

  it('main.jsx mounts TaskCenterView at view==="tasks" via UnauthorizedRedirect with requireAdmin:false', () => {
    // The mount block must wire requireAdmin: false (every logged-in
    // user can reach the Task Center) AND pass Header/sb/authState
    // to TaskCenterView.
    expect(mainJsx).toMatch(
      /if\s*\(view\s*===\s*'tasks'\)[\s\S]*?UnauthorizedRedirect[\s\S]*?requireAdmin:\s*false[\s\S]*?TaskCenterView,\s*\{Header,\s*sb,\s*authState\}/,
    );
  });

  it('main.jsx does NOT remove the legacy myTasks mount (legacy /my-tasks stays live)', () => {
    expect(mainJsx).toMatch(/if\s*\(view\s*===\s*'myTasks'\)/);
    expect(mainJsx).toMatch(/MyTasksView/);
  });

  it('main.jsx does NOT remove the legacy adminTasks mount (legacy /admin/tasks stays live)', () => {
    expect(mainJsx).toMatch(/if\s*\(view\s*===\s*'adminTasks'\)/);
    expect(mainJsx).toMatch(/AdminTasksView/);
  });
});

describe('Tasks v2 T2 — read-only contract on T2 components and helper', () => {
  for (const rpc of FORBIDDEN_RPC_NAMES) {
    it(`no T2 file calls ${rpc}`, () => {
      for (const [name, src] of Object.entries(T2_FILES)) {
        expect(src, `${name} must not reference ${rpc}`).not.toMatch(new RegExp(rpc));
      }
    });
  }

  it('no T2 file calls .insert / .update / .delete on task_instances or task tables', () => {
    // We check for the chained pattern .from('task_*')...{insert|update|delete}
    // and the bare RPC-style invocations. Pure read flows use .select.
    const writeChain =
      /\.from\(\s*['"](task_instances|task_templates|task_instance_photos|task_instance_due_date_edits|task_system_rules)['"]\s*\)\s*[\s\S]{0,200}?\.(insert|update|delete|upsert)\s*\(/;
    for (const [name, src] of Object.entries(T2_FILES)) {
      expect(src, `${name} must not write to task_* tables directly`).not.toMatch(writeChain);
    }
  });

  it('no T2 file imports the mutation modules tasksAdminApi or tasksUserApi', () => {
    for (const [name, src] of Object.entries(T2_FILES)) {
      expect(src, `${name} must not import tasksAdminApi`).not.toMatch(/from\s+['"][^'"]*tasksAdminApi[^'"]*['"]/);
      expect(src, `${name} must not import tasksUserApi`).not.toMatch(/from\s+['"][^'"]*tasksUserApi[^'"]*['"]/);
    }
  });

  it('no T2 file uploads to the task-photos or task-request-photos buckets', () => {
    for (const [name, src] of Object.entries(T2_FILES)) {
      expect(src, `${name} must not call storage.upload`).not.toMatch(/\.storage\.from\([^)]*\)\.upload\s*\(/);
    }
  });

  it('TaskCenterView gates the System Tasks tab to admin only', () => {
    // The TABS array marks System Tasks adminOnly; the visibleTabs
    // filter drops adminOnly entries when isAdmin is false. Lock both
    // so removing either silently exposes the tab to non-admins.
    expect(taskCenterView).toMatch(/key:\s*'system'[\s\S]*?adminOnly:\s*true/);
    expect(taskCenterView).toMatch(/visibleTabs\s*=\s*TABS\.filter\(\(t\)\s*=>\s*!t\.adminOnly\s*\|\|\s*isAdmin\)/);
  });

  it('MyTasksTab uses the read-only loader, not a write RPC', () => {
    expect(myTasksTab).toMatch(/loadOpenTaskInstances/);
    expect(myTasksTab).not.toMatch(/sb\.rpc\(/);
  });

  // Codex T2 round-2 fix #1: assignee names come from the SECDEF
  // list_eligible_assignees RPC (mig 041), not from a direct profiles
  // SELECT. The RPC works for non-admin users regardless of profiles
  // RLS and never leaks role/email through the wire.
  it('tasksCenterApi uses list_eligible_assignees and never reads profiles directly', () => {
    expect(tasksCenterApi).toMatch(/sb\.rpc\(\s*['"]list_eligible_assignees['"]\s*\)/);
    expect(tasksCenterApi).not.toMatch(/\.from\(\s*['"]profiles['"]\s*\)/);
  });

  it('no T2 file reads the profiles table directly', () => {
    for (const [name, src] of Object.entries(T2_FILES)) {
      expect(src, `${name} must not call .from('profiles') in T2`).not.toMatch(/\.from\(\s*['"]profiles['"]\s*\)/);
    }
  });

  // Codex T2 round-2 fix #2: due-state comparison must run in
  // America/Chicago (Ronnie's date-only / Central-time lock for
  // tasks). MyTasksTab must use the dateUtils helper, not raw
  // browser-local Date formatting.
  it('MyTasksTab uses todayCentralISO and not browser-local Date formatting', () => {
    expect(myTasksTab).toMatch(/from\s+['"]\.\.\/lib\/dateUtils\.js['"]/);
    expect(myTasksTab).toMatch(/todayCentralISO\(\)/);
    // Negative locks: no raw .getFullYear / .getMonth / .getDate at
    // call sites (these would re-introduce browser-local drift).
    expect(myTasksTab).not.toMatch(/\.getFullYear\(\)/);
    expect(myTasksTab).not.toMatch(/\.getMonth\(\)/);
    expect(myTasksTab).not.toMatch(/\.getDate\(\)/);
  });

  // Codex T2 round-2 fix #3: photo indicator is icon-only in
  // collapsed rows (Ronnie's lock — only icon unless expanded).
  // Expanded details land in T3+; until then, the visible label
  // text "Photo" must not render alongside the paperclip.
  it('MyTasksTab photo indicator is icon-only with title/aria-label, no visible "Photo" text', () => {
    // The data attribute marker stays so tests can find it; the
    // visible content must be only the paperclip glyph and the
    // accessibility metadata.
    expect(myTasksTab).toMatch(/data-task-has-photo="1"/);
    expect(myTasksTab).toMatch(/aria-label="Task has at least one photo"/);
    expect(myTasksTab).toMatch(/title="Task has at least one photo"/);
    // Negative lock: no "Photo" word inside the indicator span.
    expect(myTasksTab).not.toMatch(/📎\s+Photo/);
  });
});
