// ============================================================================
// src/lib/routes.js  —  Phase 3.1: route map scaffolding
// ----------------------------------------------------------------------------
// Single source of truth for the view ↔ URL mapping. Used by the URL sync
// adapter in App (Phase 3.2) to write `view` state into the address bar and
// read it back on mount + on popstate (back/forward button).
//
// Nothing in here imports React or hooks — it's pure data. Safe to import
// from any module, including main.jsx at module scope.
//
// The `view` state machine stays unchanged. setView('X') is still the API
// every component calls. The URL just mirrors `view` (and vice versa on
// back/forward).
// ============================================================================

// view string → URL path. Keep paths lower-kebab-case, program-scoped where
// it makes sense. Home is '/'. Legacy hash bookmarks (/#weighins, /#addfeed,
// /#webforms) map to the clean public-webform paths and are rewritten by
// the hash-compat shim landing in Phase 3.3.
export const VIEW_TO_PATH = {
  // Home
  home: '/',

  // Broiler
  broilerHome: '/broiler',
  timeline: '/broiler/timeline',
  list: '/broiler/batches',
  feed: '/broiler/feed',
  broilerdailys: '/broiler/dailys',
  broilerweighins: '/broiler/weighins',

  // Pig
  pigsHome: '/pig',
  breeding: '/pig/breeding',
  farrowing: '/pig/farrowing',
  sows: '/pig/sows',
  pigbatches: '/pig/batches',
  pigs: '/pig/feed', // `pigs` is the current view string for PigFeedView
  pigdailys: '/pig/dailys',
  pigweighins: '/pig/weighins',

  // Layer
  layersHome: '/layer',
  layers: '/layer/groups', // legacy LayersView — pre-batch-housings layer groups editor
  layerbatches: '/layer/batches',
  layerdailys: '/layer/dailys',
  eggdailys: '/layer/eggs',

  // Cattle
  cattleHome: '/cattle',
  cattleherds: '/cattle/herds',
  cattlebreeding: '/cattle/breeding',
  cattleweighins: '/cattle/weighins',
  cattleforecast: '/cattle/forecast',
  cattlebatches: '/cattle/batches',
  cattledailys: '/cattle/dailys',

  // Sheep
  sheepHome: '/sheep',
  sheepflocks: '/sheep/flocks',
  sheepbatches: '/sheep/batches',
  sheepdailys: '/sheep/dailys',
  sheepweighins: '/sheep/weighins',

  // Equipment
  equipmentHome: '/equipment',
  equipmentFleet: '/equipment/fleet',
  equipmentFuelLog: '/equipment/fuel-log',

  // Admin (logged-in only)
  webforms: '/admin',

  // Public (no-auth) — these also have /#X legacy hash bookmarks that the
  // Phase 3.3 shim rewrites to these clean paths.
  webformhub: '/webforms',
  addfeed: '/addfeed',
  weighins: '/weighins',
  webform: '/webform-pigs', // legacy standalone pig-dailys public form (rare)
  fuelingHub: '/fueling',
  fuelSupply: '/fuel-supply',
};

// Reverse map: path → view. Used by the URL sync adapter on mount and on
// popstate to figure out what view the URL currently points at.
export const PATH_TO_VIEW = Object.fromEntries(Object.entries(VIEW_TO_PATH).map(([v, p]) => [p, v]));

// Legacy hash bookmarks users may have saved in browsers/Slack/email.
// Phase 3.3 reads these once on app mount and history.replaceState()s to
// the corresponding clean path before the router boots.
// NOTE: /#access_token=...&type=recovery is deliberately NOT rewritten —
// SetPasswordScreen parses it from the hash for backward compat with the
// supabase invite/recovery email template.
export const HASH_COMPAT = {
  '#weighins': '/weighins',
  '#addfeed': '/addfeed',
  '#webforms': '/webforms',
};
