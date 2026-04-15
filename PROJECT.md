**WCF PLANNER**

White Creek Farm

*Comprehensive System Handover Document*

Updated April 13, 2026

---

# 1. How to Start a New Session

1. Read this document top to bottom.
2. Ask Ronnie what he wants to work on — don't assume.
3. Read the relevant section(s) of `index.html` before writing any code.
4. Check the "Open Items" section for pending work.

### Deployment SOP — NEVER skip (added April 15, 2026)

**NEVER run `git commit`, `git push`, or any deploy command without explicit user approval in the current session turn.**

- Approval for one change does NOT imply approval for subsequent changes.
- After completing code changes, pause and show Ronnie a summary of what was modified before asking for commit approval.
- If Ronnie says "make change X," make the change and wait — do not commit.
- If Ronnie says "commit and deploy X," do it for X only.
- Background agents and worktrees follow the same rule — no commits without explicit approval.

### Ronnie's Working Style

- Ask lots of questions before building. Never jump into code without fully understanding scope.
- When scope is large, map out the FULL design, confirm it, then build in phases.
- Never assume. If something is ambiguous, ask.
- Be honest about mistakes. Ronnie notices when Claude confirms things without checking the code.
- No purple colors anywhere in the UI.
- Prefers bulletproof over fast. No shortcuts.
- "We don't spare any expense for tokens" — read the full file if needed, don't skim.

### Critical Codebase Constraints

- **Single file app**: Everything is in `index.html` (~11,280 lines). All React, CSS, and JS live in it. No npm, no bundler, no separate CSS.
- **Babel in-browser transpiler**: No special characters in JSX template literals. Use `\u` escapes (e.g. `'\u00b7'` for ·). Never use `const {useState} = React` destructuring in standalone components near App — use `React.useState()` directly.
- **const/let inside conditional blocks CAN CRASH**: The `if(view==="...")` blocks inside App's render are technically block scope. `const` and `let` inside them may work in function bodies but `var` is safer inside conditional blocks and nested `if/else` within those blocks. The pig feed tab crashed because `const` was used inside an `if(inv)` block within the `if(view==="pigs")` block. When in doubt, use `var`.
- **React hooks rules**: Never put `React.useRef()` or `React.useState()` inside conditional blocks. Always at top level of the component function.
- **Deploy = push to GitHub** → Netlify auto-deploys. After deploy, user must clear localStorage + hard refresh (Ctrl+Shift+R).
- **Babel cache**: Stored in localStorage with keys starting `wcf-babel-`. After editing the file locally, the user must clear these keys or all of localStorage before refreshing. The cache key includes a source hash, so it auto-invalidates on deploy, but local edits may confuse it.
- **Hash navigation** between public and authenticated views requires `window.location.reload()` after setting the hash. React's router only reads the hash on mount.

### Deployment Process

1. `git add index.html && git commit -m "message" && git push`
2. Netlify auto-deploys from the repo
3. User: clear localStorage + hard refresh (Ctrl+Shift+R)
4. Sign out and sign back in if Supabase session is stale

---

# 2. Infrastructure

### Hosting & Domain

| Service | Details |
|---|---|
| Live URL | https://wcfplanner.com |
| Hosting | Netlify — Farm Team account |
| Deploy method | Auto-deploy from GitHub main branch |
| Repo | https://github.com/byronronniejones-lab/WCF-planner |

### Supabase

| Item | Value |
|---|---|
| Project URL | https://pzfujbjtayhkdlxiblwe.supabase.co |
| Anon Key | In index.html line ~213 |
| Admin email | ronnie@whitecreek.farm |

### Tech Stack

- React 18 (CDN, Babel in-browser transpiler — no build step)
- Supabase JS v2 (auth, database, storage, edge functions)
- SheetJS/XLSX (Excel parsing, lazy-loaded on first use)
- Single `index.html` file (~11,280 lines)
- No npm, no bundler, no separate CSS files
- Geist font from Google Fonts

---

# 3. Database Schema

### Tables

| Table | Purpose |
|---|---|
| app_store | Main JSON blob store — all non-daily data. Key-value with `key` (text) and `data` (jsonb). |
| webform_config | Config for public webforms (anon-accessible RLS). Key-value same shape. |
| poultry_dailys | Broiler daily reports. Has `source` column (TEXT, nullable). |
| layer_dailys | Layer daily reports. Has `source` column (TEXT, nullable). |
| egg_dailys | Egg collection reports. |
| pig_dailys | Pig daily reports. Has `source` column (TEXT, nullable). NO `feed_type` column. |
| layer_batches | Layer batch parent records (dedicated table, not in app_store). |
| layer_housings | Layer housing records with `current_count` anchor model (dedicated table). |
| profiles | User profiles + roles (farm_team, management, admin, inactive). |
| batch-documents | Supabase Storage bucket for file attachments on broiler batches. |

### app_store Keys

| Key | Contents |
|---|---|
| ppp-v4 | Broiler batches array |
| ppp-layer-groups-v1 | Layer groups array (legacy, being replaced by layer_batches/layer_housings) |
| ppp-webforms-v1 | Webform configuration (includes Add Feed webform entry) |
| ppp-feeders-v1 | Pig feeder groups / batches with sub-batches and processing trips |
| ppp-pigs-v1 | Pig sow/boar count data |
| ppp-breeding-v1 | Breeding cycle records |
| ppp-farrowing-v1 | Farrowing records (initialized from INITIAL_FARROWING constant) |
| ppp-breeders-v1 | Breeding pig registry (initialized from INITIAL_BREEDERS constant) |
| ppp-boars-v1 | Boar names mapping |
| ppp-breed-options-v1 | Breed dropdown options |
| ppp-origin-options-v1 | Origin dropdown options |
| ppp-feed-costs-v1 | Feed cost per lb: `{starter, grower, layer, pig, grit}` |
| ppp-feed-orders-v1 | Feed orders by month: `{pig:{}, starter:{}, grower:{}, layerfeed:{}}` |
| ppp-pig-feed-inventory-v1 | Pig physical feed count: `{count, date}` or null |
| ppp-poultry-feed-inventory-v1 | Poultry physical counts: `{starter:{count,date}, grower:{count,date}, layer:{count,date}}` |
| ppp-broiler-notes-v1 | Broiler section notes |
| ppp-pig-notes-v1 | Pig section notes |
| ppp-layer-notes-v1 | Layer section notes |
| ppp-missed-cleared-v1 | Cleared missed-report alerts (Set serialized as array) |
| ppp-archived-sows-v1 | Archived sow records |

### webform_config Keys

| Key | Contents |
|---|---|
| full_config | Full webform config — webforms array, teamMembers, broilerGroups, layerGroups |
| broiler_groups | Active broiler batch names (array of strings) |
| active_groups | Active pig group names (array of strings) |
| team_members | All team member names (flat array) |
| per_form_team_members | Team members per form ID: `{"pig-dailys":[...],"add-feed-webform":[...]}` |
| webform_settings | `{allowAddGroup: {"pig-dailys": true, ...}}` |
| housing_batch_map | Maps housing name → batch NAME: `{"Eggmobile 2": "L-26-01"}`. NOT batch ID. |
| layer_groups | Active layer group names |

---

# 4. Application Architecture

