import {defineConfig} from 'vite';
import {resolve} from 'node:path';
import react from '@vitejs/plugin-react';

// https://vitejs.dev/config/
// Source maps in production: per Ronnie, debuggable stack traces > ~30% map size.
// Default dev port (5173) intentional: avoid 3000-style squatting collisions and
// keep this a "boring standard Vite" project for handoff.
//
// Multi-page entries (PWA install: each hub needs its own HTML so the install
// banner reads the hub-specific manifest at HTML parse time, before any JS):
//   - index.html       — default; links /manifest.webmanifest (start_url /).
//   - dailys.html      — links /manifest-dailys.webmanifest (start_url /dailys).
//   - equipment.html   — links /manifest-equipment.webmanifest (start_url /equipment).
//   - pasture-map.html — links /manifest-pasture.webmanifest (start_url /pasture-map).
// Netlify _redirects routes /dailys*, /equipment*, /pasture-map*, and the legacy
// /fueling* to the right HTML before the SPA fallback so the install banner reads
// the right manifest at HTML parse time. All HTMLs boot the same React app from
// /src/main.jsx — only the install manifest differs.
export default defineConfig({
  plugins: [react()],
  build: {
    target: 'es2018',
    sourcemap: true,
    outDir: 'dist',
    rollupOptions: {
      input: {
        main: resolve(__dirname, 'index.html'),
        dailys: resolve(__dirname, 'dailys.html'),
        equipment: resolve(__dirname, 'equipment.html'),
        'pasture-map': resolve(__dirname, 'pasture-map.html'),
      },
    },
  },
});
