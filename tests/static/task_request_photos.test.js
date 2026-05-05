import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {describe, it, expect} from 'vitest';
import {_REGISTRY as RPC_REGISTRY} from '../../src/lib/offlineRpcForms.js';

// ============================================================================
// Task request photos — C3.1b static-shape lock
// ============================================================================
// Locks:
//   1. Mig 042: column add, bucket creation, explicit anon + auth INSERT
//      policies, authenticated SELECT, NO anon SELECT, NO UPDATE/DELETE,
//      submit_task_instance request_photo_path validation (prefix match
//      + non-empty filename + no '/' or chr(92)).
//   2. offlineRpcForms task_submit registry: hasPhoto:true; buildArgs
//      threads requestPhotoDbPath into parent_in only when present;
//      OTHER registry entries (weigh_in_session_batch, add_feed_batch)
//      do NOT carry hasPhoto.
//   3. useOfflineRpcSubmit: hasPhoto branch is opt-in via cfg.hasPhoto;
//      photo prep + upload + atomic enqueue with blob; replay re-uploads
//      with upsert:true and rebuilds parent_in.request_photo_path.
//   4. Public TasksWebform: optional photo input wired through
//      submit(payload, {parentId, photo}).
//   5. AdminTasksView: photo input on one-time tasks only (hidden when
//      recurring); synchronous upload before createOneTimeTaskInstance;
//      Open Tasks list shows lazy 📎 Photo link via getRequestPhotoSignedUrl.
// ============================================================================

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..', '..');

const migSrc = fs.readFileSync(path.join(ROOT, 'supabase-migrations/042_task_request_photos.sql'), 'utf8');
const tasksSrc = fs.readFileSync(path.join(ROOT, 'src/lib/tasks.js'), 'utf8');
const rpcSrc = fs.readFileSync(path.join(ROOT, 'src/lib/offlineRpcForms.js'), 'utf8');
const hookSrc = fs.readFileSync(path.join(ROOT, 'src/lib/useOfflineRpcSubmit.js'), 'utf8');
const adminApiSrc = fs.readFileSync(path.join(ROOT, 'src/lib/tasksAdminApi.js'), 'utf8');
const adminViewSrc = fs.readFileSync(path.join(ROOT, 'src/admin/AdminTasksView.jsx'), 'utf8');
const webformSrc = fs.readFileSync(path.join(ROOT, 'src/webforms/TasksWebform.jsx'), 'utf8');

describe('Mig 042 — column + bucket + storage policies', () => {
  it('adds task_instances.request_photo_path (nullable, IF NOT EXISTS)', () => {
    expect(migSrc).toMatch(/ALTER TABLE public\.task_instances\s+ADD COLUMN IF NOT EXISTS request_photo_path text/i);
  });

  it('creates the task-request-photos bucket private (public:false) with ON CONFLICT DO NOTHING', () => {
    expect(migSrc).toMatch(/INSERT INTO storage\.buckets[\s\S]{0,200}?'task-request-photos'[\s\S]{0,100}?false/);
    expect(migSrc).toMatch(/ON CONFLICT \(id\) DO NOTHING/);
  });

  it('explicit anon INSERT policy on task-request-photos', () => {
    expect(migSrc).toMatch(
      /CREATE POLICY task_request_photos_anon_insert ON storage\.objects\s+FOR INSERT TO anon\s+WITH CHECK \(bucket_id = 'task-request-photos'\)/,
    );
  });

  it('explicit authenticated INSERT policy on task-request-photos (NOT inheriting anon)', () => {
    expect(migSrc).toMatch(
      /CREATE POLICY task_request_photos_auth_insert ON storage\.objects\s+FOR INSERT TO authenticated\s+WITH CHECK \(bucket_id = 'task-request-photos'\)/,
    );
  });

  it('authenticated SELECT policy on task-request-photos (signed-URL admin reads)', () => {
    expect(migSrc).toMatch(
      /CREATE POLICY task_request_photos_auth_select ON storage\.objects\s+FOR SELECT TO authenticated\s+USING \(bucket_id = 'task-request-photos'\)/,
    );
  });

  it('NO anon SELECT and NO UPDATE/DELETE policies on the bucket', () => {
    expect(migSrc).not.toMatch(/CREATE POLICY[\s\S]{0,100}?TO anon[\s\S]{0,100}?FOR SELECT/);
    expect(migSrc).not.toMatch(/CREATE POLICY[\s\S]{0,200}?task-request-photos[\s\S]{0,200}?FOR UPDATE/);
    expect(migSrc).not.toMatch(/CREATE POLICY[\s\S]{0,200}?task-request-photos[\s\S]{0,200}?FOR DELETE/);
  });
});

