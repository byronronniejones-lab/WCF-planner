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

// ── Tone + length presets (driven by newsletter_settings) ───────────────────
// A preset maps to a fixed instruction phrase. A non-empty custom `tone` always
// wins; otherwise the preset resolves; otherwise the warm-credible default.
export const NEWSLETTER_TONE_PRESETS = Object.freeze({
  warm_credible: 'warm but credible, like a proud owner updating friends of the farm',
  concise_professional: 'concise and professional — factual, clear, and to the point',
  celebratory: 'upbeat and celebratory, leaning into the month’s wins',
  folksy: 'folksy and personal, like a letter from the family farm',
});

export const NEWSLETTER_LENGTH_PRESETS = Object.freeze({
  brief: {key: 'brief', pages: 'about one page', maxHighlights: 4, perProgramParagraph: false},
  standard: {key: 'standard', pages: 'about two pages', maxHighlights: 8, perProgramParagraph: false},
  detailed: {key: 'detailed', pages: 'two to three pages', maxHighlights: 99, perProgramParagraph: true},
});

export function resolveTone(input) {
  const custom = factText(input && input.tone);
  if (custom) return custom;
  const preset = factText(input && input.tonePreset);
  return NEWSLETTER_TONE_PRESETS[preset] || NEWSLETTER_TONE_PRESETS.warm_credible;
}

function resolveLength(lengthDetail) {
  const key = factText(lengthDetail);
  return NEWSLETTER_LENGTH_PRESETS[key] || NEWSLETTER_LENGTH_PRESETS.standard;
}

// Friendly section label per program, in a stable display order so the grouped
// template draft is deterministic.
const PROGRAM_LABELS = Object.freeze({
  cattle: 'Cattle',
  sheep: 'Sheep',
  pig: 'Pigs',
  broiler: 'Broilers',
  layer: 'Layers & eggs',
  pasture: 'Pastures',
  production: 'Production',
  projects: 'Projects',
  team: 'The team',
});
const PROGRAM_ORDER = Object.freeze([
  'cattle',
  'sheep',
  'pig',
  'broiler',
  'layer',
  'pasture',
  'production',
  'projects',
  'team',
]);

function programLabel(program) {
  const p = factText(program);
  if (PROGRAM_LABELS[p]) return PROGRAM_LABELS[p];
  return p ? p.charAt(0).toUpperCase() + p.slice(1) : 'Around the farm';
}

// Group facts by program into ordered [{label, summaries}] sections. Known
// programs come first (PROGRAM_ORDER), then any others in first-seen order.
function groupByProgram(facts) {
  const buckets = new Map();
  const seen = [];
  for (const f of facts) {
    const summary = factText(f && f.summary);
    if (!summary) continue;
    const key = factText(f && f.program) || 'general';
    if (!buckets.has(key)) {
      buckets.set(key, []);
      seen.push(key);
    }
    buckets.get(key).push(summary);
  }
  const ordered = [...PROGRAM_ORDER.filter((k) => buckets.has(k)), ...seen.filter((k) => !PROGRAM_ORDER.includes(k))];
  return ordered.map((k) => ({label: programLabel(k), summaries: buckets.get(k)}));
}

function introLine(month) {
  return month
    ? `Here is what ${month} looked like across the farm — the animals, the new arrivals, and the work the team is proud of.`
    : 'Here is what the past month looked like across the farm.';
}

