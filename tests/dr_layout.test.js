import {describe, it, expect} from 'vitest';
import {createRequire} from 'node:module';

const require = createRequire(import.meta.url);
const dr = require('../scripts/lib/dr_layout.cjs');

const RUN = '20260721T124914Z';

describe('DR object key layout', () => {
  it('places hourly database generations under a dated hourly prefix', () => {
    expect(dr.databaseKeys(RUN, 'hourly')).toEqual({
      dump: 'db/hourly/2026/07/21/wcf-db-20260721T124914Z.dump.age',
      manifest: 'db/hourly/2026/07/21/wcf-db-20260721T124914Z.manifest.json',
    });
  });

  it('promotes daily to a month prefix and monthly to a year prefix', () => {
    expect(dr.databaseKeys(RUN, 'daily').dump).toBe('db/daily/2026/07/wcf-db-20260721T124914Z.dump.age');
    expect(dr.databaseKeys(RUN, 'monthly').dump).toBe('db/monthly/2026/wcf-db-20260721T124914Z.dump.age');
  });

  it('rejects a malformed run id rather than writing a garbage key', () => {
    expect(() => dr.databaseKeys('2026-07-21', 'hourly')).toThrow(/invalid runId/);
    expect(() => dr.databaseKeys('', 'hourly')).toThrow(/invalid runId/);
    expect(() => dr.databaseKeys(RUN, 'storage')).toThrow(/invalid database tier/);
  });

  it('mirrors the exact source path on B2 so restores are path-for-path', () => {
    expect(dr.storageObjectKey('b2', 'daily-photos', 'a/b c/photo.jpg', RUN)).toBe(
      'storage/objects/daily-photos/a/b c/photo.jpg',
    );
  });

  it('appends the run timestamp on R2, which has no object versioning', () => {
    const k = dr.storageObjectKey('r2', 'daily-photos', 'a/photo.jpg', RUN);
    expect(k).toBe(`storage/objects/daily-photos/a/photo.jpg@${RUN}`);
  });

  it('gives the same R2 path a DISTINCT key on a later run', () => {
    const later = '20260721T134914Z';
    const a = dr.storageObjectKey('r2', 'b', 'p.jpg', RUN);
    const b = dr.storageObjectKey('r2', 'b', 'p.jpg', later);
    expect(a).not.toBe(b);
  });

  it('rejects an unknown provider', () => {
    expect(() => dr.storageObjectKey('s3', 'b', 'p', RUN)).toThrow(/invalid provider/);
  });
});

describe('B2 per-object minimum immutability', () => {
  // The bucket default is only 2 days, so daily/monthly/storage generations
  // MUST carry an explicit longer retain-until or they become deletable early.
  it('maps each key prefix to its required minimum immutability', () => {
    expect(dr.minImmutableDaysForKey('db/hourly/2026/07/21/x.dump.age')).toBe(2);
    expect(dr.minImmutableDaysForKey('db/daily/2026/07/x.dump.age')).toBe(35);
    expect(dr.minImmutableDaysForKey('db/monthly/2026/x.dump.age')).toBe(365);
    expect(dr.minImmutableDaysForKey('storage/objects/daily-photos/p.jpg')).toBe(35);
    expect(dr.minImmutableDaysForKey('storage/manifests/2026/07/21/s.json')).toBe(35);
  });

  it('never silently defaults an unrecognised key to a short window', () => {
    expect(() => dr.minImmutableDaysForKey('random/key')).toThrow(/cannot determine retention tier/);
  });

  it('computes retain-until as an ISO-8601 UTC instant', () => {
    const now = new Date('2026-07-21T12:00:00Z');
    expect(dr.retainUntilForKey('db/hourly/2026/07/21/x.dump.age', now)).toBe('2026-07-23T12:00:00Z');
    expect(dr.retainUntilForKey('db/daily/2026/07/x.dump.age', now)).toBe('2026-08-25T12:00:00Z');
    expect(dr.retainUntilForKey('db/monthly/2026/x.dump.age', now)).toBe('2027-07-21T12:00:00Z');
  });

  it('every window is at least the 2-day bucket default', () => {
    for (const days of Object.values(dr.MIN_IMMUTABLE_DAYS)) expect(days).toBeGreaterThanOrEqual(2);
  });
});

