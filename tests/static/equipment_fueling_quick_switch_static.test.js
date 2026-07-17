import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {describe, it, expect} from 'vitest';

// ============================================================================
// Equipment fueling — quick-mode machine-switch state isolation lock
// ============================================================================
// Checklist state keys are equipment-CONFIG scoped (every-fillup item ids,
// interval 'kind:hours_or_km', attachment 'name:kind:value'), NOT
// equipment-INSTANCE scoped. In the quick variant (equipment=null +
// equipmentList) the component survives a machine switch, so without an
// explicit reset machine A's selections would silently render into — and
// submit against — machine B whenever the two share a key, and A's history
// could briefly (or, on a reordered response, permanently) drive B's
// due/next projection.
//
// No live route currently mounts the quick variant (FuelingHub always
// passes a concrete `equipment`), so a browser spec cannot drive the picker.
// This static lock pins the isolation contract until a quick-mode route
// exists; the live-route machine-switch regression lives in
// tests/equipment_fueling_intervals.spec.js.
//
// Locks:
//   1. resetEquipmentScopedState clears ALL equipment-scoped checklist state
//      (fillupTicks, intervalTicks, taskTicks, attachmentTicks,
//      expandedIntervals) plus photos, with best-effort storage cleanup of
//      the unsubmitted uploads.
//   2. The quick-picker onChange invokes the reset on an actual change.
//   3. The history effect clears synchronously BEFORE fetching and cancels a
//      stale async response (switched-away machine can never win).
//   4. Log Another clears photos state — submitted photos belong to the
//      saved record; keeping them in state would both re-attach them to the
//      next log and expose them to the switch cleanup's storage removal.
// ============================================================================

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..', '..');
const formSrc = fs.readFileSync(path.join(ROOT, 'src/webforms/EquipmentFuelingWebform.jsx'), 'utf8');

// Anchor on the reset function body so unrelated setters elsewhere in the
// component cannot satisfy the assertions.
const resetFn = formSrc.match(/function resetEquipmentScopedState\(\)\s*\{[\s\S]*?\n {2}\}/);
const resetBody = resetFn ? resetFn[0] : '';

describe('EquipmentFuelingWebform — quick-mode switch resets equipment-scoped state', () => {
  it('defines resetEquipmentScopedState', () => {
    expect(resetFn, 'expected resetEquipmentScopedState function').not.toBeNull();
  });

  it('clears all five equipment-scoped checklist/expansion sets', () => {
    expect(resetBody).toMatch(/setFillupTicks\(new Set\(\)\)/);
    expect(resetBody).toMatch(/setIntervalTicks\(new Set\(\)\)/);
    expect(resetBody).toMatch(/setTaskTicks\(\{\}\)/);
    expect(resetBody).toMatch(/setAttachmentTicks\(\{\}\)/);
    expect(resetBody).toMatch(/setExpandedIntervals\(new Set\(\)\)/);
  });

  it('clears photos and best-effort removes the unsubmitted uploads from storage', () => {
    expect(resetBody).toMatch(/setPhotos\(\[\]\)/);
    expect(resetBody).toMatch(/from\('equipment-maintenance-docs'\)/);
    expect(resetBody).toMatch(/\.remove\(\[p\.path\]\)/);
    // Best-effort: a failed storage delete must not throw out of the switch.
    expect(resetBody).toMatch(/\.catch\(\(\) => \{\}\)/);
  });

  it('quick-picker onChange invokes the reset when the selected machine actually changes', () => {
    const picker = formSrc.match(/onChange=\{\(e\) => \{[\s\S]*?setSelectedEq\(found\);[\s\S]*?\}\}/);
    expect(picker, 'expected the quick-picker onChange handler').not.toBeNull();
    expect(picker[0]).toMatch(/const changed = \(found\?\.id \|\| null\) !== \(eq\?\.id \|\| null\)/);
    expect(picker[0]).toMatch(/if \(changed\) resetEquipmentScopedState\(\)/);
  });
});

describe('EquipmentFuelingWebform — history isolation across machine switches', () => {
  // Anchor on the history effect: from the setHistory([]) clear through the
  // cleanup return.
  const effect = formSrc.match(/React\.useEffect\(\(\) => \{\s*setHistory\(\[\]\);[\s\S]*?\}, \[eq\]\);/);
  const effectBody = effect ? effect[0] : '';

  it('clears history synchronously BEFORE fetching the new machine', () => {
    expect(effect, 'expected the history effect to open with setHistory([])').not.toBeNull();
    // The clear precedes the fetch inside the same effect body.
    expect(effectBody.indexOf('setHistory([])')).toBeLessThan(effectBody.indexOf("from('equipment_fuelings')"));
  });

  it('cancels a stale response: guarded set + cleanup flag', () => {
    expect(effectBody).toMatch(/let cancelled = false/);
    expect(effectBody).toMatch(/if \(!cancelled && data\) setHistory\(data\)/);
    expect(effectBody).toMatch(/cancelled = true/);
  });
});

describe('EquipmentFuelingWebform — Log Another clears photo state', () => {
  it('the done-screen reset drops photos so the switch cleanup can never delete submitted files', () => {
    // Anchor on the Log Another reset block (the only place doneState returns
    // to 'none' alongside the field resets).
    const logAnother = formSrc.match(/setDoneState\('none'\);[\s\S]*?setPhotos\(\[\]\);/);
    expect(logAnother, 'expected Log Another to reset photos alongside the other fields').not.toBeNull();
  });
});
