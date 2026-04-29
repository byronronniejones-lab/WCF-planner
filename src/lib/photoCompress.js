// Browser-side image compression for the offline queue. Land the API
// surface in Phase 1B so Phase 1C / Phase 2 can wire photo capture without
// reshuffling the queue contract. FuelSupply (the canary) has no photos —
// this module is dormant until the next phase.
//
// Compression target locked in PROJECT.md §8 Initiative C v1 plan capture:
//   max-edge 1024px, JPEG quality 0.7, ~80KB target.
//
// Why a thin wrapper now: the canvas + Image roundtrip is awkward in
// jsdom — vitest covers signature + error paths only here. Real bytes-in
// / bytes-out behavior is verified in Phase 2 Playwright when an actual
// browser canvas is in scope.

const DEFAULTS = Object.freeze({
  maxEdge: 1024,
  quality: 0.7,
  // targetBytes is advisory; quality is the hard knob. We expose it so a
  // future caller can iterate quality down if a single pass blows past
  // the target — keep the API stable for that.
  targetBytes: 80_000,
  mimeType: 'image/jpeg',
});

export const PHOTO_COMPRESS_DEFAULTS = DEFAULTS;

function isBlobLike(v) {
  return v != null && typeof v === 'object' && typeof v.size === 'number' && typeof v.type === 'string';
}

/**
 * Compress an image blob into a smaller JPEG blob.
 *
 * @param {Blob | File} blob — source image (any browser-decodable format).
 * @param {object} [opts]
 * @param {number} [opts.maxEdge=1024] — longest-edge px cap.
 * @param {number} [opts.quality=0.7] — JPEG quality 0..1.
 * @param {string} [opts.mimeType='image/jpeg'] — output MIME.
 * @returns {Promise<Blob>}
 */
export async function compressImage(blob, opts = {}) {
  if (!isBlobLike(blob)) {
    throw new TypeError('compressImage: first argument must be a Blob or File');
  }
  const {maxEdge, quality, mimeType} = {...DEFAULTS, ...opts};
  if (!(quality > 0 && quality <= 1)) {
    throw new RangeError('compressImage: quality must be in (0, 1]');
  }
  if (!(maxEdge > 0)) {
    throw new RangeError('compressImage: maxEdge must be > 0');
  }

  // Decode → resize via canvas → re-encode. Browser-only path; jsdom
  // doesn't ship canvas/Image so unit tests stub at the call boundary.
  const bitmap = await loadBitmap(blob);
  try {
    const {width, height} = fitWithin(bitmap.width, bitmap.height, maxEdge);
    const canvas = makeCanvas(width, height);
    const ctx = canvas.getContext('2d');
    ctx.drawImage(bitmap, 0, 0, width, height);
    return await canvasToBlob(canvas, mimeType, quality);
  } finally {
    if (typeof bitmap.close === 'function') bitmap.close();
  }
}

function fitWithin(w, h, maxEdge) {
  if (w <= maxEdge && h <= maxEdge) return {width: w, height: h};
  const scale = w >= h ? maxEdge / w : maxEdge / h;
  return {width: Math.round(w * scale), height: Math.round(h * scale)};
}

async function loadBitmap(blob) {
  // Prefer createImageBitmap (faster, off-thread on supporting browsers).
  if (typeof globalThis.createImageBitmap === 'function') {
    return await globalThis.createImageBitmap(blob);
  }
  // Fallback via Image + object URL.
  const url = URL.createObjectURL(blob);
  try {
    const img = await new Promise((resolve, reject) => {
      const i = new Image();
      i.onload = () => resolve(i);
      i.onerror = () => reject(new Error('compressImage: image decode failed'));
      i.src = url;
    });
    return img;
  } finally {
    URL.revokeObjectURL(url);
  }
}

function makeCanvas(w, h) {
  if (typeof OffscreenCanvas === 'function') return new OffscreenCanvas(w, h);
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
}

async function canvasToBlob(canvas, mime, quality) {
  // OffscreenCanvas exposes convertToBlob; HTMLCanvasElement uses toBlob.
  if (typeof canvas.convertToBlob === 'function') {
    return await canvas.convertToBlob({type: mime, quality});
  }
  return await new Promise((resolve, reject) => {
    canvas.toBlob(
      (b) => (b ? resolve(b) : reject(new Error('compressImage: canvas.toBlob returned null'))),
      mime,
      quality,
    );
  });
}
