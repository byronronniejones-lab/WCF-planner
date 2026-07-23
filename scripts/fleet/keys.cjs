#!/usr/bin/env node
// ============================================================================
// scripts/fleet/keys.cjs — retrieve a TEST project's anon + service-role keys
// via `supabase projects api-keys`, WITHOUT ever printing them.
// ============================================================================
// The returned credentials object exposes `url` + `ref` as enumerable fields
// but keeps `anon` and `serviceRole` NON-ENUMERABLE, so an accidental
// console.log / JSON.stringify of the object cannot leak the keys. Callers must
// still route the values only into stdin-fed sinks (Auth admin API, gh secret
// set --body-file / stdin, an owner-only .env file) — never into argv or logs.
// ============================================================================
'use strict';

const {assertNotProdRef} = require('./projects.cjs');
const {redactError} = require('./redact.cjs');

function makeCreds({ref, url, anon, serviceRole}) {
  const creds = {};
  Object.defineProperty(creds, 'ref', {value: ref, enumerable: true});
  Object.defineProperty(creds, 'url', {value: url, enumerable: true});
  // Non-enumerable: excluded from console.log / JSON.stringify / Object.keys.
  Object.defineProperty(creds, 'anon', {value: anon, enumerable: false});
  Object.defineProperty(creds, 'serviceRole', {value: serviceRole, enumerable: false});
  Object.defineProperty(creds, 'toJSON', {
    value: () => ({ref, url, anon: '«redacted»', serviceRole: '«redacted»'}),
    enumerable: false,
  });
  return creds;
}

async function fetchProjectKeys(io, {ref}) {
  assertNotProdRef(ref); // never fetch PROD keys through the fleet toolkit
  const res = await io.run('supabase', ['projects', 'api-keys', '--project-ref', ref, '-o', 'json']);
  if (res.code !== 0) {
    throw redactError(new Error(`api-keys fetch failed for ${ref}: ${res.stderr || res.stdout}`));
  }
  let arr;
  try {
    const start = res.stdout.search(/\[/);
    arr = JSON.parse(res.stdout.slice(start === -1 ? 0 : start));
  } catch {
    throw new Error(`api-keys response for ${ref} was not parseable JSON.`);
  }
  const byName = (n) => (arr.find((k) => k && k.name === n) || {}).api_key;
  const anon = byName('anon');
  const serviceRole = byName('service_role');
  if (!anon || !serviceRole) {
    throw new Error(`api-keys for ${ref} is missing the anon and/or service_role legacy key.`);
  }
  return makeCreds({ref, url: `https://${ref}.supabase.co`, anon, serviceRole});
}

module.exports = {fetchProjectKeys, makeCreds};