### File Structure (Current Line Numbers — Approximate)

| Lines | Section |
|---|---|
| 1-120 | HTML head, CSS styles, webform styles, print styles |
| 125-182 | Babel transpile cache, lazy XLSX loader |
| 183-208 | Boot loader spinner, `<div id="root">` |
| 209-233 | Supabase client init, email helper |
| 236-268 | Broiler feed constants (CC/WR schedules, starter/grower splits) |
| 269-317 | `getFeedSchedule()`, `calcBatchFeed()`, `calcBatchFeedForMonth()` |
| 319-394 | Layer feed schedule, `calcLayerFeedForMonth()` |
| 396-515 | Hatcheries, schooners, brooders, pig breeding constants, timeline calculators, auto-status |
| 516-533 | INITIAL_BREEDERS, INITIAL_FARROWING hardcoded data |
| 534-593 | Resources, batch color palette, `getBatchColor()` |
| 595-685 | Layer housing helpers: `setHousingAnchorFromReport()`, `computeProjectedCount()`, `computeLayerFeedCost()` |
| 687-843 | Status/breed styles, date helpers, holiday logic, `calcTimeline()`, `detectConflicts()` |
| 845-866 | EMPTY_FORM for broiler batches |
| 868-942 | `LoginScreen` component |
| 945-1065 | DEFAULT_WEBFORMS_CONFIG, styles object `S`, permission helpers |
| 1074-1263 | `UsersModal` component |
| 1271-1542 | `AddFeedWebform` component (public, `#addfeed` route) |
| 1545-2196 | `WebformHub` component (public daily report forms — broiler, layer, pig, egg) |
| 2198-2256 | `FeedCostsPanel` component |
| 2260-2284 | `DeleteModal` component |
| 2287-2447 | `App()` function start — all state declarations (~160 useState calls) |
| 2450-2693 | Auth listener, `loadAllData()`, data loading from Supabase |
| 2695-2920 | Persist helpers, `syncWebformConfig()`, backup/restore |
| 2923-3158 | Broiler form helpers: `upd()`, `openAdd()`, `openEdit()`, `submit()`, `del()` |
| 3160-3273 | Timeline helpers, derived values, `Header` component |
| 3276-3298 | Delete confirm modal, webform/auth bypasses |
| 3301-3739 | **Home Dashboard** — nav cards, animals on farm, missed reports, next 30 days, admin daily report tiles |
| 3742-4208 | **Broiler batch edit form** (modal overlay) |
| 4211-4494 | **Broiler Home Dashboard** — stats, active batch tracker, breed comparison, trends, financial summary |
| 4497-4731 | **Timeline view** (Gantt chart — broiler + layer bars) |
| 4734-4735 | BroilerDailysView / PigDailysView delegation |
| 4738-5048 | **Batch List view** — active table, comparison table, processed cards |
| 5050-5529 | **Poultry Feed tab** — ledger per feed type (starter/grower/layer), top summary table, monthly tiles, per-batch breakdown |
| 5530-6028 | **Pig Feed tab** — daily snapshot, on-hand/end-of-month/suggested-order cards, physical count, monthly ledger tiles, per-group breakdown |
| 6030-6336 | **Pigs Home Dashboard** — stats, pigs on farm, next farrowing, active batches, bar graphs |
| 6337-6648 | **Breeding Timeline** (Gantt chart) |
| 6649-7314 | **Pig Batches view** — feeder groups, sub-batches, processing trips |
| 7315-7859 | **Admin/Webforms view** — webform editor, field config, team members, feed costs panel |
| 7860-8331 | **Farrowing view** — records list, form, filters |
| 8332-8764 | **Sows/Breeding Pigs view** — registry, breeder forms, leaderboard |
| 8765-9033 | **Layers Home Dashboard** — stats, egg production, feed summary |
| 9034-9037 | LayersView, LayerBatchesView, LayerDailysView, EggDailysView delegation |
| 9038-9046 | App closing bracket + default return |
| 9047-9066 | WcfYN, WcfToggle standalone components |
| 9067-9382 | AdminAddReportModal (inline add daily report from admin) |
| 9383-9583 | **BroilerDailysView** standalone component |
| 9584-10448 | **LayerBatchesView** standalone component (with housing management) |
| 10449-10604 | **LayersView** standalone component (legacy layer groups) |
| 10605-10837 | **LayerDailysView** standalone component |
| 10838-11012 | **EggDailysView** standalone component |
| 11013-11219 | **PigDailysView** standalone component |
| 11220-11280 | ReactDOM.createRoot, Babel boot script |

### Navigation Views (VALID_VIEWS)

`home`, `broilerHome`, `pigsHome`, `layersHome`, `timeline`, `list`, `feed`, `pigs`, `breeding`, `pigbatches`, `farrowing`, `sows`, `webforms`, `webformhub`, `webform`, `broilerdailys`, `pigdailys`, `layers`, `layerbatches`, `layerdailys`, `eggdailys`, `addfeed`

Public (no auth): `webform`, `webformhub`, `addfeed`

### Key People

| Person | Role | Email |
|---|---|---|
| Ronnie Jones (Byron) | Admin / Owner | ronnie@whitecreek.farm |
| Mak | Management | mak@whitecreek.farm |
| Simon | Farm Team | Simon.rosa3@gmail.com |
| Josh | Farm Team | — |
| Jenny | Farm Team | — |

---

# 5. Feed System (Pig & Poultry) — Detailed

This is the most recently built and actively evolving part of the app. Read carefully.

### Data Model

Feed orders stored in `ppp-feed-orders-v1`:
```json
{
  "pig": { "2025-10": 13900, "2025-11": 10000, ... },
  "starter": { "2025-10": 3950, ... },
  "grower": { "2025-10": 23950, ... },
  "layerfeed": { "2025-10": 0, ... }
}
```

Physical count stored in `ppp-pig-feed-inventory-v1` (pig) and `ppp-poultry-feed-inventory-v1` (poultry).

### Order Timing Model

