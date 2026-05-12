// Static lock: cattle-herd / sheep-flock browser-dialog cleanup.
//
// Checkpoint 3 cleared the destructive flows on these surfaces (delete
// comment, delete sheep record, delete lambing record) — those must route
// through the typed DeleteModal via window._wcfConfirmDelete.
//
// Checkpoint 5 cleared the remaining non-destructive holdouts: the
// save-without-tag confirms (now route through window._wcfConfirm) and the
// "New origin name:" window.prompt (now an inline UI inside the form).
//
// With both checkpoints landed, these two files contain NO browser confirm
// or prompt of any kind. The combined assertion below locks both surfaces
// against any future regression. PROJECT.md Cross-App contract: "Do not
// introduce window.confirm, window.alert, or window.prompt for destructive
// flows; use app-controlled confirmation modals."

import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {dirname, resolve} from 'node:path';
import {describe, it, expect} from 'vitest';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '../..');

// Each entry: file path → list of destructive prompt strings that must no
// longer appear as the first arg of a confirm() / window.confirm() call.
const DESTRUCTIVE_PROMPTS = {
  'src/cattle/CattleHerdsView.jsx': ['Delete this comment?'],
  'src/sheep/SheepFlocksView.jsx': [
    'Delete this comment?',
    'Delete this lambing record?',
    'Permanently delete this sheep record',
  ],
};

function escapeRegex(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

describe('herd/flock delete flows: no browser confirm() on destructive copy', () => {
  for (const [rel, prompts] of Object.entries(DESTRUCTIVE_PROMPTS)) {
    const source = readFileSync(resolve(ROOT, rel), 'utf8');
    for (const prompt of prompts) {
      it(`${rel} routes "${prompt}" through the typed modal`, () => {
        // Match `confirm(` or `window.confirm(` (with optional whitespace /
        // newline) followed by a string literal starting with the prompt.
        // The leading boundary rejects identifier suffix matches
        // (`_wcfConfirmDelete(`, `confirmDelete(`).
        const re = new RegExp(`(?:^|[^A-Za-z0-9_.])(?:window\\.)?confirm\\(\\s*['"\`]${escapeRegex(prompt)}`, 's');
        expect(source).not.toMatch(re);
      });
    }
  }

  // Comprehensive lock: no browser confirm() or prompt() of any kind
  // remains in either file. Catches future regressions that bypass the app-
  // controlled DeleteModal / ConfirmModal infrastructure.
  const BROWSER_DIALOG_RE = /(?:^|[^A-Za-z0-9_.])(?:window\.)?(?:confirm|prompt)\(/;
  for (const rel of ['src/cattle/CattleHerdsView.jsx', 'src/sheep/SheepFlocksView.jsx']) {
    it(`${rel} contains no browser confirm() or prompt() at all`, () => {
      const source = readFileSync(resolve(ROOT, rel), 'utf8');
      expect(source).not.toMatch(BROWSER_DIALOG_RE);
    });
  }
});
