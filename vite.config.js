import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// https://vitejs.dev/config/
// Source maps in production: per Ronnie, debuggable stack traces > ~30% map size.
// Default dev port (5173) intentional: avoid 3000-style squatting collisions and
// keep this a "boring standard Vite" project for handoff.
export default defineConfig({
  plugins: [react()],
  build: {
    sourcemap: true,
    outDir: 'dist',
  },
});
