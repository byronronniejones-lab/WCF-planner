// Static lock: checkpoint 3 of the project-wide browser-dialog cleanup.
//
// Destructive flows on cattle herd / sheep flock surfaces (delete comment,
// delete sheep record, delete lambing record) must route through the typed
// DeleteModal (via window._wcfConfirmDelete), not window.confirm or bare
// confirm(). PROJECT.md Cross-App contract: "Do not introduce window.confirm,
// window.alert, or window.prompt for destructive flows; use typed
// confirmation modals. Use DeleteModal for deletes."
//
// Scoped to the destructive copy strings cleared in checkpoint 3. The
// save-without-tag confirms ("Save cow without a tag?", "Save sheep without
// a tag?") and the cattle origin window.prompt ("New origin name:") are
// intentionally out of scope for this checkpoint and must continue to live
// in these files until a later checkpoint addresses them.

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

  // Sanity: out-of-scope prompts remain in their files. If a future
  // checkpoint clears these, drop the corresponding assertion here.
  it('CattleHerdsView retains the out-of-scope save-without-tag confirm', () => {
    const source = readFileSync(resolve(ROOT, 'src/cattle/CattleHerdsView.jsx'), 'utf8');
    expect(source).toMatch(/Save cow without a tag\?/);
  });
  it('CattleHerdsView retains the out-of-scope new-origin window.prompt', () => {
    const source = readFileSync(resolve(ROOT, 'src/cattle/CattleHerdsView.jsx'), 'utf8');
    expect(source).toMatch(/window\.prompt\(['"]New origin name:/);
  });
  it('SheepFlocksView retains the out-of-scope save-without-tag confirm', () => {
    const source = readFileSync(resolve(ROOT, 'src/sheep/SheepFlocksView.jsx'), 'utf8');
    expect(source).toMatch(/Save sheep without a tag\?/);
  });
});
