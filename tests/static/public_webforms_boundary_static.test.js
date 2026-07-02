import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {describe, expect, it} from 'vitest';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..', '..');
const HTML_SHELLS = ['index.html', 'dailys.html', 'equipment.html', 'pasture-map.html'];

function read(rel) {
  return fs.readFileSync(path.join(ROOT, rel), 'utf8');
}

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

function webformSourceFiles() {
  return listRuntimeSourceFiles(path.join(ROOT, 'src/webforms')).filter(
    (file) => path.relative(ROOT, file).replace(/\\/g, '/') !== 'src/webforms/WebformsAdminView.jsx',
  );
}

function webformIslandCss(rel) {
  const src = read(rel);
  const start = src.indexOf('#webform-container{');
  const end = src.indexOf('  @media(max-width:400px)', start);
  if (start < 0 || end < 0) throw new Error(`Could not find webform island CSS in ${rel}`);
  return src.slice(start, end).trim();
}

describe('public webforms boundary', () => {
  it('keeps webforms away from profile/app_store/activity/notification tables', () => {
    const forbiddenTableRe =
      /\.from\(\s*['"](?:activity_events|activity_mentions|app_store|client_error_events|notifications|profiles|storage\.objects)['"]\s*\)/;
    const offenders = [];

    for (const file of webformSourceFiles()) {
      const rel = path.relative(ROOT, file).replace(/\\/g, '/');
      const code = stripComments(fs.readFileSync(file, 'utf8'));
      if (forbiddenTableRe.test(code)) offenders.push(rel);
    }

    expect(offenders).toEqual([]);
  });

  it('keeps webforms from creating ad hoc Supabase clients or using admin auth', () => {
    const forbiddenRe = /@supabase\/supabase-js|\bcreateClient\s*\(|\bauth\.admin\b/;
    const offenders = [];

    for (const file of webformSourceFiles()) {
      const rel = path.relative(ROOT, file).replace(/\\/g, '/');
      const code = stripComments(fs.readFileSync(file, 'utf8'));
      if (forbiddenRe.test(code)) offenders.push(rel);
    }

    expect(offenders).toEqual([]);
  });

  it('keeps server-only secrets and test/prod execution hooks out of webforms', () => {
    const forbiddenRe =
      /\b(?:SUPABASE_SERVICE_ROLE_KEY|SERVICE_ROLE|PROD_DB_URL|DATABASE_URL|exec_sql|VITE_TEST_ADMIN_EMAIL|VITE_TEST_ADMIN_PASSWORD|RESEND_API_KEY|TASKS_CRON_SECRET)\b/i;
    const offenders = [];

    for (const file of webformSourceFiles()) {
      const rel = path.relative(ROOT, file).replace(/\\/g, '/');
      const code = stripComments(fs.readFileSync(file, 'utf8'));
      if (forbiddenRe.test(code)) offenders.push(rel);
    }

    expect(offenders).toEqual([]);
  });

  it('keeps webforms independent of authenticated-app context hooks', () => {
    const offenders = [];

    for (const file of webformSourceFiles()) {
      const rel = path.relative(ROOT, file).replace(/\\/g, '/');
      const code = stripComments(fs.readFileSync(file, 'utf8'));
      if (/useAuth\s*\(|AuthContext/.test(code)) offenders.push(rel);
    }

    expect(offenders).toEqual([]);
  });
});

describe('public webform island CP5 styling tokens', () => {
  it('keeps every HTML shell on the same #webform-container island CSS', () => {
    const base = webformIslandCss(HTML_SHELLS[0]);
    for (const rel of HTML_SHELLS.slice(1)) {
      expect(webformIslandCss(rel), `${rel} webform island CSS drifted from ${HTML_SHELLS[0]}`).toBe(base);
    }
  });

  it('uses the CP0 section A3 radius floor and canonical control token shape inside the island', () => {
    const css = webformIslandCss('index.html');

    expect(css).toContain('--wf-text:#000000');
    expect(css).toContain('--wf-r-sm:10px;--wf-r-md:12px;--wf-r-lg:14px');
    expect(css).toContain('padding:8px 11px');
    expect(css).toContain('border:1px solid var(--wf-border2)');
    expect(css).toContain('border-radius:var(--wf-r-sm)');
    expect(css).toContain('#webform-container .card{');
    expect(css).toContain('border-radius:var(--wf-r-md)');
    expect(css).toContain('#webform-container .btn-another');
    expect(css).toContain('#webform-container .loading-msg');
    expect(css).not.toMatch(/--wf-r-(?:sm|md|lg):[1-9]px/);
    expect(css).not.toMatch(/border-radius:[1-9]px/);
  });

  it('keeps the island mobile grid override scoped to #webform-container', () => {
    for (const rel of HTML_SHELLS) {
      const src = read(rel);
      expect(src).toContain('@media(max-width:400px){#webform-container .grid2{grid-template-columns:1fr}}');
      expect(src).not.toContain('@media(max-width:400px){.grid2{grid-template-columns:1fr}}');
    }
  });
});
