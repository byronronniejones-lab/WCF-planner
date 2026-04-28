import {describe, it, expect} from 'vitest';
import {computeIntervalStatus, computeDueIntervals, soonestDue} from './equipment.js';

// Tests for the load-bearing equipment math invariants documented in
// PROJECT.md §7. Tested through the public API only — snapToNearestMilestone
// and aggregateCompletionsByMilestone remain internal helpers per design.

describe('snap-to-nearest milestone', () => {
  const intervals = [{kind: 'service', hours_or_km: 500, tasks: []}];

  it('snaps forward when reading is closer to next milestone', () => {
    // 968 is 32 from 1000 vs 468 from 500 → snaps to 1000. Next due = 1500.
    // Regression: under old floor-math this was treated as a 468h-late
    // completion of the 500 milestone and immediately re-flagged at 1000h.
    const completions = [{kind: 'service', interval: 500, reading_at_completion: 968}];
    const [status] = computeIntervalStatus(intervals, completions, 1000);
    expect(status.last_satisfied_milestone).toBe(1000);
    expect(status.next_due).toBe(1500);
    expect(status.overdue).toBe(false);
  });

  it('snaps backward when reading is closer to previous milestone', () => {
    // 1100 is 100 from 1000 vs 400 from 1500 → snaps to 1000. Next due = 1500.
    const completions = [{kind: 'service', interval: 500, reading_at_completion: 1100}];
    const [status] = computeIntervalStatus(intervals, completions, 1100);
    expect(status.last_satisfied_milestone).toBe(1000);
    expect(status.next_due).toBe(1500);
  });

  it('tie-break favors previous milestone (treat as late completion of prior)', () => {
    // 750 is exactly midway between 500 and 1000 → snaps to 500.
    const completions = [{kind: 'service', interval: 500, reading_at_completion: 750}];
    const [status] = computeIntervalStatus(intervals, completions, 750);
    expect(status.last_satisfied_milestone).toBe(500);
    expect(status.next_due).toBe(1000);
  });
});

describe('divisor cascade uses parent RAW reading, not parent snap', () => {
  it('600hr completion at 1596 satisfies 50hr through 1600 (not 1800)', () => {
    // The 600hr completion at 1596 snaps to 1800 for the 600hr interval.
    // But the 50hr sub-interval does its OWN snap on the RAW reading 1596,
    // which is 1600 (4 away vs 46 away from 1550). So 50hr next due = 1650.
    // Regression: cascading the parent's snapped 1800 would set 50hr next
    // due to 1850 — falsely crediting the 50hr maintenance with milestones
    // (1700, 1750, 1800) it never actually did.
    const intervals = [
      {kind: 'service', hours_or_km: 50, tasks: []},
      {kind: 'service', hours_or_km: 600, tasks: []},
    ];
    const completions = [{kind: 'service', interval: 600, reading_at_completion: 1596}];
    const statuses = computeIntervalStatus(intervals, completions, 1596);
    const fifty = statuses.find((s) => s.hours_or_km === 50);
    const sixHundred = statuses.find((s) => s.hours_or_km === 600);
    expect(sixHundred.last_satisfied_milestone).toBe(1800);
    expect(fifty.last_satisfied_milestone).toBe(1600);
    expect(fifty.next_due).toBe(1650);
  });
});

describe('cumulative-partial union model', () => {
  const intervals = [
    {
      kind: 'service',
      hours_or_km: 500,
      tasks: [{id: 'oil'}, {id: 'filter'}],
    },
  ];

  it('two partials at the same snapped milestone whose items union covers all tasks → virtual full', () => {
    // 440 snaps to 500 (60 vs 440); 444 snaps to 500 (56 vs 444). Items
    // union = {oil, filter} covers both tasks. Milestone 500 satisfied.
    // Real-world scenario: 14/16 tasks done at 440h, parts arrive, missing
    // 2/16 done at 444h — together that completes the 500h milestone.
    const completions = [
      {kind: 'service', interval: 500, reading_at_completion: 440, items_completed: ['oil'], total_tasks: 2},
      {kind: 'service', interval: 500, reading_at_completion: 444, items_completed: ['filter'], total_tasks: 2},
    ];
    const [status] = computeIntervalStatus(intervals, completions, 500);
    expect(status.last_satisfied_milestone).toBe(500);
    expect(status.next_due).toBe(1000);
  });

  it('partial that does not cover all tasks leaves the milestone unsatisfied and exposes last_partial', () => {
    const completions = [
      {kind: 'service', interval: 500, reading_at_completion: 440, items_completed: ['oil'], total_tasks: 2},
    ];
    const [status] = computeIntervalStatus(intervals, completions, 500);
    expect(status.last_satisfied_milestone).toBeNull();
    expect(status.next_due).toBe(500);

    const due = computeDueIntervals(intervals, completions, 500);
    expect(due).toHaveLength(1);
    expect(due[0].last_partial).not.toBeNull();
    expect(due[0].last_partial.items_done).toBe(1);
    expect(due[0].last_partial.total).toBe(2);
    expect(due[0].last_partial.milestone).toBe(500);
  });
});

describe('until_due rounding (no float drift)', () => {
  it('rounds until_due to 1 decimal so 550 - 509.3 yields 40.7 not 40.69999999999999', () => {
    const intervals = [{kind: 'service', hours_or_km: 50, tasks: []}];
    const completions = [{kind: 'service', interval: 50, reading_at_completion: 500}];
    // 500 snaps to 500. Next due = 550. currentReading = 509.3.
    const [status] = computeIntervalStatus(intervals, completions, 509.3);
    expect(status.until_due).toBe(40.7);
  });
});

describe('boundaries', () => {
  it('empty intervals returns []', () => {
    expect(computeIntervalStatus([], [], 100)).toEqual([]);
    expect(computeDueIntervals([], [], 100)).toEqual([]);
  });

  it('no completions → first milestone is the next due, last_satisfied_milestone is null', () => {
    const intervals = [{kind: 'service', hours_or_km: 500, tasks: []}];
    const [status] = computeIntervalStatus(intervals, [], 200);
    expect(status.last_satisfied_milestone).toBeNull();
    expect(status.next_due).toBe(500);
    expect(status.overdue).toBe(false);
  });
});

describe('soonestDue', () => {
  it('returns overdue ahead of merely upcoming intervals', () => {
    // 50hr never done at currentReading=80 → overdue (next_due=50).
    // 100hr never done at currentReading=80 → upcoming (next_due=100, until_due=20 within 50-window).
    const intervals = [
      {kind: 'service', hours_or_km: 50, tasks: []},
      {kind: 'service', hours_or_km: 100, tasks: []},
    ];
    const result = soonestDue(intervals, [], 80);
    expect(result.hours_or_km).toBe(50);
  });

  it('falls back to upcoming within the 50-hour window when nothing is overdue', () => {
    const intervals = [{kind: 'service', hours_or_km: 100, tasks: []}];
    // currentReading=80, next_due=100, until_due=20 — within default 50 window.
    const result = soonestDue(intervals, [], 80);
    expect(result.hours_or_km).toBe(100);
  });

  it('returns null when nothing is overdue and nothing is within the upcoming window', () => {
    const intervals = [{kind: 'service', hours_or_km: 500, tasks: []}];
    // currentReading=10, next_due=500, until_due=490 — outside the 50-window.
    expect(soonestDue(intervals, [], 10)).toBeNull();
  });
});
