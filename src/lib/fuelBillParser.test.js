import { describe, it, expect } from 'vitest';
import { parseFuelBillText } from './fuelBillParser.js';

// Tests for the fuel-bill parser. Use synthetic text fixtures matching the
// post-pdfjs extracted format (lines reconstructed by Y-grouping + X-sort).
// No PDF fixtures — parseFuelBillPdf is the thin pdfjs wrapper around the
// text function under test here.
//
// Coverage spans both bill formats:
//   • Home Oil — "Tax and Other Charges Included in Price" tag means each
//     line's printed unit_price + Total is already post-tax. allocated_tax = 0.
//   • Generic / tax-exclusive — no "Included in Price" tag; the parser
//     derives tax (total − subtotal fallback) and allocates by gallons.

const HOME_OIL_HAPPY_SINGLE_LINE = [
  'Home Oil Company, Inc.',
  'Invoice No: HO-2026-04001',
  'Invoice Date: 04/15/2026',
  'Delivery Date: 04/15/2026',
  '',
  'Diesel #2 ULSD 100 123456 500.00 500.00 Net 3.000000 1500.00',
  '',
  'Tax and Other Charges Included in Price',
  'Federal Excise Diesel       500.00 Net 0.200000 100.00',
  '',
  'Invoice Total $1500.00',
  'Payment Terms: Net 30',
].join('\n');

const HOME_OIL_HAPPY_MULTI_LINE = [
  'Home Oil Company, Inc.',
  'Invoice No: HO-2026-04002',
  'Invoice Date: 04/20/2026',
  'Delivery Date: 04/20/2026',
  '',
  'Diesel #2 ULSD 100 234567 500.00 500.00 Net 3.000000 1500.00',
  'Nonethanol 87 100 234567 200.00 200.00 Net 3.000000 600.00',
  '',
  'Tax and Other Charges Included in Price',
  'Federal Excise Diesel       500.00 Net 0.200000 100.00',
  'Florida Sales Tax           700.00 Net 0.050000 35.00',
  '',
  'Invoice Total $2100.00',
].join('\n');

const GENERIC_TAX_EXCLUSIVE = [
  'Acme Fuel Co',
  'Invoice No: GENERIC-001',
  'Invoice Date: 04/15/2026',
  'Delivery Date: 04/15/2026',
  '',
  'Diesel #2 ULSD 100 555000 100.00 100.00 Net 3.000000 300.00',
  '',
  'Invoice Total $310.00',
].join('\n');

describe('parseFuelBillText — Home Oil (tax-included) happy paths', () => {
  it('parses a single-line invoice end-to-end with zero warnings', () => {
    const out = parseFuelBillText(HOME_OIL_HAPPY_SINGLE_LINE);
    expect(out.warnings).toEqual([]);
    expect(out.header.supplier).toBe('Home Oil Company, Inc.');
    expect(out.header.invoice_number).toBe('HO-2026-04001');
    expect(out.header.invoice_date).toBe('2026-04-15');
    expect(out.header.delivery_date).toBe('2026-04-15');
    expect(out.header.bol_number).toBe('123456');
    expect(out.header.tax_total).toBe(100);
    expect(out.header.total).toBe(1500);
    // Tax-included: header subtotal = total − tax (true pre-tax).
    expect(out.header.subtotal).toBe(1400);
    expect(out.lines).toHaveLength(1);
    const [d] = out.lines;
    expect(d.description).toBe('Diesel #2 ULSD');
    expect(d.fuel_type).toBe('diesel');
    expect(d.gross_units).toBe(500);
    expect(d.net_units).toBe(500);
    expect(d.unit_price).toBe(3);
    expect(d.line_subtotal).toBe(1500);
    // Tax-included: don't add tax to line_total — unit_price is already all-in.
    expect(d.allocated_tax).toBe(0);
    expect(d.line_total).toBe(1500);
    expect(d.effective_per_gal).toBe(3);
  });

  it('parses a multi-line invoice and keeps tax block informational only', () => {
    const out = parseFuelBillText(HOME_OIL_HAPPY_MULTI_LINE);
    expect(out.warnings).toEqual([]);
    expect(out.lines).toHaveLength(2);
    expect(out.header.tax_total).toBe(135);
    expect(out.header.total).toBe(2100);
    // Sum of line_totals must equal invoice total, so reconciliation cost
    // doesn't over-state the month.
    const sumLineTotals = out.lines.reduce((s, l) => s + l.line_total, 0);
    expect(sumLineTotals).toBe(2100);
    expect(out.header.subtotal).toBe(1965);
    const diesel = out.lines.find(l => l.fuel_type === 'diesel');
    const gas    = out.lines.find(l => l.fuel_type === 'gasoline');
    expect(diesel.line_subtotal).toBe(1500);
    expect(diesel.line_total).toBe(1500);
    expect(diesel.allocated_tax).toBe(0);
    expect(diesel.effective_per_gal).toBe(3);
    expect(gas.line_subtotal).toBe(600);
    expect(gas.line_total).toBe(600);
    expect(gas.allocated_tax).toBe(0);
    expect(gas.effective_per_gal).toBe(3);
  });

  it('classifies common fuel descriptions to canonical types', () => {
    // Run separate single-line invoices for each canonical type to exercise
    // the classifier through the public API. DEF takes priority over diesel.
    const cases = [
      { desc: 'DEF Bulk',          expected: 'def' },
      { desc: 'Dyed Diesel',       expected: 'diesel' },
      { desc: 'Diesel #2 ULSD',    expected: 'diesel' },
      { desc: 'Nonethanol 87',     expected: 'gasoline' },
      { desc: 'Unleaded Regular',  expected: 'gasoline' },
      { desc: 'Premium Gasoline',  expected: 'gasoline' },
    ];
    for (const { desc, expected } of cases) {
      const text = [
        'Home Oil Company, Inc.',
        'Invoice No: HO-CLASSIFY',
        'Invoice Date: 04/15/2026',
        'Delivery Date: 04/15/2026',
        `${desc} 100 123456 100.00 100.00 Net 3.000000 300.00`,
        'Invoice Total $300.00',
      ].join('\n');
      const out = parseFuelBillText(text);
      expect(out.lines, `parsing failed for "${desc}"`).toHaveLength(1);
      expect(out.lines[0].fuel_type, `wrong type for "${desc}"`).toBe(expected);
    }
  });
});

