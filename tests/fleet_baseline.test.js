import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {describe, it, expect} from 'vitest';
import {
  computeRepoExpected,
  partitionRelations,
  FLEET_METADATA_TABLES,
  HANDSEED_TABLES,
} from '../scripts/fleet/expected.cjs';
import {generateBaseline} from '../scripts/fleet/gen_baseline.cjs';
import {linkRefPath} from '../scripts/fleet/target.cjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const TEST_B = 'hiaisktuuropjnbfytwx';
const WD = '/wt';

// Fake io that scripts runSql responses by query content and satisfies the link
// verification, so gen_baseline can be exercised with no network.
function fakeIo({snap, ledgerRows}) {
  const calls = [];
  return {
    calls,
    readFileSafe: (p) => (p === linkRefPath(WD) ? TEST_B + '\n' : null),
    writeFile: () => {},
    removeFile: () => {},
    log() {},
    warn() {},
    async run(file, args) {
      const sqlArg = args[args.length - 1];
      if (args.includes('link')) return {code: 0, stdout: '', stderr: ''};
      calls.push(sqlArg);
      if (/wcf_fleet_migrations where kind/.test(sqlArg))
        return {code: 0, stdout: JSON.stringify(ledgerRows), stderr: ''};
      if (/jsonb_build_object/.test(sqlArg)) return {code: 0, stdout: JSON.stringify([{snap}]), stderr: ''};
      return {code: 0, stdout: '[]', stderr: ''};
    },
  };
}

function snapshotFrom({tables, buckets, extensions, signatures = []}) {
  return {
    base_tables: [...tables].sort(),
    all_relations: [...tables].sort(),
    function_names: [],
    function_signatures: signatures,
    buckets: [...buckets].sort(),
    extensions: [...extensions].sort(),
  };
}

describe('computeRepoExpected (repo-derived, non-circular)', () => {
  const repo = computeRepoExpected();
  it('includes the 9 hand-seed tables and excludes fleet-metadata tables', () => {
    for (const t of HANDSEED_TABLES) expect(repo.base_tables).toContain(t);
    for (const t of FLEET_METADATA_TABLES) expect(repo.base_tables).not.toContain(t);
  });
  it('derives the required extensions from migrations', () => {
    for (const e of ['pgcrypto', 'pg_cron', 'pg_net', 'postgis']) expect(repo.extensions).toContain(e);
  });
  it('excludes tables a later migration drops (net create-minus-drop)', () => {
    expect(repo.base_tables).not.toContain('pasture_planned_moves'); // created@129, dropped@148
  });
  it('includes a table recreated within one migration (DROP then CREATE)', () => {
    expect(repo.base_tables).toContain('password_reset_throttle'); // mig 183 drops-then-creates
  });
});

describe('partitionRelations', () => {
  it('splits application relations from fleet metadata', () => {
    const {application, fleetMetadata} = partitionRelations([
      'profiles',
      'wcf_fleet_marker',
      'wcf_fleet_migrations',
      'cattle',
    ]);
    expect(application).toEqual(['cattle', 'profiles']);
    expect(fleetMetadata).toEqual(['wcf_fleet_marker', 'wcf_fleet_migrations']);
  });
});

describe('attest is read-only w.r.t. the baseline', () => {
  it('attest.cjs never writes expected-fleet.json', () => {
    const src = fs.readFileSync(path.join(ROOT, 'scripts/fleet/attest.cjs'), 'utf8');
    // attest READS the baseline (loadExpected) but must never WRITE it — only
    // gen_baseline.cjs (an explicit reviewed step) may write it.
    expect(src).not.toMatch(/writeFileSync|\.writeFile\(/);
    expect(fs.readFileSync(path.join(ROOT, 'scripts/fleet/attest.cjs'), 'utf8')).toContain('loadExpected');
  });
});

describe('attest verifies privileges, not just object presence', () => {
  const src = fs.readFileSync(path.join(ROOT, 'scripts/fleet/attest.cjs'), 'utf8');
  it('adds a privileges check (object presence alone cannot catch a wiped pg_default_acl)', () => {
    expect(src).toContain("add(\n    'privileges',");
  });
  it('asserts service_role CAN execute exec_sql and anon/authenticated CANNOT', () => {
    expect(src).toContain("has_function_privilege('service_role','public.exec_sql(text)','execute')");
    expect(src).toContain("has_function_privilege('anon','public.exec_sql(text)','execute')");
    expect(src).toContain("has_function_privilege('authenticated','public.exec_sql(text)','execute')");
    // service_role must be granted, anon/authenticated must be denied
    expect(src).toMatch(/B\(pv\.sr_exec\) && !B\(pv\.anon_exec\) && !B\(pv\.auth_exec\)/);
  });
  it('asserts the public default-ACL rows (default privileges) are present', () => {
    expect(src).toContain('Number(pv.default_acls) === 3');
  });
});

describe('gen_baseline refuses to bless drift', () => {
  const repo = computeRepoExpected();
  const cleanLedger = [{status: 'executed', n: 174}];

  it('accepts a fresh-execute source that matches repo (confirm=false does not write)', async () => {
    const snap = snapshotFrom({
      tables: [...repo.base_tables, ...FLEET_METADATA_TABLES], // app tables + fleet metadata
      buckets: repo.buckets,
      extensions: repo.extensions,
      signatures: ['exec_sql()'],
    });
    const io = fakeIo({snap, ledgerRows: cleanLedger});
    const r = await generateBaseline(io, {sourceKey: 'test-b', workdir: WD, confirm: false});
    expect(r.written).toBe(false);
    expect(r.baseline.application.base_tables).toEqual(repo.base_tables);
    expect(r.baseline.fleet_metadata_tables).toEqual([...FLEET_METADATA_TABLES]);
  });

  it('REFUSES a source with an extra application table not in the repo (drift cannot be blessed)', async () => {
    const snap = snapshotFrom({
      tables: [...repo.base_tables, ...FLEET_METADATA_TABLES, '__rogue_table'],
      buckets: repo.buckets,
      extensions: repo.extensions,
    });
    const io = fakeIo({snap, ledgerRows: cleanLedger});
    await expect(generateBaseline(io, {sourceKey: 'test-b', workdir: WD, confirm: true})).rejects.toThrow(
      /diverge from repo-derived/i,
    );
  });

  it('REFUSES a source whose ledger has adopted/checksum-only rows (not a clean fresh-execute)', async () => {
    const snap = snapshotFrom({
      tables: [...repo.base_tables, ...FLEET_METADATA_TABLES],
      buckets: repo.buckets,
      extensions: repo.extensions,
    });
    const io = fakeIo({
      snap,
      ledgerRows: [
        {status: 'executed', n: 170},
        {status: 'adopted-checksum-only', n: 4},
      ],
    });
    await expect(generateBaseline(io, {sourceKey: 'test-b', workdir: WD, confirm: true})).rejects.toThrow(
      /clean fresh-execute/i,
    );
  });
});