describe('Mig 042 — submit_task_instance request_photo_path validation', () => {
  // Restrict the search window to the submit_task_instance function
  // body so unrelated SQL doesn't false-match.
  const fn = migSrc.match(
    /CREATE OR REPLACE FUNCTION public\.submit_task_instance\(parent_in jsonb\)[\s\S]*?\$submit_task_instance\$;/,
  );
  const body = fn ? fn[0] : '';

  it('the function body locates the optional request_photo_path field on parent_in', () => {
    expect(body).toMatch(/v_request_photo_path\s*:=\s*nullif\(parent_in\s*->>\s*'request_photo_path',\s*''\)/);
  });

  it('uses left(path, length(prefix)) = prefix (NOT LIKE — _/% are wildcards)', () => {
    expect(body).toMatch(/left\(v_request_photo_path,\s*length\(v_expected_prefix\)\)\s*<>\s*v_expected_prefix/);
    expect(body).toMatch(/RAISE EXCEPTION 'submit_task_instance: request_photo_path prefix mismatch'/);
  });

  it('rejects empty filename', () => {
    expect(body).toMatch(/RAISE EXCEPTION 'submit_task_instance: request_photo_path filename empty'/);
  });

  it("rejects '/' or backslash via position(chr(92) IN ...)", () => {
    expect(body).toMatch(/position\('\/' IN v_filename\)\s*>\s*0/);
    expect(body).toMatch(/position\(chr\(92\) IN v_filename\)\s*>\s*0/);
    expect(body).toMatch(/RAISE EXCEPTION 'submit_task_instance: request_photo_path filename invalid'/);
  });

  it('INSERT statement writes request_photo_path column', () => {
    expect(body).toMatch(/INSERT INTO public\.task_instances\b[\s\S]*?request_photo_path[\s\S]*?VALUES/);
    expect(body).toMatch(/v_request_photo_path[\s\S]{0,30}?\)/);
  });
});

describe('offlineRpcForms task_submit registry has hasPhoto:true (opt-in)', () => {
  it('task_submit carries hasPhoto:true', () => {
    expect(RPC_REGISTRY.task_submit.hasPhoto).toBe(true);
  });

  it('weigh_in_session_batch + add_feed_batch do NOT carry hasPhoto (opt-in only)', () => {
    expect(RPC_REGISTRY.weigh_in_session_batch.hasPhoto).toBeFalsy();
    expect(RPC_REGISTRY.add_feed_batch.hasPhoto).toBeFalsy();
  });

  it('buildArgs threads requestPhotoDbPath into parent_in only when truthy', () => {
    const withPhoto = RPC_REGISTRY.task_submit.buildArgs(
      {
        title: 'Refill mineral',
        description: 'East pasture',
        due_date: '2026-05-10',
        assignee_profile_id: 'u',
        submitted_by_team_member: 'A',
      },
      {csid: 'c', parentId: 'ti-x', requestPhotoDbPath: 'task-request-photos/ti-x/photo-1.jpg'},
    );
    expect(withPhoto.args.parent_in.request_photo_path).toBe('task-request-photos/ti-x/photo-1.jpg');

    const withoutPhoto = RPC_REGISTRY.task_submit.buildArgs(
      {title: 'x', due_date: '2026-05-10', assignee_profile_id: 'u', submitted_by_team_member: 'A'},
      {csid: 'c', parentId: 'ti-x'},
    );
    expect(withoutPhoto.args.parent_in).not.toHaveProperty('request_photo_path');
  });
});