describe('incremental storage diff', () => {
  const objs = (...rows) => rows.map(([bucket, path, size, etag]) => ({bucket, path, size, etag}));

  it('treats a first run with no previous manifest as a full baseline', () => {
    const cur = objs(['b', 'p1', 10, 'e1'], ['b', 'p2', 20, 'e2']);
    const d = dr.diffStorageObjects(cur, undefined);
    expect(d.changed).toHaveLength(2);
    expect(d.unchanged).toHaveLength(0);
    expect(d.removed).toHaveLength(0);
  });

  it('transfers nothing when nothing changed', () => {
    const cur = objs(['b', 'p1', 10, 'e1'], ['b', 'p2', 20, 'e2']);
    const d = dr.diffStorageObjects(cur, cur);
    expect(d.changed).toHaveLength(0);
    expect(d.unchanged).toHaveLength(2);
  });

  it('detects an overwrite that changes eTag but keeps the same size', () => {
    const prev = objs(['b', 'p1', 10, 'OLD']);
    const cur = objs(['b', 'p1', 10, 'NEW']);
    const d = dr.diffStorageObjects(cur, prev);
    expect(d.changed).toHaveLength(1);
    expect(d.changed[0].etag).toBe('NEW');
  });

  it('detects an overwrite that changes size but keeps the same eTag', () => {
    const d = dr.diffStorageObjects(objs(['b', 'p1', 99, 'e1']), objs(['b', 'p1', 10, 'e1']));
    expect(d.changed).toHaveLength(1);
  });

  it('reports source deletions so they can be retained in backup', () => {
    const d = dr.diffStorageObjects(objs(['b', 'p1', 10, 'e1']), objs(['b', 'p1', 10, 'e1'], ['b', 'gone', 5, 'e9']));
    expect(d.removed).toHaveLength(1);
    expect(d.removed[0].path).toBe('gone');
    expect(d.changed).toHaveLength(0);
  });

  it('does not confuse identical paths in different buckets', () => {
    const prev = objs(['b1', 'same', 10, 'e1']);
    const cur = objs(['b1', 'same', 10, 'e1'], ['b2', 'same', 10, 'e1']);
    const d = dr.diffStorageObjects(cur, prev);
    expect(d.changed).toHaveLength(1);
    expect(d.changed[0].bucket).toBe('b2');
  });
});

describe('secret redaction', () => {
  it('removes a secret value from child-process output', () => {
    const secret = 'super-secret-application-key-value';
    const out = dr.redactSecrets(`aws: auth failed using ${secret} at endpoint`, [secret]);
    expect(out).not.toContain(secret);
    expect(out).toContain('[REDACTED]');
  });

  it('scrubs a credentialed connection URI even when the value was not supplied', () => {
    const out = dr.redactSecrets('could not connect to postgresql://user:hunter2@host:5432/postgres', []);
    expect(out).not.toContain('hunter2');
    expect(out).toContain('[REDACTED]@');
  });

  it('redacts a longer secret before a shorter substring can unmask it', () => {
    const long = 'ABCDEFGHIJKLMNOP';
    const short = 'ABCDEFGH';
    const out = dr.redactSecrets(`value=${long}`, [short, long]);
    expect(out).toBe('value=[REDACTED]');
  });

  it('ignores short/blank entries that would redact ordinary text', () => {
    expect(dr.redactSecrets('the quick brown fox', ['the', '', null])).toBe('the quick brown fox');
  });
});

describe('execute-mode configuration gate', () => {
  const full = Object.fromEntries(dr.REQUIRED_EXECUTE_CONFIG.map((k) => [k, 'x'.repeat(12)]));

  it('reports nothing missing when every provider value is present', () => {
    expect(dr.missingExecuteConfig(full)).toEqual([]);
  });

  it('refuses when any single value is absent', () => {
    for (const name of dr.REQUIRED_EXECUTE_CONFIG) {
      const partial = {...full};
      delete partial[name];
      expect(dr.missingExecuteConfig(partial)).toContain(name);
    }
  });

  it('treats blank and whitespace-only values as missing', () => {
    expect(dr.missingExecuteConfig({...full, DR_B2_KEY_ID: '   '})).toContain('DR_B2_KEY_ID');
  });

  it('reports every missing name from an empty environment', () => {
    expect(dr.missingExecuteConfig({})).toEqual([...dr.REQUIRED_EXECUTE_CONFIG]);
  });

  it('requires no delete or governance-bypass credential', () => {
    const joined = dr.REQUIRED_EXECUTE_CONFIG.join(' ').toLowerCase();
    expect(joined).not.toMatch(/delete|bypass|admin|root/);
  });
});

