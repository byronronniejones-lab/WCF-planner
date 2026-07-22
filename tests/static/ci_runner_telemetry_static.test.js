import {readFileSync} from 'node:fs';
import {describe, expect, it} from 'vitest';
import {buildSample, SAFE_COMM} from '../../scripts/ci_runner_telemetry.cjs';

const rawSrc = readFileSync('scripts/ci_runner_telemetry.cjs', 'utf8');
const ci = readFileSync('.github/workflows/ci.yml', 'utf8');

// Scan CODE, not comments — the file's SAFETY header names the forbidden
// surfaces on purpose, and that documentation must not trip the guard.
const src = rawSrc
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .split('\n')
  .map((line) => line.replace(/(^|[^:])\/\/.*$/, '$1'))
  .join('\n');

describe('CI runner telemetry — forbidden surfaces absent', () => {
  it('never reads environment variables', () => {
    expect(src).not.toContain('process.env');
    expect(src).not.toContain('/environ');
  });
  it('never reads process command lines or arguments', () => {
    expect(src).not.toContain('cmdline');
    expect(src).not.toMatch(/\bprocess\.argv\b/);
    // No ps at all — RSS comes from /proc comm + statm.
    expect(src).not.toMatch(/\bps\s+-/);
    // Uses the safe per-process sources (name + page counts), not the cmdline.
    expect(src).toContain("'/comm'");
    expect(src).toContain("'/statm'");
  });
  it('does not fabricate an event-loop-delay measurement', () => {
    expect(src.toLowerCase()).not.toContain('eventloop');
    expect(src).not.toContain('monitorEventLoopDelay');
  });
  it('is read-only — no DB, kill, or timeout mutation', () => {
    expect(src).not.toContain('exec_sql');
    expect(src).not.toContain('pg_terminate_backend');
    expect(src).not.toMatch(/statement_timeout/i);
  });
});

describe('CI runner telemetry — sample shape', () => {
  it('builds a sample with only safe infrastructure fields', () => {
    const s = buildSample(Date.now() - 5000, Date.now());
    expect(Object.keys(s).sort()).toEqual(
      [
        'cpus',
        'diskFreeGB',
        'diskTotalGB',
        'elapsedS',
        'load1',
        'load15',
        'load5',
        'memAvailMB',
        'memTotalMB',
        'rss',
        'ts',
      ].sort(),
    );
    expect(s.elapsedS).toBeGreaterThanOrEqual(4);
    expect(s.cpus).toBeGreaterThan(0);
    expect(typeof s.ts).toBe('string');
    // rss is either null (no /proc, e.g. Windows) or a name→{mb,n} map with no
    // free-text/argument surface.
    if (s.rss) {
      for (const [name, v] of Object.entries(s.rss)) {
        expect(name).toMatch(/^[a-z0-9_]{1,15}$/);
        expect(Object.keys(v).sort()).toEqual(['mb', 'n']);
      }
    }
  });
  it('only aggregates known Node/Vite/Chromium command names', () => {
    expect(SAFE_COMM.test('node')).toBe(true);
    expect(SAFE_COMM.test('chrome')).toBe(true);
    expect(SAFE_COMM.test('vite')).toBe(true);
    expect(SAFE_COMM.test('sshd')).toBe(false);
    expect(SAFE_COMM.test('postgres')).toBe(false);
  });
});

describe('CI wires telemetry into the full e2e matrix step with reliable teardown', () => {
  it('launches the sampler and traps its exit in the matrix shard step', () => {
    // The isolated TEST fleet collapsed the two e2e-shard-* jobs into ONE
    // e2e-full matrix job (shard 1 -> TEST A, shard 2 -> TEST B). The telemetry
    // wrapper therefore appears once in YAML source and runs once per matrix
    // leg — not twice as in the old two-job layout.
    const launches = ci.match(/node scripts\/ci_runner_telemetry\.cjs & TELEM_PID=\$!/g) || [];
    expect(launches.length).toBe(1);
    const traps = ci.match(/trap 'kill "\$TELEM_PID" 2>\/dev\/null \|\| true' EXIT/g) || [];
    expect(traps.length).toBe(1);
  });
});
