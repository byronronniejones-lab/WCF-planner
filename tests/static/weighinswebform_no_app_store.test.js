// Static lock: WeighInsWebform.jsx must not reference app_store / ppp-v4.
//
// The public broiler weigh-in form moved to webform_config.broiler_batch_meta
// (see src/lib/broilerBatchMeta.js). The previous app_store ppp-v4 read was
// anon-blocked under prod RLS and silently produced "(no schooner)" fallbacks.
// This test guards against accidental reintroduction of either string in the
// public form file. Scoped to that single file — admin code legitimately uses
// both.

import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {dirname, resolve} from 'node:path';
import {describe, it, expect} from 'vitest';

const HERE = dirname(fileURLToPath(import.meta.url));
const FORM_PATH = resolve(HERE, '../../src/webforms/WeighInsWebform.jsx');

describe('WeighInsWebform.jsx static lock', () => {
  const source = readFileSync(FORM_PATH, 'utf8');

  it('does not contain the literal "app_store"', () => {
    expect(source).not.toMatch(/app_store/);
  });

  it('does not contain the literal "ppp-v4"', () => {
    expect(source).not.toMatch(/ppp-v4/);
  });

  it('imports the public broiler mirror helper', () => {
    expect(source).toMatch(/from\s+['"]\.\.\/lib\/broilerBatchMeta\.js['"]/);
  });

  it('reads broiler_batch_meta from webform_config', () => {
    expect(source).toMatch(/broiler_batch_meta/);
  });
});
