# DECISIONS.md

This file records design decisions for the WCF Planner with full rationale, so future sessions don't relitigate them. Each entry is dated, states what was decided, and explains why alternatives were rejected.

---

## 2026-04-12 — Add Feed Webform

### Status
**Designed and locked. Not yet built. Ready to execute in a fresh Claude Code session.**

Note: An earlier attempt at this feature was built during the design session in a scratch file but was never deployed and contained broken merge logic. Discard any scratch artifacts. The live `index.html` (the one in this repo) does NOT contain any AddFeedWebform code yet. Build from scratch per this spec.

### What it is
A new public webform at hash route `#addfeed` (no auth, like `#webforms`) that lets field workers quickly log feed added to a pig, broiler, or layer batch without filling out a full daily report. Component name: `AddFeedWebform`. Lives inside `index.html` like every other component.

### The locked design (read this first)

**Add Feed inserts a brand-new row into the appropriate `*_dailys` table** (`layer_dailys`, `poultry_dailys`, or `pig_dailys`). The row has only the feed-related fields populated:
- `id`, `submitted_at`, `date`, `team_member`, `batch_label`, `batch_id` (layer only), `feed_lbs`, `feed_type` (NOT pig), `source: 'add_feed_webform'`
- All other observation fields (`mortality_count`, `layer_count`, `pig_count`, `group_moved`, `waterer_checked`, `comments`, etc.) are left **null** or omitted entirely.

**It does NOT mutate any existing daily report row.** It does NOT merge. It does NOT check for collisions. It just inserts a fresh row and walks away.

**This works because all 16 feed-aggregation sites in the planner sum across rows by `(batch_label, date)` using `.reduce`** (verified — see Verified Facts section below). Multiple rows per batch+date are already the norm. The new Add Feed row is automatically picked up by every existing total, average, cost-per-dozen, feed-per-hen, and dashboard tile, with zero changes to any calculation code.

**Add Feed entries are visually badged in the existing Reports lists** of `LayerDailysView`, `PoultryDailysView` (broiler), and `PigDailysView`. A 🌾 badge or distinct row styling identifies them when `source === 'add_feed_webform'`.

**The existing edit modals conditionally hide fields** when `source === 'add_feed_webform'`. Only date / batch / team_member / feed_lbs / feed_type (no feed_type for pig) are shown. Mortality, counts, checks, comments are hidden so users can't accidentally turn an Add Feed row into a frankenrow.

**A tri-state filter chip** at the top of each Reports list — "All / Daily Reports / Add Feed" — filters by source. This replaces the originally-planned dedicated Feed Log tab.

**An in-planner "🌾 Add Feed" button** on each dailys view opens the same form as the public webform (modal version, or just navigates to `#addfeed`). This is item 5 in build steps and is a stretch goal — admins can use the public form via `#addfeed` until this is built.

### Form flow (UI spec)

1. Date picker, defaulting to today.
2. Three large icon buttons: 🐷 Pig, 🐔 Broiler, 🥚 Layer.
3. After picking a program, an active-batch dropdown appears, sourced from `webform_config`:
   - Layer → `housing_batch_map` (keys are housing names; values are batch IDs)
   - Broiler → `broiler_groups`
   - Pig → `active_groups`
4. Feed type buttons (Layer: STARTER/GROWER/LAYER, Broiler: STARTER/GROWER, Pig: none — no feed_type column).
5. Lbs number input.
6. Optional team member dropdown from `webform_config.team_members` (or `per_form_team_members['add-feed-webform']` once admin panel is updated; until then fall back to global `team_members`).
7. Submit button.
8. Subheader note at top of form: "For quick feed logging only. For full daily reports including mortality and care checks, use the Daily Report forms."
9. After successful submit, show a confirmation screen with a "Log another" button that resets state, plus a "Done" button that returns to `#webforms`.

### Wiring/integration

- Add `'addfeed'` to the `VALID_VIEWS` whitelist (around line 2156 in the original `index.html`).
- Add a hash check `if(h==='#addfeed'||h==='#/addfeed') return 'addfeed';` in the router (around line 1934).
- Add a public-bypass entry: `if(view==="addfeed") return React.createElement(AddFeedWebform, {sb});` near the existing `#webforms` bypass (around line 2877).
- Add a prominent amber 🌾 Add Feed card at the TOP of `WebformHub` (around line 1189), above the daily report cards. Full-width, amber background `#fef3c7`, text `#92400e`, large 🌾 icon, big tap target. Three lines: "🌾 Add Feed" / "Quick log feed added in the field" / "Pig · Broiler · Layer". Tap navigates to `#addfeed`. Don't touch existing daily report cards.

### Rationale: why this design and not the others we considered