describe('Supabase Storage read-only enforcement', () => {
  // A generated Supabase Storage S3 key cannot be scoped: full S3 access across
  // every bucket, RLS bypassed, no read-only option. The same credential used to
  // copy files out could delete all of production Storage. Our code must
  // therefore never issue a write against Supabase.
  it('allows exactly the read operations a backup needs', () => {
    for (const op of ['get-object', 'head-object', 'list-objects-v2', 'head-bucket']) {
      expect(dr.assertSupabaseReadOnly(op)).toBe(op);
    }
  });

  it('refuses every destructive or mutating operation', () => {
    for (const op of dr.SUPABASE_FORBIDDEN_OPS) {
      expect(() => dr.assertSupabaseReadOnly(op)).toThrow(/read-only/);
    }
  });

  it('specifically refuses delete, put, copy and multipart writes', () => {
    for (const op of ['put-object', 'copy-object', 'delete-object', 'delete-objects', 'create-multipart-upload']) {
      expect(dr.SUPABASE_FORBIDDEN_OPS).toContain(op);
      expect(() => dr.assertSupabaseReadOnly(op)).toThrow();
    }
  });

  it('is an ALLOWLIST: an unrecognised operation is refused, not assumed safe', () => {
    // A denylist would silently permit any future S3 verb Supabase adds.
    expect(() => dr.assertSupabaseReadOnly('some-future-write-op')).toThrow(/read-only/);
    expect(() => dr.assertSupabaseReadOnly('')).toThrow(/read-only/);
    expect(() => dr.assertSupabaseReadOnly(undefined)).toThrow(/read-only/);
  });

  it('keeps the allowed and forbidden sets disjoint', () => {
    const overlap = dr.SUPABASE_READ_OPS.filter((op) => dr.SUPABASE_FORBIDDEN_OPS.includes(op));
    expect(overlap).toEqual([]);
  });

  it('names the refused operation so a failure is diagnosable', () => {
    expect(() => dr.assertSupabaseReadOnly('delete-object')).toThrow(/delete-object/);
  });
});

describe('streaming source read is download-only', () => {
  // `aws s3 cp A B` is an upload or a download purely by ARGUMENT ORDER. A
  // transposition would turn a backup read into a write against production
  // Storage, using a credential that Supabase cannot scope read-only.
  it('accepts the only shape a backup needs: s3:// source, stdout dest', () => {
    expect(dr.assertSupabaseDownloadOnly('s3://daily-photos/a/b.jpg', '-')).toBe(true);
  });

  it('refuses a transposed call that would UPLOAD to production Storage', () => {
    expect(() => dr.assertSupabaseDownloadOnly('/tmp/local.jpg', 's3://daily-photos/a/b.jpg')).toThrow(
      /must be an s3:\/\/ URI/,
    );
  });

  it('refuses writing the body to a local path (no disk staging)', () => {
    expect(() => dr.assertSupabaseDownloadOnly('s3://b/k', '/tmp/staged.bin')).toThrow(/must be stdout/);
  });

  it('refuses a non-s3 source scheme', () => {
    for (const bad of ['https://x/y', 'file:///etc/passwd', '', null, undefined]) {
      expect(() => dr.assertSupabaseDownloadOnly(bad, '-')).toThrow();
    }
  });

  it('names UPLOAD in the error so the danger is obvious at the failure site', () => {
    expect(() => dr.assertSupabaseDownloadOnly('s3://b/k', 's3://other/k')).toThrow(/UPLOAD/);
  });
});

describe('retry backoff schedule', () => {
  it('grows exponentially from the base delay', () => {
    expect(dr.backoffMs(1)).toBe(500);
    expect(dr.backoffMs(2)).toBe(1000);
    expect(dr.backoffMs(3)).toBe(2000);
  });

  it('caps so a retry storm cannot stall the run indefinitely', () => {
    expect(dr.backoffMs(20)).toBe(8000);
    expect(dr.backoffMs(100)).toBe(8000);
  });

  it('rejects a nonsense attempt number rather than returning NaN', () => {
    for (const bad of [0, -1, 1.5, 'x', null]) expect(() => dr.backoffMs(bad)).toThrow(/invalid attempt/);
  });

  it('bounds attempts and concurrency to declared constants', () => {
    expect(dr.RETRY_ATTEMPTS).toBe(3);
    expect(dr.TRANSFER_CONCURRENCY).toBe(4);
  });
});

