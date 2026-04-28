// ============================================================================
// HomeDashboard equipment-attention seed — for tests/home_dashboard_equipment.spec.js
// ============================================================================
// One factory, parameterized by kind. Three kinds are POSITIVE seeds (overdue
// / fillup_streak / warranty) — they shape the equipment so the spec asserts
// a row WITH the matching data-attention-kind appears. Two kinds are NEGATIVE
// seeds (upcoming / missed_fueling) — they shape near-due-but-not-overdue
// equipment and stale-fueling equipment so the spec asserts NO row appears
// for the seeded slug. Per Ronnie 2026-04-28 (eve+), equipment maintenance
// is hour/km-based, not calendar-based — animal dailys are the calendar
// workflow. So the dashboard deliberately does not surface near-due forecasts
// or "no fueling for N days" alerts; the negative seeds lock that contract.
//
//   seedHomeDashboardEquipment(supabaseAdmin, { kind })
//     kind: 'overdue' | 'fillup_streak' | 'warranty'        (positive)
//         | 'upcoming' | 'missed_fueling'                   (negative)
//     Positive returns { slug, kind, expectedSubstrings: [...] } — substrings
//     the spec should assert via toContainText (per Codex's preference for
//     focused signal assertions, not exact full-row text).
//     Negative returns { slug, kind } — no expectedSubstrings.
//
// All seed values map back to the constants in src/lib/equipment.js
// (WARRANTY_WINDOW_DAYS=60). MISSED_FUELING_DAYS and UPCOMING_WINDOW were
// removed from production along with the upcoming/missed_fueling kinds; the
// negative seeds still produce equipment shaped like the legacy thresholds
// (>14 days since fueling; ≤50 hours until next_due) so the negative lock
// proves the new behavior even against the old trigger conditions.
// ============================================================================

import { assertTestDatabase } from '../setup/assertTestDatabase.js';

function must(result, label) {
  if (result?.error) {
    throw new Error(`homeDashboardEquipmentSeed [${label}]: ${result.error.message}`);
  }
  return result;
}

// ISO date offset N days from today, computed at seed time. Used by the
// missed_fueling case so the seed and test both reference the same fixed
// historical date — no midnight-crossing flake (per Codex's directive).
function daysAgo(n) {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString().slice(0, 10);
}
function daysFromNow(n) {
  const d = new Date();
  d.setDate(d.getDate() + n);
  return d.toISOString().slice(0, 10);
}

