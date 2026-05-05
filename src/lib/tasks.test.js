import {describe, it, expect} from 'vitest';
import {
  RECURRENCE_OPTIONS,
  isOpenTaskInstance,
  TASKS_PUBLIC_ASSIGNEE_AVAILABILITY_KEY,
  normalizePublicAssigneeAvailability,
  isPublicAssigneeHidden,
  setPublicAssigneeHidden,
  visiblePublicAssignees,
  TASK_REQUEST_PHOTOS_BUCKET,
  TASK_REQUEST_PHOTO_DEFAULT_FILENAME,
  buildTaskRequestPhotoStoragePath,
  buildTaskRequestPhotoDbPath,
  stripTaskRequestPhotoBucket,
  TASK_PHOTOS_BUCKET,
  TASK_COMPLETION_PHOTO_DEFAULT_FILENAME,
  buildCompletionPhotoStoragePath,
  buildCompletionPhotoDbPath,
  stripCompletionPhotoBucket,
  isStorageDuplicateError,
} from './tasks.js';

// Pure helpers — see ./tasks.js. Tests stay equally pure.

describe('RECURRENCE_OPTIONS', () => {
  it('lists exactly the recurrence values mig 039 allows', () => {
    // Mig 036 declared ('once','daily','weekly','biweekly','monthly');
    // mig 039 added 'quarterly'. Order matters for the admin dropdown — keep
    // 'once' first so it's the safest default for new templates.
    expect(RECURRENCE_OPTIONS).toEqual(['once', 'daily', 'weekly', 'biweekly', 'monthly', 'quarterly']);
  });

  it('is frozen-in-spirit (no duplicates, no empty strings)', () => {
    expect(new Set(RECURRENCE_OPTIONS).size).toBe(RECURRENCE_OPTIONS.length);
    expect(RECURRENCE_OPTIONS.every((s) => typeof s === 'string' && s.length > 0)).toBe(true);
  });
});

describe('isOpenTaskInstance', () => {
  it('accepts status="open"', () => {
    expect(isOpenTaskInstance({status: 'open'})).toBe(true);
  });

  it('rejects completed/missed/null/undefined/non-objects', () => {
    expect(isOpenTaskInstance({status: 'completed'})).toBe(false);
    expect(isOpenTaskInstance({status: 'missed'})).toBe(false);
    expect(isOpenTaskInstance({})).toBe(false);
    expect(isOpenTaskInstance(null)).toBe(false);
    expect(isOpenTaskInstance(undefined)).toBe(false);
  });
});

