# Handoff — next Claude session

Ronnie is the user. Farm admin, owner of White Creek Farm. Paste the prompt at the bottom of this file as the first message of the next session.

---

## What just happened (2026-04-24 session)

Massive Podio→Planner data parity marathon + equipment admin UX + new Fuel Log system + documents bucket. Shipped in ~20 commits across the day. The day's big themes were (1) get every Podio Checklist entry reflected correctly in the planner with no phantom duplicates, (2) expose every equipment config surface to the admin so nothing falls back to code, (3) separate operator-facing content from admin-only content, (4) add fuel-supply tracking as a distinct concept from per-equipment fueling.

### Code / schema shipped

**Migrations applied (all four by Ronnie in SQL Editor):**
- **022** — `equipment.team_members JSONB` + renamed existing `status='retired'` → `'sold'` for the 6 sold pieces (JD-317/333/Gator, Kubota-RTV, Polaris-Ranger, Great-Plains-Drill).
- **023** — `equipment.manuals JSONB` (operator-facing PDFs + YouTube videos).
- **024** — `equipment_fuelings.suppressed BOOLEAN` (reserved, unused currently) + `fuel_supplies` table with public-anon-insert RLS.
- **025** — `equipment.documents JSONB` (admin-only paperwork, separate from `manuals`).

**Major features:**
- **/admin → Equipment**: dropdown replaced with a categorized lined list + Sold section. Click a piece → full-screen modal. Modal cards: Identity, Team Members (with CRUD over the master list), **Specs & Fluids** (moved out of /equipment/<slug> entirely), Manuals & Videos, Admin Documents, Webform Help Text, Every-fillup Items, Service Intervals, Attachment Checklists (if any).
- **Home dashboard**: new 🔧 EQUIPMENT ATTENTION section (overdue services + warranty ≤60d), new ⛽ OUTSTANDING FUEL CHECKLISTS section (pieces not fueled in 14+ days), both separated from the MISSED DAILY REPORTS block. Click-through to `/equipment/<slug>` or `/fueling/<slug>`.
- **Public /fueling webform**: Service Due copy cleaned up, "Last N-hour checklist done at X" added, divisor-rule language dropped. **Check Oil required-tick** for non-ATV/Toro pieces (red asterisk + border + blocks submit). Partial-completion display suppressed if a full has happened since, otherwise shows missing items + team_member. Team-member dropdown now filters to operators assigned in `equipment.team_members`. Manuals & Videos card renders at top with empty-state message when no docs uploaded.
- **Public /fuel-supply webform** (new): anonymous operators log fuel *delivered* to the farm — portable cell / gas cans / farm truck / direct / other. Writes to `fuel_supplies` table. Auto-calcs total from gal × $/gal. Separate concept from equipment fuelings — never counts as consumption.
- **/admin → Fuel Log** (new tab): ledger of every `fuel_supplies` entry with YTD + last-30-days totals by fuel type + spend. Inline edit/delete + `+ Add supply` button.
- **/equipment/<slug>**: operator chips on header ("Operators: BMAN, BRIAN..."), "Mark sold" button (was "Archive"), ManualsCard added, Specs panel removed (moved to admin modal).
- **Shared header**: 📝 Dailys and ⛽ Fueling buttons in the dark top bar — site-wide quick access to /webforms and /fueling hubs, highlighted on active routes.

**New shared component:** `src/equipment/ManualsCard.jsx` — collapsible "📖 Manuals & Videos (N)" card, renders PDFs as amber link-out rows + YouTube videos as thumbnail grid. Used on /fueling/<slug> and /equipment/<slug>.

### Data operations run today (in chronological order, for future audit)