export async function seedHomeDashboardEquipment(supabaseAdmin, opts = {}) {
  assertTestDatabase(process.env.VITE_SUPABASE_URL || '');
  const { kind } = opts;

  // Admin profile for /admin and /home access.
  const adminEmail = process.env.VITE_TEST_ADMIN_EMAIL;
  if (!adminEmail) {
    throw new Error('homeDashboardEquipmentSeed: VITE_TEST_ADMIN_EMAIL must be set in .env.test.local.');
  }
  const usersResult = await supabaseAdmin.auth.admin.listUsers();
  if (usersResult.error) {
    throw new Error(`homeDashboardEquipmentSeed [auth.listUsers]: ${usersResult.error.message}`);
  }
  const adminUser = usersResult.data?.users?.find((u) => u.email === adminEmail);
  if (!adminUser) {
    throw new Error(`homeDashboardEquipmentSeed: test admin user "${adminEmail}" missing.`);
  }
  must(
    await supabaseAdmin.from('profiles').upsert(
      { id: adminUser.id, email: adminUser.email, role: 'admin' },
      { onConflict: 'id' }
    ),
    'profiles upsert'
  );

  const slug = 'eq-attention-test';
  const id = 'eq-attention-' + kind;

  // Per-kind seed.
  if (kind === 'overdue') {
    // current_hours=110, interval=100h, no completions → next_due=100, 10h overdue.
    must(
      await supabaseAdmin.from('equipment').insert({
        id,
        name: 'Overdue Test Tractor',
        slug,
        category: 'tractors',
        tracking_unit: 'hours',
        status: 'active',
        current_hours: 110,
        service_intervals: [{hours_or_km: 100, kind: 'hours', label: '100hr service', tasks: []}],
      }),
      'equipment insert (overdue)'
    );
    return {
      slug,
      kind,
      // Detail string template:
      //   `${intervalLbl} · ${Math.round(over).toLocaleString()} ${unitLabel} overdue`
      // → '100hr service · 10 h overdue'
      expectedSubstrings: ['100hr service', 'overdue'],
    };
  }

  if (kind === 'upcoming') {
    // NEGATIVE seed. current_hours=60, interval=100h, no completions →
    // next_due=100, until_due=40. Under the legacy upcoming-kind logic this
    // shape would have surfaced as a row; the spec's negative test asserts
    // it no longer does. Equipment maintenance is hour/km-based, not
    // calendar-based, so near-due forecasts deliberately don't render.
    must(
      await supabaseAdmin.from('equipment').insert({
        id,
        name: 'Upcoming Test Tractor',
        slug,
        category: 'tractors',
        tracking_unit: 'hours',
        status: 'active',
        current_hours: 60,
        service_intervals: [{hours_or_km: 100, kind: 'hours', label: '100hr service', tasks: []}],
      }),
      'equipment insert (upcoming)'
    );
    return {slug, kind};
  }

  if (kind === 'missed_fueling') {
    // NEGATIVE seed. No service intervals, no fillup items, latest fueling
    // 20 days ago (which would have tripped the legacy MISSED_FUELING_DAYS
    // ≥ 14 threshold). Under the new contract, no row renders — equipment
    // is hour/km-based, not calendar-based, so stale-fueling-by-time
    // doesn't surface here. Animal dailies are the calendar workflow.
    const fuelDate = daysAgo(20);
    must(
      await supabaseAdmin.from('equipment').insert({
        id,
        name: 'Stale Test Tractor',
        slug,
        category: 'tractors',
        tracking_unit: 'hours',
        status: 'active',
        current_hours: 100,
      }),
      'equipment insert (missed_fueling)'
    );
    must(
      await supabaseAdmin.from('equipment_fuelings').insert({
        id: 'ef-stale-1',
        equipment_id: id,
        date: fuelDate,
        team_member: 'Stale Tester',
        fuel_type: 'diesel',
        gallons: 5,
        suppressed: false,
        source: 'admin_add',
      }),
      'equipment_fuelings insert (missed_fueling)'
    );
    return {slug, kind, seededFuelDate: fuelDate};
  }

  if (kind === 'fillup_streak') {
    // Equipment with one every-fillup item ('oil') + 2 fueling rows whose
    // every_fillup_check arrays do NOT include 'oil' → streak=2 on that item.
    // Recent fueling dates (within 14 days) so missed_fueling does NOT also
    // trigger.
    must(
      await supabaseAdmin.from('equipment').insert({
        id,
        name: 'Streak Test Tractor',
        slug,
        category: 'tractors',
        tracking_unit: 'hours',
        status: 'active',
        current_hours: 100,
        every_fillup_items: [{id: 'oil', label: 'Oil OK'}],
      }),
      'equipment insert (fillup_streak)'
    );
    must(
      await supabaseAdmin.from('equipment_fuelings').insert([
        {
          id: 'ef-streak-1',
          equipment_id: id,
          date: daysAgo(2),
          fuel_type: 'diesel',
          gallons: 5,
          hours_reading: 100,
          every_fillup_check: [{id: 'tires', ok: true}], // 'oil' NOT ticked
          suppressed: false,
          source: 'admin_add',
        },
        {
          id: 'ef-streak-2',
          equipment_id: id,
          date: daysAgo(5),
          fuel_type: 'diesel',
          gallons: 5,
          hours_reading: 95,
          every_fillup_check: [{id: 'tires', ok: true}], // 'oil' NOT ticked
          suppressed: false,
          source: 'admin_add',
        },
      ]),
      'equipment_fuelings insert (fillup_streak)'
    );
    return {
      slug,
      kind,
      // Detail: '1 fillup item skipped (2× max streak): Oil OK'
      expectedSubstrings: ['1 fillup item', '2', 'max streak', 'Oil OK'],
    };
  }

  if (kind === 'warranty') {
    // warranty_expiration 30 days from now (within 60-day window). No
    // service_intervals / fillup_items / fuelings → only the warranty
    // path triggers.
    must(
      await supabaseAdmin.from('equipment').insert({
        id,
        name: 'Warranty Test Tractor',
        slug,
        category: 'tractors',
        tracking_unit: 'hours',
        status: 'active',
        current_hours: 100,
        warranty_expiration: daysFromNow(30),
      }),
      'equipment insert (warranty)'
    );
    return {
      slug,
      kind,
      // Detail: 'Warranty expires in 30 days'
      // Day count unstable across midnight; assert stable phrase only.
      expectedSubstrings: ['Warranty expires in', 'day'],
    };
  }

  throw new Error(`homeDashboardEquipmentSeed: invalid kind "${kind}". Expected one of: overdue, upcoming, missed_fueling, fillup_streak, warranty.`);
}
