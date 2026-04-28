import {test, expect} from './fixtures.js';
import path from 'path';

// ============================================================================
// Fuel bill PDF parser end-to-end spec — Phase A8a
// ============================================================================
// Drives the real Bills upload flow with the production Home Oil PDF
// (tests/fixtures/ODBIN-0195942_2.PDF). Locks the §7 fuel-bill contract
// from the operator-facing entry point: file input → pdfjs worker →
// parseFuelBillPdf → modal preview state → Save → Supabase rows.
//
// 3 tests:
//   1  Header parsing           — invoice / dates / totals / tax populate
//                                  the editable preview inputs correctly.
//   2  Line items parsing       — 2 lines (Nonethanol gas + Dyed Diesel)
//                                  with auto-classified fuel types and
//                                  allocated_tax === 0 (Home Oil tax-
//                                  included format detected).
//   3  Save persists            — fuel_bills + fuel_bill_lines rows match
//                                  preview; PDF stored at fb-{id}/{name}.
//
// Save-failure rollback deferred per Codex (brittle to induce without
// production hooks). Tax-exclusive bill format covered by the parser's
// vitest fixture suite (src/lib/fuelBillParser.test.js).
// ============================================================================

const PDF_PATH = path.resolve('tests/fixtures/ODBIN-0195942_2.PDF');

// Header inputs are wrapped in <div><label>Text</label><input/></div> with
// no htmlFor binding (FuelBillsView.jsx:340-348). getByLabel won't work.
// We need to scope by the <label> ELEMENT specifically — the column
// headers in the line-items table are <th>Subtotal</th> / <th>Tax</th> /
// <th>Total</th> with the SAME visible text as the field labels, so a
// generic getByText match would land inside the table when .last() picks
// the deepest match. `label:text-is(...)` anchors to <label> + exact
// text content.
function fieldInput(page, labelText) {
  return page
    .locator('div')
    .filter({has: page.locator(`label:text-is("${labelText}")`)})
    .last()
    .locator('input');
}

async function uploadFixture(page) {
  await page.goto('/admin');
  await page.getByRole('button', {name: 'Fuel Log'}).click();
  await page.getByRole('button', {name: 'Bills'}).click();
  await page.getByRole('button', {name: '+ Upload bill'}).click();

  // Modal title 'Fuel Bill (PDF)' (FuelBillsView.jsx:318).
  await expect(page.getByText('Fuel Bill (PDF)')).toBeVisible({timeout: 5_000});

  await page.locator('input[type="file"]').setInputFiles(PDF_PATH);

  // Parser runs through lazy-loaded pdfjs-dist worker — first parse of a
  // session can take several seconds (worker fetch + WASM init). The UI
  // shows "Parsing…" while running; wait for that to disappear OR for the
  // header label to render (whichever fires first).
  await expect(page.getByText('Parsing…')).toHaveCount(0, {timeout: 30_000});

  // Sanity: a parse failure renders an error banner instead of the preview.
  // If the worker didn't load, this is where we'd find out.
  const err = page.locator('text=/Parse failed:/');
  if ((await err.count()) > 0) {
    throw new Error(`Parse failed: ${(await err.textContent()) || ''}`);
  }

  // Wait for the Header section to render (proves the parser returned
  // a non-null result that populated the preview).
  await expect(page.getByText('Header', {exact: true})).toBeVisible({timeout: 5_000});
}

// --------------------------------------------------------------------------
// Test 1 — header parsing
// --------------------------------------------------------------------------
test('header parsing: invoice / dates / totals populate from real Home Oil PDF', async ({page, fuelBillScenario}) => {
  await uploadFixture(page);

  // Values per PROJECT.md §Part 4 row 2026-04-27 (smoke test of this same
  // PDF). Tax rounding is exact (Math.round(taxSum*100)/100 in parser).
  await expect(fieldInput(page, 'Invoice #')).toHaveValue('IN-0195942');
  await expect(fieldInput(page, 'Invoice date')).toHaveValue('2026-04-01');
  await expect(fieldInput(page, 'Delivery date *')).toHaveValue('2026-03-30');
  await expect(fieldInput(page, 'BOL #')).toHaveValue('417159');

  // Totals: subtotal is derived (total - tax_total) for tax-included
  // bills, so it's a true pre-tax figure. Per the parser's tax-rounded
  // contract: tax === 93.18 exact (not 93.17999999...).
  await expect(fieldInput(page, 'Subtotal')).toHaveValue('1009.28');
  await expect(fieldInput(page, 'Tax')).toHaveValue('93.18');
  await expect(fieldInput(page, 'Total *')).toHaveValue('1102.46');

  // Supplier: parser pulls from the bill header. Home Oil's name varies
  // slightly across bill formats, so contains-match is more robust than
  // exact. (If this becomes flaky, snapshot the exact value.)
  const supplierVal = await fieldInput(page, 'Supplier').inputValue();
  expect(supplierVal.toLowerCase()).toContain('home oil');
});

