import {describe, it, expect} from 'vitest';
import {redactString, buildErrorEvent} from './clientErrorReporting.js';

describe('redactString', () => {
  it('returns empty string for null/undefined', () => {
    expect(redactString(null)).toBe('');
    expect(redactString(undefined)).toBe('');
  });

  it('passes through safe strings', () => {
    expect(redactString('Something failed in CattleHerdsView')).toBe('Something failed in CattleHerdsView');
  });

  it('redacts JWT-like base64 tokens', () => {
    const input =
      'Auth failed: eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U';
    expect(redactString(input)).not.toContain('eyJ');
    expect(redactString(input)).toContain('[REDACTED]');
  });

  it('redacts Bearer tokens', () => {
    expect(redactString('Bearer sb-abc-123-token')).toBe('[REDACTED]');
  });

  it('redacts supabase URLs', () => {
    const input = 'Failed to fetch https://pzfujbjtayhkdlxiblwe.supabase.co/rest/v1/cattle';
    expect(redactString(input)).not.toContain('supabase.co');
  });

  it('redacts access_token query params', () => {
    expect(redactString('url?access_token=abc123&type=recovery')).toContain('[REDACTED]');
    expect(redactString('url?access_token=abc123&type=recovery')).not.toContain('abc123');
  });

  it('redacts refresh_token query params', () => {
    expect(redactString('refresh_token=xyz789')).toContain('[REDACTED]');
  });

  it('redacts apikey params', () => {
    expect(redactString('apikey=sb-secret-key-here')).toContain('[REDACTED]');
  });

  it('redacts password references', () => {
    expect(redactString('password=hunter2')).toContain('[REDACTED]');
    expect(redactString('password: secret123')).toContain('[REDACTED]');
  });

  it('redacts localStorage references', () => {
    expect(redactString('localStorage.farm-planner-auth')).toContain('[REDACTED]');
  });
});

describe('buildErrorEvent', () => {
  it('builds a minimal event from an Error', () => {
    const err = new Error('test failure');
    const evt = buildErrorEvent('test-source', err);
    expect(evt.source).toBe('test-source');
    expect(evt.error_kind).toBe('Error');
    expect(evt.message).toBe('test failure');
    expect(evt.timestamp).toBeTruthy();
    expect(evt.stack_summary).toBeTruthy();
  });

  it('truncates long messages to 200 chars', () => {
    const err = new Error('x'.repeat(500));
    const evt = buildErrorEvent('test', err);
    expect(evt.message.length).toBeLessThanOrEqual(200);
  });

  it('truncates stack to 500 chars', () => {
    const err = new Error('test');
    err.stack = 'line\n'.repeat(200);
    const evt = buildErrorEvent('test', err);
    expect(evt.stack_summary.length).toBeLessThanOrEqual(500);
  });

  it('limits stack to 5 lines', () => {
    const err = new Error('test');
    err.stack = Array.from({length: 20}, (_, i) => `at func${i} (file.js:${i}:1)`).join('\n');
    const evt = buildErrorEvent('test', err);
    const lines = evt.stack_summary.split('\n');
    expect(lines.length).toBeLessThanOrEqual(5);
  });

  it('redacts sensitive content in messages', () => {
    const err = new Error('Failed at https://xyz.supabase.co/rest with Bearer sb-token-123');
    const evt = buildErrorEvent('test', err);
    expect(evt.message).not.toContain('supabase.co');
    expect(evt.message).not.toContain('sb-token');
  });

  it('handles null/undefined error gracefully', () => {
    const evt = buildErrorEvent('test', null);
    expect(evt.source).toBe('test');
    expect(evt.error_kind).toBe('Error');
    expect(evt.message).toBe('');
  });

  it('merges extra fields', () => {
    const evt = buildErrorEvent('test', new Error('x'), {componentStack: 'at App'});
    expect(evt.componentStack).toBe('at App');
  });
});
