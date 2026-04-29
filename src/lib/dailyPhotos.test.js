import {describe, it, expect, vi, beforeEach} from 'vitest';

import {
  DAILY_BUCKET,
  MAX_PHOTOS_PER_REPORT,
  buildPhotoPath,
  formatPhotoForRow,
  isValidFormKind,
  uploadDailyPhoto,
  uploadDailyPhotosSequential,
  _VALID_FORM_KINDS,
} from './dailyPhotos.js';

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
