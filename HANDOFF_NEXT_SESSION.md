# Handoff — next Claude session

Ronnie is the user. Farm admin, owner of White Creek Farm. Paste the prompt at the bottom of this file as the first message of the next session.

---

## What just happened (2026-04-25 session)

Equipment math overhaul + fuel-bill module + admin team-member UX rebuild + photo relink. 19 commits across the day, one new migration. The day's themes were:

1. Make milestone math actually match how mechanics work — early completions count, partials accumulate across sessions toward the same milestone, divisor cascades don't over-credit subs
2. Ship the bill side of fuel reconciliation — Home Oil PDF parser + admin Bills tab + monthly variance view
3. Finish wiring the Fuel Supply form's admin into the master team list — and fix the two race-condition bugs that made admin saves silently revert
4. Close the photo→fueling link gap left over from yesterday's dedup-then-scrub flow

The state of the equipment module is materially improved end-to-end. Per-equipment pages now show the right "next due" math, the right cumulative-partial behavior, in-place editable historical checklists, a photo lightbox, and per-row checklist chips. The home dashboard's Equipment Attention section now lists every overdue interval as its own row plus per-piece every-fillup streak summaries. Photo coverage went from 48 to 167 fuelings linked.

### Code / schema shipped

**Migration applied (Ronnie in SQL Editor):**
- **026** — `fuel_bills` + `fuel_bill_lines` tables (header + line items), `fuel-bills` admin-only Storage bucket (`public:false`), authenticated-only RLS on all three.

