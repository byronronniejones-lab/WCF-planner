import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {describe, it, expect} from 'vitest';

// ============================================================================
// Pig session metrics RPC — mig 049 contract lock
// ============================================================================
// pig_session_metrics returns aggregate weigh-in metrics (weighed count, avg
// weight, group ADG, age range, feed/pig) for a given pig session WITHOUT
// exposing the underlying private stores (app_store, pig_dailys) to the
// anon client. SECURITY DEFINER lets the function read those server-side;
// anon EXECUTE grants the public form access to aggregates only.
//
// Locks (this static test):
//   1. pig_slug helper exists with the documented regex shape.
//   2. pig_session_metrics function shape: SECURITY DEFINER, search_path,
//      anon scope guard against status='draft', GRANT EXECUTE to anon and
//      authenticated, and a stable jsonb return.
//   3. Aggregate fields use the documented names (weighed_count and
//      feed_pig_count are distinct concepts per Codex's correction).
//   4. Group ADG uses the rank-matched algorithm (sort by weight ASC,
//      ROW_NUMBER, INNER JOIN on rank, AVG of paired gain) — never a
//      simple avg-minus-avg shortcut.
//   5. Age range constants match src/lib/pig.js (BOAR_EXPOSURE_DAYS=45,
//      GESTATION_DAYS=116, +14d post-window buffer).
//   6. No new direct GRANTS on app_store, pig_dailys, ppp-breeders-v1,
//      ppp-farrowing-v1, or ppp-breeding-v1.
// ============================================================================

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..', '..');

const migSrc = fs.readFileSync(path.join(ROOT, 'supabase-migrations/049_pig_session_metrics_rpc.sql'), 'utf8');