1. `patch_equipment_fillup_ticks.cjs --commit` → **570 fueling rows** backfilled with recovered `every_fillup_check` data. Root cause: Podio apps use two different external_ids (`every-fuel-fill-up-checklist` vs `every-fuel-fill-up`); import was only matching the longer variant, silently dropping ticks on every 2018 Hijet + some other pieces. Also `option.status !== 'deleted'` filter reapplied.
2. `patch_equipment_operator_notes.cjs --commit` → **15 pieces** got verbatim Podio TOP descriptions written to `operator_notes` (after a careful re-fetch cycle — WebFetch was summarizing on first pass).
3. `patch_ventrac_every_use_attachments.cjs --commit` → Ventrac's 3 missing **"Every Use" attachment sections** added (Tough Cut, AERO-Vator, Landscape Rake). Old import regex required `hour|km`; "Every Use" matched neither, so import silently dropped them. Regex now accepts `every (use|session)` as `hours_or_km:0`.
4. `patch_dedup_fueling_pairs.cjs --commit` (run twice) → collapsed duplicate row pairs from Fuel Log ↔ Checklist imports that didn't merge via relation. First run: 187 groups merged / 209 rows deleted. Later run: 1 group (ATV-1 NICK 2024-08-25) after gallons-preference fix.
5. `patch_scrub_fuel_log_only.cjs --commit` (first attempt, **too aggressive**) → deleted 372 rows by `podio_source_app='fuel_log'`. Destroyed merged data because dedup didn't update the source label. **Recovered below.**
6. `import_equipment.cjs --fuelings-only --commit` (new flag added this session to preserve admin patches) → **946 fueling rows re-created** from Podio dump. Equipment table untouched.
7. Fresh Podio dump pulled (`pull_podio_equipment_photos.cjs` was unrelated; `pull_podio_equipment.cjs` for the app/item configs) → picked up 5 new Fuel Log + 3 new Checklist entries since the 2026-04-21 dump.
8. Import re-run; scrub re-run (source-based, now safe because merge labels are correct post-re-import) → **277 Fuel Log orphans hard-deleted** (≈2,891 gal of "naked" Fuel Log adds with no Checklist).
9. `patch_upload_equipment_documents.cjs --commit` → **33 PDFs** from Podio's Equipment Maintenance app (already on disk from the earlier photo-pull) uploaded to Supabase Storage + linked: 27 to `manuals` (operator-facing), 6 to `documents` (admin-only) via filename-keyword classifier.
10. **Photo pull**: ran through Fuel Log (1085 items), Equipment Maintenance (20 items, 33 PDFs), PS100 (32), C362 (69), got ~50 items into #3 Honda ATV then hit 420. Cursor saved; resume command in the prompt below.

### Parity state as of end-of-session

Final per-piece `equipment_fuelings` counts vs Podio Checklist-app raw counts (Ronnie confirmed acceptable):

| Piece | Planner | Podio raw | Reason for diff |
|---|---|---|---|
| 5065, gyro-trac, hijet-2018/2020, honda-atv-2/3/4, l328, mini-ex, toro, ventrac | match | match | — |
| c362 | 67 | 69 | 2 Podio-side dup Checklist submissions |
| gehl | 16 | 18 | 2 Podio-side dup |
| honda-atv-1 | 122 | 123 (dump) | 1 Podio-side dup pair collapsed |
| ps100 | 31 | 32 | 1 Podio-side dup (TED 2025-03-26 identical submission) |

The 9 "missing" Podio Checklist items across 4 pieces are all genuine duplicate submissions where an operator pressed submit twice within 24-48 hours — the planner correctly collapses to 1 row per unique fueling. Ronnie accepts this.

### Code conventions locked in this session

- **Equipment status enum is `active | sold`** (renamed from `retired` via migration 022). The 6 sold pieces (JD-317/333/Gator, Kubota-RTV, Polaris-Ranger, Great-Plains-Drill) now carry `status='sold'` in the DB. Fleet view, admin modal, and detail page all use `'sold'`. `import_equipment.cjs` also writes `'sold'` for future re-runs.
- **`equipment.manuals` is operator-facing**; `equipment.documents` is admin-only. Shape is identical: `[{type:'pdf'|'video', title, url, path?, uploadedAt, source?, podio_file_id?}]`. Don't mix the two — ManualsCard only reads `manuals`.
- **"Every Use" / "Every Session" attachment intervals** = `hours_or_km: 0` (sentinel for per-session). ManualsCard / webform render logic treats 0 as "Every Use" literal string.
- **Fuel supply events go to `fuel_supplies`, not `equipment_fuelings`.** They track fuel *coming onto the farm* (cell deliveries, can fills, truck fills). Destination enum: `cell|gas_can|farm_truck|direct|other`. Never counts as consumption; consumption = `SUM(equipment_fuelings.gallons)`.
- **Scrub logic must be content-based, not source-label-based** if you run it after dedup. See pitfalls below.

