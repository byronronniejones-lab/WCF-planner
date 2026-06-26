// ============================================================================
// newsletterDraft — structured-block draft composer + AI-output validator (CP-B).
// ----------------------------------------------------------------------------
// Pure ESM. NO imports. NO Node/Deno APIs. NO `Date` use. Deterministic given
// the same input so it runs identically in vitest (Node) and the
// newsletter-harvest Edge Function (Deno).
//
// Source-of-truth. A byte-identical copy lives at
//   supabase/functions/_shared/newsletterDraft.js
// Drift is locked by tests/static/newsletter_shared_parity.test.js.
//
// TWO responsibilities:
//   1. validateNewsletterBlocks(payload) — the SECURITY gate on AI output. The
//      model returns structured blocks; this whitelists block types and coerces
//      each to the exact shape the public renderer (NewsletterBlocks.jsx) reads,
//      dropping anything unknown/malformed. No raw HTML can survive: only the
//      known fields are copied, all text stays plain. The renderer also
//      whitelists, so this is defense in depth + a stable persisted shape.
//   2. composeTemplateDraft(input) — the deterministic offline "template"
//      provider. When no live AI provider/secret is configured it builds a
//      complete, valid, whitelisted draft from the harvested facts + monthly
//      intake, so the whole harvest→draft→preview→publish flow is fully
//      testable and shippable without a paid AI key.
//
// The block whitelist MUST stay in sync with NewsletterBlocks.NEWSLETTER_BLOCK_TYPES
// (locked by src/lib/newsletterDraft.test.js).
// ============================================================================

export const NEWSLETTER_BLOCK_TYPES = Object.freeze([
  'heading',
  'paragraph',
  'list',
  'stats',
  'quote',
  'callout',
  'photo',
  'gallery',
  'divider',
]);

const ALLOWED = new Set(NEWSLETTER_BLOCK_TYPES);

function txt(v) {
  if (typeof v === 'string') return v.trim();
  if (typeof v === 'number' && Number.isFinite(v)) return String(v);
  return '';
}

function strArray(v) {
  return Array.isArray(v) ? v.map(txt).filter((s) => s.length > 0) : [];
}

// Coerce one candidate block to a clean, renderer-ready shape, or null. Only
// the known fields per type are copied — nothing else (e.g. an `html` field)
// can ride along into the persisted payload.
export function sanitizeBlock(block) {
  if (!block || typeof block !== 'object' || !ALLOWED.has(block.type)) return null;
  switch (block.type) {
    case 'heading': {
      const text = txt(block.text);
      if (!text) return null;
      return {type: 'heading', text, level: block.level === 3 ? 3 : 2};
    }
    case 'paragraph': {
      const text = txt(block.text);
      if (!text) return null;
      return {type: 'paragraph', text};
    }
    case 'list': {
      const items = strArray(block.items);
      if (items.length === 0) return null;
      return {type: 'list', ordered: !!block.ordered, items};
    }
    case 'stats': {
      const items = Array.isArray(block.items)
        ? block.items.map((it) => ({label: txt(it && it.label), value: txt(it && it.value)})).filter((it) => it.value)
        : [];
      if (items.length === 0) return null;
      return {type: 'stats', items};
    }
    case 'quote': {
      const text = txt(block.text);
      if (!text) return null;
      const attribution = txt(block.attribution);
      return attribution ? {type: 'quote', text, attribution} : {type: 'quote', text};
    }
    case 'callout': {
      const text = txt(block.text);
      if (!text) return null;
      return {type: 'callout', text, tone: block.tone === 'note' ? 'note' : 'good'};
    }
    case 'photo': {
      const photoId = txt(block.photoId);
      if (!photoId) return null;
      const caption = txt(block.caption);
      return caption ? {type: 'photo', photoId, caption} : {type: 'photo', photoId};
    }
    case 'gallery': {
      const photoIds = Array.isArray(block.photoIds) ? block.photoIds.map(txt).filter(Boolean) : [];
      if (photoIds.length === 0) return null;
      return {type: 'gallery', photoIds};
    }
    case 'divider':
      return {type: 'divider'};
    default:
      return null;
  }
}

// Validate + normalize an AI/admin payload to `{ blocks: [...] }`. Accepts an
// array of blocks or an object with a `blocks` array; everything else → no
// blocks. The publish RPC requires a `blocks` key, so we always return one.
export function validateNewsletterBlocks(payload) {
  let raw = [];
  if (Array.isArray(payload)) raw = payload;
  else if (payload && typeof payload === 'object' && Array.isArray(payload.blocks)) raw = payload.blocks;
  const blocks = raw.map(sanitizeBlock).filter(Boolean);
  return {blocks};
}

// ── Deterministic template composer (offline provider) ──────────────────────

const MONTHS = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];