**Orders arrive at the END of the month.** This means:
- The current month's order has NOT arrived yet (mid-month).
- "Actual On Hand" = orders from past months only minus consumption since tracking started.
- "End of Month Estimate" = all orders through current month (including current month's arriving order) minus all consumption (actual + projected remaining days).
- "Suggested Order" for next month = next month's projected consumption minus end-of-month estimate.

### Tracking Start Date

Tracking starts from the **first month with any order entered** across all feed types for that program. Consumption before that month is ignored (pre-tracking). For poultry, the first order in ANY of starter/grower/layerfeed triggers tracking for ALL three types.

### Running Inventory Ledger (Monthly Tiles)

Both pig and poultry feed tabs use a forward-pass ledger:
```
START OF MONTH = previous month's END (or 0 for first tracking month)
CONSUMED = actual (past months) | actual + projected remaining (current) | projected (future)
ORDERED = entered amount (arrives end of month)
END OF MONTH = START - CONSUMED + ORDERED
```

Each month's START = previous month's END, creating a running balance.

### Physical Count

When entered, the physical count:
1. Becomes the new anchor — all calculations from that point forward use it as START.
2. Shows an adjustment badge: "Count adj +/- X" showing how far off the system estimate was.
3. End of Month and Suggested Order recalculate from the count-based anchor.
4. Only the latest count is stored (no history).

### Pig Feed Tab (view==="pigs")

**Top section**: 4 stat tiles (Today's Daily Need, Sows, Boars, Feeder Pigs) + 3 cards (Actual On Hand, End of Month Est., Order for [Next Month]) + Physical Count input.

**Projections**:
- Sows (non-nursing): 5 lbs/day
- Nursing sows: 12 lbs/day (calculated from farrowing records + breeding timelines)
- Boars: 5 lbs/day
- Feeder pigs: 1 lb/day per month of age

**Monthly tiles**: Ledger format (START/CONSUMED/ORDERED/END) + variance line (per-day and monthly, extrapolated for current month) + per-group breakdown table (Proj/day, Actual/day, Variance/day).

### Poultry Feed Tab (view==="feed")

**Top section**: Compact table with one row per feed type (Starter/Grower/Layer Feed), columns: On Hand, End of Mo Est., Order for [Next Month], Proj Need. + Physical Count input.

**Monthly tiles**: Ledger table per feed type (START/CONSUMED/ORDERED/END OF MO). No daily variance (bulk feeding causes huge swings that don't normalize until month end). No per-batch breakdown in tiles.

**Below tiles**: Broiler Feed Estimate Per Batch (collapsible) + Layer Feed Estimate Per Batch (collapsible). These show weekly feed schedules per batch.

---

# 6. Other Major Features

### Add Feed Webform (`#addfeed`)

Public form for quick feed logging. Inserts a new row into the appropriate `*_dailys` table with `source: 'add_feed_webform'`. Does NOT merge or mutate existing rows. All 16+ feed aggregation sites use `.reduce()` so multiple rows per batch+date work automatically.

- Admin-configurable via the webform editor (fields can be toggled, relabeled, marked required).
- Filter chips in Reports lists: All / Daily Reports / Add Feed.
- Edit modals hide non-feed fields when editing Add Feed rows.
- Pig inserts do NOT include `feed_type` (column doesn't exist on `pig_dailys`).

### Layer Housing Model

- `layer_batches` table stores batch-level data (name, original_count, feed cost rates, lifecycle dates).
- `layer_housings` table stores per-housing data (housing_name, batch_id, current_count anchor, start_date).
- `current_count` is a verified anchor from physical counts. Projected count = anchor minus mortalities since anchor date.
- The "Retirement Home" is a permanent pseudo-batch that never closes. Edit modal hides lifecycle fields.

### Broiler Batch System

- Batches stored in `ppp-v4` (app_store).
- Auto-status: planned → active → processed based on dates.
- Feed data: B-24-* batches use legacy manual fields; B-25+ batches pull from `poultry_dailys` (daily reports).
- Processing data: birds to processor, avg dressed weight, avg breast/thigh, whole/cuts lbs.
- Document attachments via Supabase Storage. Excel files auto-parsed for processor data.
- Batch color palette (24 colors) assigned by trailing batch number for visual distinction.

### Pig Breeding System

- Breeding cycles with timeline: Boar Exposure → Paddock → Farrowing → Weaning → Grow-out.
- Constants: 45-day exposure, 116-day gestation, 42-day weaning, 183-day grow-out.
- Farrowing records linked to cycles and sows.
- Feeder groups with sub-batches and processing trips.
- Breeding pig registry with tag numbers, weights, purchase info.

### Daily Reports / Webforms

- Public webforms at `#webforms` (no auth needed) for Broiler, Layer, Pig, and Egg daily reports.
- All forms have per-form team member config, admin-configurable required/optional fields.
- Add Group feature: submit multiple batch reports in one form submission.
- Conditional rules: feed_type required only when feed_lbs > 0; mortality_reason required only when mortality_count > 0.
- All delete actions use the type-"delete" confirmation modal (no `window.confirm`).

### Permissions

| Role | Can Do |
|---|---|
| farm_team | Edit + delete daily reports only |
| management | Edit anything, delete daily reports only |
| admin | Full access — edit and delete everything |

---

# 7. Conditional Field Rules (Apply to ALL Forms)

1. **Feed type** is only required when `feed_lbs > 0`. Enforced in `validateRequiredFields()` and explicit submit checks.
2. **Mortality reason** is hidden until `mortality_count > 0`, then required with red asterisk.
3. All delete actions use `DeleteModal` (type "delete" to confirm).

---

# 8. Design Preferences

- No purple colors
- Modals: centered overlays, not inline forms
- Auto-save with 1.5s debounce on edit forms; save on close
- Colored pills for yes/no fields, team members, comments
- Delete button only in modal footer when editing (no Done/Cancel with auto-save)
- Alternating colors on batch cards
- The pig feed tile layout is the model for all feed tab tiles

---

# 9. Open Items / Known Issues

### Feed System

- **Physical count not yet tested on live data.** The pig and poultry physical count systems are built but Ronnie hasn't done a real physical count yet. The adjustment calculation (system estimate vs actual count) needs real-world validation. Code reviewed for edge cases — handles count in current month, past month, and no count.

### General

- No major open items. All previously listed issues have been fixed (see section 10).

---

# 10. Lessons for Future Claude Sessions

### Mistakes Made and How to Avoid Them

1. **`inv.count` crash when `inv` is null.** The pig feed "On Hand" display tried to access `inv.count` when there was no physical count (inv=null) but feedOnHand was set from the orders-consumption path. Always check for null before accessing properties in display code, especially when multiple code paths can set the displayed value.

2. **Counting ALL consumption instead of from tracking start.** The original On Hand calculation counted consumption from the beginning of time but orders only started in October 2025. Result: hugely negative numbers. Fix: find the earliest order month and only count consumption from that month forward.

3. **Monthly variance comparing partial month actual vs full month projected.** Showing `actual_so_far - full_month_projected` mid-month produces misleading negative numbers. Fix: extrapolate the daily rate to a full month before comparing (or just show per-day variance).

4. **Combined totals across feed types are meaningless for poultry.** Starter, grower, and layer feed have completely different usage patterns and ordering. Showing a combined "Actual: 1,782/day" across all three types tells you nothing. Always show per-type metrics for poultry.

5. **const inside conditional blocks in Babel.** While technically valid JS, `const` inside `if(view===...)` blocks and especially nested `if/else` within those blocks can crash in this Babel setup. Use `var` for any variable declared inside conditional blocks. This bit us on the pig feed tab (`const` inside `if(inv)` inside `if(view==="pigs")`).

6. **Babel cache prevents seeing local changes.** After editing `index.html` locally, the browser serves the cached transpiled version. Must clear `wcf-babel-*` keys from localStorage before refreshing. Always remind the user.

7. **Poultry daily variance is useless.** Bulk feeding (filling bins and wagons) creates huge daily swings. A day with 3,000 lbs followed by days with 0 doesn't mean consumption changed. Only monthly totals are meaningful for poultry. Pig daily reports are more granular so daily variance works there.

### Issues Fixed April 13 Session

- **Feeder pig projections now subtract processed pigs.** `projectedDailyFeed()` and `projectedFeedByGroup()` both subtract `(g.processingTrips||[]).reduce(pigCount)` from `originalPigCount`. Previously over-projected for batches that had sent pigs to processing.
- **Layer batch_id now resolved in Add Feed webform.** The `full_config` layerGroups have `id` fields. AddFeedWebform builds a `layerBatchIdMap` from layerGroups + housing_batch_map to resolve `batch_id` from `batch_label`. No longer null.
- **syncWebformConfig race condition fixed.** Layer batches and housings from dedicated tables are now loaded with `Promise.all()` and syncWebformConfig is called AFTER they resolve, with the fresh data passed directly. Previously used `setTimeout` which could fire before async loads completed, resulting in empty `housing_batch_map`.
- **Supabase session auto-refresh on tab focus.** Added a `visibilitychange` listener that calls `sb.auth.getUser()` when the tab becomes visible. If the session has expired, it signs out cleanly instead of showing empty data.

### Architecture Patterns to Follow

- **Persist helpers**: Use `sbSave(key, value)` for app_store writes (has retry logic and timeout handling).
- **Dedicated tables vs app_store**: Daily reports use dedicated Supabase tables with RLS. Everything else uses app_store JSON blobs.
- **Standalone components**: BroilerDailysView, LayerBatchesView, LayerDailysView, EggDailysView, PigDailysView are standalone components defined outside App(). They receive props from App. This keeps App's render function manageable.
- **webform_config sync**: When data changes (batches, groups, team members), `syncWebformConfig()` pushes the latest data to the `webform_config` table so public webforms (no auth) can access it. Initial load now awaits layer data before syncing.

---

# 11. Session Update — April 13, 2026 (continued)

Everything below was built after the initial PROJECT.md was written earlier in the same session.

## What Was Built

### Feed Tab — Order Auto-Detect

The "Order for [Month]" tile/column no longer hard-switches on the 1st of each month. Instead it auto-detects whether the current month's order has been entered:

- **Pig**: If `feedOrders.pig[currentYM]` is non-null (including 0), it cycles to show next month.
- **Poultry**: ALL 3 types (starter, grower, layerfeed) must have a non-null entry for the current month before cycling. Entering `0` counts as "I decided not to order this type" and triggers the cycle.

This matches the real workflow — Ronnie places orders as late as the 5th of the month, not always on the 1st.

### Feed Tab — Two-Month Order Window

The suggested order now covers **two months** of projected consumption, not one. Rationale: if you order in May, it arrives end of May. You need it to cover May consumption (while waiting for delivery) AND June consumption (until June's order arrives end of June).

- Suggested order = max(0, (target month projected + month after projected) - carryover)
- The "Need thru [Month]" column/tile shows the two-month total with per-month breakdown.
- Carryover amount shown for context.

### Feed Tab — Physical Count End-of-Month Fix

When a physical count is in the current month, the current month's order is now included in the end-of-month estimate. Previously `e[0]>invYM` excluded it because `'2026-04' > '2026-04'` is false. Changed to `e[0]>=invYM` since orders arrive end of month (after any mid-month count).

### Feed Tab — Zero Order Input Fix

Entering `0` in an ordered field previously showed blank (the value binding `value||''` treated 0 as falsy). Fixed to use `value!=null&&value!==''?value:''` so `0` displays correctly.

### Feed Tab — Poultry Physical Count Display

The poultry top summary table now shows per-type:
- Physical count date under the On Hand value (e.g., "Count: Apr 13, 2026")
- Adjustment badge when count differs from system estimate ("Adj +/-X")

### Feed Tab — Pig Top Section Redesign

Removed the 4 daily snapshot tiles (Today's Daily Need, Sows, Boars, Feeder Pigs) — that data is redundant with the monthly tile's variance section. Replaced with 4 big tiles matching the dashboard style:
1. **Actual On Hand** — with count date and adjustment
2. **End of Month Est.** — with arriving order amount
3. **Order for [Month]** — auto-detected, with carryover
4. **Need thru [Month]** — two-month total with per-month breakdown

### Broiler Dashboard — Active Batch Cards

- Added **schooner badge** (e.g., "Sch 2&3") with `whiteSpace:'nowrap'` to prevent wrapping
- Added **Feed: Projected / Actual** section at bottom of each card showing Starter and Grower with variance in green/red

### Broiler Feed Estimate Per Batch — Restructured

The section on the Poultry Feed tab is now split into three groups:
1. **ACTIVE (N)** — always expanded
2. **PROCESSED (N)** — collapsible, newest first (sorted by processing date descending)
3. **PLANNED (N)** — collapsible

Each batch shows:
- Header: name, breed, schooner, hatch date, time on farm (Xw Xd), processed count (if applicable)
- Feed: Projected / Actual for Starter, Grower, Total with variance
- Weekly schedule table

### Pig Feed Projections — Processed Pigs Subtracted

`projectedDailyFeed()` and `projectedFeedByGroup()` now subtract processed pigs from `originalPigCount`:
```javascript
const processed = (g.processingTrips||[]).reduce((s,t) => s + (parseInt(t.pigCount)||0), 0);
const pigCount = Math.max(0, (parseInt(g.originalPigCount)||0) - processed);
```

### Poultry Daily Variance Removed

Removed per-type daily variance from poultry monthly tiles. Bulk feeding (filling bins/wagons in large amounts) creates huge daily swings that don't normalize until month end. Only monthly variance shown for poultry. Pig daily variance kept (more granular daily reporting).

### Pig Monthly Variance — Extrapolated for Current Month

Monthly variance for the current month now extrapolates: takes the actual daily rate, projects it over the full month, then compares to projection. Shows "est." suffix. Previously compared partial-month actual vs full-month projected = misleading.

### Per-Group Variance — Per-Day Rates

Pig feed monthly tile group breakdown now shows Proj/day, Actual/day, Variance/day instead of monthly totals. More useful for identifying which groups are over/under.

## Additional Lessons Learned

8. **`value||''` kills zero inputs.** Any controlled React input with `value={x||''}` will show blank when x=0. Use `value={x!=null&&x!==''?x:''}` to preserve zero as a valid displayed value.

9. **Auto-detect order cycling must treat 0 as "entered."** The original check `parseFloat(x)>0` meant entering 0 (deliberately not ordering) didn't trigger the cycle. Changed to `x!=null` — any non-null entry means the order decision was made.

10. **Physical count in current month needs same-month order included.** Orders arrive end of month, after any mid-month count. The end-of-month estimate must include the current month's order even when the physical count is in the same month. Use `>=` not `>` for the month comparison.

11. **Two-month order window matches real ordering cadence.** One-month lookahead showed "Surplus" when carryover covered the next month but not the month after. Since the order arrives at end of next month, you need it to cover two months of consumption from when you'd run out.

## Open Items

- **Physical count — real-world testing pending.** Ronnie entered counts for all feed types on Apr 13, 2026. Adjustment badges are showing. Monthly tiles show count-anchored calculations. Full validation will come over the next weeks as consumption accumulates against the counted baseline.
- **Cattle module** — research completed (comprehensive report on cattle tracking software). Waiting for Ronnie to upload Podio exports and PWA flow documentation before designing the data model and UI.

---

*End of April 13 Session*

---

# 12. Session Update — April 14, 2026

## What Was Built

### Egg Webform Group 1 Required Bug Fix (commit `4b6e02d`)

When submitting the egg collection form, Group 1 was flagged as missing even when filled. Root cause: `validateRequiredFields()` checks pair fields `group1_pair…group4_pair`, but `submitEgg()` didn't pass those values into `valuesByFieldId`. Fixed by computing a `grpFilled(name, count)` helper — a group pair counts as "filled" if either the group name OR the egg count was entered — and passing the resolved `'filled' | ''` value for each group.

Location: `submitEgg()` at index.html:1863-1886.

### Program Color Palette (commit `524b4c2`)

Applied Ronnie's internal color designations site-wide. Previously the app used broiler blue, pig purple, and layer amber in a mixed way. The new palette:

| Program | Primary | Medium | Bright | BG | Lightest | Border |
|---|---|---|---|---|---|---|
| **Broilers (yellow)** | `#a16207` | `#ca8a04` | `#eab308` | `#fef9c3` | `#fefce8` | `#fde047` |
| **Layers (brown)** | `#78350f` | `#92400e` | `#b45309` | `#fffbeb` | `#fef3c7` | `#fde68a` |
| **Pigs (blue)** | `#1e40af` | `#1e3a8a` | `#2563eb` | `#eff6ff` | `#dbeafe` | `#bfdbfe` |
| **Cattle (red)** | `#991b1b` | `#b91c1c` | `#dc2626` | `#fef2f2` | `#fee2e2` | `#fca5a5` |
| **Sheep (green)** | `#166534` | `#15803d` | `#16a34a` | `#f0fdf4` | `#dcfce7` | `#86efac` |

Cattle and sheep palettes are reserved for the upcoming modules — nothing in the current codebase uses them yet.

**AddFeedWebform** (public `#addfeed` form): rebranded from amber to farm green (`#085041`) since it is a shared program-agnostic entry point. Gradient, logo, submit button, info banner, "Log Another" button, "Add Another Group" dashed button, and back link all updated.

**Preserved palettes** (intentionally NOT touched):
- `BATCH_COLOR_PALETTE` (index.html:561-593) — 24-color rotation for timeline uniqueness
- Housing `batchColors` palettes (lines 9139, 9155, 10150, 10163) — 4-color rotation for visual variety of layer housings
- `fbColors`, lifecycle phase colors, STARTER/GROWER pill styling, and generic warning/success colors

**Pre-existing bugs also fixed during the swap**:
- Boar count pill in pig batches used broiler blue → now pig blue
- Boars section header in Sows view used broiler blue → now pig blue
- Total Hens stat on layers dashboard used broiler blue → now layer brown
- Layer batch age & "Original → Current" tiles used broiler blue → now layer brown
- Boar badge inside feeder sub-batch rows (line 7372) used broiler yellow → now pig blue

### Pig Breeding Cycle Auto-Labels (commit `3e1b76f`)

Every breeding cycle now has an auto-generated label in the format `Group N - YY-NN`. Examples: `Group 1 - 25-01`, `Group 3 - 25-02`, `Group 2 - 26-01`.

**Sequencing rules** (per Ronnie's spec):
- The `YY-NN` suffix is a **per-year global sequence** across ALL groups.
- First cycle to start in any year (by `exposureStart` ascending) gets `YY-01`, the next `YY-02`, etc.
- If Group 1 starts its first cycle Jan 3 and Group 3 starts Jan 10, Group 1 is `25-01` and Group 3 is `25-02`.
- If Group 1 starts a second cycle in the same year, it gets the next available number (e.g., `25-04`) — the sequence is time-ordered, not per-group.
- Retroactive: the suffix is computed from existing data, so all historical cycles get labeled automatically.

**Implementation** (index.html:456-481):
```javascript
function buildCycleSeqMap(cycles) { ... }   // { cycleId → "YY-NN" }
function cycleLabel(cycle, seqMap) { ... }  // "Group N - YY-NN"
```

**Display locations updated**:
- Breeding Timeline Gantt — bar label + hover tooltip
- Breeding cycles list (under the Gantt)
- Farrowing records — per-cycle section headers + missed-sow notices + history chips in the sow detail view
- Pig Batches — cycle info footer under each feeder group + "Linked breeding cycle" dropdown options
- Home Dashboard — "Next 30 Days" events (farrowing window opens/closes, sows due to farrow)
- Pigs Home Dashboard + Home Dashboard — cycle survival chart labels

## Pig Cycle Labeling — Ronnie's Full Answers

For reference, these were his rules when we designed the labeling:

1. Format: `Group 1 - 25-01`
2. The first group to start its cycle that year gets `-01`, then `-02`, `-03` in cycle-start order. If Group 1 ever starts a second cycle in the same year, that one gets `-04`.
3. Labels auto-generate — no manual entry.
4. Display in: Gantt timeline, farrowing records, pig batches/feeder groups, home dashboard events.
5. Retroactive: existing cycles should get labels without any data migration.
6. Build this after the color palette swap and BEFORE the cattle module.

## Cattle Module — Full Answers Received, Ready to Build

Ronnie answered all 31 cattle-module questions via the file `cattle question answers.txt` on his Desktop. The full answer set is pasted below. All Podio app field definitions are in `Cattle upload from Podio/all fields 3 cattle app.txt`.

### Key Decisions Captured

- **Statuses**: Use Podio statuses as the animal location. Add a new status `Backgrounders` between young cattle and Finishers. A calf moves through many statuses over its lifetime — we'll need a breeding timeline to organize phases.
- **Sire tracking**: By tag # or registration # (for embryos / pregnant cows that came off-farm).
- **Calving**: Separate focused calving table, running record per cow. Must cross-link to the rest of that cow's tracking data.
- **Cow problem flagging**: Need a way to flag cows that don't take care of their calves or have major pregnancy complications — a breeding blacklist + general issue flags.
- **Registration & DNA**: Spot for registration number. Want DNA test PDF attach + eventually a parser to pull data from the PDF (manual entry acceptable for now).
- **Breeding timeline**: Tracks on a timeline (Ronnie uses Asana timeline/gantt today for this).
- **Full records**: Every sire and dam needs full history. Currently only one bull, about to be sold.
- **Preg checks**: Blood-based at-home tests going forward.
- **Nutrition tracking**: Track NFC and Protein over 30 / 90 / 120-day rolling windows. Admin feed tab needs a "Cattle Inputs" table where Ronnie enters DM, NFC, Protein per hay type, so daily reports auto-calculate the nutrition picture per group. Also wants recommendations for amounts needed to hit nutritional goals.
- **Feed test results**: Test-driven DM/NFC/Protein values change over time. App must NOT retroactively recalculate past daily reports when the feed table is updated — only new reports use the new numbers. Upload test result PDFs + keep a history of changes with the PDFs attached.
- **1000-lb cow units**: Auto-calculate from total weight / 1000 (NOT from average weight × count).
- **Hay tracking**: No standard monthly order cadence. Ronnie orders hay all the time. Needs projected hay on site + ordering flow driven by herd weights and nutritional needs.
- **Pasture**: Regenerative rotational grazing — animals move constantly. Needs help configuring pasture-usage tracking.
- **Weigh-ins**: Rapid individual weigh-in entry with a note field. Flag missing tag #s per group weighed (we only weigh one location-based group at a time). Handle missing/lost tags by flagging "unknown animal in group X" so we can reconcile later.
- **Analytics**: Connect nutrition + weight to look for weight trends (including seasonal). Ronnie wants us to think through every data connection that produces actionable insights. Open to external APIs (weather is the obvious candidate).
- **Processing batches**: Naming convention `C-26-01`, `B-26-02`, etc. — 3-4 cows per batch. Finished animals picked out and grouped when ready to process.
- **Cost tracking**: Detailed per-head cost. Will upload inventory reports + cut pricing spreadsheets (same pattern Ronnie wants extended to broilers and pigs eventually).
- **Daily webform**: Per-group entry only (no daily individual cow tracking — hundreds of cows makes that infeasible). Webform must be substantially streamlined. Calculations happen in the app, not in the webform.
- **Infrastructure stance**: "We have to do per group... spare no token expense. We need bulletproof infrastructure." — so when we build, we go deep, no shortcuts.

### 3-Phase Build Plan (confirmed before this session)

**Phase 1** — Daily Ops Foundation
- Cattle Daily Report webform (per-group, streamlined)
- Cattle Dailys tab (daily report list + edit)
- Admin Cattle Feed Inputs panel (hay/feed cut DM/NFC/Protein entries + upload test PDFs with version history)
- PDF upload + history per feed cut

**Phase 2** — Weigh-Ins
- Weigh-ins tab with "session mode" for rapid entry
- Individual entries with notes
- Missing-tag reconciliation per group session
- ADG chart (daily weight gain) + seasonal trend view
- 1000-lb cow unit auto-calc (total weight / 1000)

**Phase 3** — Directory, Lifecycle & Finance
- Cattle directory / tracker with all Podio fields (tag#, reg#, sex, status, breed, breeding blacklist, % wagyu, origin, birth date, purchase info, sire, dam, hanging weight, processing date, carcass yield %)
- Calving records (per-cow running history + complications flagging)
- Breeding events + timeline Gantt
- Processing batches with `C-26-01` naming
- Sale records
- Per-head cost rollup (feed + processing + inputs + cut pricing)
- Import Ronnie's Podio exports: 469 animals + 1,930 weigh-ins + 1,525 daily reports

### Full Answers File (Desktop: `cattle question answers.txt`)

```
1. We will go by the podio statuses, These are the locations of the animal. In the phases an A calf could pass through many of these locations. We will most likely need a breeding timeline to better organize phases. We will be adding in the status Backgrounders. This is a step before Finishers for younger cattle we plan to process.
2. We need to track the sire and will do by tag # or reg # for embryos or preg  cows that came off farm.
3. Yes a focused calving table. It would just be a running record of Calving per cow. but we need to think about about how to see the rest of the tracking data for the cow.
4. no
5. We need a way to keep track of cows that don't take care of their calf or have major preg complications for breeding, we need another way to flag overall issues with cows.
6. yes we need a spot for reg number and a way to attach dna test or a parsing funtion to grab data off a pdf.
7. no
8. We have a cattle breeding project in asana and can view it with the timeline display to give us a gant chart.
9. We need to track this on the time line
10. We really need the capability of full records. We only have 1 bull currently and we are getting ready to sell him.
11. We did preg checks by blood with at home style test and will use this going forward.
12. We need to track NFC and Protein, but I would like to do this over longer windows. 30, 90 120 days. I will need a table in the admin feed tab where I can add in Cattle inputs and put in the DM, NFC and Protein so that when it gets logged in the daily reports for that group we will have a picture of their nutrition. We will need reccomendations for amounts to hit certain nutrional goals
13. These come from tests and they are likely to change the app need to adjust the calcualtion for the change in the feed table but not affect past calculations. I would like a place to upload the test results and would like a history of changes with the test results attached
14. This should auto calculated based on the weights. Not avg weight but total weight / 1000
15. We will need a way to have projected hay on site with ordering, but this won't be a standard monthly order. I order hay at all times. This will all be based on hay needs by herd weights
16. See q 1 answer.
17. Yes I need something to track pasture usage. Need help configuring this. WE are a regenerative farm that move animal constanl;y
18. yes.
19. Great idea, yes we need a rapid way to enter in weight data, that will also track if we missed any tag # when weighing a group as we only weigh 1 group at a time based on their location status. Would need to be individual weigh in with a note field. Sometime we have a missing tag so we would need figure out who this missing tag is.
20. yes. We really need to get sophisticated and see possible weight trends (maybe even season) since we will have all the nutritional data. Think about all the ways that data needs to be connect to produce the most actionable date.  Think about any other data we could bring in through API that would be helpful.
21. what we have is the best unless you can think of something else. We pick out cattle that are ready to process, 3 or 4 or so at a time and them call them a Batch ( C-26-01 was 4 cows, B-26-02 was 3 cows etc/
22. Need detailed cost per head.  We have a website with cut pricing that can factored into the equation and I can upload inventory reports and I will need a way to upload pricing spread sheets that we can eventually buil into the broiler and pigs
23. yes
24. All of the above with the rooling windo with nutritional data and how much of what feed the groups should be getting
25. no vs but we do need to see where we stand
26. yes
27. yes
28. yes
29. yes. spare no token expense. We need bullet proof infrastructure.
30. Yes we have to do per group but the report wont be where calculation are done any more. Webform needs to be streamlined. No way to track hundreds of cows individually daily.
31. Just a 4th option as the webform will be substantially streamlined
```

### Podio Field Reference (Desktop: `Cattle upload from Podio/all fields 3 cattle app.txt`)

Three Podio apps back the current cattle system — field lists are documented there. Key fields we'll model:

**Cattle Tracker**: Tag#, Pic, Purchase Tag ID, Sex, Status, Breed, Breeding Blacklist, % Wagyu, Origin, Birth Date, Age, Purchase Date, Receiving Weight, Purchase Amount, Last Recorded Weight, Weight History, Breeding Status, Last Calving, Calves (app-ref), Sire (app-ref), Dam (app-ref), Hanging Weight, Processing Date, Carcass Yield %.

**Weigh Ins**: Tag#, Cow (app-ref), Date, Weight.

**Cattle Dailys** (webform): Date, Team Member, Cattle Group, 1000 lb Cow Units, Hay Type #1-3 (with Bales, DM, Lbs Protein, Lbs NFC calcs per type), Lbs of Citrus Pellets + NFC/Protein, Lbs of Alfalfa Pellets + NFC/Protein, DM Needed, DM Given, Protein %, NFC %, Waste %, Hay & Pellets cost, Waterers checked, Fence Voltage (KV), Issues / Mortalities / Comments.

## Outstanding Items

### High Priority — Queued for Next Session

- **Cattle module Phase 1** — start here: Cattle Daily Report webform + Dailys tab + Admin Cattle Feed Inputs panel + PDF upload with version history.
- **Cattle module Phase 2** — Weigh-ins tab with session mode, missing-tag tracking, ADG chart, 1000-lb-unit auto-calc.
- **Cattle module Phase 3** — Directory, calving, breeding, processing batches, sale records, per-head cost rollup, Podio import (469 animals, 1,930 weigh-ins, 1,525 daily reports).

### Deferred Until After Cattle Module

- **Animals on Farm tile expansion** — currently 4 columns (Broilers / Layer Hens / Pigs / Total). Needs to expand to include Cattle and Sheep. Postponed because showing empty "0" tiles for unbuilt programs is noise — we'll add each tile as its program comes online.
- **DNA test PDF parser** — Ronnie wants a function that extracts data from uploaded DNA PDFs. Manual entry is acceptable in the interim. Defer until Cattle Phase 3 is stable.
- **Cut pricing spreadsheet upload** — planned for cattle first, then extend to broilers and pigs. Ronnie will supply spreadsheet samples.
- **Weather API integration** — Ronnie is open to it for all programs (pasture rotation, cattle nutrition-trend analysis, broiler brood heat planning). No specific API chosen yet.

### Previously Open — Still Applies

- **Physical feed counts** — Ronnie entered counts for all feed types on Apr 13, 2026. Adjustment badges are showing in the UI. Real-world validation accumulates over the next weeks as consumption runs against the counted baseline. No bugs reported yet.

## Known Issues

None open at end of session. All bugs surfaced during color swap were fixed and deployed.

## Lessons Added This Session

12. **Always scope color changes by context, not global find-replace.** The color swap couldn't use a single `sed` command because the SAME hex code appeared in multiple contexts (e.g., `#fffbeb` is the AddFeedWebform background AND the layer program card background — the former needed to change to farm green, the latter had to stay as layer brown). Approach that worked: work line-by-line in the relevant component functions; preserve documented palettes (BATCH_COLOR_PALETTE, housing batchColors); spot-check with grep after each pass.

13. **Pre-existing bugs surface during color audits.** Several places were using broiler blue in non-broiler contexts (boars, layer hens, layer batch stats). These only became visible because a systematic audit was being performed. When doing any site-wide visual pass, look for and fix leaked colors — don't just change what you're targeting.

14. **Retroactive auto-labels beat data migration.** The pig cycle label `Group N - YY-NN` is derived purely from `exposureStart` at render time. No schema change, no migration, no "backfill" script. Deploy the helper and every existing cycle gets labeled. This pattern works any time you can compute a display value deterministically from existing fields.

15. **Per-view seq maps, not App-wide.** The `cycleSeqMap` is computed fresh inside each view that needs it (`view==="breeding"`, `view==="pigbatches"`, `view==="farrowing"`, plus the home-dashboard week-events block). The data set is small (<100 cycles) so the cost is negligible, and it keeps the scope local — no risk of a stale App-level memo drifting from a re-render. Good pattern for any derived data keyed off a single state slice.

---

## Outstanding Cattle Design Questions (captured evening of Apr 14)

### Answered this evening (second round of cattle Q&A)

1. **Batch naming** — confirmed `C-26-**` (and `B-26-**` for backgrounders if/when that split matters).
2. **Backgrounders threshold** — manual judgment call, roughly **500 lbs or 9 months**.
3. **Breeding timeline constants** —
   - 65-day bull exposure
   - 30 days after bull exposure → preg check
   - 9-month gestation
   - 65-day calving window
   - 7-month nursing → wean
4. **Calving cross-link deep design** — SKIP. Too complicated, revisit later.
5. **Feed test PDF + hay cost inputs** — PDF upload only, **no parser**. Fields required per feed test: `Moisture`, `NFC`, `Protein`, `Bale weight`. Also need landed-cost math per feed type (hay, citrus pellets, molasses): `cost per bale` + `freight per truck` + `bales per truck` → derived landed $/lb.
6. **DNA PDF parser** — deferred. Add to reminders, revisit after everything else is built.
7. **Weather API integration** — YES, and design it cross-program (benefits broilers, pigs, layers too, not just cattle). Think through the integration before building.
8. **Cattle feed admin panel** — admin must be able to **add/remove** feed types in the cattle feed panel. Fully integrated with webform + dailys. Webform MUST ship first — daily reports are daily, Ronnie can't wait on the rest.
9. **Webform math model** — webform captures **raw inputs only**. All calculations happen in the app. Webform stays simple.
10. **Maternal issue flag** — checkbox with a **mandatory description field** that only appears (and is required) when the flag is checked.
11. **Color confirmation** — cattle = **red** (matches the palette committed in `524b4c2`).

**Scope decision**: build all 3 phases at once (webform + dailys → weigh-ins → directory/tracker) rather than phasing deploys.

### Still open — to resolve before code starts

- **Full Podio status list** — Ronnie said "go by Podio statuses" but the exported field dump only tells us a `Status` category field exists, not its option values. Need the full list + confirmation of where `Backgrounders` inserts.
- **Status transition rules** — calf → weaned → backgrounders → finishers → processed. Are transitions manual per animal, auto-triggered by age/weight, or a mix?
- **"Cattle Group" field on the webform** — maps to status category? Physical paddock? Named herd? Needs to be clear before the dropdown is built.
- **Nutrition targets** — the recommendation engine can't recommend amounts without target DM / NFC / Protein lbs per 1000-lb cow unit per life phase. Need the target table from Ronnie.
- **Pasture tracking data model** — still undesigned. Paddock registry? Move log per group? Rest-day countdown? Ronnie asked for help configuring this.
- **Hay-needs formula** — "based on herd weights" → exact formula (DM lbs/day per 1000-lb unit × total unit count × projection window − on-hand = order qty?).
- **Streamlined webform field list** — Podio cattle-dailys app has 20+ fields (DM inputs per hay type, pellets, calculated %s, waterer, fence voltage, comments). We need the exact subset that goes on the simplified webform vs what gets computed server-side in the app.
- **Day-one cattle feed types** — answer 5 implies hay, citrus pellets, molasses. Any others on launch (alfalfa pellets? mineral blocks?)?
- **Podio export files** — 469 animals + 1,930 weigh-ins + 1,525 dailys. Delivery timing and format (CSV? Excel?) not yet confirmed.
- **Cut pricing website URL + inventory report format** — needed for per-head cost rollup. Sample file needed.
- **Weather API integration plan** — no API provider chosen. Need: which data points (temp, precip, humidity, forecasts?), which program features key off it (pasture growth projections? brood heat? pig heat stress?), display locations.

---

*End of April 14 Session*

---

# 13. Session Update — April 15, 2026

## Deployment SOP added (§1)

No commit/deploy without explicit session approval. Documented at the top of the handover. This is the rule going forward.

## Cattle module design locked

Created `CATTLE_DESIGN.md` at repo root — full design doc for the cattle module across all 3 phases. Approved by Ronnie for implementation. Key decisions captured there:

- 4 active herds (Mommas, Backgrounders, Finishers, Bulls) + 3 outcomes (Processed, Deceased, Sold). Hardcoded for launch.
- Feed model: no standalone creep form. Ingredients (alfalfa pellets, citrus pellets, sugar, colostrum) tracked as regular feed entries. Mommas daily reports get a per-line `is_creep` toggle to exclude those lines from nutrition math while still counting for cost.
- 11 new Supabase tables documented.
- Phase 1 expanded to include the breeding cycle timeline tab (needed for the "missed cycle" filter on the Mommas herd).
- Public webforms: cattle added to WebformHub (5 program cards now) + 4th program on Add Feed webform + new 5th card for Weigh-Ins (Phase 2).
- Weigh-in session model: cattle sessions autosave to Supabase; mobile-safe draft resume; diminishing dropdown + `+ New Tag` button with admin reconciliation.
- Nutrition targets: per-herd table (DM % body, CP % DM, NFC % DM) in Admin → Feed. Starter seed values subject to field calibration.
- Admin panel: `FeedCostsPanel` tab renamed "Feed," split into Simple $/lb + Livestock Feed Inputs + Nutrition Targets subsections.
- Real nutritional data extracted from provided PDFs (Rye Baleage, Citrus Pellets). Molasses landed cost from Biogreaux invoice: $0.389/lb (250-gal tote at 11.9 lb/gal, 3 totes + $575 freight).

## Bugs fixed (awaiting Ronnie's approval to commit)

All fixes landed locally; nothing committed.

1. `"2192"` string literal replaced with `\u2192` arrow in timeline tooltip and batch list rows (4 locations).
2. `renderWebform` `wfCfgFields` now correctly reads `sections[].fields` instead of the nonexistent top-level `.fields`. Admin-configured required-field flags on the legacy `#pigdailys` route now work.
3. `AdminAddReportModal` gains the conditional-validation rules (feed_type required when feed_lbs>0; mortality_reason required when mortality_count>0) for broiler + layer forms including their extra-group rows. Matches WebformHub semantics.
5. Babel cache retry no longer creates a second React root — root is cached on `window._wcfAppRoot` and reused on re-execution.
6. Dead `batch_id === 'breeding-sows'` branch in the Sows/Boars feed-consumption panel removed (the ID never matched; the `batch_label` fallback was carrying the feature).
7. `feedOrders` initial state now matches the actual schema shape `{pig, starter, grower, layerfeed}` instead of the stale `{pig, broiler}`.

Bug #4 (`sb.from('batches')` in BroilerDailysView) was NOT fixed — Ronnie confirmed the view works fine. The 404 is silent and the unused state doesn't break anything.
Bug #8 (nursing sow calc using cycle weaningEnd instead of per-sow) was NOT fixed — intentional per Ronnie: easier to let a late-farrowing sow over-eat than to separate her.

## Cattle module build — Phase 1 mostly complete (April 15 session continued)

### Infrastructure (applied by Ronnie)
- ✅ `supabase-migrations/001_cattle_module.sql` applied via Supabase SQL Editor. 11 tables, RLS policies, seed feeds, seed nutrition targets.
- ✅ Storage buckets created: `cattle-feed-pdfs` + `cattle-directory-docs`. Both public, 3 authenticated policies each (INSERT/UPDATE/DELETE). Matches `batch-documents` pattern.

### Code (local only, not committed — Ronnie will review the bundle at the end)

1. ✅ **Cattle constants** in index.html near pig breeding constants: `CATTLE_HERDS`, `CATTLE_OUTCOMES`, `CATTLE_HERD_LABELS`, `CATTLE_HERD_COLORS`, breeding-cycle constants (65/30/274/65/213 days), `calcCattleBreedingTimeline`, `buildCattleCycleSeqMap`, `cattleCycleLabel`.
2. ✅ **`VALID_VIEWS`** extended with 7 cattle route IDs.
3. ✅ **Admin Feed tab** — renamed from "Feed Costs" → "Feed". Now a stack of 3 panels:
   - Existing `FeedCostsPanel` (unchanged, simple $/lb per poultry/pig feed)
   - NEW `LivestockFeedInputsPanel` — master list of every feed/mineral with filter chips, card grid, add/edit modal with autosave. Full fields: name, category, unit, unit weight, cost + freight + units_per_truck → landed $/lb computed preview, moisture/NFC/CP%, herd scope chips, status, notes.
   - NEW `NutritionTargetsPanel` — inline-editable per-herd table for DM/CP/NFC targets + fallback cow weight, with per-row autosave.
4. ✅ **Test PDF upload + version history** inside the LivestockFeedInputsPanel edit modal. Upload to `cattle-feed-pdfs` bucket. Latest test's values auto-sync to parent feed's nutrition fields. Delete removes both the PDF and DB row.
5. ✅ **Cattle Daily webform** added to WebformHub as 5th card on `#webforms`. Date + team + herd dropdown + dynamic feeds list (filtered by herd) + dynamic minerals list + fence voltage + water Y/N + mortality + issues. Per-line `is_creep` toggle on Mommas herd feeds. Nutrition values snapshotted at submit time.
6. ✅ **Add Feed webform** — Cattle added as 4th program on `#addfeed`. Herd picker replaces batch picker. Dynamic feed rows (filtered by herd scope). Creep toggle on Mommas. Inserts into `cattle_dailys` with `source='add_feed_webform'`.
7. ✅ **`CattleDailysView`** standalone component: list view with date/herd/team/source filters, row renderer with herd-colored pills + feed/mineral summary + mortality/voltage/water badges + issues highlight. Edit modal with add/remove dynamic feed & mineral rows, with nutrition snapshot refreshed on save. Delete confirmation via `DeleteModal`.
8. ✅ **Header** component — cattle sub-nav added (Dashboard / Herds / Dailys / Weigh-Ins / Breeding / Directory / Batches). CATTLE label in top bar when in a cattle view.
9. ✅ **Routing:** `view==="cattledailys"` renders the real `CattleDailysView`. The other 6 cattle views render a clean "Coming soon" placeholder that lists which features ARE working — no blank screens.
10. ✅ **Home Dashboard** — 4th Cattle nav card. Grid is now 2×2 instead of 3×1.

### What's NOT yet built (remaining Phase 1)
- **Herds tab** (`cattleherds`) — cattle tiles per herd with cow list, sorting, add/remove/transfer
- **Breeding tab** (`cattlebreeding`) — Gantt timeline + cycle cards + outstanding cows
- **Calving records** — inline form + history under Mommas cows
- **Cattle Home Dashboard** (`cattleHome`) — stats tiles + rolling nutrition panel
- **Animals on Farm** — currently 4 columns, needs expansion to 5 (Broilers / Layers / Pigs / Cattle / Total)

### Phase 2 (not started)
- Weigh-Ins webform + session autosave model + broiler/pig/cattle flows + WeighInsView tabs

### Phase 3 (not started)
- Directory (full `cattle` table browsing), processing batches, sales, deceased, per-head cost rollup, Podio import

## Open items for next session

- **Ronnie** to review the uncommitted working-tree changes in `index.html` + `PROJECT.md`. Full diff: `git diff` (index.html +1,468 lines, PROJECT.md ~+110 lines).
- **Claude** to resume Cattle Phase 1 build at step 10 (Herds tab).
- Podio export freeze + import happens AFTER the cattle webform + daily reporting are live (since daily data will be moving from Podio to the planner at go-live).
- Fresh Podio export needed once we're ready for import.
- Test plan once enough is deployed: admin creates a cattle daily → reviews feed totals → checks nutrition targets math → uploads a feed test PDF → verifies values sync to parent feed.

## Lessons for future Claude sessions

16. **Read the full handover doc before summarizing "open questions."** During this session I asked Ronnie to re-answer questions that were already answered in PROJECT.md §12 from April 14. Ronnie had to push back. Always finish reading the entire doc — including late-night addenda — before drafting the question list.
17. **The "no commit without approval" rule is absolute.** The old pattern of "edit + commit + push in one flow" is retired. Even trivial changes wait for Ronnie's explicit go-ahead in the same session turn. Background agents and worktrees follow the same rule.

---

*End of April 15 Session*
