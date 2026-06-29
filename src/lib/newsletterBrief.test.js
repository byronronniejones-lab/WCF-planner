import {describe, it, expect} from 'vitest';
import {
  rankHighlights,
  detectRepetition,
  photoBrief,
  coverageBrief,
  readiness,
  assembleNewsletterBrief,
} from './newsletterBrief.js';

describe('rankHighlights — included first, then confidence', () => {
  it('orders included-high before included-low before excluded', () => {
    const facts = [
      {id: 'a', included: false, confidence: 'high', title: 'A'},
      {id: 'b', included: true, confidence: 'low', title: 'B'},
      {id: 'c', included: true, confidence: 'high', title: 'C'},
    ];
    expect(rankHighlights(facts).map((h) => h.factId)).toEqual(['c', 'b', 'a']);
  });

  it('exposes a why line and keeps manual provenance', () => {
    const [h] = rankHighlights([{id: 'm', included: true, isManual: true, title: 'Tour'}]);
    expect(h.why).toMatch(/manually/i);
    expect(h.isManual).toBe(true);
  });
});

describe('detectRepetition — vs recent published issues', () => {
  const recent = [{yearMonth: '2026-04', facts: [{detectorKey: 'cattle_on_farm', displayValue: '142 head'}]}];

  it('flags a repeated detector and whether the value is identical', () => {
    const same = detectRepetition(
      [{detectorKey: 'cattle_on_farm', included: true, displayValue: '142 head', title: 'Cattle'}],
      recent,
    );
    expect(same).toHaveLength(1);
    expect(same[0].sameValue).toBe(true);

    const moved = detectRepetition(
      [{detectorKey: 'cattle_on_farm', included: true, displayValue: '150 head', title: 'Cattle'}],
      recent,
    );
    expect(moved[0].sameValue).toBe(false);
  });

  it('ignores excluded facts and unseen detectors', () => {
    expect(
      detectRepetition([{detectorKey: 'cattle_on_farm', included: false, displayValue: '142 head'}], recent),
    ).toEqual([]);
    expect(detectRepetition([{detectorKey: 'layer_eggs', included: true, displayValue: '900 eggs'}], recent)).toEqual(
      [],
    );
  });
});

describe('photoBrief — gap + subjects', () => {
  it('reports the gap to target and suggests subjects from included facts', () => {
    const pb = photoBrief(
      [{approved: true}, {approved: false}],
      [
        {program: 'cattle', included: true},
        {program: 'broiler', included: true},
      ],
      {photoMin: 3, photoTarget: 6},
    );
    expect(pb.approved).toBe(1);
    expect(pb.needMore).toBe(true);
    expect(pb.subjects).toEqual(['cattle', 'broilers']);
    expect(pb.suggestions.join(' ')).toMatch(/at least 3 photos/i);
  });
});

describe('coverageBrief — honest default', () => {
  it('defaults to an unavailable "not scanned yet" when empty', () => {
    const cov = coverageBrief([]);
    expect(cov).toHaveLength(1);
    expect(cov[0].status).toBe('unavailable');
  });
  it('passes through real coverage', () => {
    expect(coverageBrief([{key: 'cattle', label: 'Cattle', status: 'scanned', count: 3}])).toEqual([
      {key: 'cattle', label: 'Cattle', status: 'scanned', count: 3, detail: ''},
    ]);
  });
});

describe('readiness — publishable gates + blocked content', () => {
  const base = {
    status: 'draft',
    previewEnabled: true,
    previewExpiresAt: '2999-01-01T00:00:00Z',
    draftPayload: {blocks: [{type: 'paragraph', text: 'A good month on the farm.'}]},
    photos: [{approved: true, isCover: true}],
  };

  it('is publishable with content and no blocked words', () => {
    const r = readiness(base, {photoMin: 1});
    expect(r.hasDraftBlocks).toBe(true);
    expect(r.noBlockedContent).toBe(true);
    expect(r.publishable).toBe(true);
  });

  it('blocks publish when draft text trips the finance/mortality boundary', () => {
    const r = readiness(
      {...base, draftPayload: {blocks: [{type: 'paragraph', text: 'We sold the herd.'}]}},
      {photoMin: 1},
    );
    expect(r.noBlockedContent).toBe(false);
    expect(r.publishable).toBe(false);
  });

  it('treats missing draft content as not publishable', () => {
    const r = readiness({...base, draftPayload: {blocks: []}}, {photoMin: 1});
    expect(r.hasDraftBlocks).toBe(false);
    expect(r.publishable).toBe(false);
  });
});

describe('assembleNewsletterBrief — integration', () => {
  it('assembles every section from the admin issue + settings + recent', () => {
    const brief = assembleNewsletterBrief({
      issue: {
        id: 'nli-2026-05',
        yearMonth: '2026-05',
        title: 'May Review',
        status: 'draft',
        facts: [
          {
            id: 'f1',
            detectorKey: 'cattle_on_farm',
            program: 'cattle',
            title: 'Cattle',
            displayValue: '142 head',
            confidence: 'high',
            included: true,
          },
        ],
        photos: [{approved: true, isCover: true}],
        draftPayload: {blocks: [{type: 'heading', text: 'May Review'}]},
        sourceCoverage: [{key: 'cattle', label: 'Cattle', status: 'scanned', count: 142}],
        previewEnabled: true,
        previewExpiresAt: '2999-01-01T00:00:00Z',
      },
      settings: {photoMin: 1, photoTarget: 3},
      recentPublished: [{yearMonth: '2026-04', facts: [{detectorKey: 'cattle_on_farm', displayValue: '142 head'}]}],
    });
    expect(brief.highlights).toHaveLength(1);
    expect(brief.repetition[0].sameValue).toBe(true);
    expect(brief.coverage[0].status).toBe('scanned');
    expect(brief.readiness.publishable).toBe(true);
  });
});