**Major features:**
- **`/fueling/supply`** is now the canonical Fuel Supply Log URL (legacy `/fuel-supply` kept as alias). Tile in `/fueling` hub's Other section. Form stripped down to date / team / destination / fuel type / gallons / notes. Supplier + cost fields removed (bills handle financial info). Quick Fuel Log tile removed entirely (was a checklist-bypass that undercut accountability).
- **`/admin → Fuel Log` is now a 3-tab pane**: Supplies ledger (existing), **Bills** (new — upload PDF, lazy-loaded `pdfjs-dist` parser walks Home Oil format → editable preview of header + per-fuel-type lines → save uploads PDF + inserts records), **Reconciliation** (new — month-by-month table grouping bills by `delivery_date` and supplies by `date`, columns for diesel/gas/def/cost on each side, variance % colored green/orange/red).
- **`/admin → Equipment → ⛽ Fuel Supply Webform` card** (top of the tab) with full team-member CRUD: each name as a chip with click-toggle for fuel-supply assignment + ✕ to remove from the master list. Cascade on remove strips the name from every per-form list AND every `equipment.team_members` row. "+ Add" input below the chips appends to master + sorts alphabetical. Read-fresh-then-write on every save.
- **`/fueling/<slug>`** webform: every-fillup miss streaks. Each item shows a yellow chip "Not done at last N fillups · oldest <reading>h by <name>" if it was missed in N consecutive prior fuelings. Chip vanishes when ticked. Pure done/not-done logic — no time factor. Webform header now also shows "Last reading: <X> · <name> · <date>" pulled from history.
- **`/equipment/<slug>`** detail page got a major overhaul: 
  - Upcoming Service tiles ascending-sorted by interval (50 → 100 → 250 → 500 → 600 → 1200 → 2000), each shows "Last done at <raw>h · counted as <milestone>h" so admin sees the snap reasoning, `until_due` rounded to 1 decimal at source.
  - Fueling history rows show inline chips: "50h ✓" "200h ◐" "📷 4" alongside notes.
  - Photo thumbnails on expanded rows open a full-screen lightbox with prev/next/close (Esc + arrow keys + click-backdrop).
  - Expanded-row checklists are interactive — click any sub-task or fillup item to toggle in place. Optimistic via `fuelingPatches` Map (no `onReload()` so the row doesn't collapse).
  - ✕ Remove button on each interval entry deletes that one entry without nuking the row's photos / fillup / comments / other intervals.
- **Home dashboard rebuilt around actions** (`HomeDashboard.jsx`): dropped the time-based "Outstanding Fuel Checklists" section entirely. Equipment Attention now lists each overdue interval as its own row (no "+1 more interval" hiding). Added a per-piece every-fillup streak row. Warranty rows have a manual Clear button (only the warranty kind — overdue + streak rows auto-clear when underlying state resolves).
- **Snap-to-nearest milestone math** (`src/lib/equipment.js` — refactored `computeIntervalStatus` + `computeDueIntervals` around a shared `aggregateCompletionsByMilestone` helper). Each completion snaps to the closer milestone; tie favors previous. Cumulative partial: union of items_completed across all completions in the same milestone group; if union covers all tasks, virtual-full satisfies the milestone. `total_tasks` from current equipment config so historical re-evaluation works after admin task edits. Divisor cascade uses parent's RAW reading; each sub does its own snap.
- **`syncWebformConfig` no longer overwrites team-member keys** (`main.jsx`). Reads existing master + per_form fresh; merges derived per-webform union into the existing master (preserves admin-direct adds); carries over any non-webform per-form key (preserves `fuel-supply`).

### Operations run today (in chronological order, for future audit)

1. `node scripts/pull_podio_equipment_photos.cjs` (resume from yesterday's cursor) → completed download. 599 file entries cataloged in `_photos_index.json`. All 15 checklist apps + Equipment Maintenance + Fuel Log fully pulled.
2. `node scripts/pull_podio_equipment_photos.cjs --upload` → 193 photos uploaded to Storage, 18 maintenance events created, **48 fuelings patched**. (The mismatch — 599 cataloged but only 48 fueling rows linked — was traced to the dedup-then-scrub `podio_item_id` issue.)
3. Migration 026 applied via SQL Editor.
4. `npm install pdfjs-dist` → +4 packages.
5. `node scripts/audit_fillup_streaks.cjs` (read-only) → 14 active pieces / 151 every-fillup items audited. 144 clean (95%), 7 short streaks (1-3 fuelings), 0 medium/long, 0 never-ticked. Confirmed safe to ship the streak feature without a deployment cutoff.
6. Manual DB write: seeded `webform_config.per_form_team_members.fuel-supply = ['NICK','BRIAN','TED']` to verify the form's read path. Confirmed working.
7. `node scripts/patch_relink_photos_by_date.cjs` (dry-run) → 171 manifest items resolved to fuelings; 125 new patches projected; 393 photos to upload-or-reuse; 18 skipped (no date in dump), 6 skipped (no fueling match).
8. `node scripts/patch_relink_photos_by_date.cjs --commit` (run twice — second time is idempotent and caught what the first run partially completed) → final coverage **167 fuelings with photos / 552 photos linked**.

### Final per-piece photo coverage

| Piece | Photos / Fuelings | Photos linked |
|---|---|---|
| ventrac | 23/35 | 56 |
| hijet-2018 | 17/40 | 54 |
| gyro-trac | 21/39 | 80 |
| c362 | 31/67 | 106 |
| ps100 | 12/31 | 38 |
| gehl | 11/16 | 26 |
| hijet-2020 | 11/22 | 37 |
| 5065 | 10/32 | 32 |
| l328 | 5/6 | 16 |
| honda-atv-1 | 12/122 | 44 |
| honda-atv-2 | 7/161 | 29 |
| honda-atv-3 | 3/74 | 16 |
| honda-atv-4 | 3/12 | 14 |
| toro | 1/10 | 4 |
| **fleet** | **167/668** | **552** |

Pieces with low coverage are pieces where the Podio operator era didn't include photo attachments — not a script bug. Mini-Ex shows 0/1 in the audit but only had one fueling submitted overall.

### New files this session

- `src/admin/FuelBillsView.jsx` — Bills tab UI (list + signed-URL viewer + per-bill expand with line items + delete-with-storage-cleanup).
- `src/admin/FuelReconcileView.jsx` — Month-by-month variance table.
- `src/lib/fuelBillParser.js` — Lazy-loaded pdfjs-dist + Home Oil format extractor + proportional-by-gallons tax allocator.
- `supabase-migrations/026_fuel_bills.sql` — Two tables + `fuel-bills` storage bucket + RLS policies.
- `scripts/audit_fillup_streaks.cjs` — Read-only fleet audit of every-fillup miss streaks.
- `scripts/patch_relink_photos_by_date.cjs` — Re-link photos by (equipment_id, date) instead of `podio_item_id`. `--commit` to apply.

### Code conventions locked in this session

- **Snap-to-nearest milestone for ALL service-interval completions.** `snapToNearestMilestone(reading, interval)` picks whichever milestone is closer; tie favors previous. Drives every "next due" computation.
- **Cumulative-partial milestone model.** Within a milestone group (interval × snapped milestone), the union of `items_completed` is what counts. Multiple sessions toward the same milestone aggregate.
- **Divisor cascade uses parent's RAW reading, not parent's snap.** Each sub-interval snaps independently from the parent's raw completion reading. Cascading the parent's snap over-credits subs (a 1596h completion of 600hr snapping to 1800h would falsely give 50hr the 1700h, 1750h, 1800h milestones).
- **Master `webform_config.team_members` is the canonical list.** `syncWebformConfig` MERGES the derived per-webform union into the existing master (preserves admin-direct adds). Per-form lists are the subset.
- **Read-fresh-then-write on `webform_config` jsonb edits.** Anytime a key is stored under one row's jsonb and edits arrive faster than React renders, you must re-fetch immediately before the upsert and merge against the latest stored state.
- **Photo→fueling links should match by (equipment_id, date) when possible.** `podio_item_id` is brittle in the presence of dedup. The (equipment_id, date) pair is robust enough to recover from yesterday's mismatch.

---

## ⚠ Pitfalls (read before touching equipment math or webform config)

These are now also captured in the don't-touch list (PROJECT.md §7). The TL;DR:

### 1. The milestone math is two-layer

Layer 1: each completion's reading snaps to the nearest milestone (multiple of the interval). Tie favors previous.

Layer 2: completions sharing the same snapped milestone are GROUPED. Their `items_completed` arrays are UNIONED. If union ≥ task count, the milestone is satisfied — even if no single completion was full.

Don't revert to "latest single completion wins" — it breaks the parts-arrival workflow Ronnie depends on.

### 2. Divisor cascade ≠ parent's snapped milestone

When 600hr completes at 1596h (which snaps to 1800h), the 50hr sub-interval should be credited at 1600h (its own snap of 1596h), NOT at 1800h. Cascading the parent's snap point falsely credits the sub-interval to a milestone it didn't actually do work toward.

### 3. `until_due` must be rounded at source

Float subtraction artifacts (e.g. `550 - 509.3 = 40.69999999999999`) WILL appear if you read `until_due` raw. `computeIntervalStatus` rounds to 1 decimal at source so all consumers (detail tile, home Equipment Attention, soonestDue) get clean values.

### 4. `syncWebformConfig` merges, doesn't replace

Direct adds to `webform_config.team_members` (via the Fuel Supply admin) are preserved across page loads only because syncWebformConfig now reads-then-merges. Same for `per_form_team_members.fuel-supply` — preserved because the carry-over loop checks against `cfg.webforms[].id` and keeps anything that isn't a webform key.

If you add another non-webform per-form key in the future, it'll be preserved automatically.

### 5. Read-fresh-then-write for webform_config

Toggle, addMaster, and removeMaster in `FuelSupplyAdminSection` ALL re-read `webform_config` from the DB before upserting. Don't trust local React state — concurrent toggles' setState effects may not have landed, and the upsert overwrites the entire `data` jsonb.

### 6. Photo→fueling matching is fragile

Existing `pull_podio_equipment_photos.cjs --upload` matches by `podio_item_id`. After yesterday's dedup-then-scrub flow, 147 of 195 unique photo source items lost their match. `patch_relink_photos_by_date.cjs` recovered them by matching on (equipment_id, date).

For ANY future Podio app import where dedup might collapse rows: prefer date-matching for the photo link step from the start.

### 7. Tax allocation is proportional-by-gallons in v1

`fuel_bill_lines.allocated_tax = (net_units / total_gallons) * tax_total` at parse time. Effective $/gal is the all-in number used for reconciliation. Some Home Oil taxes are basis-specific (road taxes only on gasoline etc.) — admin can override `allocated_tax` manually after parse if needed. v2 enhancement: basis-aware allocator that reads each tax line's "Basis" column.

---

## What's outstanding

### Near-term

- **Operator smoke test of `/fueling/supply`.** The form is now stripped to essentials (date / team / destination / fuel type / gallons / notes). Submit one entry to confirm RLS + the per-form team-member filter actually trims the dropdown to the assigned subset.
- **Operator smoke test of `/admin → Fuel Log → Bills`.** Upload a recent Home Oil bill PDF and confirm the parser extracts invoice/delivery date, BOL, line items, tax block, invoice total. Edit any field that came through wrong before save. Verify the PDF round-trips through the signed-URL viewer.
- **Reconciliation review** once a few months of bills are uploaded. Variance > 5% should trigger a check (operator under-logged, bill double-counted, etc.). For 2026-04 specifically: there are no bills yet, so the reconciliation table just shows historical supplies on the right side.
- **Equipment Attention tuning.** As of end-of-session there are real items in the section (overdue intervals across the fleet, per-piece fillup streaks for items recently skipped). Watch how operators react to the always-visible queue in the first week — too noisy / too quiet, etc.
- **Tax-allocation basis awareness for fuel bills (v2).** Today's parser does proportional-by-gallons. The Home Oil PDF format itemizes each tax with a "Basis" column (gallons of gas, gallons of diesel, all gallons, or $ subtotal). A smarter allocator could read those bases and assign each tax line to the correct fuel type. Probably tabled until you have 5+ bills to verify the parser against multiple months.

### Deferred / roadmap (older items, mostly unchanged)

- **More Podio app imports** still pending — animal dailys + breeding records workspaces. All pitfalls in PROJECT.md §7 apply, plus the new ones above.
- **Per-head cattle cost rollup** (feed + processing per cow).
- **Pig FCR cache** — write a `parent.fcrCached` value when a trip is added.
- **Cattle modal cleanup** in `CattleHerdsView.jsx` — dead modal code from before the inline-edit refactor.
- **Equipment dashboard rollup** is now mostly done via the action-based Equipment Attention section, but you could add a "service due in next 50h" preview to the home dashboard (one-off vs the existing "overdue" list).
- **DNA test PDF parser, weather API, TypeScript, test suite, ESLint, full router migration, app_store→dedicated tables, sheep Phase 2** — all unchanged.

---

## Things I wish I knew at the start of today's session

1. **`syncWebformConfig` was the actual reason team-member admin saves kept reverting.** Spent an hour on the FuelSupplyAdminSection's local state pattern + adding read-fresh-then-write logic before realizing `syncWebformConfig` was the upstream culprit overwriting the master and the per-form jsonb on every page load. Should have grepped for ALL `webform_config.upsert(...team_members)` write sites at the first sign of "saved data reverting after refresh."

2. **Home Oil isn't the only fuel-bill format.** Built the parser with Home Oil patterns hardcoded (description regex, "Net" basis literal, tax-block boundaries). Other suppliers will need their own patterns. The parser returns per-line warnings for any unmatched field, so admin gets a clear signal when a bill format doesn't fit — but if Ronnie has multiple suppliers, the parser will need to gain format detection on the supplier name.

3. **Photo coverage on Honda ATV-2 was 0 for a reason — but not the obvious reason.** First instinct was "ATV photos weren't pulled." Actual cause: dedup merged Fuel Log + Checklist pairs into single rows, kept Fuel Log's `podio_item_id` as the row's id, and the upload script only matched by `podio_item_id` — so photos attached to the dropped Checklist items had no target. Required a separate audit script to diagnose, then a (equipment_id, date) matcher to fix. Two separate bugs that looked like one.

4. **Snap-to-nearest milestone with tie-break-favoring-previous is the right model, but it's not obvious without walking through the parts-arrival scenario.** Initially proposed a tolerance-window approach (±10% of interval) before realizing snap-to-nearest is cleaner, has no magic number, and naturally handles late completions identically to early ones. The 968h-on-500hr scenario was the unlocker.

5. **Optimistic toggles save more than UX time.** The reload-after-save pattern made the expanded fueling row collapse on every checklist click — Ronnie hit it immediately. Fixing it requires either a local patches Map (what we did) or a server-side push for changes (overkill). Default to optimistic for any edit on a row that's expanded/in-context.

6. **The streak feature audit before deployment was the right move.** Initial fear was "all 168 every-fillup items will pop with retroactive streak warnings on day 1." Audit script said no — only 7 short streaks fleet-wide. Shipped without a date cutoff. Validated the "look at the data first, decide policy second" instinct vs hard-coded conservative defaults.

---

## Key repo facts (carryover from prior sessions)

- Working dir: `C:\Users\Ronni\WCF-planner` (Windows 11, Git Bash — use `/c/Users/...` or forward slashes; backslashes get eaten).
- Single Vite app, entry `src/main.jsx`. 60+ extracted components.
- Supabase is the only backend. Migrations under `supabase-migrations/NNN_*.sql` — **Ronnie applies these manually in the SQL Editor**, you cannot run them. Ask, wait for confirmation, then run any patch scripts that depend on them.
- Production deploys from `main` to Netlify (free tier on Farm Team account) automatically on push. Watch build minutes if pushing frequently.
- Equipment module schema is in migrations **016 through 026** as of end of 2026-04-25. All applied.
- Podio dump lives in `scripts/podio_equipment_dump/` — 17 `config.json` + `items.json` pairs + `_summary.json` + `photos/` dir + `_photos_index.json` (599 entries). Treat as read-only source of truth.
- Equipment slugs (active): `5065`, `ps100`, `honda-atv-1..4`, `hijet-2018`, `hijet-2020`, `toro`, `ventrac`, `gehl`, `l328`, `mini-ex`, `gyro-trac`, `c362` (15 with checklist apps) + `great-plains-drill` (active but no checklist). Sold (status='sold'): `jd-317`, `jd-333`, `jd-gator`, `kubota-rtv`, `polaris-ranger`.
- Diagnostic + patch scripts (all in `scripts/`):
  - `inspect_equipment_state.cjs` — each piece's intervals + fillup count + stale counters
  - `audit_equipment_ticks_and_oil.cjs` — tick-import + Check Oil master audit
  - `audit_fillup_streaks.cjs` (NEW) — fleet audit of every-fillup miss streaks (read-only)
  - `audit_planner_vs_podio_webforms.cjs` — diff planner state vs Podio webform snapshot
  - `audit_ventrac_attachments.cjs` — Ventrac attachment_checklists vs dump
  - `patch_dedup_fueling_pairs.cjs` — dedup duplicate rows (idempotent)
  - `patch_scrub_fuel_log_only.cjs` — delete Fuel Log orphans (source-based, safe only if dedup has properly updated source labels)
  - `patch_scrub_empty_checklists.cjs` — alternative content-based scrub
  - `patch_restore_missing_checklists.cjs` — list Podio Checklist items missing from planner
  - `patch_upload_equipment_documents.cjs` — upload local PDFs from photo-pull to Supabase + link to equipment
  - `patch_relink_photos_by_date.cjs` (NEW) — re-link photos to fuelings by (equipment_id, date) instead of `podio_item_id`. Idempotent.
- Auto-memory files at `C:\Users\Ronni\.claude\projects\C--Users-Ronni-WCF-planner\memory\`. Read `MEMORY.md` first turn.

---

## Ronnie's working style (reminders)

- **Multi-choice via `AskUserQuestion`**, not inline prose. He scans buttons faster than paragraphs.
- **Never assume.** Ask if scope is ambiguous.
- **Ask, build, wait for commit approval, commit, wait for push approval, push.** Each step gated EXCEPT when he says "commit and push" in the same turn — then it's green-lit for both.
- **Be honest about mistakes.** Especially when you ship a bug or burn data.
- **No purple in the UI.** Standing rule.
- **`/equipment` + `/fueling` URL paths are printed on materials in the field** — don't rename.

---

## Copy-paste prompt for next session

```
Read PROJECT.md top to bottom, with extra attention to §1 SOP, §7 don't-touch, and the 2026-04-25 row in §Part 4. Then read HANDOFF_NEXT_SESSION.md — it has the full picture of what shipped 2026-04-25 plus the new pitfalls around milestone math, syncWebformConfig, and photo→fueling matching.

Context in one paragraph: yesterday was an equipment-math overhaul plus the bill side of fuel reconciliation. Snap-to-nearest milestone math now drives every "next due" calculation. Cumulative-partial union model means maintenance can span sessions toward the same milestone. /admin → Fuel Log gained Bills + Reconciliation tabs (Home Oil PDF parser via lazy-loaded pdfjs-dist). /fueling/supply replaced /fuel-supply as the canonical fuel-supply URL. Home dashboard's Equipment Attention is now action-based (per-overdue-interval rows + per-piece every-fillup streak summaries). Editable historical checklists on /equipment/<slug> (click any sub-task in an expanded row to toggle in place; ✕ Remove on each interval entry deletes that one entry without nuking the row). Photo lightbox + per-row chips on the same page. Photo coverage went 48 → 167 fuelings linked via patch_relink_photos_by_date.cjs. Two race-condition bugs in the Fuel Supply admin team-member CRUD got fixed (read-fresh-then-write + syncWebformConfig merge-not-replace).

I'm Ronnie — farm owner, admin. Use the AskUserQuestion tool for any clarifying question (multi-choice pop-out boxes, not inline prose). Don't ask questions already answered in HANDOFF or PROJECT. Don't assume — ask if scope is ambiguous. Never commit, push, or deploy without my explicit approval in the current turn; "commit and push" in the same turn is one approval covering both. No purple in the UI.

Top-priority items to pick up when I'm ready:

1. Smoke-test the new /fueling/supply form — submit one entry and confirm the per-form team filter trims the dropdown.

2. Smoke-test /admin → Fuel Log → Bills with a real Home Oil PDF. The parser is built for that format. Other suppliers will likely need their own patterns; admin can edit fields after parse before save if needed.

3. Bring over more Podio apps. I'll tell you which. READ the new pitfalls section in HANDOFF and the don't-touch list in PROJECT §7 — especially the snap-to-nearest, cumulative-partial, divisor-cascade-uses-raw-reading, and (equipment_id, date) photo-link rules. They're load-bearing.

Start by asking me (multi-choice) whether you should: (a) walk through the smoke tests, (b) start on a specific Podio app I'll name, or (c) handle an operational issue I'll describe.
```
