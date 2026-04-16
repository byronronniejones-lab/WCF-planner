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
