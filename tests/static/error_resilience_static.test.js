import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {describe, it, expect} from 'vitest';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..', '..');

const mainSrc = fs.readFileSync(path.join(ROOT, 'src/main.jsx'), 'utf8');
const errorBoundarySrc = fs.readFileSync(path.join(ROOT, 'src/shared/ErrorBoundary.jsx'), 'utf8');
const reportingSrc = fs.readFileSync(path.join(ROOT, 'src/lib/clientErrorReporting.js'), 'utf8');
const migrationSrc = fs.readFileSync(path.join(ROOT, 'supabase-migrations/068_client_error_events.sql'), 'utf8');

describe('Error Resilience - main.jsx wiring', () => {
  it('imports ErrorBoundary', () => {
    expect(mainSrc).toContain("import ErrorBoundary from './shared/ErrorBoundary.jsx'");
  });

  it('imports and calls initErrorReporting', () => {
    expect(mainSrc).toContain(
      "import {initErrorReporting, installGlobalListeners} from './lib/clientErrorReporting.js'",
    );
    expect(mainSrc).toContain('initErrorReporting(sb)');
  });

  it('calls installGlobalListeners', () => {
    expect(mainSrc).toContain('installGlobalListeners()');
  });

  it('wraps the provider tree with ErrorBoundary', () => {
    const ebOpen = mainSrc.indexOf('<ErrorBoundary>');
    const brOpen = mainSrc.indexOf('<BrowserRouter>', ebOpen);
    const brClose = mainSrc.indexOf('</BrowserRouter>', brOpen);
    const ebClose = mainSrc.indexOf('</ErrorBoundary>', brClose);
    expect(ebOpen).toBeGreaterThan(-1);
    expect(brOpen).toBeGreaterThan(ebOpen);
    expect(ebClose).toBeGreaterThan(brClose);
  });
});

describe('Error Resilience - ErrorBoundary component', () => {
  it('is a class component with getDerivedStateFromError', () => {
    expect(errorBoundarySrc).toContain('getDerivedStateFromError');
  });

  it('has componentDidCatch that calls reportError', () => {
    expect(errorBoundarySrc).toContain('componentDidCatch');
    expect(errorBoundarySrc).toContain('reportError');
  });

  it('renders a reload button in fallback', () => {
    expect(errorBoundarySrc).toContain('Reload');
    expect(errorBoundarySrc).toContain('window.location.reload()');
  });

  it('does not expose stack traces in fallback UI', () => {
    const fallbackMatch = errorBoundarySrc.match(/if\s*\(this\.state\.hasError\)\s*\{[\s\S]*?return\s*\([\s\S]*?\);/);
    expect(fallbackMatch).toBeTruthy();
    const fallback = fallbackMatch[0];
    expect(fallback).not.toContain('stack_summary');
    expect(fallback).not.toContain('componentStack');
    expect(fallback).not.toContain('error.message');
    expect(fallback).not.toContain('error.stack');
  });

  it('does not use window.alert or window.confirm', () => {
    expect(errorBoundarySrc).not.toContain('window.alert');
    expect(errorBoundarySrc).not.toContain('window.confirm');
    expect(errorBoundarySrc).not.toContain('window.prompt');
  });
});

describe('Error Resilience - clientErrorReporting', () => {
  it('exports redactString', () => {
    expect(reportingSrc).toContain('export function redactString');
  });

  it('exports buildErrorEvent', () => {
    expect(reportingSrc).toContain('export function buildErrorEvent');
  });

  it('exports reportError', () => {
    expect(reportingSrc).toContain('export async function reportError');
  });

  it('exports installGlobalListeners', () => {
    expect(reportingSrc).toContain('export function installGlobalListeners');
  });

  it('registers window error listener', () => {
    expect(reportingSrc).toContain("window.addEventListener('error'");
  });

  it('registers unhandledrejection listener', () => {
    expect(reportingSrc).toContain("window.addEventListener('unhandledrejection'");
  });

  it('uses record_client_error RPC for durable persistence', () => {
    expect(reportingSrc).toContain("_sb.rpc('record_client_error'");
  });

  it('does not log raw payloads or localStorage content', () => {
    expect(reportingSrc).not.toMatch(/localStorage\.getItem/);
    expect(reportingSrc).not.toMatch(/JSON\.stringify\(.*body/i);
  });

  it('truncates message and stack', () => {
    expect(reportingSrc).toContain('MAX_MSG_LEN');
    expect(reportingSrc).toContain('MAX_STACK_LEN');
  });
});

describe('Error Resilience - migration 068', () => {
  it('creates client_error_events table', () => {
    expect(migrationSrc).toContain('CREATE TABLE');
    expect(migrationSrc).toContain('client_error_events');
  });

  it('has length constraints on all text columns', () => {
    expect(migrationSrc).toContain('char_length(source) <= 50');
    expect(migrationSrc).toContain('char_length(error_kind) <= 100');
    expect(migrationSrc).toContain('char_length(message) <= 200');
    expect(migrationSrc).toContain('char_length(stack_summary) <= 500');
  });

  it('enables RLS, revokes from PUBLIC/anon/authenticated, and grants SELECT to authenticated', () => {
    expect(migrationSrc).toContain('ENABLE ROW LEVEL SECURITY');
    expect(migrationSrc).toContain('REVOKE ALL ON public.client_error_events FROM PUBLIC, anon, authenticated');
    expect(migrationSrc).toContain('GRANT SELECT ON public.client_error_events TO authenticated');
  });

  it('creates admin-only read policy', () => {
    expect(migrationSrc).toContain('admin_read');
    expect(migrationSrc).toContain("role = 'admin'");
  });

  it('creates SECURITY DEFINER record_client_error RPC', () => {
    expect(migrationSrc).toContain('SECURITY DEFINER');
    expect(migrationSrc).toContain('record_client_error');
  });

  it('revokes PUBLIC execute then grants to authenticated and anon', () => {
    expect(migrationSrc).toContain(
      'REVOKE ALL ON FUNCTION public.record_client_error(text, text, text, text, text, text) FROM PUBLIC',
    );
    expect(migrationSrc).toContain(
      'GRANT EXECUTE ON FUNCTION public.record_client_error(text, text, text, text, text, text) TO authenticated',
    );
    expect(migrationSrc).toContain(
      'GRANT EXECUTE ON FUNCTION public.record_client_error(text, text, text, text, text, text) TO anon',
    );
  });

  it('sends pgrst reload notification', () => {
    expect(migrationSrc).toContain("NOTIFY pgrst, 'reload schema'");
  });

  it('uses left() to enforce server-side truncation', () => {
    expect(migrationSrc).toContain('left(coalesce(');
    expect(migrationSrc).toContain('left(coalesce(p_message');
  });

  it('coalesces null required fields to safe defaults', () => {
    expect(migrationSrc).toContain("'unknown'");
    expect(migrationSrc).toContain("'Error'");
  });
});

describe('Error Resilience - no non-ASCII in new files', () => {
  const files = [reportingSrc, errorBoundarySrc, migrationSrc];
  it('contains only ASCII characters', () => {
    for (const src of files) {
      // eslint-disable-next-line no-control-regex
      expect(src).toMatch(/^[\x00-\x7F]*$/s);
    }
  });
});

describe('Error Resilience - installGlobalListeners idempotency', () => {
  it('has an installed guard', () => {
    expect(reportingSrc).toContain('_listenersInstalled');
  });

  it('returns early on second call', () => {
    expect(reportingSrc).toMatch(/if\s*\(.*_listenersInstalled\)\s*return/);
  });
});