describe('useOfflineRpcSubmit hasPhoto branch wiring', () => {
  it('imports the bucket constant + path helpers from tasks.js', () => {
    expect(hookSrc).toMatch(/from\s+'\.\/tasks\.js'/);
    expect(hookSrc).toMatch(/TASK_REQUEST_PHOTOS_BUCKET/);
    expect(hookSrc).toMatch(/buildTaskRequestPhotoStoragePath/);
    expect(hookSrc).toMatch(/buildTaskRequestPhotoDbPath/);
  });

  it('imports compressImage + the queue photo APIs', () => {
    expect(hookSrc).toMatch(/from\s+'\.\/photoCompress\.js'/);
    expect(hookSrc).toMatch(/enqueueSubmissionWithPhotos/);
    expect(hookSrc).toMatch(/listPhotoBlobsByCsid/);
  });

  it('the submit-time photo branch is gated on cfg.hasPhoto && opts.photo', () => {
    expect(hookSrc).toMatch(/if\s*\(cfg\.hasPhoto\s*&&\s*opts\.photo\)/);
  });

  it('the submit-time photo upload uses upsert:false (deterministic path; first upload only)', () => {
    expect(hookSrc).toMatch(/uploadTaskRequestPhoto\([\s\S]{0,200}?\{\s*upsert:\s*false\s*\}\s*\)/);
  });

  it('the replay loop re-uploads with upsert:true (idempotent on same path)', () => {
    expect(hookSrc).toMatch(/uploadTaskRequestPhoto\([\s\S]{0,200}?\{\s*upsert:\s*true\s*\}\s*\)/);
  });

  it('replay rebuilds parent_in.request_photo_path on the in-memory record (no IDB mutation)', () => {
    // Lock the spread-rebuild pattern that produces a fresh record vs.
    // mutating entry.record in place (some browsers freeze cursor results).
    expect(hookSrc).toMatch(/recordToSend\s*=\s*\{[\s\S]{0,200}?args:\s*\{[\s\S]{0,200}?parent_in:\s*\{/);
    expect(hookSrc).toMatch(/request_photo_path:\s*dbPath/);
  });

  it('rejects opts.photo arrays (one-photo-max contract)', () => {
    expect(hookSrc).toMatch(/Array\.isArray\(blobOrFile\)/);
    expect(hookSrc).toMatch(/must be a single Blob\/File, not an array/);
  });
});

describe('Public TasksWebform photo wiring', () => {
  it('has a photoFile state', () => {
    expect(webformSrc).toMatch(/const \[photoFile, setPhotoFile\] = React\.useState\(null\)/);
  });

  it('passes opts.photo to submit()', () => {
    expect(webformSrc).toMatch(
      /submit\(payload,\s*\{\s*parentId:\s*mintTiInstanceId\(\),\s*photo:\s*photoFile\s*\|\|\s*null\s*\}\)/,
    );
  });

  it('renders an optional file input with image/* + capture environment', () => {
    expect(webformSrc).toMatch(/type="file"[\s\S]{0,200}?accept="image\/\*"/);
    expect(webformSrc).toMatch(/capture="environment"/);
  });

  it('clears photoFile in resetForm (and on Remove)', () => {
    expect(webformSrc).toMatch(/setPhotoFile\(null\)/);
  });
});

describe('AdminTasksView photo wiring (one-time only)', () => {
  it('imports uploadTaskRequestPhoto + getRequestPhotoSignedUrl from tasksAdminApi.js', () => {
    expect(adminViewSrc).toMatch(
      /import\s*\{[^}]*\buploadTaskRequestPhoto\b[^}]*\}\s*from\s*'\.\.\/lib\/tasksAdminApi\.js'/,
    );
    expect(adminViewSrc).toMatch(
      /import\s*\{[^}]*\bgetRequestPhotoSignedUrl\b[^}]*\}\s*from\s*'\.\.\/lib\/tasksAdminApi\.js'/,
    );
  });

  it('emptyTaskForm declares photoFile: null', () => {
    expect(adminViewSrc).toMatch(/function emptyTaskForm\(\)\s*\{[\s\S]*?photoFile:\s*null/);
  });

  it('photo input renders only when NOT recurring', () => {
    expect(adminViewSrc).toMatch(/\{!editForm\.recurring\s*&&\s*\([\s\S]{0,800}?Photo \(optional\)/);
  });

  it('the Repeat-this-task toggle clears photoFile when switched ON', () => {
    expect(adminViewSrc).toMatch(/photoFile:\s*recurring\s*\?\s*null\s*:\s*editForm\.photoFile/);
  });

  it('saveTask one-time branch awaits uploadTaskRequestPhoto BEFORE the row insert', () => {
    // Anchor on the saveTask function body so we don't false-match the
    // modal JSX's photo input. The branch sequence: photoFile present
    // -> upload -> include request_photo_path in the INSERT payload.
    const fnMatch = adminViewSrc.match(/async function saveTask\(\)\s*\{[\s\S]*?\n {2}\}\s*\n/);
    expect(fnMatch, 'expected saveTask function body').not.toBeNull();
    const body = fnMatch[0];
    expect(body).toMatch(/uploadTaskRequestPhoto\(sb,\s*editForm\.oneTimeInstanceId,\s*editForm\.photoFile\)/);
    expect(body).toMatch(/createOneTimeTaskInstance/);
    // upload call appears before createOneTimeTaskInstance
    const uploadIdx = body.search(/uploadTaskRequestPhoto/);
    const insertIdx = body.search(/createOneTimeTaskInstance/);
    expect(uploadIdx).toBeGreaterThan(-1);
    expect(insertIdx).toBeGreaterThan(uploadIdx);
  });

  it('one-time INSERT payload carries request_photo_path', () => {
    expect(adminViewSrc).toMatch(/request_photo_path:\s*requestPhotoDbPath/);
  });

  it('Open Tasks list renders lazy 📎 Photo link when ti.request_photo_path is set', () => {
    expect(adminViewSrc).toMatch(/data-task-photo-link=\{ti\.id\}/);
    expect(adminViewSrc).toMatch(/openRequestPhoto\(ti\.request_photo_path\)/);
    expect(adminViewSrc).toMatch(/getRequestPhotoSignedUrl/);
  });
});

describe('tasksAdminApi photo helpers', () => {
  it('uploadTaskRequestPhoto compresses + uploads to the bucket and returns the dbPath', () => {
    expect(adminApiSrc).toMatch(/export async function uploadTaskRequestPhoto\(sb,\s*instanceId,\s*blobOrFile\)/);
    expect(adminApiSrc).toMatch(/compressImage\(blobOrFile\)/);
    expect(adminApiSrc).toMatch(/sb\.storage[\s\S]{0,200}?\.upload\(storagePath/);
    expect(adminApiSrc).toMatch(/return buildTaskRequestPhotoDbPath/);
  });

  it('uploadTaskRequestPhoto is retry-safe: uses upsert:true so a re-Save reuses the same path', () => {
    // Codex C3.1b review: the admin holds a stable oneTimeInstanceId
    // across Save retries. If the photo upload succeeds but the
    // createOneTimeTaskInstance call fails, the admin's second Save
    // re-uploads to the SAME deterministic path. upsert:false would
    // cause a "Duplicate" error and block the admin. upsert:true
    // makes the storage call idempotent for the same bytes/path.
    const fnMatch = adminApiSrc.match(/export async function uploadTaskRequestPhoto\([\s\S]*?\n\}\s*\n/);
    expect(fnMatch, 'expected uploadTaskRequestPhoto function body').not.toBeNull();
    expect(fnMatch[0]).toMatch(/upsert:\s*true/);
    expect(fnMatch[0]).not.toMatch(/upsert:\s*false/);
  });

  it('getRequestPhotoSignedUrl strips the bucket prefix + calls createSignedUrl', () => {
    expect(adminApiSrc).toMatch(/export async function getRequestPhotoSignedUrl\(sb,\s*dbPath/);
    expect(adminApiSrc).toMatch(/stripTaskRequestPhotoBucket\(dbPath\)/);
    expect(adminApiSrc).toMatch(/createSignedUrl\(storagePath/);
  });
});

describe('tasks.js path-shape constants exist (pure)', () => {
  it('exports the bucket name + filename + path helpers', () => {
    expect(tasksSrc).toMatch(/export const TASK_REQUEST_PHOTOS_BUCKET\s*=\s*'task-request-photos'/);
    expect(tasksSrc).toMatch(/export const TASK_REQUEST_PHOTO_DEFAULT_FILENAME\s*=\s*'photo-1\.jpg'/);
    expect(tasksSrc).toMatch(/export function buildTaskRequestPhotoStoragePath/);
    expect(tasksSrc).toMatch(/export function buildTaskRequestPhotoDbPath/);
    expect(tasksSrc).toMatch(/export function stripTaskRequestPhotoBucket/);
  });
});

// Exercise the same import path the source uses so a broken import surfaces here.
void rpcSrc;
