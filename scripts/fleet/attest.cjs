#!/usr/bin/env node
// ============================================================================
// scripts/fleet/attest.cjs — fail-closed drift / readiness attestation
// ============================================================================
// Produces a sanitized readiness report for an assigned TEST target and a hard
// ready/not-ready verdict. Fail closed: any missing/ambiguous check => NOT READY.
//
// Counting is stated EXPLICITLY (Codex requirement): base tables vs all
// relations, function NAMES vs full function SIGNATURES — and the signature set
// is compared, so an overload can never hide behind an aggregate count.
//
// Checks:
//   link         linked ref == assigned ref, and != PROD
//   marker       wcf_fleet_marker present, environment='test', ref matches
//   ledger       every repo migration recorded, no checksum drift / missing /
//                extra / out-of-order, and none 'refused'
//   schema       object set matches the repo-derived baseline (expected-fleet.json)
//                at the SIGNATURE level, when a baseline exists
//   exec_sql     present
//   buckets      the 9 expected migration buckets present
//   admin        loginable admin profile (role=admin) + confirmed auth user
//   cron_vault   placeholder-backed cron jobs are disabled (no false-green)
//   no_prod      no PROD ref appears in marker/url
// ============================================================================
'use strict';

const fs = require('fs');
const path = require('path');
const {assertBootstrapTarget, isProdRef} = require('./projects.cjs');
const {ensureLinked} = require('./target.cjs');
const {runSql} = require('./sql.cjs');
const {snapshotObjects, listMigrations, reconcile} = require('./ledger.cjs');
const {classifyCronVault} = require('./cron.cjs');
const {readMarker} = require('./marker.cjs');
const {computeRepoExpected, partitionRelations, FLEET_METADATA_TABLES} = require('./expected.cjs');

const EXPECTED_PATH = path.join(__dirname, 'expected-fleet.json');
const EXPECTED_BUCKETS = [
  'comment-photos',
  'daily-photos',
  'equipment-maintenance-docs',
  'fuel-bills',
  'newsletter-public',
  'newsletter-staging',
  'processing-attachments',
  'task-photos',
  'task-request-photos',
];

function loadExpected() {
  try {
    return JSON.parse(fs.readFileSync(EXPECTED_PATH, 'utf8'));
  } catch {
    return null;
  }
}

function setDiff(a, b) {
  const A = new Set(a);
  const B = new Set(b);
  return {onlyA: [...A].filter((x) => !B.has(x)), onlyB: [...B].filter((x) => !A.has(x))};
}

