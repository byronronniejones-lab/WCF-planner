// ============================================================================
// newsletterBrief — assemble the editorial "Newsletter Brief" (CP-C autopilot).
// ----------------------------------------------------------------------------
// Pure helper used by the admin Newsletter view to turn the data the admin
// already fetches (the admin issue summary + recent published issues + settings)
// into a reviewable brief: ranked highlights with why/evidence, repetition
// warnings vs recent issues, photo gaps, honest source coverage, and a publish
// readiness checklist. No network, no secrets — it is derived from admin-only
// data, so it lives in JS (unit-tested in vitest) instead of SQL.
//
// This is a src/lib-only module (NOT a _shared/Deno parity copy), so it MAY
// import. It reuses the finance/mortality text guard to flag blocked content in
// a draft before publish.
// ============================================================================

import {isForbiddenText} from './newsletterFacts.js';

const CONFIDENCE_RANK = {high: 0, medium: 1, low: 2};

const PROGRAM_LABELS = {
  cattle: 'cattle',
  sheep: 'sheep',
  pig: 'pigs',
  broiler: 'broilers',
  layer: 'the layers',
  pasture: 'the pastures',
  production: 'production',
  projects: 'a finished project',
  team: 'the team',
};

function asArray(v) {
  return Array.isArray(v) ? v : [];
}

function str(v) {
  return typeof v === 'string' ? v.trim() : v == null ? '' : String(v);
}

// All human-visible text in a draft payload, for the blocked-content scan.
function draftTextParts(draftPayload) {
  const blocks = asArray(draftPayload && draftPayload.blocks);
  const parts = [];
  for (const b of blocks) {
    if (!b || typeof b !== 'object') continue;
    if (typeof b.text === 'string') parts.push(b.text);
    if (typeof b.attribution === 'string') parts.push(b.attribution);
    for (const it of asArray(b.items)) {
      if (typeof it === 'string') parts.push(it);
      else if (it && typeof it === 'object') parts.push(`${str(it.label)} ${str(it.value)}`);
    }
  }
  return parts;
}

// Short, honest "why this was chosen" line for a fact.
function whyChosen(fact) {
  if (fact && fact.isManual) return 'Added manually by the editor.';
  const program = str(fact && fact.program);
  const label = PROGRAM_LABELS[program] || (program ? program : 'planner data');
  const conf = str(fact && fact.confidence) || 'medium';
  return `Auto-detected from ${label} (${conf} confidence).`;
}

// Ranked highlights: included first, then confidence, then the harvested order.
export function rankHighlights(facts) {
  const list = asArray(facts).map((f) => ({
    factId: f.id,
    detectorKey: str(f.detectorKey),
    program: str(f.program),
    title: str(f.title),
    summary: str(f.summary),
    displayValue: str(f.displayValue),
    confidence: str(f.confidence) || 'medium',
    included: f.included !== false,
    isManual: !!f.isManual,
    evidence: f.evidence || {},
    sourceRefs: asArray(f.sourceRefs),
    why: whyChosen(f),
  }));
  return list
    .map((h, i) => ({h, i}))
    .sort((a, b) => {
      if (a.h.included !== b.h.included) return a.h.included ? -1 : 1;
      const cr = (CONFIDENCE_RANK[a.h.confidence] ?? 1) - (CONFIDENCE_RANK[b.h.confidence] ?? 1);
      if (cr !== 0) return cr;
      return a.i - b.i; // stable: preserve harvested order on ties
    })
    .map(({h}) => h);
}

// Repetition warnings: an included fact whose detector key also appeared in a
// recent published issue. sameValue flags an identical number (truly repetitive).
export function detectRepetition(facts, recentPublished) {
  const priorByKey = new Map();
  for (const issue of asArray(recentPublished)) {
    const ym = str(issue.yearMonth);
    for (const f of asArray(issue.facts)) {
      const key = str(f.detectorKey);
      if (!key) continue;
      // keep the most-recent prior appearance (recentPublished is newest-first)
      if (!priorByKey.has(key)) priorByKey.set(key, {yearMonth: ym, displayValue: str(f.displayValue)});
    }
  }
  const out = [];
  for (const f of asArray(facts)) {
    if (f.included === false) continue;
    const key = str(f.detectorKey);
    const prior = priorByKey.get(key);
    if (!prior) continue;
    const sameValue = !!str(f.displayValue) && str(f.displayValue) === prior.displayValue;
    out.push({
      detectorKey: key,
      title: str(f.title),
      priorYearMonth: prior.yearMonth,
      sameValue,
      note: sameValue
        ? `Same as ${prior.yearMonth} (${prior.displayValue}) — consider a fresh angle or omit.`
        : `Also featured in ${prior.yearMonth} — note what changed.`,
    });
  }
  return out;
}

