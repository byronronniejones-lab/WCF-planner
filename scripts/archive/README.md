# scripts/archive

Historical/manual one-shot scripts. **Not** automation entrypoints. Nothing in
this directory is invoked by `npm run` scripts, CI workflows, test setup,
migration appliers, or in-app UI flows.

Files here mostly fall into these classes:

- `audit_*`, `inspect_*`, `*_audit.js`, `peek_*`, `dailys_*`, `cow*`, `tag*`,
  `weighin*`, `herd_*`, `mommas_*`, `xlsx_*`, `zero_*`, `orphan_*`,
  `infer_*`, `compare_*`, `blank_*`, `check_*`, `verify_*`, `session_*` —
  data audits and one-shot inspections. Many were written during the Podio
  → Supabase data migration in early 2026 and have served their purpose.
- `patch_*` — one-shot data patches that fixed specific historical
  problems (equipment intervals, ventrac attachments, fueling pairs, etc.).
  Their effects are already in the database.
- `fix_*` — one-shot data fixes (purchase amounts, RCV entered-at, feed
  herd scope).
- `import_cattle*`, `import_sheep.cjs`, `import_weighins.js` — initial
  data imports. The live `scripts/import_equipment.cjs` stays in the root.
- `seed_*` (except `seed_batch_cows_detail.js`, which mig 005 still
  references) — initial data seed scripts.
- `probe_*` — diagnostic probes from RPC/feature investigations.
- `purge_0416.js`, `show_0416.js`, `merge_sessions_by_date.js`,
  `strip_mortality_from_webform_config.js`, `purchase_amounts_backfill.sql`,
  `generate_pwa_icons.cjs`, `reload_test_schema.cjs` — miscellaneous
  one-shots without active references.

If a script in this directory is needed again, lift it back to `scripts/`
(with `git mv` so history is preserved) and re-validate it against the
current schema before re-running.
