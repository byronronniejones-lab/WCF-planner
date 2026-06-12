import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {describe, expect, it} from 'vitest';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..', '..');

const mutations = fs.readFileSync(path.join(ROOT, 'src/lib/tasksCenterMutationsApi.js'), 'utf8');
const newTaskModal = fs.readFileSync(path.join(ROOT, 'src/tasks/NewTaskModal.jsx'), 'utf8');
const completeTaskModal = fs.readFileSync(path.join(ROOT, 'src/tasks/CompleteTaskModal.jsx'), 'utf8');
const migration114 = fs.readFileSync(path.join(ROOT, 'supabase-migrations/114_task_photo_total_limit.sql'), 'utf8');

describe('tasks use the shared 5-photo total cap', () => {
  it('centralizes the task photo limit in the mutation helper', () => {
    expect(mutations).toMatch(/export const MAX_TASK_PHOTOS_PER_TASK\s*=\s*5/);
    expect(mutations).toMatch(/export function remainingTaskPhotoSlots/);
    expect(mutations).toMatch(/export function assertTaskPhotoLimit/);
    expect(mutations).toMatch(/max \$\{MAX_TASK_PHOTOS_PER_TASK\} photos per task/);
  });

  it('NewTaskModal uses the shared photo limit instead of a local 5', () => {
    expect(newTaskModal).toMatch(/MAX_TASK_PHOTOS_PER_TASK/);
    expect(newTaskModal).not.toMatch(/slice\(0,\s*5\)/);
    expect(newTaskModal).not.toMatch(/photos\.length\s*>=\s*5/);
  });

  it('CompleteTaskModal counts existing photos before allowing completion photos', () => {
    expect(completeTaskModal).toMatch(/loadTaskInstancePhotos/);
    expect(completeTaskModal).toMatch(/remainingTaskPhotoSlots\(existingPhotoCount\)/);
    expect(completeTaskModal).toMatch(/uploadTaskCompletionPhotos\([\s\S]*?\{\s*existingPhotoCount[\s,]*\}/);
    expect(completeTaskModal).not.toMatch(/slice\(0,\s*5\)/);
    expect(completeTaskModal).not.toMatch(/photos\.length\s*>=\s*5/);
  });

  it('migration 114 enforces max 5 total task photos at the table layer', () => {
    expect(migration114).toMatch(/_enforce_task_instance_photos_max_5_total/);
    expect(migration114).toMatch(/task_instance_photos: max 5 photos per task/);
    expect(migration114).toMatch(/pg_advisory_xact_lock/);
    expect(migration114).toMatch(/BEFORE INSERT OR UPDATE OF instance_id, kind, sort_order/);
    expect(migration114).toMatch(/NOTIFY pgrst, 'reload schema'/);
  });
});
