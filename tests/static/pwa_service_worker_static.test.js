import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {describe, expect, it} from 'vitest';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..', '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

const sw = read('public/sw.js');
const registration = read('src/lib/serviceWorkerRegistration.js');
const main = read('src/main.jsx');
const setupModal = read('src/webforms/AppSetupModal.jsx');

describe('PWA app-shell service worker contract', () => {
  it('registers the root-scoped public service worker only in production or test mode', () => {
    expect(registration).toContain("export const APP_SERVICE_WORKER_PATH = '/sw.js';");
    expect(registration).toContain("'serviceWorker' in navigator");
    expect(registration).toContain("env.PROD || env.MODE === 'test'");
    expect(registration).toContain("navigator.serviceWorker.register(APP_SERVICE_WORKER_PATH, {scope: '/'})");
    expect(main).toContain("import {registerAppServiceWorker} from './lib/serviceWorkerRegistration.js';");
    expect(main).toMatch(/applyManifestHref\(window\.location\.pathname\);\s*registerAppServiceWorker\(\);/);
  });

  it('pre-caches the three install shells plus manifests, icons, and self-hosted font', () => {
    for (const marker of [
      'const SHELL_CACHE = `wcf-app-shell-${CACHE_VERSION}`;',
      'const RUNTIME_CACHE = `wcf-runtime-${CACHE_VERSION}`;',
      "'/index.html'",
      "'/dailys.html'",
      "'/equipment.html'",
      "'/manifest.webmanifest'",
      "'/manifest-dailys.webmanifest'",
      "'/manifest-equipment.webmanifest'",
      "'/icons/icon-192.png'",
      "'/icons/icon-512.png'",
      "'/fonts/hanken-grotesk-latin.woff2'",
    ]) {
      expect(sw).toContain(marker);
    }
    expect(sw).toContain("for (const shellUrl of ['/index.html', '/dailys.html', '/equipment.html'])");
    expect(sw).toContain('await cacheLinkedBuildAssets(shellCache, shellUrl);');
    expect(sw).toContain("value.startsWith('/assets/')");
  });

  it('does not intercept Supabase/API writes or cross-origin traffic', () => {
    expect(sw).toContain("if (request.method !== 'GET') return;");
    expect(sw).toContain('if (url.origin !== self.location.origin) return;');
    expect(sw).not.toContain('pzfujbjtayhkdlxiblwe.supabase.co');
    expect(sw).not.toMatch(/\.from\(|\.rpc\(|supabase/i);
  });

  it('serves route-specific cached shells for offline navigation', () => {
    expect(sw).toContain("prefixes: ['/dailys', '/webforms'], shell: '/dailys.html'");
    expect(sw).toContain("prefixes: ['/equipment', '/fueling'], shell: '/equipment.html'");
    expect(sw).toContain("if (request.mode === 'navigate')");
    expect(sw).toContain('event.respondWith(handleNavigation(request));');
    expect(sw).toContain("return match ? match.shell : '/index.html';");
    expect(sw).toContain("await shellCache.match('/index.html')");
  });

  it('has explicit update behavior so new service-worker versions replace stale app shells', () => {
    expect(sw).toContain('self.skipWaiting();');
    expect(sw).toContain('await self.clients.claim();');
    expect(sw).toMatch(/caches\.keys\(\)[\s\S]*caches\.delete\(name\)/);
  });

  it('App Setup copy distinguishes offline app cache from queued submission storage', () => {
    expect(setupModal).not.toContain('does not have offline-cache yet');
    expect(setupModal).toContain('Offline cache starts after the app has opened online at least once.');
    expect(setupModal).toMatch(/Queued submissions still live on this\s+device/);
    expect(setupModal).toContain('same home-screen icon');
  });
});
