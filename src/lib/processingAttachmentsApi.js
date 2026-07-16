// ============================================================================
// src/lib/processingAttachmentsApi.js — Processing attachment client owner
// ----------------------------------------------------------------------------
// The ONLY client owner for the private 'processing-attachments' Storage bucket
// (mig 163 SELECT policy + mig 166 native INSERT policy). Two responsibilities:
//
//   • Signed READ (open/download): getProcessingAttachmentUrl mints a
//     short-lived signed URL for any attachment row's storage_path — imported
//     Asana bytes ('<gid>/…') and native uploads ('native/<record id>/…') both
//     read through the operational SELECT policy.
//   • Native UPLOAD ("Add files" / drag-and-drop): uploadProcessingAttachment
//     puts the bytes under 'native/<record id>/<uuid>-<safe filename>'
//     (append-only, upsert:false) and registers the metadata row via the
//     add_processing_attachment RPC (caller provenance, no Asana gid, Activity
//     emitted server-side). Images are NOT recompressed — processing documents
//     (invoices, kill sheets, spreadsheets) must arrive byte-exact.
//   • ADMIN DELETE (mig 185, native AND Asana-imported files): a two-phase,
//     retry-safe contract. deleteProcessingAttachment runs
//       request_processing_attachment_delete  → stamps the pending request and
//                                               returns the exact bucket/path;
//       storage.remove([path])                → allowed only by the narrow
//                                               admin+requested-delete policy;
//       finalize_processing_attachment_delete → truthful terminal outcome:
//         ok=true  tombstones the row (gid kept so imports can't resurrect it)
//                  and scrubs the path from linked comment attachments;
//         ok=false REOPENS the attachment and records the failure — a blocked
//         or failed Storage removal is NEVER reported as deleted.
//     storage.remove silently skips objects RLS won't delete (empty result,
//     no error), so an empty result is verified via a signed-URL existence
//     probe before success/failure is decided — this also makes a crashed
//     earlier attempt (object already gone) converge to success on retry.
// ============================================================================
import {newProcessingId} from './processingApi.js';

export const PROCESSING_ATTACHMENT_BUCKET = 'processing-attachments';
export const MAX_PROCESSING_ATTACHMENT_BYTES = 50 * 1024 * 1024; // matches the RPC cap

// Signed URL for one attachment row's storage_path (default 10 minutes).
// Returns null on failure — the drawer shows a retry-able error instead of a
// dead link.
export async function getProcessingAttachmentUrl(sb, storagePath, expiresIn = 600) {
  if (!storagePath) return null;
  const {data, error} = await sb.storage.from(PROCESSING_ATTACHMENT_BUCKET).createSignedUrl(storagePath, expiresIn);
  if (error) return null;
  return data?.signedUrl || null;
}

// Keep the original filename readable in the object key but strip path
// separators / control characters that would break the key or the policy match.
export function safeAttachmentFilename(name) {
  const base = String(name || 'file')
    .replace(/[/\\]/g, '_')
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .trim();
  return (base || 'file').slice(0, 120);
}

// Upload one native file for a record, then register its metadata row.
// Returns the RPC result ({id, replayed}). Throws with a user-presentable
// message on validation/upload failure.
export async function uploadProcessingAttachment(sb, {recordId, file} = {}) {
  if (!recordId) throw new Error('uploadProcessingAttachment: recordId required');
  if (!file) throw new Error('uploadProcessingAttachment: file required');
  if (file.size > MAX_PROCESSING_ATTACHMENT_BYTES) {
    throw new Error(`File too large: ${Math.round(file.size / 1024 / 1024)}MB (max 50MB)`);
  }
  const id = newProcessingId('pat');
  const filename = safeAttachmentFilename(file.name);
  const contentType = file.type || 'application/octet-stream';
  const storagePath = `native/${recordId}/${id}-${filename}`;

  const {error: upErr} = await sb.storage
    .from(PROCESSING_ATTACHMENT_BUCKET)
    .upload(storagePath, file, {upsert: false, contentType});
  // The path embeds a fresh uuid, so a duplicate-object error can only be this
  // same upload retrying — treat it as success and proceed to registration.
  if (upErr && !/duplicate|23505|409/i.test(upErr.message || '')) {
    throw new Error(`uploadProcessingAttachment: ${upErr.message ?? 'upload failed'}`);
  }

  const {data, error} = await sb.rpc('add_processing_attachment', {
    p_row: {
      id,
      record_id: recordId,
      filename,
      content_type: contentType,
      size_bytes: file.size,
      storage_path: storagePath,
    },
  });
  if (error) throw new Error(`uploadProcessingAttachment: ${error.message || String(error)}`);
  return data;
}