// Build a full draft from facts + intake. `input`:
//   { issue:{title,yearMonth}, facts:[...], intake:{...}, lengthDetail }
// Output: { blocks: [...] } — already whitelist-clean (run through validate).
// brief → a flat highlights list; standard/detailed → highlights grouped into
// per-program sections for a more polished, scannable layout.
export function composeTemplateDraft(input) {
  const issue = (input && input.issue) || {};
  const facts = Array.isArray(input && input.facts) ? input.facts : [];
  const intake = (input && input.intake) || {};
  const length = resolveLength(input && input.lengthDetail);
  const month = monthLabel(issue.yearMonth);
  const blocks = [];

  blocks.push({type: 'heading', text: factText(issue.title) || `White Creek Farm ${month} Review`.trim()});
  blocks.push({type: 'paragraph', text: introLine(month)});

  // By the numbers — stats from facts that carry a display value (counts, totals).
  const statItems = facts
    .filter((f) => factText(f && (f.displayValue || f.title)) && (f.displayValue || f.metricValue != null))
    .map((f) => ({label: factText(f.title), value: factText(f.displayValue) || String(f.metricValue)}))
    .filter((it) => it.value);
  if (statItems.length > 0) {
    blocks.push({type: 'heading', text: 'By the numbers', level: 3});
    blocks.push({type: 'stats', items: statItems});
  }

  // Highlights — brief is one flat list; longer formats group by program area.
  if (length.key === 'brief') {
    const summaries = facts
      .map((f) => factText(f && f.summary))
      .filter(Boolean)
      .slice(0, length.maxHighlights);
    if (summaries.length > 0) {
      blocks.push({type: 'heading', text: 'Highlights', level: 3});
      blocks.push({type: 'list', ordered: false, items: summaries});
    }
  } else {
    const groups = groupByProgram(facts);
    if (groups.length > 0) {
      blocks.push({type: 'heading', text: 'Highlights', level: 3});
      for (const g of groups) {
        if (length.perProgramParagraph) {
          blocks.push({type: 'paragraph', text: `${g.label}: ${g.summaries.join(' ')}`});
        } else {
          blocks.push({type: 'paragraph', text: g.label});
          blocks.push({type: 'list', ordered: false, items: g.summaries});
        }
      }
    }
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

// ── Photo plan (shot-list) ──────────────────────────────────────────────────
// The AI (or the offline composer) proposes shots FROM the issue's content. The
// admin fulfills each slot with an approved photo; a fulfilled slot is woven
// into the draft as a normal (whitelisted) photo block. A slot:
//   { id, idea, section, photoId|null }
// id is a stable hash of (idea, section) so re-proposing the same idea keeps the
// same slot (and any photo already assigned to it).

// Suggested default shot per program, used by the offline composer.
const PHOTO_IDEAS = Object.freeze({
  cattle: 'The cattle out on pasture',
  sheep: 'The flock grazing',
  pig: 'The pigs in their paddock',
  broiler: 'The broiler flock',
  layer: 'The hens and a basket of fresh eggs',
  pasture: 'A wide shot of the pastures',
  production: 'The processing / production work',
  projects: 'The finished project',
  team: 'The team at work',
});

// Stable, pure id for a slot (no Date/Math.random — deterministic across runs).
function planId(idea, section) {
  const s = `${txt(idea)}|${txt(section)}`;
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return 'pp-' + h.toString(36);
}

// Coerce a raw plan array to the clean slot shape (drops empties, stamps ids).
export function sanitizePhotoPlan(raw) {
  const arr = Array.isArray(raw) ? raw : [];
  const out = [];
  for (const p of arr) {
    if (!p || typeof p !== 'object') continue;
    const idea = txt(p.idea);
    if (!idea) continue;
    const section = txt(p.section);
    const id = txt(p.id) || planId(idea, section);
    const photoId = txt(p.photoId) || null;
    out.push({id, idea, section, photoId});
  }
  return out;
}

// Deterministic default plan from the included facts' programs (offline path).
export function proposePhotoPlan(input) {
  const facts = Array.isArray(input && input.facts) ? input.facts : [];
  const seen = new Set();
  const out = [];
  for (const f of facts) {
    const program = factText(f && f.program);
    const label = PROGRAM_LABELS[program];
    if (!label || seen.has(program)) continue;
    seen.add(program);
    out.push({idea: PHOTO_IDEAS[program] || `A photo for ${label}`, section: label});
  }
  return sanitizePhotoPlan(out);
}

// Merge a freshly-proposed plan onto the existing one: ALWAYS keep slots the
// admin already fulfilled (photoId set); add newly-proposed ideas; drop stale
// unfulfilled ideas the new plan no longer suggests. Same idea+section => same
// id, so a re-proposed fulfilled slot is preserved, never duplicated.
export function mergePhotoPlan(existing, proposed) {
  const ex = sanitizePhotoPlan(existing);
  const prop = sanitizePhotoPlan(proposed);
  const byId = new Map(ex.map((e) => [e.id, e]));
  const out = [];
  const used = new Set();
  for (const e of ex) {
    if (e.photoId) {
      out.push(e);
      used.add(e.id);
    }
  }
  for (const p of prop) {
    if (used.has(p.id)) continue;
    const prior = byId.get(p.id);
    out.push({id: p.id, idea: p.idea, section: p.section, photoId: prior && prior.photoId ? prior.photoId : null});
    used.add(p.id);
  }
  return out;
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
  const pastIssues = Array.isArray(input && input.pastIssues) ? input.pastIssues : [];
  const tone = resolveTone(input);
  const length = resolveLength(input && input.lengthDetail);
  const month = monthLabel(issue.yearMonth);
  // Revise-in-place: when the admin supplies revision notes, the model edits the
  // CURRENT DRAFT rather than rebuilding from scratch.
  const revisionNotes = factText(input && input.revisionNotes);
  const currentBlocks =
    input && input.currentDraft && Array.isArray(input.currentDraft.blocks) ? input.currentDraft.blocks : [];

  const factLines = facts
    .map((f) => `- ${factText(f.title)}: ${factText(f.summary)} (${factText(f.displayValue)})`)
    .join('\n');
  const intakeLines = Object.keys(intake)
    .map((k) => `- ${k}: ${factText(intake[k])}`)
    .filter((l) => l.split(': ')[1])
    .join('\n');

  // Recent published issues give the model White Creek Farm's voice and tell it
  // what NOT to repeat. Body text is truncated so the prompt stays bounded.
  const pastLines = pastIssues
    .map((p) => {
      const titles = Array.isArray(p && p.factTitles) ? p.factTitles.filter(Boolean) : [];
      const body = factText(p && p.bodyText).slice(0, 600);
      const ym = factText(p && p.yearMonth);
      const head = `- ${ym}${factText(p && p.title) ? ` "${factText(p.title)}"` : ''}`;
      const tl = titles.length ? `\n    featured: ${titles.join('; ')}` : '';
      const bd = body ? `\n    voice sample: ${body}` : '';
      return head + tl + bd;
    })
    .join('\n');

  return [
    `You are writing the White Creek Farm ${month} Review, a ${length.pages},`,
    `fact-based, positive newsletter for farm owners and periphery staff. Tone: ${tone}.`,
    '',
    'STRICT RULES:',
    '- Use ONLY the facts and notes provided below. Do not invent numbers or events.',
    '- NEVER mention finances, prices, costs, sales, or money of any kind.',
    '- NEVER mention animal deaths, mortality, losses, or culls.',
    '- First names of team members are OK; no other personal details.',
    '- Match the voice of the PAST ISSUES below, and do NOT repeat the same',
    '  accomplishments verbatim — say what changed instead.',
    '',
    'OUTPUT FORMAT:',
    '- Return ONLY a JSON object: {"blocks":[ ... ], "photoPlan":[ ... ]}. No prose, no markdown, no HTML.',
    `- Allowed block types ONLY: ${NEWSLETTER_BLOCK_TYPES.join(', ')}.`,
    '- heading{text,level}, paragraph{text}, list{ordered,items[]}, stats{items[{label,value}]},',
    '  quote{text,attribution}, callout{text,tone}, divider{}.',
    '- Open with a title heading, then an intro paragraph, then a "By the numbers"',
    '  stats block, then highlights grouped by program area, then a short closing.',
    '- Do NOT emit photo/gallery blocks. Instead propose a photoPlan: 3–6 photo',
    '  ideas drawn from THIS issue\'s content, each {"idea","section"} where section',
    '  names the part of the issue it illustrates. Describe the SHOT to take; never',
    '  reference an existing photo.',
    '',
    'FACTS:',
    factLines || '(none)',
    '',
    'MONTHLY NOTES:',
    intakeLines || '(none)',
    '',
    'PAST ISSUES (voice + do-not-repeat):',
    pastLines || '(none)',
    ...(revisionNotes
      ? [
          '',
          'REVISION REQUEST — apply these notes to the CURRENT DRAFT below. Change only',
          'what is asked; keep everything else. Re-output the FULL revised blocks.',
          `Notes: ${revisionNotes}`,
          'CURRENT DRAFT:',
          JSON.stringify(currentBlocks),
        ]
      : []),
  ].join('\n');
}
