// ESLint flat config — Initiative B baseline (Phase 1).
//
// Conservative rule set per Codex review:
//   • @eslint/js recommended (catches real bugs: no-undef, no-redeclare, etc.)
//   • react-hooks/rules-of-hooks  → error  (matches §7 hooks rule)
//   • react-hooks/exhaustive-deps → warn   (signal, not blocker)
//   • no-unused-vars              → warn   (argsIgnorePattern: '^_')
//   • All stylistic rules         → off    (Prettier owns formatting)
//   • react/* plugin rules        → off    (parser-only; skip JSX style wars)
//
// Three blocks for the repo's three module flavors:
//   A. src/ + tests/ — browser ESM + JSX + React hooks
//   B. scripts/ + root configs — Node, ESM (matches package.json "type":"module")
//   C. *.cjs — Node, CommonJS

import js from '@eslint/js';
import reactHooks from 'eslint-plugin-react-hooks';
import globals from 'globals';

const sharedRules = {
  ...js.configs.recommended.rules,
  'no-unused-vars': ['warn', {argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_'}],
};

export default [
  // Global ignore — paths that should never be linted.
  // Mirrors .gitignore + adds belt-and-suspenders for sensitive runtime artifacts.
  {
    ignores: [
      'node_modules/**',
      'dist/**',
      'playwright-report/**',
      'test-results/**',
      'tests/.auth/**',
      'tests/fixtures/**',
      'scripts/test-bootstrap.sql',
      'scripts/podio_equipment_dump/**',
      'supabase-migrations/**',
      'public/**',
      '.github/**', // wired up by A10 later; not in scope for this PR
      '*.html',
      '*.md',
      'index.html.pre-vite-2026-04-19',
    ],
  },

  // Block A1 — src/. Browser ESM + JSX + React hooks rules.
  {
    files: ['src/**/*.{js,jsx}'],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      parserOptions: {ecmaFeatures: {jsx: true}},
      globals: {
        ...globals.browser,
        ...globals.node, // process.env, console — used in a few isomorphic helpers
      },
    },
    plugins: {
      'react-hooks': reactHooks,
    },
    rules: {
      ...sharedRules,
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'warn',
    },
  },

  // Block A2 — tests/. Browser-ish + Node ESM. NO React hooks rules: tests/
  // doesn't render React, and Playwright's fixture callback `use(...)` token
  // collides with the rules-of-hooks heuristic that any function named `use*`
  // must obey hook rules. Scoping the plugin to src/ avoids the false
  // positives without weakening signal.
  {
    files: ['tests/**/*.js'],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      globals: {
        ...globals.browser,
        ...globals.node,
      },
    },
    rules: sharedRules,
  },

  // Block B — Node ESM. scripts/ inherits package "type":"module"; root configs
  // (vite.config.js, playwright.config.js) and scripts/build_test_bootstrap.js
  // use `import`. Older scripts/*.js use `require` — those parse fine under
  // sourceType:'module' (require is just a function call, not syntax) and
  // resolve via globals.node which exposes require/module/__dirname.
  {
    files: [
      'scripts/**/*.js',
      'scripts/**/*.mjs',
      '*.{js,mjs}', // vite.config.js, playwright.config.js, eslint.config.js
    ],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      globals: {
        ...globals.node,
      },
    },
    rules: sharedRules,
  },

  // Block C — Node CommonJS. Explicit .cjs scripts.
  {
    files: ['scripts/**/*.cjs', '*.cjs'],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'commonjs',
      globals: {
        ...globals.node,
      },
    },
    rules: sharedRules,
  },
];
