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

*End of Handover Document*
