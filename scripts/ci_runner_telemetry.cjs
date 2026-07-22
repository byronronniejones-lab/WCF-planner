'use strict';
// ============================================================================
// CI runner telemetry sampler (safe, bounded, background)
// ============================================================================
// Emits one JSON telemetry line at start and then every 60s so a shard log can
// be correlated with failures: CPU count, total/available memory, load average,
// disk free, and aggregate RSS by process command NAME for Node/Vite/Chromium.
//
// SAFETY (enforced by tests/static/ci_runner_telemetry_static.test.js):
//   • Never reads process.env, /proc/*/cmdline, or /proc/*/environ.
//   • Never uses `ps` — RSS is read from /proc/<pid>/comm (command NAME only)
//     and /proc/<pid>/statm (page counts). No argument/command-line surface.
//   • No event-loop-delay claim — this is a SEPARATE process and cannot measure
//     Playwright's Node event loop, so it does not pretend to.
//   • Read-only. Does not touch the database, the app, or any secret.
//   • Bounded: at most MAX_SAMPLES lines; a background failure never affects the
//     test command's exit code, and startup prints a line so its absence in the
//     log means telemetry was unavailable.

const fs = require('fs');
const os = require('os');

const INTERVAL_MS = 60_000;
const MAX_SAMPLES = 90; // backstop so the sampler can never outlive a job
const PAGE_BYTES = 4096;
// Command names we care about (kernel truncates comm to 15 chars).
const SAFE_COMM = /^(node|vite|chrome|chromium|esbuild|rollup|playwright|headless)/i;

function memInfo() {
  try {
    const t = fs.readFileSync('/proc/meminfo', 'utf8');
    const kb = (key) => {
      const m = t.match(new RegExp('^' + key + ':\\s+(\\d+) kB', 'm'));
      return m ? Number(m[1]) * 1024 : null;
    };
    const total = kb('MemTotal');
    const available = kb('MemAvailable');
    if (total != null) return {total, available};
  } catch {
    /* fall through to os.* */
  }
  return {total: os.totalmem(), available: os.freemem()};
}

function diskInfo() {
  try {
    const s = fs.statfsSync('/');
    return {totalGB: +((s.blocks * s.bsize) / 1e9).toFixed(1), freeGB: +((s.bavail * s.bsize) / 1e9).toFixed(1)};
  } catch {
    return {totalGB: null, freeGB: null};
  }
}

// Aggregate RSS by command NAME from /proc — never touches cmdline/args.
function rssByCommand() {
  let entries;
  try {
    entries = fs.readdirSync('/proc');
  } catch {
    return null; // not Linux / no /proc
  }
  const agg = {};
  for (const pid of entries) {
    if (!/^\d+$/.test(pid)) continue;
    let comm, statm;
    try {
      comm = fs.readFileSync('/proc/' + pid + '/comm', 'utf8').trim();
      statm = fs.readFileSync('/proc/' + pid + '/statm', 'utf8').trim();
    } catch {
      continue; // process exited or unreadable
    }
    if (!SAFE_COMM.test(comm)) continue;
    const rssPages = parseInt(statm.split(/\s+/)[1], 10) || 0;
    const key =
      comm
        .toLowerCase()
        .replace(/[^a-z0-9_]/g, '')
        .slice(0, 15) || 'unknown';
    if (!agg[key]) agg[key] = {mb: 0, n: 0};
    agg[key].mb += Math.round((rssPages * PAGE_BYTES) / 1048576);
    agg[key].n += 1;
  }
  return agg;
}

function buildSample(startMs, now) {
  const mem = memInfo();
  const disk = diskInfo();
  const load = os.loadavg();
  return {
    ts: new Date(now).toISOString(),
    elapsedS: Math.round((now - startMs) / 1000),
    cpus: os.cpus().length,
    memTotalMB: mem.total != null ? Math.round(mem.total / 1048576) : null,
    memAvailMB: mem.available != null ? Math.round(mem.available / 1048576) : null,
    load1: +load[0].toFixed(2),
    load5: +load[1].toFixed(2),
    load15: +load[2].toFixed(2),
    diskFreeGB: disk.freeGB,
    diskTotalGB: disk.totalGB,
    rss: rssByCommand(),
  };
}

module.exports = {buildSample, memInfo, diskInfo, rssByCommand, SAFE_COMM};

// Auto-run only when invoked directly (not when imported by a test).
if (require.main === module) {
  const startMs = Date.now();
  const emit = (n) => {
    try {
      console.log('TELEMETRY ' + JSON.stringify(buildSample(startMs, Date.now())));
    } catch (e) {
      console.log('TELEMETRY sample ' + n + ' unavailable: ' + (e && e.message ? e.message : e));
    }
  };
  emit(0);
  let n = 1;
  const timer = setInterval(() => {
    if (n >= MAX_SAMPLES) {
      clearInterval(timer);
      return;
    }
    emit(n++);
  }, INTERVAL_MS);
  const stop = () => {
    clearInterval(timer);
    process.exit(0);
  };
  process.on('SIGTERM', stop);
  process.on('SIGINT', stop);
}
