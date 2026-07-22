// Disaster-recovery COVERAGE INVENTORY (Build Queue item 1, discovery phase).
//
// Answers one question: "if we take a logical database dump today, what is
// covered, and what would a restore silently lose?"
//
// This script is READ-ONLY and decision-free. It encodes no bucket name, no
// region, no retention rule, and no provider choice, so it stays valid under
// every B2/R2 layout still under discussion. It exists so that backup coverage
// is measured against live state instead of against PROJECT.md's prose.
//
// Usage:
//   node scripts/dr_inventory.cjs --env=prod [--json=<out.json>]
//   node scripts/dr_inventory.cjs --env=test
//
// Reads PROD_DB_URL (.env.prod.local) or WCF_TEST_DATABASE (.env.test.local).
// Requires psql on PATH. Performs NO writes. NEVER prints the connection URL,
// a password, a token, or a Vault secret VALUE — Vault appears by NAME only,
// because the names are what a human must re-enter after a restore.
//
// Exit codes: 0 inventory produced; 1 a probe failed; 2 usage/env refusal.
const fs = require('fs');
const path = require('path');
const {execFileSync} = require('child_process');

function loadDotEnv(file) {
  if (!fs.existsSync(file)) return;
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (!m) continue;
    let v = m[2].trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    if (process.env[m[1]] === undefined) process.env[m[1]] = v;
  }
}

const argv = process.argv.slice(2);
const arg = (k, d = null) => {
  const hit = argv.find((a) => a.startsWith(`--${k}=`));
  return hit ? hit.slice(k.length + 3) : d;
};

const env = arg('env');
if (env !== 'prod' && env !== 'test') {
  console.error('refusing: --env=prod or --env=test is required (no default target)');
  process.exit(2);
}

// TEST has NO PostgreSQL DSN — WCF_TEST_DATABASE is a boolean safety flag, not
// a connection string. See the same note in dr_backup.cjs.
if (env === 'test') {
  console.error('refusing: --env=test is not supported. TEST has no PostgreSQL DSN.');
  console.error('  WCF_TEST_DATABASE is a safety flag (=1), not a connection string.');
  process.exit(2);
}

const root = path.resolve(__dirname, '..');
loadDotEnv(path.join(root, '.env.prod.local'));
const DB_URL = process.env.PROD_DB_URL;
if (!DB_URL) {
  console.error('refusing: PROD_DB_URL is not set');
  process.exit(2);
}

// One row per line, fields separated by a unit separator so free text is safe.
const SEP = '';
function q(sql) {
  try {
    const out = execFileSync('psql', [DB_URL, '-tAF', SEP, '-c', sql], {
      encoding: 'utf8',
      env: {...process.env, PGCONNECT_TIMEOUT: '30'},
      stdio: ['ignore', 'pipe', 'pipe'],
      maxBuffer: 32 * 1024 * 1024,
    });
    return out
      .split(/\r?\n/)
      .filter(Boolean)
      .map((l) => l.split(SEP));
  } catch (_e) {
    // stderr can echo the connection string on failure; never surface it raw.
    console.error('probe failed (query suppressed to avoid leaking the DSN)');
    process.exit(1);
  }
}

// psql renders boolean::text as 'true'/'false' (not 't'/'f'), so parse both.
const isTrue = (v) => v === 'true' || v === 't';

const report = {env, generated_note: 'read-only inventory; no timestamps recorded in-repo', covered: {}, gaps: {}};

// ── Covered by a logical dump of public/auth/storage ────────────────────────
const [[dbSize]] = q(`select pg_size_pretty(pg_database_size(current_database()))`);
report.covered.database_size = dbSize;

report.covered.schemas = q(`
  select n.nspname, count(c.oid) filter (where c.relkind in ('r','p'))::text
  from pg_namespace n left join pg_class c on c.relnamespace = n.oid
  where n.nspname not like 'pg_%' and n.nspname <> 'information_schema'
  group by 1 order by 1
`).map(([schema, tables]) => ({schema, tables: Number(tables)}));

