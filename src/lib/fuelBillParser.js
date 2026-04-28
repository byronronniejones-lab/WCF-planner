// Home Oil fuel-bill parser. Extracts header (invoice + delivery date,
// supplier, BOL, totals), per-fuel-type line items, and the tax block from a
// text-based PDF. Allocates the bill's tax_total proportionally back onto
// each line so the all-in effective $/gal is stored.
//
// pdfjs-dist is lazy-loaded so the main bundle stays small (matches the
// xlsx loader pattern). pdfjs v4+ REQUIRES a worker — setting workerSrc=''
// silently fails (getDocument() never resolves). Vite's `?url` suffix
// emits the worker as a separate static asset and hands us back the URL.
//
// All field extraction uses regex tolerant to the way pdfjs reconstructs
// lines (whitespace can be wonky between positioned text fragments). If
// the source format changes (different supplier, layout) the parser falls
// back to "best effort" — admin can always edit fields before saving.
//
// Returns:
//   { rawText, header:{supplier,invoice_number,invoice_date,delivery_date,
//                      bol_number,subtotal,tax_total,total},
//     lines:[{description,fuel_type,gross_units,net_units,unit_price,
//             line_subtotal,allocated_tax,line_total,effective_per_gal}],
//     warnings:[] }

let _pdfjs = null;
async function loadPdfjs() {
  if (_pdfjs) return _pdfjs;
  const mod = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const workerUrl = (await import('pdfjs-dist/legacy/build/pdf.worker.mjs?url')).default;
  mod.GlobalWorkerOptions.workerSrc = workerUrl;
  _pdfjs = mod;
  return mod;
}

