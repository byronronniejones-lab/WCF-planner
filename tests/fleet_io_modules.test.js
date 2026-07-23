import {describe, it, expect} from 'vitest';
import {ensureLinked, linkRefPath} from '../scripts/fleet/target.cjs';
import {parseRows, runSql, runSqlFile, scalar} from '../scripts/fleet/sql.cjs';
import {fetchProjectKeys, makeCreds} from '../scripts/fleet/keys.cjs';

// ============================================================================
// target/sql/keys — DB-free unit tests against an injected fake io.
// No process is spawned, no project is touched.
// ============================================================================

const WD = '/wt';
const TEST_A = 'dkigsoyejzjwldqtqkkn';
const TEST_B = 'hiaisktuuropjnbfytwx';
const PROD = 'pzfujbjtayhkdlxiblwe';

// Fake io: scripted `run` via a handler; in-memory files for readFileSafe.
function fakeIo({onRun, files = {}} = {}) {
  const calls = [];
  return {
    calls,
    files,
    async run(file, args, opts) {
      calls.push({file, args, opts});
      return onRun ? onRun({file, args, opts, files}) : {code: 0, stdout: '', stderr: ''};
    },
    readFileSafe(p) {
      return Object.prototype.hasOwnProperty.call(files, p) ? files[p] : null;
    },
    log() {},
    warn() {},
  };
}

describe('ensureLinked', () => {
  it('refuses a non-bootstrap target before any run() call', async () => {
    const io = fakeIo();
    await expect(ensureLinked(io, {key: 'prod', workdir: WD})).rejects.toThrow(/PROD|PRODUCTION/i);
    await expect(ensureLinked(io, {key: 'test-main', workdir: WD})).rejects.toThrow(/not an authorized/i);
    expect(io.calls.length).toBe(0);
  });

  it('skips the network re-link when already linked to the intended ref', async () => {
    const io = fakeIo({files: {[linkRefPath(WD)]: TEST_A + '\n'}});
    const entry = await ensureLinked(io, {key: 'test-a', workdir: WD});
    expect(entry.ref).toBe(TEST_A);
    expect(io.calls.length).toBe(0); // no `supabase link` needed
  });

  it('links then verifies when not yet linked', async () => {
    const files = {};
    const io = fakeIo({
      files,
      onRun: ({args}) => {
        if (args[0] === 'link') {
          const ref = args[args.indexOf('--project-ref') + 1];
          files[linkRefPath(WD)] = ref + '\n';
          return {code: 0, stdout: 'Finished supabase link.', stderr: ''};
        }
        return {code: 0, stdout: '', stderr: ''};
      },
    });
    const entry = await ensureLinked(io, {key: 'test-a', workdir: WD});
    expect(entry.ref).toBe(TEST_A);
    expect(io.calls[0].args).toContain('--project-ref');
    expect(io.calls[0].args).toContain(TEST_A);
  });

  it('fails closed when supabase link errors', async () => {
    const io = fakeIo({onRun: () => ({code: 1, stdout: '', stderr: 'boom'})});
    await expect(ensureLinked(io, {key: 'test-a', workdir: WD})).rejects.toThrow(/link failed/i);
  });

  it('fails closed when the post-link ref does not match (even if link "succeeded")', async () => {
    // link reports success but the ref file shows a DIFFERENT project.
    const files = {};
    const io = fakeIo({
      files,
      onRun: () => {
        files[linkRefPath(WD)] = TEST_B + '\n'; // wrong project!
        return {code: 0, stdout: 'Finished supabase link.', stderr: ''};
      },
    });
    await expect(ensureLinked(io, {key: 'test-a', workdir: WD})).rejects.toThrow(/does not match/i);
  });

  it('fails closed when a stale link already points at PROD', async () => {
    const io = fakeIo({
      files: {[linkRefPath(WD)]: PROD + '\n'},
      onRun: () => {
        // even if it tried to re-link, keep it stuck on PROD to prove refusal
        return {code: 0, stdout: '', stderr: ''};
      },
    });
    // intended target is test-a, but the file says PROD and re-link doesn't fix it
    await expect(ensureLinked(io, {key: 'test-a', workdir: WD})).rejects.toThrow(/PROD|does not match/i);
  });
});

describe('parseRows', () => {
  it('parses a plain array (agent=no)', () => {
    expect(parseRows('[{"a":1}]')).toEqual([{a: 1}]);
  });
  it('parses the agent-mode {rows} envelope', () => {
    expect(parseRows('{"boundary":"x","rows":[{"a":2}],"warning":"..."}')).toEqual([{a: 2}]);
  });
  it('tolerates leading CLI noise before the JSON', () => {
    expect(parseRows('Initialising login role...\n[{"a":3}]')).toEqual([{a: 3}]);
  });
  it('returns [] on empty', () => {
    expect(parseRows('')).toEqual([]);
  });
});

