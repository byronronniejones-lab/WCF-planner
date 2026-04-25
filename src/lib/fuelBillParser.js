// Home Oil fuel-bill parser. Extracts header (invoice + delivery date,
// supplier, BOL, totals), per-fuel-type line items, and the tax block from a
// text-based PDF. Allocates the bill's tax_total proportionally back onto
// each line so the all-in effective $/gal is stored.
//
// pdfjs-dist is lazy-loaded so the main bundle stays small (matches the
// xlsx loader pattern). Worker is disabled (`disableWorker: true`) since
// we're running it in the main thread on small PDFs — Vite + workers gets
// tricky and bills are <100KB.
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
  // No worker — small PDFs, runs fine on main thread.
  mod.GlobalWorkerOptions.workerSrc = '';
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
function grabInvoiceNumber(text) {
  const m = text.match(/Invoice\s+No\s*[:\-]?\s*([A-Z0-9-]+)/i);
  return m ? m[1].trim() : null;
}
function grabInvoiceDate(text) {
  const m = text.match(/Invoice\s+Date\s*[:\-]?\s*(?:[A-Z][a-z]{2}\s+)?(\d{1,2}\/\d{1,2}\/\d{4})/i);
  return m ? parseUSDate(m[1]) : null;
}
function grabDeliveryDate(text) {
  const m = text.match(/Delivery\s+Date\s*[:\-]?\s*(?:[A-Z][a-z]{2}\s+)?(\d{1,2}\/\d{1,2}\/\d{4})/i);
  return m ? parseUSDate(m[1]) : null;
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
  const re = /([A-Za-z][A-Za-z0-9 \-#'.&\/]+?)\s+(\d{2,5})\s+(\d{4,8})\s+([\d,]+\.\d{2})\s+([\d,]+\.\d{2})\s+Net\s+([\d,]+\.\d{4,6})\s+([\d,]+\.\d{2})/g;
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
    if (count > 0 && taxSum > 0) return taxSum;
  }
  // Fallback: tax_total = invoice_total - sum(line_subtotals).
  if (Number.isFinite(invoiceTotal) && Number.isFinite(lineSubtotal)) {
    const diff = invoiceTotal - lineSubtotal;
    return diff > 0 ? Math.round(diff * 100) / 100 : 0;
  }
  return null;
}

// Allocate bill tax_total proportionally across lines (by gallons).
// Stamp allocated_tax + line_total + effective_per_gal onto each line.
function allocateTax(lines, taxTotal) {
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

// Top-level parser. Pass a File or Blob (e.g. from <input type="file">).
export async function parseFuelBillPdf(file) {
  const warnings = [];
  let rawText;
  try {
    rawText = await extractText(file);
  } catch (e) {
    return {rawText: '', header: {}, lines: [], warnings: ['Could not read PDF: ' + (e.message || e)]};
  }

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

  const subtotal = rawLines.reduce((s, l) => s + (l.line_subtotal || 0), 0);
  const tax_total = grabTaxTotal(rawText, subtotal, total);
  const lines = allocateTax(rawLines, tax_total);

  return {
    rawText,
    header: {supplier, invoice_number, invoice_date, delivery_date, bol_number, subtotal, tax_total, total},
    lines,
    warnings,
  };
}
