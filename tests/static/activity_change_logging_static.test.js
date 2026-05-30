import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {describe, it, expect} from 'vitest';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..', '..');

const cattleHerds = fs.readFileSync(path.join(ROOT, 'src/cattle/CattleHerdsView.jsx'), 'utf8');
const cattleForecast = fs.readFileSync(path.join(ROOT, 'src/cattle/CattleForecastView.jsx'), 'utf8');
const sheepFlocks = fs.readFileSync(path.join(ROOT, 'src/sheep/SheepFlocksView.jsx'), 'utf8');
const sheepAnimalPage = fs.readFileSync(path.join(ROOT, 'src/sheep/SheepAnimalPage.jsx'), 'utf8');
const eqAdmin = fs.readFileSync(path.join(ROOT, 'src/admin/EquipmentWebformsAdmin.jsx'), 'utf8');
const diffHelper = fs.readFileSync(path.join(ROOT, 'src/lib/activityChangeDiff.js'), 'utf8');

describe('Activity change logging - cattle.animal', () => {
  it('CattleHerdsView imports runMutation and recordFieldChange', () => {
    expect(cattleHerds).toContain("import {runMutation, recordFieldChange} from '../lib/entityMutations.js'");
  });

  it('CattleHerdsView imports buildChanges', () => {
    expect(cattleHerds).toContain("import {buildChanges, countSummary} from '../lib/activityChangeDiff.js'");
  });

  it('CattleHerdsView patchCow uses runMutation with cattle.animal', () => {
    expect(cattleHerds).toContain("entityType: 'cattle.animal'");
    expect(cattleHerds).toContain('runMutation(');
  });

  it('CattleHerdsView excludes herd and processing_batch_id', () => {
    expect(cattleHerds).toContain("'herd'");
    expect(cattleHerds).toContain("'processing_batch_id'");
    expect(cattleHerds).toContain('CATTLE_EXCLUDE');
  });

  it('CattleForecastView patchCow uses runMutation with cattle.animal', () => {
    expect(cattleForecast).toContain("entityType: 'cattle.animal'");
    expect(cattleForecast).toContain('runMutation(');
  });

  it('neither cattle view routes deletes through record.deleted', () => {
    const deleteMatches = cattleHerds.match(/record\.deleted/g);
    expect(deleteMatches).toBeNull();
    const forecastDeleteMatches = cattleForecast.match(/record\.deleted/g);
    expect(forecastDeleteMatches).toBeNull();
  });
});

describe('Activity change logging - sheep.animal', () => {
  it('SheepAnimalPage imports runMutation and recordFieldChange', () => {
    expect(sheepAnimalPage).toContain("import {runMutation, recordFieldChange} from '../lib/entityMutations.js'");
  });

  it('SheepAnimalPage imports buildChanges', () => {
    expect(sheepAnimalPage).toContain("import {buildChanges, countSummary} from '../lib/activityChangeDiff.js'");
  });

  it('SheepAnimalPage patchSheep uses runMutation with sheep.animal', () => {
    expect(sheepAnimalPage).toContain("entityType: 'sheep.animal'");
    expect(sheepAnimalPage).toContain('runMutation(');
  });

  it('SheepAnimalPage excludes flock and processing_batch_id', () => {
    expect(sheepAnimalPage).toContain("'flock'");
    expect(sheepAnimalPage).toContain("'processing_batch_id'");
    expect(sheepAnimalPage).toContain('SHEEP_EXCLUDE');
  });

  it('does not route deletes through record.deleted', () => {
    expect(sheepAnimalPage.match(/record\.deleted/g)).toBeNull();
  });
});