describe('public assignee availability helpers', () => {
  it('exposes the canonical webform_config key name', () => {
    expect(TASKS_PUBLIC_ASSIGNEE_AVAILABILITY_KEY).toBe('tasks_public_assignee_availability');
  });

  it('normalizePublicAssigneeAvailability collapses garbage to {hiddenProfileIds: []}', () => {
    expect(normalizePublicAssigneeAvailability(null)).toEqual({hiddenProfileIds: []});
    expect(normalizePublicAssigneeAvailability(undefined)).toEqual({hiddenProfileIds: []});
    expect(normalizePublicAssigneeAvailability('garbage')).toEqual({hiddenProfileIds: []});
    expect(normalizePublicAssigneeAvailability([])).toEqual({hiddenProfileIds: []});
    expect(normalizePublicAssigneeAvailability({})).toEqual({hiddenProfileIds: []});
  });

  it('normalizePublicAssigneeAvailability filters non-strings and dedupes', () => {
    const out = normalizePublicAssigneeAvailability({
      hiddenProfileIds: ['uuid-a', null, 'uuid-a', '', 'uuid-b', 42],
    });
    expect(out.hiddenProfileIds.sort()).toEqual(['uuid-a', 'uuid-b']);
  });

  it('isPublicAssigneeHidden returns true only when id is in the list', () => {
    const av = {hiddenProfileIds: ['uuid-a', 'uuid-b']};
    expect(isPublicAssigneeHidden('uuid-a', av)).toBe(true);
    expect(isPublicAssigneeHidden('uuid-c', av)).toBe(false);
    expect(isPublicAssigneeHidden('', av)).toBe(false);
  });

  it('setPublicAssigneeHidden hides + unhides idempotently', () => {
    let av = {hiddenProfileIds: []};
    av = setPublicAssigneeHidden(av, 'uuid-a', true);
    expect(av.hiddenProfileIds).toEqual(['uuid-a']);
    av = setPublicAssigneeHidden(av, 'uuid-a', true); // re-hide
    expect(av.hiddenProfileIds).toEqual(['uuid-a']);
    av = setPublicAssigneeHidden(av, 'uuid-a', false);
    expect(av.hiddenProfileIds).toEqual([]);
  });

  it('setPublicAssigneeHidden throws on missing profileId', () => {
    expect(() => setPublicAssigneeHidden({hiddenProfileIds: []}, '', true)).toThrow();
  });

  it('visiblePublicAssignees applies the filter and returns a copy', () => {
    const profiles = [
      {id: 'uuid-a', full_name: 'ALICE'},
      {id: 'uuid-b', full_name: 'BOB'},
      {id: 'uuid-c', full_name: 'CARL'},
    ];
    const av = {hiddenProfileIds: ['uuid-b']};
    const out = visiblePublicAssignees(profiles, av);
    expect(out.map((p) => p.id)).toEqual(['uuid-a', 'uuid-c']);
    // Empty / missing availability returns full list copy.
    expect(visiblePublicAssignees(profiles, null).map((p) => p.id)).toEqual(['uuid-a', 'uuid-b', 'uuid-c']);
  });

  it('visiblePublicAssignees tolerates orphan ids in hiddenProfileIds', () => {
    const profiles = [{id: 'uuid-a', full_name: 'ALICE'}];
    const out = visiblePublicAssignees(profiles, {hiddenProfileIds: ['uuid-orphan']});
    expect(out.map((p) => p.id)).toEqual(['uuid-a']);
  });
});

describe('task request photo path helpers (C3.1b)', () => {
  it('exposes the canonical bucket name + default filename', () => {
    expect(TASK_REQUEST_PHOTOS_BUCKET).toBe('task-request-photos');
    expect(TASK_REQUEST_PHOTO_DEFAULT_FILENAME).toBe('photo-1.jpg');
  });

  it('buildTaskRequestPhotoStoragePath returns <instanceId>/<filename>', () => {
    expect(buildTaskRequestPhotoStoragePath('ti-abc', 'photo-1.jpg')).toBe('ti-abc/photo-1.jpg');
  });

  it('buildTaskRequestPhotoStoragePath defaults filename when omitted', () => {
    expect(buildTaskRequestPhotoStoragePath('ti-abc')).toBe('ti-abc/photo-1.jpg');
  });

  it('buildTaskRequestPhotoDbPath returns task-request-photos/<instanceId>/<filename>', () => {
    expect(buildTaskRequestPhotoDbPath('ti-abc', 'photo-1.jpg')).toBe('task-request-photos/ti-abc/photo-1.jpg');
  });

  it('buildTaskRequestPhotoStoragePath throws on missing instanceId', () => {
    expect(() => buildTaskRequestPhotoStoragePath('', 'photo-1.jpg')).toThrow();
    expect(() => buildTaskRequestPhotoStoragePath(null, 'photo-1.jpg')).toThrow();
  });

  it('stripTaskRequestPhotoBucket round-trips with build*DbPath', () => {
    const dbPath = buildTaskRequestPhotoDbPath('ti-abc', 'photo-1.jpg');
    expect(stripTaskRequestPhotoBucket(dbPath)).toBe('ti-abc/photo-1.jpg');
  });

  it('stripTaskRequestPhotoBucket returns null for missing or wrong-bucket paths', () => {
    expect(stripTaskRequestPhotoBucket(null)).toBeNull();
    expect(stripTaskRequestPhotoBucket('')).toBeNull();
    expect(stripTaskRequestPhotoBucket('task-photos/ti-abc/photo-1.jpg')).toBeNull(); // wrong bucket
    expect(stripTaskRequestPhotoBucket('ti-abc/photo-1.jpg')).toBeNull(); // no prefix
  });
});