async function attest(io, {key, workdir}) {
  const entry = assertBootstrapTarget(key); // fail closed on PROD/reference/unknown
  const checks = [];
  const add = (name, ok, detail) => checks.push({name, ok: !!ok, detail});

  // link
  let linkedRef = null;
  try {
    await ensureLinked(io, {key, workdir});
    linkedRef = require('./target.cjs').readLinkedRef(io, workdir);
    add('link', linkedRef === entry.ref && !isProdRef(linkedRef), `linked ${linkedRef} == assigned ${entry.ref}`);
  } catch (e) {
    add('link', false, e.message);
    return finalize(entry, checks, null); // cannot proceed unlinked
  }

  // marker
  const marker = await readMarker(io, {key, workdir}, {runSql});
  add(
    'marker',
    marker && marker.environment === 'test' && marker.project_ref === entry.ref && marker.project_key === entry.key,
    marker ? `env=${marker.environment} ref=${marker.project_ref} key=${marker.project_key}` : 'no marker row',
  );

  // no PROD ref anywhere
  add(
    'no_prod',
    marker && !isProdRef(marker.project_ref) && !String(marker.project_ref).includes('pzfujbjtayhkdlxiblwe'),
    'marker carries no PROD ref',
  );

  // ledger
  const migrations = listMigrations();
  const {rows: ledgerRows} = await runSql(io, {
    key,
    workdir,
    sql: `select version, kind, checksum, status from public.wcf_fleet_migrations;`,
  }).catch(() => ({rows: []}));
  const rep = reconcile(
    migrations,
    ledgerRows.filter((r) => r.kind === 'migration'),
  );
  const refused = ledgerRows.filter((r) => r.status === 'refused').map((r) => r.version);
  add(
    'ledger',
    rep.ok && refused.length === 0,
    `changed=${rep.changed.length} missing=${rep.missingFromLedger.length} extra=${rep.extra.length} refused=${refused.length}`,
  );

  // schema snapshot + counts (explicit definitions)
  const snap = await snapshotObjects(io, {key, workdir}, {runSql});
  const parts = partitionRelations([...snap.allRelations]);
  const counts = {
    base_tables: snap.baseTables.size,
    all_relations: snap.allRelations.size,
    application_relations: parts.application.length,
    fleet_metadata_relations: parts.fleetMetadata.length,
    function_names: snap.functionNames.size,
    function_signatures: snap.functionSignatures.size,
    buckets: snap.buckets.size,
    extensions: snap.extensions.size,
  };

  // fleet metadata present (both marker + ledger tables), kept OUT of the
  // application comparison so it can never mask application drift.
  const missingMeta = FLEET_METADATA_TABLES.filter((t) => !snap.allRelations.has(t));
  add(
    'fleet_metadata',
    missingMeta.length === 0,
    missingMeta.length ? `missing: ${missingMeta.join(',')}` : `present: ${FLEET_METADATA_TABLES.join(',')}`,
  );

  // schema vs baseline — APPLICATION objects only, signature level. attest is
  // READ-ONLY w.r.t. the baseline; it never regenerates it.
  const expected = loadExpected();
  if (expected && expected.application) {
    const appRel = parts.application;
    const relD = setDiff(appRel, expected.application.all_relations);
    const sigD = setDiff([...snap.functionSignatures], expected.application.function_signatures);
    const bkD = setDiff([...snap.buckets], expected.application.buckets);
    const extD = setDiff([...snap.extensions], expected.application.extensions || []);
    const ok = [relD, sigD, bkD, extD].every((d) => d.onlyA.length === 0 && d.onlyB.length === 0);
    add(
      'schema',
      ok,
      `app-relations±(${relD.onlyA.length}/${relD.onlyB.length}) signatures±(${sigD.onlyA.length}/${sigD.onlyB.length}) buckets±(${bkD.onlyA.length}/${bkD.onlyB.length}) exts±(${extD.onlyA.length}/${extD.onlyB.length})`,
    );
    checks.at(-1).signatureDelta = {relations: relD, functionSignatures: sigD, buckets: bkD, extensions: extD};

    // Anti-circularity anchor: the baseline's application tables/buckets/
    // extensions MUST agree with the repo-migration-derived set, so a baseline
    // regenerated from a drifted project (extra/missing app object) is caught.
    const repo = computeRepoExpected();
    const tRepo = setDiff(expected.application.base_tables, repo.base_tables);
    const bRepo = setDiff(expected.application.buckets, repo.buckets);
    // extensions: repo-required must be a subset of the baseline (platform
    // defaults are allowed extras).
    const repoExtMissing = repo.extensions.filter((e) => !(expected.application.extensions || []).includes(e));
    const repoOk =
      tRepo.onlyA.length === 0 &&
      tRepo.onlyB.length === 0 &&
      bRepo.onlyA.length === 0 &&
      bRepo.onlyB.length === 0 &&
      repoExtMissing.length === 0;
    add(
      'baseline_repo_agreement',
      repoOk,
      `baseline-vs-repo tables±(${tRepo.onlyA.length}/${tRepo.onlyB.length}) buckets±(${bRepo.onlyA.length}/${bRepo.onlyB.length}) missing-required-exts=${repoExtMissing.length}`,
    );
    checks.at(-1).repoDelta = {tables: tRepo, buckets: bRepo, missingRequiredExtensions: repoExtMissing};
  } else {
    add(
      'schema',
      false,
      'NO committed baseline (expected-fleet.json). NOT READY — a reviewed baseline from a fresh-execute source is required.',
    );
  }

  // exec_sql
  add('exec_sql', snap.functionNames.has('exec_sql'), 'public.exec_sql present');

  // privileges — object PRESENCE is not enough: a project rebuilt after
  // "drop schema public cascade" that failed to restore Supabase's per-object
  // default privileges (pg_default_acl) has exec_sql present but NOT executable
  // by service_role (reset TRUNCATE 403s) and app tables unreadable by
  // anon/authenticated (the app 403s) — yet every presence check above passes.
  // This check closes that blind spot and also asserts exec_sql stays locked to
  // service_role (anon/authenticated must NOT be able to execute it).
  const {rows: privRows} = await runSql(io, {
    key,
    workdir,
    sql: `select
      has_function_privilege('service_role','public.exec_sql(text)','execute') as sr_exec,
      has_function_privilege('anon','public.exec_sql(text)','execute') as anon_exec,
      has_function_privilege('authenticated','public.exec_sql(text)','execute') as auth_exec,
      has_table_privilege('authenticated','public.profiles','select') as auth_profiles,
      (select count(*) from pg_default_acl d
         join pg_namespace n on n.oid=d.defaclnamespace
         join pg_roles r on r.oid=d.defaclrole
        where n.nspname='public' and r.rolname='postgres') as default_acls;`,
  }).catch(() => ({rows: []}));
  const pv = privRows[0] || {};
  const B = (x) => x === true || x === 't';
  const privOk =
    B(pv.sr_exec) && !B(pv.anon_exec) && !B(pv.auth_exec) && B(pv.auth_profiles) && Number(pv.default_acls) === 3;
  add(
    'privileges',
    privOk,
    `exec_sql exec: service_role=${B(pv.sr_exec)} anon=${B(pv.anon_exec)} authenticated=${B(pv.auth_exec)}; authenticated SELECT profiles=${B(pv.auth_profiles)}; public default-ACL rows=${pv.default_acls}`,
  );

  // buckets
  const missingBuckets = EXPECTED_BUCKETS.filter((b) => !snap.buckets.has(b));
  add(
    'buckets',
    missingBuckets.length === 0,
    missingBuckets.length ? `missing: ${missingBuckets.join(',')}` : `all ${EXPECTED_BUCKETS.length} present`,
  );

  // admin: role=admin profile bound to a confirmed auth user
  const {rows: adminRows} = await runSql(io, {
    key,
    workdir,
    sql: `select count(*)::int as n from public.profiles p join auth.users u on u.id=p.id where p.role='admin' and u.email_confirmed_at is not null;`,
  });
  add('admin', adminRows[0] && adminRows[0].n >= 1, `confirmed admin profiles: ${adminRows[0] ? adminRows[0].n : 0}`);

  // cron/vault classification (no false-green)
  const {rows: vaultRows} = await runSql(io, {
    key,
    workdir,
    sql: `select name from vault.secrets where name like 'TASKS_%';`,
  });
  const {rows: cronRows} = await runSql(io, {
    key,
    workdir,
    sql: `select jobname, active from cron.job where jobname in ('tasks-cron-daily','tasks-summary-weekly');`,
  });
  const cv = classifyCronVault({vaultRows, cronRows});
  add('cron_vault', cv.ready, cv.integrations.map((i) => `${i.integration}:${i.state}`).join(' | '));

  return finalize(entry, checks, {
    counts,
    countingDefinition: countingDefinition(),
    snapshot: {
      allRelations: [...snap.allRelations],
      applicationRelations: parts.application,
      fleetMetadataRelations: parts.fleetMetadata,
      functionSignatures: [...snap.functionSignatures],
      baseTables: [...snap.baseTables],
      buckets: [...snap.buckets],
      extensions: [...snap.extensions],
    },
    cronVault: cv,
  });
}

function countingDefinition() {
  return {
    base_tables: "information_schema.tables where table_schema='public' and table_type='BASE TABLE'",
    all_relations: "information_schema.tables where table_schema='public' (includes views)",
    function_names: 'distinct pg_proc.proname in schema public',
    function_signatures: 'proname||( identity args ) in schema public — overload-sensitive',
  };
}

function finalize(entry, checks, extra) {
  const ready = checks.every((c) => c.ok);
  return {
    project: {key: entry.key, name: entry.name, ref: entry.ref},
    status: ready ? 'READY' : 'NOT READY',
    ready,
    checks,
    ...(extra || {}),
  };
}

module.exports = {attest, EXPECTED_PATH, EXPECTED_BUCKETS, loadExpected, countingDefinition};
