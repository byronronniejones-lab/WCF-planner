**WCF PLANNER**

White Creek Farm

*Full System Handover Document*

Updated April 12, 2026

*Original build: April 9-11, 2026. Add Feed Webform + UI overhaul session: April 12, 2026.*

---

# SESSION SUMMARY — April 12, 2026

This section covers everything built, tested, decided, and left open during the April 12 session. **Read this section first** before touching any code.

## 1. What Was Built and Shipped

### Add Feed Webform (DECISIONS.md Items 1-7)

All items from DECISIONS.md were completed:

**Item 1 — AddFeedWebform component:** Built as a standalone public component at hash route `#addfeed`. Inserts a new row into `layer_dailys`, `poultry_dailys`, or `pig_dailys` with `source: 'add_feed_webform'`. All other observation fields are omitted from the insert object. Pig inserts do NOT include `feed_type` (column doesn't exist on `pig_dailys`). ID generation: `String(Date.now())+Math.random().toString(36).slice(2,6)`. Component lives just before `WebformHub` in `index.html`.

**Item 2 — Routing wired:** `#addfeed` hash check in router, `'addfeed'` in `VALID_VIEWS`, public bypass before auth gates (`if(view==="addfeed") return React.createElement(AddFeedWebform, {sb})`), amber card at top of WebformHub hub screen.

**Item 3 — Badges in Reports lists:** All 3 dailys views (BroilerDailysView, LayerDailysView, PigDailysView) show amber background + amber border + "🌾 Feed" badge pill on rows where `source === 'add_feed_webform'`.

**Item 4 — Filter chips:** Tri-state `[All | Daily Reports | 🌾 Add Feed]` toggle in each dailys view filter bar. Filter logic: `all` = no filter, `daily` = `r.source !== 'add_feed_webform'`, `addfeed` = `r.source === 'add_feed_webform'`. Null handling is correct for existing rows.

**Item 5 — Edit modal field hiding:** When editing a row with `source === 'add_feed_webform'`, non-feed fields (grit, mortality, checks, comments, pig count, voltage) are hidden. Feed-relevant fields (date, batch, team member, feed_lbs, feed_type) remain editable. Modal title changes to "Edit [Program] Add Feed Report". Layer modal adds a feed_type toggle for Add Feed edits.

**Item 6 — In-planner Add Feed button:** "🌾 Add Feed" button added to Broiler Dailys, Layer Dailys, and Pig Dailys views next to the existing "+ Add Report" button. Navigates to `#addfeed` via `window.location.hash='#addfeed';window.location.reload();`.

**Item 7 — Admin panel:** Add Feed webform entry is auto-injected into `webformsConfig.webforms` on load if not already present. Appears in admin panel with amber styling. Full sections/fields editor available — fields can be toggled on/off, marked required, relabeled. Add Group toggle works. Team member management works. Per-form team members fall back to global list if none configured (same as all other webforms).

### AddFeedWebform Component Details

- **Admin-configurable:** Reads `full_config` from `webform_config` to get field enabled/required/label settings. Uses `isEnabled()`, `isRequired()`, `getLabel()` helpers.
- **Add Group support:** `extraGroups` state array. "+ Add Another Group" button appears when `allowAddGroup` is enabled in admin config. All groups submit as separate records.
- **Form flow:** Date → Team Member (optional) → Program (Pig/Broiler/Layer buttons) → Batch dropdown → Feed Type (not pig) → Feed lbs → Submit.
- **Config loading:** Loads `housing_batch_map`, `broiler_groups`, `active_groups`, `team_members`, `per_form_team_members`, `full_config`, `webform_settings` from `webform_config` table (anon access).
- **Layer batch_id:** Set to `null` on layer inserts. Can't resolve batch_id in anon context. This is the same as existing layer webform behavior. Aggregation works via `batch_label` + `.reduce()`.
- **Navigation:** Uses `window.location.hash` + `window.location.reload()` because the Add Feed form lives at the public bypass level and React state-based navigation doesn't work for crossing the auth boundary.

### UI Polish — Daily Report Tiles

Applied consistently across all 3 standalone dailys views AND the home dashboard "LAST 5 DAYS" section:

- **Yes/No fields:** Colored pill badges (green background for Yes, red for No) replacing plain checkmark text. Applied to Moved, Waterer, Nipple, Fence.
- **Mortality:** Red pill badge when present, with mortality reason shown inline (💀 2 mort. — reason). Hidden muted text when absent.
- **Team member:** Slate-blue pill badge.
- **Comments/Issues:** Amber pill with 💬 icon. Consistent across broiler, layer, and pig views.
- **Feed type pills:** Already existed, unchanged.
- **Home dashboard type headers:** Enlarged from 10px to 13px. Tile gap increased from 3px to 8px. Section margin increased.
- **Notable border:** Removed yes/no fields from `notable` check on home dashboard. Only mortality, comments, and low voltage trigger the red border now.

### Pig Dashboard Overhaul

Replaced the basic pig dashboard with a data-rich view:

- **Stat tiles (2 rows of 4):** Pigs on Farm, Active Sows (with boar count sub), Active Cycles, Active Batches, Avg Born/Litter, Avg Alive/Litter, Overall Survival (with record count), Processed [Year] (with avg yield).
- **Pigs on Farm Breakdown:** Individual tiles per group (SOWS, BOARS, then sub-batches sorted alphabetically). Only includes active batch pigs + SOWS + BOARS.
- **Next Farrowing banner:** Shows upcoming farrowing window with "Window is OPEN" if in range.
- **Active Feeder Batches:** Box-style metrics instead of line items. Colored header bars alternating green/amber/blue/pink per batch. Shows Current count, Original, Total Feed, Feed/Pig, Feed Cost, Cost/Pig, Report Days.
- **Bar graphs side by side:** Farrowing Survival and Carcass Yield Trend in a 2-column grid.
- **Removed:** Pig Notes section, Recent Daily Reports section.

### Pig Feed Planning Tab (New — Replaces Old Calculator)

Complete replacement of the manual pig feed calculator (view==="pigs" / view==="pigfeed"):

- **Current Daily Snapshot:** 4 tiles showing today's total daily need, sow feed (with nursing breakdown), boar feed, feeder pig feed.
- **Nursing sow logic:** `nursingSowsOnDate(dateISO)` function scans all breeding cycles and farrowing records. A sow is nursing from her `farrowingDate` through `weaningEnd` of her cycle.
- **Feed on Hand estimate:** Total ordered (from feed orders) minus total consumed (from pig_dailys). Shows days of feed remaining.
- **Monthly Summary Table:** 6 past months + 3 future months. Columns: Month, Projected (calculated from rates), Actual (from pig_dailys), Variance, Ordered (editable input), On Hand.
- **Feed orders:** Stored in `app_store` key `ppp-feed-orders-v1` as `{pig:{}, broiler:{}}`. Editable per-month input in the table. Auto-saves on change.
- **Feed Rate Reference:** Quick reference card showing all rates.

### Other Features Built

- **Debounced auto-save + modal conversion:** Breeding cycles, processing trips, sub-batches all converted from inline forms to modal overlays with 1.5s debounced auto-save and save-on-close behavior. Done/Cancel buttons removed (only Delete shown when editing).
- **Pig batch form:** All fields marked required. Original pig count auto-calculated from gilts + boars.
- **Layer batch delete:** Delete button added to edit modal (hidden for Retirement Home).
- **Retirement Home cleanup:** Edit modal hides Original Count, Supplier, Cost per Bird, Feed Cost Rates, Brooder Phase, Schooner Phase. Housing card hides Starter/Grower columns. Feed cost rates fall back to global rates. Included in saveFeedCosts.
- **Per-batch housing colors:** Layer Batches list and Dashboard use rotating color palette (green, blue, amber, purple) for housing pills and cards. All housings within same batch share color.
- **Colored header bars:** Layer batch cards on both Dashboard and Batches page have colored header bars matching the housing palette.
- **Delete confirmations:** ALL delete actions across the entire app now use the type-"delete" confirmation modal (DeleteModal). No more `window.confirm` for deletes.
- **Mortality reason:** Hidden until mortality count > 0, then required with red asterisk. Enforced in all forms: public webforms, AdminAddReportModal, standalone edit modals. Validation in `validateRequiredFields` and explicit submit checks.
- **Feed type conditional:** Only required when feed_lbs > 0. Applied in `validateRequiredFields` and all submit functions.
- **Pagination dedup:** All 3 dailys views (Broiler, Layer, Egg) have a `pgLoading` ref guard to prevent concurrent fetches, plus ID deduplication on append.
- **Timeline bar opacity:** Broiler timeline bars render at 80% opacity.
- **Filter toggle dividers:** Source filter buttons have 1px borders between them.
- **Home dashboard Animals on Farm:** White stat card above Missed Daily Reports showing Broilers, Layer Hens, Pigs, and Total Animals. Non-clickable, visible to all roles.
- **Layer icon:** Add Feed form uses 🐓 (rooster) for layers, matching the Layer Daily Report webform.

## 2. What Was Tested and Verified Working

- **Add Feed submission:** Tested for Layer (Eggmobile 2, 100 lbs STARTER). Row appeared in `layer_dailys` with `source='add_feed_webform'`. Visible in Layer Dailys view with amber badge when "All" or "Add Feed" filter active.
- **Filter chips:** Toggling All/Daily Reports/Add Feed correctly filters. Counter shows correct numbers (e.g., "2060 total · 2059 shown" with Daily Reports active).
- **Edit modal field hiding:** Layer Add Feed edit modal shows only date, team member, batch, feed type, feed lbs. Title shows "Edit Layer Add Feed Report".
- **Add Feed button navigation:** Buttons in all 3 dailys views navigate to `#addfeed` via hash + reload.
- **Admin panel Add Feed entry:** Appears in webform list with amber styling. Team member editing works. Sections/fields editor works.
- **Retirement Home edit modal:** Only shows Batch Name, Status, Notes.
- **Feed cost rates on Retirement Home:** Layer Dashboard shows Feed Cost and $/Dozen using global rate fallback.
- **Pagination dedup:** Filter toggling no longer duplicates records.
- **Breeding cycle auto-save:** Typing in fields triggers debounced save. Closing modal flushes pending save.
- **Pig batch original count:** Auto-calculates from gilts + boars.
- **Delete confirmations:** Tested on breeding cycle, layer batch — both show type-"delete" modal.
- **Mortality reason conditional:** Tested on broiler webform — reason field hidden until count > 0, submission blocked without reason.
- **Pig feed tab:** Loads without errors. Current snapshot shows calculated values. Monthly table renders with projected values.

## 3. Decisions Made During Session (Not in Original DECISIONS.md)

### housing_batch_map shape correction
DECISIONS.md verified fact #10 says `{ housingName: batchId }`. **This is wrong.** The actual shape is `{ housingName: batchName }` — values are batch NAMES (e.g., "L-26-01"), not batch IDs. Confirmed by reading `syncWebformConfig` at the line that builds the map: `return [h.housing_name, b?b.name:null]`. The map was also empty `{}` in Supabase during the session, likely a sync issue.

### batch_id on layer Add Feed inserts
Set to `null`. The AddFeedWebform runs in anon context and can't access `layer_batches`/`layer_housings` tables to resolve the ID. This matches existing layer webform behavior. All feed aggregation works via `batch_label` + `.reduce()`, so null `batch_id` has no functional impact.

### Hash navigation requires page reload
`window.location.hash = '#addfeed'` alone doesn't trigger a React re-render because the App's router reads the hash only on initial mount. Solution: `window.location.hash='#addfeed';window.location.reload();`. Applied to all Add Feed buttons and the "Back to Daily Reports" / "Done" links.

### React.useRef cannot be inside conditional blocks
Placed `breedAutoSaveTimer` inside `if(view==="breeding")` initially — crashed the page because React hooks can't be called conditionally. Moved to top-level App scope. Same pattern used for `tripAutoSaveTimer` (top-level from the start).

### No purple colors
User preference: no purple anywhere in the UI. Pig feeder batch header colors use green/amber/blue/pink rotation instead.

### Notable border simplified
Home dashboard "LAST 5 DAYS" tile borders previously triggered on any yes/no field being false (group_moved, waterer_checked, etc.). Changed to only trigger on mortality, comments/issues, or low voltage. The colored yes/no pills already provide the visual signal.

### Retirement Home is not a normal batch
It's a permanent pseudo-batch that never closes, never goes through brooder/schooner phases, and receives aged birds from all batches. The edit modal hides lifecycle fields. Feed cost rates fall back to global when not stored on the batch. The `saveFeedCosts` function no longer excludes Retirement Home from rate updates.

### Feed orders data model
Stored in `app_store` key `ppp-feed-orders-v1` as:
```json
{
  "pig": { "2026-01": 5000, "2026-02": 4500 },
  "broiler": { "2026-01": 8000 }
}
```
Loaded in `loadAllData`, persisted via `sbSave`. State variable: `feedOrders` / `setFeedOrders`.

### Nursing sow calculation
A sow is "nursing" from her actual `farrowingDate` (from farrowing records) through the `weaningEnd` of her breeding cycle. The function `nursingSowsOnDate(dateISO)` scans all breeding cycles and farrowing records to compute this. If a sow hasn't farrowed yet (no record), she's not counted as nursing even if the farrowing window is open.

## 4. Bugs Found, Workarounds, and Known Issues

### Bugs Found and Fixed

- **Pagination race condition:** Toggling source filter caused re-renders while pagination was loading, resulting in the same page being fetched and appended multiple times. Fixed with `pgLoading` ref guard + ID deduplication on append. Applied to BroilerDailysView, LayerDailysView, EggDailysView.

- **React.useRef in conditional block:** `breedAutoSaveTimer` was initially defined inside `if(view==="breeding")`, violating hooks rules. Moved to App top-level scope.

- **todayStr shadowing:** In pigsHome, `const todayStr = todayISO()` (a string) shadowed the outer scope where `todayStr` is sometimes a function. Then `todayStr()` was called in JSX, crashing because you can't call a string. Fixed by removing the `()`.

- **Babel cache:** After deploying new code, the browser's Babel transpile cache (stored in localStorage) serves stale compiled code. Fix: `localStorage.clear()` + hard refresh. This is a recurring issue — always tell the user to clear cache after deploy.

- **housing_batch_map empty:** The map in `webform_config` was `{}` during the session. This means the `syncWebformConfig` function hasn't run after a logged-in admin loaded the app, or there are no active housings. The AddFeedWebform handles this gracefully — the "Active in batch: [name]" info line just doesn't show.

### Known Issues / Open Items

- **Broiler feed ordering:** Not yet built. The pig feed tab has feed ordering (monthly lbs ordered input). The same feature needs to be added to the Broiler Feed tab. The `feedOrders.broiler` key exists in the data model but the UI doesn't use it yet.

- **Pig feed tab "On Hand" column:** The monthly table has an "On Hand" column that currently shows "—" for all rows. This needs a running balance calculation (cumulative orders minus cumulative consumption up to that month).

- **Pig feed tab — feeder pig count uses originalPigCount:** The projection uses `g.originalPigCount` for feeder pig count. It doesn't account for processed pigs (processing trips reduce the count). A more accurate projection would subtract processed pigs.

- **Add Feed webform config not persisted initially:** The Add Feed webform entry is injected at runtime if not found in `webformsConfig.webforms`. This means the first time an admin edits it, the changes persist. But if they've never opened the admin panel, the default config (all fields enabled, feed_type and feed_lbs required) applies.

- **source column on existing rows:** Existing daily report rows have `source: null`. The filter logic handles this correctly (`r.source !== 'add_feed_webform'` returns true for null). No migration needed.

## 5. Where We Left Off — Next Steps

### Immediate Next Item: Broiler Feed Tab — Add Feed Ordering

The pig feed tab is complete with feed ordering. The same feed ordering feature needs to be added to the Broiler Feed tab (view==="feed"):

1. Add an "Ordered" column to the existing monthly feed summary table
2. Add a "Feed on Hand" estimate card (ordered minus consumed)
3. Use `feedOrders.broiler` for storage (key already exists in the data model)
4. The existing broiler feed tab already has monthly projected vs actual data — just need to add the ordering inputs

### Other Pending Items

- **Fix pig feed tab "On Hand" running balance:** Calculate cumulative orders minus cumulative consumption per month
- **Fix feeder pig count in projections:** Subtract processed pigs from `originalPigCount`
- **Test pig feed tab thoroughly:** The nursing sow logic, monthly projections, and feed ordering all need real-world testing
- **Add Feed for Layer — batch_id resolution:** Currently null. Could potentially resolve from `housing_batch_map` (maps housing_name → batch_name) and then look up batch_id. Low priority since aggregation works without it.

### Context for Next Session

- The app is a single `index.html` file (~10,200 lines). All React, CSS, and JS live in it. Babel transpiles JSX in-browser.
- Deploy = push to GitHub (auto-deploys to Netlify). After deploy, user needs to clear localStorage + hard refresh.
- Supabase is the backend. The `sb` variable is the anon Supabase client. Auth is handled by Supabase Auth.
- The `app_store` table is a JSON blob store. Use `sbSave(key, value)` to persist.
- `webform_config` table is anon-accessible. Used by public webforms.
- **Babel gotchas:** No special characters in JSX template literals — use `\u` escapes. Never use destructured `useState` in standalone components near App — use `React.useState()`. No `React.useRef()` inside conditional blocks.
- **DECISIONS.md** is the authoritative design document for the Add Feed feature. It has the full rationale, rejected alternatives, and verified facts. Read it before making changes to Add Feed.

## 6. What Would Have Saved Time at the Start of This Session

1. **The housing_batch_map shape discrepancy.** DECISIONS.md said `{ housingName: batchId }` but the actual code builds `{ housingName: batchName }`. This took investigation to resolve. The DECISIONS.md should be updated to reflect reality.

2. **The hash navigation pattern.** Knowing upfront that `window.location.hash` changes don't trigger React re-renders (because the router reads hash only on mount) would have saved a round-trip debugging the "buttons don't do anything" issue.

3. **React hooks rules in this codebase.** The app has many views rendered inside `if(view===...)` blocks within the App function. Any `React.useRef()` or `React.useState()` calls inside these blocks will crash. Always put refs/state at the top level of App.

4. **Babel cache.** After every deploy, the user must clear localStorage. This should be mentioned prominently in any handover doc. The Babel cache key includes a hash of the source, so it auto-invalidates on code changes, but stale cache from a previous version can cause confusing behavior.

5. **Retirement Home is special.** It's not a normal layer batch — it's permanent, has no lifecycle phases, and was previously excluded from feed cost updates. Understanding this upfront would have prevented the "why are feed costs blank?" investigation.

6. **The `source` column was already added to all 3 dailys tables.** This was done during the DECISIONS.md design session via `ALTER TABLE ... ADD COLUMN IF NOT EXISTS source TEXT`. The column exists but all existing rows have null. No migration script needed — the column is just there.

7. **Per-form team member fallback chain:** All webforms (including Add Feed) fall back to the global `team_members` list when no per-form members are configured. The user initially thought this was a bug but it's the designed behavior across all forms.

---

# ORIGINAL SYSTEM DOCUMENTATION

*The sections below are from the original April 9-11 handover document, updated where necessary to reflect April 12 changes.*

## 1. How to Work With the Next Claude Instance

### 1.1 Ronnie's Working Style (Byron)

- Ask lots of questions before building. Never jump into code without fully understanding scope.
- When scope is large, map out the FULL design, confirm it, then build in phases.
- Never assume. If something is ambiguous, ask.
- Be honest about mistakes.
- Verify before confirming — Ronnie notices when Claude confirms things without checking the code.
- Backup before major changes.

### 1.2 How to Start Each Session

- Read this document AND DECISIONS.md top to bottom first.
- Ask what the user wants to work on — don't assume.
- Check if there are pending items from the "Where We Left Off" section above.
- The `index.html` in the repo IS the latest deployed file.

### 1.3 Known Gotchas With This Codebase

- **Babel in-browser transpiler** is strict about special characters inside JSX. Never use template literals with special chars (·, ‹, ›, →, —) inside JSX. Use string concatenation + unicode escapes (e.g. '\u00b7' for ·).
- **Never use const {useState} = React** destructuring at the top of standalone components defined near the App function. Use React.useState() directly.
- **Never put React.useRef() or React.useState() inside conditional blocks** (if/else). Always at the top level of the component function.
- **The app is ONE file** — index.html, ~10,200 lines. All React, CSS, and JS live in it.
- **Deploy = push to GitHub** → Netlify auto-deploys. After deploy, tell user to clear localStorage + hard refresh (Cmd+Shift+R).
- **Supabase sessions expire.** If daily records show 0, tell user to sign out and sign back in.
- **app_store saves** are JSON blobs — always use sbSave() helper which has retry logic and timeout handling.
- **str_replace fails if content has changed since last view.** Always re-read the file section before editing.
- **Hash navigation between public and authenticated views** requires `window.location.reload()` after setting the hash. React's router only reads the hash on mount.
- **Babel cache in localStorage** can serve stale code after deploy. Always clear localStorage when debugging post-deploy issues.

### 1.4 Deployment Process

- Push to GitHub main branch
- Netlify auto-deploys from the repo
- Hard refresh: Cmd/Ctrl+Shift+R
- If page doesn't load: clear localStorage in browser console, then reload
- Sign out and sign back in after deploy to refresh Supabase session

## 2. Infrastructure Overview

### 2.1 Hosting & Domain

| Service | Details |
|---|---|
| Live URL | https://wcfplanner.com |
| Hosting | Netlify — Farm Team account (ronnie-ipfsd1e) |
| Deploy method | Auto-deploy from GitHub repo |
| DNS | Netlify DNS |

### 2.2 Supabase

| Item | Value |
|---|---|
| Project URL | https://pzfujbjtayhkdlxiblwe.supabase.co |
| Anon Key | In index.html line ~212 |
| Admin email | ronnie@whitecreek.farm |

### 2.3 Tech Stack

- React 18 (Babel in-browser transpiler — no build step)
- Supabase JS v2 (auth, database, edge functions)
- SheetJS (Excel export, lazy-loaded)
- All in one single index.html file (~10,200 lines)
- No npm, no bundler, no separate CSS file

## 3. Database Schema

### 3.1 Tables

| Table | Purpose |
|---|---|
| app_store | Main JSON blob store — all non-daily data |
| webform_config | Config for public webforms (anon access) |
| batches | Broiler batches |
| poultry_dailys | Broiler daily reports. Has `source` column (TEXT, nullable). |
| layer_dailys | Layer daily reports. Has `source` column (TEXT, nullable). |
| egg_dailys | Egg collection reports |
| pig_dailys | Pig daily reports. Has `source` column (TEXT, nullable). |
| layer_batches | Layer batch parent records |
| layer_housings | Layer housing sub-batches |
| profiles | User profiles + roles |
| batch-documents | File attachments on batches |

### 3.2 app_store Keys

| Key | Contents |
|---|---|
| ppp-v4 | Broiler batches array |
| ppp-layer-groups-v1 | Layer groups array |
| ppp-webforms-v1 | Webform configuration (includes Add Feed webform entry) |
| ppp-feeders-v1 | Pig feeder groups / batches |
| ppp-pigs-v1 | Pig sow/boar data |
| ppp-breeding-v1 | Breeding cycle records |
| ppp-farrowing-v1 | Farrowing records |
| ppp-breeders-v1 | Breeding pig registry |
| ppp-feed-costs-v1 | Feed cost per lb |
| ppp-feed-orders-v1 | Feed orders by month: `{pig:{}, broiler:{}}` |
| ppp-broiler-notes-v1 | Broiler section notes |
| ppp-pig-notes-v1 | Pig section notes |
| ppp-layer-notes-v1 | Layer section notes |
| ppp-missed-cleared-v1 | Cleared missed-report alerts |

### 3.3 webform_config Keys

| Key | Contents |
|---|---|
| full_config | Full webform config including Add Feed webform entry |
| broiler_groups | Active broiler batch names |
| active_groups | Active pig group names |
| team_members | All team member names |
| per_form_team_members | Team members per form ID (includes 'add-feed-webform') |
| webform_settings | allowAddGroup per form |
| housing_batch_map | Maps housing name → batch NAME (e.g. "Eggmobile 2" → "L-26-01"). NOT batch ID. |
| layer_groups | Active layer group names |

### 3.4 source Column

Added to `layer_dailys`, `poultry_dailys`, and `pig_dailys` during the DECISIONS.md design session:
```sql
ALTER TABLE layer_dailys ADD COLUMN IF NOT EXISTS source TEXT;
ALTER TABLE poultry_dailys ADD COLUMN IF NOT EXISTS source TEXT;
ALTER TABLE pig_dailys ADD COLUMN IF NOT EXISTS source TEXT;
```
- Existing rows have `source: null`
- Add Feed rows have `source: 'add_feed_webform'`
- No existing code filters by `source` except the new filter chips and badges

## 4. App Architecture

### 4.1 File Structure (Updated Line Numbers — Approximate)

- Lines 1-130: HTML head, CSS styles, CDN script tags
- Lines 131-230: Supabase client init + helpers
- Lines 230-520: Global constants, feed schedules, date helpers
- Lines 520-600: Layer housing/feed cost helpers
- Lines 600-790: LoginScreen, UsersModal
- Lines 790-870: DEFAULT_WEBFORMS_CONFIG
- Lines 870-1000: Styles, permission helpers
- Lines 1000-1190: DeleteModal
- Lines 1190-1420: **AddFeedWebform** (NEW)
- Lines 1420-2100: WebformHub (public webforms)
- Lines 2100-2200: FeedCostsPanel
- Lines 2200+: App() — the main application
- Lines 7900+: WcfYN, WcfToggle, AdminAddReportModal standalone components
- Lines 8150+: BroilerDailysView standalone component
- Lines 8400+: LayerBatchesView standalone component
- Lines 9000+: LayersView standalone component
- Lines 9200+: LayerDailysView standalone component
- Lines 9500+: EggDailysView standalone component
- Lines 9750+: PigDailysView standalone component
- Final lines: ReactDOM.createRoot render + Babel boot script

### 4.2 Navigation Views (VALID_VIEWS)

All original views plus `addfeed` (public, no auth).

### 4.3 Key People & Emails

| Person | Role | Email |
|---|---|---|
| Ronnie Jones | Admin / Owner | ronnie@whitecreek.farm |
| Mak | Management | mak@whitecreek.farm |
| Simon | Farm Team | Simon.rosa3@gmail.com |
| Josh | Farm Team | — |
| Jenny | Farm Team | — |

## 5. Add Feed Webform — Design Reference

**Read DECISIONS.md for the full design document.** Key corrections from the April 12 session:

- `housing_batch_map` values are batch NAMES, not batch IDs (corrects verified fact #10)
- The `housing_batch_map` may be empty `{}` if syncWebformConfig hasn't run
- `batch_id` is set to null on layer Add Feed inserts (can't resolve in anon context)
- The `feed_edit_log` table does NOT exist (was created and dropped during design session)

## 6. Conditional Field Rules (Apply to ALL Forms)

These rules apply everywhere — public webforms, AdminAddReportModal, standalone edit modals:

1. **Feed type** is only required when `feed_lbs > 0`. Enforced in `validateRequiredFields()` and explicit submit checks.
2. **Mortality reason** is hidden until `mortality_count > 0`, then required with red asterisk. Enforced in `validateRequiredFields()` and explicit submit checks.
3. All delete actions use the type-"delete" confirmation modal (DeleteModal). No `window.confirm` for deletes.

## 7. Design Preferences (Discovered During Session)

- No purple colors anywhere
- All modals should be centered overlays, not inline forms
- Auto-save with debounce (1.5s) on edit forms; save on close (X button)
- Delete actions: show only Delete button in footer when editing (no Done/Cancel with auto-save)
- Report tiles should use colored pills for yes/no fields, not checkmarks
- Comments should be highlighted in amber pills, not plain italic
- Team member names should have subtle pill styling
- Alternating colors on batch cards for visual separation
- Colored header bars on batch cards matching housing colors

---

*End of Handover Document*