describe('task completion photo path helpers (C2)', () => {
  it('exposes the canonical bucket name + default filename', () => {
    expect(TASK_PHOTOS_BUCKET).toBe('task-photos');
    expect(TASK_COMPLETION_PHOTO_DEFAULT_FILENAME).toBe('completion-1.jpg');
  });

  it('buildCompletionPhotoStoragePath returns <assigneeUid>/<instanceId>/<filename>', () => {
    expect(buildCompletionPhotoStoragePath('uid-1', 'ti-abc', 'completion-1.jpg')).toBe(
      'uid-1/ti-abc/completion-1.jpg',
    );
  });

  it('buildCompletionPhotoStoragePath defaults the filename when omitted', () => {
    expect(buildCompletionPhotoStoragePath('uid-1', 'ti-abc')).toBe('uid-1/ti-abc/completion-1.jpg');
  });

  it('buildCompletionPhotoDbPath returns task-photos/<assigneeUid>/<instanceId>/<filename>', () => {
    expect(buildCompletionPhotoDbPath('uid-1', 'ti-abc', 'completion-1.jpg')).toBe(
      'task-photos/uid-1/ti-abc/completion-1.jpg',
    );
  });

  it('throws on missing assigneeUid or instanceId', () => {
    expect(() => buildCompletionPhotoStoragePath('', 'ti-abc')).toThrow();
    expect(() => buildCompletionPhotoStoragePath('uid-1', '')).toThrow();
    expect(() => buildCompletionPhotoStoragePath(null, 'ti-abc')).toThrow();
  });

  it('stripCompletionPhotoBucket round-trips with build*DbPath', () => {
    const dbPath = buildCompletionPhotoDbPath('uid-1', 'ti-abc', 'completion-1.jpg');
    expect(stripCompletionPhotoBucket(dbPath)).toBe('uid-1/ti-abc/completion-1.jpg');
  });

  it('stripCompletionPhotoBucket returns null for missing or wrong-bucket paths', () => {
    expect(stripCompletionPhotoBucket(null)).toBeNull();
    expect(stripCompletionPhotoBucket('')).toBeNull();
    expect(stripCompletionPhotoBucket('task-request-photos/uid-1/ti-abc/photo.jpg')).toBeNull(); // wrong bucket
    expect(stripCompletionPhotoBucket('uid-1/ti-abc/photo.jpg')).toBeNull(); // no prefix
  });
});

describe('isStorageDuplicateError (Codex C2 — duplicate-as-success contract)', () => {
  it('matches statusCode 409 (string and number)', () => {
    expect(isStorageDuplicateError({statusCode: '409'})).toBe(true);
    expect(isStorageDuplicateError({statusCode: 409})).toBe(true);
  });

  it("matches error: 'Duplicate' (case-insensitive)", () => {
    expect(isStorageDuplicateError({error: 'Duplicate'})).toBe(true);
    expect(isStorageDuplicateError({error: 'duplicate'})).toBe(true);
  });

  it("matches name: 'Duplicate' (case-insensitive)", () => {
    expect(isStorageDuplicateError({name: 'Duplicate'})).toBe(true);
  });

  it("matches message containing 'already exists' (case-insensitive)", () => {
    expect(isStorageDuplicateError({message: 'The resource already exists'})).toBe(true);
    expect(isStorageDuplicateError({message: 'object Already Exists in bucket'})).toBe(true);
  });

  it('rejects null, undefined, generic errors, and non-duplicate codes', () => {
    expect(isStorageDuplicateError(null)).toBe(false);
    expect(isStorageDuplicateError(undefined)).toBe(false);
    expect(isStorageDuplicateError({})).toBe(false);
    expect(isStorageDuplicateError({statusCode: '500'})).toBe(false);
    expect(isStorageDuplicateError({statusCode: 403})).toBe(false);
    expect(isStorageDuplicateError({error: 'NotFound'})).toBe(false);
    expect(isStorageDuplicateError({message: 'Unauthorized'})).toBe(false);
  });
});
