import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {describe, it, expect} from 'vitest';

// ============================================================================
// /my-tasks logged-in completion lane (C2) — static-shape lock
// ============================================================================
// Codex C2 amendment locks:
//   1. complete_task_instance is SECDEF + search_path=public + GRANT
//      EXECUTE TO authenticated only (no anon, no PUBLIC).
//   2. Race-safe completion: UPDATE … WHERE id=? AND status='open'
//      RETURNING + fallback SELECT for idempotent replay.
//   3. Path validation uses the ROW's assignee_profile_id, not the
//      caller's auth.uid().
//   4. MyTasksView uses ti.assignee_profile_id when building the
//      completion photo path.
//   5. MyTasksView does NOT import from tasksAdminApi.
//   6. Header "My Tasks" link is OUTSIDE the admin-role gate.
//   7. Request photos and completion photos use SEPARATE buckets +
//      helpers.
//   8. Routes wire myTasks → /my-tasks; main.jsx wraps MyTasksView
//      in UnauthorizedRedirect with requireAdmin: false.
// ============================================================================

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..', '..');

const migSrc = fs.readFileSync(path.join(ROOT, 'supabase-migrations/040_complete_task_instance.sql'), 'utf8');
const tasksSrc = fs.readFileSync(path.join(ROOT, 'src/lib/tasks.js'), 'utf8');
const userApiSrc = fs.readFileSync(path.join(ROOT, 'src/lib/tasksUserApi.js'), 'utf8');
const adminApiSrc = fs.readFileSync(path.join(ROOT, 'src/lib/tasksAdminApi.js'), 'utf8');
const viewSrc = fs.readFileSync(path.join(ROOT, 'src/auth/MyTasksView.jsx'), 'utf8');
const mainSrc = fs.readFileSync(path.join(ROOT, 'src/main.jsx'), 'utf8');
const routesSrc = fs.readFileSync(path.join(ROOT, 'src/lib/routes.js'), 'utf8');
const headerSrc = fs.readFileSync(path.join(ROOT, 'src/shared/Header.jsx'), 'utf8');