describe('config groups: base destinations vs conditional storage source', () => {
  it('keeps the Supabase Storage read credential OUT of the base execute config', () => {
    // Base config is what every execute (including database-only) needs. The
    // storage READ credential is conditional, so it must not be in the base set
    // or a database-only run would wrongly require it.
    for (const name of [
      'DR_STORAGE_S3_ACCESS_KEY_ID',
      'DR_STORAGE_S3_SECRET_ACCESS_KEY',
      'DR_STORAGE_S3_ENDPOINT',
      'DR_STORAGE_S3_REGION',
    ]) {
      expect(dr.REQUIRED_EXECUTE_CONFIG).not.toContain(name);
      expect(dr.STORAGE_SOURCE_CONFIG).toContain(name);
    }
  });

  it('base config is the age recipient plus the two destination providers', () => {
    expect(dr.REQUIRED_EXECUTE_CONFIG).toContain('DR_AGE_RECIPIENT');
    expect(dr.REQUIRED_EXECUTE_CONFIG.some((n) => n.startsWith('DR_B2_'))).toBe(true);
    expect(dr.REQUIRED_EXECUTE_CONFIG.some((n) => n.startsWith('DR_R2_'))).toBe(true);
  });

  it('missingStorageSourceConfig reports exactly the missing source names', () => {
    expect(dr.missingStorageSourceConfig({})).toEqual([...dr.STORAGE_SOURCE_CONFIG]);
    const full = Object.fromEntries(dr.STORAGE_SOURCE_CONFIG.map((k) => [k, 'v']));
    expect(dr.missingStorageSourceConfig(full)).toEqual([]);
    expect(dr.missingStorageSourceConfig({...full, DR_STORAGE_S3_REGION: '  '})).toEqual(['DR_STORAGE_S3_REGION']);
  });
});

describe('decideExecution — pure execution authority', () => {
  const srcCfg = Object.fromEntries(dr.STORAGE_SOURCE_CONFIG.map((k) => [k, 'v']));

  it('full execute with changed storage and complete config proceeds', () => {
    const d = dr.decideExecution({mode: 'execute', changedCount: 5, databaseOnly: false, env: srcCfg});
    expect(d.phase).toBe('execute');
    expect(d.entersOrchestration).toBe(true);
    expect(d.transfersStorage).toBe(true);
    expect(d.coverage).toBe('database-and-storage');
  });

  it('full execute with missing source config refuses and names only missing vars', () => {
    const d = dr.decideExecution({mode: 'execute', changedCount: 5, databaseOnly: false, env: {}});
    expect(d.phase).toBe('refuse');
    expect(d.entersOrchestration).toBe(false);
    expect(d.missing).toEqual([...dr.STORAGE_SOURCE_CONFIG]);
    // ONLY storage-source names — no destination or db vars leak in.
    expect(d.missing.every((n) => n.startsWith('DR_STORAGE_S3_'))).toBe(true);
  });

  it('full execute with no changed storage proceeds even without source creds', () => {
    const d = dr.decideExecution({mode: 'execute', changedCount: 0, databaseOnly: false, env: {}});
    expect(d.phase).toBe('execute');
    expect(d.transfersStorage).toBe(false);
  });

  it('explicit database-only execute proceeds without source creds and reports database-only', () => {
    const d = dr.decideExecution({mode: 'execute', changedCount: 5, databaseOnly: true, env: {}});
    expect(d.phase).toBe('execute');
    expect(d.entersOrchestration).toBe(true);
    expect(d.transfersStorage).toBe(false);
    expect(d.coverage).toBe('database-only');
  });

  it('dry-run never uploads and never enters orchestration', () => {
    const d = dr.decideExecution({mode: 'dry-run', changedCount: 5, env: {}});
    expect(d.phase).toBe('dry-run');
    expect(d.uploads).toBe(false);
    expect(d.entersOrchestration).toBe(false);
  });

  it('preflight never enters backup/upload orchestration', () => {
    const d = dr.decideExecution({mode: 'preflight', changedCount: 5, env: {}});
    expect(d.phase).toBe('preflight');
    expect(d.entersOrchestration).toBe(false);
    expect(d.uploads).toBe(false);
  });
});
