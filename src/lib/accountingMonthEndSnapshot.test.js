import {describe, expect, it} from 'vitest';
import {
  accountingMonthEndISO,
  accountingSnapshotMaxMonth,
  accountingSnapshotMinMonth,
  accountingSnapshotMonthEndISO,
  accountingSnapshotRows,
  animalGroupAsOfMonthEnd,
  currentAccountingMonth,
  formatAccountingMonthEnd,
  isPastAccountingSnapshotMonth,
  shiftAccountingMonth,
} from './accountingMonthEndSnapshot.js';

const cattleConfig = {
  groupField: 'herd',
  transferEntityIdField: 'cattle_id',
  transferFromField: 'from_herd',
  activeGroups: ['mommas', 'backgrounders', 'finishers', 'bulls'],
};

describe('accounting month-end helpers', () => {
  it('builds stable month values and month-end labels', () => {
    const todayMs = Date.UTC(2026, 5, 24, 12);
    expect(currentAccountingMonth(todayMs)).toBe('2026-06');
    expect(accountingSnapshotMinMonth(todayMs)).toBe('2025-06');
    expect(accountingSnapshotMaxMonth(todayMs)).toBe('2026-05');
    expect(shiftAccountingMonth('2026-01', -1)).toBe('2025-12');
    expect(accountingMonthEndISO('2026-02')).toBe('2026-02-28');
    expect(accountingSnapshotMonthEndISO('2026-05', todayMs)).toBe('2026-05-31');
    expect(accountingSnapshotMonthEndISO('2026-06', todayMs)).toBe(null);
    expect(isPastAccountingSnapshotMonth('2026-07', todayMs)).toBe(false);
    expect(formatAccountingMonthEnd('2026-06')).toBe('June 30, 2026');
  });

  it('rewinds current outcome animals through transfer history for prior month-end basis', () => {
    const cow = {
      id: 'cow-sold-after-may',
      tag: '42',
      herd: 'sold',
      purchase_date: '2024-01-15',
      sale_date: '2026-06-10',
    };
    const transfers = [
      {
        cattle_id: cow.id,
        from_herd: 'finishers',
        to_herd: 'sold',
        transferred_at: '2026-06-10T14:00:00Z',
      },
      {
        cattle_id: cow.id,
        from_herd: 'backgrounders',
        to_herd: 'finishers',
        transferred_at: '2026-04-01T14:00:00Z',
      },
    ];

    const rows = accountingSnapshotRows([cow], transfers, cattleConfig, '2026-05', Date.UTC(2026, 5, 24, 12));
    expect(rows).toHaveLength(1);
    expect(rows[0].herd).toBe('finishers');
    expect(rows[0]._accountingSnapshotOriginalGroup).toBe('sold');
    expect(rows[0]._accountingSnapshotEndDate).toBe('2026-05-31');
  });

  it('counts transfers on the month-end evening in farm-local Central time', () => {
    const cow = {
      id: 'cow-moved-late-month-end',
      tag: '55',
      herd: 'finishers',
      purchase_date: '2026-01-01',
    };
    const transfers = [
      {
        cattle_id: cow.id,
        from_herd: 'backgrounders',
        to_herd: 'finishers',
        transferred_at: '2026-06-01T02:00:00Z', // May 31, 2026 at 9:00 PM CDT.
      },
    ];

    const mayRows = accountingSnapshotRows([cow], transfers, cattleConfig, '2026-05', Date.UTC(2026, 5, 24, 12));
    const aprilRows = accountingSnapshotRows([cow], transfers, cattleConfig, '2026-04', Date.UTC(2026, 5, 24, 12));

    expect(mayRows).toHaveLength(1);
    expect(mayRows[0].herd).toBe('finishers');
    expect(aprilRows).toHaveLength(1);
    expect(aprilRows[0].herd).toBe('backgrounders');
  });

  it('excludes animals not yet on farm by the selected month end', () => {
    const cow = {
      id: 'cow-not-purchased-yet',
      tag: '77',
      herd: 'mommas',
      birth_date: '2020-01-01',
      purchase_date: '2026-07-01',
      created_at: '2026-07-01T12:00:00Z',
    };

    const todayMs = Date.UTC(2026, 8, 15, 12);
    expect(accountingSnapshotRows([cow], [], cattleConfig, '2026-06', todayMs)).toEqual([]);
    expect(accountingSnapshotRows([cow], [], cattleConfig, '2026-07', todayMs)).toHaveLength(1);
  });

  it('does not build snapshots for the current month or future months', () => {
    const cow = {
      id: 'cow-current-active',
      tag: '100',
      herd: 'mommas',
      birth_date: '2024-03-01',
      created_at: '2024-03-01T12:00:00Z',
    };
    const todayMs = Date.UTC(2026, 5, 24, 12);

    expect(accountingSnapshotMonthEndISO('2026-06', todayMs)).toBe(null);
    expect(accountingSnapshotMonthEndISO('2028-01', todayMs)).toBe(null);
    expect(accountingSnapshotRows([cow], [], cattleConfig, '2026-06', todayMs)).toEqual([cow]);
    expect(accountingSnapshotRows([cow], [], cattleConfig, '2028-01', todayMs)[0]._accountingSnapshotEndDate).toBe(
      undefined,
    );
  });

  it('returns the current group when the snapshot month is invalid', () => {
    const transfersByAnimal = new Map();
    expect(animalGroupAsOfMonthEnd({id: 'x', herd: 'bulls'}, transfersByAnimal, cattleConfig, 'not-a-month')).toBe(
      'bulls',
    );
  });
});
