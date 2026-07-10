import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {describe, it, expect} from 'vitest';
import {
  defaultProcessingTemplateSuite,
  PROCESSING_FIELD_TYPES,
  validateTemplateDraft,
} from '../../src/lib/processingFields.js';

// Static guards for the Template Suite Completion lane (mig 172 + controls):
//   • the SQL-embedded seed JSON is BYTE-EQUAL to the canonical JS suite
//     (defaultProcessingTemplateSuite) for all four programs — the seed and the
//     client Reset-to-default can never drift;
//   • seeding is insert-if-absent only (never overwrites/deactivates an
//     admin-customized template) and idempotent;
//   • set_processing_field learns checkbox + url and nothing else changes;
//   • Processor is a TRUE SELECT everywhere (no free-text/datalist path);
//   • the Templates manager validates before activation, shows Active/Draft
//     state, and previews the draft;
//   • no field renders twice between core rows and template Details.

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..', '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

const mig = read('supabase-migrations/172_processing_template_suite.sql');
const drawer = read('src/processing/ProcessingDrawer.jsx');
const milestoneModal = read('src/processing/AddMilestoneModal.jsx');
const templatesModal = read('src/processing/ProcessingTemplatesModal.jsx');
const fieldsLib = read('src/lib/processingFields.js');

const PROGRAMS = ['broiler', 'cattle', 'pig', 'sheep'];

// Extract the two '...'::jsonb literals of one program's INSERT block.
function seedJson(program) {
  const start = mig.indexOf(`SELECT 'ptpl-default-${program}'`);
  expect(start, `${program} seed present`).toBeGreaterThan(-1);
  const block = mig.slice(start, mig.indexOf('WHERE NOT EXISTS', start));
  const literals = [...block.matchAll(/'((?:[^']|'')*)'::jsonb/g)].map((m) => m[1].replace(/''/g, "'"));
  expect(literals.length, `${program} carries fields + checklist literals`).toBe(2);
  return {fields: JSON.parse(literals[0]), checklist: JSON.parse(literals[1])};
}

describe('mig 172 — seed JSON is in lockstep with the canonical JS suite', () => {
  const suite = defaultProcessingTemplateSuite();
  for (const program of PROGRAMS) {
    it(`${program}: SQL seed === defaultProcessingTemplateSuite()`, () => {
      const seeded = seedJson(program);
      expect(seeded.fields).toEqual(JSON.parse(JSON.stringify(suite[program].fields)));
      expect(seeded.checklist).toEqual(JSON.parse(JSON.stringify(suite[program].checklist)));
    });
  }

  it('the canonical suite itself passes publish validation for every program', () => {
    for (const program of PROGRAMS) {
      const verdict = validateTemplateDraft(suite[program].fields, suite[program].checklist);
      expect(verdict.problems, `${program} suite valid`).toEqual([]);
    }
  });

  it('seeds are insert-if-absent, deterministic v1, and can never touch existing rows', () => {
    for (const program of PROGRAMS) {
      expect(mig).toContain(`'ptpl-default-${program}', '${program}', 1,`);
      expect(mig).toContain(
        `WHERE NOT EXISTS (SELECT 1 FROM public.processing_templates WHERE program = '${program}')`,
      );
    }
    // No statement may modify or remove template rows — seed-only migration.
    expect(mig).not.toMatch(/UPDATE public\.processing_templates/i);
    expect(mig).not.toMatch(/DELETE FROM public\.processing_templates/i);
    expect(mig).not.toMatch(/is_active = false/i);
  });

  it('set_processing_field reissue adds checkbox + url validation and keeps the contract', () => {
    expect(mig).toMatch(/v_type = 'checkbox'[\s\S]*?jsonb_typeof\(p_value\) <> 'boolean'/);
    expect(mig).toMatch(/v_type = 'url'[\s\S]*?https\?:/);
    expect(mig).toContain('PERFORM public._processing_require_operational()');
    expect(mig).toContain('_processing_reserved_field_ids()');
    expect(mig).toContain('milestones do not take template fields');
    expect(mig).toContain('GRANT EXECUTE ON FUNCTION public.set_processing_field(text, text, jsonb) TO authenticated');
    expect(mig).toContain("NOTIFY pgrst, 'reload schema'");
  });
});

describe('control ownership — Processor is a true select everywhere', () => {
  it('drawer: select sourced from processor_options; free-typing paths removed; legacy value stays visible', () => {
    expect(drawer).toContain('data-processing-processor-select');
    expect(drawer).toMatch(/\(legacy\)/);
    expect(drawer).not.toContain('data-processing-processor-input');
    expect(drawer).not.toContain('datalist');
  });
  it('Add Milestone: select, no datalist/free input', () => {
    expect(milestoneModal).toMatch(/<select[\s\S]{0,400}data-processing-milestone-processor/);
    expect(milestoneModal).not.toContain('datalist');
  });
  it('the template Processor def is settings-sourced (no baked options)', () => {
    expect(fieldsLib).toMatch(/id: 'processor',[\s\S]{0,200}optionsSource: 'settings\.processor_options'/);
  });
  it('no field renders twice: core-covered ids stay excluded from template Details', () => {
    expect(drawer).toMatch(
      /CORE_COVERED_FIELD_IDS = \['status', 'program', 'batchName', 'animals', 'customer', 'processor'\]/,
    );
    expect(drawer).toMatch(/\.filter\(\(f\) => !CORE_COVERED_FIELD_IDS\.includes\(f\.id\)\)/);
  });
});

describe('field engine — new control types', () => {
  it('checkbox + url are supported types with drawer renderers', () => {
    expect(PROCESSING_FIELD_TYPES).toContain('checkbox');
    expect(PROCESSING_FIELD_TYPES).toContain('url');
    expect(drawer).toMatch(/field\.type === 'checkbox'/);
    expect(drawer).toMatch(/field\.type === 'url'/);
    expect(drawer).toMatch(/data-processing-field-link/);
    expect(templatesModal).toMatch(/\{value: 'checkbox', label: 'Checkbox'\}/);
    expect(templatesModal).toMatch(/\{value: 'url', label: 'URL'\}/);
  });
});

describe('Templates manager — Active/Draft state, preview, publish validation', () => {
  it('shows Active/Draft state per program and a draft preview', () => {
    expect(templatesModal).toContain('data-processing-template-state');
    expect(templatesModal).toContain('data-processing-template-preview-toggle');
    expect(templatesModal).toContain('data-processing-template-preview="1"');
    expect(templatesModal).toMatch(/Active v\$\{activeVersion\}/);
    expect(templatesModal).toMatch(/Draft \(unsaved\)/);
  });
  it('publish validation blocks invalid drafts before the RPC call', () => {
    expect(templatesModal).toContain('validateTemplateDraft(draftFields, draftChecklist)');
    expect(templatesModal).toMatch(/if \(!verdict\.ok\)[\s\S]*?return;/);
    // Cannot activate messaging references the problems list.
    expect(templatesModal).toContain('Cannot activate this template');
  });
  it('Reset produces the approved full program template (canonical defaults)', () => {
    expect(templatesModal).toContain('defaultProcessingFields(program)');
    expect(templatesModal).toContain('defaultProcessingChecklist(program)');
  });
  it('saves preserve the settings-source marker so Processor never loses its choices source', () => {
    expect(templatesModal).toMatch(/if \(f\.optionsSource\) out\.optionsSource = f\.optionsSource;/);
  });
});
