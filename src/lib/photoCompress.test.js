import {describe, it, expect} from 'vitest';
import {compressImage, PHOTO_COMPRESS_DEFAULTS} from './photoCompress.js';

// Vitest covers API shape + error paths only. Real canvas + Image
// roundtrip is verified in Phase 2 Playwright (jsdom has no canvas).
describe('compressImage — API shape', () => {
  it('exports the locked defaults (1024 / 0.7 / 80KB / jpeg)', () => {
    expect(PHOTO_COMPRESS_DEFAULTS).toMatchObject({
      maxEdge: 1024,
      quality: 0.7,
      targetBytes: 80_000,
      mimeType: 'image/jpeg',
    });
  });

  it('rejects with TypeError when input is not a Blob/File', async () => {
    await expect(compressImage(null)).rejects.toBeInstanceOf(TypeError);
    await expect(compressImage(undefined)).rejects.toBeInstanceOf(TypeError);
    await expect(compressImage('not a blob')).rejects.toBeInstanceOf(TypeError);
    await expect(compressImage(123)).rejects.toBeInstanceOf(TypeError);
    await expect(compressImage({})).rejects.toBeInstanceOf(TypeError);
  });

  it('rejects with RangeError when quality is out of (0, 1]', async () => {
    const blob = new Blob([new Uint8Array([0xff])], {type: 'image/jpeg'});
    await expect(compressImage(blob, {quality: 0})).rejects.toBeInstanceOf(RangeError);
    await expect(compressImage(blob, {quality: -0.1})).rejects.toBeInstanceOf(RangeError);
    await expect(compressImage(blob, {quality: 1.5})).rejects.toBeInstanceOf(RangeError);
  });

  it('rejects with RangeError when maxEdge is non-positive', async () => {
    const blob = new Blob([new Uint8Array([0xff])], {type: 'image/jpeg'});
    await expect(compressImage(blob, {maxEdge: 0})).rejects.toBeInstanceOf(RangeError);
    await expect(compressImage(blob, {maxEdge: -10})).rejects.toBeInstanceOf(RangeError);
  });

  it('accepts File and Blob inputs without rejection at the type guard', async () => {
    const blob = new Blob([new Uint8Array([0xff])], {type: 'image/jpeg'});
    // The decode itself will fail in jsdom (no canvas), but it should fail
    // AFTER the type guard. We assert the guard does not reject.
    await expect(compressImage(blob)).rejects.not.toBeInstanceOf(TypeError);
    await expect(compressImage(blob)).rejects.not.toBeInstanceOf(RangeError);
  });
});
