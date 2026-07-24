import {describe, it, expect} from 'vitest';
import {createRequire} from 'module';
const require = createRequire(import.meta.url);
const RL = require('../scripts/lib/dr_restore_layout.cjs');

// A valid recovery project shape: a 20-char ref NOT in the forbidden set, with a
// URL + DSN that reference it and a matching confirmation.
const REF = 'abcdefghij0123456789';
const good = () => ({
  projectRef: REF,
  projectUrl: `https://${REF}.supabase.co`,
  dsn: `postgresql://postgres:secretpw@db.${REF}.supabase.co:5432/postgres`,
  confirmation: `RESTORE INTO ${REF}`,
});

describe('recovery destination guard (deny by default)', () => {
  it('accepts a well-formed recovery destination', () => {
    expect(RL.assertRecoveryDestination(good())).toEqual({ok: true, projectRef: REF});
  });

  it('refuses every known PROD/TEST project reference', () => {
    for (const ref of Object.keys(RL.FORBIDDEN_PROJECT_REFS)) {
      const c = {
        projectRef: ref,
        projectUrl: `https://${ref}.supabase.co`,
        dsn: `postgresql://postgres:pw@db.${ref}.supabase.co:5432/postgres`,
        confirmation: `RESTORE INTO ${ref}`,
      };
      expect(() => RL.assertRecoveryDestination(c)).toThrow(
        /never a restore target|is (PROD|TEST|wcf-planner-test-main)/,
      );
    }
  });

  it('refuses when the DSN secretly references a forbidden project', () => {
    const c = good();
    // Ref looks safe but the DSN points at PROD.
    c.dsn = 'postgresql://postgres:pw@db.pzfujbjtayhkdlxiblwe.supabase.co:5432/postgres';
    expect(() => RL.assertRecoveryDestination(c)).toThrow(/DSN references PROD/);
  });

  it('refuses when the DSN does not reference the declared recovery project', () => {
    const c = good();
    c.dsn = 'postgresql://postgres:pw@db.zzzzzzzzzzzzzzzzzzzz.supabase.co:5432/postgres';
    expect(() => RL.assertRecoveryDestination(c)).toThrow(/does not reference the declared recovery project/);
  });

  it('refuses a non-Supabase DSN host', () => {
    const c = good();
    c.dsn = `postgresql://postgres:pw@db.${REF}.example.com:5432/postgres`;
    expect(() => RL.assertRecoveryDestination(c)).toThrow(/not a managed Supabase host/);
  });

  it('refuses a wrong/absent confirmation string', () => {
    expect(() => RL.assertRecoveryDestination({...good(), confirmation: 'yes'})).toThrow(
      /confirmation string must be exactly/,
    );
    expect(() => RL.assertRecoveryDestination({...good(), confirmation: ''})).toThrow(
      /missing required destination field "confirmation"/,
    );
  });

  it('refuses a malformed project reference', () => {
    expect(() => RL.assertRecoveryDestination({...good(), projectRef: 'too-short'})).toThrow(/not a valid 20-char/);
  });

  it('refuses any missing destination field', () => {
    for (const k of ['projectRef', 'projectUrl', 'dsn', 'confirmation']) {
      const c = good();
      delete c[k];
      expect(() => RL.assertRecoveryDestination(c)).toThrow(new RegExp(`missing required destination field "${k}"`));
    }
  });

  it('never puts the DSN (which carries a password) in a thrown message', () => {
    const c = good();
    c.confirmation = 'wrong';
    try {
      RL.assertRecoveryDestination(c);
    } catch (e) {
      expect(e.message).not.toContain('secretpw');
    }
  });
});

describe('explicit generation pinning (no latest)', () => {
  it('accepts an exact run id', () => {
    expect(RL.requireExplicitGeneration('20260724T180923Z')).toBe('20260724T180923Z');
  });
  it('refuses symbolic generations', () => {
    for (const g of ['latest', 'LATEST', 'current', 'newest']) {
      expect(() => RL.requireExplicitGeneration(g)).toThrow(/not allowed|no "latest"/);
    }
  });
  it('refuses empty / malformed', () => {
    expect(() => RL.requireExplicitGeneration('')).toThrow(/explicit generation/);
    expect(() => RL.requireExplicitGeneration('2026-07-24')).toThrow();
  });
});

