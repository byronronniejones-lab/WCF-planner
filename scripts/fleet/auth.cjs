#!/usr/bin/env node
// ============================================================================
// scripts/fleet/auth.cjs — synthetic TEST admin via the GoTrue Auth admin API
// ============================================================================
// Creates the per-project loginable TEST admin (needed by the Playwright global
// setup, which signs in through the real login screen) plus its profiles row.
//
// Safety:
//   - Credentials (service-role key, admin password) travel in HTTP HEADERS /
//     JSON body only — never in argv/logs. The caller sources the service-role
//     key from keys.cjs (non-enumerable) and generates the password fresh.
//   - email_confirm:true marks the address confirmed so GoTrue sends NO
//     confirmation email; createUser (never inviteUserByEmail) sends no invite.
//     Fresh projects also have no SMTP configured. Emails use the reserved
//     non-deliverable domain wcfplanner.test.
//   - Idempotent: an already-existing admin (422) is looked up and its password
//     is reset via the admin API so the stored secret always logs in.
// ============================================================================
'use strict';

const {assertNotProdRef} = require('./projects.cjs');
const {redactError} = require('./redact.cjs');

const ADMIN_EMAIL = 'wcf-fleet-admin@wcfplanner.test';
const ADMIN_FULL_NAME = 'WCF Fleet Test Admin';

function adminHeaders(serviceRole) {
  return {apikey: serviceRole, Authorization: `Bearer ${serviceRole}`};
}

// Create-or-reset the admin GoTrue user. Returns its uuid. Never logs secrets.
async function ensureAdminUser(io, {ref, url, serviceRole, password, email = ADMIN_EMAIL, fullName = ADMIN_FULL_NAME}) {
  assertNotProdRef(ref);
  if (!serviceRole || !password) throw new Error('ensureAdminUser: serviceRole and password are required.');
  const base = `${url}/auth/v1/admin/users`;
  const headers = adminHeaders(serviceRole);

  // 1) try to create
  const create = await io.fetchJson(base, {
    method: 'POST',
    headers,
    body: {email, password, email_confirm: true, user_metadata: {full_name: fullName}},
  });
  if (create.status >= 200 && create.status < 300 && create.json && create.json.id) {
    return {id: create.json.id, created: true};
  }
  // 2) already exists (422/400/409): look it up and reset its password.
  const existing = await findUserByEmail(io, {base, headers, email});
  if (!existing) {
    throw redactError(
      new Error(`ensureAdminUser failed for ${ref}: create status ${create.status}, and user not found on lookup.`),
    );
  }
  const upd = await io.fetchJson(`${base}/${existing}`, {
    method: 'PUT',
    headers,
    body: {password, email_confirm: true, user_metadata: {full_name: fullName}},
  });
  if (!(upd.status >= 200 && upd.status < 300)) {
    throw redactError(
      new Error(`ensureAdminUser: password reset for existing admin failed (status ${upd.status}) on ${ref}.`),
    );
  }
  return {id: existing, created: false};
}

async function findUserByEmail(io, {base, headers, email}) {
  // GoTrue admin list supports ?email=; fall back to scanning page 1.
  const byQuery = await io.fetchJson(`${base}?email=${encodeURIComponent(email)}`, {headers});
  const list = (byQuery.json && (byQuery.json.users || byQuery.json)) || [];
  const arr = Array.isArray(list) ? list : [];
  const hit = arr.find((u) => u && u.email && u.email.toLowerCase() === email.toLowerCase());
  return hit ? hit.id : null;
}

// SQL to upsert the admin profile row (role=admin) keyed to the auth user id.
function adminProfileUpsertSql(adminId, email = ADMIN_EMAIL, fullName = ADMIN_FULL_NAME) {
  const esc = (v) => `'${String(v).replace(/'/g, "''")}'`;
  return `insert into public.profiles (id, email, full_name, role)
values (${esc(adminId)}, ${esc(email)}, ${esc(fullName)}, 'admin')
on conflict (id) do update set role='admin', full_name=excluded.full_name, email=excluded.email;`;
}

module.exports = {ADMIN_EMAIL, ADMIN_FULL_NAME, ensureAdminUser, findUserByEmail, adminProfileUpsertSql};
