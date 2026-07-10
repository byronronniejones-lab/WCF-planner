import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {describe, it, expect} from 'vitest';

// Static guards for sub-lane 4 of the Processing finish-out: server-backed
// Customer/Processor selector option lists (mig 162) + admin editor + drawer /
// Add-Milestone reading from settings (not hardcoded constants), preserving
// legacy/off-list values.

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..', '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

const mig162 = read('supabase-migrations/162_processing_option_lists.sql');
const api = read('src/lib/processingApi.js');
const optionsModal = read('src/processing/ProcessingOptionsModal.jsx');
const drawer = read('src/processing/ProcessingDrawer.jsx');
const addMilestone = read('src/processing/AddMilestoneModal.jsx');
const view = read('src/processing/ProcessingCalendarView.jsx');

describe('mig 162 — option lists on the settings singleton', () => {
  it('adds customer_options and an admin-gated setter, without constraining stored values', () => {
    expect(mig162).toContain('ADD COLUMN IF NOT EXISTS customer_options');
    expect(mig162).toContain('CREATE OR REPLACE FUNCTION public.set_processing_option_list');
    expect(mig162).toContain('SECURITY DEFINER');
    expect(mig162).toMatch(/v_role <> 'admin'/);
    expect(mig162).toContain("p_kind NOT IN ('processor', 'customer')");
    expect(mig162).toContain("jsonb_typeof(COALESCE(p_options, '[]'::jsonb)) <> 'array'");
    expect(mig162).toContain(
      'GRANT EXECUTE ON FUNCTION public.set_processing_option_list(text, jsonb) TO authenticated',
    );
    // The lists drive widgets only — no CHECK / rewrite of stored record values.
    expect(mig162).not.toMatch(/ALTER TABLE public\.processing_records/);
    expect(mig162).not.toMatch(/ADD CONSTRAINT|CHECK \(processor|CHECK \(customer/);
    expect(mig162).not.toContain('UPDATE public.processing_records');
  });
});

describe('api wrapper', () => {
  it('exposes setProcessingOptionList calling the RPC', () => {
    expect(api).toContain('export async function setProcessingOptionList');
    expect(api).toContain("sb.rpc('set_processing_option_list'");
  });
});

describe('admin options editor', () => {
  it('ProcessingOptionsModal saves both lists via the wrapper', () => {
    expect(optionsModal).toContain('data-processing-options-modal="1"');
    expect(optionsModal).toContain('setProcessingOptionList(sb, kind, items)');
    expect(optionsModal).toContain('data-processing-option-save');
    expect(optionsModal).toContain('data-processing-option-add-input');
  });
});

describe('drawer + Add Milestone read from settings (not hardcoded)', () => {
  it('drawer renders customer chips from the merged option list + a TRUE processor select', () => {
    expect(drawer).toContain('customerOptions = []');
    expect(drawer).toContain('processorOptions = []');
    expect(drawer).toContain('customerChoices.map');
    // Template-suite lane: the free-text/datalist processor is retired — the
    // control is a select over processor_options; a stored legacy value stays
    // visible/selectable; arbitrary typing is impossible.
    expect(drawer).toContain('data-processing-processor-select');
    expect(drawer).not.toContain('processing-processor-choices');
    expect(drawer).not.toContain('datalist');
    // legacy/off-list stored values are merged back in so they stay toggleable
    expect(drawer).toMatch(/for \(const c of customerSelected\) if \(c && !merged\.includes\(c\)\)/);
    // the old hardcoded map is gone (constant kept only as a fetch-failure fallback)
    expect(drawer).not.toContain('CUSTOMER_OPTIONS.map');
    expect(drawer).toContain('CUSTOMER_OPTIONS_FALLBACK');
  });

  it('Add Milestone uses settings options + a TRUE processor select (not staff names)', () => {
    expect(addMilestone).toContain('customerOptions = []');
    expect(addMilestone).toContain('processorOptions = []');
    expect(addMilestone).toContain('customerChoices.map');
    expect(addMilestone).toMatch(/<select[\s\S]{0,400}data-processing-milestone-processor/);
    expect(addMilestone).not.toContain('datalist');
    // the mislabeled PEOPLE datalist is removed
    expect(addMilestone).not.toContain('processing-people');
    expect(addMilestone).not.toMatch(/const PEOPLE =/);
    expect(addMilestone).not.toContain('CUSTOMER_OPTIONS.map');
  });
});

describe('calendar wires the option lists through', () => {
  it('fetches settings for operational roles and passes options to drawer + modal', () => {
    expect(view).toContain('refreshOptionLists');
    expect(view).toContain('setOptionLists');
    expect(view).toContain('customerOptions={optionLists.customer}');
    expect(view).toContain('processorOptions={optionLists.processor}');
    expect(view).toContain('data-processing-options-btn="1"');
    expect(view).toContain('<ProcessingOptionsModal');
    expect(view).toContain('onSaved={refreshOptionLists}');
  });
});
