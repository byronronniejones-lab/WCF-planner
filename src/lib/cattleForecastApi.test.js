import {describe, it, expect, vi} from 'vitest';
import {markBatchComplete} from './cattleForecastApi.js';

// Tiny Supabase-shaped mock that captures the update payload and returns
// {error: null}. Mirrors how the cattle module uses sb.from(...).update(...).eq(...).
function makeSb() {
  const calls = [];
  const sb = {
    from(table) {
      return {
        update(payload) {
          return {
            async eq(col, val) {
              calls.push({table, payload, col, val});
              return {error: null};
            },
          };
        },
      };
    },
  };
  return {sb, calls};
}

describe('markBatchComplete — hotfix for missing actual_process_date', () => {
  it('writes status=complete and the caller-supplied processedDate', async () => {
    const {sb, calls} = makeSb();
    await markBatchComplete(sb, 'b1', {processedDate: '2026-04-23'});
    expect(calls).toHaveLength(1);
    expect(calls[0].table).toBe('cattle_processing_batches');
    expect(calls[0].payload).toEqual({status: 'complete', actual_process_date: '2026-04-23'});
    expect(calls[0].col).toBe('id');
    expect(calls[0].val).toBe('b1');
  });

  it('defaults actual_process_date to today (Central) when no processedDate is supplied', async () => {
    const {sb, calls} = makeSb();
    await markBatchComplete(sb, 'b2');
    expect(calls[0].payload.status).toBe('complete');
    // Central date can lag/lead UTC slice by one day around midnight, but
    // must always be a YYYY-MM-DD string — never null.
    expect(calls[0].payload.actual_process_date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('defaults actual_process_date when processedDate is null', async () => {
    const {sb, calls} = makeSb();
    await markBatchComplete(sb, 'b3', {processedDate: null});
    expect(calls[0].payload.actual_process_date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('throws when Supabase returns an error', async () => {
    const sb = {
      from() {
        return {
          update() {
            return {
              async eq() {
                return {error: {message: 'boom'}};
              },
            };
          },
        };
      },
    };
    await expect(markBatchComplete(sb, 'b4', {processedDate: '2026-04-23'})).rejects.toThrow(/markBatchComplete: boom/);
  });
});

// Sanity check that the module exports the helper. Catches accidental
// rename/remove during refactors.
describe('cattleForecastApi exports', () => {
  it('exposes markBatchComplete', () => {
    expect(typeof markBatchComplete).toBe('function');
  });
});

// Silence stray timer noise if Vitest fakes clocks elsewhere.
vi.useRealTimers();
