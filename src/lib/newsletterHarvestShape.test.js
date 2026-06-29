import {describe, it, expect} from 'vitest';
import {
  bornAlive,
  shapeHeadCounts,
  shapeBirths,
  shapeEggDailys,
  shapePastureMoves,
  shapeDailySubmissions,
  shapeCompletedTasks,
  shapeProcessingBatches,
  coverageEntry,
} from './newsletterHarvestShape.js';

describe('bornAlive — the mortality boundary', () => {
  it('subtracts deaths and never goes negative', () => {
    expect(bornAlive(3, 1)).toBe(2);
    expect(bornAlive(2, 2)).toBe(0);
    expect(bornAlive(5, 9)).toBe(0); // never negative
    expect(bornAlive(4, undefined)).toBe(4);
    expect(bornAlive(undefined, undefined)).toBe(0);
  });
});

describe('shapeBirths — born-alive only', () => {
  it('drops records with no surviving young and subtracts deaths', () => {
    const rows = [
      {calving_date: '2026-05-10', total_born: 3, deaths: 1, dam_tag: 'C12'},
      {calving_date: '2026-05-12', total_born: 2, deaths: 2, dam_tag: 'C44'}, // all lost → dropped
      {calving_date: '2026-05-20', total_born: 1, deaths: 0, dam_tag: 'C70'},
    ];
    const out = shapeBirths(rows, {dateField: 'calving_date'});
    expect(out).toEqual([
      {date: '2026-05-10', count: 2, dam: 'C12'},
      {date: '2026-05-20', count: 1, dam: 'C70'},
    ]);
  });
});

describe('shapeHeadCounts — group by herd/flock', () => {
  it('tallies one head per row into [{name, headCount}]', () => {
    const rows = [{herd: 'mommas'}, {herd: 'mommas'}, {herd: 'bulls'}];
    expect(shapeHeadCounts(rows, 'herd')).toEqual([
      {name: 'mommas', headCount: 2},
      {name: 'bulls', headCount: 1},
    ]);
  });
});

describe('shapeEggDailys — sum the group columns', () => {
  it('adds group1..4_count (treating null as 0)', () => {
    const out = shapeEggDailys([
      {date: '2026-05-01', group1_count: 10, group2_count: 5, group3_count: 0, group4_count: null},
    ]);
    expect(out).toEqual([{date: '2026-05-01', eggs: 15}]);
  });
});

describe('shapePastureMoves — drop orphaned destinations', () => {
  it('keeps moves with a destination and slices the timestamp to a day', () => {
    const out = shapePastureMoves([
      {
        moved_at: '2026-05-03T10:00:00Z',
        animal_type: 'cattle_herd',
        group_label: 'Mommas',
        animal_count: 40,
        to_land_area_id: 'a1',
      },
      {moved_at: '2026-05-04T09:00:00Z', to_land_area_id: null}, // orphaned → dropped
    ]);
    expect(out).toEqual([
      {date: '2026-05-03', animalType: 'cattle_herd', groupLabel: 'Mommas', count: 40, toAreaId: 'a1'},
    ]);
  });
});

describe('shapeDailySubmissions + shapeCompletedTasks + shapeProcessingBatches', () => {
  it('reshapes daily submissions', () => {
    expect(shapeDailySubmissions([{date: '2026-05-01', program: 'pig', team_member: 'Sam'}])).toEqual([
      {date: '2026-05-01', program: 'pig', teamMember: 'Sam'},
    ]);
  });
  it('reshapes completed tasks with the recurring flag', () => {
    expect(
      shapeCompletedTasks([
        {
          completed_at: '2026-05-09T12:00:00Z',
          title: 'Barn roof',
          designation: 'standard',
          from_recurring_template: false,
          submission_source: 'admin_manual',
        },
      ]),
    ).toEqual([
      {
        date: '2026-05-09',
        title: 'Barn roof',
        designation: 'standard',
        fromRecurring: false,
        submissionSource: 'admin_manual',
      },
    ]);
  });
  it('reshapes processing batches without finance fields', () => {
    expect(
      shapeProcessingBatches([{name: 'B1', actual_process_date: '2026-05-15', total_hanging_weight: 1200}]),
    ).toEqual([{date: '2026-05-15', name: 'B1', hangingWeightLbs: 1200}]);
  });
});

describe('coverageEntry — honest per-source status', () => {
  it('classifies scanned / empty / unavailable / error', () => {
    expect(coverageEntry('cattle', 'Cattle', {available: true, rowCount: 5})).toMatchObject({
      status: 'scanned',
      count: 5,
    });
    expect(coverageEntry('cattle', 'Cattle', {available: true, rowCount: 0})).toMatchObject({
      status: 'empty',
      count: 0,
    });
    expect(coverageEntry('broiler', 'Broilers', {available: false})).toMatchObject({status: 'unavailable'});
    expect(coverageEntry('eggs', 'Eggs', {error: 'boom'})).toMatchObject({status: 'error', detail: 'boom'});
  });
});
