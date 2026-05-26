import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {describe, it, expect} from 'vitest';
import {ENTITY_TYPES, ACTIVITY_REGISTRY} from '../../src/lib/activityRegistry.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..', '..');

const mig072 = fs.readFileSync(path.join(ROOT, 'supabase-migrations/072_weighin_session_activity_entity.sql'), 'utf8');
const registrySrc = fs.readFileSync(path.join(ROOT, 'src/lib/activityRegistry.js'), 'utf8');
const headerSrc = fs.readFileSync(path.join(ROOT, 'src/shared/Header.jsx'), 'utf8');
const routesSrc = fs.readFileSync(path.join(ROOT, 'src/lib/routes.js'), 'utf8');
const activityLogSrc = fs.readFileSync(path.join(ROOT, 'src/activity/ActivityLogView.jsx'), 'utf8');

describe('Migration 072 — weighin.session resolver branch', () => {
  it('creates _activity_can_read with SECURITY DEFINER', () => {
    expect(mig072).toContain('_activity_can_read');
    expect(mig072).toContain('SECURITY DEFINER');
  });

  it('has a branch for weighin.session', () => {
    expect(mig072).toContain("'weighin.session'");
  });

  it('reads from weigh_in_sessions table', () => {
    expect(mig072).toContain('weigh_in_sessions');
  });

  it('selects species for program_access gating', () => {
    expect(mig072).toContain('SELECT species INTO v_species');
    expect(mig072).toContain('v_species = ANY(v_access)');
  });

  it('fails closed when session does not exist', () => {
    expect(mig072).toContain('IF v_species IS NULL THEN');
    expect(mig072).toMatch(/v_species IS NULL[\s\S]*?RETURN false/);
  });

  it('admin bypasses program_access after existence is proven', () => {
    expect(mig072).toMatch(/weighin\.session[\s\S]*?v_role = 'admin' THEN RETURN true/);
  });

  it('explicitly allows only cattle, sheep, pig, broiler species', () => {
    expect(mig072).toContain("v_species NOT IN ('cattle', 'sheep', 'pig', 'broiler')");
  });

  it('fails closed for unknown species', () => {
    expect(mig072).toMatch(/NOT IN \('cattle', 'sheep', 'pig', 'broiler'\)[\s\S]*?RETURN false/);
  });

  it('includes REVOKE/GRANT for _activity_can_read', () => {
    expect(mig072).toMatch(/REVOKE ALL ON FUNCTION.*_activity_can_read/);
    expect(mig072).toMatch(/GRANT EXECUTE ON FUNCTION.*_activity_can_read.*TO authenticated/);
  });

  it('preserves all existing entity type branches', () => {
    const expected = [
      'task.instance',
      'task.template',
      'task.system_rule',
      'broiler.batch',
      'pig.batch',
      'layer.batch',
      'layer.housing',
      'cattle.animal',
      'cattle.processing',
      'sheep.animal',
      'sheep.processing',
      'equipment.item',
      'poultry.daily',
      'layer.daily',
      'egg.daily',
      'pig.daily',
      'cattle.daily',
      'sheep.daily',
    ];
    for (const t of expected) {
      expect(mig072).toContain(`'${t}'`);
    }
  });

  it('ends with schema reload', () => {
    expect(mig072).toContain("NOTIFY pgrst, 'reload schema'");
  });
});

describe('activityRegistry — weighin.session entity type', () => {
  it('exports WEIGHIN_SESSION in ENTITY_TYPES', () => {
    expect(ENTITY_TYPES.WEIGHIN_SESSION).toBe('weighin.session');
  });

  it('has a registry entry for weighin.session', () => {
    expect(ACTIVITY_REGISTRY['weighin.session']).toBeTruthy();
    expect(typeof ACTIVITY_REGISTRY['weighin.session'].route).toBe('function');
  });

  it('routes to /weigh-in-sessions/<id>', () => {
    expect(ACTIVITY_REGISTRY['weighin.session'].route('abc-123')).toBe('/weigh-in-sessions/abc-123');
  });

  it('displayLabel uses date + species from context', () => {
    const label = ACTIVITY_REGISTRY['weighin.session'].displayLabel('id', {date: '2026-05-26', species: 'cattle'});
    expect(label).toBe('2026-05-26 · cattle');
  });

  it('displayLabel falls back to id without context', () => {
    expect(ACTIVITY_REGISTRY['weighin.session'].displayLabel('abc')).toBe('abc');
  });

  it('routeToView handles /weigh-in-sessions/ subpaths', () => {
    expect(registrySrc).toContain("path.startsWith('/weigh-in-sessions/')");
  });
});

describe('Header — notification allowlist includes weigh-in-sessions', () => {
  it('isRecordPageRoute includes /weigh-in-sessions/', () => {
    expect(headerSrc).toContain("route.startsWith('/weigh-in-sessions/')");
  });
});

describe('Public /weighins route is unchanged', () => {
  it('routes.js still maps /weighins as a public webform view', () => {
    expect(routesSrc).toContain("weighins: '/weighins'");
  });
});

describe('ActivityLogView — weighin.session label and filter', () => {
  it('has ENTITY_TYPE_LABELS entry for weighin.session', () => {
    expect(activityLogSrc).toContain("'weighin.session': 'Weigh-In Session'");
  });

  it('has ENTITY_FILTERS option for weighin.session', () => {
    expect(activityLogSrc).toContain("value: 'weighin.session'");
    expect(activityLogSrc).toContain("label: 'Weigh-In Sessions'");
  });
});

describe('No weigh-in record page UI in this lane', () => {
  it('no WeighInSessionPage component exists yet', () => {
    const exists = fs.existsSync(path.join(ROOT, 'src/livestock/WeighInSessionPage.jsx'));
    expect(exists).toBe(false);
  });
});
