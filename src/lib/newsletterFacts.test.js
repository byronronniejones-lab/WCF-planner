import {describe, it, expect} from 'vitest';
import {
  detectNewsletterFacts,
  detectBroilerOnFarm,
  detectBroilerProcessed,
  detectPigFarrowings,
  detectPigsOnFarm,
  detectCattleOnFarm,
  detectCattleBirths,
  detectLayerEggs,
  isForbiddenFact,
  assertNoForbiddenFacts,
  NEWSLETTER_DETECTORS,
} from './newsletterFacts.js';

const PERIOD = {yearMonth: '2026-05', start: '2026-05-01', end: '2026-05-31'};

function withPeriod(extra) {
  return {period: PERIOD, ...extra};
}

describe('newsletter fact detectors — positive, evidence-backed facts', () => {
  it('broiler on-farm counts active flocks and carries evidence', () => {
    const fact = detectBroilerOnFarm(
      withPeriod({
        broilerBatches: [
          {name: 'B-26-04', status: 'brooding', currentCount: 300},
          {name: 'B-26-03', status: 'processed', currentCount: 250}, // excluded (done)
          {name: 'B-26-05', status: 'growing', birdCount: 150},
        ],
      }),
    );
    expect(fact.detectorKey).toBe('broiler_on_farm');
    expect(fact.metricValue).toBe(450);
    expect(fact.evidence.flockCount).toBe(2);
    expect(fact.confidence).toBe('high');
  });

  it('broiler processed only counts batches processed within the period', () => {
    const fact = detectBroilerProcessed(
      withPeriod({
        broilerBatches: [
          {name: 'B-26-02', processingDate: '2026-05-10', processedCount: 280},
          {name: 'B-26-01', processingDate: '2026-04-28', processedCount: 300}, // out of period
        ],
      }),
    );
    expect(fact.metricValue).toBe(280);
    expect(fact.evidence.flocks).toHaveLength(1);
  });

  it('pig farrowings count litters + born-alive (never mortality)', () => {
    const fact = detectPigFarrowings(
      withPeriod({
        pigFarrowings: [
          {group: 'G1', farrowingDate: '2026-05-03', bornAlive: 11, stillborn: 2},
          {group: 'G2', farrowingDate: '2026-05-20', liveBorn: 9},
          {group: 'G3', farrowingDate: '2026-06-01', bornAlive: 10}, // out of period
        ],
      }),
    );
    expect(fact.evidence.litters).toBe(2);
    expect(fact.evidence.piglets).toBe(20);
    expect(fact.confidence).toBe('high');
    // The stillborn field must never appear in the summary/evidence numbers.
    expect(JSON.stringify(fact)).not.toMatch(/stillborn/i);
  });

  it('NEVER publishes totalBorn as born-alive: omits piglet totals + medium confidence when born-alive is missing', () => {
    const fact = detectPigFarrowings(
      withPeriod({
        // A litter recorded with totalBorn + stillborn but NO explicit born-alive.
        pigFarrowings: [{group: 'G1', farrowingDate: '2026-05-05', totalBorn: 12, stillborn: 3}],
      }),
    );
    expect(fact.evidence.litters).toBe(1);
    expect(fact.evidence.piglets).toBeNull();
    expect(fact.metricValue).toBe(1); // litters, NOT 12
    expect(fact.displayValue).toBe('1 litter');
    expect(fact.confidence).toBe('medium');
    // The totalBorn value (12) and the stillborn count must never surface.
    expect(JSON.stringify(fact)).not.toContain('12');
    expect(JSON.stringify(fact)).not.toMatch(/stillborn/i);
  });

  it('drops to litters-only (medium) when ANY litter is missing born-alive', () => {
    const fact = detectPigFarrowings(
      withPeriod({
        pigFarrowings: [
          {group: 'G1', farrowingDate: '2026-05-03', bornAlive: 10},
          {group: 'G2', farrowingDate: '2026-05-09', totalBorn: 11}, // no born-alive
        ],
      }),
    );
    expect(fact.evidence.litters).toBe(2);
    expect(fact.evidence.piglets).toBeNull();
    expect(fact.confidence).toBe('medium');
    expect(fact.displayValue).toBe('2 litters');
  });

  it('pigs on-farm sums sub-batches when present', () => {
    const fact = detectPigsOnFarm(
      withPeriod({
        pigFeederGroups: [
          {
            batchName: 'P-26-01',
            subBatches: [
              {name: 'A', headCount: 12},
              {name: 'B', headCount: 8, status: 'removed'},
            ],
          },
          {batchName: 'P-26-02', headCount: 20},
        ],
      }),
    );
    expect(fact.metricValue).toBe(32); // 12 (active sub) + 20 (group), removed sub excluded
  });

  it('cattle on-farm + births read their documented shapes', () => {
    expect(detectCattleOnFarm(withPeriod({cattleHerds: [{name: 'Mommas', headCount: 142}]})).metricValue).toBe(142);
    const births = detectCattleBirths(
      withPeriod({
        cattleBirths: [
          {dam: 'C12', birthDate: '2026-05-09'},
          {dam: 'C34', birthDate: '2026-05-22', count: 1},
        ],
      }),
    );
    expect(births.metricValue).toBe(2);
  });

  it('layer eggs sum collection records within the period', () => {
    const fact = detectLayerEggs(
      withPeriod({
        layerProduction: [
          {date: '2026-05-01', eggs: 180},
          {date: '2026-05-02', eggs: 200},
          {date: '2026-04-30', eggs: 999}, // out of period
        ],
      }),
    );
    expect(fact.metricValue).toBe(380);
  });

  it('returns null (no story) when a metric is zero / data missing', () => {
    expect(detectBroilerOnFarm(withPeriod({broilerBatches: []}))).toBeNull();
    expect(detectPigFarrowings(withPeriod({pigFarrowings: []}))).toBeNull();
    expect(detectCattleOnFarm(withPeriod({}))).toBeNull();
  });

  it('detectNewsletterFacts assembles a deterministic, ordered set', () => {
    const facts = detectNewsletterFacts(
      withPeriod({
        broilerBatches: [{name: 'B1', status: 'growing', currentCount: 100}],
        cattleHerds: [{name: 'H1', headCount: 50}],
      }),
    );
    expect(facts.map((f) => f.detectorKey)).toEqual(['cattle_on_farm', 'broiler_on_farm']);
    expect(facts.map((f) => f.sortOrder)).toEqual([0, 1]);
  });

  it('empty / malformed input yields no facts and never throws', () => {
    expect(detectNewsletterFacts(null)).toEqual([]);
    expect(detectNewsletterFacts({})).toEqual([]);
    expect(detectNewsletterFacts({period: PERIOD})).toEqual([]);
  });
});

