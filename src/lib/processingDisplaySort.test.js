import {describe, expect, it} from 'vitest';
import {sortProcessingRecordsForDisplay} from './processingDisplaySort.js';

function ids(rows) {
  return rows.map((r) => r.id);
}

describe('sortProcessingRecordsForDisplay', () => {
  it('orders every status together by processing_date', () => {
    const rows = [
      {id: 'planned-may', effective_status: 'planned', processing_date: '2026-05-28'},
      {
        id: 'complete-jan',
        effective_status: 'complete',
        completed_at: '2026-05-01T10:00:00Z',
        processing_date: '2026-01-08',
      },
      {id: 'in-process-apr', effective_status: 'in_process', processing_date: '2026-04-02'},
    ];
    expect(ids(sortProcessingRecordsForDisplay(rows))).toEqual(['complete-jan', 'in-process-apr', 'planned-may']);
  });

  it('sorts In Process by processing_date without a special status bucket', () => {
    const rows = [
      {id: 'newer', effective_status: 'in_process', processing_date: '2026-07-10'},
      {id: 'oldest', effective_status: 'in_process', processing_date: '2026-06-01'},
      {id: 'mid', effective_status: 'in_process', processing_date: '2026-06-15'},
    ];
    expect(ids(sortProcessingRecordsForDisplay(rows))).toEqual(['oldest', 'mid', 'newer']);
  });

  it('sorts Planned nearest date first (ascending)', () => {
    const rows = [
      {id: 'far', effective_status: 'planned', processing_date: '2026-12-20'},
      {id: 'near', effective_status: 'planned', processing_date: '2026-07-20'},
      {id: 'later', effective_status: 'planned', processing_date: '2026-09-05'},
    ];
    expect(ids(sortProcessingRecordsForDisplay(rows))).toEqual(['near', 'later', 'far']);
  });

  it('sorts Complete by processing_date instead of completed_at', () => {
    const rows = [
      {id: 'planned-dec', effective_status: 'planned', processing_date: '2026-12-22'},
      {
        id: 'complete-jan',
        effective_status: 'complete',
        completed_at: '2026-01-20T08:00:00Z',
        processing_date: '2026-01-08',
      },
      {id: 'planned-nov', effective_status: 'planned', processing_date: '2026-11-24'},
    ];
    expect(ids(sortProcessingRecordsForDisplay(rows))).toEqual(['complete-jan', 'planned-nov', 'planned-dec']);
  });

  it('sinks undated rows to the end of the full schedule', () => {
    const rows = [
      {id: 'i-undated', effective_status: 'in_process', processing_date: null},
      {id: 'i-dated', effective_status: 'in_process', processing_date: '2026-06-01'},
      {id: 'p-undated', effective_status: 'planned'},
      {id: 'p-dated', effective_status: 'planned', processing_date: '2026-08-01'},
    ];
    expect(ids(sortProcessingRecordsForDisplay(rows))).toEqual(['i-dated', 'p-dated', 'i-undated', 'p-undated']);
  });

  it('sinks undated Complete rows to the end', () => {
    const rows = [
      {id: 'no-date', effective_status: 'complete', completed_at: '2026-02-01T00:00:00Z', processing_date: null},
      {id: 'dated', effective_status: 'planned', processing_date: '2026-02-01'},
    ];
    expect(ids(sortProcessingRecordsForDisplay(rows))).toEqual(['dated', 'no-date']);
  });

  it('ignores unknown or missing effective_status and sorts by date', () => {
    const rows = [
      {id: 'weird', effective_status: 'not-a-status', processing_date: '2026-07-01'},
      {id: 'missing', processing_date: '2026-06-01'},
      {id: 'i', effective_status: 'in_process', processing_date: '2026-09-01'},
      {id: 'c', effective_status: 'complete', completed_at: '2026-01-01T00:00:00Z', processing_date: '2026-08-01'},
    ];
    expect(ids(sortProcessingRecordsForDisplay(rows))).toEqual(['missing', 'weird', 'c', 'i']);
  });

  it('returns a new array without mutating the input and keeps tie order stable', () => {
    const rows = [
      {id: 'a', effective_status: 'planned', processing_date: '2026-07-01'},
      {id: 'b', effective_status: 'planned', processing_date: '2026-07-01'},
    ];
    const input = rows.slice();
    const out = sortProcessingRecordsForDisplay(input);
    expect(out).not.toBe(input);
    expect(ids(input)).toEqual(['a', 'b']);
    expect(ids(out)).toEqual(['a', 'b']);
    expect(sortProcessingRecordsForDisplay(null)).toEqual([]);
  });
});