describe('parseFuelBillText — Home Oil pdfjs extraction quirks', () => {
  // pdfjs's Y-grouping puts the right-column header values on the line BEFORE
  // their labels, AND can column-merge the address into the label line. The
  // line-aware label search must skip the merged address noise and pick up
  // the correct value from the neighbor line.
  it('finds invoice # / dates when value lands on the line BEFORE the label', () => {
    const text = [
      'IN-0195942',                                     // value (invoice #)
      'Home Oil Company, Inc. Invoice No:',             // label, with address-column noise prefix
      '5744 E US Highway 84',                           // street # — must NOT be captured as invoice #
      'Wed 04/01/2026',                                 // value (invoice date)
      'Invoice Date:',                                  // label
      'Cowarts, AL 36321',
      'Mon 03/30/2026',                                 // value (delivery date)
      'Delivery Date:',                                 // label
      '',
      'Diesel #2 ULSD 100 417159 100.00 100.00 Net 3.000000 300.00',
      'Tax and Other Charges Included in Price',
      'Federal Excise Diesel       100.00 Net 0.200000 50.00',
      'Invoice Total $300.00',
    ].join('\n');
    const out = parseFuelBillText(text);
    expect(out.header.invoice_number).toBe('IN-0195942');
    expect(out.header.invoice_date).toBe('2026-04-01');
    expect(out.header.delivery_date).toBe('2026-03-30');
    expect(out.warnings).not.toContain('Could not find invoice date.');
    expect(out.warnings).not.toContain('Could not find delivery date.');
  });
});

describe('parseFuelBillText — generic tax-exclusive (additive) format', () => {
  it('falls back to additive tax allocation when "Included in Price" tag is absent', () => {
    const out = parseFuelBillText(GENERIC_TAX_EXCLUSIVE);
    expect(out.header.total).toBe(310);
    // No tax block + no "Included in Price" → tax derived from total - subtotal.
    expect(out.header.tax_total).toBe(10);
    // Tax-exclusive header subtotal = sum of line_subtotals (pre-tax).
    expect(out.header.subtotal).toBe(300);
    expect(out.lines).toHaveLength(1);
    const [line] = out.lines;
    expect(line.line_subtotal).toBe(300);
    // Additive: full $10 tax falls on the only line.
    expect(line.allocated_tax).toBe(10);
    expect(line.line_total).toBe(310);
    expect(line.effective_per_gal).toBe(3.1);
  });
});

describe('parseFuelBillText — failure / warning cases', () => {
  it('empty text produces all-null header + zero lines + every header warning', () => {
    const out = parseFuelBillText('');
    expect(out.lines).toEqual([]);
    expect(out.warnings).toContain('No fuel line items found — did the PDF format change?');
    expect(out.warnings).toContain('Could not find invoice total.');
    expect(out.warnings).toContain('Could not find invoice date.');
    expect(out.warnings).toContain('Could not find delivery date.');
    expect(out.header.supplier).toBeNull();
    expect(out.header.invoice_number).toBeNull();
    expect(out.header.invoice_date).toBeNull();
    expect(out.header.delivery_date).toBeNull();
    expect(out.header.total).toBeNull();
  });

  it('missing dates and total emit specific warnings but lines still parse', () => {
    const text = [
      'Home Oil Company, Inc.',
      'Diesel #2 ULSD 100 123456 500.00 500.00 Net 3.000000 1500.00',
    ].join('\n');
    const out = parseFuelBillText(text);
    expect(out.lines).toHaveLength(1);
    expect(out.lines[0].fuel_type).toBe('diesel');
    expect(out.header.supplier).toBe('Home Oil Company, Inc.');
    expect(out.header.invoice_date).toBeNull();
    expect(out.header.delivery_date).toBeNull();
    expect(out.warnings).toContain('Could not find invoice date.');
    expect(out.warnings).toContain('Could not find delivery date.');
  });

  it('unclassifiable fuel description emits a per-line warning naming the description', () => {
    const text = [
      'Home Oil Company, Inc.',
      'Invoice No: HO-2026-04003',
      'Invoice Date: 04/15/2026',
      'Delivery Date: 04/15/2026',
      'Mystery Fuel XYZ 100 123456 500.00 500.00 Net 3.000000 1500.00',
      'Invoice Total $1500.00',
    ].join('\n');
    const out = parseFuelBillText(text);
    expect(out.lines).toHaveLength(1);
    expect(out.lines[0].fuel_type).toBeNull();
    expect(out.warnings).toContain('Could not classify fuel type for "Mystery Fuel XYZ" — pick manually.');
    // Should NOT have date/total warnings — those parsed fine.
    expect(out.warnings).not.toContain('Could not find invoice date.');
    expect(out.warnings).not.toContain('Could not find invoice total.');
  });
});
