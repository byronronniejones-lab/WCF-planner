import {describe, it, expect} from 'vitest';
import {
  buildNewsletterStoragePath,
  buildNewsletterIssuePath,
  buildNewsletterPreviewPath,
  formatYearMonth,
  currentYearMonth,
  friendlyNewsletterError,
  isNewsletterValidationError,
  NEWSLETTER_STAGING_BUCKET,
  NEWSLETTER_PUBLIC_BUCKET,
  unapproveNewsletterPhoto,
  removeNewsletterPhoto,
  runNewsletterHarvest,
  listNewsletterRunsAdmin,
  updateNewsletterSettings,
} from './newsletterApi.js';

// Minimal fake Supabase client for the storage-cleanup paths. `removeError`
// drives what storage.remove() reports; `rpcResult` drives the RPC result.
function fakeSb({removeError = null, rpcResult = {data: {ok: true}, error: null}} = {}) {
  const removeCalls = [];
  return {
    removeCalls,
    rpc: async () => rpcResult,
    storage: {
      from: (bucket) => ({
        remove: async (paths) => {
          removeCalls.push({bucket, paths});
          return {data: removeError ? null : [{name: paths[0]}], error: removeError};
        },
      }),
    },
  };
}

const PHOTO = {id: 'nlp-1', storagePath: 'newsletter/nli-2026-06/c.jpg'};

describe('newsletter storage paths', () => {
  it('builds issue-scoped relative paths with a safe extension', () => {
    expect(buildNewsletterStoragePath('nli-2026-06', 'abc')).toBe('newsletter/nli-2026-06/abc.jpg');
    expect(buildNewsletterStoragePath('nli-2026-06', 'abc', 'PNG')).toBe('newsletter/nli-2026-06/abc.png');
    // Reject odd extensions back to jpg (never a traversal/odd segment).
    expect(buildNewsletterStoragePath('nli-2026-06', 'abc', '../../etc')).toBe('newsletter/nli-2026-06/abc.jpg');
  });

  it('staging and public buckets are the two newsletter buckets', () => {
    expect(NEWSLETTER_STAGING_BUCKET).toBe('newsletter-staging');
    expect(NEWSLETTER_PUBLIC_BUCKET).toBe('newsletter-public');
  });
});

describe('newsletter public paths', () => {
  it('builds issue + preview URLs and encodes the slug/token', () => {
    expect(buildNewsletterIssuePath('2026-06')).toBe('/newsletter/2026-06');
    expect(buildNewsletterPreviewPath('2026-06', 't ok/en')).toBe('/newsletter/2026-06?preview=t%20ok%2Fen');
  });
});

describe('formatYearMonth', () => {
  it('renders a human month label without Date drift', () => {
    expect(formatYearMonth('2026-06')).toBe('June 2026');
    expect(formatYearMonth('2026-01')).toBe('January 2026');
    expect(formatYearMonth('2026-12')).toBe('December 2026');
  });
  it('passes through non YYYY-MM strings', () => {
    expect(formatYearMonth('latest')).toBe('latest');
    expect(formatYearMonth('2026-13')).toBe('2026-13');
    expect(formatYearMonth('')).toBe('');
  });
});

describe('currentYearMonth', () => {
  it('zero-pads the month', () => {
    expect(currentYearMonth(new Date(2026, 0, 15))).toBe('2026-01');
    expect(currentYearMonth(new Date(2026, 8, 1))).toBe('2026-09');
  });
});

describe('newsletter error helpers', () => {
  it('detects + unwraps NEWSLETTER_VALIDATION messages', () => {
    const err = new Error('NEWSLETTER_VALIDATION: max 12 photos per issue');
    expect(isNewsletterValidationError(err)).toBe(true);
    expect(friendlyNewsletterError(err)).toBe('max 12 photos per issue');
  });
  it('strips a leading wrapper prefix from other errors', () => {
    expect(friendlyNewsletterError(new Error('registerNewsletterPhoto: boom'))).toBe('boom');
    expect(isNewsletterValidationError(new Error('network'))).toBe(false);
  });
});

