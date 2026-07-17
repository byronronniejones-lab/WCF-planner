import {describe, it, expect} from 'vitest';
import {
  computeIntervalStatus,
  computeDueIntervals,
  projectServiceIntervals,
  soonestDue,
  latestSaneReading,
  currentReadingFromFuelings,
} from './equipment.js';

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

  // Fueling-checklist lane locks (2026-07-17): the exact three scenarios the
  // directly-expandable-intervals build contract names. Redundant with the
  // 968/1100/750 cases above by construction, but locked at these readings so
  // the contract's own numbers stay executable.
  it('500-hour service at 1,200 satisfies milestone 1,000; next due 1,500', () => {
    const completions = [{kind: 'service', interval: 500, reading_at_completion: 1200}];
    const [status] = computeIntervalStatus(intervals, completions, 1200);
    expect(status.last_satisfied_milestone).toBe(1000);
    expect(status.next_due).toBe(1500);
    expect(status.overdue).toBe(false);
  });

  it('500-hour service at 1,300 satisfies milestone 1,500; next due 2,000', () => {
    const completions = [{kind: 'service', interval: 500, reading_at_completion: 1300}];
    const [status] = computeIntervalStatus(intervals, completions, 1300);
    expect(status.last_satisfied_milestone).toBe(1500);
    expect(status.next_due).toBe(2000);
    expect(status.overdue).toBe(false);
  });

  it('exact midpoint (1,250) favors the earlier milestone 1,000; next due 1,500', () => {
    const completions = [{kind: 'service', interval: 500, reading_at_completion: 1250}];
    const [status] = computeIntervalStatus(intervals, completions, 1250);
    expect(status.last_satisfied_milestone).toBe(1000);
    expect(status.next_due).toBe(1500);
  });
});

describe('projectServiceIntervals — unified fueling-list projection', () => {
  // Merges computeDueIntervals (due membership) with computeIntervalStatus
  // (next_due / until_due). Contains no math of its own — these tests lock
  // ordering, due flags, and the neutral context fields the webform renders.

  it('orders the ENTIRE list by ascending checklist cadence regardless of due membership', () => {
    const intervals = [
      {kind: 'hours', hours_or_km: 500, label: '500 Hour Service', tasks: []},
      {kind: 'hours', hours_or_km: 100, label: '100 Hour Service', tasks: []},
      {kind: 'hours', hours_or_km: 300, label: '300 Hour Service', tasks: []},
    ];
    // Reading 250: 100h due (milestones 100+200 passed, never done); 300h and
    // 500h not yet due. One global cadence order: 100, 300, 500.
    const projected = projectServiceIntervals(intervals, [], 250);
    expect(projected.map((p) => [p.hours_or_km, p.due])).toEqual([
      [100, true],
      [300, false],
      [500, false],
    ]);
  });

  it('due entries carry computeDueIntervals metadata plus next_due/until_due', () => {
    const intervals = [{kind: 'hours', hours_or_km: 100, label: '100 Hour Service', tasks: []}];
    const [entry] = projectServiceIntervals(intervals, [], 250);
    expect(entry.due).toBe(true);
    expect(entry.missed_count).toBe(2); // milestones 100 and 200 both missed
    expect(entry.first_missed_at).toBe(100);
    expect(entry.next_due).toBe(100);
    expect(entry.until_due).toBe(-150);
  });

  it('non-due entries expose neutral context: next milestone + remaining distance', () => {
    const intervals = [{kind: 'hours', hours_or_km: 500, label: '500 Hour Service', tasks: []}];
    const completions = [{kind: 'hours', interval: 500, reading_at_completion: 1000, total_tasks: 0}];
    const [entry] = projectServiceIntervals(intervals, completions, 1200);
    expect(entry.due).toBe(false);
    expect(entry.next_due).toBe(1500);
    expect(entry.until_due).toBe(300);
  });

  it('handles km-tracked intervals identically', () => {
    const intervals = [
      {kind: 'km', hours_or_km: 1000, label: '1,000 KM Service', tasks: []},
      {kind: 'km', hours_or_km: 5000, label: '5,000 KM Service', tasks: []},
    ];
    const projected = projectServiceIntervals(intervals, [], 1500);
    expect(projected.map((p) => [p.hours_or_km, p.due])).toEqual([
      [1000, true],
      [5000, false],
    ]);
    expect(projected[1].next_due).toBe(5000);
    expect(projected[1].until_due).toBe(3500);
  });

  it('an interval due exactly AT its milestone stays in the due subset (computeDueIntervals owns membership)', () => {
    // computeIntervalStatus.overdue is strictly currentReading > next_due, so
    // at exactly 500 it reports overdue=false — but computeDueIntervals marks
    // it due. Membership must come from computeDueIntervals.
    const intervals = [{kind: 'hours', hours_or_km: 500, label: '500 Hour Service', tasks: []}];
    const [entry] = projectServiceIntervals(intervals, [], 500);
    expect(entry.due).toBe(true);
  });

  it('empty/absent intervals return []', () => {
    expect(projectServiceIntervals([], [], 100)).toEqual([]);
    expect(projectServiceIntervals(null, [], 100)).toEqual([]);
  });
});

