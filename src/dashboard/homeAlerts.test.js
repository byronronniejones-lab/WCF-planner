import {describe, expect, it} from 'vitest';
import {buildMissedDailyReports} from './homeAlerts.js';

describe('buildMissedDailyReports - pig feeder targets', () => {
  it('does not flag active feeder sub-batches with ledger-derived current 0', () => {
    const rows = buildMissedDailyReports({
      today: new Date('2026-06-22T12:00:00'),
      feederGroups: [
        {
          id: 'p2602',
          batchName: 'P-26-02',
          status: 'active',
          processingTrips: [{id: 'trip-boars', pigCount: 13, subAttributions: [{subId: 'boars', count: 13}]}],
          subBatches: [
            {id: 'gilts', name: 'P-26-02A (GILTS)', status: 'active', giltCount: 5, boarCount: 0},
            {id: 'boars', name: 'P-26-02B (BOARS)', status: 'active', giltCount: 0, boarCount: 13},
          ],
        },
      ],
      pigDailys: [],
      breeders: [],
      missedCleared: [],
    });

    expect(rows.some((row) => row.label === 'P-26-02B (BOARS)')).toBe(false);
    expect(rows.filter((row) => row.label === 'P-26-02A (GILTS)')).toHaveLength(7);
  });
});
