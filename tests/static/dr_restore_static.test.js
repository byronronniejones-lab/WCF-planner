import {describe, it, expect} from 'vitest';
import {readFileSync} from 'fs';
import {fileURLToPath} from 'url';
import {dirname, join} from 'path';

const here = dirname(fileURLToPath(import.meta.url));
const runner = readFileSync(join(here, '..', '..', 'scripts', 'dr_restore.cjs'), 'utf8');
const lib = readFileSync(join(here, '..', '..', 'scripts', 'lib', 'dr_restore_layout.cjs'), 'utf8');

function region(text, startMarker, endMarker) {
  const a = text.indexOf(startMarker);
  const b = endMarker ? text.indexOf(endMarker, a + 1) : text.length;
  return text.slice(a, b === -1 ? text.length : b);
}

describe('restore reads R2 only, never widens the B2 writer key', () => {
  it('never uses the B2 writer credential or bucket as a restore source', () => {
    // R2 is the read source; the write-focused B2 key must not be read or widened.
    expect(runner).not.toMatch(/DR_B2_KEY_ID|DR_B2_APPLICATION_KEY/);
    expect(runner).not.toMatch(/backblazeb2|primary-2026/i);
    expect(runner).not.toMatch(/awsEnvFor\('b2'\)|b2Env/);
  });
  it('restricts R2 operations to a read-only allowlist', () => {
    expect(runner).toMatch(/R2_READ_OPS = Object\.freeze\(\['get-object', 'head-object', 'list-objects-v2'\]\)/);
    expect(runner).toMatch(/assertR2ReadOnly/);
    // No mutating S3 verbs anywhere in the runner.
    for (const op of ['put-object', 'delete-object', 'copy-object', 'delete-bucket']) {
      expect(runner).not.toMatch(new RegExp(op));
    }
  });
});

describe('secret handling: paths not values, never printed, redaction mandatory', () => {
  it('reads credentials/identity from file PATHS and forbids in-repo paths', () => {
    expect(runner).toMatch(/function readSecretFile/);
    expect(runner).toMatch(/must live OUTSIDE the repository/);
  });
  it('registers secret values for redaction and routes error output through clean()', () => {
    expect(runner).toMatch(/registerSecret/);
    expect(runner).toMatch(/const clean = \(t\) => RL\.redactSecrets\(t, SECRET_VALUES\)/);
    // Every refusal prints through clean(); refuse() is the single error exit.
    expect(runner).toMatch(/function refuse\(msg[^)]*\)\s*\{[\s\S]*clean\(/);
  });
  it('never console.logs a raw dsn, credential, or age identity value', () => {
    // The age private identity is only ever referenced by file path.
    expect(runner).toMatch(/age-identity/);
    expect(runner).not.toMatch(/console\.log\([^)]*dsn/i);
    expect(runner).not.toMatch(/console\.log\([^)]*secretAccessKey/i);
  });
});

describe('generation is explicit — no latest', () => {
  it('pins the generation through requireExplicitGeneration', () => {
    expect(runner).toMatch(/RL\.requireExplicitGeneration\(arg\('generation'/);
    expect(lib).toMatch(/latest\|current\|newest/);
  });
});

describe('destination guard runs before any restore work', () => {
  it('enforces assertRecoveryDestination while loading the recovery config', () => {
    expect(runner).toMatch(/RL\.assertRecoveryDestination\(/);
  });
  it('loads + guards the destination before the DB restore fork', () => {
    expect(runner.indexOf('const cfg = loadRecoveryConfig()')).toBeLessThan(runner.lastIndexOf('runDbRestore('));
    expect(runner.indexOf('assertRecoveryDestination')).toBeLessThan(runner.lastIndexOf('runDbRestore('));
  });
});

describe('manifest + checksum verification precede restoration', () => {
  it('verifies the manifest and the encrypted-package checksum in preflight', () => {
    const pf = region(runner, 'async function runPreflight', 'function runDbRestore');
    expect(pf).toMatch(/RL\.verifyManifest\(/);
    expect(pf).toMatch(/RL\.assertSha256\(enc\.sha256, manifest\.database\.encrypted_sha256/);
  });
  it('runs preflight before the execute-mode DB restore', () => {
    expect(runner.indexOf('await runPreflight(')).toBeLessThan(runner.lastIndexOf('runDbRestore('));
  });
});

describe('fail-closed behavior', () => {
  it('stops at the DB-restore plaintext fork with a design-decision exit (3)', () => {
    const db = region(runner, 'function runDbRestore', '(async () =>');
    expect(db).toMatch(/DESIGN DECISION REQUIRED/);
    expect(db).toMatch(/process\.exit\(3\)/);
    // It must NOT actually invoke pg_restore in Phase 1 (prose in the message
    // that explains WHY streaming is unsafe is fine; a real invocation is not).
    expect(db).not.toMatch(/spawn\(['"]pg_restore|execFileSync\(['"]pg_restore|['"]pg_restore['"]/);
  });
  it('requires aws + age on PATH and refuses if absent (does not install them)', () => {
    expect(runner).toMatch(/hasBinary\('aws'\)/);
    expect(runner).toMatch(/hasBinary\('age'\)/);
    expect(runner).not.toMatch(/apt-get install|winget install|npm install .*aws/);
  });
  it('preflight is read-only: writes nothing and decrypts nothing', () => {
    // End before the runDbRestore doc-comment so its prose does not leak in.
    const pf = region(runner, 'async function runPreflight', 'DB RESTORE — Phase 1 DESIGN FORK');
    expect(pf).not.toMatch(/put-object|pg_restore|createWriteStream|age -d/);
    // The encrypted package is hashed as a stream, never decrypted here.
    expect(pf).toMatch(/r2HashObject/);
  });
});
