// Daily-report photo upload helpers.
//
// One source-of-truth for path scheme + metadata shape across every daily
// form (cattle, sheep, pig, poultry/broiler, layer). Egg dailys excluded —
// migration 030 deliberately omitted egg_dailys.photos. Add Feed deferred
// until the parent-submission/RPC design lands.
//
// Path scheme (locked in PROJECT.md §8 Initiative C v1 plan):
//
//   <form_kind>/<client_submission_id>/<photo_key>.jpg
//
// e.g.  cattle_dailys/csid-abc-123/photo-1.jpg
//
// Metadata shape (mirrors equipment_fuelings.photos from migration 018):
//
//   {path, name, mime, size_bytes, captured_at}
//
// Path-only — never publicUrl. The daily-photos bucket is private; admin
// reads via signed URLs (10-min expiry, mirroring fuel-bills bucket
// pattern from migration 026).

import {compressImage} from './photoCompress.js';

export const DAILY_BUCKET = 'daily-photos';
export const MAX_PHOTOS_PER_REPORT = 10;

const VALID_FORM_KINDS = Object.freeze([
  'cattle_dailys',
  'sheep_dailys',
  'pig_dailys',
  'poultry_dailys',
  'layer_dailys',
]);

export function isValidFormKind(formKind) {
  return VALID_FORM_KINDS.includes(formKind);
}

export function buildPhotoPath(formKind, csid, photoKey) {
  if (!isValidFormKind(formKind)) {
    throw new Error(`buildPhotoPath: invalid formKind ${JSON.stringify(formKind)}`);
  }
  if (!csid || typeof csid !== 'string') {
    throw new Error('buildPhotoPath: csid required');
  }
  if (!photoKey || typeof photoKey !== 'string') {
    throw new Error('buildPhotoPath: photoKey required');
  }
  return `${formKind}/${csid}/${photoKey}.jpg`;
}

/**
 * Compress + upload a single daily-report photo.
 *
 * @param {object} sb — supabase client (anon for public webforms; auth
 *   would also work but isn't the design path).
 * @param {string} formKind — one of `cattle_dailys` / `sheep_dailys` / etc.
 * @param {string} csid — client_submission_id for the parent daily row.
 * @param {string} photoKey — stable per-photo key, e.g. 'photo-1'.
 * @param {File|Blob} file — original image; will be compressed before upload.
 * @returns {Promise<object>} canonical photo metadata for the row's
 *   `photos` jsonb column.
 */
export async function uploadDailyPhoto(sb, formKind, csid, photoKey, file) {
  if (!file) throw new Error('uploadDailyPhoto: file required');
  const compressed = await compressImage(file);
  const path = buildPhotoPath(formKind, csid, photoKey);
  const {error} = await sb.storage
    .from(DAILY_BUCKET)
    .upload(path, compressed, {upsert: false, contentType: 'image/jpeg'});
  if (error) {
    throw new Error(`uploadDailyPhoto: ${error.message ?? 'upload failed'}`);
  }
  return formatPhotoForRow({
    path,
    name: file.name || `${photoKey}.jpg`,
    mime: 'image/jpeg',
    size_bytes: compressed.size,
  });
}

/**
 * Build the canonical photo-metadata shape stored in `*_dailys.photos`.
 * Caller can hand-roll an entry too — this helper just locks the field
 * names + adds `captured_at`.
 */
export function formatPhotoForRow({path, name, mime, size_bytes}) {
  return {
    path,
    name: name ?? null,
    mime: mime ?? 'image/jpeg',
    size_bytes: size_bytes ?? null,
    captured_at: new Date().toISOString(),
  };
}

/**
 * Sequentially compress + upload every selected file. Aborts on the first
 * failure (per locked decision: no partial-photo row insert). Returns the
 * full list of metadata entries on success.
 *
 * Sequential, not parallel: keeps cellular bandwidth predictable, gives the
 * UI a clean per-file progress signal, and means a partial-success state
 * is impossible (the first failure stops the chain).
 */
export async function uploadDailyPhotosSequential(sb, formKind, csid, files, onPhotoUploaded) {
  if (files.length > MAX_PHOTOS_PER_REPORT) {
    throw new Error(`uploadDailyPhotosSequential: max ${MAX_PHOTOS_PER_REPORT} photos per submission`);
  }
  const results = [];
  for (let i = 0; i < files.length; i++) {
    const photoKey = `photo-${i + 1}`;
    const meta = await uploadDailyPhoto(sb, formKind, csid, photoKey, files[i]);
    results.push(meta);
    if (typeof onPhotoUploaded === 'function') onPhotoUploaded(i, meta);
  }
  return results;
}

export const _VALID_FORM_KINDS = VALID_FORM_KINDS;