We went through three rejected designs before landing here. Future sessions must NOT re-propose these without reading why they were rejected:

**Rejected #1: Merge logic on the dailys row.** Original spec had Add Feed look up an existing dailys row for that batch+date, increment its `feed_lbs`, and handle feed_type collisions (insert new row if feed_type differs, update if same/empty). **Why rejected:** Multiple daily reports per batch+date are normal in this app — the existing webform just `.insert()`s a fresh row every submit, no upsert. So "find the existing row to mutate" has no unique answer when there are 2+ rows for the same batch+date. The mutate-row plan would silently pick an arbitrary row, and any later edit to morning vs evening reports could overwrite or double-count. Brittle.

**Rejected #2: Separate `feed_edit_log` ledger table.** Proposed a parallel audit table with its own row per Add Feed submission, linked to the dailys row via `daily_report_id`. The dailys row's `feed_lbs` would still be mutated, the ledger preserved the audit trail, and orphan handling covered the case where Add Feed ran with no matching daily report. **Why rejected:** The "mutate the dailys row" half of this still had the multi-row problem. And once you stop mutating the dailys row, the ledger becomes redundant — the dailys row IS the audit trail, distinguished by `source`. The `feed_edit_log` table was created and then dropped during the design session.

**Rejected #3: Dedicated Feed Log tab in each dailys view.** Initially planned as `Reports | Add Feed Log` tabs side by side. **Why rejected:** Once Add Feed entries are just badged dailys rows, a separate tab is duplicate UI. A filter chip on the existing Reports list gives the same audit-scanning capability with one small UI control instead of a parallel tab + parallel edit modal + parallel list rendering.

**Why the chosen design wins:** Zero changes to calculation infrastructure. No orphan handling needed (Add Feed always creates a complete row). No new tables. No new modals. No multi-row ambiguity. The constraints on editing (lbs + feed_type only) are enforced via conditional rendering in the existing edit modal, which is ~5-10 lines per modal, not a new component. Smallest possible footprint, maximum reuse, fully consistent with the "preserve existing infrastructure" requirement.

### Verified facts (do not re-verify)

These were checked via grep, code reading, and direct SQL during the design session.

1. **All 16 feed-aggregation sites use `.reduce((s,d) => s + (parseFloat(d.feed_lbs) || 0), 0)` over filtered row arrays** — verified by grep. None assume one row per batch+date. Locations in original `index.html` (no AddFeedWebform code): around lines 2812, 2813, 4008, 4043, 4629, 4696, 4697, 4760, 4761, 5216, 6027, 6033, 7485, 7486, 8220, 9783.
2. **No code anywhere filters dailys rows by `source`** — verified by grep. Adding the column is invisible to all existing logic.
3. **The existing public daily report webforms use plain `.insert()` with no conflict check** (around lines 1598 broiler, 1628 layer, 1662 pig). Duplicate rows for same batch+date are normal. This is why aggregation uses `.reduce`.
4. **`source` column added to all three dailys tables** via `ALTER TABLE ... ADD COLUMN IF NOT EXISTS source TEXT;`. Verified present via `information_schema.columns` query. Nullable, no default. Existing rows have null. Add Feed rows write `'add_feed_webform'`.
5. **`feed_edit_log` table was created and then dropped during the design session.** It does not exist. Do not reference it.
6. **`pig_dailys` has NO `feed_type` column.** Verified via column listing. Pig daily reports don't track feed type. The Add Feed insert for pig must omit `feed_type` from the insert object entirely (passing `null` will fail because the column doesn't exist). Layer and broiler both have `feed_type`.
7. **`layer_dailys`, `poultry_dailys`, and `pig_dailys` all have:** `id`, `batch_label`, `batch_id`, `date`, `feed_lbs`, `submitted_at`, `team_member`, `source`. Plus `feed_type` for layer and poultry only.
8. **`webform_config.team_members`** is a flat array of strings: `["BMAN","BRIAN","JENNY","JOSH","MAK","RONNIE","SIMON"]`.
9. **`webform_config.per_form_team_members`** is `{ "egg-dailys": [...], "pig-dailys": [...], "layer-dailys": [...], "broiler-dailys": [...] }`. There is NO entry for the Add Feed form yet — admin panel update needed (deferred, see below).
10. **`webform_config.housing_batch_map`** shape was not directly verified by query but is used in the existing WebformHub code as `{ housingName: batchId }` flat object. The `setHousingBatchMap` and `resolveBatchId` helpers in the existing code confirm this shape.

### SQL already run during design (do not re-run)

