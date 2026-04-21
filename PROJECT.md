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

Created `CATTLE_DESIGN.md` (subsequently deleted 2026-04-16; load-bearing decisions migrated to `DECISIONS.md` § 2026-04-15 — Cattle Module). Was the planning doc that drove the build. Key decisions captured there at the time:

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

### Phase 1 — COMPLETE
All planned Phase 1 steps are built. Calving record add/edit form lands inline in the Mommas cow detail (`+ Add Calving` button).

### Phase 2 — COMPLETE (for cattle, pig, broiler)
- ✅ `WeighInsWebform` (public, route `#weighins`) — species picker → setup screen with draft session resume → entry screen with autosave to `weigh_in_sessions` + `weigh_ins`
- ✅ Cattle session: diminishing tag dropdown (sorted asc) + weight + note. "+ New Tag" button for unknown tags. Note auto-publishes to `cattle_comments`.
- ✅ Pig session: per-row weight + note. (Send-to-trip wiring deferred — pigs aren't tagged so a future Trip view can pull recent session entries.)
- ✅ Broiler session: pick batch + week (4/6) → enter individual weights → on Complete the average auto-fills `batch.week4Lbs` / `batch.week6Lbs` in `app_store.ppp-v4`.
- ✅ `CattleWeighInsView` (auth, route `#cattleweighins`) — list past sessions with status filter, expand to see entries, reopen complete sessions, reconcile new-tag entries to known cows.
- ✅ Webforms hub gets a new ⚖️ Weigh-Ins card alongside Add Feed.

### Phase 3 — Directory MERGED INTO HERDS (per Ronnie's call Apr 15)
- The Directory tab was cut. Its functionality (search, sort, filter across all cattle including outcomes, add/edit/transfer/delete) is now built into the Herds tab. Default view = per-herd tiles. When user types in search box or picks a non-active filter, view switches to flat sortable list. Outcome herds appear collapsed at bottom of tile view.
- Per-head cost rollup deferred
- Podio import deferred (waiting for fresh export after webform goes live)

## April 15 evening session — large code drop

Built the rest of Phase 1 + Phase 3 directory functionality (merged into Herds):

11. ✅ **Cattle Home Dashboard** — stat tiles (cattle on farm, total live weight, cow units, mortality 30d, reports 30d, feed cost 30d) + per-herd breakdown cards
12. ✅ **Cattle Herds** (merged Directory) — search bar + status filter + sort dropdown at top. Per-herd tiles by default with cow lists; flat list when search/filter active. Outcome herds collapsed at bottom. Add Cow modal with all Podio fields. Per-cow expand shows Identity / Lineage / Weigh-in history / Calving history (Mommas) / Notes / Comments timeline + Edit / Transfer / Delete actions
13. ✅ **Cattle Breeding** — list of cycles with auto-computed timeline (65/30/9mo/65/7mo). Status pill (planned/exposure/pregcheck/calving/nursing/complete). Outstanding cows highlighted. Add/edit/delete cycles
14. ✅ **Cattle Processing Batches** — list of batches with linked cow tags + total live weight + hanging weight + yield % + cost. Marking complete auto-moves linked cows to Processed herd + logs transfer
15. ✅ **Animals on Farm tile** — extended to 5 columns (added Cattle)
16. ✅ **Cattle comments** — quick "Add Comment" inside cow detail. Writes to `cattle_comments` table

**Migration to apply:** `supabase-migrations/002_cattle_comments.sql` (one new table for the unified comments timeline). Until applied, the comments section in cow detail will silently show empty. Apply when ready — same idempotent pattern as the first migration.

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

---

# 14. April 15 — End-of-Day Session Wrap-Up (read this first)

This is the canonical summary for anyone (Claude or human) picking up where we left off. It supersedes the partial updates in §13 above when there's any conflict.

## 14.1 What got built today (commit timeline)

| Commit | What |
|---|---|
| `47eb531` | **6 bug fixes** in `index.html` — committed locally, not pushed. Arrow literal `"2192"` → `\u2192` in 4 places (timeline tooltip + batch list); `wfCfgFields` path fix in renderWebform; AdminAddReportModal conditional validation; Babel cache double-render guard via `window._wcfAppRoot`; dead `batch_id==='breeding-sows'` filter branch removed; `feedOrders` init shape `{pig,broiler}` → `{pig,starter,grower,layerfeed}`. |
| `d8a4a67` | **Cattle module Phase 1 scaffold** — Admin Feed tab restructure (FeedCostsPanel + LivestockFeedInputsPanel + NutritionTargetsPanel); test PDF upload + version history; Cattle Daily webform; Add Feed with Cattle as 4th program; CattleDailysView; cattle constants + breeding helpers; routing + Header section label; Home Dashboard Cattle card. |
| `<this commit>` | **Cattle Phase 1 finish + Phase 2 weigh-ins + Phase 3 directory merge** — see §14.2. |

## 14.2 Code state at end-of-day (what's now in `index.html`)

### Admin → Feed tab (renamed from "Feed Costs")
- Existing `FeedCostsPanel` (simple $/lb per poultry/pig feed) — top section, unchanged.
- `LivestockFeedInputsPanel` — card grid of every feed/mineral with category filter chips. Each card has **📎 Upload Test** + **Edit** buttons. Cards show name, category badge, unit + landed $/lb (computed), nutrition values, herd scope chips. Inactive feeds dimmed.
- Edit modal: identity / unit / cost (with computed landed $/lb preview) / nutrition (manual + via test PDFs) / herd scope chips / status / notes. **Test history** section inside (only when editing): list of past tests with **CURRENT** badge on latest, Edit + Delete per test, "+ Upload New Test" inline form. Replacing a test PDF cleans up the old file in storage. **Delete Feed** in modal footer (cascades to tests + PDFs). Historical `cattle_dailys` snapshots are preserved on feed delete because nutrition is stored by-value in JSONB.
- `NutritionTargetsPanel` — per-herd inline-editable table for `target_dm_pct_body` / `target_cp_pct_dm` / `target_nfc_pct_dm` + Notes. Per-row autosave with debounce. **`fallback_cow_weight_lbs` is hidden from the UI** but kept in the DB for the recommendation engine.

### Public webforms (`#webforms`)
Hub now has 7 cards: 2 quick-action cards at top (🌾 Add Feed, ⚖️ Weigh-Ins) + 5 daily report cards (Broiler / Layer / Egg / Pig / Cattle).
- **Cattle Daily Report** — Date / Team / Herd dropdown / dynamic Feed rows (filtered by herd_scope, with `is_creep` toggle on Mommas) / dynamic Mineral rows (all minerals available to all herds) / Fence Voltage / Water Y/N / Mortality + reason / Issues. Nutrition values **snapshotted into the `feeds` jsonb at submit time** so retroactive feed edits don't rewrite history.
- **Add Feed** — now 4 programs (Pig / Broiler / Layer / **Cattle**). Cattle path has herd picker + per-row creep toggle. Inserts to `cattle_dailys` with `source='add_feed_webform'`.
- **Weigh-Ins** (`#weighins`, separate top-level component `WeighInsWebform`) — species picker → draft-session resume screen + new-session setup → entry screen. Each entry persists to `weigh_in_sessions` + `weigh_ins` immediately. Cattle: diminishing tag dropdown sorted ascending with "+ New Tag" fallback for unknown/replacement tags + per-entry note that auto-publishes a comment. Pig: per-row weights for active feeder batch. Broiler: pick batch + week (4/6) → enter individual weights → on Complete the average auto-fills `batch.week4Lbs` / `batch.week6Lbs` in `app_store.ppp-v4`.

### Authenticated cattle program
- **Home Dashboard** (`cattleHome`) — stat tiles (cattle on farm, total live weight, cow units, mortality 30d, reports 30d, feed cost 30d) + per-herd breakdown cards.
- **Herds** (`cattleherds`, **merged with the killed Directory tab**) — search bar + status filter (active/all/per-herd/per-outcome) + sort dropdown at top. Default: per-herd tiles for the 4 active herds with cow lists, outcome herds (Processed/Deceased/Sold) collapsed at bottom. Switches to flat sortable list when search has text or status filter is non-active. Per-cow expand row shows Identity / Lineage / Weigh-In History (latest 10) / Calving History (Mommas only, with **+ Add Calving** form inline) / Notes / Comments Timeline + actions (Edit / Transfer / Delete). Add/edit cow modal has all Podio fields including dam/sire, % wagyu, breeding blacklist (with required reason), maternal issue (with required description), purchase/sale/death dates.
- **Dailys** (`cattledailys`) — list with date/herd/team/source filters; full edit modal with dynamic feed/mineral rows.
- **Weigh-Ins** (`cattleweighins`, `CattleWeighInsView`) — list past sessions with status filter (all/draft/complete). Expand to see entries. Reopen complete sessions. Reconcile new-tag entries to known cows via dropdown. Delete sessions (cascades to entries).
- **Breeding** (`cattlebreeding`) — list of cycles with auto-computed timeline (65/30/9mo/65/7mo). Status pill (planned/exposure/pregcheck/calving/nursing/complete). Outstanding cows highlighted on each cycle. Add/edit/delete.
- **Batches** (`cattlebatches`) — processing batches list. Linked cow tags + total live weight (from latest weigh-ins) + hanging weight + yield % + cost. **Marking complete auto-moves linked cattle to Processed herd + logs `cattle_transfers` rows.** Auto-naming `C-26-NN`.

### Home Dashboard
- 4 program nav cards (Broilers / Layers / Pigs / **Cattle**) in 2×2 grid.
- Animals on Farm tile extended to **5 columns** (Broilers / Layer Hens / Pigs / **Cattle** / Total).

## 14.3 Database state

### Applied to production Supabase by Ronnie today
- ✅ Migration `001_cattle_module.sql` — 11 new tables: `cattle_feed_inputs`, `cattle_feed_tests`, `cattle_nutrition_targets`, `cattle_dailys`, `weigh_in_sessions`, `weigh_ins`, `cattle`, `cattle_calving_records`, `cattle_breeding_cycles`, `cattle_processing_batches`, `cattle_transfers`. All RLS enabled; anon INSERT for the daily/session/weigh-in tables (so public webforms work); anon SELECT for config tables (so webforms can read feed/nutrition lists).
- ✅ Seed data: 13 feeds (rye baleage, alfalfa hay, clover hay, alfalfa pellets, citrus pellets, molasses, sugar, salt, bicarb, conditioner, calcium, biochar, colostrum) + 4 nutrition target rows (mommas/backgrounders/finishers/bulls).
- ✅ Storage buckets `cattle-feed-pdfs` + `cattle-directory-docs`. Both **public** (badge confirmed). 3 policies each (INSERT/UPDATE/DELETE) for `authenticated` role.

### NOT YET applied — apply before testing comments / new-tag reconcile / weigh-in notes
- ⚠️ Migration `002_cattle_comments.sql` — adds the `cattle_comments` table (unified per-cow timeline). Without this, the `addQuickComment`, weigh-in note auto-publish, and calving note auto-publish all silently no-op (wrapped in try/catch). The Comments Timeline section in cow detail will show "No comments yet." Apply via SQL Editor when ready — same idempotent pattern.

## 14.4 Critical context for the next session

**Read this FIRST when picking up.**

1. **Deployment SOP is absolute.** Never run `git commit`, `git push`, or any deploy command without explicit user approval IN THE CURRENT SESSION TURN. See §1. This applies even to the bug fix path. "Authorized to fix" ≠ "authorized to commit."
2. **Local commits are at `47eb531`, `d8a4a67`, and `<this commit>`** — Ronnie's branch is N commits ahead of `origin/main`. Nothing has been pushed/deployed unless he's done so manually after this session.
3. **The cattle module reads from production Supabase** even when running locally. Any test action you take affects real data. Be careful with delete/cascade operations.
4. **Migration 002 is the one outstanding migration.** Some features will silently fail until it's applied. Tell Ronnie to apply it before testing comment-related flows.
5. **`index.html` is 14,748 lines** — single-file app. No bundler. Babel-in-browser with localStorage cache. After local edits, the user MUST clear `wcf-babel-*` keys from localStorage or open in incognito to see the new code.
6. **WebformHub uses `const {useState, useEffect} = React;` destructuring** — that's OK because WebformHub is its own function scope. The "no destructuring near App" rule from `feedback_working_rules.md` applies to standalone components defined RIGHT NEXT TO App in source order.
7. **The cattle module added ~3,200 lines to `index.html` today.** Spread across:
   - Top of file: cattle constants + breeding helpers (~70 lines)
   - Mid-file: WeighInsWebform component (before WebformHub) (~360 lines)
   - Mid-file: LivestockFeedInputsPanel + NutritionTargetsPanel (after FeedCostsPanel) (~700 lines)
   - Within WebformHub: cattle daily form branch + cattle add-feed branch + cattle weigh-in form (~500 lines)
   - Bottom of file: CattleDailysView + CattleHomeView + CattleHerdsView + CattleBreedingView + CattleBatchesView + CattleWeighInsView + CowDetail + CollapsibleOutcomeSections (~1,500 lines)

## 14.5 Lessons learned today

1. **Read the WHOLE handover doc before drafting questions.** I asked Ronnie to re-answer the cattle design questions early in the session — he had to remind me they were already answered in PROJECT.md §12 from the previous day. Cost two round-trips. Lesson: when the handover doc is long, finish reading every section (including late-night addenda) before composing follow-up questions.
2. **When proposing a data model, propose the simplest version first.** I initially designed a separate `cattle_creep_batches` table + standalone "Mix Creep Batch" form. Ronnie wanted ingredients tracked like everything else, with no compound-feed concept. The simpler model won — `is_creep` per-line flag on `cattle_dailys.feeds` jsonb. Lesson: don't engineer abstractions before confirming the user actually wants them.
3. **Storage policy creation in Supabase Studio defaults to "all public roles"** — that lets anonymous users do operations you probably didn't intend. Ronnie caught this on the first INSERT policy. Always set `Target roles` to `authenticated` explicitly.
4. **Bucket public toggle is a SEPARATE step from policies.** Ronnie made the buckets but they didn't show the PUBLIC badge initially. Without the toggle on, `getPublicUrl()` returns URLs that don't actually serve files. Always confirm the badge in the bucket list view.
5. **Splitting commits after the fact is awkward.** I authorized 6 bug fixes but had also written cattle scaffolding on top. Had to back up the working tree with `cp`, `git checkout HEAD --` to revert, re-apply only the bug fixes, commit, then `cp` back. Worked but clunky. Lesson: when more than one logical change is queued, commit each as soon as it's authorized rather than batching.
6. **Webform field path: `(wf.sections||[]).flatMap(s => s.fields||[])`, NOT `wf.fields`.** This was bug #2 of today's fixes — the legacy `renderWebform` function (`#pigdailys` route) was reading `.fields` directly, which doesn't exist on webform config objects. The correct path is to flatten the sections.
7. **When updating `app_store` JSONB, fetch + mutate + upsert.** Direct UPDATE on a JSONB cell isn't worth the complexity. The broiler weigh-in completion handler does this: select `ppp-v4`, map the array to update one batch's `week4Lbs`/`week6Lbs`, upsert back with `{onConflict:'key'}`.
8. **Babel cache retry can call `ReactDOM.createRoot()` twice** if the cached version throws and the boot script clears cache + re-executes. Fix: cache the root on `window._wcfAppRoot` and re-use it on second execution. Bug #5 fix.
9. **Don't expose tech-detail fields to users.** I initially put `fallback_cow_weight_lbs` in the Nutrition Targets UI. Ronnie asked "what is this for?" and we agreed to hide it. The DB column stays for the recommendation engine but admin doesn't have to think about it. Lesson: every visible field competes for the user's attention; default to hiding things that don't help daily ops.

## 14.6 Things to watch out for (pitfalls)

1. **`cattle_comments` table doesn't exist yet.** Until migration 002 is applied, `addQuickComment` / weigh-in note auto-publish / calving note auto-publish all silently fail. The features render fine, but no data persists. Comments timeline always shows empty.
2. **`is_creep` toggle is per-line, not per-feed.** A daily report's Mommas feed line can mark "this lbs of alfalfa pellets was creep feed." That line is excluded from Mommas nutrition math but still counted for cost. The `cattle_feed_inputs.exclude_from_nutrition` column was REMOVED — that approach didn't work because the same ingredient is used for both creep and direct feed.
3. **The cattle directory was REMOVED as a separate tab.** Its functionality (search/filter/sort across all cattle including outcomes, add/edit/transfer/delete) is built into the Herds tab. Don't re-propose Directory as a separate tab without checking with Ronnie.
4. **Weigh-in `note` auto-publishes to `cattle_comments` only when tag is set AND species is cattle.** Pig and broiler weigh-in notes stay in `weigh_ins.note` only.
5. **Cow weights for the herd live-weight calc fall back to `fallback_cow_weight_lbs`** when no weigh-in exists. Once Phase 2 weigh-ins start hitting prod, this fallback rarely triggers. But it's the safety net for empty data.
6. **Processing batch "Send to" flow:** selecting cows for a Planned batch sets `cattle.processing_batch_id` but does NOT change herd. Only when admin marks the batch `complete` do all linked cattle auto-flip to the Processed herd + get a `cattle_transfers` row. Don't accidentally mark a batch complete prematurely.
7. **`delete-feed` cascades to `cattle_feed_tests` via FK ON DELETE CASCADE,** but PDF files in storage are NOT auto-deleted by Postgres. The app-side `deleteFeedPermanently` handler manually calls `sb.storage.from('cattle-feed-pdfs').remove(pdfPaths)` first. Don't bypass the handler.
8. **Cattle constants live near pig breeding constants** at the TOP of the JSX source (around line 540). They're accessible to all later components in the same `<script type="text/jsx-source">`. Don't try to import them — top-level const is the pattern.
9. **The `fmt` and `addDays` helpers are defined once near line 740** and used everywhere. Don't redefine them inside components.
10. **Status filter on Herds tab uses string equality** (`'active' | 'all' | herd-name`). When `'active'`, shows the 4 active herds via tile mode. When `'all'`, shows everything in flat-list mode. When a specific herd, filters flat list to that one.

## 14.7 Mistakes I made today (be honest so future me doesn't repeat)

1. Asked Ronnie to re-answer cattle questions that were already answered in §12. Lost ~half a session-turn.
2. Proposed separate Mix Creep Batch form/table when ingredients-only was simpler. Lost ~half a session-turn negotiating model.
3. Incomplete first storage policy guidance (didn't mention setting Target roles to `authenticated`). Caught quickly by Ronnie.
4. Forgot to mention the bucket Public toggle in initial setup. Caught after first round.
5. Initially put `fallback_cow_weight_lbs` in admin UI when it doesn't need to be there.
6. Initially designed a "Mark Inactive" pattern for feed deletion when Ronnie wanted real Delete with confirmation. Replaced after one round.

## 14.8 Architecture decisions worth knowing

1. **Cattle uses dedicated tables, not `app_store`.** Same pattern as `pig_dailys`, `layer_dailys`. App_store stays for the legacy poultry/pig blobs.
2. **Daily reports snapshot nutrition values at submit time.** The `feeds` jsonb on `cattle_dailys` includes `{feed_input_id, feed_name, qty, unit, lbs_as_fed, is_creep, nutrition_snapshot:{moisture_pct, nfc_pct, protein_pct}}` per feed line. Editing the parent feed in admin doesn't rewrite history. This was Ronnie's explicit choice (option A from PROJECT.md §12 Q5).
3. **Comments timeline is unified into a single table** (`cattle_comments`) with a `source` discriminator (`manual` / `weigh_in` / `daily_report` / `calving`). Each source's write path inserts a row with the right source tag and a `reference_id` linking back to the originating record.
4. **Sessions are parent + entries.** `weigh_in_sessions` row per session (per species, per herd-or-batch, with status='draft'|'complete'). `weigh_ins` rows are children. Sessions persist immediately on every entry insert — so a phone drop is fully recoverable.
5. **Storage path convention:** `<feedId>/<timestamp>-<safeName>.<ext>` for cattle-feed-pdfs. Timestamp prevents collisions; safeName strips problematic chars.
6. **Webform autosave pattern:** debounce 1.5s, save on input. Save-on-close flushes pending. See LayerBatchesView for the canonical model.
7. **`React.useState()` direct, NOT destructured** in components defined "near App" in source order. WebformHub is OK because it's clearly its own function scope. New top-level standalone components: pick one and stick with it. We used `React.useState()` direct in the new cattle components for safety.
8. **`var` inside conditional blocks** (`if(view==='X') { var foo = ... }`) — `const` and `let` may crash in this Babel setup inside nested conditionals. New cattle components avoid this by using top-level state hooks.
9. **Cattle herd colors:** red family (no purple). Mommas red, Backgrounders orange, Finishers rose, Bulls wine. Constants in `CATTLE_HERD_COLORS` near line 540.
10. **`fmt` is a date formatter that takes ISO strings, returns "Mon DD, YYYY".** Use throughout new code.

## 14.9 What's still outstanding

- **Migration 002** to apply when ready (Ronnie).
- **Per-head cost rollup** — analytical metric, deferred. Would aggregate feed cost (from snapshots) + processing cost (from `cattle_processing_batches.processing_cost`) per cow, with attribution rules for shared inputs. Not blocking ops.
- **Podio import** — 469 cattle, 1,930 weigh-ins, 1,525 daily reports. Pending fresh export from Ronnie after the webforms have been live in the field for ≥1 day (so daily entries don't go stale). Will need a one-shot import script. Decide format (CSV / JSON) when Ronnie is ready.
- **Send-to-trip wiring on pig weigh-ins** — pigs aren't tagged so a Trip view that pulls recent session entries by checkbox is the right UX. Deferred.
- **Sheep module** — entire program. Wait until cattle is stable in production for ≥2 weeks before starting. Will reuse `cattle_feed_inputs` / `cattle_nutrition_targets` model with a sheep-scoped `herd_scope` array (the seed feeds already have `herd_scope`).
- **Cattle Home Dashboard rolling-window nutrition panel** — currently shows totals only. Adding the 30/90/120-day comparison vs target is a stretch goal.
- **Weather API integration** — multi-program scope (cattle pasture, pig heat stress, broiler brood heat). Q7 from PROJECT.md §12. No provider chosen yet. Defer until Ronnie picks one.
- **Cut pricing spreadsheet upload** — for cattle first, then extend to broilers/pigs. Defer.
- **DNA test PDF parser** — admin uploads PDF, system extracts data. Manual entry is the workaround for v1.

## 14.10 First steps for the next session

1. **Read PROJECT.md from the top.** Especially §1 (deployment SOP) and §14 (this).
2. **Ask Ronnie what he wants to work on** — don't assume. Could be Podio import, sheep, weather API, per-head cost, polish, or bug reports from real-world use.
3. **Check `git log --oneline -10`** to see if anything's happened since this session — the deploy may have happened, or Ronnie may have tweaked things directly.
4. **Check whether migration 002 was applied** with: `SELECT to_regclass('cattle_comments');` — if it returns NULL, the table doesn't exist yet and comment features will silently no-op.
5. **If Ronnie reports a bug in production**, ask for the exact reproduction steps (which view, what data, what action) before diving into code. The cattle module is large and isolating the right component matters.
6. **If Ronnie is starting a new feature**, push back if the design isn't crisp. He values "thorough planning before building" — better to spend a turn confirming scope than build the wrong thing.

## 14.11 Files modified or added today

| Path | Change |
|---|---|
| `index.html` | +3,200 lines (bug fixes + entire cattle module + weigh-ins) |
| `PROJECT.md` | +200 lines (SOP + multiple session updates + this wrap-up) |
| `CATTLE_DESIGN.md` | New file (~600 lines), progressively updated, then **deleted on 2026-04-16** as redundant once code shipped (load-bearing decisions moved to `DECISIONS.md`) |
| `DECISIONS.md` | Existing file extended with `## 2026-04-15 — Cattle Module` entry capturing the 6 load-bearing design decisions + their rejected alternatives |
| `supabase-migrations/001_cattle_module.sql` | New file — 11 tables + RLS + seed data |
| `supabase-migrations/002_cattle_comments.sql` | New file — 1 table + RLS, NOT YET APPLIED |
| `.claude/projects/.../memory/feedback_deployment_sop.md` | New memory file — encodes the no-commit-without-approval rule |
| `.claude/projects/.../memory/MEMORY.md` | Updated index to include the new feedback memory |

## 14.12 SOP reminders for the AI that's reading this

- **Never** run `git commit`, `git push`, `git push --force`, or any deploy command without explicit approval in the current turn.
- **Never** run destructive Supabase operations (DROP TABLE, TRUNCATE, etc.) without explicit approval.
- **Never** push to origin/main even after a commit unless the user says "deploy" or "push."
- **Always** show the diff and propose a commit message before asking for commit approval.
- **Always** match the scope of action to what was explicitly asked. If Ronnie says "fix X," fix X — don't bundle in Y.

## 14.13 Post-deploy hotfixes (April 15 evening, after `be4525e` shipped)

The big push (`be4525e`) deployed via Netlify and immediately surfaced two production-only bugs that hadn't shown during local writes. Both were latent JSX/JS issues that Babel-in-browser only caught at compile or runtime in the browser.

### What broke and how it was fixed

**Bug A — Babel compile error: missing `}` in unicode-escape JSX expression** (commit `05578a0`)

The whole site failed to load with:
```
Compile error: unknown: Unexpected token, expected "}" (1789:111)
> 1789 | Pick what you{'\u2019're weighing
                                    ^
```

Cause: I wrote `you{'\u2019're weighing` — the closing `}` of the JSX expression was missing. The intended pattern is `you{'\u2019'}re weighing` (apostrophe rendered via expression, then plain text resumes). When Babel hit this it couldn't compile the entire file, so every URL rendered the boot error screen — not just the `#weighins` route where the broken code lived.

Fix: 1-character — added the missing `}`.

**Bug B — Pre-existing latent ReferenceError in PigTile** (commit `45756a5`)

After the apostrophe was fixed, the Breeding Pigs (`#sows`) view threw:
```
ReferenceError: cycleSeqMap is not defined
  at PigTile (...)
```

Cause: this was NOT introduced today. `PigTile` (defined inside `view==="sows"`) referenced `cycleSeqMap` from outer scope, but the variable was never defined inside the sows view scope. The other views that use `cycleSeqMap` (`farrowing`, `pigbatches`, `breeding`) each define it at the top with `const cycleSeqMap = buildCycleSeqMap(breedingCycles);`. The sows view never did. The bug just never tripped before because PigTile only references `cycleSeqMap` inside the cycle-linked branches of the sow farrowing-history map — if no expanded sow had cycle-linked records visible, the variable was never read. Today's testing happened to expand a tile that did.

Fix: 1 line — added `const cycleSeqMap = buildCycleSeqMap(breedingCycles);` at the top of the sows view, matching the pattern used by sibling views.

### Other 404s observed (not bugs to fix today)

- `cattle_comments` 404 — expected. Migration `002_cattle_comments.sql` hadn't been applied. The app silently no-ops comments features (try/catch wrapped). Apply the migration to unblock.
- `batches` 404 — pre-existing bug #4 (BroilerDailysView queries a non-existent `batches` table). Ronnie confirmed earlier "leave it" — silent, doesn't break anything visible. Still leaving.

### Lessons (read these before the next deploy)

1. **JSX template literals with unicode escapes are a footgun.** The pattern `text{'\u2019'}suffix` is correct (apostrophe-as-expression, then plain text). Variants like `text{'\u2019're text'}` or `text{'\u2019're` LOOK fine but are syntactically broken because `re` isn't valid JSX between `'\u2019'` and `}`. Always close the expression with `}` immediately after the closing `'`. When in doubt, search for `\\u2019'\w` or `\{'\\u2019'[a-z]` in the file before commit.

2. **Babel-in-browser fails closed.** A single syntax error anywhere in the source file prevents ANY component from rendering — not just the broken view. The boot screen says "Failed to load" and shows the parse error location. Always re-test ALL top-level navs after a deploy that touches more than a few lines of JSX.

3. **Latent reference errors only show at runtime in the browser.** No build step means no static analysis. JS variables referenced in scope-lifted closures or nested map callbacks don't error until execution. PigTile worked for months because the broken code path was conditional on data that wasn't present in the test cases.

4. **Post-deploy verification checklist** (do this every time):
   - Hit `/` (Home Dashboard) — should render with 4 program cards
   - Hit `/#webforms` — all daily report cards visible + Add Feed + Weigh-Ins
   - Hit each program's sub-nav: Broilers (Dashboard / Timeline / Batches / Dailys / Feed), Layers, Pigs (incl. **Breeding Pigs / Sows**), Cattle (all 6 tabs)
   - Watch the browser console (F12) for any red errors. ReferenceError, TypeError, and 404s on Supabase tables are the common ones.
   - If anything red, fix and push BEFORE walking away.

5. **Test the deploy from a fresh browser/device, not your usual one.** Your usual browser may be serving cached Babel output. Incognito or a different browser confirms what real users see.

### Updated commit list at end of session

```
45756a5  Hotfix: cycleSeqMap not defined in Breeding Pigs (sows) view
05578a0  Hotfix: missing closing brace in WeighInsWebform JSX expression
be4525e  Phase 1 finish + Phase 2 weigh-ins + Phase 3 directory merge + session log
d8a4a67  Phase 1 cattle module: admin feed inputs, test PDFs, webforms, dailys view
47eb531  Fix 6 bugs: arrow literal, webform field path, admin validation, Babel double-root, dead filters
```

All 5 are pushed to `origin/main` and live on `wcfplanner.com` (Netlify auto-deploy).

---

*End of April 15 wrap-up. Future Claude: you've got this.*

---

# 13. Session Update — April 16, 2026 (Cattle Podio Data Import + UI Polish)

This session took the cattle module from "built but empty" to "loaded with 393 cows, 2,121 weigh-ins, 72 comments — verified against Podio to the pound."

**If you only read one thing below, read §13.6 "Lessons and what I wish I knew from the start."** It's the distillation of the bugs Ronnie caught that I almost shipped.

## 13.1 What was built / executed

### New SQL migrations (all applied to production)

- **`002_cattle_comments.sql`** — was queued since April 15 but never applied. This session finally ran it. Table `cattle_comments` now exists in prod. PROJECT.md had flagged this but nobody acted on it; new Claude should **always grep for `IF NOT EXISTS` migrations and verify the table actually exists via a quick query before assuming the feature works.**

- **`004_cattle_import_prep.sql`** — additive + destructive:
  - Created `cattle_breeds` and `cattle_origins` lookup tables (id/label/active/created_at) with RLS + anon-select policies matching existing cattle tables
  - Added `cattle.breeding_status text` (nullable, values Open/Pregnant/N/A, rendered only for sex in cow/heifer)
  - Widened `cattle_comments.source` CHECK to allow `'import'` in addition to the four existing values
  - Replaced `idx_cattle_tag_unique` with `idx_cattle_tag_active_unique` — tag uniqueness is now enforced **only for active herds** (mommas/backgrounders/finishers/bulls). Historical tag reuse across processed/deceased/sold records is permitted. **Ronnie explicitly chose this** over the "suffix older duplicate" approach.
  - Dropped four deprecated columns: `breeding_blacklist_reason`, `sire_reg_num`, `receiving_weight`, `notes`. All are superseded by comment timeline / weigh-in / single sire field.

### Data import (`scripts/import_cattle.js` — preview-then-commit pattern)

Imported from `c:\Users\Ronni\OneDrive\Desktop\Cattle upload from Podio\Cattle Tracker - All Cattle Tracker.xlsx`:

- **393 cattle rows** (from 469 xlsx rows — 76 were Podio template-stubs with no tag and were skipped; 3 duplicate tag collisions on outcome-herd cows were kept as separate records because the unique index no longer applies to outcome herds)
- **8 breeds** seeded (3 active: WAGYU-ANGUS CROSS, FULL BLOOD WAGYU, ANGUS; 5 inactive because only outcome-herd cows hold them: WAGYU CROSS - OTHER, WAGYU-CHAROLAIS CROSS, CHAROLAIS, SOUTH POLL, CRACKER)
- **10 origins** seeded (all active)
- **10 `cattle_processing_batches`** — one per unique Podio "Processing Date" (9 with real dates, status=`complete`; 1 "Unknown Date" planned batch for cows with hanging/yield data but no processing date)
- **195 receiving-weight weigh-ins** seeded (one synthetic session per cow with a Podio "Receiving Weight" field; later merged + reduced to 191)
- **72 `cattle_comments`** from `podio_comments_29337625_2026-04-16.csv` with `source='import'`, `team_member='Import'`, original `created_at` timestamps preserved
- Zero orphan tags. Zero unresolved dam/sire refs.

### Weigh-ins import (`scripts/import_weighins.js`)

Imported from `Weigh Ins - All Weigh Ins.xlsx`:

- **1,930 weigh-ins across 69 sessions** (one session per unique date, `herd=null`, `team_member='Import'`, `status='complete'`, `notes='Imported from Podio'`)
- Date range 2021-10-01 → 2026-03-18
- Each weigh-in's `tag` = the xlsx `Tag #` (historical tag at time of weighing), preserving history across retags. `entered_at` = date-at-noon UTC (deterministic).
- **Ronnie's directive was deliberately narrow:** "just match weight with tag number, status of the tag doesn't change." No session-herd attribution, no retag detection in the importer. Simple + honest.

### Session merge (`scripts/merge_sessions_by_date.js`)

Podio imports created the 69 date-sessions in parallel with 195 per-cow receiving-weight sessions. Merged all cattle sessions so there's exactly one per unique date:

- Before: 264 cattle sessions
- After: 92 cattle sessions (one per unique date)
- Preference rule: if a `wsess-imp-<date>` existed for that date, it became canonical; otherwise the session with the most entries won
- Canonical session has `herd=null` and `notes` reflects merge
- 172 obsolete sessions deleted; 172 weigh_ins repointed

### UI work in `index.html` (all in CattleHerdsView / CowDetail / CattleBatchesView / the five *DailysView components)

CattleHerdsView / cow add-edit modal:
- Breed → active-filtered dropdown with a "(historical)" option if the cow's current breed is inactive
- Origin → dropdown + `+ Add new origin…` (inserts into `cattle_origins`, calls `sb.from('cattle_origins').insert`)
- Breeding Status field, shown only for `sex ∈ ('cow','heifer')`
- Removed from the form entirely: Receiving Weight input, Sire Reg # input, blacklist reason, flat Notes textarea
- Maternal flag + Blacklist flag combined into a single vertical block with `display:inline-flex` + `alignSelf:flex-start` (previous grid + flex layout put the text at the right edge — see §13.4 bug 8)
- Herd tiles collapsible via `expandedHerds[h]` state, **default collapsed** so the page loads compact
- Cow rows switched from `display:flex; flexWrap:wrap` with `minWidth` to **fixed CSS grid columns** — long breeds / long ages no longer push later columns right
- Darker-red background (`#fecaca`) for cow rows where `breeding_blacklist=true`
- Search string now spans outcome cows too (was stuck in active-only view when the user had the default filter)

CowDetail:
- Removed flat-notes block, `receiving_weight` line, `sire_reg_num` fallback, the Calves: list in Lineage (redundant with Calving History)
- Added Breeding Status row (female only)
- Comments timeline: per-row Edit + Delete; `source='import'` gets a distinct amber color; team_member rendered bold
- Pinned "BREEDING BLACKLIST" card at the bottom of the timeline when flagged (non-dated, sits beneath all dated comments)
- Calving History **auto-synthesizes entries from `calves[].birth_date` when no explicit `cattle_calving_records` exist** (labeled "(from calf record)"). Explicit records take priority — adding a calving with `calf_tag=X` replaces the synthetic.

CattleBatchesView:
- Each batch tile displays its cow list as removable yellow chips (× to unlink)
- `+ Add cow from finishers (N available)` dropdown per batch; adding a cow sets `processing_batch_id` AND moves the cow to `herd='processed'` with a `cattle_transfers` row

All 5 Dailys views (Broiler / Layer / Egg / Pig / Cattle):
- Switched from flex+minWidth to CSS grid with fixed column widths (date / batch / team / feed / etc.)
- **Mortality moved out of the top-row trailing zone and relocated to a second line next to the comment** (Ronnie's idea — keeps top row compact and predictable even when mortality has a long reason string)
- All conditional badges (Moved / Waterer / Fence / Nipple / Add-Feed 🌾) live in a trailing `1fr` flex zone so they can wrap without breaking core columns

CattleWeighInsView:
- Removed the "avg weight" pill per Ronnie
- Session list sorted by `date DESC, started_at DESC` (was `started_at` only — put the entire import cluster at the top because `started_at` defaulted to commit time)

Pagination:
- Added `wcfSelectAll(buildRangeQuery)` helper at top of index.html; wraps the repeated `.range(0, 999)` + accumulate pattern
- Applied to **all four cattle-view `weigh_ins` queries** (CattleHome dashboard, CattleHerdsView, CattleBatchesView, CattleWeighInsView). Without this, they silently cap at 1000 rows and most sessions showed "0 entries" after the import (see §13.4 bug 3).

## 13.2 Migration artifacts

### Scripts dropped in `scripts/` during this session (may be deleted after deploy or kept as reference):

| File | Purpose |
|---|---|
| `orphan_count.js` | one-off audit: do all comment CSV tags match a cow? (answer: yes, 72/72) |
| `tag_audit.js` | found the 76 blank-tag rows and 3 duplicate-tag pairs |
| `blank_audit.js` | verified blank-tag rows have no real data (all Nick Santalucia placeholders) |
| `inspect_weighins.js` / `weighin_audit.js` / `weighin_orphan_recheck.js` | weigh-in xlsx shape + cross-ref against DB cattle (0 truly orphaned once we fall back through Tag # → Cow → old_tags) |
| `import_cattle.js` | **main cattle tracker importer** — preview-then-commit, idempotent |
| `import_weighins.js` | **main weigh-in importer** — preview-then-commit, idempotent |
| `merge_sessions_by_date.js` | collapsed 264 → 92 cattle sessions after the duplicate-per-date cleanup |
| `zero_weight_audit.js` / `session_audit.js` / `show_0416.js` | diagnostics hunting for the "0 entries" bug |
| `purge_0416.js` | deleted the 4 fallback-dated (2026-04-16) receiving-weight rows |
| `fix_rcv_entered_at.js` | patched 191 receiving-weight `entered_at` values to their session's date |
| `herd_weights_audit.js` / `herd_weights_audit_v2.js` / `cow_sanity.js` / `mommas_diff_check.js` / `mommas_rcv_only.js` | debugging herd-total discrepancies |
| `compare_last_weight.js` | **the script Ronnie asked for** — row-by-row comparison of each cow's Podio "Last Recorded Weight" to our computed latest. Pinpointed cow #254 as the source of the 242 lb Mommas gap. Updated to match the app's `cowTagSet` logic (excludes `source='import'` tags). |
| `xlsx_vs_db_diff.js` | multiset diff of xlsx rows vs DB weigh_ins. Found the 30 extra broiler weigh-ins leaking in. |
| `cow254.js` | deep-dive on the specific cow with the 242 lb discrepancy |

### `.env` handling

- `scripts/.env` holds `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY`. Already in `.gitignore` (line 69). **Safe to keep locally, MUST NOT be committed.**
- **The live service-role key was pasted into the chat transcript** by Ronnie during onboarding. Value redacted here; see Outstanding items for rotation instructions. Supabase dashboard → API Keys → Secret keys → ⋮ → Rotate.

## 13.3 Final verification — how we know the data is right

Pixel-perfect comparison (see `scripts/compare_last_weight.js`):

| Herd | Podio "Last Recorded Weight" sum | Our computed latest sum | Diff |
|---|---|---|---|
| Mommas (148 cows) | 82,823 lb | **82,823 lb** | **0** |
| Finishers (59 cows) | 44,809 lb | **44,809 lb** | **0** |

Row-level xlsx → DB diff (see `scripts/xlsx_vs_db_diff.js`):
- xlsx: 1,930 valid rows
- DB (excluding receiving-weight imports, scoped to cattle-species sessions): 1,930 rows
- Zero missing, zero extra after filtering broiler contamination

**Ronnie caught this.** I initially said "I'm 99% sure the numbers match" while the real answer was "I haven't actually verified row by row." When he asked "100%?" I had to stop and actually verify. **Don't claim confidence you haven't earned. Always verify before asserting.**

## 13.4 Bugs found and fixed during this session (in chronological order)

1. **Migration 002 never applied.** `cattle_comments` table didn't exist in production. Discovered when the first CHECK-constraint part of migration 004 failed with "relation cattle_comments does not exist." Fix: ran 002 inline followed by the remaining 004 pieces. **Takeaway: grep for unapplied migrations at session start and verify.**

2. **Today-as-fallback for receiving-weight dates.** `import_cattle.js` had `date = purchase_date || birth_date || today`. Four cows with neither purchase_date nor birth_date got `entered_at = 2026-04-16`, polluting the Weigh-Ins view. Fix: `scripts/purge_0416.js` deleted the 4 rows. **Takeaway: if no valid date is available for historical data, skip the row — don't silently use today.**

3. **Supabase's 1000-row default response cap** silently truncated unpaged queries. The Cattle Weigh-Ins view showed "92 sessions · 1000 total entries" but we'd imported 2,125. Sessions beyond the first 1000 appeared with "0 entries." Fix: `wcfSelectAll` paging helper applied to all four cattle-view weigh_ins queries. **Takeaway: always paginate tables that can grow past 1000.**

4. **`entered_at` defaulted to `now()` on receiving-weight imports.** Import script set `weigh_in_sessions.date` correctly but forgot to set `weigh_ins.entered_at` — so it defaulted to the moment of import (2026-04-16T20:16:11). Sorting by `entered_at DESC` made every cow's "latest weigh-in" the receiving weight, not the real Podio weigh-ins. Herd totals were wildly off (finishers showed 33,241 instead of 44,809 — a 25% shortfall). Fix: `scripts/fix_rcv_entered_at.js` patched 191 rows. **Takeaway: always set explicit timestamps on historical imports. Never trust `DEFAULT now()` for backfill.**

5. **Cross-species tag collision (the near-miss).** `weigh_ins` is a shared table across cattle/broiler/pig — `weigh_in_sessions.species` distinguishes. My cattle views filtered `weigh_ins` by `tag` alone. A cow tagged #3 (sold) was pulling a broiler's 2.6 lb weigh-in as her "latest" because broiler schooner labels happened to be "2" and "3" — same string as cattle tag numbers. Fix: all four cattle queries now fetch cattle session IDs first, then use `.in('session_id', cattleSessIds)` to filter weigh_ins. **Takeaway: any query against a multi-species shared table needs species scoping, always.**

6. **Purchase-farm tag stored in `cattle.old_tags` caused false weight lookups.** `import_cattle.js` crammed `purchase_tag_id` (the tag from the selling farm — e.g., Jimmy Horn's tag #146 on cow #254) into `cattle.old_tags` with `source: 'import'`. The app's `cowTagSet(cow)` returned all old_tags regardless of source, so weight-history and last-weight lookups walked the full set. When cow #254's purchase tag "146" matched a completely unrelated WCF cow also currently tagged #146 (a finisher), she inherited his 878 lb latest weight instead of her own 1,120 lb. That single cow accounted for all 242 lb of the Mommas herd discrepancy. Fix: `cowTagSet` now excludes entries with `source === 'import'`. **Takeaway: semantically different "prior tags" must NOT share a lookup domain. Purchase tags are selling-farm numbers that can collide with WCF numbers; WCF retags cannot.**

7. **Calving History empty for imported mommas.** We didn't import `cattle_calving_records` from Podio (Ronnie said there was no separate calving app). Cow profiles said "No calving records yet" while clearly showing "2 calves" in Lineage. Fix: CowDetail's Calving History now synthesizes entries from `calves[].birth_date` when no explicit record exists for that calf tag. Labels them "(from calf record)" so users know.

8. **Checkbox layout breaking.** `<label style={{display:'flex', alignItems:'center', gap:8}}>` inside a full-width grid cell rendered with the text pushed to the right edge and the checkbox floating in the middle. Fix: switched to `display:'inline-flex'` + `alignSelf:'flex-start'` so the label sits at the left and sizes to content.

9. **Dangling `c.notes` reference** in the flat-mode search filter after migration 004 dropped `cattle.notes`. Would have thrown if anyone searched while on the outcome filter.

10. **Unicode-in-JSX-text gotcha.** Wrote `Flagged \u2014 do not breed.` as JSX text and the escape didn't apply — Babel treated it as literal backslash-u. Must write `{'Flagged \u2014 do not breed.'}` or escape differently. PROJECT.md §1 "Critical Codebase Constraints" already flags this but it's easy to regress.

11. **CSS grid vs flex+minWidth for tabular rows.** Cow rows and dailys rows used `display:flex; flexWrap:wrap` with `minWidth:60` etc. When content exceeded `minWidth`, the row shifted right. Fix: `display:grid; gridTemplateColumns:'70px 110px 60px 180px 70px 90px 1fr'`. Columns now stay put. Applied to CattleHerdsView cow rows (both herd-tile and flat modes) and all five dailys views.

## 13.5 Outstanding items

1. **Service-role key rotation.** The active secret (value not repeated here) was pasted into the chat transcript during this session and is therefore exposed. Rotate via Supabase dashboard (Project Settings → API Keys → Secret keys → ⋮ → Rotate) before end of day. Update `scripts/.env` with the new value afterward.

2. **Cattle Dailys xlsx import.** Ronnie has a `Cattle Daily's - All Cattle Daily's.xlsx` file on his Desktop. The pattern from `import_cattle.js` / `import_weighins.js` applies — preview, commit, idempotent IDs. Not yet written.

3. **Processing batches still have raw dates as names.** All 10 imported batches are named "2025-12-19" / "Unknown Date" etc. Ronnie said he'll rename/renumber them himself after import.

4. **25 Mommas have no weigh-in data at all** (tags mostly 700+). Expected — they're recently added. They'll show `—` in the weight column and contribute 0 to herd totals until their first weigh-in. Not a bug.

5. **Imported weigh-in sessions all have `herd=null`.** The Weigh-Ins admin view shows "Unknown herd" for each of the 92 sessions. Expected — Podio didn't record which herd was targeted. Not a bug, but the UI text could be softer ("Imported session" instead of "Unknown herd"). Low priority.

6. **Broiler + pig admin Weigh-Ins view still shows "avg weight" pill.** Only cattle was removed per Ronnie's request. For broilers, the avg IS load-bearing (gates the batch week4Lbs/week6Lbs write). Leave alone unless asked.

7. **Scripts in `scripts/`.** All reference `c:/Users/Ronni/OneDrive/Desktop/...` paths. Fine for Ronnie's machine, useless on CI. Either commit them for posterity (good for future Claude) or gitignore the folder. My recommendation: commit them — they document exactly how the import worked, and reruns are idempotent so they can't do damage.

## 13.6 Lessons and what I wish I knew from the start

**If you're a fresh Claude reading this: read this section twice.** These are the traps I fell into. You'll hit many of them too.

### About data imports specifically

1. **Always set explicit timestamps on historical inserts.** `DEFAULT now()` is sensible for real-time rows and catastrophic for backfills. Every `entered_at`, `created_at`, `started_at` on imported data must be explicitly set to the historical value. I missed this on the cattle tracker receiving-weight import and it corrupted every cow's "latest weigh-in" until Ronnie noticed herd totals were way off.

2. **Don't overload semantic meaning in one column.** I stuffed Podio's `Purchase Tag ID` (seller-farm tag, can collide with unrelated WCF tags) and prospective WCF retag history into the same `cattle.old_tags` jsonb array, using `source` only as metadata. Then the display code ignored `source` when doing weight-history lookups. Either: use separate columns for semantically different data, OR always filter by the discriminator wherever you use the column. Partial filtering is worse than none — it looks correct in the 99% case and fails silently for the 1%.

3. **Multi-species shared tables are a trap.** `weigh_ins` is shared across cattle/broiler/pig via `weigh_in_sessions.species`. Every single query that filters weigh_ins by `tag` alone is a latent cross-species collision. The ONLY correct patterns are: (a) fetch species-scoped session IDs first, then `.in('session_id', ids)`, or (b) add a denormalized species column to `weigh_ins`. I chose (a) for now. If you add a third table that shares weigh_ins or if performance matters, reconsider (b).

4. **Supabase's 1000-row default response cap is silent.** It doesn't error, doesn't warn, doesn't include a "truncated: true" header. It just gives you the first 1000. If you know a table can grow past that, always use `.range()` pagination. I built `wcfSelectAll` late — should have started with it.

5. **Idempotent imports via deterministic IDs are worth it.** Every import script uses `shortHash(tag|date|weight|ordinal)` or similar for IDs, plus PostgREST's `Prefer: resolution=merge-duplicates`. A rerun after a partial failure is safe — no duplicates, no manual cleanup. Pay this cost up front.

6. **Preview-then-commit is the right default for destructive work.** Every script this session had a `--commit` flag and printed a preview by default. Ronnie interrupted one run; others he approved after reviewing the preview. Zero accidents.

7. **Verify imports row-by-row, not just aggregate.** Sum of weights matching ± 0.3% isn't proof of correctness — it's proof of luck. The row-by-row diff (`xlsx_vs_db_diff.js`) surfaced the broiler leak AND the purchase-tag bug AND the missing 0.3% all at once. A summary-only check would have missed two of three.

### About the domain

8. **Cattle retagging is a real thing, and `purchase_tag_id` is NOT a prior WCF tag.** Podio's "Purchase Tag ID" = the tag the cow arrived with from the selling farm. It should **display** on the cow's profile (Ronnie wants to see "previously #146") but must **not be used for weigh-in lookups** because numbering collisions with WCF's own tag range are common. Actual WCF retags (via the weigh-in reconcile flow) get stored with a different `source` marker and ARE valid for lookups.

9. **Podio exports include computed / derived / stale fields.** Don't trust them uncritically:
   - `Cow` column = reference to the cow's current tag (may differ from `Tag #`)
   - `Last Recorded Weight` = cached computed field (mostly matches Weight History but can lag)
   - `Age` = computed from Birth Date (shows "NaN" for placeholder rows)
   - `Tags` column = usually empty, Podio-internal
   - Placeholder rows created by the Podio app template (76 of 469 in the cattle tracker)
   - Always explicitly filter / recompute / skip these rather than passing them through.

10. **Weigh-in data fundamentally belongs to the tag, not the cow.** Ronnie was clear about this: "We only need to match weight with tag number. Status of the tag number doesn't change." Resist the urge to over-engineer session-by-herd attribution or cow-at-time-of-weighing tracking. The tag IS the identity at the moment of weighing. Retag display is a separate concern (the cow profile shows "Previous tags" and the weight-history filter spans all her WCF tags).

11. **Ronnie's "we don't need X" means X, literally.** He said "we don't need average weight" and I removed it from CattleWeighInsView only (kept it in broiler/pig where it's load-bearing). He said "we don't need the calves displayed since we have the calving history" — I removed the Calves: line from CowDetail's Lineage section. Trust the terseness; ask only if ambiguous.

### About collaboration

12. **Honest uncertainty beats false confidence, every time.** When Ronnie asked "are you 100% that the data matches?" — the true answer was "I haven't verified row by row; let me do that now." Saying "yes, I'm 99% sure" is worse than "no, I haven't — let me check." He's sharp enough to catch fake confidence. Admit the gap and close it.

13. **Ronnie verifies.** He spot-checks screenshots, he cross-references against Podio, he pushes back on numbers. When he pushes back, he's almost always right. Treat pushback as a gift — it prevents silent data corruption from shipping.

14. **Deploy SOP is not optional.** `NEVER run git commit, git push, or any deploy command without explicit approval in the current session turn.` This applies to service-role SQL and data mutations too. Every destructive commit this session was preview-first, approval-second. **One-time approval doesn't carry forward.** Even when Ronnie just approved a commit, re-ask for the next one unless he explicitly said "go ahead on all of these."

### About the codebase specifically

15. **`index.html` is 15,500 lines. Use Grep to navigate, not Read.** Whole-file reads cost context. Grep for component names, known symbols, or the exact string you want to change, then Read a 50-line slice around it. PROJECT.md §4 has line-number approximations that drift but are still useful starting points.

16. **Babel-in-browser has sharp edges.** PROJECT.md §1 lists them. The ones that bit me this session: (a) unicode in JSX text needs `{'\u2014'}`, not raw `\u2014`; (b) `const` inside nested conditional blocks can crash; (c) no React hook rules violations. I avoided a runtime crash by following these but almost regressed on (a).

17. **CSS grid for tabular data, not flex+minWidth.** `display:flex; flexWrap:wrap` with `minWidth:60` looks OK on paper and breaks the moment any column's content exceeds minWidth — all subsequent columns shift right. CSS grid with fixed `gridTemplateColumns` keeps rows locked. Applied to every tabular list that had the problem this session.

18. **The webform reconcile flow and the tag_unique partial index work together.** Migration 004 allows duplicate tags only across outcome-herd records (processed/deceased/sold). If someone tries to move a duplicate-tag cow back into an active herd, the insert/update will fail with a constraint violation — that's the system doing its job. Don't try to suppress the error; the user needs to rename first.

### Updated commit list at end of session

Nothing committed this session yet at time of writing — Ronnie asked for the PROJECT.md update and confirmed we'll deploy after. Expected commits:

```
(pending)  Cattle Podio data import — breeds/origins tables, breeding_status, tag index relax,
           cattle tracker import + weigh-in import + session merge, receiving-weight entered_at fix,
           cross-species weigh_ins scoping, purchase-tag exclusion from weight lookups, UI polish across
           CattleHerdsView / CowDetail / CattleBatchesView / all 5 dailys views, pagination helper
```

All import scripts + audit scripts live in `scripts/`. Recommend committing them for posterity.

---

*End of April 16 session. Future Claude: the data is clean, the UI is tight, the schema is right. Your job is to keep it that way. Read §13.6 one more time. Good luck.*

---

# 14. Session Update — April 17, 2026 (Cattle Dailys Import, UX Polish, Bug Sweep)

This session picked up the morning after the §13 deploy. Started with the Cattle Dailys Podio import, then moved into a round of UX tweaks Ronnie surfaced while smoke-testing. Two bugs he caught mid-session that weren't on the list (mortality ghost on the public cattle webform + admin required-field designations being ignored on cattle) are also in here.

**Start here if you're a fresh Claude:** §14.5 "Outstanding — what to surface at the start of next session" tells you exactly what to ask Ronnie first.

## 14.1 What was done (deployed in commit `bc2cc24`)

Delivered + pushed to production:

- **Cattle Dailys import** (`scripts/import_cattle_dailys.js`, preview-first + idempotent)
  - 1,515 rows inserted into `cattle_dailys` (from 1,534 source: -4 blank-date, -4 OTHER-group per Ronnie's "skip" directive, -11 strict duplicates)
  - 12 `cattle_feed_inputs` seeded with computed Protein/NFC % from per-row DM/Protein/NFC lbs (hay types + Citrus Pellets + Alfalfa Pellets)
  - Each daily's `feeds` jsonb carries a per-row `nutrition_snapshot` (honest — the hay nutrition varied batch-to-batch in Podio's data)
  - Source tagged `podio_import` so the filter chips in the Dailys view can distinguish it
  - `water_checked` populated from `Waterers checked?` column (new in the re-export)
  - `mortality_count` left at 0 for all imported rows (narrative preserved in `issues`); "None" normalized to null
  - Audit scripts: `inspect_dailys.js`, `dailys_audit.js`, `dailys_feed_types.js`, `dailys_feeds_by_herd.js`, `dailys_strict_dupes.js`

- **Feed-input nutrition seed from real lab values** (`scripts/seed_feed_inputs.js`)
  - Ronnie supplied per-hay-type Bale Weight (as-fed lbs), Moisture %, Protein %, NFC %. Script back-calculated as-fed bale weight from DM / (1 - moisture/100) since Podio gave DM per bale rather than as-fed, and wrote through PATCH for all 12 feed rows.
  - Never touches `cost_per_unit`, `freight_per_truck`, `units_per_truck` — Ronnie fills those himself.
  - Baleage values (RYE BALEAGE 1,450 lb/bale, CRABGRASS 1,465 lb/bale) **verified by Ronnie personally weighing them** — leave these alone.

- **Livestock Feed Inputs form — DM per unit (computed) field**
  - Read-only display in the edit modal that updates live as user types bale weight + moisture.
  - Companion DM chip on each feed card so DM is visible at a glance.

- **CattleHomeView dashboard weight fix**
  - Dropped `fallback_cow_weight_lbs` phantom weight (was adding 30,000 lb to Mommas for 25 unweighed cows). Mommas dashboard now reads exactly 82,823 matching Podio.
  - Weight lookup now goes through `cowTagSet(cow)` with `old_tags` fallback (excluding `source='import'` purchase tags — same partial-lookup issue from §13.6 that could bite here too).

- **Four JSX `\u` literal regressions fixed** (dashboard Target line, pig breeding tooltip, broiler batches table, layer housing dropdown). Babel still treats `\u0000` in raw JSX text as literal — must be `{'\u0000'}`.

- **Mortality removed from cattle daily webform (config-layer)**
  - Stripped `s-mortality` section from `DEFAULT_WEBFORMS_CONFIG`, the cattle-dailys injection block, the load-time strip in `loadAllData`, and the sync normalization in `syncWebformConfig` so `webform_config.full_config` (the anon public feed) also stays clean.
  - Broiler / Layer / Pig webforms left untouched — mortality IS still captured there.

- **Feed Cost by Month admin tab** (`FeedCostByMonthPanel`)
  - New tab added to the admin panel sub-nav (`Webforms · Feed · Cost by Month`). Table aggregates monthly feed spend across all four programs.
  - Broiler / Layer / Pig use flat $/lb rates from `ppp-feed-costs-v1`; Cattle uses per-feed `cost_per_unit + freight_per_truck/units_per_truck` from `cattle_feed_inputs` × `qty`.
  - Uses current costs for all months (no historical per-month ledger). Retroactive price edits re-calculate the whole table.
  - Most cattle cells will show `—` until Ronnie fills in cost per feed in the Livestock Feed Inputs panel.

## 14.2 What was done (built this session, NOT yet committed)

Everything below is sitting in the working tree. **These need to be committed + pushed.** See §14.5 item 1.

- **Cattle sub-nav reorder** — `Dashboard · Herds · Breeding · Weigh-Ins · Dailys · Batches` (per Ronnie's request). One-line change at line 5471.

- **Livestock Feed Inputs panel: collapsible + 1-line-per-item table**
  - Default collapsed, header shows `(12)` count and click-to-expand hint.
  - Card grid replaced with a tight 8-column table: Name · Category · Unit/Weight · DM · Moist · P%/NFC% · Landed $/lb · Actions (📎 / Edit). Row click still opens the edit modal.

- **Cattle weigh_ins module-level cache** (`loadCattleWeighInsCached(sb)`, 30s TTL)
  - All 4 cattle views (Home / Herds / Batches / Weigh-Ins) now share a single sorted weigh_ins payload instead of each re-fetching 2,125 rows across 3 paginated round-trips. Nav between sub-tabs is now instant.
  - Cache auto-invalidates after writes (`reconcileNewTag`, `deleteSession`, and every new write path in the new admin functionality below).
  - Does NOT help cold start (still 3 round-trips on first open); see §14.5 item 4.

- **Cattle Weigh-In tab is now fully functional admin-side**
  - `CattleNewWeighInModal` — in-page modal for date + team + herd → creates a draft session without touching the public webform (no more hash-reload pattern).
  - Per-session actions: `✓ Complete Session` (drafts) · `Reopen Session` (complete ones) · `Delete Session`. All previous webform-navigating buttons (`Resume in Webform`, `Reopen`, `Add More in Webform`) removed.
  - Per-entry admin actions: `Edit` (inline form with tag/weight/note) · `Delete`. Saves invalidate cache + reload. Edit recomputes `new_tag_flag` based on whether the tag matches any current cow.
  - `+ Add entry` row at the bottom of each expanded session for in-page entry creation without leaving the tab.
  - Sets stage for Ronnie's "we should never go to webforms from dailys or weigh-in" directive.

- **Public cattle webform — hardcoded mortality block removed from render**
  - `index.html` around the old line 3401. Config-level strip (from §13) wasn't enough because the public webform's cattle render had mortality hardcoded in the JSX, independent of the config. Now gone.

- **Public cattle `submitCattle` now honors admin required-field designations**
  - Before: only date / teamMember / herd were validated on the cattle webform, so toggling a field "required" in the admin panel did nothing for cattle.
  - After: builds a `valuesByFieldId` object (with `'filled'` placeholder for `feeds` / `minerals` when any row has a qty) and calls `validateRequiredFields('cattle-dailys', valuesByFieldId)`. Broiler / Layer / Pig / Egg already used this pattern — cattle was the odd one out.

- **AdminAddReportModal now supports cattle**
  - `formType="cattle"` opens the full cattle form inline (date/team/herd + feeds with creep toggle for Mommas + minerals + fence voltage + waterers + issues). No mortality.
  - Loads `cattle_feed_inputs` on mount when cattle is the active formType.
  - Saves as `source:'admin_add_report'`.

- **CattleDailysView `+ New Report` → opens modal in-page**
  - Previously navigated to the public `#webforms` flow (broken back-button UX per Ronnie). Now uses `AdminAddReportModal` like the other 4 dailys views.

- **All `🔗 Webforms` top-bar links removed from the 5 dailys views**
  - Broiler / Layer / Egg / Pig / Cattle. No more dead-end hash navigation that broke the browser back button.

- **Batches tab: total_hanging_weight seeded** (script already run)
  - `scripts/seed_batch_hanging_weights.js` summed linked-cow `hanging_weight` per batch and PATCHed 8 `cattle_processing_batches` rows.
  - Script ran successfully — but the index.html changes above are still pending a commit.

## 14.3 Bugs caught + fixed this session

Four of these were Ronnie-caught (good), not self-caught. Most important ones first:

1. **Mortality ghost on public cattle webform** (Ronnie flagged mid-session). Config strip was in place, but the public webform render had the mortality block hardcoded in JSX. Removed the block. **Lesson:** config-driven rendering is only honored where the render code actually reads the config. Always grep the render code too, not just the config.

2. **Admin required-field designations ignored by cattle webform** (Ronnie flagged same turn). `submitCattle` was doing hardcoded required checks (date / team / herd only) instead of calling `validateRequiredFields()` like the other 4 program submitters. **Lesson:** the 5 program submit functions need parity with the config-driven validation pattern. When a new program is added, check it uses `validateRequiredFields`.

3. **CattleHomeView dashboard over-counting** — `fallback_cow_weight_lbs` was adding phantom weight for unweighed cows (Mommas target has 1,200 lb fallback × 25 unweighed cows = 30,000 lb). Removed the fallback; unweighed cows now contribute 0 (matches Podio's own "Last Recorded Weight" sum behavior).

4. **JSX text regression on the `\u` escape** — four separate spots shipped with raw `\u00b7` or `\u2014` in JSX children text. Babel leaves those literal. Must use `{'\u00b7'}` form. This is in PROJECT.md §1 but is easy to regress.

5. **Public webform hash navigation breaks the browser back button** — Ronnie explicitly called this out. Mitigated by removing the dead-end `Webforms` top-bar links from dailys views AND by adding in-page modals for the cattle "New Report" and "New Weigh-In" flows. Full pushState/popstate back-button support is still deferred (see §14.5 item 3).

## 14.4 Artifacts added this session

Under `scripts/` (all idempotent, preview-first, safe to rerun):

| File | Purpose |
|---|---|
| `inspect_dailys.js` / `dailys_audit.js` / `dailys_feed_types.js` / `dailys_feeds_by_herd.js` / `dailys_strict_dupes.js` | Pre-import audits for the Podio cattle dailys xlsx |
| `import_cattle_dailys.js` | Main importer — 1,515 dailys + 12 feed inputs |
| `seed_feed_inputs.js` | Update the 12 feed inputs with Ronnie-supplied bale weights + moisture + P% + NFC% |
| `strip_mortality_from_webform_config.js` | One-time patch of `webform_config.full_config` to remove s-mortality (already ran successfully during §13 sync; left for future reference) |
| `seed_batch_hanging_weights.js` | Sum per-cow hanging_weight per batch → PATCH `cattle_processing_batches.total_hanging_weight`. **Ran successfully** — 8 batches updated. |

## 14.5 Outstanding — what to surface at the start of the next session

Next Claude: **proactively ask Ronnie about each of these at session start** before diving into new work. Numbered in priority order.

1. **Commit + push the pending in-flight changes.** Everything in §14.2 is sitting in the working tree uncommitted. Run:
   ```
   git status
   ```
   You should see `index.html` modified plus the new scripts. Draft a commit message covering the 14.2 bullet list. Confirm with Ronnie, then commit + push. Netlify auto-deploys from `main`.

2. **Rotate the service-role key.** Ronnie rotated once yesterday after §13, then rotated a second time mid-session today because he needed to paste the new key into the chat transcript to unblock a script run. The current secret is in `scripts/.env` (gitignored). He committed to rotating it again after session wrap-up. Confirm rotation is done and `scripts/.env` has the new value before running any scripts.

3. **Loading slowness on ALL screens.** Ronnie flagged that initial page loads are noticeably slower on every view, not just cattle. Didn't diagnose. Possible causes, in priority order:
   - Cumulative `index.html` size (now ~16.1k lines — Babel in-browser transpile is longer)
   - Something regressed in one of the grid-layout dailys refactors from §13 causing extra renders
   - Module-level cache preload adding a blocking fetch (shouldn't — it's lazy)
   - The `FeedCostByMonthPanel` effect depending on `feedCosts.*` primitives — might be firing repeatedly
   
   First pass: open DevTools Network tab on a cold load and see what's taking time. Then check Performance profile for render hotspots. If it's Babel transpile, the localStorage cache should kick in on second+ load — verify the cache key is stable.

4. **Browser back-button support** (deferred). Ronnie parked this explicitly. The minimum-scoped version (back-button fix for webforms → dailys) was solved differently this session (removing the dead-end links). The broader "pushState on tab change" design he asked about is still open. Design note: hash is already used for public-auth bridge and requires reload; use a prefix like `#view=<name>` to avoid collision. Scope it small — only top-level view changes, not modals/expansions.

5. **Cattle Dailys import quality audit** — before building on this data further, have Ronnie spot-check:
   - Does the Mommas / Finishers / Bulls split look right in the Dailys tab (669 / 658 / 188)?
   - Do the historical reports render feed lines with correct hay names + bale quantities?
   - Does the Feed Cost by Month table now populate for cattle once he fills in `cost_per_unit` for a few feeds?

6. **Feed Cost by Month cattle side is blank until feed costs are populated.** Ronnie owns filling in `cost_per_unit`, `freight_per_truck`, `units_per_truck` per feed via the Livestock Feed Inputs panel. Surface this if he asks "why doesn't cattle show any cost."

7. **Outstanding items from §13.5 that are still open:**
   - Imported processing batches are still named as raw dates (e.g. `2025-12-19`). Ronnie owns renaming via the Batches tab.
   - 25 Mommas remain with no weigh-in data (tags mostly 700+). Expected.
   - Imported weigh-in sessions show "Unknown herd" in the admin view (herd=null on purpose). Could soften the label to "Imported session" if he asks. Low priority.
   - Broiler/pig admin Weigh-Ins view still shows `avg weight` pill (intentional — gates `week4Lbs` / `week6Lbs` batch write).

8. **Hard-won lessons from this session** (don't re-learn):
   - **Render-side hardcodes override config-driven behavior.** The mortality bug bit because the strip logic was all at the config layer, but the public webform had mortality hardcoded in JSX. Always check both sides.
   - **Parity across submit functions matters.** 4 of 5 program submitters used `validateRequiredFields`; cattle was the odd one. When adding a new program or changing one, verify validation is wired the same way across all of them.
   - **Module-level caches are easy wins for read-heavy nav patterns.** One module-level variable + 30s TTL + invalidate-on-write covers the "user clicking between sub-tabs" use case. No React Context required.
   - **Back-button fixes can often be dodged by removing the dead-end links instead of adding pushState plumbing.** If the only reason the back button matters is a link that users shouldn't click, remove the link.
   - **Don't trust `fallback_*` fields in dashboard calculations.** If a fallback is applied silently, aggregates drift from reality and you get "why is my herd total 30k lb heavier than Podio" questions later. Better to show honest zeros.

9. **Context budget note for next session.** This session was long (2 days of continuous work on cattle migration + polish). By the end I was being more deliberate about grep vs read, re-verifying line numbers before edits, and watching context. That's fine — but if Ronnie opens session with more than one big chunk of work queued, suggest breaking it across sessions. PROJECT.md §13 + §14 give a fresh Claude everything needed to resume cleanly.

---

*End of April 17 morning session. Commit + push is the very first thing to do next session, before any new changes. Ronnie runs a working farm and needs what's in the repo to match what's in production.*

---

# 15. Session Update — April 17, 2026 (Evening) — Cattle UX deep dive, data cleanups, retag flow

This session ran the entire afternoon/evening and focused on:
- Polishing the cow detail panel into something Ronnie actually wants to use day-to-day
- Cleaning up legacy data quirks from the Podio import (duplicate weigh-ins, missing purchase amounts, missing herd assignments on imported sessions)
- Building the on-the-spot retag flow so bulk-buying 20+ cows doesn't require a reconcile-after nightmare
- Lots of small UX adjustments based on Ronnie iterating live

Six commits landed locally (`618125c` was already pushed at the start; the next six are committed but **NOT pushed** at session wrap — see §15.10).

## 15.1 Farm coordinates (note for future Weather API work)

**WCF lat/lon: `30.84175647927683, -86.43686683451689`**

Hardcode this in any future weather/climate fetches. Single physical site, no need for a location picker. Recorded mid-session per Ronnie's request; also lives in memory at `feedback_*/project_farm_location.md`.

## 15.2 Code shipped this session (in commit order, oldest first)

### `618125c` — big cattle batch (already pushed)
Was the morning session's wrap commit, but worth restating since the rest builds on it:
- Cattle Batches: per-cow `cows_detail` jsonb editing with auto-yield, multi-select cow picker on the New Batch modal, totals computed from per-cow sums
- Cattle Weigh-Ins entries rendered as auto-fill grid (3–4 per row) with inline edit
- Removed all webform-redirect buttons from 4 dailys views + admin Weigh-Ins
- Cattle Home Dashboard nutrition panel (30/90/120-day windows, per herd with cows, DM/CP/NFC actuals vs target with color coding)
- Pig weigh-in **Send-to-Trip** (checkbox-select entries → modal → existing trip or new; updates `ppp-feeders-v1`; `sent_to_trip_id` flag protects sent rows from grid wipe)
- `loadAllData` runs pig + poultry dailys in parallel (cold-load ≈ 50% faster on that phase)
- Deleted dead `sb.from('batches')` 404 fetch in BroilerDailysView
- New scripts: `fix_feed_herd_scope`, `infer_session_herds`, `seed_batch_cows_detail`
- Migrations applied: **005** (`cows_detail` jsonb + `total_live_weight` on `cattle_processing_batches`), **006** (`sent_to_trip_id` + `sent_to_group_id` on `weigh_ins`)

### `e8ca425` — Cow detail panel polish + clickable lineage + back nav
- **Weight history view toggle** Table / Chart. Table: `Date | Weight | Days Since | Change | Lb/Day` with color-coded ADG (green ≥0.3, yellow 0–0.3, red <0). Chart: SVG sparkline with hover tooltip per point. Lifetime ADG footer in both views.
- **Receiving-weight detection** via `session_id` starting with `wsess-rcv-` OR note containing "receiving" — gets a `RECEIVING` badge in table and amber dot in chart.
- **Calving history calf tag → clickable link** that navigates to that calf's detail (via the new nav stack, see below).
- **Lineage dam/sire → clickable** when the target cow exists in the directory.
- **Navigation stack** (`cowNavStack`): jumping into a calf/dam/sire pushes the current cow's id; the target shows `← Back to #X` banner that pops the stack. Handles outcome-herd cows by switching to flat-mode + their status filter.
- Flat-list mode now **expands inline on row click** (was: opened the edit modal). This makes drill-down navigation work uniformly across modes.
- Parent passes full `cowWeighIns` (no `.slice(0,10)`) so lifetime ADG covers her whole history, not just the last 10 entries.

### `3874dca` — Cow detail balanced borders + tag search in Cattle Weigh-Ins
- **Cow detail card border:** changed from asymmetric (4px left + 1px other sides) → **2px equal all sides in herd accent color, rounded 8px, subtle drop shadow, margin inset**. Ronnie flagged the asymmetry as "right side looks cut off" — equal borders fixed it. Card now visually contained within the herd tile.
- **Cattle Weigh-Ins tag search:** new `Search by tag #...` input with clear-× button. When active:
  - Sessions without any matching entries drop out of the list
  - Surviving sessions auto-expand and show only matching entries (no click required)
  - Expand chevron is hidden during search
  - Entry count reads `N of M match`; header reads `Search #247: 3 sessions · 5 matching entries`
  - Case-insensitive substring match (`24` matches `247` and `#24`)

### `4adfcd7` — Cow row index numbers + purchase amount import fix
- **Index numbers** (`1, 2, 3 …`) on each cow row, indexed relative to the current view (flat mode = position in filtered+sorted result; tile mode = position within that herd). Sort by weight desc → row 5 = your fifth-heaviest cow. Makes "how many over X lb after I sort" answerable visually.
- **Purchase amount import bug fixes** in `scripts/import_cattle.js`:
  - `normNum` now strips `$ / , / whitespace` before `Number()` (Podio formats amounts like `"$ 1,523.50"` which the previous parser returned `null` for).
  - **Column name was wrong all along.** The xlsx column is split as `Purchase Amount - amount` + `Purchase Amount - currency` (two cols), not `Purchase Amount`. This bug caused EVERY purchase amount to import as null — 163 cows lost their amounts from day one. See §15.5 for the full story.
- New script `scripts/fix_purchase_amounts.js` — preview-then-commit backfill that re-reads the xlsx with the corrected column name.

### `428c827` — Index moved to far left + vertical divider
- Per Ronnie: the index column moved from "right of the expand arrow" → **far left of the row, with a vertical divider** running the full row height. Used `alignSelf:'stretch' + margin:-10px 0` on the cell to extend the border past the row's vertical padding.
- Applied to both flat mode and tile mode. Order is now `[ # ] | [ ▶ ] [ tag ] [ herd/sex ] [ breed ] [ age ] [ weight ] [ extras ]`.

### `6ccd1ec` — Prior Tags editor in cow edit modal + source-labeled detail
- **Prior Tags section** in the cow add/edit modal — multi-entry list with `tag #` + `date` + `source dropdown` (Purchase tag (selling farm) / Replacement tag (retag) / Other / manual entry) + remove button. `+ Add Prior Tag` appends blank rows. Multiple entries supported (designed for cows that get retagged more than once over time).
- Reads from / writes to `cattle.old_tags` jsonb. Dates round-trip `YYYY-MM-DD` for the picker, ISO for storage.
- **Detail view label** changed from "Previous tags" → "Prior tags" with annotated source per entry: `(purchase)` for `source='import'`, `(retag)` for `source='weigh_in'`.
- No migration — `old_tags` jsonb already existed; this just surfaces it.

### `ac40fd8` — On-the-spot retag flow + source-label consistency (LATEST)
**The big functional addition.** Previously the only way to handle bulk-purchased cattle (20+ at a time) was to enter them with selling-farm tags, weigh them in with new tags as Replacement Tags, then **reconcile every single entry one-by-one after the fact**. Ronnie pointed out this is impossible at scale because by reconcile time the cows are no longer in front of you and you can't remember which new tag replaced which old one. The new flow lets you swap tags AT entry time when you know both numbers.

- **Public webform `WeighInsWebform`** gains a third entry mode `⟳ Retag` alongside `+ New Cow` and `+ Replacement Tag`. Inputs: `Prior tag #` + `New tag #`. On submit:
  - Looks up the cow via `findCowByPriorTag()` walking **current tag → import old_tags → weigh_in old_tags** (the order Ronnie picked).
  - Hard-errors if no match (per Ronnie's #2: "yes hard error so prior tag is an explicit claim the cow should exist").
  - Swaps `cattle.tag` → new tag, appends an `old_tags` entry stamped with `source: 'import'`.
  - Inserts the weigh-in already resolved (`new_tag_flag: false`, `reconcile_intent: 'retag'`).
- **Admin `CattleWeighInsView`** add-entry row gains a `Prior tag (retag)` field. When filled, runs the same on-the-spot retag flow inline. Button label flips to **`Retag + Add`**. Field tints blue when populated.
- **Source labeling normalized across all four write paths.** Was inconsistent before this session (some paths used `'purchase'`, some used `'weigh_in'`, some omitted the field entirely). New convention is **workflow-based, not data-origin**:
  - Known at entry time → `'import'` (renders as **"Purchase tag"**)
    - new_cow priorTag, retag mode (both webform + admin)
  - Reconciled after entry → `'weigh_in'` (renders as **"Retag"**)
    - public `reconcileEntryToCow`, admin `reconcileNewTag` — both previously missing the source field entirely
  - Admin typed manually → `'manual'`

## 15.3 Database changes (all applied to prod)

Ronnie ran every SQL block in the Supabase SQL Editor. Confirmed at end of session.

### Migrations applied
- **005_batch_cows_detail.sql** — `ALTER TABLE cattle_processing_batches ADD COLUMN cows_detail jsonb NOT NULL DEFAULT '[]'::jsonb` + `total_live_weight numeric`.
- **006_weigh_ins_sent_to_trip.sql** — `ALTER TABLE weigh_ins ADD COLUMN sent_to_trip_id TEXT, sent_to_group_id TEXT` + partial index on `sent_to_trip_id WHERE NOT NULL`.

### One-off backfill SQL run by Ronnie
- **`herd_scope` fix** for the 12 imported cattle_feed_inputs (previously `[]` → never rendered in the herd-filtered dropdown):
  ```sql
  UPDATE cattle_feed_inputs
  SET herd_scope = ARRAY['mommas','backgrounders','finishers','bulls']::text[]
  WHERE herd_scope IS NULL OR cardinality(herd_scope) = 0;
  ```
  **Note for future Claude: `herd_scope` is `text[]`, NOT `jsonb`.** Migration 001 used Postgres array there, inconsistent with `cattle_dailys.feeds` (jsonb). Use `cardinality()` + `ARRAY[]::text[]` for any future updates to that column.
- **Session herd backfill** via majority-tag vote — 76 of 83 imported `wsess-imp-*` and `wsess-rcv-*` sessions got a herd. 7 had no matching tags (stay null = "Unknown herd"). Zero ties.
- **Batch `cows_detail` backfill** — populated per-cow live (latest cattle weigh-in on or before processing date) + hanging (from `cattle.hanging_weight`) for every cow with `processing_batch_id IS NOT NULL`.
- **Duplicate weigh-in cleanup.** The Podio import created two rows for many cows' first weigh-in: one in a `wsess-rcv-cattle-*` session (from cattle_tracker.Receiving Weight) and one in a `wsess-imp-YYYY-MM-DD` session (from the weigh-ins xlsx). For pairs with same tag + same weight + dates within ±1 day, the rcv copy was deleted (the imp copy has more context). Then a third query dropped any now-empty `wsess-rcv-*` sessions.
- **Purchase amount backfill — three buckets.** All three ran successfully.
  - 117 cows from xlsx via `scripts/purchase_amounts_backfill.sql` (long VALUES list — 117 rows).
  - 19 Story Farms cows × $2,036.64 (`tag IN ('334'..'352')`).
  - 6 Hufeisen Ranch cows mapped by their prior tag (54/57/59/61/66/78 → $2000/$2750/$2750/$2250/$2250/$2000).
  - Ronnie also manually fixed cow #372 (mis-origined; actually Woodham, $4,500).
  - 6 Woodham calves (tags 710, 712, 713, 715, 718, 719) intentionally stay null — they came free with the mommas purchase.
  - 14 cows from "UNKNOWN" origin (pre-2022 records) and 2 from "LOTUS HILL (LORA)" remain null — likely unrecoverable.

## 15.4 Outstanding — what to ask Ronnie at start of next session

**THE TOP ITEM.** A new cattle import is queued and parked on Ronnie's answers to 12 questions:

### New Momma Planner Import — `c:\Users\Ronni\OneDrive\Desktop\New Momma Planner Import.xlsx`

**Two sheets, 41 cows total:**
- **Sheet 1 "A to Z"** — 17 heifers, tags `M 1`..`M 27` (gaps), DOB Apr–Jun 2024, all $4,800, breed `DNA FB Wagyu`, all Pregnant, weights present (732–1,220 lb). SIRE REG # populated for M 8 onward (`FB19880`–`FB19890`).
- **Sheet 2 "Wright Farms"** — 24 cows. Mix of COW (Akaushi/Angus, with Last Calve Date) + Heifer (Red Angus, no Last Calve Date). All Pregnant, Preg Check Date `2/28/25`, all $4,500. SIRE REG # `FB BCWF23U425L` for the whole sheet. No weights.

**12 open questions** (next Claude must NOT start writing the importer until Ronnie answers each):

1. **Origin name for Sheet 1 "A to Z"** — what farm/seller? Sheet 2 is obviously Wright Farms.
2. **Purchase date** — xlsx has none. Today (or session date) for both sheets, or specific dates per sheet?
3. **Confirm herd = `mommas`** for all 41.
4. **Tag format** — keep `M 1` with the literal space, or strip to `M1`? Wright's `IR###` is unambiguous either way.
5. **SIRE REG # column** — migration 004 dropped `sire_reg_num` from `cattle`. Three options:
   - (a) Add the column back via migration 007 (recommended; Ronnie said in Apr 14 Q&A "track sire by tag # or reg #")
   - (b) Stuff into existing `sire_tag` column (mushes tag + reg)
   - (c) Publish as a comment per cow
6. **Sheet 1 weights → weigh-in session?** Create a `wsess-rcv-*` session at purchase date with the 17 heifer weights? Wright sheet has no weights so no-op.
7. **Wright Last Calve Date (16 of 24 cows)** — create `cattle_calving_records` rows with just the date (no calf_tag, no total_born) so the Calving History UI shows the event?
8. **Wright Preg Check Date `2/28/25`** — comment on each cow ("Preg check 2/28/25 — Pregnant"), or skip since `breeding_status='PREGNANT'` already captures it?
9. **% Wagyu defaults** — Sheet 1 "DNA FB Wagyu" → 100? Sheet 2 mixed → null? Or specific values from Ronnie?
10. **Breed normalization** — `DNA FB Wagyu` → `FULL BLOOD WAGYU` (existing in `cattle_breeds`). `Akaushi/Angus` and `Red Angus` — add as new breed options, or normalize to existing (e.g., `WAGYU-ANGUS CROSS`)?
11. **IR553 edge case** — Last Calve Date `"10/08"` (no year). Safe to assume 2025 like the others?
12. **Pre-check for tag collisions** before insert — want me to verify, or assume all 41 tags are new?

### Other parked items (lower priority but should be flagged)

- **Service-role key rotation.** Ronnie pasted a fresh key `sb_secret_1SlkN…` mid-session into chat (the previous key had been deleted). The current key is exposed in the transcript. He committed to rotating again at session wrap. **Confirm the key in `scripts/.env` is fresh before running anything.**
- **Cow #2269999999 in Lotus Hill (LORA)** — 10-digit tag is almost certainly a Podio paste/parse artifact, not a real tag. Worth investigating.
- **Imported processing batches still named as raw dates** (e.g. `2025-12-19`). Ronnie owns renaming via the Batches tab.
- **Imported weigh-in sessions show "Unknown herd" for the 7 sessions where majority-vote couldn't resolve.** Could soften the label to "Imported session" — low priority.
- **Cattle feed cost fill-in** — Ronnie owns. Until `cost_per_unit` is populated in Livestock Feed Inputs, the Feed Cost by Month tab cattle column is `—`.
- **Loading slowness diagnostic phase 2** — phase 1 (parallelize pig + poultry dailys) shipped. Bigger fix would be unblocking initial render before dailys load — see PROJECT.md §14.5 #3 / morning session diagnosis.
- **Browser back-button / pushState** — still parked.
- **Per-head cost rollup** — analytical metric, deferred.
- **Sheep module** — wait until cattle is stable in prod for ≥2 weeks.
- **Weather API** — design + provider choice still open. Open-Meteo recommended (no key needed).
- **DNA test PDF parser** — manual entry is v1.
- **Cut pricing spreadsheet upload** — deferred.

## 15.5 The purchase amount detective story (so future Claude doesn't repeat this)

The diagnostic SQL showed **163 cows with `purchase_date` but `purchase_amount IS NULL`**. Initial hypothesis: `import_cattle.js`'s `normNum` couldn't handle Podio's currency formatting (`"$ 1,523.50"`), so every dollar-prefixed amount returned `null`. **That hypothesis was partially correct but wrong about the root cause.**

The actual bug: `import_cattle.js` was reading `r['Purchase Amount']` — but Podio splits that field into TWO columns: `Purchase Amount - amount` and `Purchase Amount - currency`. The combined `Purchase Amount` field doesn't exist in the xlsx. So every row got `undefined` for the amount, fed through `normNum`, and returned `null`. The currency-formatting issue was secondary — it would have bitten us once we read the right column.

**Confirmed the column name discrepancy** by inspecting `Object.keys(rows[0])` on the xlsx — should be the FIRST step on any new xlsx import. Wasted the first preview run looking for the wrong column.

**Fix landed in two places:**
- `import_cattle.js` now reads `r['Purchase Amount - amount']` AND has a `normNum` that strips `$ / , / whitespace` (defensive, in case Excel-as-text formatting trips on a re-import).
- `scripts/fix_purchase_amounts.js` — one-off backfill targeting cows with `purchase_amount IS NULL OR = 0`, matching xlsx Tag # → cow via current tag (primary) or `old_tags[].tag` where `source='weigh_in'` (post-import retag fallback).

**Lesson:** every Podio xlsx may have these "compound field" splits. Sale Amount, Carcass Yield, anything monetary or unit-suffixed could be split into N columns. Inspect first.

## 15.6 Mistakes I made this session

1. **Asked Ronnie for re-approval after every commit.** He told me explicitly: "After I tell you to commit you should just fully commit. I don't need to approve anything else beside the push." Saved as memory `feedback_commit_vs_push.md`. The rule: word "commit" = full commit + status line, no follow-up question. Word "push" / "deploy" still required separately.
2. **Initial cow detail border was 4px-left / 1px-others.** Looked unbalanced; right side appeared "cut off." Ronnie flagged. Equal 2px borders all four sides + rounded corners + shadow fixed it.
3. **Used Δ symbols in weight history headers.** Ronnie didn't recognize them. Replaced with English: `Days Since`, `Change`, `Lb / Day`.
4. **Index column placed in middle of row** (between expand arrow and tag). Ronnie wanted far-left + vertical divider. Re-did.
5. **First purchase-amount preview ran with wrong column name** → 0 rows. Should have inspected xlsx columns first. Cost ~5 min of wasted run + investigation.
6. **Initial herd_scope SQL used `'[]'::jsonb` casting** when the column is `text[]`. Failed with type error. Fix: `cardinality()` + `ARRAY[...]::text[]`. **Standardize: future Claude should always check column type via `information_schema.columns` if uncertain.**
7. **Node oneliner shadowed global `URL` constructor** with `const URL = process.env.SUPABASE_URL` → `TypeError: URL is not a constructor`. Renamed to `SB`.
8. **Said "39 cows remaining unaccounted"** when actual was 41. Eyeballing math wrong. Trust the query.
9. **Reconcile flows historically didn't set the `source` field on old_tags entries.** This had been a latent bug since the cattle module shipped. Caught + fixed this session, but it means **historical retag entries in production have unsourced old_tags entries** and the edit modal defaults them to "Manual." Not data corruption, just imperfect source labeling.
10. **`new_cow` priorTag was writing `source: 'purchase'`** while the Podio importer wrote `source: 'import'`. Inconsistent. Normalized everything to the workflow-based convention this session.

## 15.7 What I wish I knew at session start (would have saved time)

1. **Podio splits compound-typed fields into multiple xlsx columns.** Currency: `X - amount` + `X - currency`. Likely also for any other typed field. Always `Object.keys(rows[0])` before assuming a clean column name.
2. **`cattle_feed_inputs.herd_scope` is `text[]`, not jsonb.** All other jsonb-shaped fields in the cattle module ARE jsonb. This one is the outlier. Migration 001 deserves a future cleanup pass for consistency.
3. **`weigh_in_sessions.id` follows three patterns:** `wsess-imp-YYYY-MM-DD` (Podio weigh-ins import), `wsess-rcv-cattle-<hash>` (Podio cattle_tracker receiving weights, one per cow), `wsess-<timestamp><rand>` (sessions created by users via the planner). Pattern matters for filtering.
4. **The "first weigh-in for many cows" was duplicated** between `wsess-rcv-*` and `wsess-imp-*` sessions because Podio's cattle_tracker stored the receiving weight AND the weigh-ins xlsx included the same data point. This would silently inflate weight history. Cleaned up this session via SQL DELETE.
5. **Ronnie's source-label convention is workflow-based.** Not "where did the data come from" but "how was the mapping made." Known at entry time → `'import'` (Purchase tag). Reconciled after entry → `'weigh_in'` (Retag). Manual admin entry → `'manual'`. Important to keep consistent across any new write paths.
6. **The retag flow is the recommended path for bulk new cattle.** When Ronnie or a future Claude is asked "how do I bring in 20 new cows from a purchase," the answer is:
   1. Add each cow via Add Cow form using her selling-farm tag as her current `tag`
   2. At first weigh-in, use **`⟳ Retag` mode** (public webform) or fill the **Prior Tag** field in the admin add-entry row
   3. The system swaps her tag to the new WCF number and stamps the prior tag in `old_tags`
7. **Ronnie's farm coordinates** for any future weather API: `30.84175647927683, -86.43686683451689`.
8. **Service-role key in `scripts/.env`** is gitignored. Ronnie rotates it manually because he's pasted it into chat transcripts twice now. Always confirm it's fresh before running scripts.
9. **PROJECT.md is the source of truth for handover.** §14 (morning Apr 17) and §15 (this section) are the most recent context. If the next session opens with an interrupt-style question from Ronnie, scan §15.4 for context before responding.

## 15.8 Things to make next Claude's life easier

1. **Run `git log --oneline -10` first thing.** This session ended with **6 unpushed commits**. If you don't push them before doing new work, you'll create merge conflicts when you eventually do push.
2. **Check the working tree:** `git status` should be clean except for `.claude/` (the memory dir). Anything else is leftover from this session.
3. **Verify Ronnie's service-role key is current.** Ask him directly if you need it: "Have you rotated the service-role key since last session? Paste me the new one if so."
4. **Inspect xlsx columns before any import.** Use the one-liner pattern from §15.5: `node -e "const XLSX=require('xlsx'); const wb=XLSX.readFile('PATH'); console.log(Object.keys(XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]],{defval:null})[0]||{}));"`
5. **The `findCowByPriorTag()` lookup pattern is now standard.** Walk: current tag → import old_tags → weigh_in old_tags. Implemented in both webform (line ~2080) and admin view (line ~16780). If you add a third location that needs this lookup, **extract it into a shared helper** rather than copy-pasting a third time.
6. **Tag matching is case-sensitive and string-based.** WCF tags are typically numeric-but-stored-as-text. Selling-farm tags often have prefixes (`IR508`, `M 1`). Don't `parseInt` on tags — keep as strings.
7. **Babel-in-browser still has the `\u` JSX trap.** Use `{'\u00b7'}` form for any unicode in JSX text. Never raw `\u00b7` in JSX children.
8. **The cow detail panel is now content-dense.** New additions should respect the existing layout — Identity / Lineage / Weight History / Calving History / Comments Timeline. Adding a 6th section means re-thinking column widths.
9. **`scripts/.env` contains the SERVICE-ROLE key** (not anon). Anything you run with it bypasses RLS. Be careful with `DELETE` operations.
10. **All scripts follow preview-then-`--commit` pattern.** Default behavior is read-only preview. Add `--commit` flag to apply. Idempotent re-runs are safe.

## 15.9 Architecture decisions worth knowing

1. **`cattle.old_tags` jsonb shape** is `[{tag: string, changed_at: ISO8601 string, source: 'import'|'weigh_in'|'manual'}]`. Sourced inconsistently before this session — now consistent across all four write paths.
2. **`cattle_processing_batches.cows_detail` jsonb shape** is `[{cattle_id: string, tag: string, live_weight: number|null, hanging_weight: number|null}]`. Per-cow weights edited inline; batch-level totals (`total_live_weight`, `total_hanging_weight`) recompute on every per-cow save. `cattle.processing_batch_id` is also kept in sync (added/removed from cow on add/remove).
3. **`weigh_ins.sent_to_trip_id`** points to a trip inside `app_store['ppp-feeders-v1'][group].processingTrips[]`. `sent_to_group_id` is the group id (denormalized to avoid scanning all groups to find a trip). Weigh-ins with `sent_to_trip_id IS NOT NULL` are protected from the grid wipe-and-rewrite save flow in the admin pig view.
4. **`weigh_ins.reconcile_intent`** can be one of `'replacement'` (flagged for after-the-fact reconcile), `'new_cow'` (created a fresh cattle row at entry), `'retag'` (swapped a known cow's tag at entry — NEW this session), or `null` (normal weigh-in matching an existing cow's current tag).
5. **Cattle Home Dashboard nutrition window math:**
   - `cow_units = herd_total_live_weight / 1000`
   - `target_dm_lbs_per_day = cow_units × target_dm_pct_body × 10` (since total weight = cow_units × 1000)
   - `actual_dm_lbs_per_day = sum(feeds[].lbs_as_fed) over window / window_days`
   - Same shape for CP and NFC, scaled off DM.
   - Creep-flagged feed lines on Mommas excluded from all three.
6. **Cow detail navigation stack** (`cowNavStack`) is a simple array of cow ids. Pushing on link click, popping on back-button click. State lives in `CattleHerdsView` and is passed down to `CowDetail` via props (`onNavigateToCow`, `onNavigateBack`, `canNavigateBack`, `backToTag`). Scrolls target into view via `document.getElementById('cow-'+id).scrollIntoView`.

## 15.10 Commit list — six commits sitting unpushed at session end

```
ac40fd8  On-the-spot retag flow + source-label consistency
6ccd1ec  Prior Tags editor in cow edit modal + source-labeled detail view
428c827  Cow row index: move to far left + vertical divider
4adfcd7  Cow row index numbers + purchase_amount import fix
3874dca  Cow detail balanced borders + tag search in Cattle Weigh-Ins
e8ca425  Cow detail: weight history table polish, clickable lineage, back nav
```
(Plus `618125c` which was pushed at start of session.)

**`git push origin main`** before any new work next session. Same Netlify auto-deploy as always; tell Ronnie to clear `wcf-babel-*` localStorage keys after deploy.

## 15.11 SOP reminders for the AI reading this

- **`commit` = commit fully** — don't ask "ready to push?" or any other follow-up. Status line only. The `feedback_commit_vs_push.md` memory rule is durable.
- **`push` / `deploy` still requires explicit approval** in the same turn. The new commit-no-prompt rule does NOT extend to push.
- **Never run destructive Supabase ops** (DROP, TRUNCATE, large DELETEs without WHERE) without explicit approval.
- **Always show the diff and propose a commit message** before committing.
- **Match the scope of action to what was asked.** If Ronnie says "fix X," fix X — don't bundle Y.
- **Inspect xlsx column names before importing.** This bit us this session.
- **Ronnie verifies.** When he pushes back on numbers or design, listen. He's almost always right.

---

*End of April 17 evening session. The work-tree state at session end: clean. 6 commits sitting locally awaiting push. Next session should: (1) push the 6 commits, (2) get answers to the 12 cattle-import questions in §15.4, (3) build the importer for the 41 new mommas. Good luck.*

---

# 16. Session Update — April 18, 2026 (Cattle Bulk Import + Auth Hardening + User Mgmt + Sheep Module Phase 1)

Long session. Started by getting answers to the 12 cattle-import questions from §15.4, then built a self-serve cattle bulk import tool, then chased down a string of auth + user-management bugs while testing the new-user invite flow, then kicked off the entire sheep module from scratch.

Three commits shipped (all pushed to prod by end of session, Netlify auto-deployed):

```
08ca04b  SetPasswordScreen: manually exchange URL tokens for a session
72196dd  SetPasswordScreen: wait for session before enabling submit
1fdc869  Cattle bulk import + estimated weight fallback + per-program user access
```

The big sheep batch (migration 009 + all six Sheep* components + routing wiring) is committed in this final commit alongside the §16 doc append.

## 16.1 What was built and shipped (in execution order)

### Cattle bulk import tool (replaces one-off scripts/import_cattle.js for future imports)
- **Migration 007** (`007_split_dam_sire_reg.sql`) — re-added `dam_reg_num` + `sire_reg_num` text columns to `cattle` (mig 004 had dropped sire_reg_num). Seeded `AKAUSHI-ANGUS CROSS` + `RED ANGUS` in `cattle_breeds` and `A-Z FEEDERS` + `WRIGHT FARMS` in `cattle_origins`. Idempotent via `IF NOT EXISTS` + `ON CONFLICT DO NOTHING`.
- **`CattleBulkImport` component** in `index.html` — full-screen modal. Stages: start (download template / upload xlsx) → preview (per-row validation table, ✓ ready / ⚠ warning / ✗ error) → committing (progress bar) → done (per-tag log). Auto-creates new breeds/origins on commit, validates tag collisions against active-herd cows. Per-row optional extras: `last_calve_date` → cattle_calving_records, `comment` → cattle_comments source='import', `receiving_weight` → wsess-rcv-* session.
- **"📥 Bulk Import" button** in CattleHerdsView header next to + Add Cow.
- **`scripts/seed_momma_import_template.js`** — Node script that takes the New Momma Planner Import xlsx and produces a pre-filled WCF template xlsx on Desktop. Used to seed the 41 cows for Ronnie's first dogfood test.
- **The 41 cows imported successfully** after migration 007 was applied. Confirmed in prod.

### Estimated cow weight fallback (so feed math doesn't blow up between purchase and first weigh-in)
- New `cowEffectiveWeight(c)` helper in `CattleHomeView` and `effectiveWeight(c)` in `CattleHerdsView`.
- Returns real weight if known; otherwise **1,000 lb** if cow has `purchase_date` within last **120 days**; otherwise 0 (calves and legacy data gaps stay honest).
- Aggregate-only — per-cow rows still show "no weigh-in" honestly.
- Window math in `nutritionForHerd` is now backdated per cow's purchase_date so cow_units shrinks proportionally for cows that joined mid-window — target lbs/day matches what was actually being fed.
- UI badges show "(N est. @ 1,000 lb)" on Total Live Weight + Cow Units stat tiles, on each herd tile in HERD BREAKDOWN, and on the per-herd tile in CattleHerdsView's tile mode.

### Cattle dashboard restyled to Layers rolling-window pattern
- Replaced the table-style "NUTRITION VS TARGET (3 windows side by side)" with **per-herd cards + PeriodToggle (30/90/120 days)**.
- Each card has colored left-accent header (herd name · cow count · cow units avg · estimated badge · target % string) + body using auto-fill MetricsGrid: Total feed, Feed cost, DM lb/day, CP lb/day, NFC lb/day, Cow units, Mortality, Report days.
- DM/CP/NFC tiles show actual + "X target" subtitle + "% of target" line in color (green 90-110%, amber 75-89%, red <75%, blue >110%).
- Trend arrows on DM/CP/NFC vs equivalent prior period (suppresses noise from tiny baselines, caps at 200%).
- HERD BREAKDOWN tiles above kept as quick at-a-glance summary.

### Auth: SetPasswordScreen (handles invite + recovery links)
Three iterations to get this right.
- **v1** (in commit `1fdc869`): added `SetPasswordScreen` component triggered by URL hash `type=recovery`/`type=invite` OR Supabase's PASSWORD_RECOVERY event. Took users out of the "land on home with mystery session" trap.
- **v2** (`72196dd`): added a sessionReady gate — wait for getSession() / onAuthStateChange to return a session before enabling the Set Password button. Otherwise users hit "Auth session missing" on submit. Shows "Validating reset link…" while waiting; falls back to "expired/already used" message after 8s.
- **v3** (`08ca04b`): manually parse `access_token`+`refresh_token` from the URL hash and call `setSession()`, with `exchangeCodeForSession(code)` PKCE fallback. **The supabase client is initialized with `detectSessionInUrl: false` (line 220) so the auto-exchange never runs.** Without this, the "Validating…" branch never resolved, fresh links always hit the 8s "expired" branch.

### User management improvements
- **Drop temp password field** on Add User form. createUser auto-generates a long random throwaway (`wcf_` + 16 random chars). The user's first action is setting their real password via the welcome email link. Admin only enters name + email + role.
- **🗑 Delete button** on each non-self user row. Calls `rapid-processor` edge function with `type:'user_delete'`, then deletes the profile row. Email becomes free for re-invite. **Required edge function update** — added `user_delete` handler (admin.auth.admin.deleteUser) — Ronnie pasted that block in mid-session, deployed it.
- **Per-program access pills** (🐔 Broiler · 🥚 Layer · 🐷 Pig · 🐄 Cattle · 🐑 Sheep) on each non-admin user. All on (or all off) = "All programs" (null in DB). Otherwise specific list. Persists to new `profiles.program_access text[]`.
- **Migration 008** (`008_profile_program_access.sql`) — `ALTER TABLE profiles ADD COLUMN program_access text[] DEFAULT NULL`. Null means full access (default for existing users).
- **Program access gates**: `canAccessProgram(prog)` helper at App scope. Filters home program tiles, gates sub-nav rendering, redirects forbidden routes to home via `useEffect` watching `view`. Admins always bypass.
- **`VIEW_TO_PROGRAM` map** added — every program-specific view name → its program key. Views not in the map (home, webforms, weighins, etc.) are always accessible.

### Sheep module Phase 1 (everything but the actual data import)
- **Migration 009** (`009_sheep_module.sql`) — 6 tables: `sheep`, `sheep_breeds` (5 hair-sheep breeds seeded), `sheep_origins` (5 origins seeded from Ronnie's tracker file), `sheep_dailys` (sheep-specific fields), `sheep_lambing_records`, `sheep_comments`. Reuses existing `weigh_in_sessions` + `weigh_ins` with `species='sheep'` — no dedicated weigh-in tables.
- **Flock model**: `rams / ewes / feeders` active + `processed / deceased / sold` outcomes. Sex CHECK = `ewe / ram / wether` (no LAMB rank — lambs become one of these at weaning).
- **Sheep dailys schema** matches the 642 historical Podio rows: `bales_of_hay`, `lbs_of_alfalfa`, `minerals_given` (bool) + `minerals_pct_eaten`, `fence_voltage_kv`, `waterers_working` (bool), `mortality_count`, `comments`.
- **Components**:
  - `SheepBulkImport` — clone of CattleBulkImport with sheep schema (no pct_wagyu, flock instead of herd, lambing instead of calving, sex enum `ewe/ram/wether`, optional `total_born` for lambing record).
  - `SheepDetail` — slim version of CowDetail. Identity, lineage tags (with reg #), weight history table, lambing history (with inline + Add Lambing form), comments timeline. No chart toggle, no nav stack, no prior-tags editor in Phase 1.
  - `SheepFlocksView` — directory + flat/tile modes, add/edit/delete sheep modal, transfer between flocks, bulk import button. Per-row honest weight display (no estimate fallback — that's only used in aggregates on the dashboard).
  - `SheepHomeView` — top stats (Sheep on Farm, Total Live Weight, Mortality 30d, Reports 30d, Minerals Eaten 30d), flock breakdown tiles, single farm-wide rolling-window card with sheep MetricsGrid (Bales, Alfalfa, Mineral % eaten, Fence voltage, Waterers OK, Mortality, Report days). 30/90/120 toggle + trend arrows.
  - `SheepDailysView` — admin entry/edit/delete with sheep-specific form fields.
  - `SheepWeighInsView` — session-based weigh-ins on shared weigh_in_sessions/weigh_ins (species='sheep'). New session form + add entries + delete entries + mark complete + delete session. No retag flow yet (Phase 2).
- **Wiring**: `sheepHome / sheepflocks / sheepdailys / sheepweighins` added to `VALID_VIEWS` + `VIEW_TO_PROGRAM`. Sheep section added to sidebar sub-nav (matching cattle's nav style). Sheep tile added to home (5th in the program grid). Sheep pill added to per-program access UI in UsersModal.
- **Per-sex weight defaults** for sheep aggregate math: ewes 150 lb, rams 225 lb, feeders/wethers 80 lb (vs cattle's flat 1,000 lb). Same 120-day "recently purchased" cutoff.

### What was NOT built (Phase 2 candidates)
- Public weigh-in webform for sheep (would need to extend `WeighInsWebform` with `'sheep'` species)
- Public dailys webform for sheep
- `sheep_nutrition_targets` table + targets-vs-actual on dashboard
- `sheep_processing_batches` table
- `sheep_breeding_cycles` table
- FAMACHA parasite scoring (Ronnie said skip for now)
- Actual data import: 67 sheep tracker rows + 642 daily reports — Ronnie wants to handle that next session, deliberately deferred

## 16.2 Database state at session end

### Applied to production Supabase by Ronnie
- **Migration 007** (`007_split_dam_sire_reg.sql`) — applied. Cattle now has `dam_reg_num` + `sire_reg_num` columns. Two new breeds + two new origins seeded.
- **Migration 008** (`008_profile_program_access.sql`) — applied. profiles.program_access exists.

### NOT YET applied (must apply before sheep module functions correctly)
- **Migration 009** (`009_sheep_module.sql`) — schema for the 6 sheep tables. Apply in Supabase SQL Editor before testing the sheep module. The migration is idempotent.

### Edge function update
- `rapid-processor` was updated to add `user_delete` handler. Deployed by Ronnie mid-session.

## 16.3 Bugs caught and fixed this session (chronological)

1. **CattleBulkImport's "Extras" column showed literal word "comment"** instead of the actual comment text. Fixed by inlining a 60-char-truncated preview in curly quotes.
2. **First commit attempt of the seeded import template put SIRE REG # into `sire_reg_num` column.** Ronnie clarified: that field is the sire of the calf the cow is currently carrying, NOT her own sire. Fixed by moving the reg # into the comment field with the registry name appended (American Wagyu Association for A-Z, American Akaushi Association for Wright).
3. **xlsx file was locked by Excel** when re-running the seeder script — `EBUSY` error. Asked Ronnie to close the file before re-running.
4. **41-cow import errored on commit** with "Could not find the 'dam_reg_num' column of 'cattle' in the schema cache" — the migration 007 hadn't been applied yet. Surfaced the error message clearly so Ronnie immediately knew to apply the SQL.
5. **Estimated weight fallback was over-applied.** Initial implementation gave the 1,000 lb default to every cow without a weigh-in (66 cows). Ronnie pointed out that the 25 calves should NOT get 1,000 lb — they're not 1,000 lb, and 1,000 lb is the wrong number for them anyway. Fixed by gating the fallback on `purchase_date` within last 120 days, which naturally excludes calves (no purchase_date) and legacy un-weighed records.
6. **SetPasswordScreen "Auth session missing" error.** First fix didn't work because the URL token exchange was being skipped due to `detectSessionInUrl: false` global config. Manual `setSession()` from URL hash was the actual fix.
7. **Forgot password flow appeared broken** but it actually wasn't — Ronnie just needed to confirm that users CAN self-serve via the login screen's "Forgot password?" link. The admin "Send password reset" button is just a backup. Documented this so future sessions don't re-investigate.
8. **Edge function deploy failed** with `Expected ':', got 'TO'` — markdown smart-quote conversion mangled the single quotes when Ronnie pasted the full file from my response. Solution: don't paste the whole file — only the new block. Future Claude: warn the user about smart-quote risk when pasting code blocks into editors.

## 16.4 Lessons + things I wish I knew at the start

1. **`sb` is initialized with `detectSessionInUrl: false`** (index.html line ~220). This affects ANY auth flow that relies on URL hash tokens — recovery, invite, OAuth. Components handling those flows must manually call `setSession({access_token, refresh_token})` from the URL hash, OR `exchangeCodeForSession(code)` for PKCE. **Don't flip the global flag** — it's there to prevent the planner from auto-signing-in when users navigate to public webform pages.
2. **Existing weigh-ins fetch uses TWO queries**, not Supabase joins. First `sb.from('weigh_in_sessions').select('id').eq('species', X)` to get session IDs, then `sb.from('weigh_ins').select('*').in('session_id', ids)`. The `weigh_in_sessions!inner(species)` join syntax may or may not work depending on FK configuration — match the existing pattern instead.
3. **All Supabase admin operations** (`auth.admin.deleteUser`, `auth.admin.generateLink`, etc.) require the service-role key. Browser code can't call them directly. The pattern is: call the `rapid-processor` edge function with a `type: 'X'` discriminator, edge function uses the SUPABASE_SERVICE_ROLE_KEY env var.
4. **Smart-quote conversion in markdown** can mangle pasted code into the Supabase edge function editor (or any web editor). Symptoms: `Expected ':', got 'X'` parser errors at string-literal boundaries. Don't ship full files via markdown blocks — ship deltas only.
5. **`xlsx` file locks on Windows** mean any open-in-Excel file can't be written by Node. Surface that as a "close the file in Excel" message immediately, don't try fancy retries.
6. **Cattle and sheep have different aggregate-weight defaults**: cattle uses one flat `DEFAULT_COW_WEIGHT = 1000`, sheep uses per-sex `SEX_DEFAULT_WEIGHT = {ewe:150, ram:225, wether:80}`. Both use the same 120-day "recently purchased" cutoff.
7. **The `role: 'admin'` bypass is universal** — admins should bypass program_access, role-gated buttons, and any other access check. Always include the admin short-circuit at the top of permission helpers.
8. **The cattle module's bulk import auto-creates breeds/origins** on commit (idempotent INSERT). Same pattern in sheep. Trust users to type new selling-farm names — don't make them set up the dropdown first.
9. **The cattle module shipped with `breeding_blacklist_reason`, `sire_reg_num`, `receiving_weight`, `notes` dropped in mig 004.** When mirroring to sheep, I kept `notes` out (cattle replaced it with cattle_comments timeline) but added back the reg # columns dam/sire. Sheep doesn't have its own `breeding_blacklist_reason` column — using a plain comment if needed.
10. **Source-label convention for old_tags is workflow-based, not data-origin-based** (per §15.7 #5):
    - Known at entry time → `'import'` (renders as "Purchase tag")
    - Reconciled after entry → `'weigh_in'` (renders as "Retag")
    - Admin typed manually → `'manual'`
11. **`canAccessProgram(prog)` runs in App scope.** It needs `authState` and `authState.profile`. If either is null/false, it returns true (don't gate during loading — the auth gate handles that).

## 16.5 Mistakes I made

1. **Initial estimate-weight fallback was too broad** (66 cows including calves). Should have gated on purchase_date from the start. Ronnie caught it before any user impact.
2. **Initial sire reg # placement was schematically wrong.** Read the data more carefully — the column header was ambiguous between "sire of this animal" and "sire of the calf this animal is carrying". Ask before assuming.
3. **First edge function snippet pasted as a full file** — caused the smart-quote parse error. Should have led with "paste only this block" from the start.
4. **Tried to use `weigh_in_sessions!inner(species)` joins** in the sheep components without checking that the existing codebase uses two-query pattern. Caught and rewrote before testing, but wasted code.
5. **Asked "should I commit + push" too often early in the session.** The `feedback_commit_vs_push.md` rule: "commit" = full commit, no follow-up; "push"/"deploy" still needs explicit approval. Got better at this mid-session.
6. **Built SetPasswordScreen v1 without checking the existing supabase client config first.** The `detectSessionInUrl: false` setting was the root cause of the entire issue. A 1-minute search would have saved 2 iterations.

## 16.6 Potential bugs / things to verify next session

1. **Sheep components are NOT runtime-tested.** Ronnie has to apply migration 009 first, then visit each view. Possible issues:
   - SheepFlocksView's flat/tile mode might have JSX issues I missed in code review
   - SheepBulkImport's downloadTemplate path on Windows browsers
   - SheepDailysView's checkbox state management for `minerals_given` + conditional `minerals_pct_eaten` field
   - SheepWeighInsView's session-vs-entries grouping
2. **The `weigh_in_sessions.species` column may have a CHECK constraint** that doesn't include `'sheep'`. Need to verify before sheep weigh-ins can save. If it errors on insert, run `ALTER TABLE weigh_in_sessions DROP CONSTRAINT IF EXISTS weigh_in_sessions_species_check; ALTER TABLE weigh_in_sessions ADD CONSTRAINT weigh_in_sessions_species_check CHECK (species IN ('cattle','broiler','pig','sheep'));` (or just drop the constraint entirely).
3. **`sheep_dailys.flock` has no CHECK constraint** in migration 009 (loose text). The form uses the dropdown but the schema doesn't enforce. Consider adding a CHECK in a later migration if data integrity matters.
4. **SheepDetail's "Lambs in directory" count** uses `sheep.filter(x => x.dam_tag === s.tag).length` — works only if lambs have been added via Add Sheep with `dam_tag` filled. The lambing_records table doesn't auto-create sheep rows for lambs.
5. **SheepHomeView's mineral-compliance % calculation** averages `minerals_pct_eaten` across reports where `minerals_given=true`. If Ronnie's historical data has `minerals_given=true` but no `minerals_pct_eaten`, those reports get filtered out — fine, but the count tile may surprise him.
6. **Per-program access cuts the home tile** but doesn't (yet) cut the menu items inside the legacy webforms admin page or other deep links. Verify by setting a non-admin user to "Cattle only" and trying various navigation paths.
7. **Sheep route handlers were added** to App's view dispatcher (`if(view==="sheepHome") ...`) but if you navigate to a sheep view BEFORE migration 009 is applied, you'll see Supabase errors. Components handle gracefully (no data, no crash) but the console will be noisy.
8. **The Lambs count in SheepDetail** uses a pluralization that's always "sheep" (treats 1 and N+ identically). Cosmetic.

## 16.7 Outstanding items (in priority order)

### Top of next session
1. **Apply migration 009** in Supabase SQL Editor.
2. **Verify the `weigh_in_sessions.species` CHECK constraint** allows `'sheep'`. If not, drop or extend.
3. **Smoke-test each sheep view** by clicking through Dashboard / Flocks / Dailys / Weigh-Ins.
4. **Test the sheep bulk import** by downloading the template + uploading a tiny test sheet (3-5 rows).

### Once smoke tests pass
5. **Build the sheep import seeder script** modeled on `seed_momma_import_template.js`. Read `Sheep Tracker - All Sheep Tracker.xlsx` (67 rows) and produce a pre-filled WCF Sheep Import Template. Mapping:
   - Tag # → tag (numeric, as-is)
   - SEX → sex (lowercase)
   - Status MAIN FLOCK → flock by sex (EWE→ewes, RAM→rams, WETHER→feeders); other statuses → matching outcome flock
   - Breed → breed (preserve case from data — KATAHDIN, DORPER, GULF COAST, KATAHDIN / GULF COAST CROSS, DORPER CROSS)
   - Origin → origin
   - Birth Date / Purchase Date → ISO format (Excel may give serials)
   - Purchase Amount - amount → purchase_amount
   - Receiving Weight → receiving_weight (creates wsess-rcv-* on import)
   - Last recorded weight → consider creating an additional weigh-in session at session-creation date (or skip — Phase 1 only ingests one receiving weight per cow)
   - Last Lambing → last_lambing_date
   - Lambs → total_born
   - Sire / Dam → sire_tag / dam_tag
   - Tags → old_tags array (workflow-based source — most likely 'import' for prior selling-farm tags)
6. **Build the sheep dailys importer** for the 642 historical rows. Map "MAIN FLOCK" → ewes (the primary flock). Generate an `id` per row, parse Date (Excel serial), map "YES"/"NO" to booleans, copy comments verbatim.
7. **Phase 2 sheep features** when Ronnie asks:
   - Public weigh-in webform (extend `WeighInsWebform` with sheep)
   - Public dailys webform
   - sheep_nutrition_targets + dashboard targets-vs-actual
   - sheep_processing_batches
   - sheep_breeding_cycles
   - FAMACHA scoring (deferred per Ronnie)

### Lower-priority parked items (still applies from §15.4)
- Service-role key rotation (key was exposed in earlier sessions)
- Cow #2269999999 in Lotus Hill (10-digit tag almost certainly a Podio paste artifact)
- Loading slowness phase 2 (initial render before dailys load)
- Browser back-button / pushState
- Per-head cost rollup (analytical metric)
- Weather API (Open-Meteo recommended, no key needed)
- DNA test PDF parser (manual entry is v1)
- Cut pricing spreadsheet upload
- Imported processing batches still named as raw dates (e.g. `2025-12-19`) — Ronnie owns renaming via the Batches tab
- Imported weigh-in sessions show "Unknown herd" for the 7 sessions where majority-vote couldn't resolve

## 16.8 Things to make next Claude's life easier

1. **The cattle bulk import is the template for any future bulk import.** Pattern: validation function that produces `{rowIdx, raw, parsed, errors, warnings}`, preview table with per-row badges, commit loop with per-row try/catch. Auto-create dropdowns. Tag collision pre-check against active animals.
2. **`scripts/seed_momma_import_template.js` is the template for any future xlsx-to-template pre-fill.** Reuse the date parsing (`parseSlashDate`), the Podio compound-field handling (`Purchase Amount - amount` not `Purchase Amount`), and the `XLSX.writeFile` invocation. Output to Desktop with descriptive filename.
3. **`canAccessProgram(prog)` is the gate for any new program-specific feature.** Add new views to `VIEW_TO_PROGRAM` map at the top of App, then calls to `canAccessProgram` filter UI elements + the route useEffect redirects forbidden routes. Admin always bypasses.
4. **Edge function dispatch is keyed on `type` field.** `rapid-processor` handles: `egg_report`, `starter_feed_check`, `user_welcome`, `password_reset`, `user_delete`. To add a new server-side capability: add a new branch alongside, deploy, then call from frontend with `sb.functions.invoke('rapid-processor', {body: {type: 'X', data: {...}}})`.
5. **The `SheepDetail` component is intentionally slimmer than `CowDetail`.** No chart, no nav stack, no prior-tags editor. If sheep needs feature parity, factor out a shared `<AnimalDetail>` rather than copy-pasting the cattle one wholesale.
6. **Sheep components are interleaved with cattle ones** in `index.html` (around lines 15217–16500). Search by component name (`SheepBulkImport`, `SheepFlocksView`, etc.). They live before the `CattleHerdsView` declaration because of declaration-order dependency on `SheepBulkImport` + `SheepDetail`.
7. **Migration 009 is idempotent** — safe to re-run. All `CREATE TABLE IF NOT EXISTS`, `INSERT … ON CONFLICT DO NOTHING`, `DROP POLICY IF EXISTS` followed by `CREATE POLICY`.
8. **The Add Sheep modal does NOT include `breeding_blacklist`, `maternal_issue_flag`, or sale/death fields** in Phase 1 form. The schema has them; form's just minimal. Edit modal could surface them if/when needed.

## 16.9 Architecture decisions worth knowing

1. **Sheep flocks are sex-derived for the import**: a new sheep with no Status mapping defaults to its sex's natural flock (EWE→ewes, RAM→rams, WETHER→feeders). After import, transfers between flocks are manual via the Sheep Detail panel.
2. **Per-sex weight defaults** (`SEX_DEFAULT_WEIGHT = {ewe:150, ram:225, wether:80}`) live INSIDE `SheepHomeView`. Not yet shared with `SheepFlocksView` (which only needs honest per-row weights, no estimate). If estimate logic moves to flock tiles in Phase 2, pull the constant up.
3. **`weigh_in_sessions` is shared across species** with a `species` text column discriminator. Same for `weigh_ins` (no species, joined via session_id). Add `'sheep'` to any CHECK constraint that exists.
4. **Sheep dailys schema differs significantly from cattle dailys.** Cattle uses a `feeds` jsonb array of {feed_input_id, lbs_as_fed, nutrition_snapshot}. Sheep uses flat columns (bales_of_hay, lbs_of_alfalfa, minerals_*). Reflects how Ronnie tracks sheep feed simpler — one bales count + one alfalfa count per day, not a ration table.
5. **Comments timeline source enum** for `sheep_comments`: `'manual' | 'weigh_in' | 'daily_report' | 'lambing' | 'import'`. (Cattle's enum has `'calving'` instead of `'lambing'`.)
6. **Lambing record schema mirrors cattle_calving_records** (dam_tag, lambing_date, lamb_tag, lamb_id FK to sheep, sire_tag, total_born, deaths, complications_*, notes). Cattle's `cycle_id` field is omitted — no breeding_cycles table for sheep yet.

## 16.10 SOP reminders for the AI reading this

- **`commit` = commit fully** — don't ask, just do it. Status line only. Memory rule `feedback_commit_vs_push.md`.
- **`push` / `deploy` still requires explicit approval** in the same turn.
- **Never run destructive Supabase ops** without explicit approval (DROP, TRUNCATE, large DELETEs).
- **Inspect xlsx column names** before any import — `Object.keys(rows[0])`. Podio compound fields split into `X - amount` + `X - currency` etc.
- **Don't paste full edge function code into Supabase editor via markdown** — smart-quote conversion will break it. Send deltas only.
- **`detectSessionInUrl: false`** on the supabase client means manual setSession() from URL hash is required for any recovery/invite/OAuth flow.
- **Match existing data-loading patterns** — two-query weigh-ins fetch, not joins.
- **Always check the `role: 'admin'` bypass** in any new permission gate.
- **The cattle module is the canonical pattern** for new species modules. Sheep mirrored its shape minus the bells (no nutrition targets, no batches, no breeding cycles in Phase 1).

---

## 16.11 Follow-up — home tile compaction + Equipment + cross-program coverage on home

After the §16 commit, Ronnie flagged that the program tiles were eating too much real estate and asked to add Equipment as the 6th program. Same turn covered three other home-page issues he'd noticed.

### Changes

- **Home program tiles**: 2-col grid → **3-col × 2-row grid**. Padding 20px→12px, icon 36px→26px, label 18px→15px, desc 12px→11px. Fits all 6 tiles in roughly the same vertical space the original 4 took.
- **🚜 Equipment tile** added (color `#57534e`, bg `#fafaf9`). Routes to new `equipmentHome` placeholder view that renders a "coming in a future build" card. Wired into VALID_VIEWS, VIEW_TO_PROGRAM (`equipment` key), per-program access pills (now 6 of 6), and the canAccessProgram filter.
- **Cattle + sheep dailys loaded at App level** — `cattleDailysRecent` + `sheepDailysRecent` (14-day window) added to App state, plus lightweight `cattleForHome` ([{id,herd}]) and `sheepForHome` ([{id,flock}]) directories so the missed-report check knows which flocks have animals.
- **Missed Daily Reports section** now flags missing cattle dailys per herd (mommas/backgrounders/finishers/bulls) and sheep dailys per flock (rams/ewes/feeders) — only when there are animals in that herd/flock. Skip rule: `cattleForHome.some(c=>c.herd===h)` (or sheep equivalent). Same 7-day backwards window, same Clear/Clear-all UX.
- **Last 5 Days — All Daily Reports** now includes 🐄 Cattle + 🐑 Sheep entries alongside broiler/pig/layer/egg, with the same date-grouped layout.
- **Tile rendering refactored for parity with admin daily-report views.** Was: flex-wrapped first row with mort jammed inline. Now: grid layout per type (matching each admin DailysView's column template) + mort and comment chips moved to a SECOND row when notable. Affects all six type branches (broiler/layer/pig/egg/cattle/sheep). Helper consts at the top of each tile (`chipBase`, `teamChip`, `chipYes(label,ok)`, `mortChip(n,reason)`, `commentChip(text)`) keep markup short and consistent.

### Things to verify next session

1. Sheep module is still untested in prod. The new home-page integration ASSUMES `sheep_dailys.flock` is one of `rams/ewes/feeders` and `cattle_dailys.herd` is one of the four standard herds. If real data has anything else (legacy/typos), the missed-report keys won't match and the per-flock flagging may be off.
2. The Equipment view is a stub. When the actual module is built, replace the placeholder render at the `if(view==="equipmentHome")` branch.
3. The `cattleForHome` + `sheepForHome` queries are unfiltered — they pull every row in `cattle` (up to 469 rows) and `sheep`. Fine at current scale, but if either grows past several thousand, switch to a count-by-flock query (or just query distinct flocks/herds).

### What did NOT need to change

- Layers and pigs already had per-batch missed-report flagging from the original code — those still work.
- The home tile filter uses `canAccessProgram(VIEW_TO_PROGRAM[c.view])` so per-user restrictions still hide whole programs (including Equipment) cleanly.

---

*End of April 18 session. Work-tree state at session end: clean. All commits pushed. Next session should: (1) apply migration 009, (2) smoke-test the sheep module, (3) verify weigh_in_sessions.species CHECK allows 'sheep', (4) build the sheep import seeder for Ronnie's 67-row tracker file, (5) verify the new home-page cross-program coverage works once cattle/sheep dailys are flowing in. Good luck.*

---

# 17. Session Update — April 20, 2026 (Vite migration Phase 1 preview verify + Phase 2 Round 0)

**Branch: `vite-migration`. Main + production untouched — legacy monolithic `index.html` still serves `wcfplanner.com`.**

Short session focused on the Vite migration's Phase 1 smoke-test gate and the full Phase 2 Round 0 (Context extraction). No feature work. No data changes. No schema changes. Migration progress only.

The detailed migration log lives in `MIGRATION_PLAN.md §14` — this section is the cross-project summary so future Claude picks up the thread without having to read the migration plan end-to-end.

## 17.1 What landed this session

### Phase 1 gate cleared (Vite build serving preview)
Ronnie smoke-tested the deploy preview (`deploy-preview-1--cheerful-narwhal-1e39f5.netlify.app`) after the previous session's Phase 1 commits (`26ba711` → `9956d13`). All tabs load, navigation works. That was the last required verification before moving to Phase 2 per `MIGRATION_PLAN §14` / §15 "phase gates" rules.

### Phase 2 Round 0 (all six Context extractions) — single commit
| SHA | Branch | What landed |
|---|---|---|
| `67d2ae3` | `vite-migration` | 10 thin Context Providers under `src/contexts/`. ~78 useState hooks moved out of App(). App retains all effects, helpers, and derived values — feature components read their state via `useAuth()`, `useBatches()`, `usePig()`, `useLayer()`, `useDailysRecent()`, `useCattleHome()`, `useSheepHome()`, `useWebformsConfig()`, `useFeedCosts()`, `useUI()`. |

Why one commit instead of six per-step SHAs: all six extractions are the same structural pattern (move state hooks into Provider, App destructures via `useX()`, root wraps in `<XProvider>`). Splitting already-intermixed changes in main.jsx would have been git surgery for its own sake. The single commit captures a coherent "Round 0 complete" chunk.

### Deployed state
- **Production (`wcfplanner.com`):** still on `main` — unchanged legacy monolith. No user-visible change.
- **Deploy preview (`deploy-preview-1--cheerful-narwhal-1e39f5.netlify.app`):** Phase 1 + Round 0 live. Ronnie smoke-tested after push — all tabs work, **forgot-password flow works end-to-end** (AuthContext's `pwRecovery` initializer + auth listener effect both survived the state-vs-effect split cleanly).

## 17.2 Where Round 0 put things

New `src/contexts/` directory, 10 files:

| Context | Owns |
|---|---|
| `AuthContext` | `authState`, `pwRecovery`, `dataLoaded`, `saveStatus`, `showUsers`, `allUsers`, `inviteEmail`, `inviteRole`, `inviteMsg` |
| `BatchesContext` | `batches`, `showForm`, `editId`, `form`, `originalForm`, `conflicts`, `tlStart`, `tooltip`, `override`, `showLegacy`, `parsedProcessor`, `docUploading`, `deleteConfirm` |
| `PigContext` | `pigData`, `breedingCycles`, `farrowingRecs`, `boarNames`, `breedTlStart`, 5 pig form states (breed/farrow/feeder/breeder/trip), sows UI, `archivedSows`, `breeders`, `breedOptions`, `originOptions` (29 hooks) |
| `LayerContext` | `layerGroups`, `layerBatches`, `layerHousings`, `allLayerDailys`, `allEggDailys`, `layerDashPeriod`, `retHomeDashPeriod` |
| `DailysRecentContext` | `broilerDailys`, `pigDailys`, `layerDailysRecent`, `eggDailysRecent`, `cattleDailysRecent`, `sheepDailysRecent` |
| `CattleHomeContext` | `cattleForHome`, `cattleOnFarmCount` |
| `SheepHomeContext` | `sheepForHome` |
| `WebformsConfigContext` | `wfGroups`, `wfTeamMembers`, `webformsConfig` |
| `FeedCostsContext` | `feedCosts`, `broilerNotes`, `missedCleared` |
| `UIContext` | `view`, `pendingEdit`, `showAllComparison`, `showMenu` |

**Deviation from `MIGRATION_PLAN §4` table:** `view` went to `UIContext`, not `BatchesContext`. The plan hedged with "(initially)" and also listed `view` under `UIContext` — UIContext is the correct final home (every feature reads it), so it landed there directly and skipped a later rework.

## 17.3 What did NOT change

Everything on the `MIGRATION_PLAN §10` don't-touch list is verbatim-preserved. In particular:
- `wcfSelectAll` pagination loop untouched
- `loadCattleWeighInsCached` two-query pattern untouched
- `detectSessionInUrl: false` + `storageKey: 'farm-planner-auth'` untouched
- `SetPasswordScreen` URL-hash recovery logic untouched
- `_wcfPersistData` debounce untouched
- No JSX `\u` escapes touched
- No `canAccessProgram` / `VIEW_TO_PROGRAM` semantics changed
- No Supabase schema changes
- No edge function changes

Also unchanged: all feature components (`CattleHerdsView`, `SheepFlocksView`, `WebformHub`, etc.) still receive state via props from App — no component signatures changed this round. Contexts exist but only `App()` consumes them so far; feature-folder extractions in Rounds 1–8 will switch those consumers to `useX()` hooks.

## 17.4 State that stayed in App()

Not in the plan's Context table — will land in feature folders during Rounds 1–8:
- Refs: `autoSaveTimer`, `pigAutoSaveTimer`, `subAutoSaveTimer`, `tripAutoSaveTimer`, `breedAutoSaveTimer`
- Pig UI flags: `leaderboardExpanded`, `showArchived`, `showArchBatches`
- Feed orders/inventories: `feedOrders`, `pigFeedInventory`, `pigFeedExpandedMonths`, `poultryFeedInventory`, `poultryFeedExpandedMonths`
- Notes: `pigNotes`, `layerNotes`
- Webforms admin state: `wfForm`, `wfSubmitting`, `wfDone`, `wfErr`, `wfGroupName`, `wfView`, `editWfId`, `editFieldId`, `wfFieldForm`, `newTeamMember`, `addingTo`, `editFldLbl`, `editFldVal`, `editSecIdx`, `editSecVal`, `newOpt`
- Pig batches UI: `showSubForm`, `subForm`, `editSubId`, `collapsedBatches`, `collapsedMonths`
- Legacy pig dailys form: `dailysFilter`, `showDailyForm`, `editDailyId`, `EMPTY_DAILY`, `dailyForm`
- Admin tab: `adminTab`

## 17.5 What's next

**Next session: Phase 2 Round 1** (leaf components per `MIGRATION_PLAN §6`):
- 2.1.1 `WcfYN` + `WcfToggle` → `src/shared/`
- 2.1.2 `DeleteModal` → `src/shared/`
- 2.1.3 `Header` → `src/shared/`
- 2.1.4 `AdminAddReportModal` + `AdminNewWeighInModal` + `PigSendToTripModal` + `CattleNewWeighInModal`
- 2.1.5 `SetPasswordScreen` + `LoginScreen` → `src/auth/` (forgot-password flow must be re-tested after this one — critical gate)

**Cutover (merge `vite-migration` → `main`) is still deferred.** Ronnie's call at end of session: build more rounds before merging. Round 0 is pure state plumbing — no user-visible improvement yet. Earliest reasonable cutover is after Round 1 or 2 when component extraction actually starts paying structural-organization dividends.

## 17.6 Gotchas for future Claude

1. **The provider tree matters for prop-forwarding** — `BatchesProvider` and `PigProvider` and `WebformsConfigProvider` accept initializer props (`formInit`, `tlStartInit`, `initialFarrowing`, `initialBreeders`, `breedTlStartInit`, `configInit`). These read module-scope constants from `main.jsx` (EMPTY_FORM, INITIAL_FARROWING, INITIAL_BREEDERS, DEFAULT_WEBFORMS_CONFIG, `thisMonday`, `toISO`). When extracting Round-6+ inline components that need those constants directly, prefer reading them from context over re-importing from main.jsx.
2. **App reads every context at the top of its body**. If a Round 1+ component doesn't need a specific context, don't route its state back through App as a prop — consume the hook directly (`const { authState } = useAuth()`). That's the entire point of the context move.
3. **Every round in Phase 2 is a session boundary.** Don't compress. The §15 rule exists because the deletion-incident risk in the migration is real; small per-session blast radius is the protection.
4. **The deploy preview URL has `deploy-preview-1--` prefix.** Anything that starts with just `cheerful-narwhal-` is **production** — we hit this confusion on 2026-04-19 and again watch out for it.
5. **`commit` vs `push`** per the memory rules: "commit" = just commit fully, no follow-up. "push"/"deploy"/"merge" always needs a separate, explicit approval in the same turn. Round 0's commit landed on "yes A" and pushed on "yes push" — two separate approvals. Don't skip that.

---

*End of April 20 session (part 1). Work-tree state at session end: clean. Commit `67d2ae3` pushed to `vite-migration`. Deploy preview green. Production unchanged. Next session: Phase 2 Round 1 leaf-component extractions.*

---

# 18. Session Update — April 20, 2026 (part 2) — Vite migration Phase 2 Rounds 1–5

**Branch: `vite-migration`. Main + production untouched — legacy monolithic `index.html` still serves `wcfplanner.com`.**

Long session. Phase 2 Rounds 1–5 landed + two runtime-crash fixups after preview smoke test. Round 6 (inline-JSX views inside App) is the next chunk — it needs the hook-based rewrite approach described in §18.6 rather than file-slicing. Details live in `MIGRATION_PLAN.md §14`; this is the cross-project summary.

## 18.1 What landed

Seven commits pushed to `vite-migration`. No production change — all still on `main`.

| SHA | Round | Files |
|---|---|---|
| `db2a1fd` | Round 1 | 10 components + 1 helper lib |
| `0aa3aeb` | Round 2 | 12 components |
| `0f858ac` | Round 3 | 8 components + 3 helper libs + 2 recovery splits |
| `42069b8` | Round 4 | 4 admin panels |
| `3d34089` | Round 5 | 3 public webforms |
| `a8bb819` | Fixup 1 | Recover DEFAULT_WEBFORMS_CONFIG + extract S styles (2 new libs) |
| `c0dd033` | Fixup 2 | Patch missing UsersModal + cattleCache imports in 9 views |

**Numbers at session end:**
- main.jsx: 19,170 → 9,035 lines (53% reduction).
- 40+ extracted components across `src/{auth,admin,broiler,cattle,layer,livestock,pig,sheep,shared,webforms}`.
- 6 helper libs in `src/lib/`: layerHousing.js, cattleCache.js, cattleBreeding.js, dateUtils.js, styles.js, defaults.js (plus pre-existing supabase.js, email.js, pagination.js).
- Build: 121+ modules (was 77 at session start), bundle size stable (code moved, not duplicated).
- All tabs verified on preview by Ronnie.

## 18.2 The breakthrough: PowerShell file-slicing

First attempted big-component extraction (AdminAddReportModal, 475 lines) introduced silent transcription drift — I dropped the `housingBatchMap` badge line in the layer-form branch because I was composing the Write payload across multiple Reads.

Pivoted to reading + writing the file bytes directly via PowerShell:
```powershell
$content = [System.IO.File]::ReadAllText($path)
$startIdx = $content.IndexOf('const XyzView = ({')
$endIdx   = $startIdx + $content.Substring($startIdx, $nextIdx - $startIdx).LastIndexOf('};') + 2
[System.IO.File]::WriteAllText($newFile, $header + $content.Substring($startIdx, $endIdx - $startIdx) + $footer)
```
The component body never enters my context — zero transcription risk. This is the pattern the remaining rounds should use.

## 18.3 Recovered bugs

**Round-1 anchor over-sweep.** Two components (LivestockWeighInsView and CattleWeighInsView) sat adjacent to modals that got extracted with wrong end-anchors. They were swept into AdminNewWeighInModal.jsx and PigSendToTripModal.jsx respectively, with only the first export emitted. Result: the `cattleweighins`, `broilerweighins`, `pigweighins` routes were silently broken after Round 1 (undefined module-scope refs).

Round 3 fix: split each co-resident file into a correctly-exported pair. Both routes now work.

**Lesson for future rounds:** when picking `nextAnchor`, always grep `^const \w|^function \w` in main.jsx and make sure the anchor is the immediately-next top-level decl, not two over. This trap bit three times (`LivestockWeighInsView` + `CattleWeighInsView` in Round 1, `DEFAULT_WEBFORMS_CONFIG` in Round 1's LoginScreen extraction).

## 18.4 What's extracted + where (for the handover)

```
src/
├─ main.jsx                     9,035 lines (was 19,170 at session 1 start)
├─ contexts/                    (Round 0 — state plumbing)
│  ├─ AuthContext.jsx, BatchesContext.jsx, PigContext.jsx,
│  ├─ LayerContext.jsx, DailysRecentContext.jsx,
│  └─ CattleHomeContext.jsx, SheepHomeContext.jsx,
│     WebformsConfigContext.jsx, FeedCostsContext.jsx, UIContext.jsx
├─ lib/                         (helpers)
│  ├─ supabase.js, email.js, pagination.js (Phase 2.0.0)
│  ├─ layerHousing.js           setHousingAnchorFromReport, computeProjectedCount, computeLayerFeedCost
│  ├─ cattleCache.js            loadCattleWeighInsCached, invalidateCattleWeighInsCache + module cache
│  ├─ cattleBreeding.js         calcCattleBreedingTimeline, buildCattleCycleSeqMap, cattleCycleLabel
│  ├─ dateUtils.js              addDays, toISO, fmt, fmtS, todayISO, thisMonday
│  ├─ styles.js                 S (shared inline-style object used by Header + dailys views)
│  └─ defaults.js               DEFAULT_WEBFORMS_CONFIG (consumed by WebformsConfigProvider)
├─ shared/                      WcfYN, WcfToggle, DeleteModal, AdminAddReportModal, AdminNewWeighInModal
├─ auth/                        SetPasswordScreen, LoginScreen, UsersModal
├─ admin/                       FeedCostsPanel, FeedCostByMonthPanel, LivestockFeedInputsPanel, NutritionTargetsPanel
├─ webforms/                    AddFeedWebform, WeighInsWebform, WebformHub
├─ broiler/                     BroilerDailysView
├─ layer/                       LayerDailysView, EggDailysView, LayersView
├─ pig/                         PigDailysView
├─ cattle/                      CattleDailysView, CattleBulkImport, CollapsibleOutcomeSections,
│                               CowDetail, CattleHomeView, CattleHerdsView, CattleBreedingView,
│                               CattleBatchesView, CattleWeighInsView, CattleNewWeighInModal
├─ sheep/                       SheepDailysView, SheepWeighInsView, SheepBulkImport, SheepDetail,
│                               SheepFlocksView, SheepHomeView
├─ livestock/                   LivestockWeighInsView, PigSendToTripModal
├─ dashboard/                   (empty — HomeDashboard stays in App until Round 7)
└─ equipment/                   (empty — placeholder stays in App until Round 8)
```

## 18.5 Runtime fixups after the Round 5 smoke test

Ronnie tested preview after Round 5; home hung on "Starting up". Two targeted commits landed same session:

| SHA | What |
|---|---|
| `a8bb819` | **Root cause of the hang:** Round 1's `LoginScreen` end-anchor swept `const DEFAULT_WEBFORMS_CONFIG` into `src/auth/LoginScreen.jsx`. main.jsx's root render uses it as `configInit={DEFAULT_WEBFORMS_CONFIG}` — undefined at module init → `root.render()` threw ReferenceError → React never mounted → static boot loader stayed. Fix: moved to `src/lib/defaults.js`. Same commit extracted `S` (shared styles object) to `src/lib/styles.js` and imported it into the 6 dailys views that use `style={S.header}` (second latent crash that would have hit on first nav). |
| `c0dd033` | Round 3's recovered `LivestockWeighInsView` + `CattleWeighInsView` used `<UsersModal>` without importing it; `CattleWeighInsView` also called `loadCattleWeighInsCached` / `invalidateCattleWeighInsCache` bare. Same missing-`UsersModal` issue across 7 cattle + sheep home/weigh-in views. Patched all. |

Ronnie verified all tabs (including `/cattleweighins`) after the second fix. Migration state is clean.

**Takeaway for future rounds:** after every batch extraction, run a "bare-name audit" — find identifiers used in the extracted body that aren't in an `import` statement or a top-level `const|let|function` declaration. Two lines of Node shell did the job when it finally ran, would have caught both regressions before Ronnie had to smoke-test.

## 18.6 What's NOT extracted (Round 6+)

**Round 6 — 11 inline-JSX views inside App.** These are JSX blocks inside `if(view==="X") return (…)` branches that close over ~40 App-scope variables, not standalone components. PowerShell file-slice does not apply.

Locations in current main.jsx: broilerHome (L3032), timeline (L3342), list (L3609), feed (L3929, ~1026 lines), pigsHome (L4955), breeding (L5264), pigbatches (L5579, ~1226 lines), farrowing (L6805), sows (L7278). Plus BatchForm + PigFeedView nested inside one of the above.

**Approach — hook-based.** Each inline view becomes a real component in its feature folder that consumes Contexts directly (`useAuth()`, `useBatches()`, `usePig()`, etc.) — Round 0 set this up deliberately. Non-App helpers (submit, del, openEdit) lift to `src/<feature>/<feature>Ops.js` or custom hooks. Ship per-view commits, preview-test each, keep moving.

**Round 7 — HomeDashboard.** Inline in App, consumes most of App's state. Split across commits if one diff exceeds ~1500 moved lines — just for skim-ability, not risk.

**Round 8 — EquipmentPlaceholder.** Stub. Last.

**Deferred from earlier rounds:**
- `Header` (Round 1) — closes over ~12 App-scope refs + helpers. Fits naturally into Round 6 once App helpers lift to lib.
- `LayerBatchesView` (Round 2) — 855 lines, uses 6 module-scope helpers. 4 are now in `src/lib/`; `calcPhaseFromAge` + `inRange` still need lifting. Quick win.

## 18.7 Things that don't work — don't re-propose them

1. **Extract Header verbatim.** It closes over App's scope — won't compile as a standalone component without lifting App helpers first.
2. **Transcribe 500-line components into Write payloads.** That's where the first session's drift came from. PowerShell file-slice.
3. **Round 6 via PowerShell file-slice.** Inline JSX has closure deps, not a valid standalone module. Use the hook-based rewrite instead.
4. **Touch the `housingBatchMap` bare-name reference in `AdminAddReportModal.jsx`.** Pre-existing quirk from the monolith; the condition short-circuits on empty `lForm.batchLabel` so it's likely dead. Separate bug hunt, not migration work.

## 18.8 Hard rules (short list)

- **`commit` = commit fully, one-line status, no follow-up prompt.**
- **`push` / `deploy` / `merge`** = fresh explicit approval in the same turn.
- **Don't merge `vite-migration` → `main`** without "merge" or "cutover" from Ronnie.
- **Don't run destructive Supabase ops** without approval (DROP, TRUNCATE, bare DELETEs).
- **Don't touch `MIGRATION_PLAN §10` don't-touch list** — wcfSelectAll, detectSessionInUrl, auth listener, source-label strings, etc.

Everything else is judgment. Use the preview as the safety net — build locally, push, check the preview, iterate. Don't stop to re-confirm each decision; Ronnie can redirect in the moment if needed.

---

*End of April 20 session (part 2). Commits `db2a1fd` → `c0dd033` pushed to `vite-migration` (Rounds 0–5 + two fixups). main.jsx down 53%. All tabs verified on preview. Production unchanged. Next session: Phase 2 Round 6 — use the hook-based approach described in §18.6, ship per-view commits, iterate fast.*

---

# 19. Session Update — April 20, 2026 (part 3) — Vite migration Phase 2 Round 6 complete

**Branch: `vite-migration`. Main + production untouched — legacy monolithic `index.html` still serves `wcfplanner.com`.**

All 12 inline-JSX views that lived inside App() are now standalone components under `src/<feature>/`. main.jsx down another 44% this session (7,200 → 3,996 lines). 22 commits pushed. Full log in `MIGRATION_PLAN.md §14` under "2026-04-20 (session 3)".

## 19.1 What landed

12 view extractions + 4 supporting lifts + 6 runtime fixups, all on `vite-migration`:

| SHA | What |
|---|---|
| `083494f` | BroilerHomeView + initial broiler-helpers lift |
| `d6897c9` | Lift timeline + batch-color deps to `lib/broiler.js` |
| `5db0a7a` | BroilerTimelineView |
| `a5635b6` | BroilerListView + lift `STATUS_STYLE` / `isNearHoliday` |
| `38051d9` | New `src/lib/pig.js` (pig breeding helpers) |
| `4a05a5f` | PigsHomeView |
| `66a792e` | LayersHomeView |
| `b8de123` | BreedingView |
| `204deef` | FarrowingView |
| `a718d21` | SowsView |
| `2c3679e` | PigFeedView |
| `f7f268b` | PigBatchesView (largest view at 662 body lines) |
| `1188fa7` | WebformsAdminView |
| `5fbe3da` | BroilerFeedView + lift feed-month helpers |
| `7cca2d9` … `ab94108` | 8 runtime fixup commits after preview smoke tests |

**Numbers at session end:**
- main.jsx: 7,200 → 3,996 lines (-44% this session, -78% vs pre-migration).
- 52+ extracted components across `src/{auth,admin,broiler,cattle,layer,livestock,pig,sheep,shared,webforms}`.
- 8 helper libs in `src/lib/`: supabase.js, email.js, pagination.js (Phase 2.0.0), layerHousing.js, cattleCache.js, cattleBreeding.js, dateUtils.js, styles.js, defaults.js, **broiler.js** (new, 368 lines), **pig.js** (new, 80 lines).
- Build: 140+ modules, bundle ~1.27 MB gzipped 293 KB (stable).
- All 12 extracted views verified loading on preview by Ronnie.

## 19.2 Round 6 approach — hook-based, not file-slice

Per §18.6, the inline views could not be extracted by PowerShell file-slicing like Rounds 1-5 were, because they close over App-scope variables (not standalone modules). The working pattern this session:

1. **Read the inline block** — inventory every closure reference (state, helpers, hooks, etc.).
2. **Decide split** — everything in a Context → destructure via hooks; everything still App-scope → accept as prop.
3. **PowerShell-slice the JSX body** (skip the `if(view==="X") {` wrapper and its closing `}`) into a new file with a hook-consuming header prepended.
4. **Replace the inline block** in main.jsx with a 1-line `React.createElement(NewView, {...})` dispatch.
5. **Audit bare names** against every known lib export + context state + App helper.
6. **Build**, then **push**, then **smoke-test** on the preview.

The hook-based header looks like this (simplified):
```jsx
import React from 'react';
import { sb } from '../lib/supabase.js';
import { fmt, fmtS, todayISO, addDays, toISO } from '../lib/dateUtils.js';
import { S } from '../lib/styles.js';
import { useAuth } from '../contexts/AuthContext.jsx';
import { useBatches } from '../contexts/BatchesContext.jsx';
// ...feature contexts + lib helpers + UsersModal

export default function FeatureView({ Header, loadUsers, ...appProps }) {
  const { authState, showUsers, setShowUsers, allUsers, setAllUsers } = useAuth();
  const { batches } = useBatches();
  // ...more hook destructures
  // [verbatim body from the inline block]
  return ( /* JSX */ );
}
```

## 19.3 The cascade of runtime ReferenceErrors (and the lesson)

The hook-based extraction introduced **far more missing-reference bugs than any previous round**. The April 20 session 2 bug was one `DEFAULT_WEBFORMS_CONFIG` miss; session 3's runtime fixups totaled ~30 missing names across 8 commits. Every single one was the same class of bug:

> An identifier used in the view body wasn't in the imports, wasn't destructured from a hook, and wasn't in the function's prop signature.

Examples: `isAdmin`, `persist`, `del`, `confirmDelete`, `setShowAllComparison`, `showAllComparison`, `setBatches`, `BREED_STYLE`, `breedLabel`, `LAYER_FEED_SCHEDULE`, `LAYER_FEED_PER_DAY`, `toISO`, `tooltip`, `setTooltip`, `calcCycleStatus`, `resolveSire`, `pigDailys`, `feedCosts`, `feedOrders`, `setFeedOrders`, `PIG_GROUPS`, `PIG_GROUP_COLORS`, `setShowArchBatches`, `FeedCostsPanel`, `FeedCostByMonthPanel`, `LivestockFeedInputsPanel`, `NutritionTargetsPanel`, `saveFeedCosts`, `adminTab`, `setAdminTab`.

**Why this happens with hook-based extraction:** file-slice extractions in Rounds 1-5 worked because the component was *already* a self-contained function with a clear parameter list — the bytes were lifted verbatim. Hook-based extractions wrap the original inline body (which used closure-captured names from App) in a *new* function that has to *recreate* that closure via imports, hook destructures, and props. Every name in the body is a potential miss.

**The cure is an automated audit.** Eyeballing the top of the view body doesn't scale — the missing names tend to live deep in event handlers (the `isAdmin` miss was at L129 of a 357-line file). Future sessions should use the audit pattern built this session (see `MIGRATION_PLAN.md §14` 2026-04-20 session 3 entry for the script structure):

1. Parse imports, destructured consts, and function params from the new file → build a "known" set.
2. Grep the body for every name in a pool containing: all lib exports, all context state names, all known App helpers, all Round-0-deferred App state.
3. Diff. Missing = either import it, hook-destructure it, or add it as a prop.
4. Strip JSDoc comment text + string literals before the grep (words like "view", "form", "override", "batches" are valid prose).

A build-clean run does not catch this — ReferenceErrors only fire at runtime when the view first renders.

## 19.4 What's extracted + where (updated tree)

```
src/
├─ main.jsx                     3,996 lines (was 19,170 pre-migration, -78%)
├─ contexts/                    (Round 0 — unchanged)
├─ lib/                         (10 helper modules)
│  ├─ supabase.js, email.js, pagination.js       (Phase 2.0.0)
│  ├─ layerHousing.js, cattleCache.js, cattleBreeding.js,
│  ├─ dateUtils.js, styles.js, defaults.js       (Rounds 1-5)
│  ├─ broiler.js                368 lines — broiler-domain helpers + constants
│  └─ pig.js                    80 lines — pig breeding helpers + constants
├─ auth/                        SetPasswordScreen, LoginScreen, UsersModal
├─ shared/                      WcfYN, WcfToggle, DeleteModal, AdminAddReportModal, AdminNewWeighInModal
├─ admin/                       FeedCostsPanel, FeedCostByMonthPanel, LivestockFeedInputsPanel, NutritionTargetsPanel
├─ webforms/                    AddFeedWebform, WeighInsWebform, WebformHub, WebformsAdminView ← NEW
├─ broiler/                     BroilerDailysView + (NEW) BroilerHomeView, BroilerTimelineView, BroilerListView, BroilerFeedView
├─ layer/                       LayerDailysView, EggDailysView, LayersView + (NEW) LayersHomeView
├─ pig/                         PigDailysView + (NEW) PigsHomeView, BreedingView, FarrowingView, SowsView, PigFeedView, PigBatchesView
├─ cattle/                      (unchanged from Round 5)
├─ sheep/                       (unchanged from Round 5)
├─ livestock/                   (unchanged from Round 5)
└─ dashboard/, equipment/       (still empty — HomeDashboard + EquipmentPlaceholder in App)
```

## 19.5 What's NOT extracted (still inline in App)

**Round 7 — `HomeDashboard`.** The `home` view is still an inline block in App, reading most of App's state. ~1,000 lines. Similar hook-based approach will work.

**Round 8 — `EquipmentPlaceholder`.** The `equipmentHome` view is a trivial stub. Should take 15 minutes.

**`Header` component.** Still inline in App. Closes over ~12 App helpers (signOut, backupData, restoreData, loadUsers) plus the nav-menu routing logic. Every extracted view takes `Header` as a prop. Extracting Header would eliminate that prop from 50+ call sites, but requires lifting App helpers to a hook first. Not urgent.

**`BatchForm` (broiler add/edit modal).** Still inline in App, rendered conditionally via `showForm && …`. ~1,100 lines. Heaviest remaining inline block. Uses form + edit state from BatchesContext + `setHousingAnchorFromReport` + local field helpers. Similar shape to the breeding view; should be extractable via the same pattern.

**`LayerBatchesView`.** Round 2 deferral — 855 lines as a prop-drilled component, but its body still uses `calcPhaseFromAge` and `inRange` which haven't been lifted. Quick win if the next session wants it.

**~40 App-scope `useState` hooks + helpers.** Not a blocker — they just mean extracted views receive long prop lists. The worst offender is `WebformsAdminView` (30+ props). Future cleanup: promote these to contexts (`UIContext` could grow to own `adminTab`, `collapsedBatches`, etc.; a new `PigOpsContext` or `usePigOps()` hook could own the auto-save timers + persist helpers).

## 19.6 Things that don't work — don't re-propose them

1. **Eyeballing the view body for missing references.** Use an audit script. The April 20 session 3 runtime-fixup cascade is proof: 8 commits, ~30 misses, half of them inside event handlers 100+ lines into the file. No human reading the extracted file top-to-bottom will catch them all reliably.
2. **Trusting a clean `npm run build` as proof of correctness.** ReferenceErrors only fire at runtime. Build-pass + audit-pass → then push → then browser smoke-test.
3. **`awk`-ing `^  if\(view===` and using that line number as the end of `RemoveRange`.** The next view's `if` is ~2-3 lines after the current view's closing `}`. Off-by-one bites you. PowerShell-verify the closing-brace index directly before slicing.
4. **Still don't touch** `housingBatchMap` in `AdminAddReportModal.jsx`, the auth listener, `wcfSelectAll`, `detectSessionInUrl:false`, or the `§10` don't-touch list.

## 19.7 Hard rules (unchanged)

- `commit` = do it. One-line status. No "ready to push?" follow-up.
- `push` / `deploy` / `merge` = fresh explicit approval in the same turn.
- Don't merge `vite-migration` → `main` without Ronnie saying "merge" or "cutover". **Round 6 is now a reasonable cutover point** if Ronnie wants it — app is structurally sound, preview is green, and Round 7-8 are small.
- Destructive Supabase ops need approval.
- `§10` don't-touch list is still authoritative.

---

*End of April 20 session 3. Commits `083494f` → `ab94108` pushed to `vite-migration`. Round 6 complete. main.jsx down 78% from pre-migration. All tabs verified on preview. Production unchanged. Next session: Round 7 (HomeDashboard) or a cutover to main — Ronnie's call.*

---

# 20. Session Update — April 21, 2026 (Phase 2 finale — Rounds 6 tail + 7 + 8)

All remaining inline views lifted out of App(). main.jsx down another 50% this session (3,996 → 1,994 lines). Six commits pushed. Ronnie smoke-tested the preview after the final push — all tabs clean, no runtime fixups needed this session. Migration is structurally ready for cutover.

## 20.1 What landed

Five extractions, in order of ascending risk:

| SHA | What |
|---|---|
| `b2e9a86` | Round 8: EquipmentPlaceholder → `src/equipment/` (trivial stub). |
| `9fe35ce` | Round 2 tail: LayerBatchesView → `src/layer/LayerBatchesView.jsx`. File-slice of the existing ~864-line module-scope const. Along the way, lifted 5 broiler/layer housing primitives to `lib/broiler.js` so `detectConflicts` (main.jsx) and the extracted view share one source: `BROODERS`, `SCHOONERS`, `BROODER_CLEANOUT`, `SCHOONER_CLEANOUT`, `overlaps()`. **Latent bug fix:** the inline LayerBatchesView's Delete Batch button called bare `confirmDelete(...)`, which would have ReferenceError'd the first time anyone clicked it under Vite's strict mode (only `window._wcfConfirmDelete` was ever registered). Added `confirmDelete` to the prop signature + threaded from App. |
| `f5bf02d` | Round 7: HomeDashboard → `src/dashboard/HomeDashboard.jsx`. Hook-based. ~540 lines. Reads every data context (auth, batches, pig, layer, dailysRecent, cattleHome, sheepHome, feedCosts, ui). `canAccessProgram` + `VIEW_TO_PROGRAM` still live in App (their other consumer is the redirect effect), threaded as props. Contents: nav cards, Animals on Farm, Missed Daily Reports (7-day lookback), Next 30 Days events, admin-only Last 5 Days per-species tiles. |
| `aa2ba21` | Round 6 tail: Header → `src/shared/Header.jsx`. Hook-based. ~100 lines. Context reads for view/menu/auth/form-open booleans; props for the four App helpers (`signOut`, `backupData`, `restoreData`, `loadUsers`), `showDailyForm`, and the built-up `DeleteConfirmModal`. App keeps a local `Header = () => React.createElement(HeaderBase, {...})` wrapper closure so the ~50 call sites in extracted views still say `<Header/>` with no args — zero ripple. |
| `0a19f4b` | Round 6 tail: BatchForm → `src/broiler/BatchForm.jsx`. Hook-based. ~465 lines. The broiler add/edit modal. Takes 8 App-only helpers as props (`upd`, `closeForm`, `submit`, `del`, `openEdit`, `parseProcessorXlsx`, `confirmDelete`, `persist`). Derived values (`tl`, `targetHatch`, `hatchSuggestions`, `hatchWarn`, `procWarn`, `hatcheries`) are recomputed inside the component — only BatchForm ever consumed them. `lib/broiler.js` also gained 5 more exports: `STATUSES`, `ALL_HATCHERIES`, `LEGACY_HATCHERIES`, `calcTargetHatch`, `suggestHatchDates`. |

Plus one housekeeping commit (`7a3e91c`) to delete dev-only `tmp_audit.cjs` / `tmp_home.txt` files accidentally committed alongside the HomeDashboard push.

## 20.2 Numbers at session end

- **main.jsx: 3,996 → 1,994 lines** (-50% this session, **-90% vs pre-migration 19,170**).
- 54+ extracted components under `src/{auth,admin,broiler,cattle,dashboard,equipment,layer,livestock,pig,sheep,shared,webforms}`.
- **11 helper libs** in `src/lib/` — supabase.js, email.js, pagination.js (Phase 2.0.0), dateUtils.js, styles.js, defaults.js, layerHousing.js, cattleCache.js, cattleBreeding.js, pig.js, and **broiler.js** (now ~420 lines — broiler domain + housing primitives + hatchery constants + hatch-date helpers + overlap helper).
- Build: 149 modules (was 144 at session start), bundle ~1.27 MB / 295 KB gzip (unchanged — code moved, not duplicated).
- Every extraction verified with `npm run build` clean before commit.
- Final preview smoke-test by Ronnie: everything looks good.

## 20.3 Round-6-tail approach — hook-based again, with one wrinkle

Header is called from ~50 call sites across the extracted views as a zero-arg `<Header/>` prop. Changing the signature to accept props would force 50+ call-site edits. The minimum-ripple trick: App keeps a local `Header = () => React.createElement(HeaderBase, { ...appOnlyProps })` closure. The closure pulls from App scope, the extracted component pulls from its own hook destructures. No view-level changes.

BatchForm is called from exactly one site (`if(showForm) return React.createElement(BatchForm, {...})`), so props pass straight through without a closure wrapper.

## 20.4 Dead-code sweep

Main.jsx gained some cruft over the migration that the cleanup made visible:
- Timeline helpers (`tlS`, `tlE`, `totalDays`, `pct`, `wkHdrs`) were only used by the old inline home-view timeline display — dead once Round 7 moved out.
- Form-derived values (`tl`, `targetHatch`, `hatchSuggestions`, `hatchWarn`, `procWarn`, `hatcheries`) were only used by BatchForm — dead once Round 6 tail moved out.
- `counts` reducer had zero consumers after the home extraction.
- `CC_HATCHERIES` + `WR_HATCHERIES` pre-decoupling-era constants — no live code consumed them. Dropped.

All removed in `0a19f4b`.

## 20.5 What's extracted + where (final tree for cutover)

```
src/
├─ main.jsx                     1,994 lines
├─ contexts/                    10 providers (unchanged since Round 0)
├─ lib/                         11 helper modules
│  ├─ supabase.js, email.js, pagination.js       (Phase 2.0.0)
│  ├─ dateUtils.js, styles.js, defaults.js       (Round 1-3)
│  ├─ layerHousing.js, cattleCache.js,
│  │  cattleBreeding.js                          (Round 2-3)
│  ├─ broiler.js                ~420 lines — full broiler domain
│  │                            (constants, housing primitives, hatchery
│  │                             lists, calcTimeline/Status/Feed/Batch*,
│  │                             hatch helpers, overlap)
│  └─ pig.js                    ~80 lines — pig breeding helpers + consts
├─ auth/                        SetPasswordScreen, LoginScreen, UsersModal
├─ shared/                      WcfYN, WcfToggle, DeleteModal, AdminAddReportModal,
│                               AdminNewWeighInModal, Header ← NEW (Round 6 tail)
├─ admin/                       FeedCostsPanel, FeedCostByMonthPanel,
│                               LivestockFeedInputsPanel, NutritionTargetsPanel
├─ webforms/                    AddFeedWebform, WeighInsWebform, WebformHub,
│                               WebformsAdminView
├─ dashboard/                   HomeDashboard ← NEW (Round 7)
├─ equipment/                   EquipmentPlaceholder ← NEW (Round 8)
├─ broiler/                     BroilerDailysView, BroilerHomeView,
│                               BroilerTimelineView, BroilerListView,
│                               BroilerFeedView, BatchForm ← NEW (Round 6 tail)
├─ layer/                       LayerDailysView, EggDailysView, LayersView,
│                               LayersHomeView, LayerBatchesView ← NEW
│                               (Round 2 tail)
├─ pig/                         PigDailysView, PigsHomeView, BreedingView,
│                               FarrowingView, SowsView, PigFeedView,
│                               PigBatchesView
├─ cattle/                      8 views (unchanged since Round 3)
├─ sheep/                       6 views (unchanged since Round 2-3)
└─ livestock/                   LivestockWeighInsView, PigSendToTripModal
```

## 20.6 What's left in App() (~1,400 functional lines)

**Not inline views anymore** — App is now pure provider/wiring/helpers/dispatch. The shape:
- Imports (≈150 lines)
- Top-of-file constants still referenced by App: `STORAGE_KEY`, `CATTLE_*` constants (herd labels, colors, breeding days), `INITIAL_BREEDERS`, `INITIAL_FARROWING`, `EMPTY_FORM`, `detectConflicts`, `writeBroilerBatchAvg`, `canEditDailys`/`canDeleteDailys`/`canEditAnything`/`canDeleteAnything`
- `function App()` body:
  - Context hook destructures (10 contexts)
  - Role derived values
  - Refs + App-scope `useState` hooks (deferred from Round 0): 5 timer refs + `feedOrders`, `pigFeedInventory`, `pigFeedExpandedMonths`, `poultryFeedInventory`, `poultryFeedExpandedMonths`, `collapsedBatches`, `collapsedMonths`, `adminTab`, `leaderboardExpanded`, `showArchived`, `showArchBatches`, `pigNotes`, `layerNotes`, `dailysFilter`, `dailyForm`, + 14 `wf*` form-state pairs
  - Effects: webform config load, cattle count, initial dailys loads, `refreshDailys`, VALID_VIEWS gate, `canAccessProgram` redirect, auth listener + timeout, visibility refresh
  - `loadUser`, `loadAllData` (loads 19 `app_store` keys + paginated pig/poultry dailys)
  - `loadUsers`, `saveFeedCosts`, `sbSave`, `signOut`, 9 persist* helpers, `syncWebformConfig`, `persistDaily`/`deleteDaily`, `backupData`/`restoreData`
  - Form helpers: `upd`, `openAdd`, `openEdit`, `parseProcessorXlsx`, `confirmDelete`, `closeForm`, `submit`, `del`
  - `Header` wrapper closure
  - `DeleteConfirmModal` memo
  - Webform bypass routes (addfeed/weighins/webformhub/webform)
  - Auth gates (pwRecovery/null/false/!dataLoaded)
  - View dispatch table (one `if(view==="…") return React.createElement(…)` per view)
  - `renderWebform()` nested (pig-dailys legacy public form)
  - `resolveSire` helper
  - `return null` default
- Root render with the 10-provider stack

## 20.7 Session lessons — what the hook-based audit pattern earned us

The April 20 session 3 fixup cascade (8 commits of missing bare names after preview smoke-test) was specifically addressed this session by:
1. Writing an automated `tmp_audit.cjs` that parses a file's imports + destructures + function params + local declarations, then diffs against every identifier-looking reference. Flags likely missing names.
2. Running it on each hook-based extraction (Header, BatchForm) before push.
3. Filtering the noisy output (JSX tag names, text content, style values) to focus on real suspects.
4. Cross-checking the remaining suspects against the §14 Round 6 blast list (`persist`, `del`, `confirmDelete`, `feedCosts`, `isAdmin`, `resolveSire`, `setShowAllComparison`, etc.).

Result: this session's 5 extractions, including the two biggest hook-based ones (HomeDashboard ~540 lines, BatchForm ~465 lines), shipped **without a single post-push fixup**. Ronnie's smoke-test was the final gate; previously that gate caught 6-8 misses per session. Script + blast-list review worked.

The `tmp_audit.cjs` + `tmp_header.txt`/`tmp_bf.txt` files are dev-only and deleted at end of session. They live in the repo root during work and should never be committed; one slip-up happened this session (`7a3e91c` cleanup) and is a reminder to `git status` before every add.

## 20.8 Things that don't work — don't re-propose them

Same list as §19.6, still authoritative. Plus:

- **Don't commit the `tmp_audit.cjs` / `tmp_*.txt` dev scripts.** They're extraction-specific scratch files. Delete before `git add`.
- **Don't regress the latent-bug fix in LayerBatchesView.** `confirmDelete` must stay a prop; if something re-extracts it as a bare identifier, strict-mode will ReferenceError the first time Delete Batch is clicked.

## 20.9 Hard rules (unchanged)

- `commit` = do it. One-line status.
- `push` / `deploy` / `merge` = fresh explicit approval same turn.
- **Cutover is Ronnie's call.** `vite-migration` → `main` merge is the next natural step — Round 6 (with tail), Round 7, Round 8 are all shipped and preview-verified. App is structurally where §4 targeted.
- Destructive Supabase ops still need approval.
- `§10` don't-touch list is still authoritative.

## 20.10 What's next

**Primary option — cutover.** Migration is structurally done. `vite-migration` has 7 Phase-2 rounds + all tails extracted. main.jsx is 1,994 lines of pure wiring. Preview has been green for two consecutive sessions. The smart call is to merge → `main`, watch Netlify, run the §8 smoke-test on production, and declare cutover complete.

**Secondary option — polish.** Before cutover, promote more App-scope state to contexts so the extracted views' prop lists shrink:
- `feedOrders` + setters → `FeedCostsContext`
- `collapsedBatches`, `collapsedMonths`, `showArchBatches`, `showArchived`, `leaderboardExpanded` → `UIContext`
- Auto-save timer refs + `persistFeeders`/`persistBreeding`/etc. → a new `usePigOps()` custom hook
- 14 `wf*` form-state pairs → a `useWebformsAdminForm()` custom hook

These would cut WebformsAdminView, PigBatchesView, and SowsView prop lists roughly in half. NOT required for correctness; purely ergonomic. Could wait until after Phase 3 (React Router).

**Tertiary option — Phase 3 (React Router).** Per §7 in MIGRATION_PLAN.md. ~6 commits to replace `setView(X)` with `useNavigate()` + add the hash-compat shim. Best done on a fresh branch after cutover so the provider tree and the dispatch table aren't both churning at once.

**Ronnie's call.** Don't pre-empt.

---

*End of April 21, 2026 session. Commits `b2e9a86` → `0a19f4b` pushed to `vite-migration`. Phase 2 structurally complete. main.jsx down 90% from pre-migration. Ronnie preview-verified. Production unchanged. Cutover is the obvious next move; waiting on Ronnie's say-so.*
