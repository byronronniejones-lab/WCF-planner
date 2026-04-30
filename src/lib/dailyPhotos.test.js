import {describe, it, expect, vi, beforeEach} from 'vitest';

import {
  DAILY_BUCKET,
  MAX_PHOTOS_PER_REPORT,
  buildPhotoPath,
  formatPhotoForRow,
  isValidFormKind,
  uploadDailyPhoto,
  uploadDailyPhotosSequential,
  preparePhotos,
  preparedToRowMeta,
  uploadPreparedPhoto,
  uploadPreparedPhotosSequential,
  StorageUploadError,
  _VALID_FORM_KINDS,
} from './dailyPhotos.js';

import * as compressMod from './photoCompress.js';

vi.mock('./photoCompress.js', () => ({
  compressImage: vi.fn(async (blob) => {
    // Return a "compressed" blob smaller than input — assertable size_bytes.
    return new Blob([new Uint8Array(50)], {type: 'image/jpeg'});
  }),
}));

describe('constants', () => {
  it('locks bucket id', () => {
    expect(DAILY_BUCKET).toBe('daily-photos');
  });

  it('locks per-submission cap at 10 (Ronnie product decision)', () => {
    expect(MAX_PHOTOS_PER_REPORT).toBe(10);
  });

  it('VALID_FORM_KINDS covers the 5 supported daily tables (no egg)', () => {
    expect(_VALID_FORM_KINDS).toEqual([
      'cattle_dailys',
      'sheep_dailys',
      'pig_dailys',
      'poultry_dailys',
      'layer_dailys',
    ]);
  });
});

describe('isValidFormKind', () => {
  it('accepts the 5 supported kinds', () => {
    for (const k of _VALID_FORM_KINDS) {
      expect(isValidFormKind(k)).toBe(true);
    }
  });

  it('rejects egg_dailys (excluded by mig 030)', () => {
    expect(isValidFormKind('egg_dailys')).toBe(false);
  });

  it('rejects unrelated kinds + bad input', () => {
    expect(isValidFormKind('fuel_supply')).toBe(false);
    expect(isValidFormKind('')).toBe(false);
    expect(isValidFormKind(undefined)).toBe(false);
    expect(isValidFormKind(null)).toBe(false);
  });
});

describe('buildPhotoPath', () => {
  it('builds the locked path scheme', () => {
    expect(buildPhotoPath('cattle_dailys', 'csid-abc', 'photo-1')).toBe('cattle_dailys/csid-abc/photo-1.jpg');
  });

  it('throws on invalid formKind', () => {
    expect(() => buildPhotoPath('egg_dailys', 'csid', 'photo-1')).toThrow(/invalid formKind/);
    expect(() => buildPhotoPath('bogus', 'csid', 'photo-1')).toThrow();
  });

  it('throws on missing csid or photoKey', () => {
    expect(() => buildPhotoPath('cattle_dailys', '', 'photo-1')).toThrow();
    expect(() => buildPhotoPath('cattle_dailys', 'csid', '')).toThrow();
  });
});

