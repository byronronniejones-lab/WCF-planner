// ============================================================================
// tasksRecurrence — Tasks Module v1 Phase B recurrence math.
// ----------------------------------------------------------------------------
// Pure ESM. NO imports. NO Node APIs. NO Supabase imports. NO Date mutation
// leaks: every Date instance is created locally and never returned to the
// caller. All inputs and outputs are 'YYYY-MM-DD' strings.
//
// Source-of-truth for the algorithm. Byte-identical copy lives at
//   supabase/functions/_shared/tasksRecurrence.js
// (the Edge Function imports the shared copy via Deno's relative ESM resolution).
// Drift is locked by tests/static/tasks_recurrence_parity.test.js.
//
// Contract (rev 3, locked):
//   dueDatesThrough(template, throughISO) → string[]
//     template = { recurrence, recurrence_interval, first_due_date }
//     Returns every anchored occurrence d such that
//     template.first_due_date <= d <= throughISO. Catch-up is implicit.
//   addMonthsAnchored(isoDate, n) → string
//     ANCHORED math: each month-step computed from the original first_due_date,
//     never chained from the previous clamped result.
//     Day clamp: min(F.day, daysInMonth(target_year, target_month)).
//
// Recurrence enum: once | daily | weekly | biweekly | monthly | quarterly
// recurrence_interval (positive int, default 1) multiplies the base step:
//   daily:     interval days
//   weekly:    interval * 7 days
//   biweekly:  interval * 14 days       (Codex Q2: multiply 14-day base)
//   monthly:   interval months          (anchored)
//   quarterly: interval * 3 months      (anchored)
// ============================================================================

function pad2(n) {
  return n < 10 ? '0' + n : '' + n;
}

function parseISO(iso) {
  // Accepts strict 'YYYY-MM-DD'. Returns {y, m, d} as numbers.
  const y = Number(iso.slice(0, 4));
  const m = Number(iso.slice(5, 7));
  const d = Number(iso.slice(8, 10));
  return {y, m, d};
}

function isoOf(y, m, d) {
  return y + '-' + pad2(m) + '-' + pad2(d);
}

function daysInMonth(y, m) {
  // m is 1-12. Trick: day 0 of month m+1 (UTC) is the last day of month m.
  // Date instance is local-ephemeral; never escapes this function.
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

function addDaysISO(iso, n) {
  const {y, m, d} = parseISO(iso);
  // UTC math avoids any DST/TZ surprises. Date instance is local-ephemeral.
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + n);
  return isoOf(dt.getUTCFullYear(), dt.getUTCMonth() + 1, dt.getUTCDate());
}

export function addMonthsAnchored(iso, n) {
  // Compute target year/month from the ORIGINAL date plus n months. Never
  // chain from a previous clamped result. Day = min(original day, days in
  // target month) so 2026-01-31 + 1 month = 2026-02-28, NOT a chained walk
  // that would land on 2026-03-28 next step.
  const {y, m, d} = parseISO(iso);
  const total = y * 12 + (m - 1) + n;
  const targetYear = Math.floor(total / 12);
  const targetMonth0 = ((total % 12) + 12) % 12; // 0-11; handles negative n
  const targetMonth = targetMonth0 + 1; // 1-12
  const clampedDay = Math.min(d, daysInMonth(targetYear, targetMonth));
  return isoOf(targetYear, targetMonth, clampedDay);
}

export function dueDatesThrough(template, throughISO) {
  if (!template || !throughISO) return [];
  const recurrence = template.recurrence;
  const firstDue = template.first_due_date;
  if (!firstDue || !recurrence) return [];

  // recurrence_interval normalizes to a positive int (default 1).
  const rawInterval = Number(template.recurrence_interval);
  const interval = Number.isFinite(rawInterval) && rawInterval >= 1 ? Math.floor(rawInterval) : 1;

  // No occurrences before first_due_date; if the template hasn't started yet
  // by throughISO, return empty.
  if (firstDue > throughISO) return [];

  if (recurrence === 'once') {
    return [firstDue];
  }

  const out = [];
  // Safety circuit: cap iterations to prevent any caller misconfig from
  // hanging the function. 100k iterations covers a daily template with
  // ~270-year horizon — far above any realistic catch-up window.
  const SAFETY_CAP = 100000;
  for (let k = 0; k < SAFETY_CAP; k += 1) {
    let candidate;
    switch (recurrence) {
      case 'daily':
        candidate = addDaysISO(firstDue, k * interval);
        break;
      case 'weekly':
        candidate = addDaysISO(firstDue, k * interval * 7);
        break;
      case 'biweekly':
        candidate = addDaysISO(firstDue, k * interval * 14);
        break;
      case 'monthly':
        candidate = addMonthsAnchored(firstDue, k * interval);
        break;
      case 'quarterly':
        candidate = addMonthsAnchored(firstDue, k * interval * 3);
        break;
      default:
        // Unknown recurrence — return whatever we've built so far (empty
        // on first iteration). Caller's CHECK constraint should prevent
        // reaching this branch in practice.
        return out;
    }
    if (candidate > throughISO) break;
    out.push(candidate);
  }
  return out;
}