describe('runSql / scalar', () => {
  const linked = {files: {[linkRefPath(WD)]: TEST_A + '\n'}};
  it('returns parsed rows for a verified target', async () => {
    const io = fakeIo({...linked, onRun: () => ({code: 0, stdout: '[{"n":85}]', stderr: ''})});
    const {rows} = await runSql(io, {key: 'test-a', workdir: WD, sql: 'select count(*) n'});
    expect(rows).toEqual([{n: 85}]);
  });
  it('scalar returns the first column of the first row', async () => {
    const io = fakeIo({...linked, onRun: () => ({code: 0, stdout: '[{"n":9}]', stderr: ''})});
    expect(await scalar(io, {key: 'test-a', workdir: WD, sql: 'select 9 n'})).toBe(9);
  });
  it('throws a redacted error on non-zero exit', async () => {
    const io = fakeIo({...linked, onRun: () => ({code: 1, stdout: '', stderr: 'db exploded'})});
    await expect(runSql(io, {key: 'test-a', workdir: WD, sql: 'x'})).rejects.toThrow(/db query failed/i);
  });
  it('refuses to run against PROD (guarded before any query)', async () => {
    const io = fakeIo({files: {[linkRefPath(WD)]: PROD + '\n'}});
    await expect(runSql(io, {key: 'prod', workdir: WD, sql: 'select 1'})).rejects.toThrow(/PROD|PRODUCTION/i);
  });
});

describe('runSqlFile', () => {
  it('passes -f <file> and returns rows', async () => {
    const io = fakeIo({files: {[linkRefPath(WD)]: TEST_A + '\n'}, onRun: () => ({code: 0, stdout: '[]', stderr: ''})});
    const {rows} = await runSqlFile(io, {key: 'test-a', workdir: WD, file: '/tmp/boot.sql'});
    expect(rows).toEqual([]);
    const q = io.calls.find((c) => c.args.includes('query'));
    expect(q.args).toContain('-f');
    expect(q.args).toContain('/tmp/boot.sql');
  });
});

describe('fetchProjectKeys', () => {
  const apiKeysJson = JSON.stringify([
    {name: 'anon', api_key: 'eyJhbGciOiJIUzI1NiJ9.anon.sig'},
    {name: 'service_role', api_key: 'eyJhbGciOiJIUzI1NiJ9.service.sig'},
    {name: 'default', api_key: 'sb_publishable_xxxxxxxxxxxxxxxx'},
    {name: 'default', api_key: 'sb_secret_yyyyyyyyyyyyyyyy'},
  ]);

  it('returns non-enumerable secrets (hidden from log/stringify) plus enumerable url/ref', async () => {
    const io = fakeIo({onRun: () => ({code: 0, stdout: apiKeysJson, stderr: ''})});
    const creds = await fetchProjectKeys(io, {ref: TEST_A});
    expect(creds.ref).toBe(TEST_A);
    expect(creds.url).toBe(`https://${TEST_A}.supabase.co`);
    expect(creds.anon).toContain('anon'); // accessible...
    expect(creds.serviceRole).toContain('service');
    // ...but not enumerable / not serialized raw
    expect(Object.keys(creds)).toEqual(['ref', 'url']);
    const dumped = JSON.stringify(creds);
    expect(dumped).not.toContain('.service.sig');
    expect(dumped).toContain('«redacted»');
  });

  it('refuses to fetch PROD keys', async () => {
    const io = fakeIo();
    await expect(fetchProjectKeys(io, {ref: PROD})).rejects.toThrow(/PROD/i);
    expect(io.calls.length).toBe(0);
  });

  it('throws when anon/service_role are absent', async () => {
    const io = fakeIo({onRun: () => ({code: 0, stdout: '[{"name":"default","api_key":"sb_secret_x"}]', stderr: ''})});
    await expect(fetchProjectKeys(io, {ref: TEST_A})).rejects.toThrow(/missing/i);
  });

  it('throws a redacted error on CLI failure', async () => {
    const io = fakeIo({onRun: () => ({code: 1, stdout: '', stderr: 'not authorized'})});
    await expect(fetchProjectKeys(io, {ref: TEST_A})).rejects.toThrow(/api-keys fetch failed/i);
  });
});

describe('makeCreds', () => {
  it('keeps anon/serviceRole non-enumerable', () => {
    const c = makeCreds({ref: 'r', url: 'u', anon: 'a', serviceRole: 's'});
    expect(Object.keys(c)).toEqual(['ref', 'url']);
    expect(c.serviceRole).toBe('s');
  });
});
