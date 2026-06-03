import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {describe, expect, it} from 'vitest';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..', '..');

const migrationPath = path.join(ROOT, 'supabase-migrations/084_daily_report_unique_indexes.sql');
const reportPath = path.join(ROOT, 'scripts/daily_duplicate_identity_report.sql');
const cleanupPath = path.join(ROOT, 'supabase-migrations/085_daily_duplicate_cleanup.sql');
const mig084 = fs.readFileSync(migrationPath, 'utf8');
const duplicateReport = fs.readFileSync(reportPath, 'utf8');
const mig085 = fs.readFileSync(cleanupPath, 'utf8');

const UNIQUE_TABLES = [
  ['poultry_dailys', 'batch_label'],
  ['pig_dailys', 'batch_label'],
  ['layer_dailys', 'batch_label'],
  ['cattle_dailys', 'herd'],
  ['sheep_dailys', 'flock'],
];

function indexBlock(table) {
  const re = new RegExp(`CREATE UNIQUE INDEX IF NOT EXISTS ${table}_active_daily_identity_uq[\\s\\S]*?;`);
  const match = mig084.match(re);
  return match && match[0];
}

function stripComments(src) {
  return src.replace(/--[^\n]*/g, '');
}

describe('mig 084 daily unique indexes', () => {
  for (const [table, field] of UNIQUE_TABLES) {
    it(`creates an active full-daily unique index for ${table}`, () => {
      const block = indexBlock(table);
      expect(block, `${table} index block missing`).toBeTruthy();
      expect(block).toContain(`ON public.${table} (date, ${field})`);
      expect(block).toContain('deleted_at IS NULL');
      expect(block).toContain("source IS DISTINCT FROM 'add_feed_webform'");
      expect(block).toContain(`NULLIF(BTRIM(${field}), '') IS NOT NULL`);
    });
  }

  it('does not create a hard unique index for egg_dailys', () => {
    expect(mig084).not.toMatch(/CREATE UNIQUE INDEX[\s\S]*?egg_dailys/);
    expect(mig084).toContain('egg_dailys intentionally stay client warning/pre-submit only');
  });

  it('runs a duplicate preflight and fails closed before creating indexes', () => {
    const guardIdx = mig084.indexOf('daily report unique indexes blocked');
    const firstIndexIdx = mig084.indexOf('CREATE UNIQUE INDEX IF NOT EXISTS');
    expect(guardIdx).toBeGreaterThan(-1);
    expect(firstIndexIdx).toBeGreaterThan(guardIdx);
    expect(mig084).toContain('jsonb_array_length(v_blockers) > 0');
    expect(mig084).toContain('RAISE EXCEPTION');
  });

  it('checks duplicates for every indexed table using the same identity fields', () => {
    for (const [table, field] of UNIQUE_TABLES) {
      expect(mig084).toContain(`'${table}'::text AS table_name`);
      expect(mig084).toContain(`'${field}'::text AS identity_field`);
      expect(mig084).toContain(`GROUP BY date, ${field}`);
      expect(mig084).toContain(`NULLIF(BTRIM(${field}), '') IS NOT NULL`);
    }
  });

  it('does not include destructive data cleanup inside the migration', () => {
    const code = stripComments(mig084);
    expect(code).not.toMatch(/\bDELETE\s+FROM\b/i);
    expect(code).not.toMatch(/\bUPDATE\s+public\./i);
    expect(code).not.toMatch(/\bDROP\s+/i);
  });
});

describe('daily duplicate identity report SQL', () => {
  it('is non-destructive review SQL', () => {
    const code = stripComments(duplicateReport);
    expect(code).not.toMatch(/\bINSERT\b/i);
    expect(code).not.toMatch(/\bUPDATE\b/i);
    expect(code).not.toMatch(/\bDELETE\b/i);
    expect(code).not.toMatch(/\bALTER\b/i);
    expect(code).not.toMatch(/\bDROP\b/i);
    expect(code).not.toMatch(/\bCREATE\b/i);
  });

  for (const [table, field] of UNIQUE_TABLES) {
    it(`reports duplicate active full-daily identities for ${table}`, () => {
      expect(duplicateReport).toContain(`'${table}'::text AS table_name`);
      expect(duplicateReport).toContain(`'${field}'::text AS identity_field`);
      expect(duplicateReport).toContain(`FROM public.${table}`);
      expect(duplicateReport).toContain('deleted_at IS NULL');
      expect(duplicateReport).toContain("source IS DISTINCT FROM 'add_feed_webform'");
      expect(duplicateReport).toContain(`NULLIF(BTRIM(${field}), '') IS NOT NULL`);
      expect(duplicateReport).toContain(`GROUP BY date, ${field}`);
      expect(duplicateReport).toContain('HAVING count(*) > 1');
    });
  }

  it('does not report egg_dailys because egg reports have no hard unique-index lane', () => {
    expect(duplicateReport).not.toContain('egg_dailys');
  });
});

describe('mig 085 daily duplicate cleanup (084 prerequisite)', () => {
  it('soft-deletes losers only — no hard delete / drop / truncate of daily roots', () => {
    const code = stripComments(mig085);
    expect(code).not.toMatch(/\bDELETE\s+FROM\b/i);
    expect(code).not.toMatch(/\bDROP\b/i);
    expect(code).not.toMatch(/\bTRUNCATE\b/i);
    // The only mutation is a soft-delete stamp.
    expect(code).toMatch(/SET\s+deleted_at\s*=\s*now\(\)\s*,\s*deleted_by\s*=\s*NULL/i);
  });

  it('keeps the survivor with the highest feed/grit/mortality score per table', () => {
    expect(mig085).toContain('COALESCE(t.feed_lbs,0) + COALESCE(t.grit_lbs,0) + COALESCE(t.mortality_count,0)'); // poultry/layer
    expect(mig085).toMatch(/COALESCE\(t\.feed_lbs,0\)::numeric AS score/); // pig (feed only)
    expect(mig085).toMatch(/COALESCE\(t\.mortality_count,0\)::numeric AS score/); // cattle
    expect(mig085).toContain(
      'COALESCE(t.bales_of_hay,0) + COALESCE(t.lbs_of_alfalfa,0) + COALESCE(t.mortality_count,0)',
    ); // sheep
  });

  it('dedupes by date+identity (ignores submitter) with deterministic tie-breaks', () => {
    expect(mig085).toMatch(/PARTITION BY d, idy ORDER BY score DESC NULLS LAST, fld DESC, sub DESC NULLS LAST, id ASC/);
    expect(mig085).toMatch(/r\.rn > 1/);
    expect(stripComments(mig085)).not.toContain('team_member'); // submitter intentionally not part of the key
  });

  it('updates exactly the five indexed daily tables', () => {
    for (const [table] of UNIQUE_TABLES) {
      expect(mig085).toContain(`UPDATE public.${table} u SET deleted_at = now()`);
    }
  });

  it('asserts zero active duplicate identities remain (self-verifying guard)', () => {
    expect(mig085).toMatch(/RAISE EXCEPTION '085 cleanup left % duplicate active daily identities/);
  });

  it('contains no transaction-control statements (applied atomically via psql -1)', () => {
    expect(mig085).not.toMatch(/^\s*BEGIN\s*;/im);
    expect(mig085).not.toMatch(/^\s*COMMIT\s*;/im);
  });
});
