import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {describe, it, expect} from 'vitest';

// Record Page Visual Consistency CP4 — EquipmentDetail adopts shared control
// styling on the expanded fueling-history edit row, WITHOUT changing the 800ms
// autosave, the fueling Team dropdown contract, photos/manuals/lightbox, the
// meter panel, or service/materials/warranty math.
//
// Note: the equipment spec/details inline fields were previously moved to the
// /admin Equipment modal, so there are no inline spec fields left on this page
// to migrate; queueFieldSave remains defined (with its 800ms debounce) but is
// no longer wired to a rendered field.

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..', '..');
const src = fs.readFileSync(path.join(ROOT, 'src/equipment/EquipmentDetail.jsx'), 'utf8');

describe('CP4: EquipmentDetail fueling edit row uses shared controls', () => {
  it('imports + uses shared record controls', () => {
    expect(src).toContain("from '../shared/recordPageControls.jsx'");
    expect(src).toContain('style={recordControl}');
    expect(src).toContain('recordTextarea');
  });

  it('preserves the 800ms autosave on spec + fueling saves', () => {
    expect(src).toContain('function queueFieldSave');
    expect(src).toContain('function queueFuelingSave');
    // Both debounced timers still fire at 800ms.
    expect((src.match(/}, 800\)/g) || []).length).toBeGreaterThanOrEqual(2);
  });

  it('fueling saves still write equipment_fuelings via queueFuelingSave', () => {
    expect(src).toContain("from('equipment_fuelings')");
    expect(src).toContain("queueFuelingSave(f.id, 'date'");
    expect(src).toContain("queueFuelingSave(f.id, 'gallons'");
    expect(src).toContain("queueFuelingSave(f.id, 'comments'");
  });

  it('preserves the equipment-specific fueling Team dropdown contract', () => {
    // Options come from eq.team_members, legacy values stay selectable, the
    // no-options disabled state remains, and the team field saves via
    // queueFuelingSave(..., 'team_member', ...). NOT the global TeamMemberSelect.
    expect(src).toContain('eq.team_members');
    expect(src).toContain('legacy — not currently assigned');
    expect(src).toContain('No team members assigned');
    expect(src).toContain("queueFuelingSave(f.id, 'team_member'");
    expect(src).not.toContain('TeamMemberSelect');
  });

  it('keeps photos / manuals / lightbox / meter / collaboration intact', () => {
    expect(src).toContain('EquipmentMeterStatusPanel');
    expect(src).toContain('ManualsCard');
    expect(src).toContain('setLightbox');
    expect(src).toContain('RecordCollaborationSection');
    // Fueling + maintenance photo arrays still rendered.
    expect(src).toContain('f.photos');
    expect(src).toContain('m.photos');
  });
});
