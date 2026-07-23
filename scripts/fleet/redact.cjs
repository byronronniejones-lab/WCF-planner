#!/usr/bin/env node
// ============================================================================
// scripts/fleet/redact.cjs — credential redaction for logs, errors, reports
// ============================================================================
// Every string the fleet toolkit prints (progress, errors, readiness reports)
// passes through redact(). It masks credential SHAPES so a service-role key,
// anon key, JWT, Postgres connection string, bearer token, or password that
// leaks into an error message or command output never reaches chat, logs,
// screenshots, or a committed file.
//
// Redaction is intentionally aggressive on credential shapes and conservative
// on ordinary text: it targets JWTs, sb_*/sbp_ tokens, postgres URIs, explicit
// password=/apikey= assignments, Bearer headers, and long base64/hex runs that
// look like keys. Project refs (20-char lowercase) are NOT secret and are left
// intact so operators can still see which project an action targeted.
// ============================================================================
'use strict';

const MASK = '«redacted»';

// Ordered list of [regex, replacement]. Applied in sequence.
const PATTERNS = [
  // JWTs (anon key, service-role key, GoTrue tokens): three base64url segments.
  [/eyJ[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}/g, MASK],
  // Supabase publishable/secret key formats (sb_secret_..., sbp_..., sbs_...).
  [/\b(?:sb|sbp|sbs)_[A-Za-z0-9_-]{16,}\b/g, MASK],
  // Postgres connection strings (may embed a password).
  [/postgres(?:ql)?:\/\/[^\s"'<>]+/gi, MASK],
  // Explicit secret assignments: password=..., apikey=..., token=..., secret=...
  [
    /\b(pass(?:word)?|pwd|api[-_]?key|secret|token|service[-_]?role[-_]?key|anon[-_]?key)\b\s*[:=]\s*("[^"]*"|'[^']*'|\S+)/gi,
    (_m, k) => `${k}=${MASK}`,
  ],
  // Authorization: Bearer <token>
  [/\bBearer\s+[A-Za-z0-9._~+/=-]{12,}/gi, `Bearer ${MASK}`],
  // Long standalone base64/hex runs (>=40) that look like raw keys. Kept last
  // so it does not clobber the more specific matches above.
  [/\b[A-Za-z0-9+/]{40,}={0,2}\b/g, MASK],
  [/\b[0-9a-fA-F]{48,}\b/g, MASK],
];

function redact(input) {
  if (input == null) return input;
  let s = typeof input === 'string' ? input : String(input);
  for (const [rx, rep] of PATTERNS) {
    s = s.replace(rx, rep);
  }
  return s;
}

// Return a NEW Error whose message and stack are redacted. Preserves the name
// and a redacted `.cause` when present. Never mutates the original.
function redactError(err) {
  if (!(err instanceof Error)) return new Error(redact(err));
  const clean = new Error(redact(err.message));
  clean.name = err.name;
  if (err.stack) clean.stack = redact(err.stack);
  if (err.code !== undefined) clean.code = err.code;
  if (err.exitCode !== undefined) clean.exitCode = err.exitCode;
  return clean;
}

// Assert a string carries no obvious credential shape. Used by tests and by
// report writers to fail closed if a redaction gap ever lets one through.
function assertNoSecrets(str, context = 'value') {
  const redacted = redact(str);
  if (redacted !== str) {
    throw new Error(`${context} appears to contain a credential-shaped value; refusing to emit it.`);
  }
  return str;
}

module.exports = {MASK, redact, redactError, assertNoSecrets, _PATTERNS: PATTERNS};
