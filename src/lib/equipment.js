// Equipment module constants + helpers. Used by every equipment view +
// the /fueling public webform. Kept free of React + Supabase so it can be
// imported from anywhere including scripts.

export const EQUIPMENT_CATEGORIES = [
  {key:'tractors',   label:'Tractors',   icon:'🚜', color:'#065f46', bg:'#ecfdf5', bd:'#a7f3d0'},
  {key:'atvs',       label:'ATVs',       icon:'🛵', color:'#1e40af', bg:'#eff6ff', bd:'#bfdbfe'},
  {key:'hijets',     label:'Hijets',     icon:'🛻', color:'#92400e', bg:'#fffbeb', bd:'#fde68a'},
  {key:'mowers',     label:'Mowers',     icon:'🪚', color:'#a16207', bg:'#fef9c3', bd:'#fde047'},
  {key:'skidsteers', label:'Skidsteers', icon:'🚧', color:'#7f1d1d', bg:'#fef2f2', bd:'#fca5a5'},
  {key:'forestry',   label:'Forestry',   icon:'🌲', color:'#065f46', bg:'#f0fdfa', bd:'#5eead4'},
];

export const CATEGORY_BY_KEY = Object.fromEntries(
  EQUIPMENT_CATEGORIES.map(c => [c.key, c])
);

// Equipment program color (for nav cards, tabs, etc.). Slate/steel.
export const EQUIPMENT_COLOR = '#57534e';
export const EQUIPMENT_BG    = '#fafaf9';
export const EQUIPMENT_BD    = '#d6d3d1';

// Threshold in days without a fueling entry before HomeDashboard flags the
// piece of equipment. Ronnie's call 2026-04-23: 14 days.
export const MISSED_FUELING_DAYS = 14;

// Warranty expiring threshold (days).
export const WARRANTY_WINDOW_DAYS = 60;

// Compute the next-due reading for a given interval on an equipment given
// its current reading. Handles the divisor rule: if interval X has been
// implicitly completed because a bigger interval Y (where X | Y) was done
// at the same milestone, the effective "last done" shifts up.
//
// currentReading: int (hours or km on the machine right now)
// intervals: array of {hours_or_km, kind, label}
// completions: array of {interval, kind, completed_at, ...} sorted by completed_at desc
//
// Returns for each interval: {next_due, overdue, completed_at_last, days_since_last}
export function computeIntervalStatus(intervals, completions, currentReading) {
  if (!Array.isArray(intervals) || intervals.length === 0) return [];

  // Map interval value -> SNAPPED milestone of the latest completion.
  // Snap-to-nearest milestone: a completion at reading R for interval I gets
  // credited to whichever milestone is closer (tie favors previous). So
  // 500hr@968 satisfies the 1000h milestone, scheduling next 500hr at 1500h.
  // Divisor rule: completing 1000hr also satisfies 500/250/100/50 at the
  // PARENT'S snapped milestone (since the snap is always a multiple of the
  // sub-interval, this works out cleanly).
  const lastSnapped = new Map(); // key = kind+':'+value -> snapped milestone
  const lastRaw     = new Map(); // raw reading at completion, for display
  for (const c of (completions || [])) {
    if (!c || !c.interval || !c.kind) continue;
    const snapReading = Number.isFinite(c.reading_at_completion)
      ? c.reading_at_completion
      : currentReading;
    if (snapReading == null) continue;
    const snappedMilestone = snapToNearestMilestone(snapReading, c.interval);
    const key = c.kind + ':' + c.interval;
    const existing = lastSnapped.get(key);
    if (!existing || snappedMilestone > existing) {
      lastSnapped.set(key, snappedMilestone);
      lastRaw.set(key, snapReading);
    }
    // Divisor rule cascades the parent's snapped milestone down.
    for (const iv of intervals) {
      if (iv.kind !== c.kind) continue;
      if (iv.hours_or_km === c.interval) continue;
      if (c.interval % iv.hours_or_km !== 0) continue;
      const kk = iv.kind + ':' + iv.hours_or_km;
      const ex2 = lastSnapped.get(kk);
      if (!ex2 || snappedMilestone > ex2) {
        lastSnapped.set(kk, snappedMilestone);
        lastRaw.set(kk, snapReading);
      }
    }
  }

  return intervals.map(iv => {
    const key = iv.kind + ':' + iv.hours_or_km;
    const lastM = lastSnapped.get(key) || 0; // already a multiple of iv.hours_or_km
    const lastR = lastRaw.get(key) || null;
    const nextDue = lastM > 0 ? lastM + iv.hours_or_km : iv.hours_or_km;
    const overdue = currentReading != null && currentReading > nextDue;
    return {
      ...iv,
      last_at_reading: lastR,
      last_satisfied_milestone: lastM > 0 ? lastM : null,
      next_due: nextDue,
      overdue: !!overdue,
      until_due: currentReading != null ? nextDue - currentReading : null,
    };
  });
}

