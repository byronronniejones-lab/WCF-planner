import { describe, it, expect } from 'vitest';
import { VIEW_TO_PATH, PATH_TO_VIEW, HASH_COMPAT } from './routes.js';

// Tests for the URL ↔ view mapping that drives the Phase 3 router adapter.
// Two invariants matter most: (1) round-trip integrity so the URL sync effects
// don't lose information, and (2) the public webform paths stay byte-stable
// since they're printed on materials in the field (§7 don't-touch).

describe('VIEW_TO_PATH ↔ PATH_TO_VIEW round-trip', () => {
  it('every view in VIEW_TO_PATH round-trips back to itself via PATH_TO_VIEW', () => {
    for (const [view, path] of Object.entries(VIEW_TO_PATH)) {
      expect(PATH_TO_VIEW[path]).toBe(view);
    }
  });

  it('every path in PATH_TO_VIEW points back to a view in VIEW_TO_PATH', () => {
    for (const [path, view] of Object.entries(PATH_TO_VIEW)) {
      expect(VIEW_TO_PATH[view]).toBe(path);
    }
  });

  it('all paths are unique (no two views collapse to the same path)', () => {
    const paths = Object.values(VIEW_TO_PATH);
    expect(new Set(paths).size).toBe(paths.length);
  });

  it('PATH_TO_VIEW has the same number of entries as VIEW_TO_PATH (no info lost)', () => {
    expect(Object.keys(PATH_TO_VIEW).length).toBe(Object.keys(VIEW_TO_PATH).length);
  });
});

describe('HASH_COMPAT', () => {
  it('every hash bookmark maps to a path that exists in PATH_TO_VIEW', () => {
    for (const [, path] of Object.entries(HASH_COMPAT)) {
      expect(PATH_TO_VIEW[path]).toBeDefined();
    }
  });

  it('does not include the supabase recovery hash (SetPasswordScreen parses it directly)', () => {
    const keys = Object.keys(HASH_COMPAT);
    expect(keys.some(k => k.includes('access_token'))).toBe(false);
    expect(keys.some(k => k.includes('recovery'))).toBe(false);
  });
});

describe('canonical anchors (paths printed on field materials per §7)', () => {
  it('home is /', () => {
    expect(VIEW_TO_PATH.home).toBe('/');
  });

  it('public webform paths are byte-stable: /webforms, /addfeed, /weighins', () => {
    expect(VIEW_TO_PATH.webformhub).toBe('/webforms');
    expect(VIEW_TO_PATH.addfeed).toBe('/addfeed');
    expect(VIEW_TO_PATH.weighins).toBe('/weighins');
  });
});