function monthLabel(yearMonth) {
  const m = typeof yearMonth === 'string' ? yearMonth.match(/^(\d{4})-(\d{2})$/) : null;
  if (!m) return '';
  const idx = Number(m[2]) - 1;
  if (idx < 0 || idx > 11) return '';
  return `${MONTHS[idx]} ${m[1]}`;
}

function factText(v) {
  return typeof v === 'string' ? v.trim() : '';
}

// Build a full draft from facts + intake. `input`:
//   { issue:{title,yearMonth}, facts:[...], intake:{highlights,milestones,people,...} }
// Output: { blocks: [...] } — already whitelist-clean (run through validate).
export function composeTemplateDraft(input) {
  const issue = (input && input.issue) || {};
  const facts = Array.isArray(input && input.facts) ? input.facts : [];
  const intake = (input && input.intake) || {};
  const month = monthLabel(issue.yearMonth);
  const blocks = [];

  blocks.push({type: 'heading', text: factText(issue.title) || `White Creek Farm ${month} Review`.trim()});

  const intro = month
    ? `Here is what ${month} looked like across the farm — the animals, the new arrivals, and the work the team is proud of.`
    : 'Here is what the past month looked like across the farm.';
  blocks.push({type: 'paragraph', text: intro});

  // Stats from facts that carry a display value (counts, totals).
  const statItems = facts
    .filter((f) => factText(f && (f.displayValue || f.title)) && (f.displayValue || f.metricValue != null))
    .map((f) => ({label: factText(f.title), value: factText(f.displayValue) || String(f.metricValue)}))
    .filter((it) => it.value);
  if (statItems.length > 0) {
    blocks.push({type: 'heading', text: 'By the numbers', level: 3});
    blocks.push({type: 'stats', items: statItems});
  }

  // Narrative list of each fact's summary line.
  const summaries = facts.map((f) => factText(f && f.summary)).filter(Boolean);
  if (summaries.length > 0) {
    blocks.push({type: 'heading', text: 'Highlights', level: 3});
    blocks.push({type: 'list', ordered: false, items: summaries});
  }

  // Admin intake threads in human context the data can't see.
  const highlights = factText(intake.highlights);
  if (highlights) blocks.push({type: 'paragraph', text: highlights});
  const milestones = factText(intake.milestones);
  if (milestones) blocks.push({type: 'callout', text: milestones, tone: 'good'});
  const people = factText(intake.people);
  if (people) blocks.push({type: 'paragraph', text: `Thanks to ${people} for the work this month.`});

  blocks.push({type: 'divider'});
  blocks.push({
    type: 'paragraph',
    text: 'Thanks for following along with life at White Creek Farm. More next month.',
  });

  return validateNewsletterBlocks({blocks});
}

// ── Static prompt builder (for a real AI provider) ──────────────────────────
// A FIXED template. The model is instructed to return ONLY a JSON object of
// whitelisted blocks; its output is still run through validateNewsletterBlocks
// before persistence, so a prompt-injection or malformed response cannot place
// raw HTML or unknown block types on the public page.
export function buildNewsletterPrompt(input) {
  const issue = (input && input.issue) || {};
  const facts = Array.isArray(input && input.facts) ? input.facts : [];
  const intake = (input && input.intake) || {};
  const tone = factText(input && input.tone) || 'warm-but-credible owner-facing farm update';
  const month = monthLabel(issue.yearMonth);

  const factLines = facts
    .map((f) => `- ${factText(f.title)}: ${factText(f.summary)} (${factText(f.displayValue)})`)
    .join('\n');
  const intakeLines = Object.keys(intake)
    .map((k) => `- ${k}: ${factText(intake[k])}`)
    .filter((l) => l.split(': ')[1])
    .join('\n');

  return [
    `You are writing the White Creek Farm ${month} Review, a short (about two pages),`,
    `fact-based, positive newsletter for farm owners and periphery staff. Tone: ${tone}.`,
    '',
    'STRICT RULES:',
    '- Use ONLY the facts and notes provided below. Do not invent numbers or events.',
    '- NEVER mention finances, prices, costs, sales, or money of any kind.',
    '- NEVER mention animal deaths, mortality, losses, or culls.',
    '- First names of team members are OK; no other personal details.',
    '',
    'OUTPUT FORMAT:',
    '- Return ONLY a JSON object: {"blocks":[ ... ]}. No prose, no markdown, no HTML.',
    `- Allowed block types ONLY: ${NEWSLETTER_BLOCK_TYPES.join(', ')}.`,
    '- heading{text,level}, paragraph{text}, list{ordered,items[]}, stats{items[{label,value}]},',
    '  quote{text,attribution}, callout{text,tone}, divider{}.',
    '- Do NOT emit photo/gallery blocks; the admin adds photos.',
    '',
    'FACTS:',
    factLines || '(none)',
    '',
    'MONTHLY NOTES:',
    intakeLines || '(none)',
  ].join('\n');
}