// Parse mm/dd/yyyy into ISO yyyy-mm-dd. Returns null on bad input.
function parseUSDate(s) {
  if (!s) return null;
  const m = String(s).match(/(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (!m) return null;
  const [, mm, dd, yyyy] = m;
  return yyyy + '-' + String(mm).padStart(2, '0') + '-' + String(dd).padStart(2, '0');
}

function parseMoney(s) {
  if (s == null) return null;
  const cleaned = String(s).replace(/[$,]/g, '').trim();
  const n = parseFloat(cleaned);
  return Number.isFinite(n) ? n : null;
}

// Map a description string to a canonical fuel_type code.
// Order matters: check more-specific first.
function classifyFuelType(desc) {
  const d = (desc || '').toUpperCase();
  if (/\bDEF\b/.test(d)) return 'def';
  if (/DIESEL|DYED/.test(d)) return 'diesel';
  if (/NONETHANOL|NON-?ETHANOL|GASOLINE|GAS\b|UNLEADED|REG(?:ULAR)?|PREMIUM/.test(d)) return 'gasoline';
  return null;
}

// Extract raw text from a PDF File/Blob. pdfjs returns positioned text
// fragments; we group by Y to rebuild lines, then sort by X within each
// line. That gives us a more stable text stream than a flat concat.
async function extractText(file) {
  const pdfjs = await loadPdfjs();
  const arrayBuf = await file.arrayBuffer();
  const doc = await pdfjs.getDocument({data: new Uint8Array(arrayBuf)}).promise;
  const pageLines = [];
  for (let p = 1; p <= doc.numPages; p++) {
    const page = await doc.getPage(p);
    const content = await page.getTextContent();
    // Group by approximate Y. transform[5] is Y (origin baseline).
    const rows = new Map();
    for (const item of content.items) {
      const y = Math.round((item.transform[5] || 0) * 2) / 2;  // half-pt buckets
      const x = item.transform[4] || 0;
      if (!rows.has(y)) rows.set(y, []);
      rows.get(y).push({x, str: item.str});
    }
    const ys = Array.from(rows.keys()).sort((a, b) => b - a); // top-down
    for (const y of ys) {
      const row = rows.get(y).sort((a, b) => a.x - b.x).map(r => r.str).join(' ');
      pageLines.push(row);
    }
  }
  return pageLines.join('\n');
}

// Header field grabbers. Each returns string or null.
//
// Home Oil's PDF layout interleaves the right-column header fields with the
// left-column address block: pdfjs's Y-grouping puts address text and header
// labels at the same Y bucket on the same logical line, AND the values for
// "Invoice No" / "Invoice Date" / "Delivery Date" frequently land on the line
// BEFORE their label (because the value sits at slightly higher Y than the
// label glyph baseline). Same-line "label: value" lookup misses both cases.
//
// findValueNearLabel does a line-aware search: try the label's own line
// first (after a colon/hyphen), then probe ±1 then ±2 lines for the value
// pattern. Catches both the inline form and Home Oil's split form.
function findValueNearLabel(text, labelRegex, valuePattern) {
  const lines = text.split('\n');
  for (let i = 0; i < lines.length; i++) {
    if (!labelRegex.test(lines[i])) continue;
    // Same line, after the colon.
    const sameLine = lines[i].match(/[-:]\s*(.+)$/);
    if (sameLine) {
      const m = sameLine[1].match(valuePattern);
      if (m) return m[1];
    }
    // Neighbors. Order matters when multiple lines match — Home Oil puts the
    // value on the line BEFORE the label, so try -1 first.
    for (const offset of [-1, 1, -2, 2]) {
      const j = i + offset;
      if (j < 0 || j >= lines.length) continue;
      const m = lines[j].match(valuePattern);
      if (m) return m[1];
    }
  }
  return null;
}

// Invoice-number-like pattern. Requires at least one letter so pure-digit
// strings (street numbers, ZIPs, account IDs) don't match. Allows multi-
// segment IDs like "HO-2026-04001".
const ID_PAT = /\b([A-Z]+-?\d+(?:-[A-Z0-9]+)*)\b/;
// Date pattern with optional 3-letter day prefix (Home Oil prints "Wed 04/01/2026").
const DATE_PAT = /(?:[A-Z][a-z]{2}\s+)?(\d{1,2}\/\d{1,2}\/\d{4})/;

function grabInvoiceNumber(text) {
  return findValueNearLabel(text, /Invoice\s+No\b/i, ID_PAT);
}
function grabInvoiceDate(text) {
  const raw = findValueNearLabel(text, /Invoice\s+Date\b/i, DATE_PAT);
  return raw ? parseUSDate(raw) : null;
}
function grabDeliveryDate(text) {
  const raw = findValueNearLabel(text, /Delivery\s+Date\b/i, DATE_PAT);
  return raw ? parseUSDate(raw) : null;
}
function grabSupplier(text) {
  // First line of the document is usually the supplier name (e.g. "Home Oil Company, Inc.").
  // Or look for a known list. For v1: if "Home Oil" appears anywhere, that's the supplier.
  if (/home\s+oil/i.test(text)) return 'Home Oil Company, Inc.';
  // Generic fallback: first non-empty line.
  const first = text.split('\n').map(s => s.trim()).find(s => s.length > 4 && s.length < 80 && /^[A-Z]/.test(s));
  return first || null;
}
function grabInvoiceTotal(text) {
  // The grand-total dollar appears after "Invoice Total" with Gross/Net columns.
  // Capture the LAST $X,XXX.XX preceding "Payment Terms" or end of doc.
  const m = text.match(/Invoice\s+Total[\s\S]*?\$\s?([\d,]+\.\d{2})/i);
  if (m) return parseMoney(m[1]);
  // Fallback: last $-prefixed amount in the doc.
  const all = text.match(/\$\s?([\d,]+\.\d{2})/g);
  if (all && all.length) return parseMoney(all[all.length - 1]);
  return null;
}
function grabBOL(text) {
  // BOL appears in line-item rows. Grab the first occurrence.
  const m = text.match(/(?:^|\s)(\d{6,})\b/);
  return m ? m[1] : null;
}

// Line item parser. Looks for rows with shape:
//   <description>  <site>  <bol>  <gross>  <net>  Net  <unit_price>  <line_total>
// where description is a multi-word product, site/bol are 3+ digit ints,
// gross/net are decimals, "Net" is the basis literal, unit_price is 6-decimal,
// line_total is 2-decimal.
function grabLines(text) {
  const lines = [];
  // Anchor on " Net " between net_units and unit_price — that's the basis literal.
  // Use a tolerant regex that allows extra whitespace and commas.
  const re = /([A-Za-z][-A-Za-z0-9 #'.&/]+?)\s+(\d{2,5})\s+(\d{4,8})\s+([\d,]+\.\d{2})\s+([\d,]+\.\d{2})\s+Net\s+([\d,]+\.\d{4,6})\s+([\d,]+\.\d{2})/g;
  let m;
  while ((m = re.exec(text)) !== null) {
    const [, desc, site, bol, gross, net, unitPrice, total] = m;
    const description = desc.trim().replace(/\s+/g, ' ');
    // Filter false positives (e.g. tax-block rows that match the digit pattern).
    if (/^(federal|florida|okaloosa|state|tax|excise|sales)/i.test(description)) continue;
    lines.push({
      description,
      fuel_type: classifyFuelType(description),
      from_site: site,
      bol_number: bol,
      gross_units: parseMoney(gross),
      net_units: parseMoney(net),
      unit_price: parseMoney(unitPrice),
      line_subtotal: parseMoney(total),
    });
  }
  return lines;
}

// Tax block parser. Sums every "Amount" column entry in the
// "Tax and Other Charges Included in Price" section.
function grabTaxTotal(text, lineSubtotal, invoiceTotal) {
  // First try: match the tax block header and parse line amounts until "Invoice Total".
  const blockMatch = text.match(/Tax\s+and\s+Other\s+Charges[\s\S]*?(?=Invoice\s+Total|$)/i);
  if (blockMatch) {
    // Extract the trailing $ amount on each line (last decimal in each line).
    const block = blockMatch[0];
    const blockLines = block.split('\n');
    let taxSum = 0;
    let count = 0;
    for (const ln of blockLines) {
      // Match a line that ends with a decimal money amount and isn't the header.
      if (/^Tax\s+and\s+Other/i.test(ln.trim())) continue;
      // "Federal - Federal Excise Gas         73.00 Net 0.183000 13.36"
      // We want the LAST decimal on the line (the Amount column).
      const amounts = ln.match(/(\d+\.\d{2})(?!\d)/g);
      if (amounts && amounts.length >= 1) {
        taxSum += parseFloat(amounts[amounts.length - 1]);
        count++;
      }
    }
    if (count > 0 && taxSum > 0) return Math.round(taxSum * 100) / 100;
  }
  // Fallback: tax_total = invoice_total - sum(line_subtotals).
  if (Number.isFinite(invoiceTotal) && Number.isFinite(lineSubtotal)) {
    const diff = invoiceTotal - lineSubtotal;
    return diff > 0 ? Math.round(diff * 100) / 100 : 0;
  }
  return null;
}

// Allocate bill tax_total across lines.
//
// Two formats supported:
//
//   • Tax-INCLUDED format (Home Oil and any bill whose tax block header reads
//     "Tax and Other Charges Included in Price"). The printed unit_price IS
//     already the all-in (post-tax) $/gal — the tax block is informational.
//     allocated_tax = 0, line_total = line_subtotal, effective_per_gal =
//     unit_price. Sum of line_totals matches the invoice total.
//
//   • Tax-EXCLUSIVE format (legacy / generic). The printed unit_price is
//     pre-tax; the bill's tax_total is added on top. We allocate it back to
//     each line proportionally by gallons.
//
// Stamps allocated_tax + line_total + effective_per_gal onto each line.
function allocateTax(lines, taxTotal, opts = {}) {
  if (opts.taxIncludedInPrice) {
    return lines.map(l => ({
      ...l,
      allocated_tax: 0,
      line_total: l.line_subtotal,
      effective_per_gal: l.net_units > 0
        ? Math.round((l.unit_price || 0) * 1000000) / 1000000
        : null,
    }));
  }
  const totalGallons = lines.reduce((s, l) => s + (l.net_units || 0), 0);
  if (totalGallons <= 0 || !Number.isFinite(taxTotal) || taxTotal <= 0) {
    return lines.map(l => ({
      ...l,
      allocated_tax: 0,
      line_total: l.line_subtotal,
      effective_per_gal: l.net_units > 0 ? l.line_subtotal / l.net_units : null,
    }));
  }
  return lines.map(l => {
    const share = (l.net_units || 0) / totalGallons;
    const allocated_tax = Math.round(taxTotal * share * 100) / 100;
    const line_total = Math.round(((l.line_subtotal || 0) + allocated_tax) * 100) / 100;
    const effective_per_gal = l.net_units > 0 ? Math.round((line_total / l.net_units) * 1000000) / 1000000 : null;
    return {...l, allocated_tax, line_total, effective_per_gal};
  });
}

// Pure text → parsed-bill function. Same logic as parseFuelBillPdf, but takes
// already-extracted text so it can be unit-tested without pdfjs / a real PDF.
// Returns {header, lines, warnings}; does NOT include rawText (the caller
// already has it as the input).
export function parseFuelBillText(rawText) {
  const warnings = [];

  const supplier        = grabSupplier(rawText);
  const invoice_number  = grabInvoiceNumber(rawText);
  const invoice_date    = grabInvoiceDate(rawText);
  const delivery_date   = grabDeliveryDate(rawText);
  const bol_number      = grabBOL(rawText);
  const total           = grabInvoiceTotal(rawText);
  const rawLines        = grabLines(rawText);

  if (rawLines.length === 0) warnings.push('No fuel line items found — did the PDF format change?');
  if (!total)               warnings.push('Could not find invoice total.');
  if (!invoice_date)        warnings.push('Could not find invoice date.');
  if (!delivery_date)       warnings.push('Could not find delivery date.');
  for (const l of rawLines) {
    if (!l.fuel_type) warnings.push('Could not classify fuel type for "' + l.description + '" — pick manually.');
  }

  // Home Oil prints "Tax and Other Charges Included in Price" above its tax
  // block — the unit_price column is already the all-in (post-tax) $/gal.
  // Without this detection the parser double-counts tax (adds the bill's
  // tax_total on top of unit_prices that already include it).
  const taxIncludedInPrice = /Tax\s+and\s+Other\s+Charges\s+Included\s+in\s+Price/i.test(rawText);

  const linesSubtotal = rawLines.reduce((s, l) => s + (l.line_subtotal || 0), 0);
  const tax_total = grabTaxTotal(rawText, linesSubtotal, total);
  // For tax-included bills the line subtotals are post-tax — back out the
  // bill tax_total to derive a true pre-tax header subtotal. For tax-exclusive
  // bills line subtotals are already pre-tax, so the sum is the subtotal.
  const subtotal = (taxIncludedInPrice && Number.isFinite(total) && Number.isFinite(tax_total))
    ? Math.round((total - tax_total) * 100) / 100
    : linesSubtotal;
  const lines = allocateTax(rawLines, tax_total, {taxIncludedInPrice});

  return {
    header: {supplier, invoice_number, invoice_date, delivery_date, bol_number, subtotal, tax_total, total},
    lines,
    warnings,
  };
}

// Top-level parser. Pass a File or Blob (e.g. from <input type="file">).
// Thin wrapper: extract text via pdfjs, then delegate to parseFuelBillText.
// Result includes rawText for downstream diagnostics (parsed_data audit blob).
export async function parseFuelBillPdf(file) {
  let rawText;
  try {
    rawText = await extractText(file);
  } catch (e) {
    return {rawText: '', header: {}, lines: [], warnings: ['Could not read PDF: ' + (e.message || e)]};
  }
  const result = parseFuelBillText(rawText);
  return {rawText, ...result};
}
