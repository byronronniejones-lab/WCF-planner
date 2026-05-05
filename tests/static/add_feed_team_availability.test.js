import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {describe, it, expect} from 'vitest';
import {TEAM_AVAILABILITY_FORM_KEYS, availableNamesFor, setHidden} from '../../src/lib/teamAvailability.js';

// ============================================================================
// Add Feed team-member availability — Hotfix 1 lock
// ============================================================================
// Public /addfeed must respect the central Team Member Availability admin
// just like cattle-dailys, fuel-supply, etc. Lock both halves:
//   1. TEAM_AVAILABILITY_FORM_KEYS includes 'add-feed' so the admin editor
//      renders an "Add Feed" group.
//   2. AddFeedWebform.jsx loads availability and pipes it through
//      availableNamesFor('add-feed', ...) — i.e. it does NOT just call
//      activeNames(roster) anymore.
// ============================================================================

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..', '..');

describe('Add Feed availability wiring', () => {
  it('exposes "add-feed" as a form key', () => {
    expect(TEAM_AVAILABILITY_FORM_KEYS).toContain('add-feed');
  });

  it('availableNamesFor("add-feed", ...) hides ids listed in hiddenIds', () => {
    const roster = [
      {id: 'tm-alice', name: 'ALICE'},
      {id: 'tm-bob', name: 'BOB'},
      {id: 'tm-carl', name: 'CARL'},
    ];
    const av = setHidden({forms: {}}, 'add-feed', 'tm-bob', true);
    const visible = availableNamesFor('add-feed', roster, av);
    expect(visible).toEqual(['ALICE', 'CARL']);
  });

  it('availableNamesFor("add-feed", ...) returns all active when no hidden ids', () => {
    const roster = [
      {id: 'tm-alice', name: 'ALICE'},
      {id: 'tm-bob', name: 'BOB'},
    ];
    expect(availableNamesFor('add-feed', roster, {forms: {}})).toEqual(['ALICE', 'BOB']);
  });

  it('AddFeedWebform.jsx wires through availableNamesFor("add-feed", ...)', () => {
    const src = fs.readFileSync(path.join(ROOT, 'src/webforms/AddFeedWebform.jsx'), 'utf8');
    expect(src).toMatch(/from '\.\.\/lib\/teamAvailability\.js'/);
    expect(src).toMatch(/loadAvailability/);
    expect(src).toMatch(/availableNamesFor\(\s*'add-feed'/);
    // The legacy `activeNames(roster)` direct call is gone — we want the
    // dropdown going through the availability filter, not the raw roster.
    expect(src).not.toMatch(/setAllTeamMembers\(activeNames\(roster\)\)/);
  });

  it('WebformsAdminView.jsx renders an "Add Feed" label for the add-feed form key', () => {
    const src = fs.readFileSync(path.join(ROOT, 'src/webforms/WebformsAdminView.jsx'), 'utf8');
    expect(src).toMatch(/'add-feed':\s*'Add Feed'/);
  });
});
