// Static lock: checkpoint 2 of the project-wide browser-dialog cleanup.
//
// Weigh-in destructive flows (session delete with blocked auto-revert, entry
// delete with blocked auto-revert, plain entry delete) must route through the
// typed-delete UI — the App-scoped window._wcfConfirmDelete helper for
// authenticated cattle/sheep views, and a local DeleteModal-backed
// confirmDelete() helper for the public webform.
//
// Scoped to the three files cleared in checkpoint 2. Other surfaces
// (cattle herds, sheep flocks, pig batches, auth) are still pending later
// checkpoints and are intentionally not asserted here.

import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {dirname, resolve} from 'node:path';
import {describe, it, expect} from 'vitest';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '../..');

const SCOPED_FILES = [
  'src/cattle/CattleWeighInsView.jsx',
  'src/sheep/SheepWeighInsView.jsx',
  'src/webforms/WeighInsWebform.jsx',
];

// Matches `confirm(` and `window.confirm(` but not identifier suffixes
// (`confirmDelete(`, `_wcfConfirmDelete(`, etc.).
const DESTRUCTIVE_CONFIRM_RE = /(?:^|[^A-Za-z0-9_.])(?:window\.)?confirm\(/;

describe('weigh-in delete flows: no browser confirm()', () => {
  for (const rel of SCOPED_FILES) {
    it(`${rel} routes destructive confirms through the typed modal`, () => {
      const source = readFileSync(resolve(ROOT, rel), 'utf8');
      expect(source).not.toMatch(DESTRUCTIVE_CONFIRM_RE);
    });
  }
});
