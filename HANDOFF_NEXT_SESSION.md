# Handoff — next Claude session

Ronnie is the user. Farm admin, owner of White Creek Farm. Paste the prompt at the bottom of this file as the first message of the next session.

---

## What just happened (2026-04-23 session)

Equipment module polish marathon. Root cause: Podio's app-config API returns every field and option that ever lived on an app — including ones flagged `status: 'deleted'` that the published webform hides. The seeder was eating all of them, which is why Honda ATV #1 showed phantom 300/600/1200-hour *tractor* intervals on its /fueling page. Surveyed: 21 deleted fields + ~400 deleted options across 17 Podio apps.

Cleanup done in this session:

1. **Seeder filters `status !== 'deleted'`** on both fields and options (`scripts/import_equipment.cjs`).
2. **Re-seed script** `scripts/patch_equipment_intervals.cjs --commit` rebuilt `service_intervals` + `every_fillup_items` + `attachment_checklists` from clean source for all 15 pieces.
3. **Historical completions normalized** via `scripts/patch_equipment_completions.cjs --commit` — 98 rows rewritten, 134 stale `total_tasks` clamped, 32 `items_completed` arrays filtered against current task IDs, 2 orphan `km:200` completions dropped.
4. **Help-text surfaced** from Podio field descriptions. Migrations **019** + **020** add `every_fillup_help`, `fuel_gallons_help`, `operator_notes` text columns + per-interval `help_text` stored inside `service_intervals` JSONB. `scripts/patch_equipment_help_text.cjs --commit` patches in one pass.
5. **Attachment checklists** (Ventrac's Tough Cut / AERO-Vator / Landscape Rake). Migration **021** adds `attachment_checklists` JSONB. Detected in the seeder by `/\s--\s|\s—\s/` in the field label, bucketed separately so they don't collide with main intervals on dedup.
6. **Admin tab moved.** All webform config editing (identity, help text, intervals, per-task, fillup items, attachments) lives in `src/admin/EquipmentWebformsAdmin.jsx`, reached via **`/webforms` → Equipment tab** (dropdown at top picks the piece). `EquipmentDetail.jsx` is now a pure read view — don't put editors back on the per-piece page.
7. **Expanded fueling rows** on the equipment detail page now render full checklist content: green pills for every-fillup ticks, per-interval cards with each ticked task as blue pills + `N/M · full/partial`, and photo thumbnails.
8. **Parser fixes**: `"FIRST 75 & EVERY 500 hours"` → only 500 (Toro phantom 75h gone). HTML entities decoded on Podio descriptions.
9. **Latent bug squashed**: `FuelingHub.jsx`'s explicit column select was missing `takes_def` → DEF gallons input never rendered on PS100 / Mini-Ex / Gyro-Trac / C362 webforms.

All three migrations (019/020/021) have been applied in Supabase. All three patch scripts have been `--commit`ed. 15/15 equipment rows are clean. Code shipped.

## Open item, top priority next session

**`scripts/pull_podio_equipment_photos.cjs` got rate-limited by Podio.** It walks every item via `/item/{item_id}` to fetch the `files` array (the bulk dump doesn't include file metadata). Podio's quota is 5,000 req/hr/user. After ~1,080 items on the Fuel Log app it returned `420 You have hit the rate limit. Please wait 3600 seconds`. Script needs:

- Detect 420 response, back off for the indicated duration (or next hour tick), resume.
- Checkpoint progress to `_photos_pull_cursor.json` keyed by `(app_id, item_id)` so a re-run resumes where it stopped.
- Proactively throttle to stay under ~4,000 req/hr (use the `X-Rate-Limit-Remaining` headers if Podio sends them).
- Consider whether `/item/app/{app_id}/filter/` with bulk field selection can replace the per-item call.

Until this finishes, Podio-imported fueling rows (the ~1,790 historical ones) show no photos on `/equipment/<slug>`. New webform submissions upload photos directly to Supabase Storage and already work.

Podio creds are in `scripts/.env` (`PODIO_CLIENT_ID`, `PODIO_CLIENT_SECRET`, `PODIO_USERNAME`, `PODIO_PASSWORD`). Supabase service key also in that file.

## Traps and mistakes to not repeat

- **Don't declare a data source "complete" after checking two examples.** Early in this session I fetched two Podio webforms (Honda #1 + C362), found they matched the config dumps, and claimed the configs were complete. Ronnie rightly called it out — several pieces had non-category-field help text (Toro's `Gallons of Gasoline` description, Gyro-Trac's Date field description with between-fillup operator notes) that my parser was skipping because it only scanned `type === 'category'` fields. Audit every field type when surfacing Podio metadata.
- **Webform ≠ app config.** The published Podio webform URL (`https://podio.com/webforms/<app_id>/<form_id>`) is the cleaned, curated view. The app-config JSON (`/app/<app_id>`) retains every stale template field ever added. **Filter on `field.status !== 'deleted'` and `option.status !== 'deleted'`** when walking app configs. This is in the don't-touch list now.
- **Don't put admin editors on per-piece pages.** Ronnie explicitly wanted all webform config in an admin tab, not on the equipment detail page. I built editors directly into `EquipmentDetail.jsx` first, Ronnie said "Tak all this away", had to refactor into `src/admin/EquipmentWebformsAdmin.jsx` wired into `/webforms`. Default to admin-tab placement for anything that configures a webform.
- **`total_tasks` on historical completions is a frozen snapshot.** Don't add consumers that trust it against current config. The expanded fueling row in `EquipmentDetail.jsx` computes live from `eq.service_intervals[].tasks.length` and matches `items_completed` IDs against the current task list.
- **`FuelingHub.jsx` has an explicit `select(…)` column list.** If you add a column to the `equipment` table that the webform needs, add it to the select or it silently resolves to `undefined`. Bit me with `takes_def`.
- **`wcfSelectAll` for >1000 rows.** Always. The rest of the repo uses it; patches and scripts should use `.range` + while-loop if dealing with fueling tables at scale.
- **Deployment SOP is strict:** never commit / push / deploy without explicit approval in the current session turn. `commit` means just commit; `push` / `deploy` / `cutover` each need fresh approval. Approval for change X never extends to change Y.

## Ronnie's working style

- **Multi-choice questions in pop-out format.** Use the `AskUserQuestion` tool for any clarifying question, not inline prose. He finds it faster to scan buttons than read a paragraph. Don't ask perfunctory questions — only ask what genuinely needs clarification.
- **Never assume.** If scope is ambiguous, ask. If scope is large, map the full plan out and confirm before building.
- **Ask, build, wait for commit approval, commit, wait for push approval, push.** Each step gated.
- **Be honest about mistakes.** If a data source turns out to be incomplete, say so. If the first fix didn't go deep enough, say so before proposing the next.
- **No purple in the UI.** Period. Standing rule.
- **`/equipment` + `/fueling` URL paths are printed on materials in the field** — don't rename.

## Key repo facts

- Working dir: `C:\Users\Ronni\WCF-planner` (Windows 11, bash shell — use Unix paths).
- Single-file Vite app, entry `src/main.jsx`. ~50+ extracted components under `src/`, 10 Context providers, React Router 7 URL adapter.
- Supabase is the only backend. Migrations under `supabase-migrations/NNN_*.sql` — **Ronnie applies these manually in the SQL Editor**, you cannot run them. Ask him to apply, wait for confirmation, then run any patch scripts that depend on them.
- Production deploys from `main` to Cloudflare Pages automatically on push.
- Equipment module schema is in migrations **016** through **021**. All applied as of 2026-04-23.
- Podio dump lives in `scripts/podio_equipment_dump/` — 17 `config.json` + `items.json` pairs + `_summary.json`. Treat as read-only source of truth.
- Equipment slugs: `5065`, `ps100`, `honda-atv-1..4`, `hijet-2018`, `hijet-2020`, `toro`, `ventrac`, `gehl`, `l328`, `mini-ex`, `gyro-trac`, `c362` (15 with checklist apps) + retired: `jd-317`, `jd-333`, `jd-gator`, `kubota-rtv`, `polaris-ranger`, `great-plains-drill`.
- Diagnostic tool: `node scripts/inspect_equipment_state.cjs` — prints each piece's intervals + fillup count + stale-completion counters. Use before/after any equipment data change.
- Auto-memory files are at `C:\Users\Ronni\.claude\projects\C--Users-Ronni-WCF-planner\memory\`. Read `MEMORY.md` first turn.

---

## Copy-paste prompt for next session

```
Read PROJECT.md top to bottom first, paying attention to §1 SOP, §7 don't-touch, and the 2026-04-23 row in §Part 4. Then read HANDOFF_NEXT_SESSION.md for the full context of what just shipped and what's still open.

The top near-term item is fixing scripts/pull_podio_equipment_photos.cjs to handle Podio's 5000 req/hr rate limit with (a) 420 detection + backoff, (b) progress checkpointing to resume after throttle, (c) proactive pacing. Once it can complete a full run, running it with --upload will backfill ~1,790 historical fueling rows with their Podio photos + comments.

I'm Ronnie — farm owner, admin. Use the AskUserQuestion tool for any clarifying question (I like multi-choice pop-out boxes, not inline prose). Don't ask questions already answered. Don't assume — ask if scope is ambiguous. Never commit or push or deploy without my explicit approval in the same turn. No purple in the UI.

Start by asking me (as a multi-choice question) whether you should: (a) tackle the photo pull fix now, (b) do something else from §8 roadmap, or (c) handle an operational issue I'll describe.
```
