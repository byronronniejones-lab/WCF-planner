#!/usr/bin/env node
// ============================================================================
// scripts/fleet/io.cjs — the ONE side-effecting boundary for the fleet toolkit
// ============================================================================
// Every fleet module takes an injected `io` so the DB-free unit tests can feed
// scripted responses and never spawn a process or touch a project. realIo() is
// the production implementation:
//   - run(file, args, opts): spawn with shell:false + argument ARRAY (no shell
//     string interpolation anywhere). stdin is fed via the `input` option, so
//     credentials can be passed to gh/supabase WITHOUT ever appearing in argv
//     (argv is visible in process listings; stdin is not).
//   - all log/warn output is redacted.
// ============================================================================
'use strict';

const {spawn} = require('child_process');
const fs = require('fs');
const {redact} = require('./redact.cjs');

function realIo() {
  return {
    // Resolves to {code, stdout, stderr}. Never rejects. Never uses a shell.
    run(file, args, {input = null, timeoutMs = 120000, cwd = undefined, env = undefined} = {}) {
      return new Promise((resolve) => {
        const proc = spawn(file, args, {
          shell: false,
          windowsHide: true,
          cwd,
          env,
          stdio: ['pipe', 'pipe', 'pipe'],
        });
        let stdout = '';
        let stderr = '';
        const timer = setTimeout(() => proc.kill(), timeoutMs);
        timer.unref();
        proc.stdout.on('data', (d) => (stdout += d));
        proc.stderr.on('data', (d) => (stderr += d));
        proc.on('error', (e) => {
          clearTimeout(timer);
          resolve({code: 127, stdout, stderr: String(e && e.message)});
        });
        proc.on('close', (code) => {
          clearTimeout(timer);
          resolve({code: code === null ? 1 : code, stdout, stderr});
        });
        if (input != null) proc.stdin.write(input);
        proc.stdin.end();
      });
    },
    readFileSafe(p) {
      try {
        return fs.readFileSync(p, 'utf8');
      } catch {
        return null;
      }
    },
    // mode 0o600 by default so credential-bearing temp files are owner-only.
    writeFile(p, data, {mode = 0o600} = {}) {
      fs.writeFileSync(p, data, {mode});
      try {
        fs.chmodSync(p, mode);
      } catch {
        /* chmod is a best-effort tightening on Windows */
      }
    },
    removeFile(p) {
      try {
        fs.rmSync(p, {force: true});
        return !fs.existsSync(p);
      } catch {
        return false;
      }
    },
    exists(p) {
      return fs.existsSync(p);
    },
    mkdirp(p) {
      fs.mkdirSync(p, {recursive: true});
    },
    // JSON HTTP for the GoTrue Auth admin API. Credentials go in HEADERS only
    // (never argv). Returns {status, json}. Never throws on non-2xx.
    async fetchJson(url, {method = 'GET', headers = {}, body = undefined, timeoutMs = 30000} = {}) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      timer.unref?.();
      try {
        const res = await fetch(url, {
          method,
          headers: {'Content-Type': 'application/json', ...headers},
          body: body === undefined ? undefined : JSON.stringify(body),
          signal: controller.signal,
        });
        let json = null;
        const text = await res.text();
        try {
          json = text ? JSON.parse(text) : null;
        } catch {
          json = {raw: text};
        }
        return {status: res.status, json};
      } catch (e) {
        return {status: 0, json: null, error: String(e && e.message)};
      } finally {
        clearTimeout(timer);
      }
    },
    log(msg) {
      console.log(`[fleet] ${redact(String(msg))}`);
    },
    warn(msg) {
      console.error(`[fleet] ${redact(String(msg))}`);
    },
  };
}

module.exports = {realIo};
