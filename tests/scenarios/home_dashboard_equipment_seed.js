// ============================================================================
// HomeDashboard equipment-attention seed — for tests/home_dashboard_equipment.spec.js
// ============================================================================
// One factory, parameterized by kind. Each invocation seeds a single piece of
// equipment positioned to trigger exactly its target alert kind so the spec's
// row locator unambiguously hits a single row.
//
//   seedHomeDashboardEquipment(supabaseAdmin, { kind })
//     kind: 'overdue' | 'upcoming' | 'missed_fueling' | 'fillup_streak' | 'warranty'
//     Returns { slug, kind, expectedSubstrings: [...] } — substrings the spec
//     should assert via toContainText (per Codex's preference for focused
//     signal assertions, not exact full-row text).
//
// All seed values map back to the constants in src/lib/equipment.js
// (MISSED_FUELING_DAYS=14, WARRANTY_WINDOW_DAYS=60) and the local
// UPCOMING_WINDOW=50 in HomeDashboard.jsx. No prod logic / threshold change.
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
    // current_hours=60, interval=100h, no completions → next_due=100, until_due=40 (≤ 50).
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
    return {
      slug,
      kind,
      // Detail: '100hr service due in 40 h'
      expectedSubstrings: ['100hr service', 'due in'],
    };
  }

  if (kind === 'missed_fueling') {
    // No service intervals, no fillup items → only the missed-fueling path
    // triggers. Latest fueling 20 days ago (> MISSED_FUELING_DAYS=14).
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
    return {
      slug,
      kind,
      // Detail: 'No fueling logged for 20 days (last on 2026-04-08 by Stale Tester)'
      // Day count is unstable across midnight; assert stable substrings only.
      expectedSubstrings: ['No fueling logged for', 'last on ' + fuelDate, 'Stale Tester'],
      seededFuelDate: fuelDate,
    };
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
