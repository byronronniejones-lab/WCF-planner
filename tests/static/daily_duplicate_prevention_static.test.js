import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {describe, it, expect} from 'vitest';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..', '..');

const checkSrc = fs.readFileSync(path.join(ROOT, 'src/lib/dailyDuplicateCheck.js'), 'utf8');
const broilerView = fs.readFileSync(path.join(ROOT, 'src/broiler/BroilerDailysView.jsx'), 'utf8');
const pigView = fs.readFileSync(path.join(ROOT, 'src/pig/PigDailysView.jsx'), 'utf8');
const layerView = fs.readFileSync(path.join(ROOT, 'src/layer/LayerDailysView.jsx'), 'utf8');
const eggView = fs.readFileSync(path.join(ROOT, 'src/layer/EggDailysView.jsx'), 'utf8');
const adminModal = fs.readFileSync(path.join(ROOT, 'src/shared/AdminAddReportModal.jsx'), 'utf8');
const webformHub = fs.readFileSync(path.join(ROOT, 'src/webforms/WebformHub.jsx'), 'utf8');
const offlineSrc = fs.readFileSync(path.join(ROOT, 'src/lib/useOfflineSubmit.js'), 'utf8');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

const TABLES = ['poultry_dailys', 'pig_dailys', 'layer_dailys', 'egg_dailys', 'cattle_dailys', 'sheep_dailys'];

describe('dailyDuplicateCheck helper', () => {
  it('exports checkDailyDuplicate, checkInSubmissionDuplicates, and formatDuplicateError', () => {
    expect(checkSrc).toContain('export async function checkDailyDuplicate');
    expect(checkSrc).toContain('export function checkInSubmissionDuplicates');
    expect(checkSrc).toContain('export function formatDuplicateError');
  });

  it('defines identity fields for all six daily tables', () => {
    for (const t of TABLES) {
      expect(checkSrc, `missing table: ${t}`).toContain(t);
    }
  });

  it('excludes Add Feed rows from duplicate check for non-egg tables', () => {
    expect(checkSrc).toContain('add_feed_webform');
    expect(checkSrc).toContain('TABLES_WITH_ADD_FEED');
  });

  it('does NOT apply source filter to egg_dailys', () => {
    expect(checkSrc).not.toMatch(/egg_dailys.*add_feed/);
    expect(checkSrc).toMatch(/TABLES_WITH_ADD_FEED[\s\S]*poultry_dailys/);
    expect(checkSrc).not.toMatch(/TABLES_WITH_ADD_FEED[\s\S]*egg_dailys/);
  });

  it('surfaces query errors instead of failing open', () => {
    expect(checkSrc).toMatch(/if \(error\)[\s\S]*?throw/);
    expect(checkSrc).toContain('Could not verify duplicate report');
  });
});

describe('admin daily views import duplicate check', () => {
  for (const [name, src, table] of [
    ['BroilerDailysView', broilerView, 'poultry_dailys'],
    ['PigDailysView', pigView, 'pig_dailys'],
    ['LayerDailysView', layerView, 'layer_dailys'],
    ['EggDailysView', eggView, 'egg_dailys'],
  ]) {
    it(`${name} imports and calls checkDailyDuplicate for ${table}`, () => {
      expect(src).toContain("from '../lib/dailyDuplicateCheck.js'");
      expect(src).toContain(`checkDailyDuplicate(sb, '${table}'`);
      expect(src).toContain('formatDuplicateError');
    });
  }
});

describe('AdminAddReportModal duplicate checks', () => {
  it('imports dailyDuplicateCheck with in-submission helper', () => {
    expect(adminModal).toContain("from '../lib/dailyDuplicateCheck.js'");
    expect(adminModal).toContain('checkInSubmissionDuplicates');
  });

  for (const table of TABLES) {
    it(`checks duplicates for ${table}`, () => {
      expect(adminModal).toContain(`checkDailyDuplicate(sb, '${table}'`);
    });
  }

  for (const table of ['poultry_dailys', 'layer_dailys', 'pig_dailys']) {
    it(`checks in-submission duplicates for ${table} multi-record inserts`, () => {
      expect(adminModal).toContain(`checkInSubmissionDuplicates('${table}'`);
    });
  }
});

describe('WebformHub duplicate checks', () => {
  it('imports dailyDuplicateCheck with in-submission helper', () => {
    expect(webformHub).toContain("from '../lib/dailyDuplicateCheck.js'");
    expect(webformHub).toContain('checkInSubmissionDuplicates');
  });

  for (const table of TABLES) {
    it(`checks duplicates for ${table}`, () => {
      expect(webformHub).toContain(`checkDailyDuplicate(sb, '${table}'`);
    });
  }

  for (const table of ['poultry_dailys', 'layer_dailys', 'pig_dailys']) {
    it(`checks in-submission duplicates for ${table} multi-record inserts`, () => {
      expect(webformHub).toContain(`checkInSubmissionDuplicates('${table}'`);
    });
  }
});

// The pre-submit guard can be bypassed (edit-to-collide, races, offline
// replay), so the DB UNIQUE indexes (mig 084) are the backstop. These lock the
// friendly handling of the resulting 23505 so users never see raw SQL and
// offline rows don't stick forever.
describe('daily identity-violation (mig 084) friendly handling', () => {
  it('helper detects the identity-index 23505 and maps it to the friendly message', () => {
    expect(checkSrc).toContain('export function isDailyIdentityViolation');
    expect(checkSrc).toContain('export function friendlyDailyDbError');
    expect(checkSrc).toContain('_active_daily_identity_uq');
    expect(checkSrc).toMatch(/friendlyDailyDbError[\s\S]*?formatDuplicateError/);
  });

  for (const [name, rel] of [
    ['CattleDailyPage', 'src/cattle/CattleDailyPage.jsx'],
    ['SheepDailyPage', 'src/sheep/SheepDailyPage.jsx'],
    ['PoultryDailyPage', 'src/broiler/PoultryDailyPage.jsx'],
    ['LayerDailyPage', 'src/layer/LayerDailyPage.jsx'],
    ['PigDailyPage', 'src/pig/PigDailyPage.jsx'],
    ['CattleDailysView', 'src/cattle/CattleDailysView.jsx'],
    ['SheepDailysView', 'src/sheep/SheepDailysView.jsx'],
    ['BroilerDailysView', 'src/broiler/BroilerDailysView.jsx'],
    ['PigDailysView', 'src/pig/PigDailysView.jsx'],
    ['LayerDailysView', 'src/layer/LayerDailysView.jsx'],
    ['EggDailysView', 'src/layer/EggDailysView.jsx'],
    ['AdminAddReportModal', 'src/shared/AdminAddReportModal.jsx'],
    ['WebformHub', 'src/webforms/WebformHub.jsx'],
  ]) {
    it(`${name} routes save errors through friendlyDailyDbError`, () => {
      expect(read(rel)).toContain('friendlyDailyDbError');
    });
  }

  it('offline replay treats an identity collision as superseded (synced), not stuck', () => {
    expect(offlineSrc).toContain('isDailySupersededViolation');
    expect(offlineSrc).toMatch(/isDailySupersededViolation\(error\)[\s\S]*?markSynced/);
  });

  it('offline live-submit re-raises identity collisions as a friendly schema-class error', () => {
    expect(offlineSrc).toContain('dailySupersededError');
    expect(offlineSrc).toMatch(/e\.code = DUPLICATE_KEY_CODE/);
  });
});