// ── PROD ordering hotfix (2026-07-17) ────────────────────────────────────────
// Service-interval cards must render in ascending checklist cadence. The
// prior projection ordered due-first then nearest-milestone-first, which
// scrambled two live PROD configurations (5065 and honda-atv-1). Due status,
// next_due, until_due, and missed counts are presentation facts and never
// control row order.
describe('projectServiceIntervals — global ascending cadence order (PROD hotfix locks)', () => {
  const hoursIv = (v, label = v + ' Hour Service') => ({kind: 'hours', hours_or_km: v, label, tasks: []});
  // Full legacy-shaped completion: total_tasks 0 → counts as a full
  // completion at that reading regardless of the interval's current tasks.
  const done = (kind, interval, at) => ({kind, interval, reading_at_completion: at, total_tasks: 0});

  it('5065 reproduction: 50/250/500 due + nearest-milestone non-due order corrects to pure ascending', () => {
    // John Deere 5065E shape. At reading 1,900 with a 600h full completion at
    // 1,750 (→ next 2,400) and a 1,200h full completion at 1,150 (→ next
    // 2,400): 50/250/500 are due; 2000 (until 100) is NEAREST, 600/1200 are
    // 500 out — the prior order rendered 50, 250, 500, 2000, 600, 1200.
    const intervals = [hoursIv(50), hoursIv(250), hoursIv(500), hoursIv(600), hoursIv(1200), hoursIv(2000)];
    const completions = [done('hours', 600, 1750), done('hours', 1200, 1150)];
    const projected = projectServiceIntervals(intervals, completions, 1900);

    // Prove the repro conditions are real: 2000 is the nearest non-due
    // milestone (until_due 100 vs 500) — under the OLD sort it led the
    // non-due block.
    const byV = new Map(projected.map((p) => [p.hours_or_km, p]));
    expect(byV.get(2000).due).toBe(false);
    expect(byV.get(2000).until_due).toBe(100);
    expect(byV.get(600).until_due).toBe(500);
    expect(byV.get(1200).until_due).toBe(500);

    expect(projected.map((p) => p.hours_or_km)).toEqual([50, 250, 500, 600, 1200, 2000]);
    expect(projected.map((p) => p.due)).toEqual([true, true, true, false, false, false]);
  });

  it('Honda #1 reproduction: a larger DUE interval never jumps ahead of a smaller non-due one', () => {
    // honda-atv-1 shape. At reading 210 with a 50h full completion at 190
    // (snaps to milestone 200 → next 250): 200h is due, 50h and 500h are
    // not — the prior order rendered 200, 50, 500.
    const intervals = [hoursIv(50), hoursIv(200), hoursIv(500)];
    const completions = [done('hours', 50, 190)];
    const projected = projectServiceIntervals(intervals, completions, 210);
    expect(projected.map((p) => [p.hours_or_km, p.due])).toEqual([
      [50, false],
      [200, true],
      [500, false],
    ]);
  });

  it('Powerstar-style sequence stays 50, 100, 300, 600, 1200, 3600', () => {
    const intervals = [hoursIv(50), hoursIv(100), hoursIv(300), hoursIv(600), hoursIv(1200), hoursIv(3600)];
    const projected = projectServiceIntervals(intervals, [], 75);
    expect(projected.map((p) => p.hours_or_km)).toEqual([50, 100, 300, 600, 1200, 3600]);
    expect(projected[0].due).toBe(true); // 50h due at 75; the rest upcoming
    expect(projected.slice(1).every((p) => !p.due)).toBe(true);
  });

  it('km intervals: non-due rows stay numerically ordered, never nearest-first', () => {
    // Reading 4,900km: 1000km done at 4,900 (snap 5000 → next 6000, until
    // 1100); 5000km never done (next 5000, until 100 — NEAREST); 10000km
    // until 5100. Old sort: 5000, 1000, 10000. New: 1000, 5000, 10000.
    const intervals = [
      {kind: 'km', hours_or_km: 1000, label: '1,000 KM', tasks: []},
      {kind: 'km', hours_or_km: 5000, label: '5,000 KM', tasks: []},
      {kind: 'km', hours_or_km: 10000, label: '10,000 KM', tasks: []},
    ];
    const completions = [done('km', 1000, 4900)];
    const projected = projectServiceIntervals(intervals, completions, 4900);
    expect(projected.map((p) => p.hours_or_km)).toEqual([1000, 5000, 10000]);
    expect(projected.map((p) => p.due)).toEqual([false, false, false]);
    expect(projected[1].until_due).toBe(100); // nearest, yet not first
  });

  it('shuffled configuration input still renders ascending', () => {
    const intervals = [hoursIv(600), hoursIv(50), hoursIv(1200), hoursIv(250)];
    const projected = projectServiceIntervals(intervals, [], 700);
    expect(projected.map((p) => p.hours_or_km)).toEqual([50, 250, 600, 1200]);
  });

  it('defensive equal-identity ties keep stable source order', () => {
    const intervals = [
      {kind: 'hours', hours_or_km: 50, label: 'A', tasks: []},
      {kind: 'hours', hours_or_km: 50, label: 'B', tasks: []},
    ];
    const projected = projectServiceIntervals(intervals, [], 60);
    expect(projected.map((p) => p.label)).toEqual(['A', 'B']);
  });

  it('defensive mixed kinds sort by deterministic kind order, ascending within each kind', () => {
    const intervals = [
      {kind: 'km', hours_or_km: 100, label: 'km-100', tasks: []},
      {kind: 'hours', hours_or_km: 500, label: 'h-500', tasks: []},
      {kind: 'hours', hours_or_km: 50, label: 'h-50', tasks: []},
      {kind: 'km', hours_or_km: 50, label: 'km-50', tasks: []},
    ];
    const projected = projectServiceIntervals(intervals, [], 60);
    expect(projected.map((p) => p.label)).toEqual(['h-50', 'h-500', 'km-50', 'km-100']);
  });

  it('sorting does not disturb due flags, metadata, or status fields', () => {
    const intervals = [hoursIv(50), hoursIv(250), hoursIv(500), hoursIv(600), hoursIv(1200), hoursIv(2000)];
    const completions = [done('hours', 600, 1750), done('hours', 1200, 1150)];
    const projected = projectServiceIntervals(intervals, completions, 1900);
    const fifty = projected.find((p) => p.hours_or_km === 50);
    expect(fifty.due).toBe(true);
    expect(fifty.missed_count).toBeGreaterThan(0);
    // The 600h completion at 1,750 cascades to its 50h divisor (own snap at
    // 1,750) → first missed milestone is 1,800, still due at reading 1,900.
    expect(fifty.first_missed_at).toBe(1800);
    const twoK = projected.find((p) => p.hours_or_km === 2000);
    expect(twoK.due).toBe(false);
    expect(twoK.next_due).toBe(2000);
    expect(twoK.until_due).toBe(100);
    const sixHundred = projected.find((p) => p.hours_or_km === 600);
    expect(sixHundred.next_due).toBe(2400);
    expect(sixHundred.last_satisfied_milestone).toBe(1800);
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

describe('latestSaneReading — equipment current-reading drift compensation', () => {
  // Recon 2026-04-28 found anon UPDATE on equipment.current_hours/km silently
  // fails under prod RLS, so equipment.current_* drifts behind the latest
  // webform fueling submission. HomeDashboard's overdue calc reads from this
  // helper instead of equipment.current_* directly.

  it('uses the latest fueling reading when it exceeds equipment.current_*', () => {
    // Mirrors the prod ps100 case: equipment.current_hours=951, latest fueling
    // reading=965. Without the helper, overdue math runs against 951 and
    // misses the 14-hour drift.
    const eq = {tracking_unit: 'hours', current_hours: 951, current_km: null};
    const fuelings = [{date: '2026-04-27', hours_reading: 965}];
    expect(latestSaneReading(eq, fuelings)).toBe(965);
  });

  it('falls back to equipment.current_* when admin reading is ahead of fuelings', () => {
    // Admin manually corrected the meter forward; the older fueling reading
    // shouldn't override.
    const eq = {tracking_unit: 'hours', current_hours: 1200, current_km: null};
    const fuelings = [{date: '2026-04-27', hours_reading: 1000}];
    expect(latestSaneReading(eq, fuelings)).toBe(1200);
  });

  it('returns equipment.current_* when no fuelings are present', () => {
    const eq = {tracking_unit: 'hours', current_hours: 500, current_km: null};
    expect(latestSaneReading(eq, [])).toBe(500);
    expect(latestSaneReading(eq, null)).toBe(500);
    expect(latestSaneReading(eq, undefined)).toBe(500);
  });

  it('picks the latest fueling by DATE, not by reading magnitude', () => {
    // Mirrors the honda-atv-1 legacy outlier: a 2025-01-11 import row reads
    // 5437h (typo or odometer reset), but the recent operator submissions are
    // ~1086h. Picking by max-date (not max-reading) avoids propagating the
    // outlier — the recent legitimate submission wins.
    const eq = {tracking_unit: 'hours', current_hours: 1088, current_km: null};
    const fuelings = [
      {date: '2025-01-11', hours_reading: 5437}, // legacy outlier
      {date: '2026-04-22', hours_reading: 1086}, // latest legit
    ];
    // Latest by date is the 1086 reading, which is < current_hours (1088),
    // so the helper falls back to current_hours. The 5437 outlier never
    // wins because it's not the latest by date.
    expect(latestSaneReading(eq, fuelings)).toBe(1088);
  });

  it('handles km tracking unit', () => {
    // Mirrors the prod hijet-2020 case: current_km=9915, latest=10097.
    const eq = {tracking_unit: 'km', current_hours: null, current_km: 9915};
    const fuelings = [{date: '2026-04-21', km_reading: 10097}];
    expect(latestSaneReading(eq, fuelings)).toBe(10097);
  });

  it('ignores hours_reading when tracking_unit is km (and vice versa)', () => {
    // Equipment with stale-but-misclassified reading on the wrong column.
    const eq = {tracking_unit: 'km', current_hours: null, current_km: 100};
    const fuelings = [{date: '2026-04-21', hours_reading: 99999, km_reading: null}];
    // The fueling has no km_reading, so helper falls back to current_km.
    expect(latestSaneReading(eq, fuelings)).toBe(100);
  });

  it('returns the latest fueling when equipment.current_* is blank/undefined', () => {
    // Edge case: a freshly-imported piece without an admin-set current_hours.
    // Number(undefined) = NaN, which Number.isFinite rejects. If we required
    // BOTH readings to be finite we'd return NaN here even though the latest
    // fueling has a valid reading. Treat blank current_* as "no admin floor".
    const eqUndef = {tracking_unit: 'hours'}; // current_hours absent entirely
    const fuelings = [{date: '2026-04-27', hours_reading: 825}];
    expect(latestSaneReading(eqUndef, fuelings)).toBe(825);

    const eqNull = {tracking_unit: 'hours', current_hours: null, current_km: null};
    expect(latestSaneReading(eqNull, fuelings)).toBe(825);
  });
});

describe('currentReadingFromFuelings - admin correction support', () => {
  it('uses the max valid hours reading so correcting a bad high fueling can lower equipment.current_hours', () => {
    const eq = {tracking_unit: 'hours'};
    const fuelings = [
      {date: '2026-05-10', hours_reading: 173},
      {date: '2026-04-12', hours_reading: 167},
      {date: '2025-10-21', hours_reading: 157},
    ];
    expect(currentReadingFromFuelings(eq, fuelings)).toBe(173);
  });

  it('uses km_reading for km-tracked equipment and ignores invalid/blank readings', () => {
    const eq = {tracking_unit: 'km'};
    const fuelings = [
      {km_reading: null, hours_reading: 9999},
      {km_reading: '1200'},
      {km_reading: -1},
      {km_reading: 1250},
    ];
    expect(currentReadingFromFuelings(eq, fuelings)).toBe(1250);
  });

  it('returns null when no valid historical reading exists', () => {
    expect(currentReadingFromFuelings({tracking_unit: 'hours'}, [])).toBeNull();
    expect(currentReadingFromFuelings({tracking_unit: 'hours'}, [{hours_reading: null}])).toBeNull();
  });
});