describe('Mig 049 — pig_slug helper', () => {
  const fn = migSrc.match(/CREATE OR REPLACE FUNCTION public\.pig_slug\(s text\)[\s\S]*?\$\$;/);
  it('exists as a public IMMUTABLE function', () => {
    expect(fn, 'expected pig_slug function definition').not.toBeNull();
    expect(fn[0]).toMatch(/IMMUTABLE/);
  });

  const body = fn ? fn[0] : '';

  it('lowercases, collapses non-alphanumeric runs to "-", and trims edge dashes', () => {
    expect(body).toMatch(/lower\(coalesce\(s, ''\)\)/);
    expect(body).toMatch(/regexp_replace\([\s\S]*?'\[\^a-z0-9\]\+'[\s\S]*?'-'/);
    expect(body).toMatch(/trim\(both '-' FROM/);
  });

  it('grants EXECUTE to anon and authenticated', () => {
    expect(migSrc).toMatch(/GRANT EXECUTE ON FUNCTION public\.pig_slug\(text\) TO anon, authenticated/);
  });
});

describe('Mig 049 — pig_session_metrics RPC contract', () => {
  const fn = migSrc.match(
    /CREATE OR REPLACE FUNCTION public\.pig_session_metrics\(session_id_in text\)[\s\S]*?GRANT EXECUTE ON FUNCTION public\.pig_session_metrics\(text\) TO anon, authenticated;/,
  );
  it('exists with signature (session_id_in text)', () => {
    expect(fn, 'expected pig_session_metrics function definition').not.toBeNull();
  });

  const body = fn ? fn[0] : '';

  it('returns jsonb (single object, not a record set)', () => {
    expect(body).toMatch(/RETURNS jsonb/);
  });

  it('SECURITY DEFINER + SET search_path = public', () => {
    expect(body).toMatch(/SECURITY DEFINER/);
    expect(body).toMatch(/SET search_path = public/);
  });

  it('grants EXECUTE to anon and authenticated', () => {
    expect(migSrc).toMatch(/GRANT EXECUTE ON FUNCTION public\.pig_session_metrics\(text\) TO anon, authenticated/);
  });

  it('species guard rejects non-pig sessions before computing aggregates', () => {
    expect(body).toMatch(/v_session\.species IS DISTINCT FROM 'pig'/);
  });

  it('anon scope guard restricts to status=draft only (R1: fail closed)', () => {
    // Codex's R1 lock: anon should ONLY get aggregates when status='draft'.
    // weigh_in_sessions check constraint allows ('draft','complete') and
    // anon should not see complete sessions.
    expect(body).toMatch(/v_scope = 'anon' AND v_session\.status <> 'draft'/);
  });

  it('echoes session_id back so callers can correlate responses', () => {
    expect(body).toMatch(/'session_id',\s*session_id_in/);
  });
});

describe('Mig 049 — aggregate field names match the documented contract', () => {
  // weighed_count vs feed_pig_count are distinct concepts per Codex's
  // correction; assert both exist as separate keys.
  it('returns weighed_count (count of weigh_ins entries with positive weight)', () => {
    expect(migSrc).toMatch(/'weighed_count',\s*v_weighed_count/);
  });

  it('returns feed_pig_count (ledger denominator for feed_per_pig_lbs)', () => {
    expect(migSrc).toMatch(/'feed_pig_count',\s*v_feed_pig_count/);
  });

  it('feed_per_pig_lbs uses feed_pig_count, not weighed_count', () => {
    // The division must reference the ledger count, not the session count.
    expect(migSrc).toMatch(/v_feed_per_pig\s*:=\s*v_feed_total\s*\/\s*v_feed_pig_count/);
  });

  it('returns avg_weight_lbs, group_adg_lbs_per_day, age_min/max_days, has_actual_farrowing', () => {
    expect(migSrc).toMatch(/'avg_weight_lbs',\s*v_avg_weight/);
    expect(migSrc).toMatch(/'group_adg_lbs_per_day',\s*v_group_adg/);
    expect(migSrc).toMatch(/'age_min_days',\s*v_age_min_days/);
    expect(migSrc).toMatch(/'age_max_days',\s*v_age_max_days/);
    expect(migSrc).toMatch(/'has_actual_farrowing',\s*v_has_actual/);
  });

  it('returns scope and available so callers can render unavailable banners', () => {
    expect(migSrc).toMatch(/'scope',\s*v_scope/);
    expect(migSrc).toMatch(/'available',\s*(true|false|v_)/);
  });
});

describe('Mig 049 — rank-matched group ADG (R2 correction)', () => {
  it('sorts both sessions by weight ASC and matches by ROW_NUMBER rank', () => {
    expect(migSrc).toMatch(/ROW_NUMBER\(\)\s+OVER\s+\(ORDER BY weight ASC/);
  });

  it('joins paired ranks with INNER JOIN on rk', () => {
    expect(migSrc).toMatch(/INNER JOIN prior ON cur\.rk = prior\.rk/);
  });

  it('averages paired gain divided by day diff (not avg_now - avg_prior shortcut)', () => {
    expect(migSrc).toMatch(/AVG\(gain\)\s*\/\s*v_days_diff/);
    // Defensive: the function MUST NOT compute group_adg as a simple
    // (current.avg - prior.avg) shortcut.
    expect(migSrc).not.toMatch(/v_group_adg\s*:=\s*\(\s*v_avg_weight\s*-\s*v_prior_avg\s*\)/);
  });

  it('skips ADG when day diff is non-positive', () => {
    expect(migSrc).toMatch(/v_days_diff > 0/);
  });
});

describe('Mig 049 — age range constants match src/lib/pig.js', () => {
  it('uses GESTATION_DAYS=116 for the farrowing window start', () => {
    expect(migSrc).toMatch(/v_farrowing_start\s*:=\s*v_exposure_start\s*\+\s*116/);
  });

  it('uses (45 - 1) + 116 = 160 for the farrowing window end', () => {
    expect(migSrc).toMatch(/v_farrowing_end\s*:=\s*v_exposure_start\s*\+\s*160/);
  });

  it('applies the +14 day post-window buffer for record matching', () => {
    expect(migSrc).toMatch(/v_farrowing_end\s*\+\s*14/);
  });

  it('falls back to theoretical window when no farrowing records exist', () => {
    expect(migSrc).toMatch(/v_has_actual\s*:=\s*false/);
  });

  it('clamps not-yet-born ages to NULL/NULL (R3: no separate not_yet_born flag)', () => {
    expect(migSrc).toMatch(/v_age_max_days\s*:=\s*NULL/);
    expect(migSrc).toMatch(/v_age_min_days\s*:=\s*NULL/);
    expect(migSrc).not.toMatch(/'not_yet_born'/);
  });
});

describe('Mig 049 — feed_pig_count ledger math', () => {
  it('starts from sub.giltCount + sub.boarCount', () => {
    expect(migSrc).toMatch(
      /v_started_count\s*:=\s*COALESCE\(\(v_sub->>'giltCount'\)::int,\s*0\)\s*\+\s*COALESCE\(\(v_sub->>'boarCount'\)::int,\s*0\)/,
    );
  });

  it('subtracts mortality, processing-trip attributions, and breeder transfers', () => {
    expect(migSrc).toMatch(
      /v_feed_pig_count\s*:=\s*v_started_count\s*-\s*v_mortality_count\s*-\s*v_trip_attribution\s*-\s*v_transfer_count/,
    );
  });

  it('clamps the result at 0 (defensive against over-subtraction)', () => {
    expect(migSrc).toMatch(/IF v_feed_pig_count < 0 THEN[\s\S]*?v_feed_pig_count\s*:=\s*0/);
  });
});

describe('Mig 049 — feed total reads pig_dailys server-side', () => {
  it('matches by case-insensitive label/id and pig_slug fallback (mirrors dailysForName)', () => {
    expect(migSrc).toMatch(/lower\(coalesce\(d\.batch_label/);
    expect(migSrc).toMatch(/lower\(coalesce\(d\.batch_id/);
    expect(migSrc).toMatch(/public\.pig_slug\(d\.batch_label\)/);
    expect(migSrc).toMatch(/public\.pig_slug\(d\.batch_id\)/);
  });

  it('caps feed total at session_date (no future dailys leakage)', () => {
    // pig_dailys.date is text; the comparison casts session_date to text via
    // to_char(..., 'YYYY-MM-DD') so the string ordering = chronological for
    // ISO dates without erroring on malformed legacy rows.
    expect(migSrc).toMatch(/d\.date\s*<=\s*to_char\(v_session_date,\s*'YYYY-MM-DD'\)/);
  });
});

describe('Mig 049 — no new direct grants on private stores', () => {
  // Per Codex: "this migration adds no new direct grants to app_store or
  // pig_dailys." Strip SQL line comments before regex-scanning so the
  // documentation-style "no new direct GRANTS on app_store" text in the
  // file's leading comment block does not false-match.
  const noComments = migSrc.replace(/--[^\n]*/g, '');

  it('does not GRANT any privilege on app_store', () => {
    expect(noComments).not.toMatch(/GRANT[\s\S]*?ON\s+(?:public\.)?app_store/i);
  });

  it('does not GRANT any privilege on pig_dailys', () => {
    expect(noComments).not.toMatch(/GRANT[\s\S]*?ON\s+(?:public\.)?pig_dailys/i);
  });

  it('only grants EXECUTE on the two new helper functions, nothing else', () => {
    const grants = (noComments.match(/GRANT[^;]*;/g) || []).map((s) => s.replace(/\s+/g, ' ').trim());
    expect(grants).toEqual([
      'GRANT EXECUTE ON FUNCTION public.pig_slug(text) TO anon, authenticated;',
      'GRANT EXECUTE ON FUNCTION public.pig_session_metrics(text) TO anon, authenticated;',
    ]);
  });
});