const [[authUsers]] = q(`select count(*)::text from auth.users`);
report.covered.auth_users = Number(authUsers);

// ── Storage: rows are covered, BYTES are not ───────────────────────────────
report.gaps.storage_buckets = q(`
  select b.id, b.public::text, count(o.id)::text,
         coalesce(sum((o.metadata->>'size')::bigint), 0)::text
  from storage.buckets b left join storage.objects o on o.bucket_id = b.id
  group by b.id, b.public order by b.id
`).map(([id, isPublic, objects, bytes]) => ({
  bucket: id,
  public: isTrue(isPublic),
  objects: Number(objects),
  bytes: Number(bytes),
}));
report.gaps.storage_note =
  'storage.objects ROWS ride along in the dump; the actual file BYTES live outside Postgres and need an independent copy';

// ── Not captured by a public/auth/storage dump at all ──────────────────────
report.gaps.cron_jobs = q(`select jobname, schedule, active::text from cron.job order by jobname`).map(
  ([jobname, schedule, active]) => ({jobname, schedule, active: isTrue(active)}),
);
report.gaps.vault_secret_names = q(`select name from vault.secrets order by name`).map(([name]) => name);
report.gaps.vault_note =
  'Vault ciphertext is bound to the Supabase-managed project key: it does NOT decrypt in a different project. Every name above must be re-entered by hand after a restore, or the cron jobs above stay dead.';
report.gaps.extensions = q(`select extname from pg_extension order by extname`).map(([e]) => e);
report.gaps.extensions_note = 'must pre-exist in the recovery project before a restore is attempted';

// ── Human summary ─────────────────────────────────────────────────────────
const fmtBytes = (n) => {
  if (n >= 1024 ** 3) return (n / 1024 ** 3).toFixed(1) + ' GB';
  if (n >= 1024 ** 2) return (n / 1024 ** 2).toFixed(1) + ' MB';
  if (n >= 1024) return (n / 1024).toFixed(0) + ' KB';
  return n + ' B';
};

console.log(`\nDR coverage inventory — ${env.toUpperCase()}\n${'='.repeat(48)}`);
console.log(`\nCOVERED by a logical dump (public/auth/storage):`);
console.log(`  database size      ${report.covered.database_size}`);
console.log(`  auth users         ${report.covered.auth_users}`);
console.log(
  `  tables             ${report.covered.schemas.reduce((a, s) => a + s.tables, 0)} across ${report.covered.schemas.length} schemas`,
);

const totalObjects = report.gaps.storage_buckets.reduce((a, b) => a + b.objects, 0);
const totalBytes = report.gaps.storage_buckets.reduce((a, b) => a + b.bytes, 0);
console.log(`\nNEEDS AN INDEPENDENT COPY — Storage bytes (${totalObjects} objects, ${fmtBytes(totalBytes)}):`);
for (const b of report.gaps.storage_buckets) {
  const share = totalBytes ? Math.round((b.bytes / totalBytes) * 100) : 0;
  console.log(
    `  ${b.public ? 'public ' : 'private'}  ${b.bucket.padEnd(28)} ${String(b.objects).padStart(4)} obj  ${fmtBytes(b.bytes).padStart(9)}${share >= 10 ? `  (${share}% of all bytes)` : ''}`,
  );
}

console.log(`\nNOT IN THE DUMP — would be silently lost on restore:`);
console.log(
  `  cron schedules     ${report.gaps.cron_jobs.length} (${report.gaps.cron_jobs.map((j) => j.jobname).join(', ')})`,
);
console.log(
  `  vault secrets      ${report.gaps.vault_secret_names.length} names, values unrecoverable across projects`,
);
console.log(`  extensions         ${report.gaps.extensions.join(', ')}`);
console.log(`\n  ${report.gaps.vault_note}`);

const outFile = arg('json');
if (outFile) {
  fs.writeFileSync(outFile, JSON.stringify(report, null, 2));
  console.log(`\nwrote ${outFile}`);
}
console.log('');