describe('Mig 040 — complete_task_instance shape', () => {
  const fnMatch = migSrc.match(
    /CREATE OR REPLACE FUNCTION public\.complete_task_instance\([\s\S]*?\$complete_task_instance\$;/,
  );
  const fnBody = fnMatch ? fnMatch[0] : '';

  it('is SECURITY DEFINER + search_path=public', () => {
    expect(fnMatch, 'expected complete_task_instance function definition').not.toBeNull();
    expect(fnBody).toMatch(/SECURITY DEFINER/);
    expect(fnBody).toMatch(/SET search_path = public/);
  });

  it('GRANT EXECUTE goes to authenticated only; no anon, no PUBLIC', () => {
    expect(migSrc).toMatch(/REVOKE ALL ON FUNCTION public\.complete_task_instance\(text, text\) FROM PUBLIC/);
    expect(migSrc).toMatch(/REVOKE ALL ON FUNCTION public\.complete_task_instance\(text, text\) FROM anon/);
    expect(migSrc).toMatch(/GRANT EXECUTE ON FUNCTION public\.complete_task_instance\(text, text\) TO authenticated/);
    expect(migSrc).not.toMatch(/GRANT EXECUTE[\s\S]{0,200}?TO anon/);
    expect(migSrc).not.toMatch(/GRANT EXECUTE[\s\S]{0,200}?TO PUBLIC/);
  });

  it('rejects unauthenticated callers (auth.uid() IS NULL)', () => {
    expect(fnBody).toMatch(/v_caller\s*:=\s*auth\.uid\(\)/);
    expect(fnBody).toMatch(/IF v_caller IS NULL THEN[\s\S]{0,200}?'complete_task_instance: not authenticated'/);
  });

  it('authorization: caller must equal assignee OR is_admin()', () => {
    expect(fnBody).toMatch(/v_caller\s*<>\s*v_assignee\s+AND\s+NOT\s+public\.is_admin\(\)/);
    expect(fnBody).toMatch(/'complete_task_instance: forbidden'/);
  });

  it('race-safe: UPDATE WHERE status=open RETURNING + fallback SELECT', () => {
    expect(fnBody).toMatch(
      /UPDATE public\.task_instances[\s\S]{0,400}?WHERE id\s*=\s*p_instance_id[\s\S]{0,100}?AND status\s*=\s*'open'[\s\S]{0,100}?RETURNING/,
    );
    // Lost-the-race branch reads back the now-completed state.
    expect(fnBody).toMatch(
      /IF v_updated_at IS NOT NULL THEN[\s\S]{0,800}?idempotent_replay[\s\S]{0,800}?SELECT completion_photo_path/,
    );
  });

  it('idempotent replay returns idempotent_replay:true on re-call', () => {
    // Two replay paths: status='completed' fast-path and lost-the-race
    // fallback. Both build a jsonb with idempotent_replay=true.
    const replayHits = fnBody.match(/idempotent_replay/g) || [];
    expect(replayHits.length).toBeGreaterThanOrEqual(3);
  });

  it('path validation uses the ROW assignee_profile_id, not the caller', () => {
    // Codex C2 amendment 3 (and Codex C3 amendment 5): prefix uses
    // v_assignee, not v_caller. Lock both: positive (v_assignee
    // present in the prefix builder) and negative (v_caller absent
    // from the SAME LINE as v_expected_prefix assignment).
    expect(fnBody).toMatch(
      /v_expected_prefix\s*:=\s*'task-photos\/'\s*\|\|\s*v_assignee::text\s*\|\|\s*'\/'\s*\|\|\s*p_instance_id\s*\|\|\s*'\/'/,
    );
    // Defensive: the v_expected_prefix assignment line itself must
    // not reference v_caller.
    const prefixLineMatch = fnBody.match(/^.*v_expected_prefix\s*:=.*$/m);
    expect(prefixLineMatch, 'expected to find the v_expected_prefix assignment line').not.toBeNull();
    expect(prefixLineMatch[0]).not.toMatch(/v_caller/);
  });

  it('uses left(path, length(prefix)) = prefix and position(chr(92) IN ...) for slash detection', () => {
    expect(fnBody).toMatch(/left\(v_normalized_path,\s*length\(v_expected_prefix\)\)\s*<>\s*v_expected_prefix/);
    expect(fnBody).toMatch(/position\('\/' IN v_filename\)\s*>\s*0/);
    expect(fnBody).toMatch(/position\(chr\(92\) IN v_filename\)\s*>\s*0/);
  });

  it('rejects malformed paths with the expected RAISE messages', () => {
    expect(fnBody).toMatch(/'complete_task_instance: completion_photo_path prefix mismatch'/);
    expect(fnBody).toMatch(/'complete_task_instance: completion_photo_path filename empty'/);
    expect(fnBody).toMatch(/'complete_task_instance: completion_photo_path filename invalid'/);
  });
});

describe('Routes + main.jsx wiring', () => {
  it('routes.js maps myTasks → /my-tasks', () => {
    expect(routesSrc).toMatch(/myTasks:\s*'\/my-tasks'/);
  });

  it("main.jsx includes 'myTasks' in VALID_VIEWS", () => {
    expect(mainSrc).toMatch(/'myTasks'/);
  });

  it('main.jsx wraps MyTasksView in UnauthorizedRedirect with requireAdmin: false', () => {
    expect(mainSrc).toMatch(
      /view\s*===\s*'myTasks'[\s\S]{0,500}?UnauthorizedRedirect[\s\S]{0,300}?requireAdmin:\s*false[\s\S]{0,200}?MyTasksView/,
    );
  });
});

describe('Header.jsx — My Tasks outside the admin gate', () => {
  it('My Tasks button is rendered before the admin-only block', () => {
    // The "My Tasks" button must NOT live inside the
    // {authState?.role === 'admin' && (...)} block. Match the order:
    // any "📋 My Tasks" appears earlier in the dropdown than the
    // admin gate's appearance.
    const myTasksIdx = headerSrc.indexOf('📋 My Tasks');
    expect(myTasksIdx).toBeGreaterThan(-1);
    // Find the FIRST occurrence of the admin gate string AFTER the
    // dropdown trigger.
    const dropdownStart = headerSrc.indexOf('authState?.user');
    expect(dropdownStart).toBeGreaterThan(-1);
    const adminGateIdxFromDropdown = headerSrc.indexOf("authState?.role === 'admin'", dropdownStart);
    expect(adminGateIdxFromDropdown).toBeGreaterThan(myTasksIdx);
  });

  it("My Tasks button calls setView('myTasks')", () => {
    expect(headerSrc).toMatch(/setView\(\s*'myTasks'\s*\)/);
  });

  it('the dropdown trigger is gated on authState?.user (not role==="admin")', () => {
    // Lock that the OUTER dropdown gate widened to "any authenticated"
    // — this is what makes My Tasks reachable for non-admins.
    expect(headerSrc).toMatch(/\{\s*authState\?\.user\s*&&\s*\(\s*\n\s*<div style=\{\{position: 'relative'\}\}>/);
  });
});

describe('MyTasksView component', () => {
  it('imports completion + signed-URL helpers from tasksUserApi.js', () => {
    expect(viewSrc).toMatch(/from\s+'\.\.\/lib\/tasksUserApi\.js'/);
    expect(viewSrc).toMatch(/loadOpenTasksForAssignee/);
    expect(viewSrc).toMatch(/uploadCompletionPhoto/);
    expect(viewSrc).toMatch(/completeTaskInstance/);
    expect(viewSrc).toMatch(/getRequestPhotoSignedUrl/);
  });

  it('does NOT import from tasksAdminApi.js (Codex C2 amendment 3)', () => {
    expect(viewSrc).not.toMatch(/from\s+'\.\.\/lib\/tasksAdminApi\.js'/);
  });

  it('builds the completion photo path from ti.assignee_profile_id, not authState (Codex C2 amendment 2)', () => {
    expect(viewSrc).toMatch(/uploadCompletionPhoto\(\s*sb,\s*ti\.assignee_profile_id,\s*ti\.id,\s*file\s*\)/);
    // Defensive: the upload call does NOT use authState.user.id for the
    // assignee parameter.
    expect(viewSrc).not.toMatch(/uploadCompletionPhoto\([^)]*authState\.user\.id/);
  });

  it('renders the request-photo link only when ti.request_photo_path is set', () => {
    expect(viewSrc).toMatch(/ti\.request_photo_path\s*&&[\s\S]{0,300}?openRequestPhoto\(ti\.request_photo_path\)/);
  });

  it('reads tasks via loadOpenTasksForAssignee with the caller profile id', () => {
    expect(viewSrc).toMatch(/loadOpenTasksForAssignee\(\s*sb,\s*callerProfileId\s*\)/);
  });
});

describe('tasksUserApi.js — assignee/admin completion + signed URLs', () => {
  it('exports loadOpenTasksForAssignee, uploadCompletionPhoto, completeTaskInstance', () => {
    expect(userApiSrc).toMatch(/export async function loadOpenTasksForAssignee/);
    expect(userApiSrc).toMatch(/export async function uploadCompletionPhoto/);
    expect(userApiSrc).toMatch(/export async function completeTaskInstance/);
  });

  it('exports getRequestPhotoSignedUrl AND getCompletionPhotoSignedUrl', () => {
    expect(userApiSrc).toMatch(/export async function getRequestPhotoSignedUrl/);
    expect(userApiSrc).toMatch(/export async function getCompletionPhotoSignedUrl/);
  });

  it('uploadCompletionPhoto is retry-safe via upsert:false + duplicate-as-success (Codex C2 review)', () => {
    // task-photos bucket is append-only (mig 038 has no UPDATE
    // policy). Supabase storage upsert:true would fail at the
    // policy layer. Keep upsert:false and treat Duplicate / 409 /
    // "already exists" as idempotent success.
    const fnMatch = userApiSrc.match(/export async function uploadCompletionPhoto\([\s\S]*?\n\}\s*\n/);
    expect(fnMatch, 'expected uploadCompletionPhoto body').not.toBeNull();
    expect(fnMatch[0]).toMatch(/upsert:\s*false/);
    expect(fnMatch[0]).not.toMatch(/upsert:\s*true/);
    expect(fnMatch[0]).toMatch(/isStorageDuplicateError\(error\)/);
  });

  it('completeTaskInstance calls the SECDEF RPC by name', () => {
    expect(userApiSrc).toMatch(/sb\.rpc\(\s*'complete_task_instance'/);
  });
});

describe('Tasks request vs. completion photos use SEPARATE buckets + helpers', () => {
  it('tasks.js exports the two distinct bucket constants', () => {
    expect(tasksSrc).toMatch(/export const TASK_REQUEST_PHOTOS_BUCKET\s*=\s*'task-request-photos'/);
    expect(tasksSrc).toMatch(/export const TASK_PHOTOS_BUCKET\s*=\s*'task-photos'/);
  });

  it('the two filename defaults are distinct', () => {
    expect(tasksSrc).toMatch(/TASK_REQUEST_PHOTO_DEFAULT_FILENAME\s*=\s*'photo-1\.jpg'/);
    expect(tasksSrc).toMatch(/TASK_COMPLETION_PHOTO_DEFAULT_FILENAME\s*=\s*'completion-1\.jpg'/);
  });

  it('completion path helpers exist (build/strip)', () => {
    expect(tasksSrc).toMatch(/export function buildCompletionPhotoStoragePath/);
    expect(tasksSrc).toMatch(/export function buildCompletionPhotoDbPath/);
    expect(tasksSrc).toMatch(/export function stripCompletionPhotoBucket/);
  });

  it('getRequestPhotoSignedUrl was relocated out of tasksAdminApi (Codex C2 amendment 3)', () => {
    expect(adminApiSrc).not.toMatch(/export async function getRequestPhotoSignedUrl/);
  });
});
