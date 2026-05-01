import {describe, it, expect} from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import url from 'node:url';

// ============================================================================
// Tasks v1 Phase B recurrence-helper parity lock.
// ----------------------------------------------------------------------------
// Two copies of the recurrence math exist:
//   - src/lib/tasksRecurrence.js                    (vitest source-of-truth)
//   - supabase/functions/_shared/tasksRecurrence.js (Edge Function runtime)
//
// They MUST be byte-identical. The Edge Function imports its copy via Deno's
// relative ESM resolution; we cannot rely on the Supabase CLI bundler reaching
// across the project root, so the algorithm lives in two files. This static
// test fails the build the moment the two files drift.
//
// Normalization: only CRLF→LF (Codex rev 3 lock). No other transforms. The
// files are required to match exactly otherwise.
//
// Also asserts the helper is pure ESM with zero imports — guards against
// anyone slipping a Node API or Supabase import into the Edge-side copy.
// ============================================================================

const __dirname = path.dirname(url.fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..', '..');

const SRC_PATH = path.join(ROOT, 'src', 'lib', 'tasksRecurrence.js');
const SHARED_PATH = path.join(ROOT, 'supabase', 'functions', '_shared', 'tasksRecurrence.js');

function readNormalized(p) {
  return fs.readFileSync(p, 'utf8').replace(/\r\n/g, '\n');
}

describe('tasksRecurrence parity', () => {
  it('src/lib copy and supabase/functions/_shared copy are byte-identical (CRLF normalized)', () => {
    const a = readNormalized(SRC_PATH);
    const b = readNormalized(SHARED_PATH);
    expect(b).toBe(a);
  });

  it('both copies are pure ESM with zero import statements', () => {
    for (const p of [SRC_PATH, SHARED_PATH]) {
      const text = readNormalized(p);
      // Match only top-of-line `import ` (ignores the word inside comments
      // describing the module). Catches any future drift toward Node APIs
      // or Supabase imports.
      const importLines = text.split('\n').filter((line) => /^\s*import\s/.test(line));
      expect(importLines, `${path.relative(ROOT, p)} has unexpected import statements`).toEqual([]);
    }
  });

  it('neither copy references Node-specific APIs', () => {
    // Conservative deny-list. Date is allowed (used internally for ephemeral
    // UTC math); everything in this list would break the Deno runtime or leak
    // Node-only behavior.
    const banned = ['require(', 'process.', 'Buffer.', '__dirname', '__filename', 'fs.', 'path.', 'url.'];
    for (const p of [SRC_PATH, SHARED_PATH]) {
      const text = readNormalized(p);
      for (const tok of banned) {
        expect(text.includes(tok), `${path.relative(ROOT, p)} contains banned token "${tok}"`).toBe(false);
      }
    }
  });
});