describe('restore source keys match the backup layout', () => {
  it('computes db package/manifest, storage manifest, and @runId storage keys', () => {
    const k = RL.restoreSourceKeys('20260724T180923Z', 'hourly');
    expect(k.dbPackage).toBe('db/hourly/2026/07/24/wcf-db-20260724T180923Z.dump.age');
    expect(k.dbManifest).toBe('db/hourly/2026/07/24/wcf-db-20260724T180923Z.manifest.json');
    expect(k.storageManifest).toBe('storage/manifests/2026/07/24/storage-20260724T180923Z.json');
    expect(k.storageObjectKey('daily-photos', 'a/b.jpg')).toBe('storage/objects/daily-photos/a/b.jpg@20260724T180923Z');
  });
});

const goodManifest = () => ({
  run_id: '20260724T180923Z',
  tier: 'hourly',
  coverage: 'database-and-storage',
  database: {
    dump_bytes: 2359296,
    dump_sha256: 'a'.repeat(64),
    encrypted_sha256: 'b'.repeat(64),
    encryption: 'age-asymmetric',
  },
  storage: {
    total_objects: 2,
    total_bytes: 30,
    objects: [
      {bucket: 'daily-photos', path: 'a.jpg', size: 10},
      {bucket: 'task-photos', path: 'b.png', size: 20},
    ],
  },
  not_backed_up: {vault_secret_names: ['x'], cron_jobs: [], extensions: ['pg_net']},
});

describe('manifest verification (fail-closed, all errors collected)', () => {
  it('passes a complete database-and-storage manifest', () => {
    const r = RL.verifyManifest(goodManifest(), {runId: '20260724T180923Z', tier: 'hourly'});
    expect(r.ok).toBe(true);
    expect(r.objects).toHaveLength(2);
  });
  it('rejects a database-only coverage', () => {
    const m = goodManifest();
    m.coverage = 'database-only';
    const r = RL.verifyManifest(m, {runId: '20260724T180923Z', tier: 'hourly'});
    expect(r.ok).toBe(false);
    expect(r.errors.join(' ')).toMatch(/database-only generation cannot prove a full restore/);
  });
  it('rejects run_id/tier drift, bad checksums, wrong encryption, and count mismatch', () => {
    const m = goodManifest();
    m.run_id = 'X';
    m.tier = 'daily';
    m.database.dump_sha256 = 'nope';
    m.database.encryption = 'plaintext';
    m.storage.total_objects = 99;
    const r = RL.verifyManifest(m, {runId: '20260724T180923Z', tier: 'hourly'});
    expect(r.ok).toBe(false);
    expect(r.errors.length).toBeGreaterThanOrEqual(4);
  });
});

describe('checksum assertion', () => {
  it('passes on an exact match', () => {
    expect(RL.assertSha256('a'.repeat(64), 'a'.repeat(64), 'db')).toBe(true);
  });
  it('throws on mismatch and on a malformed expected value', () => {
    expect(() => RL.assertSha256('a'.repeat(64), 'b'.repeat(64), 'db')).toThrow(/checksum mismatch/);
    expect(() => RL.assertSha256('a'.repeat(64), 'nope', 'db')).toThrow(/no valid expected checksum/);
  });
});

describe('storage coverage verification', () => {
  const manifestObjs = goodManifest().storage.objects;
  it('passes when every object is present with the right size', () => {
    const r = RL.verifyStorageCoverage(manifestObjs, [
      {bucket: 'daily-photos', path: 'a.jpg', size: 10},
      {bucket: 'task-photos', path: 'b.png', size: 20},
    ]);
    expect(r.ok).toBe(true);
  });
  it('flags a missing object, a size mismatch, and a count mismatch', () => {
    const r = RL.verifyStorageCoverage(manifestObjs, [{bucket: 'daily-photos', path: 'a.jpg', size: 999}]);
    expect(r.ok).toBe(false);
    expect(r.errors.join(' ')).toMatch(/restored 1 storage objects, manifest lists 2/);
    expect(r.errors.join(' ')).toMatch(/size mismatch/);
    expect(r.errors.join(' ')).toMatch(/missing after restore: task-photos\/b\.png/);
  });
});