```sql
-- Added source column to all three dailys tables
ALTER TABLE layer_dailys ADD COLUMN IF NOT EXISTS source TEXT;
ALTER TABLE poultry_dailys ADD COLUMN IF NOT EXISTS source TEXT;
ALTER TABLE pig_dailys ADD COLUMN IF NOT EXISTS source TEXT;

-- Created and then dropped the abandoned ledger table
CREATE TABLE feed_edit_log (...);  -- created
DROP TABLE IF EXISTS feed_edit_log;  -- and dropped, doesn't exist
```

### Build steps (execute in order in a fresh Claude Code session)

**Item 1: Build the AddFeedWebform component from scratch.** Insert it just before the `WebformHub` component declaration. Component receives `{sb}` as props (uses the global anon Supabase client passed in). Loads config from `webform_config` keys: `housing_batch_map`, `broiler_groups`, `active_groups`, `team_members`, `per_form_team_members`. Renders the form flow described above. Submit handler builds a record object and calls `.insert()` on the appropriate dailys table — no lookups, no merges, no collision handling. Pig branch must build the record object WITHOUT `feed_type` at all (do not pass null). The id should be generated the same way the existing webforms do it: `String(Date.now())+Math.random().toString(36).slice(2,6)`. Always set `submitted_at: new Date().toISOString()` and `source: 'add_feed_webform'`. Leave all other columns out of the insert object.

**Item 2: Wire the routing.** Add `#addfeed` hash check to router, add `'addfeed'` to `VALID_VIEWS`, add public bypass for `view==="addfeed"`, add the amber 🌾 Add Feed card at the top of WebformHub.

**Item 3: Badge Add Feed rows in the three Reports lists.** Find `LayerDailysView`, `PoultryDailysView`, `PigDailysView`. Locate where each renders its row list. Add a 🌾 badge or amber tint when `row.source === 'add_feed_webform'`. Keep the badge subtle and consistent across all three views.

**Item 4: Filter chip on each Reports list.** Add a tri-state filter at the top of each Reports list: `[All] [Daily Reports] [Add Feed]`. State: `useState('all')`. Filter logic: `all` = no filter, `daily` = `r.source !== 'add_feed_webform'`, `addfeed` = `r.source === 'add_feed_webform'`. Match the existing styling of any filter controls already in those views.

**Item 5: Conditional field hiding in the edit modals.** Find each dailys view's edit modal. When the row being edited has `source === 'add_feed_webform'`, hide every field except: date, batch, team_member, feed_lbs, feed_type (and skip feed_type for pig — pig doesn't have it anyway). Be careful not to break existing edit functionality for normal daily reports. Re-view each modal IMMEDIATELY before editing — any successful str_replace on a modal invalidates earlier views of that file. Add a small banner at the top of the modal: "🌾 Add Feed entry — only feed fields are editable. To change anything else, delete and recreate."

**Item 6 (stretch goal): In-planner "🌾 Add Feed" button on each dailys view.** Renders the AddFeedWebform inside a modal, or simpler, navigates to `#addfeed`. Skip if running low on context.

**Item 7 (separate session): Admin panel update.** The webform admin panel manages per-form team members via `webform_config.per_form_team_members`. There's no entry for the Add Feed form yet. Add one with id `add-feed-webform` so admins can manage which team members appear in the Add Feed dropdown. Until this is done, AddFeedWebform falls back to the global `team_members` config key (all 7 names), which works fine — just not per-form-customizable. **This is its own session because the admin panel hasn't been read yet and scope is unknown.**

### Open questions / gotchas

- The `housingBatchMap` shape was not directly SQL-verified (the SELECT returned no data). Existing code treats it as `{ housingName: batchId }` and that's what AddFeedWebform should assume. If layer batch_id resolution misbehaves at runtime, this is the first place to look.
- After items 1-2, deploy and test with a real Add Feed submission for each program before proceeding to items 3-5. Verify the row appears in `*_dailys` with `source='add_feed_webform'` and that all existing aggregation totals correctly include it.
- Item 5 (edit modal field hiding) is the riskiest item because it touches existing edit code paths. Test existing edits still work after the change.
- The `source` column being null on existing rows means filter logic must handle null correctly. `r.source !== 'add_feed_webform'` works correctly for null (returns true). `r.source === 'add_feed_webform'` also works correctly for null (returns false). No null guard needed.
- No unicode in JSX template literals — use `\u` escapes in JS strings or `{'\u2014'}` in JSX text where needed (em-dash, etc).

### Definition of done

Items 1-5 complete. Public Add Feed webform submits real rows to the dailys tables. Those rows show up badged in the Reports lists. Filter chip works. Edit modal hides irrelevant fields when editing an Add Feed row. Existing daily report functionality is unchanged. All existing feed totals include Add Feed rows automatically. Admin panel update (item 7) tracked separately. In-planner Add Feed button (item 6) tracked as nice-to-have.

---
