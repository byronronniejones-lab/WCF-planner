import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {describe, expect, it} from 'vitest';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..', '..');

function stripComments(src) {
  return src.replace(/(^|\s)\/\/[^\n]*/g, '$1').replace(/\/\*[\s\S]*?\*\//g, '');
}

function listRuntimeSourceFiles(dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, {withFileTypes: true})) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...listRuntimeSourceFiles(full));
      continue;
    }
    if (!entry.isFile() || !/\.(jsx?|cjs|mjs)$/.test(entry.name)) continue;
    if (/\.(test|spec)\.(jsx?|cjs|mjs)$/.test(entry.name)) continue;
    out.push(full);
  }
  return out;
}

function runtimeSourceFiles() {
  return listRuntimeSourceFiles(path.join(ROOT, 'src'));
}

describe('Supabase client owner boundary', () => {
  it('keeps browser createClient ownership in src/lib/supabase.js', () => {
    const seenImports = [];
    const seenCalls = [];

    for (const file of runtimeSourceFiles()) {
      const rel = path.relative(ROOT, file).replace(/\\/g, '/');
      const code = stripComments(fs.readFileSync(file, 'utf8'));
      const importCount = [...code.matchAll(/@supabase\/supabase-js/g)].length;
      const callCount = [...code.matchAll(/\bcreateClient\s*\(/g)].length;
      if (importCount) seenImports.push(`${rel}: ${importCount}`);
      if (callCount) seenCalls.push(`${rel}: ${callCount}`);
    }

    expect(seenImports).toEqual(['src/lib/supabase.js: 1']);
    expect(seenCalls).toEqual(['src/lib/supabase.js: 1']);
  });

  it('keeps the shared browser client exported from src/lib/supabase.js with critical options', () => {
    const src = fs.readFileSync(path.join(ROOT, 'src/lib/supabase.js'), 'utf8');
    expect(src).toContain("import {createClient} from '@supabase/supabase-js'");
    expect(src).toContain('export const sb = createClient(SUPABASE_URL, SUPABASE_KEY');
    expect(src).toMatch(/storageKey:\s*'farm-planner-auth'/);
    expect(src).toMatch(/detectSessionInUrl:\s*false/);
    expect(src).toMatch(/lock:\s*\(name,\s*acquireTimeout,\s*fn\)\s*=>\s*fn\(\)/);
  });
});