// Photo gap + subject suggestions from the included facts' programs.
export function photoBrief(photos, includedFacts, settings) {
  const approved = asArray(photos).filter((p) => p && p.approved).length;
  const min = Number.isFinite(settings && settings.photoMin) ? settings.photoMin : 3;
  const target = Number.isFinite(settings && settings.photoTarget) ? settings.photoTarget : 6;
  const subjects = [];
  for (const f of asArray(includedFacts)) {
    if (f.included === false) continue;
    const label = PROGRAM_LABELS[str(f.program)];
    if (label && !subjects.includes(label)) subjects.push(label);
  }
  const suggestions = [];
  if (approved < min) {
    suggestions.push(`At least ${min} photos recommended — ${min - approved} more to add.`);
  } else if (approved < target) {
    suggestions.push(`${approved}/${target} photos — a few more would round out the issue.`);
  }
  if (subjects.length) suggestions.push(`Good subjects this month: ${subjects.join(', ')}.`);
  return {approved, min, target, needMore: approved < target, subjects, suggestions};
}

// Source coverage, defaulting to an honest "not scanned yet" when the harvest
// has not run for this issue.
export function coverageBrief(sourceCoverage) {
  const cov = asArray(sourceCoverage);
  if (cov.length === 0) {
    return [
      {
        key: 'all',
        label: 'All sources',
        status: 'unavailable',
        count: 0,
        detail: 'Not scanned yet — run Prepare issue.',
      },
    ];
  }
  return cov.map((c) => ({
    key: str(c.key),
    label: str(c.label) || str(c.key),
    status: str(c.status) || 'unavailable',
    count: Number.isFinite(c.count) ? c.count : 0,
    detail: str(c.detail),
  }));
}

// Publish readiness checklist. Photos are recommended, not blocking, so a weak
// photo set is surfaced without preventing a legitimate publish.
export function readiness(issue, settings) {
  const draftBlocks = asArray(issue && issue.draftPayload && issue.draftPayload.blocks);
  const photos = asArray(issue && issue.photos);
  const approved = photos.filter((p) => p && p.approved);
  const min = Number.isFinite(settings && settings.photoMin) ? settings.photoMin : 3;

  const hasDraftBlocks = draftBlocks.length > 0;
  const approvedPhotos = approved.length > 0;
  const hasCover = approved.some((p) => p.isCover);
  const photoCountOk = approved.length >= min;
  const blocked = draftTextParts(issue && issue.draftPayload).some((t) => isForbiddenText(t));
  const noBlockedContent = !blocked;
  const previewAvailable =
    str(issue && issue.status) === 'draft' &&
    !!(issue && issue.previewEnabled) &&
    !!(issue && issue.previewExpiresAt) &&
    new Date(issue.previewExpiresAt).getTime() > Date.now();

  const items = [
    {key: 'draft', label: 'Draft has content', ok: hasDraftBlocks, blocking: true},
    {key: 'blocked', label: 'No blocked (finance/mortality) content', ok: noBlockedContent, blocking: true},
    {key: 'photos', label: `At least ${min} approved photos`, ok: photoCountOk, blocking: false},
    {key: 'cover', label: 'A cover photo is set', ok: hasCover, blocking: false},
    {key: 'anyPhoto', label: 'At least one approved photo', ok: approvedPhotos, blocking: false},
    {key: 'preview', label: 'Preview link available', ok: previewAvailable, blocking: false},
  ];
  const publishable = hasDraftBlocks && noBlockedContent;
  return {
    hasDraftBlocks,
    approvedPhotos,
    hasCover,
    photoCountOk,
    noBlockedContent,
    previewAvailable,
    publishable,
    items,
  };
}

// Assemble the full brief from the admin issue summary + recent published issues
// + settings.
export function assembleNewsletterBrief({issue, settings, recentPublished} = {}) {
  const facts = asArray(issue && issue.facts);
  const includedFacts = facts.filter((f) => f.included !== false);
  return {
    issueId: str(issue && issue.id),
    yearMonth: str(issue && issue.yearMonth),
    title: str(issue && issue.title),
    status: str(issue && issue.status),
    highlights: rankHighlights(facts),
    repetition: detectRepetition(facts, recentPublished),
    photos: photoBrief(issue && issue.photos, includedFacts, settings || {}),
    coverage: coverageBrief(issue && issue.sourceCoverage),
    readiness: readiness(issue || {}, settings || {}),
  };
}