describe('Activity change logging - equipment.item', () => {
  it('EquipmentWebformsAdmin imports runMutation and recordFieldChange and recordStatusChange', () => {
    expect(eqAdmin).toContain(
      "import {runMutation, recordFieldChange, recordStatusChange} from '../lib/entityMutations.js'",
    );
  });

  it('EquipmentWebformsAdmin imports countSummary and makeFieldChange', () => {
    expect(eqAdmin).toContain("import {countSummary, makeFieldChange} from '../lib/activityChangeDiff.js'");
  });

  it('uses equipment.item entity type', () => {
    expect(eqAdmin).toContain("entityType: 'equipment.item'");
  });

  it('IdentityEditor uses recordStatusChange for status', () => {
    expect(eqAdmin).toContain('recordStatusChange(sb');
  });

  it('TeamMembersEditor logs team_members as field.updated via makeFieldChange', () => {
    expect(eqAdmin).toContain("'team_members'");
    expect(eqAdmin).toContain('makeFieldChange');
    expect(eqAdmin).toContain("'Team members'");
  });

  it('uses countSummary for complex array fields', () => {
    expect(eqAdmin).toContain('countSummary(');
  });

  it('does not log documents', () => {
    expect(eqAdmin).not.toContain("field: 'documents'");
    expect(eqAdmin).not.toMatch(/recordFieldChange.*documents/);
  });

  it('does not route deletes through record.deleted', () => {
    expect(eqAdmin.match(/record\.deleted/g)).toBeNull();
  });
});

describe('Activity change logging - diff helper', () => {
  it('exports buildChanges', () => {
    expect(diffHelper).toContain('export function buildChanges');
  });

  it('exports countSummary', () => {
    expect(diffHelper).toContain('export function countSummary');
  });

  it('supports exclude parameter', () => {
    expect(diffHelper).toContain('exclude');
  });

  it('supports formatters parameter', () => {
    expect(diffHelper).toContain('formatters');
  });
});

describe('Custom editable-table Activity — cattle forecast hide/unhide (CP1)', () => {
  it('CattleForecastView imports recordActivityEvent from entityMutations', () => {
    expect(cattleForecast).toMatch(/import \{[^}]*recordActivityEvent[^}]*\} from '\.\.\/lib\/entityMutations\.js'/);
  });
  it('has a recordForecastHiddenActivity helper', () => {
    expect(cattleForecast).toContain('async function recordForecastHiddenActivity(');
  });
  it('logs against cattle.animal with field.updated', () => {
    expect(cattleForecast).toMatch(
      /recordActivityEvent\(sb, \{[\s\S]*?entityType: 'cattle\.animal'[\s\S]*?eventType: 'field\.updated'/,
    );
  });
  it('uses the cattle id as entity_id and prefers #<tag> with id fallback for the label', () => {
    expect(cattleForecast).toContain('entityId: cattleId');
    expect(cattleForecast).toContain("cow && cow.tag ? '#' + cow.tag : cattleId");
  });
  it('body + payload make the month and visible<->hidden action clear', () => {
    expect(cattleForecast).toContain('const month = monthLabel(monthKey)');
    expect(cattleForecast).toContain("const from = nowHidden ? 'visible' : 'hidden'");
    expect(cattleForecast).toContain("const to = nowHidden ? 'hidden' : 'visible'");
    expect(cattleForecast).toContain("'Forecast month ' + month + ' changed '");
    expect(cattleForecast).toContain('forecast_month_visibility');
  });
  it('toggleHidden logs only AFTER a successful write (returns on write error first)', () => {
    expect(cattleForecast).toMatch(
      /Could not update hide state[\s\S]*?return;[\s\S]*?recordForecastHiddenActivity\(cattleId, monthKey, !currentlyHidden\)/,
    );
  });
});

describe('Activity change logging - no direct table access', () => {
  const allSrc = [cattleHerds, cattleForecast, sheepFlocks, eqAdmin];
  for (const src of allSrc) {
    it('does not reference .from(activity_events)', () => {
      expect(src).not.toMatch(/\.from\(['"]activity_events['"]\)/);
    });
    it('does not reference .from(activity_mentions)', () => {
      expect(src).not.toMatch(/\.from\(['"]activity_mentions['"]\)/);
    });
  }
});