// Existence probe for the delete flow: storage.remove() silently skips objects
// the RLS policy won't let this session delete (empty result, NO error), so an
// empty removal alone can't distinguish "blocked" from "already gone". A
// signed-URL mint answers that: not-found → the object is gone; a working URL →
// the object survived. Returns true (gone) / false (still there) / null
// (indeterminate — e.g. a transient network failure).
async function processingAttachmentObjectGone(sb, storagePath) {
  const {data, error} = await sb.storage.from(PROCESSING_ATTACHMENT_BUCKET).createSignedUrl(storagePath, 60);
  if (error) return /not[ _-]?found|does not exist|404/i.test(error.message || '') ? true : null;
  return data?.signedUrl ? false : null;
}

// Two-phase admin delete for one attachment row (native or Asana-imported).
// Returns the finalize result on success ({status:'deleted'|'already_deleted'}).
// Throws with a user-presentable message on ANY failure — after truthfully
// finalizing the failed outcome server-side, so a blocked Storage removal is
// never left half-claimed. Safe to retry end-to-end.
export async function deleteProcessingAttachment(sb, {attachmentId} = {}) {
  if (!attachmentId) throw new Error('deleteProcessingAttachment: attachmentId required');

  // Phase 1 — request: lock/validate, stamp delete_requested_*, get the path.
  const {data: req, error: reqErr} = await sb.rpc('request_processing_attachment_delete', {p_id: attachmentId});
  if (reqErr) throw new Error(`deleteProcessingAttachment: ${reqErr.message || String(reqErr)}`);
  if (req?.status === 'already_deleted') return req; // idempotent replay
  const storagePath = req?.storage_path;
  if (!storagePath) throw new Error('deleteProcessingAttachment: delete request returned no storage path');

  // Phase 2 — the admin session removes the object through the narrow policy.
  let removed = false;
  let failReason = null;
  try {
    const {data: rm, error: rmErr} = await sb.storage.from(PROCESSING_ATTACHMENT_BUCKET).remove([storagePath]);
    if (rmErr) failReason = rmErr.message || 'storage delete failed';
    else if (Array.isArray(rm) && rm.length > 0) removed = true;
  } catch (e) {
    failReason = (e && e.message) || 'storage delete failed';
  }
  if (!removed) {
    // Empty/failed removal: verify before deciding — a crashed earlier attempt
    // (object already gone) must converge to success, a blocked one must not.
    const gone = await processingAttachmentObjectGone(sb, storagePath);
    if (gone === true) removed = true;
    else if (!failReason) failReason = 'storage removal was blocked or the object could not be verified as deleted';
  }

  // Phase 3 — finalize truthfully (both outcomes recorded server-side).
  const {data: fin, error: finErr} = await sb.rpc('finalize_processing_attachment_delete', {
    p_id: attachmentId,
    p_ok: removed,
    p_error: removed ? null : failReason,
  });
  if (finErr) throw new Error(`deleteProcessingAttachment: ${finErr.message || String(finErr)}`);
  if (!removed) throw new Error(`Could not delete this attachment: ${failReason}. Please retry.`);
  return fin;
}
