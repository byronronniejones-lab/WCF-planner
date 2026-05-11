import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {describe, expect, it} from 'vitest';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..', '..');
const pigSrc = fs.readFileSync(path.join(ROOT, 'src/pig/PigFeedView.jsx'), 'utf8');
const broilerSrc = fs.readFileSync(path.join(ROOT, 'src/broiler/BroilerFeedView.jsx'), 'utf8');

describe('Feed order board — uses feedPlanner helper, not duplicated math', () => {
  it('PigFeedView imports the snapshot helpers from feedPlanner.js', () => {
    expect(pigSrc).toMatch(/from '\.\.\/lib\/feedPlanner\.js'/);
    expect(pigSrc).toMatch(/\bpigDailyBurnLbs\b/);
    expect(pigSrc).toMatch(/\bonHandFromSnapshot\b/);
    expect(pigSrc).toMatch(/\bsuggestOrder\b/);
    expect(pigSrc).toMatch(/\bisSnapshotStale\b/);
  });

  it('BroilerFeedView imports the snapshot helpers from feedPlanner.js', () => {
    expect(broilerSrc).toMatch(/from '\.\.\/lib\/feedPlanner\.js'/);
    expect(broilerSrc).toMatch(/\bpoultryDailyBurnLbs\b/);
    expect(broilerSrc).toMatch(/\bonHandFromSnapshot\b/);
    expect(broilerSrc).toMatch(/\bsuggestOrder\b/);
    expect(broilerSrc).toMatch(/\bisSnapshotStale\b/);
  });

  it('PigFeedView renders the order board header above the legacy ledger', () => {
    expect(pigSrc).toMatch(/Feed order/);
    expect(pigSrc).toMatch(/showPigLegacyLedger/);
    expect(pigSrc).toMatch(/Show monthly ledger/);
    const boardIdx = pigSrc.indexOf('Feed order');
    const legacyIdx = pigSrc.indexOf('showPigLegacyLedger &&');
    expect(boardIdx).toBeGreaterThan(0);
    expect(legacyIdx).toBeGreaterThan(boardIdx);
  });

  it('BroilerFeedView renders the order board header above the legacy ledger', () => {
    expect(broilerSrc).toMatch(/Feed order/);
    expect(broilerSrc).toMatch(/showPoultryLegacyLedger/);
    expect(broilerSrc).toMatch(/Show monthly ledger/);
    const boardIdx = broilerSrc.indexOf('Feed order');
    const legacyIdx = broilerSrc.indexOf('showPoultryLegacyLedger &&');
    expect(boardIdx).toBeGreaterThan(0);
    expect(legacyIdx).toBeGreaterThan(boardIdx);
  });

  it('Pig "Use suggested" writes to ppp-feed-orders-v1 via savePigOrder(thisYM, suggestion)', () => {
    expect(pigSrc).toMatch(/applyPigSuggestion/);
    expect(pigSrc).toMatch(/savePigOrder\(thisYM, String\(pigSuggestion\.suggestedOrderLbs\)\)/);
    expect(pigSrc).toMatch(/sbSave\('ppp-feed-orders-v1'/);
  });

  it('Poultry "Use suggested" writes to ppp-feed-orders-v1 via savePoultryOrder(type, thisYM, suggestion)', () => {
    expect(broilerSrc).toMatch(/applyPoultrySuggestion/);
    expect(broilerSrc).toMatch(/savePoultryOrder\(row\.ordKey, thisYM, String\(row\.suggestion\.suggestedOrderLbs\)\)/);
    expect(broilerSrc).toMatch(/sbSave\('ppp-feed-orders-v1'/);
  });

  it('Both views require a two-tap confirm when overwriting an existing current-month order', () => {
    expect(pigSrc).toMatch(/confirmPigSuggested/);
    expect(pigSrc).toMatch(/setConfirmPigSuggested\(true\)/);
    expect(broilerSrc).toMatch(/confirmPoultrySuggested/);
    expect(broilerSrc).toMatch(/setConfirmPoultrySuggested\(row\.key\)/);
  });

  it('Pig burn uses ledger-derived feeder counts (no stored currentCount reads)', () => {
    expect(pigSrc).toMatch(/pigDailyBurnLbs\(dateISO, \{feederGroups, breedingCycles, breeders, farrowingRecs\}\)/);
    expect(pigSrc).not.toMatch(/sub\.currentCount/);
  });

  it('Poultry burn ties to the existing broiler/layer schedule helpers via poultryDailyBurnLbs', () => {
    expect(broilerSrc).toMatch(/poultryDailyBurnLbs\(dateISO, \{[\s\S]*?batches:\s*activeBroilers/);
    expect(broilerSrc).toMatch(/layerHousings: layerHousings/);
    expect(broilerSrc).toMatch(/layerDailys: allLayerDailys/);
  });

  it('Legacy includesCurrentMonthDelivery storage tolerance is preserved (not removed from the file)', () => {
    expect(pigSrc).toMatch(/includesCurrentMonthDelivery/);
    expect(broilerSrc).toMatch(/includesCurrentMonthDelivery/);
  });

  it('Operator-facing physical-count input must NOT expose the Includes-current-month-delivery checkbox', () => {
    // Visible label/id were removed from the new count flow. Helpers still
    // tolerate old persisted rows that carry the flag (covered by the test
    // above), but the operator can no longer set it true from this surface.
    expect(pigSrc).not.toMatch(/Includes this month's feed delivery/);
    expect(broilerSrc).not.toMatch(/Includes this month's feed delivery/);
    expect(pigSrc).not.toMatch(/pig-feed-count-includes-delivery/);
    expect(broilerSrc).not.toMatch(/poultry-feed-count-includes-delivery/);
  });

  it('Save handlers in the new count flow pass false (not a checkbox value) for the legacy flag', () => {
    expect(pigSrc).toMatch(/savePigFeedCount\(el\.value, dl \? dl\.value : todayDate, false\)/);
    expect(broilerSrc).toMatch(/savePoultryFeedCount\(countType, el\.value, dl \? dl\.value : todayDate, false\)/);
  });

  it('No-snapshot state still surfaces a suggestion (estimated), per Codex direction', () => {
    expect(pigSrc).toMatch(/onHandLbs: pigOnHand == null \? 0 : pigOnHand/);
    expect(broilerSrc).toMatch(/onHandLbs: onHand == null \? 0 : onHand/);
    expect(pigSrc).toMatch(/estimated — enter count/);
    expect(broilerSrc).toMatch(/enter count/);
  });
});
