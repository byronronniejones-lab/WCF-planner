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

  // Map interval value -> last-completed reading (snapshot from ticks).
  // Divisor rule: if interval Y was ticked at reading R, any smaller X that
  // divides Y (X | Y) is also counted as done at R.
  const lastAtReading = new Map(); // key = kind+':'+value
  for (const c of (completions || [])) {
    if (!c || !c.interval || !c.kind) continue;
    // We don't have the reading snapshot for each completion; use the current
    // reading if this completion doesn't carry one. Better than nothing.
    const snapReading = Number.isFinite(c.reading_at_completion)
      ? c.reading_at_completion
      : currentReading;
    const key = c.kind + ':' + c.interval;
    const existing = lastAtReading.get(key);
    if (!existing || snapReading > existing) lastAtReading.set(key, snapReading);
    // Divisor rule: mark every interval Y (in the equipment's intervals list)
    // that divides c.interval AND matches kind, at the same snapReading.
    for (const iv of intervals) {
      if (iv.kind !== c.kind) continue;
      if (iv.hours_or_km === c.interval) continue;
      if (c.interval % iv.hours_or_km !== 0) continue;
      const kk = iv.kind + ':' + iv.hours_or_km;
      const ex2 = lastAtReading.get(kk);
      if (!ex2 || snapReading > ex2) lastAtReading.set(kk, snapReading);
    }
  }

  return intervals.map(iv => {
    const key = iv.kind + ':' + iv.hours_or_km;
    const lastR = lastAtReading.get(key);
    // Next due = smallest multiple of interval strictly greater than max(lastR, 0).
    const lastMilestone = lastR != null ? Math.floor(lastR / iv.hours_or_km) * iv.hours_or_km : 0;
    const nextDue = lastMilestone + iv.hours_or_km;
    const overdue = currentReading != null && currentReading > nextDue;
    return {
      ...iv,
      last_at_reading: lastR || null,
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
