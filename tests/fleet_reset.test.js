import {describe, it, expect} from 'vitest';
import {destructiveReset, RESET_SQL} from '../scripts/fleet/reset.cjs';
import {linkRefPath} from '../scripts/fleet/target.cjs';

const TEST_A = 'dkigsoyejzjwldqtqkkn';
const PROD = 'pzfujbjtayhkdlxiblwe';
const WD = '/wt';

function fakeIo({linkedRef = TEST_A, verify} = {}) {
  const calls = [];
  return {
    calls,
    readFileSafe: (p) => (p === linkRefPath(WD) ? linkedRef + '\n' : null),
    writeFile: () => {},
    removeFile: () => {},
    log() {},
    warn() {},
    async run(file, args) {
      const sql = args[args.length - 1];
      if (args.includes('link')) return {code: 0, stdout: '', stderr: ''};
      calls.push(sql);
      if (/count\(\*\).*information_schema/.test(sql) && /wcf_backup/.test(sql))
        return {code: 0, stdout: JSON.stringify([verify]), stderr: ''};
      return {code: 0, stdout: '[]', stderr: ''};
    },
  };
}

describe('destructiveReset', () => {
  it('refuses PROD / reference / unknown before any mutation', async () => {
    const io = fakeIo({linkedRef: PROD});
    await expect(destructiveReset(io, {key: 'prod', workdir: WD})).rejects.toThrow(/PROD|PRODUCTION/i);
    await expect(destructiveReset(io, {key: 'test-main', workdir: WD})).rejects.toThrow(/not an authorized/i);
    expect(io.calls.length).toBe(0);
  });

  it('resets a verified TEST target and confirms it is empty', async () => {
    const io = fakeIo({verify: {tables: 0, users: 0, vault: 0, wcf_backup: false, default_acls: 3}});
    const r = await destructiveReset(io, {key: 'test-a', workdir: WD});
    expect(r.verified.tables).toBe(0);
    // The reset issues a mutation call then a verify call (the reset body is
    // routed through a temp file by runSql because it carries -- comments, so
    // its text is asserted against the RESET_SQL constant below).
    expect(io.calls.length).toBeGreaterThanOrEqual(2);
    expect(RESET_SQL).toMatch(/drop schema if exists public cascade/);
  });

  it('fails closed if the project is not empty after reset', async () => {
    const io = fakeIo({verify: {tables: 5, users: 0, vault: 0, wcf_backup: false, default_acls: 3}});
    await expect(destructiveReset(io, {key: 'test-a', workdir: WD})).rejects.toThrow(/Reset incomplete/i);
  });

  it('fails closed if the Supabase default privileges were not restored', async () => {
    // drop schema public cascade wipes pg_default_acl; if the reset does not
    // re-establish the 3 FOR ROLE postgres default-ACL rows, every rebuilt
    // object would be ungranted (exec_sql loses service_role; app tables 403).
    const io = fakeIo({verify: {tables: 0, users: 0, vault: 0, wcf_backup: false, default_acls: 0}});
    await expect(destructiveReset(io, {key: 'test-a', workdir: WD})).rejects.toThrow(/Reset incomplete/i);
  });

  it('the reset drops the wcf_backup role (so mig 190 takes its CREATE path)', () => {
    expect(RESET_SQL).toMatch(/drop role wcf_backup/);
    expect(RESET_SQL).toMatch(/cron\.unschedule/);
    expect(RESET_SQL).toMatch(/delete from auth\.users/);
  });

  it('restores Supabase per-object default privileges wiped by drop schema cascade', () => {
    // Without these, service_role loses EXECUTE on exec_sql and anon/authenticated
    // lose access to every migration-created table/RPC (the app 403s).
    expect(RESET_SQL).toMatch(
      /alter default privileges for role postgres in schema public grant all on tables to postgres, anon, authenticated, service_role/,
    );
    expect(RESET_SQL).toMatch(
      /alter default privileges for role postgres in schema public grant all on functions to postgres, anon, authenticated, service_role/,
    );
    expect(RESET_SQL).toMatch(
      /alter default privileges for role postgres in schema public grant all on sequences to postgres, anon, authenticated, service_role/,
    );
  });
});
