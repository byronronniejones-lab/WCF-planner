import {describe, it, expect} from 'vitest';
import {
  validateNewsletterBlocks,
  sanitizeBlock,
  composeTemplateDraft,
  buildNewsletterPrompt,
  NEWSLETTER_BLOCK_TYPES,
} from './newsletterDraft.js';
import {NEWSLETTER_BLOCK_TYPES as RENDERER_TYPES} from '../newsletter/NewsletterBlocks.jsx';

describe('validateNewsletterBlocks — the AI-output whitelist gate', () => {
  it('keeps whitelisted blocks and drops unknown types', () => {
    const {blocks} = validateNewsletterBlocks({
      blocks: [
        {type: 'heading', text: 'Hello'},
        {type: 'script', text: 'evil'}, // unknown → dropped
        {type: 'paragraph', text: 'A good month.'},
      ],
    });
    expect(blocks.map((b) => b.type)).toEqual(['heading', 'paragraph']);
  });

  it('strips any extra fields (no raw html can ride along)', () => {
    const out = sanitizeBlock({type: 'paragraph', text: 'hi', html: '<script>x</script>', onClick: 'y'});
    expect(out).toEqual({type: 'paragraph', text: 'hi'});
    expect(Object.keys(out)).toEqual(['type', 'text']);
  });

  it('drops empty/malformed blocks', () => {
    expect(sanitizeBlock({type: 'heading', text: '   '})).toBeNull();
    expect(sanitizeBlock({type: 'list', items: []})).toBeNull();
    expect(sanitizeBlock(null)).toBeNull();
    expect(sanitizeBlock({type: 'stats', items: [{label: 'x'}]})).toBeNull(); // no value
  });

  it('accepts a bare array or a {blocks} object and always returns {blocks}', () => {
    expect(validateNewsletterBlocks([{type: 'divider'}])).toEqual({blocks: [{type: 'divider'}]});
    expect(validateNewsletterBlocks('nope')).toEqual({blocks: []});
    expect(validateNewsletterBlocks(null)).toEqual({blocks: []});
  });

  it('coerces heading level + callout tone to known values', () => {
    expect(sanitizeBlock({type: 'heading', text: 'h', level: 9})).toEqual({type: 'heading', text: 'h', level: 2});
    expect(sanitizeBlock({type: 'callout', text: 'c', tone: 'danger'})).toEqual({
      type: 'callout',
      text: 'c',
      tone: 'good',
    });
  });
});

describe('composeTemplateDraft — deterministic offline provider', () => {
  const input = {
    issue: {title: 'White Creek Farm May 2026 Review', yearMonth: '2026-05'},
    facts: [
      {title: 'Cattle on the farm', summary: '142 head across 2 herds.', displayValue: '142 head', metricValue: 142},
      {
        title: 'New litters farrowed',
        summary: '20 piglets born across 2 litters.',
        displayValue: '20 piglets · 2 litters',
      },
    ],
    intake: {highlights: 'The new barn roof went up.', people: 'Sam and Dana'},
  };

  it('produces only whitelisted blocks', () => {
    const {blocks} = composeTemplateDraft(input);
    for (const b of blocks) expect(NEWSLETTER_BLOCK_TYPES).toContain(b.type);
  });

  it('includes a heading, a stats block from facts, and the intake notes', () => {
    const {blocks} = composeTemplateDraft(input);
    expect(blocks[0]).toMatchObject({type: 'heading', text: 'White Creek Farm May 2026 Review'});
    const stats = blocks.find((b) => b.type === 'stats');
    expect(stats.items).toEqual([
      {label: 'Cattle on the farm', value: '142 head'},
      {label: 'New litters farrowed', value: '20 piglets · 2 litters'},
    ]);
    expect(JSON.stringify(blocks)).toContain('The new barn roof went up.');
    expect(JSON.stringify(blocks)).toContain('Sam and Dana');
  });

  it('is deterministic (same input → same output)', () => {
    expect(composeTemplateDraft(input)).toEqual(composeTemplateDraft(input));
  });

  it('always yields a publishable draft (has a blocks key with content)', () => {
    const {blocks} = composeTemplateDraft({issue: {yearMonth: '2026-05'}, facts: [], intake: {}});
    expect(blocks.length).toBeGreaterThan(0);
  });
});

describe('buildNewsletterPrompt — fixed template with hard rules', () => {
  it('states the no-finance / no-mortality rules and JSON-only output', () => {
    const prompt = buildNewsletterPrompt({
      issue: {yearMonth: '2026-05'},
      facts: [{title: 'Calves born', summary: 'seven', displayValue: '7 calves'}],
      intake: {},
    });
    expect(prompt).toMatch(/NEVER mention finances/i);
    expect(prompt).toMatch(/NEVER mention animal deaths/i);
    expect(prompt).toMatch(/Return ONLY a JSON object/i);
    expect(prompt).toContain('Calves born');
  });
});

describe('whitelist stays in sync with the public renderer', () => {
  it('newsletterDraft and NewsletterBlocks share the exact block whitelist', () => {
    expect([...NEWSLETTER_BLOCK_TYPES]).toEqual([...RENDERER_TYPES]);
  });
});