// Does the machine need any service right now? Returns the soonest-overdue
// interval or null.
export function soonestDue(intervals, completions, currentReading, windowHours = 50) {
  const statuses = computeIntervalStatus(intervals, completions, currentReading);
  if (currentReading == null) return null;
  // Priority: overdue first, then within windowHours of next_due.
  const overdue = statuses.filter(s => s.overdue).sort((a, b) => (currentReading - a.next_due) - (currentReading - b.next_due));
  if (overdue.length > 0) return overdue[0];
  const upcoming = statuses.filter(s => s.until_due != null && s.until_due <= windowHours).sort((a, b) => a.until_due - b.until_due);
  return upcoming[0] || null;
}

// Snap a completion reading to the nearest milestone of the given interval.
// E.g. interval=500, reading=968 → snaps to 1000 (32 away vs 468 away).
// Tie-break favors the previous milestone (treat as late completion of prior).
// This is the math fix for the 2026-04-25 scenario where a 500hr maintenance
// done at 968h was being treated as a 468h-late completion of the 500
// milestone, then immediately flagged as overdue at 1000h. Under snap-to-
// nearest, 968h satisfies the 1000h milestone, next due at 1500h.
function snapToNearestMilestone(reading, interval) {
  if (!Number.isFinite(reading) || reading <= 0) return 0;
  if (!Number.isFinite(interval) || interval <= 0) return 0;
  const fwd = Math.ceil(reading / interval) * interval;
  const back = Math.floor(reading / interval) * interval;
  // Already on a milestone — return it.
  if (fwd === back) return fwd;
  return (fwd - reading) < (reading - back) ? fwd : back;
}