describe('finance / mortality boundary', () => {
  it('flags any fact mentioning money or death as forbidden', () => {
    expect(isForbiddenFact({title: 'Calves born', summary: 'Seven healthy calves'})).toBe(false);
    expect(isForbiddenFact({title: 'Cattle sales', summary: 'sold 12 head'})).toBe(true);
    expect(isForbiddenFact({title: 'Revenue up', summary: 'profit climbed'})).toBe(true);
    expect(isForbiddenFact({title: 'Loss', summary: '3 mortalities this month'})).toBe(true);
    expect(isForbiddenFact({title: 'Feed price', summary: 'cost $4.20/bu'})).toBe(true);
    // "processed" / "production" are accomplishments and stay allowed.
    expect(isForbiddenFact({title: 'Broilers processed', summary: '280 birds processed'})).toBe(false);
  });

  it('assertNoForbiddenFacts drops forbidden candidates', () => {
    const kept = assertNoForbiddenFacts([
      {title: 'Calves born', summary: 'seven calves'},
      {title: 'Beef sold', summary: '$3,000 in sales'},
    ]);
    expect(kept).toHaveLength(1);
    expect(kept[0].title).toBe('Calves born');
  });

  it('detectNewsletterFacts never emits a forbidden fact', () => {
    const facts = detectNewsletterFacts(
      withPeriod({
        broilerBatches: [{name: 'B1', status: 'growing', currentCount: 100}],
        pigFarrowings: [{group: 'G1', farrowingDate: '2026-05-03', bornAlive: 10}],
      }),
    );
    for (const f of facts) expect(isForbiddenFact(f)).toBe(false);
  });

  it('exposes one detector per registry entry', () => {
    expect(NEWSLETTER_DETECTORS.length).toBeGreaterThanOrEqual(8);
  });
});
