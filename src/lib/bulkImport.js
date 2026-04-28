// Shared parsing helpers for the cattle + sheep bulk-import flows.
// Extracted verbatim from src/cattle/CattleBulkImport.jsx (where they were
// previously module-private). Sheep needs the same parsing semantics — duplicating
// invites drift, so callers import from here.

export const VALID_BREED_STATUS = ['Open', 'Pregnant', 'N/A'];

// Returns {value: 'YYYY-MM-DD'} | {value: null} | {error: '...'}.
//   • null / '' → null (caller decides if required).
//   • Date object → ISO date.
//   • Excel serial number → epoch shift to ISO date.
//   • String 'YYYY-MM-DD' → kept as-is.
//   • String 'M/D/YY' or 'M/D/YYYY' → coerced; 2-digit year → +2000.
export function parseImportDate(v) {
  if (v == null || v === '') return {value: null};
  if (v instanceof Date) {
    if (isNaN(v.getTime())) return {error: 'invalid date'};
    return {value: v.toISOString().slice(0, 10)};
  }
  if (typeof v === 'number') {
    var d = new Date(Math.round((v - 25569) * 86400 * 1000));
    if (isNaN(d.getTime())) return {error: 'invalid date number'};
    return {value: d.toISOString().slice(0, 10)};
  }
  var s = String(v).trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return {value: s};
  var m = s.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})$/);
  if (m) {
    var y = parseInt(m[3], 10);
    if (y < 100) y += 2000;
    return {
      value:
        y +
        '-' +
        String(parseInt(m[1], 10)).padStart(2, '0') +
        '-' +
        String(parseInt(m[2], 10)).padStart(2, '0'),
    };
  }
  return {error: 'cannot parse date: ' + s};
}

// Returns {value: number} | {value: null} | {error: '...'}.
//   • Strips $, commas, whitespace before parsing.
export function parseImportNumber(v) {
  if (v == null || v === '') return {value: null};
  if (typeof v === 'number') return {value: v};
  var s = String(v).replace(/[$,\s]/g, '').trim();
  if (s === '') return {value: null};
  var n = Number(s);
  if (!isFinite(n)) return {error: 'cannot parse number: ' + v};
  return {value: n};
}

// Trims a tag value, returns '' for null/undefined.
export function normTagStr(v) {
  if (v == null) return '';
  return String(v).trim();
}
