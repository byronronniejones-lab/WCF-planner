import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {describe, it, expect} from 'vitest';

// Lock: section sub-nav under @media (max-width: 600px) must keep BOTH
// the horizontal-scroll behavior AND a right-edge fade affordance. The
// fade is the only visual cue that the swipe exists — hiding the scrollbar
// without the fade leaves operators with no signal that Weigh-Ins /
// Forecast / Batches / Dailys (Cattle has 8 tabs total; Pigs has 8) are
// reachable past the right edge of the viewport.
//
// Removing the fade or the hidden-scrollbar pair would silently reintroduce
// the friction Codex 2026-05-14 surfaced via the UX sweep.

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..', '..');
const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');

// Locate the mobile-only section sub-nav block.
const block = html.match(
  /\[data-header-subnav="1"\]\s*\{[\s\S]*?(?=\}[\s\S]*?\[data-header-subnav="1"\]::-webkit-scrollbar)/,
);

describe('section sub-nav under @media (max-width: 600px)', () => {
  it('the rule block exists', () => {
    expect(block, 'expected [data-header-subnav="1"] mobile rule').not.toBeNull();
  });

  it('keeps horizontal scroll behavior', () => {
    expect(block[0]).toMatch(/flex-wrap:\s*nowrap !important/);
    expect(block[0]).toMatch(/overflow-x:\s*auto !important/);
  });

  it('keeps the hidden scrollbar to keep the visual clean on iOS / Android', () => {
    expect(block[0]).toMatch(/scrollbar-width:\s*none/);
    expect(html).toMatch(/\[data-header-subnav="1"\]::-webkit-scrollbar\s*\{\s*display:\s*none/);
  });

  it('adds a right-edge fade as the swipe affordance (both -webkit and standard mask)', () => {
    expect(block[0]).toMatch(
      /-webkit-mask-image:\s*linear-gradient\(to right,\s*black\s*calc\(100% - 16px\),\s*transparent\)/,
    );
    expect(block[0]).toMatch(
      /(?<!-webkit-)mask-image:\s*linear-gradient\(to right,\s*black\s*calc\(100% - 16px\),\s*transparent\)/,
    );
  });
});