// Given the equipment's intervals + fueling history + the reading the team
// just entered, compute which intervals are DUE RIGHT NOW. Ronnie's logic
// (2026-04-23): require the team to enter current reading, then walk back
// through prior fuel-up history to find intervals whose milestones were
// passed but never ticked. Return an array sorted by most-missed first.
//
// Each completion is snapped to the nearest milestone of its interval — that
// becomes the "satisfied milestone". Next due = satisfied + interval. So a
// 500hr done at 968h satisfies the 1000h milestone (closer than 500h),
// scheduling next 500hr at 1500h. A 500hr done at 1100h still snaps to
// 1000 (closer than 1500), scheduling next at 1500h. A 500hr done at
// 750h (exactly midway) snaps to 500h via the conservative tie-break.
export function computeDueIntervals(intervals, completions, currentReading) {
  if (!Array.isArray(intervals) || intervals.length === 0) return [];
  if (!Number.isFinite(Number(currentReading)) || currentReading <= 0) return [];

  // "Fully complete" = items_completed.length === total_tasks (all sub-items
  // ticked on a single fueling). A partial completion doesn't reset the
  // clock; the interval stays in the due list until someone does it all.
  function isFullCompletion(c) {
    if (!c.total_tasks || c.total_tasks === 0) return true; // no sub-items == just the parent tick
    const count = Array.isArray(c.items_completed) ? c.items_completed.length : 0;
    return count >= c.total_tasks;
  }

  // lastDoneSnapped tracks the SNAPPED milestone (multiple of interval) for
  // each interval — drives the next-due math. lastDoneAtRaw tracks the actual
  // reading at completion for display purposes (so the form still shows
  // "last full done at 968h", not "last full done at 1000h").
  const lastDoneSnapped = new Map();
  const lastDoneAtRaw = new Map();
  for (const c of (completions || [])) {
    if (!c || !c.interval || !c.kind) continue;
    const snap = Number.isFinite(c.reading_at_completion) ? c.reading_at_completion : null;
    if (snap == null) continue;
    if (!isFullCompletion(c)) continue;
    const key = c.kind + ':' + c.interval;
    const snappedMilestone = snapToNearestMilestone(snap, c.interval);
    const ex = lastDoneSnapped.get(key);
    if (!ex || snappedMilestone > ex) {
      lastDoneSnapped.set(key, snappedMilestone);
      lastDoneAtRaw.set(key, snap);
    }
    // Divisor rule: completing 1000hr also completes 500/250/100/50 at the
    // PARENT'S SNAPPED MILESTONE if those are intervals on this machine.
    // The parent's snap is always a multiple of the parent interval, and
    // the sub-interval divides the parent, so the snap is also a multiple
    // of the sub. (E.g., 500hr@968 snaps to 1000, divisor cascades 1000 down
    // to the 50hr interval — next 50hr due at 1050, not 1000.)
    for (const iv of intervals) {
      if (iv.kind !== c.kind) continue;
      if (iv.hours_or_km === c.interval) continue;
      if (c.interval % iv.hours_or_km !== 0) continue;
      const kk = iv.kind + ':' + iv.hours_or_km;
      const ex2 = lastDoneSnapped.get(kk);
      if (!ex2 || snappedMilestone > ex2) {
        lastDoneSnapped.set(kk, snappedMilestone);
        lastDoneAtRaw.set(kk, snap);
      }
    }
  }

  // Latest PARTIAL attempt per interval — but ONLY if no full completion has
  // happened since. Once someone does a full pass, stale partials stop
  // mattering. Caller gets items_completed (IDs), total, team_member, and the
  // reading, so it can list what's still unfinished and by whom.
  const lastPartialAt = new Map();
  const lastPartialDetail = new Map();
  for (const c of (completions || [])) {
    if (!c || !c.interval || !c.kind) continue;
    if (isFullCompletion(c)) continue;
    const snap = Number.isFinite(c.reading_at_completion) ? c.reading_at_completion : null;
    if (snap == null) continue;
    const key = c.kind + ':' + c.interval;
    // Skip if a full completion has happened at/after this reading. Compare
    // against the full's RAW reading (not its snapped milestone) so a partial
    // recorded in real time before a later full doesn't get suppressed by
    // the full's snap-forward.
    const fullRaw = lastDoneAtRaw.get(key);
    if (fullRaw != null && fullRaw >= snap) continue;
    const ex = lastPartialAt.get(key);
    if (!ex || snap > ex) {
      lastPartialAt.set(key, snap);
      lastPartialDetail.set(key, {
        items_done: Array.isArray(c.items_completed) ? c.items_completed.length : 0,
        items_completed: Array.isArray(c.items_completed) ? c.items_completed.slice() : [],
        total: c.total_tasks || 0,
        at_reading: snap,
        team_member: c.team_member || null,
      });
    }
  }

  const due = [];
  for (const iv of intervals) {
    const key = iv.kind + ':' + iv.hours_or_km;
    // The snapped milestone drives next-due math; the raw reading is for display.
    const lastSnapped = lastDoneSnapped.get(key) || 0;
    const lastRaw = lastDoneAtRaw.get(key) || 0;
    const firstMilestoneAfterLast = lastSnapped > 0
      ? lastSnapped + iv.hours_or_km
      : iv.hours_or_km; // no completion ever — first due at the first milestone
    if (firstMilestoneAfterLast > currentReading) continue;
    const largestMilestoneAtOrBeforeCurrent = Math.floor(currentReading / iv.hours_or_km) * iv.hours_or_km;
    const missedCount = ((largestMilestoneAtOrBeforeCurrent - firstMilestoneAfterLast) / iv.hours_or_km) + 1;
    due.push({
      ...iv,
      last_done_at: lastRaw > 0 ? lastRaw : null,
      last_done_milestone: lastSnapped > 0 ? lastSnapped : null,
      first_missed_at: firstMilestoneAfterLast,
      current_milestone: largestMilestoneAtOrBeforeCurrent,
      missed_count: missedCount,
      last_partial: lastPartialDetail.get(key) || null,
    });
  }

  // Ascending — smallest interval first (50h before 600h before 1200h).
  return due.sort((a, b) => a.hours_or_km - b.hours_or_km);
}

// Strip Podio HTML tags (and trivial "None" placeholder) from comment text.
// Podio stored comments as rendered HTML like "<p>None</p>" or "<p>Did not
// do checklist</p>"; we want clean plain text in the UI.
export function stripPodioHtml(s) {
  if (s == null) return null;
  const clean = String(s).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
  if (!clean || clean.toLowerCase() === 'none' || clean === 'N/A' || clean.toLowerCase() === 'n/a') return null;
  return clean;
}

// Days since an ISO date. Returns null for falsy/invalid input.
export function daysSince(iso) {
  if (!iso) return null;
  const t = new Date((iso + '').slice(0, 10) + 'T12:00:00').getTime();
  if (!Number.isFinite(t)) return null;
  return Math.floor((Date.now() - t) / 86400000);
}

// Pretty-print a reading with unit. 1234 hours → "1,234 h"; 5000 km → "5,000 km".
export function fmtReading(value, unit) {
  if (value == null || !Number.isFinite(Number(value))) return '—';
  return Math.round(value).toLocaleString() + ' ' + (unit === 'km' ? 'km' : 'h');
}
