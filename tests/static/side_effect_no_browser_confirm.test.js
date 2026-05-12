// Static lock: checkpoint 4 of the project-wide browser-dialog cleanup.
//
// Side-effect confirmations (mark pig batch processed, retire layer housing,
// password reset, deactivate user, permanently delete user) must route
// through the app-controlled typed UI:
//   - Permanent user delete uses window._wcfConfirmDelete (DeleteModal —
//     destructive, typed-"delete" gate fits).
//   - Non-destructive side effects use window._wcfConfirm (ConfirmModal —
//     Confirm/Cancel with action-specific label, no typed gate). Codex
//     guidance: do not force the word "delete" for non-deletes.
//
// Out of scope and intentionally untouched in this checkpoint:
//   - Cattle/sheep save-without-tag confirms.
//   - CattleHerdsView "New origin name:" window.prompt.
//   - window.alert/alert flows (informational pass is a later checkpoint).

import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {dirname, resolve} from 'node:path';
import {describe, it, expect} from 'vitest';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '../..');

const SCOPED_FILES = ['src/pig/PigBatchesView.jsx', 'src/layer/LayerBatchesView.jsx', 'src/auth/UsersModal.jsx'];

// Matches `confirm(` and `window.confirm(` but not identifier suffixes
// (`confirmDelete(`, `_wcfConfirmDelete(`, `_wcfConfirm(`, etc.).
const DESTRUCTIVE_CONFIRM_RE = /(?:^|[^A-Za-z0-9_.])(?:window\.)?confirm\(/;

describe('side-effect confirmations: no browser confirm() on scoped surfaces', () => {
  for (const rel of SCOPED_FILES) {
    it(`${rel} routes confirmations through app-controlled modals`, () => {
      const source = readFileSync(resolve(ROOT, rel), 'utf8');
      expect(source).not.toMatch(DESTRUCTIVE_CONFIRM_RE);
    });
  }

  // Cross-check the new infra is wired:
  //   - main.jsx exposes window._wcfConfirm and renders ConfirmActionModal.
  //   - Header.jsx threads ConfirmActionModal into its render output.
  it('main.jsx exposes window._wcfConfirm globally', () => {
    const source = readFileSync(resolve(ROOT, 'src/main.jsx'), 'utf8');
    expect(source).toMatch(/window\._wcfConfirm\s*=/);
  });
  it('Header.jsx renders the ConfirmActionModal slot', () => {
    const source = readFileSync(resolve(ROOT, 'src/shared/Header.jsx'), 'utf8');
    expect(source).toMatch(/\{ConfirmActionModal\}/);
  });
});