describe('checked public/staging photo deletion', () => {
  it('unapprove throws when the public-bucket delete reports a real error', async () => {
    await expect(
      unapproveNewsletterPhoto(fakeSb({removeError: {message: 'permission denied'}}), PHOTO),
    ).rejects.toThrow(/permission denied/);
  });

  it('unapprove resolves (and deletes from the public bucket) when remove succeeds', async () => {
    const sb = fakeSb();
    await expect(unapproveNewsletterPhoto(sb, PHOTO)).resolves.toEqual({ok: true});
    expect(sb.removeCalls).toEqual([{bucket: NEWSLETTER_PUBLIC_BUCKET, paths: [PHOTO.storagePath]}]);
  });

  it('remove throws (before the row RPC) when public-byte cleanup fails — admin can retry', async () => {
    const sb = fakeSb({removeError: {message: 'network'}});
    await expect(removeNewsletterPhoto(sb, PHOTO)).rejects.toThrow(/network/);
    // Failed on the first (public) remove; never reached the staging remove.
    expect(sb.removeCalls).toEqual([{bucket: NEWSLETTER_PUBLIC_BUCKET, paths: [PHOTO.storagePath]}]);
  });

  it('remove deletes public then staging bytes before dropping the row', async () => {
    const sb = fakeSb();
    await expect(removeNewsletterPhoto(sb, PHOTO)).resolves.toEqual({ok: true});
    expect(sb.removeCalls).toEqual([
      {bucket: NEWSLETTER_PUBLIC_BUCKET, paths: [PHOTO.storagePath]},
      {bucket: NEWSLETTER_STAGING_BUCKET, paths: [PHOTO.storagePath]},
    ]);
  });
});

describe('updateNewsletterSettings — partial updates + clear/preserve semantics', () => {
  function captureSb() {
    const calls = [];
    return {
      calls,
      rpc: async (name, params) => {
        calls.push({name, params});
        return {data: {ok: true}, error: null};
      },
    };
  }

  it('sends a partial update: only provided fields are set; omitted fields map to null (preserve)', async () => {
    const sb = captureSb();
    await updateNewsletterSettings(sb, {tonePreset: 'celebratory'});
    expect(sb.calls[0].name).toBe('update_newsletter_settings');
    const p = sb.calls[0].params;
    expect(p.p_tone_preset).toBe('celebratory');
    // Every field the Steer UI did not touch preserves (null), so a partial save
    // never clobbers settings edited elsewhere.
    expect(p.p_tone).toBeNull();
    expect(p.p_voice_example).toBeNull();
    expect(p.p_length_detail).toBeNull();
    expect(p.p_photo_min).toBeNull();
    expect(p.p_ai_provider).toBeNull();
  });

  it('passes an explicit empty string through for tone + voiceExample (clear to NULL)', async () => {
    const sb = captureSb();
    await updateNewsletterSettings(sb, {tone: '', voiceExample: ''});
    const p = sb.calls[0].params;
    expect(p.p_tone).toBe('');
    expect(p.p_voice_example).toBe('');
  });

  it('sends the writing example when provided', async () => {
    const sb = captureSb();
    await updateNewsletterSettings(sb, {voiceExample: 'plain and proud, like a farmer talking to neighbors'});
    expect(sb.calls[0].params.p_voice_example).toBe('plain and proud, like a farmer talking to neighbors');
  });
});

describe('automation wrappers (mig 146 + Edge Function)', () => {
  it('runNewsletterHarvest invokes the function in admin mode with the requested steps', async () => {
    const calls = [];
    const sb = {
      functions: {
        invoke: async (name, opts) => {
          calls.push({name, opts});
          return {data: {ok: true, harvest: {factCount: 3}}, error: null};
        },
      },
    };
    const res = await runNewsletterHarvest(sb, {issueId: 'nli-2026-05', steps: ['harvest']});
    expect(res).toEqual({ok: true, harvest: {factCount: 3}});
    expect(calls[0]).toEqual({
      name: 'newsletter-harvest',
      opts: {body: {mode: 'admin', issueId: 'nli-2026-05', steps: ['harvest'], overwrite: true, revisionNotes: ''}},
    });
  });

  it('runNewsletterHarvest surfaces an Edge error body', async () => {
    const sb = {
      functions: {
        invoke: async () => ({
          data: null,
          error: {message: 'Edge Function returned a non-2xx', context: {json: async () => ({error: 'boom'})}},
        }),
      },
    };
    await expect(runNewsletterHarvest(sb, {issueId: 'x'})).rejects.toThrow(/boom/);
  });

  it('runNewsletterHarvest treats an {ok:false} body as a failure', async () => {
    const sb = {functions: {invoke: async () => ({data: {ok: false, error: 'no assignee'}, error: null})}};
    await expect(runNewsletterHarvest(sb, {issueId: 'x'})).rejects.toThrow(/no assignee/);
  });

  it('listNewsletterRunsAdmin returns an array (defensive on null)', async () => {
    expect(await listNewsletterRunsAdmin({rpc: async () => ({data: null, error: null})}, 'i')).toEqual([]);
    const rows = [{id: 'nlr-1', runType: 'harvest', status: 'ok'}];
    expect(await listNewsletterRunsAdmin({rpc: async () => ({data: rows, error: null})}, 'i')).toEqual(rows);
  });
});