describe('formatPhotoForRow', () => {
  it('returns the canonical metadata shape', () => {
    const out = formatPhotoForRow({path: 'p', name: 'n', mime: 'image/jpeg', size_bytes: 100});
    expect(out).toMatchObject({path: 'p', name: 'n', mime: 'image/jpeg', size_bytes: 100});
    expect(typeof out.captured_at).toBe('string');
    expect(out.captured_at).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it('defaults mime to image/jpeg when missing', () => {
    expect(formatPhotoForRow({path: 'p'}).mime).toBe('image/jpeg');
  });

  it('defaults name + size_bytes to null when missing', () => {
    const out = formatPhotoForRow({path: 'p'});
    expect(out.name).toBeNull();
    expect(out.size_bytes).toBeNull();
  });
});

// ── uploadDailyPhoto / uploadDailyPhotosSequential — sb mocked ─────────────

function makeMockSb({uploadResult = {error: null}} = {}) {
  const uploads = [];
  return {
    storage: {
      from: (bucket) => ({
        upload: async (path, blob, opts) => {
          uploads.push({bucket, path, blob, opts});
          return uploadResult;
        },
      }),
    },
    _uploads: uploads,
  };
}

describe('uploadDailyPhoto', () => {
  beforeEach(() => {
    // Re-stub compressImage cleanly per test.
  });

  it('compresses + uploads to daily-photos with the locked path', async () => {
    const sb = makeMockSb();
    const file = new File([new Uint8Array(1000)], 'IMG_5567.HEIC', {type: 'image/heic'});
    const meta = await uploadDailyPhoto(sb, 'cattle_dailys', 'csid-xyz', 'photo-3', file);

    expect(sb._uploads).toHaveLength(1);
    expect(sb._uploads[0].bucket).toBe('daily-photos');
    expect(sb._uploads[0].path).toBe('cattle_dailys/csid-xyz/photo-3.jpg');
    expect(sb._uploads[0].opts).toMatchObject({upsert: false, contentType: 'image/jpeg'});

    expect(meta).toMatchObject({
      path: 'cattle_dailys/csid-xyz/photo-3.jpg',
      name: 'IMG_5567.HEIC',
      mime: 'image/jpeg',
      size_bytes: 50,
    });
    expect(typeof meta.captured_at).toBe('string');
  });

  it('throws on storage upload failure (caller aborts the submission)', async () => {
    const sb = makeMockSb({uploadResult: {error: {message: 'storage 403'}}});
    const file = new File([new Uint8Array(10)], 'a.jpg', {type: 'image/jpeg'});
    await expect(uploadDailyPhoto(sb, 'sheep_dailys', 'csid', 'photo-1', file)).rejects.toThrow(/storage 403/);
  });

  it('throws on missing file', async () => {
    const sb = makeMockSb();
    await expect(uploadDailyPhoto(sb, 'sheep_dailys', 'csid', 'photo-1', null)).rejects.toThrow(/file required/);
  });

  it('throws on invalid formKind (egg / bogus)', async () => {
    const sb = makeMockSb();
    const file = new File([new Uint8Array(10)], 'a.jpg', {type: 'image/jpeg'});
    await expect(uploadDailyPhoto(sb, 'egg_dailys', 'csid', 'photo-1', file)).rejects.toThrow();
  });
});

describe('uploadDailyPhotosSequential', () => {
  it('uploads in order, returns metadata array, calls onPhotoUploaded per file', async () => {
    const sb = makeMockSb();
    const files = [
      new File([new Uint8Array(10)], '1.jpg', {type: 'image/jpeg'}),
      new File([new Uint8Array(10)], '2.jpg', {type: 'image/jpeg'}),
      new File([new Uint8Array(10)], '3.jpg', {type: 'image/jpeg'}),
    ];
    const progress = [];
    const out = await uploadDailyPhotosSequential(sb, 'pig_dailys', 'csid-batch', files, (i, meta) =>
      progress.push({i, path: meta.path}),
    );
    expect(out).toHaveLength(3);
    expect(out.map((p) => p.path)).toEqual([
      'pig_dailys/csid-batch/photo-1.jpg',
      'pig_dailys/csid-batch/photo-2.jpg',
      'pig_dailys/csid-batch/photo-3.jpg',
    ]);
    expect(progress).toHaveLength(3);
    expect(progress[0]).toEqual({i: 0, path: 'pig_dailys/csid-batch/photo-1.jpg'});
  });

  it('rejects > MAX_PHOTOS_PER_REPORT (caller-side cap is also enforced in UI)', async () => {
    const sb = makeMockSb();
    const tooMany = Array.from(
      {length: MAX_PHOTOS_PER_REPORT + 1},
      (_, i) => new File([new Uint8Array(1)], `${i}.jpg`, {type: 'image/jpeg'}),
    );
    await expect(uploadDailyPhotosSequential(sb, 'cattle_dailys', 'csid', tooMany)).rejects.toThrow(/max 10 photos/);
  });

  it('aborts on the first failure (no partial-state on the row)', async () => {
    // Sequential upload with 3 files; second one fails at the storage layer.
    let count = 0;
    const sb = {
      storage: {
        from: () => ({
          upload: async () => {
            count++;
            if (count === 2) return {error: {message: 'transient 5xx'}};
            return {error: null};
          },
        }),
      },
    };
    const files = [
      new File([new Uint8Array(10)], '1.jpg', {type: 'image/jpeg'}),
      new File([new Uint8Array(10)], '2.jpg', {type: 'image/jpeg'}),
      new File([new Uint8Array(10)], '3.jpg', {type: 'image/jpeg'}),
    ];
    await expect(uploadDailyPhotosSequential(sb, 'sheep_dailys', 'csid', files)).rejects.toThrow(/transient 5xx/);
    // Only the first 2 attempts fired; the chain stopped before the 3rd.
    expect(count).toBe(2);
  });

  it('empty files array is a no-op', async () => {
    const sb = makeMockSb();
    const out = await uploadDailyPhotosSequential(sb, 'layer_dailys', 'csid', []);
    expect(out).toEqual([]);
    expect(sb._uploads).toEqual([]);
  });
});

// ============================================================================
// Phase 1D-A — preparePhotos + uploadPreparedPhoto + StorageUploadError
// ============================================================================

function makeFile(name = 'photo.jpg') {
  const f = new Blob([new Uint8Array(200)], {type: 'image/jpeg'});
  // Blob doesn't have .name; fake it via Object.defineProperty so it
  // reads as if the picker returned it.
  Object.defineProperty(f, 'name', {value: name, writable: false});
  return f;
}

describe('preparePhotos', () => {
  beforeEach(() => {
    compressMod.compressImage.mockClear();
  });

  it('compresses each file exactly once and returns deterministic shape', async () => {
    const files = [makeFile('a.jpg'), makeFile('b.jpg'), makeFile('c.jpg')];
    const prepared = await preparePhotos('pig_dailys', 'csid-1', files);
    expect(compressMod.compressImage).toHaveBeenCalledTimes(3);
    expect(prepared).toHaveLength(3);
    expect(prepared[0].photo_key).toBe('photo-1');
    expect(prepared[0].path).toBe('pig_dailys/csid-1/photo-1.jpg');
    expect(prepared[2].photo_key).toBe('photo-3');
    expect(prepared[2].path).toBe('pig_dailys/csid-1/photo-3.jpg');
    expect(prepared[0].mime).toBe('image/jpeg');
    expect(prepared[0].name).toBe('a.jpg');
    expect(prepared[0].blob).toBeInstanceOf(Blob);
  });

  it('stamps captured_at ONCE for the whole batch', async () => {
    const files = [makeFile(), makeFile(), makeFile()];
    const prepared = await preparePhotos('pig_dailys', 'csid-2', files);
    expect(prepared[0].captured_at).toBe(prepared[1].captured_at);
    expect(prepared[1].captured_at).toBe(prepared[2].captured_at);
  });

  it('enforces MAX_PHOTOS_PER_REPORT (Codex correction 10)', async () => {
    const files = Array.from({length: MAX_PHOTOS_PER_REPORT + 1}, () => makeFile());
    await expect(preparePhotos('pig_dailys', 'csid-3', files)).rejects.toThrow(/max 10 photos per submission/i);
    // No compression attempted on the over-limit batch.
    expect(compressMod.compressImage).not.toHaveBeenCalled();
  });

  it('rejects invalid formKind', async () => {
    await expect(preparePhotos('egg_dailys', 'csid', [makeFile()])).rejects.toThrow(/invalid formKind/);
  });

  it('rejects missing csid', async () => {
    await expect(preparePhotos('pig_dailys', '', [makeFile()])).rejects.toThrow(/csid required/);
  });
});

describe('preparedToRowMeta', () => {
  it('strips blob; preserves path/name/mime/size_bytes/captured_at', () => {
    const prepared = [
      {
        photo_key: 'photo-1',
        path: 'pig_dailys/x/photo-1.jpg',
        blob: new Blob(),
        mime: 'image/jpeg',
        size_bytes: 50,
        name: 'a.jpg',
        captured_at: '2026-04-30T12:00:00.000Z',
      },
    ];
    const meta = preparedToRowMeta(prepared);
    expect(meta).toEqual([
      {
        path: 'pig_dailys/x/photo-1.jpg',
        name: 'a.jpg',
        mime: 'image/jpeg',
        size_bytes: 50,
        captured_at: '2026-04-30T12:00:00.000Z',
      },
    ]);
    expect('blob' in meta[0]).toBe(false);
  });
});

describe('uploadPreparedPhoto', () => {
  beforeEach(() => {
    compressMod.compressImage.mockClear();
  });

  it('does NOT call compressImage (no recompression on upload)', async () => {
    const prepared = {
      photo_key: 'photo-1',
      path: 'pig_dailys/csid/photo-1.jpg',
      blob: new Blob([new Uint8Array(50)], {type: 'image/jpeg'}),
      mime: 'image/jpeg',
      size_bytes: 50,
      name: 'a.jpg',
      captured_at: '2026-04-30T12:00:00.000Z',
    };
    const sb = makeMockSb();
    await uploadPreparedPhoto(sb, prepared);
    expect(compressMod.compressImage).not.toHaveBeenCalled();
    expect(sb._uploads).toHaveLength(1);
    expect(sb._uploads[0].path).toBe('pig_dailys/csid/photo-1.jpg');
  });

  it('passes upsert option through to storage', async () => {
    const prepared = {
      photo_key: 'photo-1',
      path: 'pig_dailys/csid/photo-1.jpg',
      blob: new Blob(),
      mime: 'image/jpeg',
      size_bytes: 50,
      name: null,
      captured_at: '2026-04-30T12:00:00.000Z',
    };
    const sb = makeMockSb();
    await uploadPreparedPhoto(sb, prepared, {upsert: true});
    expect(sb._uploads[0].opts).toEqual({upsert: true, contentType: 'image/jpeg'});
  });

  it('throws StorageUploadError preserving status, code, path, photo_key', async () => {
    const prepared = {
      photo_key: 'photo-3',
      path: 'pig_dailys/csid/photo-3.jpg',
      blob: new Blob(),
      mime: 'image/jpeg',
      size_bytes: 50,
      name: 'c.jpg',
      captured_at: '2026-04-30T12:00:00.000Z',
    };
    const sb = {
      storage: {
        from() {
          return {
            upload: async () => ({error: {message: 'forbidden', statusCode: '403', error: 'Unauthorized'}}),
          };
        },
      },
    };
    let thrown;
    try {
      await uploadPreparedPhoto(sb, prepared);
    } catch (e) {
      thrown = e;
    }
    expect(thrown).toBeInstanceOf(StorageUploadError);
    expect(thrown.status).toBe(403);
    expect(thrown.code).toBe('Unauthorized');
    expect(thrown.path).toBe('pig_dailys/csid/photo-3.jpg');
    expect(thrown.photo_key).toBe('photo-3');
    expect(thrown.cause).toBeDefined();
  });
});

describe('uploadPreparedPhotosSequential', () => {
  beforeEach(() => {
    compressMod.compressImage.mockClear();
  });

  it('uploads in order and returns row-meta entries', async () => {
    const prepared = [
      {
        photo_key: 'photo-1',
        path: 'pig_dailys/csid/photo-1.jpg',
        blob: new Blob(),
        mime: 'image/jpeg',
        size_bytes: 50,
        name: 'a.jpg',
        captured_at: '2026-04-30T12:00:00.000Z',
      },
      {
        photo_key: 'photo-2',
        path: 'pig_dailys/csid/photo-2.jpg',
        blob: new Blob(),
        mime: 'image/jpeg',
        size_bytes: 50,
        name: 'b.jpg',
        captured_at: '2026-04-30T12:00:00.000Z',
      },
    ];
    const sb = makeMockSb();
    const meta = await uploadPreparedPhotosSequential(sb, prepared);
    expect(meta).toHaveLength(2);
    expect(meta[0].path).toBe('pig_dailys/csid/photo-1.jpg');
    expect(meta[1].path).toBe('pig_dailys/csid/photo-2.jpg');
    expect(sb._uploads.map((u) => u.path)).toEqual(['pig_dailys/csid/photo-1.jpg', 'pig_dailys/csid/photo-2.jpg']);
    // Locks the no-recompression contract end-to-end.
    expect(compressMod.compressImage).not.toHaveBeenCalled();
  });
});