// --------------------------------------------------------------------------
// Test 2 — line items parsing + tax-included format detection
// --------------------------------------------------------------------------
test('line items: 2 lines auto-classified, allocated_tax === 0 (tax-included)', async ({page, fuelBillScenario}) => {
  await uploadFixture(page);

  const rows = page.locator('table tbody tr');
  await expect(rows).toHaveCount(2);

  // Auto-classification: classifyFuelType() in fuelBillParser.js maps
  // /NONETHANOL/ → gasoline, /DYED|DIESEL/ → diesel. Asserting via the
  // <select>'s rendered value proves the parser ran the classifier AND
  // the preview wired it through.
  const row0 = rows.nth(0);
  const row0Desc = await row0.locator('input').first().inputValue();
  expect(row0Desc.toLowerCase()).toContain('nonethanol');
  await expect(row0.locator('select')).toHaveValue('gasoline');

  const row1 = rows.nth(1);
  const row1Desc = await row1.locator('input').first().inputValue();
  expect(row1Desc.toLowerCase()).toMatch(/dyed.*diesel|diesel/);
  await expect(row1.locator('select')).toHaveValue('diesel');

  // Tax-included format detected → allocated_tax = 0 on every line.
  // The Tax column (7th `<td>`, 0-indexed = 6) renders via money() which
  // returns '$0.00' for 0 and '—' for null. We want '$0.00' (proves the
  // parser explicitly zeroed allocated_tax, not just left it null).
  for (const row of [row0, row1]) {
    const taxCell = row.locator('td').nth(6);
    await expect(taxCell).toHaveText('$0.00');
  }

  // Effective $/gal === unit_price for tax-included bills (also a §7
  // entry). Both columns render with $X.XXXX precision; comparing string
  // values works.
  for (const row of [row0, row1]) {
    const unitPrice = await row.locator('td').nth(4).textContent();
    const effPerGal = await row.locator('td').nth(8).textContent();
    expect(effPerGal?.trim()).toBe(unitPrice?.trim());
  }
});

// --------------------------------------------------------------------------
// Test 3 — Save persists fuel_bills + fuel_bill_lines + PDF storage
// --------------------------------------------------------------------------
test('save: fuel_bills + fuel_bill_lines + PDF storage all populated correctly', async ({
  page,
  fuelBillScenario,
  supabaseAdmin,
}) => {
  await uploadFixture(page);

  // Click Save bill (FuelBillsView.jsx:394). Both lines are auto-
  // classified, so the unclassified-lines validation at line 235-239
  // doesn't fire.
  await page.getByRole('button', {name: 'Save bill'}).click();

  // Modal closes on success — onSaved() fires, parent unmounts modal.
  await expect(page.getByText('Fuel Bill (PDF)')).toHaveCount(0, {timeout: 15_000});

  // Poll for the bill row to land. invoice_number is unique per supplier
  // and predictable from the fixture.
  await expect
    .poll(
      async () => {
        const r = await supabaseAdmin.from('fuel_bills').select('id').eq('invoice_number', 'IN-0195942').maybeSingle();
        return r.data?.id ?? null;
      },
      {timeout: 10_000, message: 'fuel_bills row did not appear after save'},
    )
    .not.toBeNull();

  const bill = await supabaseAdmin.from('fuel_bills').select('*').eq('invoice_number', 'IN-0195942').single();
  expect(bill.error).toBeNull();
  expect(bill.data.invoice_date).toBe('2026-04-01');
  expect(bill.data.delivery_date).toBe('2026-03-30');
  expect(bill.data.bol_number).toBe('417159');
  expect(Number(bill.data.subtotal)).toBeCloseTo(1009.28, 2);
  expect(Number(bill.data.tax_total)).toBeCloseTo(93.18, 2);
  expect(Number(bill.data.total)).toBeCloseTo(1102.46, 2);
  expect(bill.data.supplier?.toLowerCase() || '').toContain('home oil');
  expect(bill.data.pdf_path).toMatch(/^fb-.+\/ODBIN-0195942_2\.PDF$/);

  // Line rows. 2 lines, both with allocated_tax === 0 + effective_per_gal
  // matching unit_price (tax-included contract).
  const lines = await supabaseAdmin.from('fuel_bill_lines').select('*').eq('bill_id', bill.data.id);
  expect(lines.error).toBeNull();
  expect(lines.data).toHaveLength(2);
  for (const l of lines.data) {
    expect(Number(l.allocated_tax)).toBe(0);
    expect(Number(l.effective_per_gal)).toBeCloseTo(Number(l.unit_price), 4);
    expect(['diesel', 'gasoline']).toContain(l.fuel_type);
  }

  // PDF physically uploaded into the fuel-bills bucket.
  const pdf = await supabaseAdmin.storage.from('fuel-bills').download(bill.data.pdf_path);
  expect(pdf.error).toBeNull();
  expect(pdf.data?.size).toBeGreaterThan(10_000); // ~54 KB fixture
});
