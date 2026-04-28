// Date + format utilities. Verbatim extract from main.jsx.

export function addDays(dateOrISO, n) {
  const d = typeof dateOrISO === 'string' ? new Date(dateOrISO + 'T12:00:00') : new Date(dateOrISO);
  d.setDate(d.getDate() + n);
  return d;
}
export function toISO(d) {
  return new Date(d).toISOString().split('T')[0];
}
// Canonical calendar display = mm/dd/yy (2-digit month / 2-digit day / 2-digit
// year). Applied site-wide for any ISO date the user sees. Ronnie's request
// 2026-04-23. Accepts either a plain date string (YYYY-MM-DD) or a full ISO
// timestamp (YYYY-MM-DDTHH:MM:...) -- only the date portion is used.
export function fmt(iso) {
  if (!iso) return '—';
  const datePart = String(iso).slice(0, 10);
  const [y, m, d] = datePart.split('-').map(Number);
  if (!y || !m || !d) return '—';
  const mm = String(m).padStart(2, '0');
  const dd = String(d).padStart(2, '0');
  const yy = String(y).slice(-2);
  return mm + '/' + dd + '/' + yy;
}
// Short variant drops the year for compact tiles; still mm/dd.
export function fmtS(iso) {
  if (!iso) return '—';
  const datePart = String(iso).slice(0, 10);
  const [y, m, d] = datePart.split('-').map(Number);
  if (!y || !m || !d) return '—';
  const mm = String(m).padStart(2, '0');
  const dd = String(d).padStart(2, '0');
  return mm + '/' + dd;
}
export function todayISO() {
  return toISO(new Date());
}

// ── HOLIDAY LOGIC ──────────────────────────────────────────────────────────
