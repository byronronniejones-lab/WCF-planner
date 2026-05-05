import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {describe, it, expect} from 'vitest';

// ============================================================================
// Equipment Fueling History — Team field dropdown — Hotfix 2 lock
// ============================================================================
// /equipment/<slug> Fueling & Checklist History → Edit Entry: the Team
// field must be a <select> bound to the equipment piece's assigned
// team_members, not a free-text <input>. Locks the contract so future
// edits don't regress to free-text typing of arbitrary names.
// ============================================================================

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..', '..');

describe('Equipment fueling history Team field shape', () => {
  const src = fs.readFileSync(path.join(ROOT, 'src/equipment/EquipmentDetail.jsx'), 'utf8');

  // The expanded fueling-history Edit Entry block has a `Team` label
  // followed by the field. Capture the slice so the regex tests below
  // are scoped to that block, not the whole file.
  const teamBlockMatch = src.match(/Team<\/div>[\s\S]{0,2200}?<\/div>\s*\n\s*<div>\s*<div[^>]*>Gallons/);
  if (!teamBlockMatch) {
    throw new Error(
      'Could not locate the Team-field block between the "Team" label and the "Gallons" label in EquipmentDetail.jsx. ' +
        'If the surrounding markup changed, update this test to scope to the new block.',
    );
  }
  const teamBlock = teamBlockMatch[0];

  it('uses a <select> for the Team field, not <input type="text">', () => {
    expect(teamBlock).toMatch(/<select\b/);
    expect(teamBlock).not.toMatch(/<input\s+type="text"/);
  });

  it('reads options from eq.team_members', () => {
    expect(teamBlock).toMatch(/eq\.team_members/);
  });

  it('preserves legacy values not currently assigned (legacy option)', () => {
    expect(teamBlock).toMatch(/legacy/i);
  });

  it('disables the dropdown when no team members are assigned and no legacy value', () => {
    expect(teamBlock).toMatch(/disabled=\{noOptions\}|disabled\s*=\s*\{[^}]*assignedTM/);
  });

  it('still calls queueFuelingSave on change with the team_member key', () => {
    expect(teamBlock).toMatch(/queueFuelingSave\([^)]*'team_member'/);
  });
});
