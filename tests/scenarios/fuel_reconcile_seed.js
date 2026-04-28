// ============================================================================
// Fuel reconciliation scenario seed — for tests/fuel_reconcile.spec.js
// ============================================================================
// Phase A8b locks the §7 purchased ↔ consumed reconciliation contract from
// the UI side. Each test seeds:
//
//   • 1 admin profile (so /admin loads past the role gate)
//   • 1 minimal `equipment` row (FK target for equipment_fuelings)
//   • 1 `fuel_bills` row + 1 `fuel_bill_lines` row → PURCHASED side
//   • N `equipment_fuelings` rows summing to the consumed-gallons target
//   • optional 1 `fuel_supplies` row with destination='cell' for the
//     §7 cell-exclusion test (Test 4)
//
// Single fuel_type per scenario (default 'diesel'). Single fixed month
// ('2026-01') so the spec doesn't have to know about FuelReconcileView's
// month-grouping logic — only the assertions on the row.
//
// Banding math (mirrors src/admin/FuelReconcileView.jsx::varBand):
//   variance % = (consumed − purchased) / purchased × 100
//   |pct| ≤ 5  → green     |pct| ≤ 10 → orange     else → red
// VARIANCE_WARN_PCT = 5 in source; same constant drives both bands.
//
//   seedFuelReconcile(supabaseAdmin, { band, fuelType='diesel',
//                                       includeCellRow=false })
//     band: 'green' | 'orange' | 'red' — picks (purchased, consumed)
//           gallons matching the band (see TARGETS below).
//     includeCellRow: when true, also seeds a fuel_supplies row with
//           destination='cell' that — if §7 contract were violated — would
//           push the band to red. Test 4 asserts the band stays green.
// ============================================================================

import { assertTestDatabase } from '../setup/assertTestDatabase.js';

function must(result, label) {
  if (result?.error) {
    throw new Error(`fuelReconcileSeed [${label}]: ${result.error.message}`);
  }
  return result;
}

// (purchased, consumed) → variance % combinations that land in each band.
// Picked deterministic round-number gallons so signed-text assertions are
// exact ("+2.0%", "-8.0%", "+30.0%"). Cell-exclusion test reuses 'green'.
const TARGETS = {
  green:  { purchased: 100, consumed: 102, expectedPct: '+2.0%'  },  //  +2.0%
  orange: { purchased: 100, consumed: 92,  expectedPct: '-8.0%'  },  //  -8.0%
  red:    { purchased: 100, consumed: 130, expectedPct: '+30.0%' },  // +30.0%
};

const MONTH = '2026-01';
const DELIVERY_DATE = '2026-01-15';

// Cell-row gallons: chosen so that IF the row were counted as consumption,
// total would be 152 gal vs 100 purchased = +52% (red). The §7 contract
// excludes destination='cell' rows so band must remain green at +2%.
const CELL_GALLONS = 50;

export async function seedFuelReconcile(supabaseAdmin, opts = {}) {
  assertTestDatabase(process.env.VITE_SUPABASE_URL || '');

  const { band, fuelType = 'diesel', includeCellRow = false } = opts;
  const target = TARGETS[band];
  if (!target) {
    throw new Error(`fuelReconcileSeed: invalid band "${band}" — expected green | orange | red`);
  }

  // Admin profile (matches the pattern in fuel_bill_seed.js).
  const adminEmail = process.env.VITE_TEST_ADMIN_EMAIL;
  if (!adminEmail) {
    throw new Error('fuelReconcileSeed: VITE_TEST_ADMIN_EMAIL must be set in .env.test.local.');
  }
  const usersResult = await supabaseAdmin.auth.admin.listUsers();
  if (usersResult.error) {
    throw new Error(`fuelReconcileSeed [auth.listUsers]: ${usersResult.error.message}`);
  }
  const adminUser = usersResult.data?.users?.find((u) => u.email === adminEmail);
  if (!adminUser) {
    throw new Error(`fuelReconcileSeed: test admin user "${adminEmail}" missing.`);
  }
  must(
    await supabaseAdmin.from('profiles').upsert(
      { id: adminUser.id, email: adminUser.email, role: 'admin' },
      { onConflict: 'id' }
    ),
    'profiles upsert'
  );

  // Equipment row — minimum FK target for equipment_fuelings.
  must(
    await supabaseAdmin.from('equipment').insert({
      id: 'eq-recon-test',
      name: 'Recon Test Tractor',
      slug: 'recon-test-tractor',
      category: 'tractors',
      tracking_unit: 'hours',
      status: 'active',
      fuel_type: fuelType,
    }),
    'equipment insert'
  );

  // Bill (purchased side). unit_price = $4/gal, all-in for this test
  // (tax_total=0 so additive vs included logic doesn't matter for A8b).
  const unitPrice = 4;
  const subtotal = target.purchased * unitPrice;
  must(
    await supabaseAdmin.from('fuel_bills').insert({
      id: 'b-recon-1',
      supplier: 'Recon Test Supplier',
      invoice_number: 'RECON-001',
      invoice_date: DELIVERY_DATE,
      delivery_date: DELIVERY_DATE,
      bol_number: 'RECON-BOL',
      subtotal,
      tax_total: 0,
      total: subtotal,
      pdf_path: 'fb-recon/test.pdf', // placeholder — never fetched in this spec
    }),
    'fuel_bills insert'
  );
  must(
    await supabaseAdmin.from('fuel_bill_lines').insert({
      id: 'bl-recon-1',
      bill_id: 'b-recon-1',
      description: `Recon ${fuelType}`,
      fuel_type: fuelType,
      gross_units: target.purchased,
      net_units: target.purchased,
      unit_price: unitPrice,
      line_subtotal: subtotal,
      allocated_tax: 0,
      line_total: subtotal,
      effective_per_gal: unitPrice,
    }),
    'fuel_bill_lines insert'
  );

  // Consumed side: split into 2 equipment_fueling rows so the eqCount
  // chip ("2 equipment") proves both rows landed.
  const halfA = Math.floor(target.consumed / 2);
  const halfB = target.consumed - halfA;
  must(
    await supabaseAdmin.from('equipment_fuelings').insert([
      {
        id: 'ef-recon-1',
        equipment_id: 'eq-recon-test',
        date: '2026-01-10',
        fuel_type: fuelType,
        gallons: halfA,
        suppressed: false,
        source: 'admin_add',
      },
      {
        id: 'ef-recon-2',
        equipment_id: 'eq-recon-test',
        date: '2026-01-22',
        fuel_type: fuelType,
        gallons: halfB,
        suppressed: false,
        source: 'admin_add',
      },
    ]),
    'equipment_fuelings insert'
  );

  // Optional cell-destination fuel_supplies row (Test 4).
  if (includeCellRow) {
    must(
      await supabaseAdmin.from('fuel_supplies').insert({
        id: 'fs-recon-cell',
        date: '2026-01-20',
        gallons: CELL_GALLONS,
        fuel_type: fuelType,
        destination: 'cell',
        team_member: 'Test',
        source: 'manual',
      }),
      'fuel_supplies cell insert'
    );
  }

  return {
    month: MONTH,
    fuelType,
    purchased: target.purchased,
    consumed: target.consumed,
    expectedPct: target.expectedPct,
    expectedBand: band,
    cellGallons: includeCellRow ? CELL_GALLONS : 0,
  };
}
