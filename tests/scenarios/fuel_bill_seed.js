// ============================================================================
// Fuel bill scenario seed — for tests/fuel_bill_pdf.spec.js
// ============================================================================
// A8a is the end-to-end pipeline test: PDF file → pdfjs worker → parser →
// modal preview → Save → Supabase rows. The seed is minimal — only the
// admin profile needs to exist so the spec can advance past LoginScreen
// and reach /admin (which requires role='admin'). resetTestDatabase
// already truncates fuel_bills + fuel_bill_lines on each scenario, so
// post-reset state is clean.
//
//   seedFuelBillScenario(supabaseAdmin)
//     Ensures the test admin profile exists. No fuel_bills, no
//     fuel_bill_lines — those rows arrive via the spec's UI upload path.
// ============================================================================

import {assertTestDatabase} from '../setup/assertTestDatabase.js';

function must(result, label) {
  if (result?.error) {
    throw new Error(`fuelBillSeed [${label}]: ${result.error.message}`);
  }
  return result;
}

export async function seedFuelBillScenario(supabaseAdmin) {
  assertTestDatabase(process.env.VITE_SUPABASE_URL || '');
  const adminEmail = process.env.VITE_TEST_ADMIN_EMAIL;
  if (!adminEmail) {
    throw new Error('fuelBillSeed: VITE_TEST_ADMIN_EMAIL must be set in .env.test.local.');
  }
  const usersResult = await supabaseAdmin.auth.admin.listUsers();
  if (usersResult.error) {
    throw new Error(`fuelBillSeed [auth.listUsers]: ${usersResult.error.message}`);
  }
  const adminUser = usersResult.data?.users?.find((u) => u.email === adminEmail);
  if (!adminUser) {
    throw new Error(`fuelBillSeed: test admin user "${adminEmail}" missing.`);
  }
  must(
    await supabaseAdmin
      .from('profiles')
      .upsert({id: adminUser.id, email: adminUser.email, role: 'admin'}, {onConflict: 'id'}),
    'profiles upsert',
  );
  return {adminEmail};
}
