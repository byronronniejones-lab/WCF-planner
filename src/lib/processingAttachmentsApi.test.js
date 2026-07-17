import {describe, it, expect, vi} from 'vitest';
import {deleteProcessingAttachment, safeAttachmentFilename} from './processingAttachmentsApi.js';

// Mock Supabase client for the two-phase delete contract. `plan` keys:
//   request  — result of request_processing_attachment_delete
//   remove   — result of storage.remove
//   signed   — result of createSignedUrl (the empty-remove existence probe)
//   finalize — result of finalize_processing_attachment_delete
function mockSb(plan) {
  const calls = {rpc: [], remove: [], signed: []};
  return {
    calls,
    rpc: vi.fn(async (fn, args) => {
      calls.rpc.push([fn, args]);
      if (fn === 'request_processing_attachment_delete') return plan.request;
      if (fn === 'finalize_processing_attachment_delete')
        return plan.finalize ?? {data: {status: 'deleted'}, error: null};
      return {data: null, error: {message: `unexpected rpc ${fn}`}};
    }),
    storage: {
      from: () => ({
        remove: vi.fn(async (paths) => {
          calls.remove.push(paths);
          return plan.remove;
        }),
        createSignedUrl: vi.fn(async (p) => {
          calls.signed.push(p);
          return plan.signed ?? {data: null, error: {message: 'Object not found'}};
        }),
      }),
    },
  };
}

const REQ_OK = {data: {id: 'pat-1', status: 'requested', storage_path: 'native/rec-1/pat-1-a.pdf'}, error: null};

describe('deleteProcessingAttachment — two-phase truthful delete', () => {
  it('happy path: request → remove → finalize(ok=true)', async () => {
    const sb = mockSb({
      request: REQ_OK,
      remove: {data: [{name: 'native/rec-1/pat-1-a.pdf'}], error: null},
      finalize: {data: {id: 'pat-1', status: 'deleted'}, error: null},
    });
    const out = await deleteProcessingAttachment(sb, {attachmentId: 'pat-1'});
    expect(out.status).toBe('deleted');
    const finalize = sb.calls.rpc.find(([fn]) => fn === 'finalize_processing_attachment_delete');
    expect(finalize[1]).toMatchObject({p_id: 'pat-1', p_ok: true, p_error: null});
  });

  it('already-deleted replay short-circuits without touching Storage', async () => {
    const sb = mockSb({request: {data: {id: 'pat-1', status: 'already_deleted', replayed: true}, error: null}});
    const out = await deleteProcessingAttachment(sb, {attachmentId: 'pat-1'});
    expect(out.status).toBe('already_deleted');
    expect(sb.calls.remove).toHaveLength(0);
    expect(sb.calls.rpc.map(([fn]) => fn)).toEqual(['request_processing_attachment_delete']);
  });

  it('BLOCKED removal (empty result, object still readable) finalizes ok=false and throws', async () => {
    const sb = mockSb({
      request: REQ_OK,
      remove: {data: [], error: null}, // RLS silently skipped the object
      signed: {data: {signedUrl: 'https://x/signed'}, error: null}, // still there
      finalize: {data: {id: 'pat-1', status: 'reopened'}, error: null},
    });
    await expect(deleteProcessingAttachment(sb, {attachmentId: 'pat-1'})).rejects.toThrow(/Could not delete/);
    const finalize = sb.calls.rpc.find(([fn]) => fn === 'finalize_processing_attachment_delete');
    expect(finalize[1].p_ok).toBe(false);
    expect(finalize[1].p_error).toBeTruthy();
  });

  it('crashed earlier attempt (object already gone) converges to success on retry', async () => {
    const sb = mockSb({
      request: REQ_OK,
      remove: {data: [], error: null},
      signed: {data: null, error: {message: 'Object not found'}}, // gone
      finalize: {data: {id: 'pat-1', status: 'deleted'}, error: null},
    });
    const out = await deleteProcessingAttachment(sb, {attachmentId: 'pat-1'});
    expect(out.status).toBe('deleted');
    const finalize = sb.calls.rpc.find(([fn]) => fn === 'finalize_processing_attachment_delete');
    expect(finalize[1].p_ok).toBe(true);
  });

  it('storage error finalizes ok=false with the reason and throws', async () => {
    const sb = mockSb({
      request: REQ_OK,
      remove: {data: null, error: {message: 'network boom'}},
      signed: {data: {signedUrl: 'https://x/still-there'}, error: null},
      finalize: {data: {id: 'pat-1', status: 'reopened'}, error: null},
    });
    await expect(deleteProcessingAttachment(sb, {attachmentId: 'pat-1'})).rejects.toThrow(/network boom/);
    const finalize = sb.calls.rpc.find(([fn]) => fn === 'finalize_processing_attachment_delete');
    expect(finalize[1]).toMatchObject({p_ok: false, p_error: 'network boom'});
  });

  it('request RPC failure throws before any Storage call', async () => {
    const sb = mockSb({
      request: {data: null, error: {message: 'PROCESSING_VALIDATION: caller role farm_team cannot delete attachments'}},
    });
    await expect(deleteProcessingAttachment(sb, {attachmentId: 'pat-1'})).rejects.toThrow(/cannot delete attachments/);
    expect(sb.calls.remove).toHaveLength(0);
  });

  it('requires attachmentId', async () => {
    await expect(deleteProcessingAttachment(mockSb({}), {})).rejects.toThrow(/attachmentId required/);
  });
});

describe('safeAttachmentFilename (regression)', () => {
  it('strips path separators and control chars, caps length', () => {
    expect(safeAttachmentFilename('a/b\\c.pdf')).toBe('a_b_c.pdf');
    expect(safeAttachmentFilename('')).toBe('file');
    expect(safeAttachmentFilename('x'.repeat(200))).toHaveLength(120);
  });
});
