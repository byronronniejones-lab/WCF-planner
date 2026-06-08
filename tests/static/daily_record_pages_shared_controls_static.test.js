import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {describe, it, expect} from 'vitest';

// Daily-report hotfix (parts 3+4 + scope generalization): the six daily record
// pages must share one generic record-page controls helper — a responsive
// label/value grid, consistent control width, a locked Team Member
// display, and mm/dd/yyyy titles — instead of bespoke per-page field-row /
// input / textarea styles. This is the reusable site-wide foundation; other
// record pages migrate onto it in a later visual-consistency lane.

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..', '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

const DAILY_PAGES = [
  'src/broiler/PoultryDailyPage.jsx',
  'src/layer/LayerDailyPage.jsx',
  'src/layer/EggDailyPage.jsx',
  'src/pig/PigDailyPage.jsx',
  'src/cattle/CattleDailyPage.jsx',
  'src/sheep/SheepDailyPage.jsx',
];

describe('daily record pages use the shared record-page controls', () => {
  for (const rel of DAILY_PAGES) {
    const src = read(rel);

    it(`${rel} imports the generic recordPageControls helper (not the old daily one)`, () => {
      expect(src).toContain("from '../shared/recordPageControls.jsx'");
      expect(src).not.toContain('dailyRecordControls');
    });

    it(`${rel} uses the responsive field-row class + locked Team Member display`, () => {
      expect(src).toContain('recordFieldRowClass');
      expect(src).toContain('className={fieldRowClass}');
      expect(src).toContain('LockedTeamMemberField');
    });

    it(`${rel} does not re-declare bespoke flex field-row / fixed-width input styles`, () => {
      // Old per-page primitives were a flex 'space-between' field row and a
      // width:120 input — both now live in the shared helper.
      expect(src).not.toMatch(/justifyContent:\s*'space-between'/);
      expect(src).not.toMatch(/const inp = \{[\s\S]*?width:\s*120/);
    });

    it(`${rel} renders the title via the mm/dd/yyyy formatter`, () => {
      expect(src).toContain('fmtMDY(record.date)');
    });
  }

  it('the shared helper documents its intended future record-page consumers', () => {
    const src = read('src/shared/recordPageControls.jsx');
    expect(src).toMatch(/FUTURE CONSUMERS/);
    expect(src).toContain('data-team-member-select-locked');
    for (const consumer of ['task', 'weigh-in', 'equipment']) {
      expect(src.toLowerCase()).toContain(consumer);
    }
  });
});

// Lane I CP4 — daily action-button cleanup. The six daily record pages route
// their footer Save/Revert, the load-error Retry, and the Delete action through
// the shared canonical record-page action buttons, so they cannot re-introduce
// the retired 7px/8px radii or the bespoke 6px14px / 7px14px / 8px18px action
// padding. This is a focused action-button slice, not a source-wide token ban.
describe('daily record pages share the canonical action button styles', () => {
  const SHARED_ACTION_EXPORTS = ['recordSaveButton', 'recordSecondaryButton', 'recordDeleteButton'];

  it('the shared helper exports the canonical action buttons on the 10px 16px / radius 6 contract', () => {
    const src = read('src/shared/recordPageControls.jsx');
    for (const name of SHARED_ACTION_EXPORTS) {
      expect(src).toContain('export const ' + name);
    }
    expect(src).toContain("padding: '10px 16px'");
    expect(src).toContain('borderRadius: 6');
    // The retired radii must not appear in the shared action-button source.
    expect(src).not.toMatch(/borderRadius:\s*7\D/);
    expect(src).not.toMatch(/borderRadius:\s*8\D/);
  });

  for (const rel of DAILY_PAGES) {
    const src = read(rel);

    it(`${rel} consumes the shared canonical action button styles`, () => {
      for (const name of SHARED_ACTION_EXPORTS) {
        expect(src).toContain(name);
      }
    });

    it(`${rel} does not re-declare retired radius or one-off action padding`, () => {
      expect(src).not.toMatch(/borderRadius:\s*7\D/);
      expect(src).not.toMatch(/borderRadius:\s*8\D/);
      expect(src).not.toContain("padding: '7px 14px'");
      expect(src).not.toContain("padding: '6px 14px'");
      expect(src).not.toContain("padding: '8px 18px'");
    });
  }
});