---

## ⚠ Data-parity pitfalls (read before importing any more Podio apps)

These bit us hard today. Read carefully before touching Podio-import code:

### 1. Podio external_ids vary per app

Same concept, different external_ids across apps. The 2018 Hijet's fillup-checklist field is `every-fuel-fill-up`; PS100's is `every-fuel-fill-up-checklist`. Silent data loss when the importer only matches one.

**Rule:** When adding a new app's importer, FIRST grep the dump's `*.config.json` for the field's external_id: `grep -E '"external_id"' scripts/podio_equipment_dump/<appId>.*.config.json`. Add fallback matching for ALL variants you see. Test on 2+ apps.

Current known variants in equipment dump:
- `every-fuel-fill-up-checklist` (most apps)
- `every-fuel-fill-up` (2018 Hijet + a few)

### 2. `status='deleted'` cruft on every app

Podio's app-config API returns every field + option that ever existed, including deleted ones. Without filtering, the seeder loads ghost intervals (e.g. Honda ATV inheriting 300/600/1200h tractor intervals from a cloned template). **21 deleted fields + ~400 deleted options** across the 17 equipment apps when surveyed 2026-04-23.

**Rule (already in §7 don't-touch):** ALWAYS filter both `field.status !== 'deleted'` AND `option.status !== 'deleted'` when walking app config.

### 3. "Every Use" / "Every Session" intervals

Ventrac's attachment checklists include "Tough Cut -- Every Use" and "AERO-Vator -- Every Use" — per-session checks, not hour milestones. The import regex `/(\d+)\s*(hour|km)/` silently skipped them.

**Rule:** `parseIntervalLabel` must accept `every (use|session)` and return `values: [0]`. `0` is the sentinel for per-session. Render layer treats `hours_or_km === 0` as literal "Every Use" label.

### 4. Podio's Fuel Log is a SEPARATE tracking app

In the Equipment workspace, Podio has TWO apps per fueling event:
- **Fuel Log** (app_id 29645966) — aggregate fuel tracking across all equipment, 1,085 items (as of 2026-04-24). Categories are like `NEW HOLLAND TRACTOR`, `C362`, `#1 HONDA ATV`, `FUEL TRUCK FUEL CELL`, `GAS CAN`. Ronnie's workflow: when a Checklist is submitted, Podio auto-populates a Fuel Log row.
- **Per-equipment Checklist apps** (one per piece) — the maintenance checklist where operators tick items + attach photos.

Fuel Log can ALSO have standalone entries (direct Fuel Log adds without a Checklist). Ronnie considers those "not real fuelings" and wants them scrubbed. Categories like `FUEL TRUCK FUEL CELL` / `GAS CAN` / `FUEL TRUCK` / `2018 FORD F350` / `OTHER` are supply events, not equipment fuelings — map them to the `fuel_supplies` table now that we have it.

**Rule:** Import script must merge Fuel Log + Checklist into ONE `equipment_fuelings` row. If the relation field is missing, fall back to matching by `(equipment_id, date, reading±1, team)`. If NEITHER matches, create a standalone row with `podio_source_app='checklist_<slug>'`. The label `podio_source_app='fuel_log'` (no `+checklist` suffix) means **Fuel Log orphan** — scrubbable.

Current `FUEL_LOG_CATEGORY_MAP` in `import_equipment.cjs` handles 17 categories. Other Podio apps (when you import new workspaces) will likely need their own category maps.

### 5. Dedup-then-scrub destroys data if source labels aren't updated

Today's near-disaster: dedup merged 187 pairs but kept winner's original `podio_source_app='fuel_log'`. Subsequent scrub deleted by source → wiped 372 rows including merged ones. 32 PS100 rows became 4.

**Rule:** When dedup merges a Checklist-carrying row into a Fuel Log row, UPDATE the winner's `podio_source_app` to `fuel_log+checklist_<slug>`. OR scrub by content criteria (`every_fillup_check = [] AND service_intervals_completed = []`) instead of source label. Both are safe; don't mix.

### 6. Import script overwrites equipment-table admin patches

`buildEquipmentRows()` re-derives name, serial, fluid specs, operator_notes, etc. from Podio. Re-running `import_equipment.cjs` without the `--fuelings-only` flag wipes post-import admin patches (operator_notes, team_members, manuals, documents, attachment_checklists adjustments).

**Rule:** Use `--fuelings-only` for every post-launch re-run. The full-import form is only correct on a clean slate.

### 7. WebFetch on Podio webforms is lossy

The AI inside WebFetch summarizes. On first pass today:
- Ventrac came back showing 0 service intervals + 0 attachments (all of which existed).
- PS100 came back without help text (which existed).
- Several pieces got abbreviated option labels.

**Rule:** For new Podio app imports, **use the local dump, not WebFetch**. If you must WebFetch the live webform (e.g. to capture top-of-form descriptive text that ISN'T in the dump), use a strict "no summarization, verbatim every option, preserve punctuation + whitespace" prompt AND cross-check against the dump's option counts.

### 8. Explicit SELECT lists miss newly-added columns

`FuelingHub.jsx`, `HomeDashboard.jsx`, and other webform screens enumerate equipment columns explicitly (not `select('*')`). When a new column is added via migration, these selects don't auto-include it. Today we had two silent bugs from this — team_members not loading on /fueling, and a `current_hours`/`hours_reading` typo making the dashboard show "No fueling on record" for every piece.

**Rule:** When adding a column to `equipment` or `equipment_fuelings`, grep for `from('equipment')` / `from('equipment_fuelings')` across `src/` and add the new column to every explicit select. Double-check dashboard + webform + admin editor.

### 9. Podio-side duplicates are real

Operators sometimes submit the same Checklist twice within 24-48 hours — typically when the first submission seemed to fail or when doing late data entry. This creates 2 Podio items with identical date/reading/team/gallons. The planner correctly collapses via fallback match. Raw Podio counts (visible in XLSX exports or the app's item list) will always be ≥ the planner's count for pieces where this happened. Current pairs: c362 ×2, gehl ×2, atv-1 ×4, ps100 ×1.

**Rule:** When Ronnie compares a Podio XLSX count to the planner, this is the first thing to check. Use `scripts/patch_restore_missing_checklists.cjs` (preview mode) to list unmatched Podio items.

### 10. Netlify build minutes are limited on free tier

10+ commits during rapid iteration ate through the free tier cap today. Site paused at `wcfplanner.com` → "Site not available". Ronnie added credits to continue.

**Rule:** Batch edits locally, test via `npm run dev` on localhost:5173, push once. Only push mid-task if Ronnie is actively testing and specifically needs a deploy.

---

## What's outstanding

### Near-term

- **Photo pull** — download is partway through. Currently stopped ~50/74 in #3 Honda ATV Fueling Checklists app. Cursor saved. Resume via `node scripts/pull_podio_equipment_photos.cjs` after the Podio 1-hour window clears. If it hits another 420, wait and re-run. Once download completes (look for `✓ N files cataloged`), run `node scripts/pull_podio_equipment_photos.cjs --upload` to push photos to Supabase and link to fueling rows.
- **Fuel Log webform + ledger smoke test** — shipped today but Ronnie hasn't verified end-to-end. He should submit one at `/fuel-supply` (gas can fill or cell delivery) and confirm it shows up in `/admin` → Fuel Log tab.
- **Fuel cell balance math** — `fuel_supplies` table tracks supplies IN, but we haven't implemented a "cell balance" view that shows supply-in minus cell-dispensed-to-equipment. Ronnie said the cell dispenses to multiple pieces (forestry + others) and didn't want a "was fueled from cell" flag at this point. Revisit if he asks.
- **Archived Podio-dup reconciliation** — the 9 Podio-side duplicates will always make planner counts ≤ Podio raw counts. Document in-admin or build a "see Podio's Nth submission" link if Ronnie ever wants transparency on which submissions got collapsed.

### Deferred / roadmap

- **More Podio apps to import** (Ronnie explicitly flagged this). He has other Podio workspaces coming over — animal dailys, possibly breeding records, etc. Every pitfall above applies. Budget time for:
  1. Inventory each app's fields via dump (`*.config.json`).
  2. Identify status='deleted' cruft.
  3. Match external_id variants.
  4. Design per-app → planner table mapping.
  5. Add per-app category map if there's a Fuel-Log-style aggregator.
  6. Add `--fuelings-only`-style flag if it writes to a patched-admin table.
  7. Dry-run, audit against Podio XLSX exports, deploy.
- **Global team-members admin panel** — CRUD now lives inside the per-equipment modal. Ronnie asked if there was a "master panel" for this. Not yet — could add a standalone "Team Members" tab at `/admin` that manages the master list without opening any piece. Low priority.
- **Pig FCR cache, per-head cattle cost rollup, feed physical-count verification, cattle modal cleanup, sheep Phase 2** — all from the old roadmap, untouched today.
- **Equipment dashboard polish** — ATTENTION + OUTSTANDING FUEL CHECKLISTS sections shipped but could use filtering (show only "needs action today" vs "upcoming in 30d") and a bulk "Clear all" that persists.

---

## Things I wish I knew at the start of today's session

1. **The dedup ↔ scrub interaction.** If I'd known dedup doesn't update `podio_source_app` labels on winners, I would've written the scrub to be content-based from the start and saved ~90 minutes of recovery work when I wiped 372 rows.

2. **Podio external_id variants across apps.** The very first audit I ran showed `0/1000 rows with every_fillup_check` — a 5-minute grep of the dump would've revealed the `every-fuel-fill-up` vs `-checklist` split and skipped an hour of dead-end debugging.

3. **FuelingHub enumerates columns explicitly.** I added `team_members` and `manuals` columns via migrations, updated the admin editor, updated the Detail page, then watched Ronnie's screenshots show empty data on /fueling/<slug>. Another grep-first habit would've caught this earlier: before touching a column, `rg "from('equipment')"` to find every select site.

4. **WebFetch is unreliable for verbatim Podio content.** I trusted it. Got burned multiple times (Ventrac truncation, help text "diffs" that weren't real). Default to the dump; WebFetch is a last-resort supplement for things the dump genuinely lacks (like webform TOP descriptions).

5. **Ronnie wants modal overlays, not inline editors, for per-item admin.** The "nothing happens when I click" report was 100% a UX expectation mismatch — the inline editors WERE rendering, just below the fold. Modal should be the default for lists with per-item detail editing.

6. **Netlify's build-minutes cap is real on the free tier.** ~10 deploys in a session will exhaust it. I didn't plan iteration cadence around this and cost Ronnie credits. Batch edits, push when the user wants to test.

7. **Migrations go via SQL Editor, manually, by Ronnie.** The deployment SOP says this but in the heat of iteration I proposed migrations AND code that depended on them in the same commit. Better pattern: ship the code with defensive column handling (try/catch, `Array.isArray(x) ? x : []`), then land the migration, then remove the defensive fallback in a follow-up.

8. **Podio duplicates are a real feature of the source data, not a bug.** If raw Podio counts don't match planner counts, check for Podio-side dupes FIRST before assuming import gaps.

---

## Key repo facts (unchanged from 2026-04-23, just reminders)

- Working dir: `C:\Users\Ronni\WCF-planner` (Windows 11, Git Bash — use `/c/Users/...` or forward slashes; backslashes get eaten).
- Single-file Vite app, entry `src/main.jsx`. 60+ extracted components.
- Supabase is the only backend. Migrations under `supabase-migrations/NNN_*.sql` — **Ronnie applies these manually in the SQL Editor**, you cannot run them. Ask him to apply, wait for confirmation, then run any patch scripts that depend on them.
- Production deploys from `main` to Netlify (free tier on Farm Team account) automatically on push. Ronnie added credits today; watch build-minutes if pushing frequently.
- Equipment module schema is in migrations **016** through **025**. All applied as of end of 2026-04-24.
- Podio dump lives in `scripts/podio_equipment_dump/` — 17 `config.json` + `items.json` pairs + `_summary.json`. Fresh dump pulled 2026-04-24. Treat as read-only source of truth.
- Equipment slugs (active): `5065`, `ps100`, `honda-atv-1..4`, `hijet-2018`, `hijet-2020`, `toro`, `ventrac`, `gehl`, `l328`, `mini-ex`, `gyro-trac`, `c362` (15 with checklist apps) + `great-plains-drill` (active but no checklist). Sold (status='sold'): `jd-317`, `jd-333`, `jd-gator`, `kubota-rtv`, `polaris-ranger`.
- Diagnostic scripts (all in `scripts/`):
  - `inspect_equipment_state.cjs` — each piece's intervals + fillup count + stale counters
  - `audit_equipment_ticks_and_oil.cjs` — tick-import + Check Oil master audit
  - `audit_planner_vs_podio_webforms.cjs` — diff planner state vs Podio webform snapshot
  - `audit_ventrac_attachments.cjs` — Ventrac attachment_checklists vs dump
  - `patch_dedup_fueling_pairs.cjs` — dedup duplicate rows (idempotent)
  - `patch_scrub_fuel_log_only.cjs` — delete Fuel Log orphans (source-based, safe only if dedup has properly updated source labels)
  - `patch_scrub_empty_checklists.cjs` — alternative content-based scrub
  - `patch_restore_missing_checklists.cjs` — list Podio Checklist items missing from planner
  - `patch_upload_equipment_documents.cjs` — upload local PDFs from photo-pull to Supabase + link to equipment
- Auto-memory files at `C:\Users\Ronni\.claude\projects\C--Users-Ronni-WCF-planner\memory\`. Read `MEMORY.md` first turn.

---

## Ronnie's working style (reminders)

- **Multi-choice via `AskUserQuestion`**, not inline prose. He scans buttons faster than paragraphs.
- **Never assume.** Ask if scope is ambiguous.
- **Ask, build, wait for commit approval, commit, wait for push approval, push.** Each step gated EXCEPT when he says "commit and push" in the same turn — then it's green-lit for both.
- **Be honest about mistakes.** Especially when you burn data (like today's over-aggressive scrub).
- **No purple in the UI.** Standing rule.
- **`/equipment` + `/fueling` URL paths are printed on materials in the field** — don't rename.

---

## Copy-paste prompt for next session

```
Read PROJECT.md top to bottom, with extra attention to §1 SOP, §7 don't-touch, and the 2026-04-24 row in §Part 4. Then read HANDOFF_NEXT_SESSION.md — it has the full picture of what just shipped plus every Podio-import pitfall that bit us yesterday.

Context in one paragraph: yesterday was a Podio→Planner data-parity marathon. We shipped the Fuel Log webform + admin ledger (migration 024), the admin-only documents bucket (migration 025), the equipment admin modal with full CRUD on team members + specs + manuals + docs, the home dashboard's Outstanding Fuel Checklists section, operator chips everywhere, rate-limit-resilient photo pull, and hit parity between planner and Podio on all 15 active equipment pieces (modulo 9 genuine Podio-side duplicate submissions that we correctly collapsed). 33 operator manual PDFs are now in Supabase Storage and linked per-piece. The photo pull (historical Podio photos attached to fueling entries) is partway through and needs to be resumed — cursor saved, resume command below.

I'm Ronnie — farm owner, admin. Use the AskUserQuestion tool for any clarifying question (multi-choice pop-out boxes, not inline prose). Don't ask questions already answered in HANDOFF. Don't assume — ask if scope is ambiguous. Never commit, push, or deploy without my explicit approval in the current turn; "commit and push" in the same turn is one approval covering both. No purple in the UI.

Top-priority items to pick up when I'm ready:

1. Resume + finish the photo pull:
     node scripts/pull_podio_equipment_photos.cjs
   It resumes from the saved cursor. When it completes the download (look for "✓ N files cataloged"), run:
     node scripts/pull_podio_equipment_photos.cjs --upload
   That uploads all historical photos to Supabase and links them to equipment_fuelings rows.

2. Smoke-test the Fuel Log system end-to-end — a test submission via /fuel-supply should appear in /admin → Fuel Log.

3. Bring over more Podio apps. I'll tell you which. READ the "Data-parity pitfalls" section of HANDOFF first — all 10 pitfalls apply to every new app import. The big ones: external_id variants, status='deleted' cruft, "Every Use" intervals, Fuel-Log-style aggregators needing category maps, dedup ↔ scrub interaction, WebFetch unreliable for verbatim Podio content, explicit column selects in webforms.

Start by asking me (multi-choice) whether you should: (a) resume photo pull now, (b) start on a specific Podio app I'll name, or (c) handle an operational issue I'll describe.
```
