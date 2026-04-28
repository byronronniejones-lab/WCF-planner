// Cattle module constants. See CATTLE_DESIGN.md for full module design.
// Verbatim lift from main.jsx (Phase 2 finale) — no value changes.

export const CATTLE_HERDS = ['mommas', 'backgrounders', 'finishers', 'bulls'];
export const CATTLE_OUTCOMES = ['processed', 'deceased', 'sold'];
export const CATTLE_ALL_HERDS = [...CATTLE_HERDS, ...CATTLE_OUTCOMES];

export const CATTLE_HERD_LABELS = {
  mommas: 'Mommas',
  backgrounders: 'Backgrounders',
  finishers: 'Finishers',
  bulls: 'Bulls',
  processed: 'Processed',
  deceased: 'Deceased',
  sold: 'Sold',
};

// Red family palette (matches program palette committed in 524b4c2).
// No purple anywhere. Bulls is wine/deep red; outcomes are neutral.
export const CATTLE_HERD_COLORS = {
  mommas: {bg: '#fef2f2', bd: '#fca5a5', tx: '#991b1b', bar: '#dc2626'}, // red (primary)
  backgrounders: {bg: '#ffedd5', bd: '#fdba74', tx: '#9a3412', bar: '#ea580c'}, // orange
  finishers: {bg: '#fff1f2', bd: '#fda4af', tx: '#9f1239', bar: '#e11d48'}, // rose
  bulls: {bg: '#fee2e2', bd: '#fca5a5', tx: '#7f1d1d', bar: '#991b1b'}, // wine
  processed: {bg: '#f3f4f6', bd: '#d1d5db', tx: '#374151', bar: '#6b7280'},
  deceased: {bg: '#f9fafb', bd: '#e5e7eb', tx: '#6b7280', bar: '#9ca3af'},
  sold: {bg: '#eff6ff', bd: '#bfdbfe', tx: '#1e40af', bar: '#2563eb'},
};

// ── CATTLE BREEDING CONSTANTS ──
export const CATTLE_BULL_EXPOSURE_DAYS = 65;
export const CATTLE_PREG_CHECK_OFFSET_DAYS = 30; // days after bull_exposure_end
export const CATTLE_GESTATION_DAYS = 274; // ~9 months
export const CATTLE_CALVING_WINDOW_DAYS = 65;
export const CATTLE_NURSING_DAYS = 213; // ~7 months
