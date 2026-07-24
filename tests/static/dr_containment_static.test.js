import {describe, it, expect} from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

// Guards for the two artifacts that live OUTSIDE the runner: the GitHub
// workflow that holds the credentials, and the migration that creates the
// backup role. Both encode security decisions that would be silent if lost.
const WORKFLOW = path.join(process.cwd(), '.github', 'workflows', 'dr-backup.yml');
const MIGRATION = path.join(process.cwd(), 'supabase-migrations', '190_dr_backup_role.sql');
const wf = fs.readFileSync(WORKFLOW, 'utf8');
const mig = fs.readFileSync(MIGRATION, 'utf8');

/**
 * Executable SQL only, with `--` comment lines stripped.
 *
 * This matters: the migration deliberately DOCUMENTS the dangerous patterns it
 * avoids (GRANT SELECT ON ALL TABLES, ALTER ROLE ... LOGIN PASSWORD) so a
 * future reader understands why. Asserting against the raw file would flag that
 * documentation as if it were the defect it warns about.
 */
const migCode = mig
  .split(/\r?\n/)
  .filter((l) => !/^\s*--/.test(l))
  .join('\n');

/** Workflow lines that are actual YAML, not commentary. */
const wfCode = wf
  .split(/\r?\n/)
  .filter((l) => !/^\s*#/.test(l))
  .join('\n');

describe('workflow credential containment', () => {
  it('runs in the dr-backup GitHub Environment, not on repository secrets', () => {
    // Repository secrets are readable by EVERY workflow in the repo.
    // Environment secrets are readable only by a job naming the environment.
    expect(wfCode).toMatch(/^\s*environment:\s*dr-backup\s*$/m);
  });

  it('documents that the environment must be restricted to protected main', () => {
    expect(wf).toMatch(/protected `?main`? branch|only from the protected/i);
    expect(wf).toMatch(/ENVIRONMENT secrets/i);
  });

  it('fails closed on any ref other than refs/heads/main', () => {
    // Assert the live CONDITION, not merely the presence of the string: the
    // same literal also appears in the refusal message, so a presence check
    // would still pass against a dead `if false; then`.
    expect(wfCode).toMatch(/if\s*\[\s*"\$GITHUB_REF"\s*!=\s*"refs\/heads\/main"\s*\]/);
    expect(wfCode).toMatch(/exit 1/);
    expect(wfCode).not.toMatch(/if\s+false\s*;/);
  });

  it('reads the ref from $GITHUB_REF, never a ${{ }} expression in shell', () => {
    // GitHub expressions are substituted into the script TEXT before the shell
    // parses it, so interpolating one into executable shell is a
    // script-injection pattern. Env vars stay data.
    // Every ${{ }} in executable YAML must be an `env:` assignment
    // (`  NAME: ${{ ... }}`). Anywhere else means it was substituted into a
    // shell command, which is the injection pattern.
    const offenders = wf
      .split(/\r?\n/)
      .filter((l) => !/^\s*#/.test(l) && l.includes('${{'))
      .filter((l) => !/^\s*[A-Za-z_][A-Za-z0-9_]*:\s*\$\{\{/.test(l));
    expect(offenders, 'GitHub expressions must reach the shell via env, not interpolation').toEqual([]);
  });

  it('passes dispatch inputs as env, not interpolated into the script', () => {
    expect(wfCode).toMatch(/DR_MODE: \$\{\{ inputs\.mode \}\}/);
    expect(wfCode).toMatch(/DR_TIER: \$\{\{ inputs\.tier \}\}/);
    expect(wfCode).toMatch(/case "\$DR_MODE" in/);
  });

  it('names the Environment branch restriction as the authoritative control', () => {
    // An in-repo step cannot contain a maliciously modified workflow: anyone
    // able to edit this file could delete the step. Only GitHub's Environment
    // branch restriction defends against that, and the docs must say so.
    expect(wf).toMatch(/AUTHORITATIVE CONTROL/i);
    expect(wf).toMatch(/defence in depth, NOT the primary control|CANNOT contain a maliciously modified workflow/i);
  });

  it('workflow execute protects storage bodies, never --database-only', () => {
    // --database-only is a CLI-only escape hatch. If it leaked into the
    // workflow, every scheduled run would silently produce a partial backup.
    expect(wfCode).not.toMatch(/--database-only/);
    expect(wfCode).toMatch(/--execute/);
    const executeBranch = wfCode.slice(wfCode.indexOf('execute)'), wfCode.indexOf('*)'));
    expect(executeBranch).toMatch(/dr_backup\.cjs --env=prod --tier="\$DR_TIER" --execute\s*$/m);
    expect(executeBranch).not.toMatch(/--database-only/);
  });

  it('does not offer database-only as a dispatch choice', () => {
    expect(wfCode).not.toMatch(/- database-only/);
  });

  it('carries no stale claim that storage transfer is unimplemented', () => {
    expect(wf).not.toMatch(/not implemented|unimplemented|is not transferred yet/i);
  });

  it('performs the ref check BEFORE checkout and BEFORE any secret is used', () => {
    // Containment must precede use: the Supabase Storage key can delete
    // production Storage, so a non-main dispatch must never reach it.
    const lines = wf.split(/\r?\n/);
    const idx = (re) => lines.findIndex((l) => !/^\s*#/.test(l) && re.test(l));
    const refCheck = idx(/refs\/heads\/main/);
    const checkout = idx(/actions\/checkout/);
    const firstSecret = idx(/\$\{\{\s*secrets\./);
    expect(refCheck).toBeGreaterThan(-1);
    expect(refCheck).toBeLessThan(checkout);
    expect(refCheck).toBeLessThan(firstSecret);
  });

  it('stays workflow_dispatch-only with the schedule commented out', () => {
    expect(wfCode).toMatch(/workflow_dispatch:/);
    expect(wfCode).not.toMatch(/^\s{2}schedule:/m);
    expect(wf).toMatch(/#\s*schedule:/);
  });

  it('defaults the dispatch to dry-run, never execute', () => {
    expect(wfCode).toMatch(/default: 'dry-run'/);
  });

  it('keeps least-privilege token permissions', () => {
    expect(wfCode).toMatch(/permissions:\s*\n\s*contents: read/);
  });

  it('never references private key material; the recipient is a public VARIABLE', () => {
    expect(wf).not.toMatch(/AGE-SECRET-KEY/);
    expect(wfCode).toMatch(/vars\.DR_AGE_RECIPIENT/);
    expect(wfCode).not.toMatch(/secrets\.DR_AGE_RECIPIENT/);
  });

  it('declares the full credential contract by name', () => {
    for (const n of [
      'secrets.DR_PROD_DB_URL',
      'secrets.DR_B2_KEY_ID',
      'secrets.DR_B2_APPLICATION_KEY',
      'secrets.DR_R2_ACCESS_KEY_ID',
      'secrets.DR_R2_SECRET_ACCESS_KEY',
      'secrets.DR_STORAGE_S3_ACCESS_KEY_ID',
      'secrets.DR_STORAGE_S3_SECRET_ACCESS_KEY',
      'vars.DR_STORAGE_S3_ENDPOINT',
      'vars.DR_STORAGE_S3_REGION',
    ]) {
      expect(wfCode).toContain(n);
    }
  });

  it('serialises runs so two generations cannot race the manifest diff', () => {
    expect(wfCode).toMatch(/concurrency:/);
    expect(wfCode).toMatch(/cancel-in-progress: false/);
  });

  it('pins a pg client at least as new as the 17.6 server AND makes it the one on PATH', () => {
    // Installing postgresql-client-17 is necessary but NOT sufficient: the runner
    // ships client 16 and /usr/bin/pg_dump is the Debian pg_wrapper, which keeps
    // resolving to 16 after the 17 install, so pg_dump refuses the 17.x server
    // ("server version mismatch") — the failure mode that broke the first real
    // backup. The versioned 17 bin dir must be put first on PATH via GITHUB_PATH.
    expect(wfCode).toMatch(/postgresql-client-17/);
    expect(wfCode).toMatch(/\/usr\/lib\/postgresql\/17\/bin/);
    expect(wfCode).toMatch(/GITHUB_PATH/);
  });
});

describe('backup-role migration', () => {
  it('creates the role with BYPASSRLS, which pg_dump requires on RLS tables', () => {
    // NOBYPASSRLS CONTAINS the substring BYPASSRLS, so a bare match would pass
    // against the inverted attribute. Require the positive form and forbid the
    // negative one outright.
    expect(migCode).toMatch(/(?<!NO)BYPASSRLS/);
    expect(migCode).not.toMatch(/NOBYPASSRLS/);
    expect(migCode).toMatch(/CREATE ROLE wcf_backup/);
  });

  it('creates it NOLOGIN so the role is inert until deliberately activated', () => {
    expect(mig).toMatch(/NOLOGIN/);
  });

  it('grants pg_read_all_data rather than a one-time snapshot of grants', () => {
    // GRANT SELECT ON ALL TABLES would silently miss every future table.
    expect(migCode).toMatch(/GRANT pg_read_all_data TO wcf_backup/);
    expect(migCode).not.toMatch(/GRANT SELECT ON ALL TABLES/i);
  });

  it('withholds every superuser-adjacent attribute', () => {
    for (const attr of ['NOSUPERUSER', 'NOCREATEDB', 'NOCREATEROLE', 'NOREPLICATION']) {
      expect(mig).toContain(attr);
    }
  });

  it('CONTAINS NO CREDENTIAL of any kind', () => {
    // The whole point of NOLOGIN here: activation is out of band, so no
    // password can ever be committed with the migration.
    expect(migCode).not.toMatch(/LOGIN\s+PASSWORD\s+'/i);
    expect(migCode).not.toMatch(/ALTER ROLE wcf_backup LOGIN/);
    expect(migCode).not.toMatch(/postgres(ql)?:\/\/[^\s]*:[^\s]*@/);
    expect(mig).not.toMatch(/AGE-SECRET-KEY/);
    // No quoted literal that could be a password anywhere in executable SQL.
    expect(migCode).not.toMatch(/PASSWORD\s+'[^']+'/i);
  });

  it('is safe to re-apply and does not reset an activated credential', () => {
    expect(migCode).toMatch(/IF NOT EXISTS \(SELECT 1 FROM pg_roles WHERE rolname = 'wcf_backup'\)/);
    // The re-apply branch must converge attributes WITHOUT touching LOGIN/PASSWORD.
    const reapply = migCode.slice(migCode.indexOf('ELSE'), migCode.indexOf('END IF'));
    expect(reapply).toMatch(/ALTER ROLE wcf_backup/);
    expect(reapply).not.toMatch(/PASSWORD/i);
    expect(reapply).not.toMatch(/\bLOGIN\b/);
  });

  it('fails loudly if the resulting role is not what was intended', () => {
    expect(migCode).toMatch(/RAISE EXCEPTION .*BYPASSRLS/);
    expect(migCode).toMatch(/RAISE EXCEPTION .*pg_read_all_data/);
    expect(migCode).toMatch(/RAISE EXCEPTION .*beyond least-privilege/);
  });

  it('asserts every superuser-adjacent attribute INCLUDING rolreplication', () => {
    // Replication would let the role stream the whole cluster — far beyond a
    // logical backup. Omitting it from the assertion was a real gap.
    const assertion = migCode.slice(migCode.indexOf('rolbypassrls'), migCode.indexOf('unexpected role membership'));
    for (const attr of ['rolsuper', 'rolcreaterole', 'rolcreatedb', 'rolreplication']) {
      expect(assertion, `assertion must cover ${attr}`).toContain(attr);
    }
  });

  it('detects unexpected additional role memberships', () => {
    // An extra membership (pg_write_all_data, an app role) would silently widen
    // the backup credential past read-only.
    expect(migCode).toMatch(/r\.rolname <> 'pg_read_all_data'/);
    expect(migCode).toMatch(/RAISE EXCEPTION .*unexpected role membership/);
  });

  it('does not overclaim: no promise about direct grants or ownership', () => {
    // The migration can verify attributes and memberships. It cannot prove the
    // absence of object grants a later migration might add.
    expect(mig).toMatch(/do NOT and cannot prove|cannot prove the role holds no direct object grants/i);
  });

  it('documents that reapplication PRESERVES an operator-granted LOGIN', () => {
    expect(mig).toMatch(/PRESERVE an operator-granted LOGIN/i);
  });
});

describe('operator references use exact 1Password item titles', () => {
  const TITLES = [
    'WCF Planner — Backblaze B2 backup writer',
    'WCF Planner — Cloudflare R2 backup writer',
    'WCF Planner — Supabase Storage backup reader',
    'WCF Planner — Backup database unlock keys',
  ];

  it('workflow references the exact writer/reader item titles', () => {
    for (const t of TITLES.slice(0, 3)) expect(wf).toContain(t);
  });

  it('references the database unlock keys item by its exact title', () => {
    expect(wf).toContain(TITLES[3]);
    expect(mig).toContain(TITLES[3]);
  });

  it('never places a credential VALUE in either file', () => {
    for (const f of [wf, mig]) {
      expect(f).not.toMatch(/AGE-SECRET-KEY/);
      // A long opaque run suggests a pasted key or token. The age PUBLIC
      // recipient is deliberately documented and is public by design, so it is
      // the one allowed exception; everything else is flagged.
      const suspicious = (f.match(/[A-Za-z0-9/+]{50,}={0,2}/g) || []).filter((m) => !m.startsWith('age1'));
      expect(suspicious, 'unexpected long opaque string — possible credential').toEqual([]);
    }
  });

  it('documents operator verification that reveals no credential', () => {
    expect(mig).toMatch(/OPERATOR VERIFICATION/);
    expect(mig).toMatch(/FROM pg_roles WHERE rolname = 'wcf_backup'/);
  });

  it('documents activation, rotation and revocation as out-of-band steps', () => {
    expect(mig).toMatch(/ACTIVATION/);
    expect(mig).toMatch(/ROTATION/);
    expect(mig).toMatch(/REVOCATION/);
    expect(mig).toMatch(/never in a migration/i);
  });

  it('warns about the Supavisor pooler username format', () => {
    // <role>.<project-ref>, not <role>. Easy to miss; fails at connect time.
    expect(mig).toMatch(/wcf_backup\.pzfujbjtayhkdlxiblwe/);
  });

  it('warns against the --enable-row-security escape hatch', () => {
    expect(mig).toMatch(/--enable-row-security/);
    expect(mig).toMatch(/silent partial backup|partial backup that looks healthy/i);
  });
});
