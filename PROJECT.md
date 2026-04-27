# WCF Planner

**Farm-management web app for White Creek Farm.** Owner + admin: Ronnie Jones. Live at [https://wcfplanner.com](https://wcfplanner.com).

Started as a single-file ~19,445-line `index.html` using Babel-in-browser. Over April 19–21, 2026 it was migrated to a Vite build with 54+ extracted components under `src/`, 14 feature-scoped libs, 10 React Contexts, and per-tab URLs via a React Router adapter. Production serves the Vite bundle from branch `main`. This doc is the living reference; for per-session narrative history see [`archive/SESSION_LOG.md`](archive/SESSION_LOG.md).

**Last consolidated:** 2026-04-21 session 3 (post-polish cutover).

---

## Table of contents

- **Part 1 — Living Reference** — how to run a session, infrastructure, schema, architecture, domain, design rules, don't-touch list, roadmap
- **Part 2 — Design Decisions** — load-bearing choices with rationale and rejected alternatives
- **Part 3 — History** — migration origin, phase tally, transferable lessons
- **Part 4 — Session Index** — one-line map of every dated session; detail lives in git log + `archive/SESSION_LOG.md`

---

# Part 1 — Living Reference

## 1. How to run a session

### SOP

1. Read this document top to bottom.
2. Ask Ronnie what he wants to work on — don't assume.
3. Read the relevant `src/` file(s) before writing any code.
4. Check §8 (Open items / roadmap) for pending work.
5. If the task touches anything in §7 (Don't-touch list), stop and ask before editing.

### Deployment SOP — NEVER skip

**NEVER run `git commit`, `git push`, or any deploy/merge command without explicit user approval in the current session turn.**

- `commit` = do it. One-line status update. No "ready to push?" follow-up.
- `push` / `deploy` / `merge` / `cutover` = fresh explicit approval in the same turn. Commit approval does NOT extend.
- Approval for one change does NOT imply approval for subsequent changes.
- If Ronnie says "make change X," make the change and wait — do not commit.
- Background agents and worktrees follow the same rule.
- Never merge anything to `main` without "merge" or "cutover" from Ronnie. Production runs from `main`.
- Never run destructive Supabase ops (`DROP`, `TRUNCATE`, schema changes, `DELETE` without `WHERE`) without approval.

### Ronnie's working style

- Ask lots of questions before building. Never jump into code without fully understanding scope.
- When scope is large, map out the FULL design, confirm it, then build in phases.
- Never assume. If something is ambiguous, ask.
- Be honest about mistakes. Ronnie notices when Claude confirms things without checking the code.
- **No purple colors anywhere in the UI.**
- Prefers bulletproof over fast. No shortcuts.
- "We don't spare any expense for tokens" — read the full file if needed, don't skim.

### Critical codebase constraints (post-migration)

- **Vite build, not Babel-in-browser.** Source is ESM under `src/`. A one-time `wcf-babel-*` localStorage purge runs on every mount — safe to leave in forever.
- **React hooks rules:** never put `useState` / `useEffect` / `useRef` inside conditional blocks. Always at top level of the component function.
- **Hook-based view extractions close over many App-scope names.** Missing one = runtime `ReferenceError` on first nav to that view. Builds pass silently; only the browser catches these. Run the bare-name audit before pushing any hook-based extraction (see §Part 3 "Lessons").
- **`\u` JSX escape literals stay** (em-dashes, bullets, en-dashes). They're on the don't-touch list — removing them mid-migration is risk-for-nothing.
- **Router is BrowserRouter with a view↔URL adapter.** `setView('X')` and `useNavigate('/path')` both work. Legacy `/#weighins` etc. bookmarks are rewritten to clean paths by a sync shim in `main.jsx` before `root.render()`.

### Deployment process

1. Code changes on a feature branch (or small changes direct to `main` with approval).
2. `git commit`, `git push`.
3. Netlify auto-builds from `main` for production, from any other branch for preview.
4. Production rebuild takes ~90s after push.
5. Production: `https://wcfplanner.com` (alias `https://cheerful-narwhal-1e39f5.netlify.app`).
6. Preview: `<branch>--cheerful-narwhal-1e39f5.netlify.app` (if branch deploys enabled) or `deploy-preview-N--…` via a PR.
7. Rollback paths (fastest first): Netlify UI → Deploys → "Publish deploy" on a pre-incident build → `git revert -m 1 <merge-commit> && git push` → restore `~/OneDrive/Desktop/WCF-planner-backups/index.html.pre-vite-2026-04-19` as nuclear option.

---

## 2. Infrastructure

### Hosting & domain

| Service | Details |
|---|---|
| Live URL | https://wcfplanner.com |
| Netlify alias | https://cheerful-narwhal-1e39f5.netlify.app |
| Hosting | Netlify (Farm Team account) — auto-deploys from GitHub `main` |
| Repo | https://github.com/byronronniejones-lab/WCF-planner |
| SPA fallback | `public/_redirects`: `/*  /index.html  200` |

### Supabase

| Item | Value |
|---|---|
| Project URL | https://pzfujbjtayhkdlxiblwe.supabase.co |
| Auth config | `detectSessionInUrl: false`, `storageKey: 'farm-planner-auth'` — see §Part 2 for rationale |
| Anon key location | `src/lib/supabase.js` |
| Admin email | byronronniejones@gmail.com (Ronnie) |
| Edge function | `rapid-processor` (email notifications) |
| Storage buckets | `batch-documents`, cattle-related file attachments |

### Tech stack

- **React 18** via npm (`react@18.3.1`, `react-dom@18.3.1`).
- **Vite 5** build (`@vitejs/plugin-react`). Dev server on default port 5173.
- **React Router 7** (`react-router-dom@7.14.1`) with `BrowserRouter` + URL↔view adapter (see §Part 2).
- **Supabase JS v2** (`@supabase/supabase-js@2.45.0`).
- **SheetJS/XLSX** (`xlsx@0.18.5`) lazy-loaded via `await import('xlsx')` on first use.
- **Geist** font from Google Fonts.
- No TypeScript, no test suite, no CSS framework — all styles are inline `style={{…}}` + scoped webform CSS in `index.html`.
- No ESLint/Prettier — deferred as a separate initiative.

### Farm location

Lat `30.84175647927683`, Lon `-86.43686683451689`. West Central Florida. Used by any future weather-API integration and any location-scoped features.

---

## 3. Database schema

### Tables

| Table | Purpose |
|---|---|
| `app_store` | Main JSON blob store — all non-daily structured data. Key-value: `key` (text PK), `data` (jsonb). |
| `webform_config` | Config for public webforms (anon-accessible RLS). Same key-value shape as `app_store`. |
| `poultry_dailys` | Broiler daily reports. Has nullable `source` column. |
| `layer_dailys` | Layer daily reports. Has nullable `source` column. |
| `egg_dailys` | Egg collection reports. |
| `pig_dailys` | Pig daily reports. Has nullable `source` column. **No `feed_type` column** — pig reports don't track feed type. |
| `cattle_dailys` | Cattle daily reports. `feeds` jsonb (multi-line with `is_creep` per-line flag + `nutrition_snapshot` at submit time), `minerals` jsonb, + standard fields. |
| `sheep_dailys` | Sheep daily reports. Sheep-specific fields (bales of hay, alfalfa lbs, minerals given/% eaten). |
| `layer_batches` | Layer batch parent records (dedicated table). |
| `layer_housings` | Per-housing records with `current_count` anchor model. |
| `cattle`, `cattle_calving_records`, `cattle_processing_batches`, `cattle_feed_inputs`, `cattle_feed_tests`, `cattle_comments` | Cattle module. `cattle_comments` uses a `source` column for multi-origin timeline (`manual`/`weigh_in`/`daily_report`/`calving`). `cattle.old_tags` is jsonb — don't change its shape. |
| `sheep`, `sheep_lambing_records` | Sheep module. |
| `weigh_in_sessions` + `weigh_ins` | Shared across cattle/pig/broiler/sheep via `species` column. |
| `profiles` | User profiles + roles (`farm_team`, `management`, `admin`, `inactive`). Per-program access via `program_access` text array. |
| `equipment`, `equipment_fuelings`, `equipment_maintenance_events` | Equipment module. Migration 016 + extensions through 025. `equipment.team_members`/`manuals`/`documents`/`attachment_checklists` are jsonb. `equipment_fuelings.photos` is jsonb (`[{name,path,url,uploadedAt,podio_file_id?}]`). `service_intervals_completed` is jsonb (`[{interval,kind,items_completed,total_tasks,...}]`). |
| `fuel_supplies` | Fuel **delivered** to the farm (cell / can / farm truck / other). Anon insert via `/fueling/supply` webform. NEVER counts as consumption — that's `equipment_fuelings.gallons`. |
| `fuel_bills`, `fuel_bill_lines` | Migration 026. Admin-uploaded supplier invoices (Home Oil etc.) for monthly reconciliation against `fuel_supplies`. Authenticated-only RLS. PDFs in the admin-only `fuel-bills` storage bucket (signed-URL access only). |
| `batch-documents` | Storage bucket for broiler batch file attachments. |
| `equipment-maintenance-docs` | Storage bucket for equipment manuals + documents + fueling photos. Public bucket (anon read), authenticated/anon write per the policies in migrations 016 + 018. |
| `fuel-bills` | Storage bucket for uploaded supplier invoices. `public:false` — authenticated-only via 10-min signed URLs from the admin Bills view. |

### `app_store` keys

| Key | Contents |
|---|---|
| `ppp-v4` | Broiler batches array |
| `ppp-layer-groups-v1` | Legacy layer groups (superseded by `layer_batches`/`layer_housings`, still used for some webform config) |
| `ppp-webforms-v1` | Webform configuration (includes Add Feed + Cattle Dailys entries) |
| `ppp-feeders-v1` | Pig feeder groups with sub-batches and processing trips |
| `ppp-pigs-v1` | Pig sow/boar count data |
| `ppp-breeding-v1` | Pig breeding cycle records |
| `ppp-farrowing-v1` | Farrowing records (initialized from `INITIAL_FARROWING` constant in `main.jsx`) |
| `ppp-breeders-v1` | Pig breeding registry (initialized from `INITIAL_BREEDERS`) |
| `ppp-boars-v1` | Boar names mapping |
| `ppp-breed-options-v1`, `ppp-origin-options-v1` | Dropdown option lists |
| `ppp-feed-costs-v1` | `{starter, grower, layer, pig, grit}` per-lb rates |
| `ppp-feed-orders-v1` | Feed orders by month by type |
| `ppp-pig-feed-inventory-v1` | Pig physical feed count: `{count, date}` or null |
| `ppp-poultry-feed-inventory-v1` | Poultry physical counts: `{starter:{count,date}, grower:{count,date}, layer:{count,date}}` |
| `ppp-broiler-notes-v1`, `ppp-pig-notes-v1`, `ppp-layer-notes-v1` | Per-section notes |
| `ppp-missed-cleared-v1` | Cleared missed-report alerts (Set serialized as array) |
| `ppp-archived-sows-v1` | Archived sow records |

### `webform_config` keys

| Key | Contents |
|---|---|
| `full_config` | Complete config — `{webforms, teamMembers, broilerGroups, layerGroups}` |
| `broiler_groups` | Active broiler batch names (string array) |
| `active_groups` | Active pig group names (string array) |
| `team_members` | All team member names (flat string array) |
| `per_form_team_members` | Per-form: `{"pig-dailys":[…], "add-feed-webform":[…], …}` |
| `webform_settings` | `{allowAddGroup: {"pig-dailys": true, …}}` |
| `housing_batch_map` | `{housingName: batchName}` — maps housing to batch NAME (not id) |
| `layer_groups` | Active layer group names |

---

## 4. Application architecture

### File tree (post-migration, as of 2026-04-21)

```
WCF-planner/
├─ index.html                 # ~30 lines — head, root div, script src=main.jsx
├─ vite.config.js
├─ package.json
├─ public/
│  └─ _redirects              # Netlify SPA fallback
├─ src/
│  ├─ main.jsx                # ~1,750 lines — provider tree + App wiring + view dispatch
│  ├─ contexts/               # 10 feature-scoped providers (see §4.3)
│  ├─ lib/                    # 14 helper modules (see §4.4)
│  ├─ shared/                 # Header, DeleteModal, WcfYN, WcfToggle, AdminAddReportModal, AdminNewWeighInModal
│  ├─ auth/                   # SetPasswordScreen, LoginScreen, UsersModal
│  ├─ webforms/               # AddFeedWebform, WeighInsWebform, WebformHub, WebformsAdminView, PigDailysWebform
│  ├─ admin/                  # FeedCostsPanel, FeedCostByMonthPanel, LivestockFeedInputsPanel, NutritionTargetsPanel
│  ├─ dashboard/              # HomeDashboard
│  ├─ broiler/                # BatchForm, BroilerHomeView, BroilerTimelineView, BroilerListView, BroilerFeedView, BroilerDailysView
│  ├─ layer/                  # LayersHomeView, LayersView, LayerBatchesView, LayerDailysView, EggDailysView
│  ├─ pig/                    # PigsHomeView, BreedingView, FarrowingView, SowsView, PigBatchesView, PigFeedView, PigDailysView
│  ├─ cattle/                 # CattleHomeView, CattleHerdsView, CattleBreedingView, CattleBatchesView, CattleDailysView, CattleWeighInsView, CattleBulkImport, CattleNewWeighInModal, CowDetail, CollapsibleOutcomeSections
│  ├─ sheep/                  # SheepHomeView, SheepFlocksView, SheepDailysView, SheepWeighInsView, SheepBulkImport, SheepDetail
│  ├─ livestock/              # LivestockWeighInsView (broiler+pig shared), PigSendToTripModal
│  └─ equipment/              # EquipmentPlaceholder
├─ archive/
│  └─ SESSION_LOG.md          # Frozen raw session narratives (pre-consolidation)
├─ supabase-migrations/       # SQL migrations
├─ scripts/                   # CLI Node import scripts (Podio importers, merge tools) — NOT bundled
└─ PROJECT.md                 # this file
```

### `src/main.jsx` structure

~1,750 lines. Pure wiring + dispatch. Shape:

1. **Imports** (~160 lines) — React, router, all contexts, all feature views, all libs.
2. **Module-scope startup:**
   - One-time `wcf-babel-*` localStorage purge.
   - Legacy hash-bookmark compat shim (runs synchronously before `root.render()`).
   - Lazy XLSX loader (`window._wcfLoadXLSX`).
3. **Module-scope constants still used by App:** `STORAGE_KEY`, `INITIAL_BREEDERS`, `INITIAL_FARROWING`, `EMPTY_FORM`, `EMPTY_DAILY`, `canEdit*/canDelete*` permission helpers. Cattle constants + `detectConflicts` + `writeBroilerBatchAvg` moved to `src/lib/` during the 2026-04-21 polish.
4. **`function App()` body:**
   - Destructures from 10 contexts (`useAuth`, `useBatches`, `usePig`, `useLayer`, `useDailysRecent`, `useCattleHome`, `useSheepHome`, `useWebformsConfig`, `useFeedCosts`, `useUI`).
   - Derived role helpers + 2 Phase 3 URL↔view sync effects.
   - ~40 `useState` hooks for view-local state (feed orders, expanded months, collapsed flags, `wf*` admin form state, auto-save timer refs, daily form state, etc.).
   - Effects: webform config load, cattle count, initial dailys loads, `refreshDailys`, `VALID_VIEWS` gate, `canAccessProgram` redirect, auth listener with 6s timeout, visibility refresh.
   - Data helpers: `loadUser`, `loadAllData` (loads 19 `app_store` keys + paginated pig/poultry dailys), `loadUsers`, `saveFeedCosts`, `sbSave` (with 3-attempt retry), `signOut`, 9 `persist*` helpers, `syncWebformConfig`, `persistDaily`/`deleteDaily`, `backupData`/`restoreData`.
   - Form helpers: `upd`, `openAdd`, `openEdit`, `parseProcessorXlsx`, `confirmDelete`, `closeForm`, `submit`, `del`, `resolveSire`.
   - `Header` wrapper closure (threads App-only props into extracted `HeaderBase`).
   - `DeleteConfirmModal` memo.
   - Webform bypass routes (public, no auth): `addfeed`, `weighins`, `webformhub`, `webform`.
   - Auth gates: `pwRecovery` / `null` / `false` / `!dataLoaded`.
   - View dispatch table (one `if(view==="X") return React.createElement(…)` per view).
   - `return null` default.
5. **`const root = createRoot(…)` + `root.render(<BrowserRouter>…<App/>…</BrowserRouter>)`.** The provider stack wraps App with all 10 contexts.
6. **Boot loader fade-out** via two nested `requestAnimationFrame`s after first paint.

### Provider tree (order matters — some consumers sit inside others)

```
<BrowserRouter>
  <AuthProvider>
    <BatchesProvider formInit={EMPTY_FORM} tlStartInit={thisMonday}>
      <PigProvider initialFarrowing={INITIAL_FARROWING} initialBreeders={INITIAL_BREEDERS} breedTlStartInit={…}>
        <LayerProvider>
          <DailysRecentProvider>
            <CattleHomeProvider>
              <SheepHomeProvider>
                <WebformsConfigProvider configInit={DEFAULT_WEBFORMS_CONFIG}>
                  <FeedCostsProvider>
                    <UIProvider>
                      <App/>
```

### Helper libs (`src/lib/`)

| Module | Exports |
|---|---|
| `supabase.js` | `sb` (the Supabase client, `detectSessionInUrl:false` + `storageKey:'farm-planner-auth'`) |
| `email.js` | `wcfSendEmail(type, data)` — fire-and-forget edge-function call |
| `pagination.js` | `wcfSelectAll(buildRangeQuery, pageSize)` — the `.range(from, from+999)` loop pattern (don't touch — see §7) |
| `dateUtils.js` | `addDays`, `toISO`, `fmt`, `fmtS`, `todayISO`, `thisMonday` |
| `styles.js` | `S` — shared style constants |
| `defaults.js` | `DEFAULT_WEBFORMS_CONFIG` |
| `layerHousing.js` | `setHousingAnchorFromReport`, `computeProjectedCount`, `computeLayerFeedCost` |
| `cattleCache.js` | `loadCattleWeighInsCached`, `invalidateCattleWeighInsCache` — two-query pattern, no `!inner` joins (don't touch — see §7) |
| `cattleBreeding.js` | `calcCattleBreedingTimeline`, `buildCattleCycleSeqMap`, `cattleCycleLabel` |
| `pig.js` | Pig breeding constants (`BOAR_EXPOSURE_DAYS=45`, `GESTATION_DAYS=116`, `WEANING_DAYS=42`, `GROW_OUT_DAYS=183`) + `calcBreedingTimeline`, `buildCycleSeqMap`, `cycleLabel`, `calcCycleStatus` |
| `broiler.js` | ~450 lines. Full broiler + layer housing domain: constants (`BROODER_DAYS`, `CC_SCHOONER`, `WR_SCHOONER`, `BROODERS`, `SCHOONERS`, cleanout windows, hatchery lists, breed/status styles), + `overlaps`, `getFeedSchedule`, `calcBatchFeed`, `calcBatchFeedForMonth`, `calcLayerFeedForMonth`, `calcTimeline`, `calcPoultryStatus`, `calcBroilerStatsFromDailys`, `getBatchColor`, `breedLabel`, `isNearHoliday`, `calcTargetHatch`, `suggestHatchDates`, `writeBroilerBatchAvg` |
| `cattle.js` | Cattle module constants: 4 active herds + 3 outcomes + labels + colors + 5 breeding-day constants |
| `conflicts.js` | `detectConflicts` — broiler/layer scheduling overlap detector |
| `routes.js` | `VIEW_TO_PATH`, `PATH_TO_VIEW`, `HASH_COMPAT` — Phase 3 URL↔view maps |

### URL routing (Phase 3 adapter pattern)

Two `useEffect`s inside App keep URL and `view` state mirrored:

- **URL → view** on `location.pathname` change: resolve via `PATH_TO_VIEW`; if unknown path, snap to `home` + `navigate({pathname:'/', hash: location.hash}, {replace:true})` (preserving hash protects the password-recovery flow).
- **view → URL** on `view` change: `navigate(VIEW_TO_PATH[view])`. A `syncingFromUrl` ref prevents infinite loops.

Every existing `setView('X')` call site continues to work unchanged. See §Part 2 for the adapter-vs-full-migration rationale.

### URL shape

| Path | View | Access |
|---|---|---|
| `/` | home dashboard | auth |
| `/broiler`, `/broiler/timeline`, `/broiler/batches`, `/broiler/feed`, `/broiler/dailys`, `/broiler/weighins` | broiler program | auth |
| `/pig`, `/pig/breeding`, `/pig/farrowing`, `/pig/sows`, `/pig/batches`, `/pig/feed`, `/pig/dailys`, `/pig/weighins` | pig program | auth |
| `/layer`, `/layer/groups`, `/layer/batches`, `/layer/dailys`, `/layer/eggs` | layer program | auth |
| `/cattle`, `/cattle/herds`, `/cattle/breeding`, `/cattle/batches`, `/cattle/dailys`, `/cattle/weighins` | cattle program | auth |
| `/sheep`, `/sheep/flocks`, `/sheep/dailys`, `/sheep/weighins` | sheep program | auth |
| `/equipment` | placeholder | auth |
| `/admin` | webforms + feed costs admin | admin only |
| `/webforms`, `/addfeed`, `/weighins` | public webforms | **no auth** |

Legacy `/#weighins`, `/#addfeed`, `/#webforms` bookmarks are rewritten to clean paths by the module-scope hash shim before React renders. Recovery hashes (`/#access_token=…&type=recovery`) are deliberately left intact — `SetPasswordScreen` parses them directly.

Unknown paths snap to home.

### Key people

| Person | Role | Email |
|---|---|---|
| Byron (Ronnie) Jones | Admin / Owner | byronronniejones@gmail.com |
| Mak | Management | mak@whitecreek.farm |
| Simon | Farm Team | Simon.rosa3@gmail.com |
| Josh | Farm Team | — |
| Jenny | Farm Team | — |
| BMAN | Team member (shows in webform team pickers) | — |
| BRIAN | Team member | — |
| RONNIE | Team member (legacy display alias) | — |

---

## 5. Domain reference

### 5.1 Feed system (pig & poultry)

**Data model.** Orders in `ppp-feed-orders-v1`: `{pig:{…}, starter:{…}, grower:{…}, layerfeed:{…}}`, each an ISO-month map (e.g. `"2025-10"` → lbs). Physical counts in `ppp-pig-feed-inventory-v1` and `ppp-poultry-feed-inventory-v1`.

**Order timing model.** Orders arrive at the END of the month. So:
- Mid-month, the current month's order has NOT arrived yet.
- "Actual On Hand" = orders from past months only, minus consumption since tracking started.
- "End of Month Estimate" = all orders through current month (including the arriving one) minus all consumption (actual + projected remaining days).
- "Suggested Order" for next month = next month's projected consumption − end-of-month estimate.

**Tracking start.** First month with any order entered across any feed type for that program. Consumption before that is ignored. For poultry, tracking starts for ALL three feed types when the first order in ANY type is entered.

**Monthly tile ledger (forward pass):**
```
START OF MONTH = previous month's END  (or 0 for first tracking month)
CONSUMED       = actual (past months) | actual + projected remaining (current) | projected (future)
ORDERED        = entered amount (arrives end of month)
END OF MONTH   = START - CONSUMED + ORDERED
```

**Physical count.** When entered, becomes the new anchor for all calculations forward. Shows adjustment badge: "Count adj +/- X". Only the latest count is stored — no history.

**Pig feed tab** (`/pig/feed`): 4 stat tiles + 3 projection cards + physical count input + monthly tiles with per-group breakdown.

Projection rates:
- Sows (non-nursing): 5 lbs/day
- Nursing sows: 12 lbs/day (computed from farrowing records + breeding timelines)
- Boars: 5 lbs/day
- Feeder pigs: 1 lb/day per month of age

**Poultry feed tab** (`/broiler/feed`): compact table (one row per feed type) + physical count + monthly tiles per feed type + collapsible batch-level feed estimates below. **No daily variance for poultry** — bulk feeding creates huge daily swings that don't normalize until month end.

### 5.2 Broiler batch system

- Batches in `ppp-v4`. Auto-status: `planned` → `active` → `processed` based on dates.
- B-24-* batches use legacy manual feed fields. B-25+ batches pull totals from `poultry_dailys`.
- Processing data: birds to processor, avg dressed weight, avg breast/thigh, whole/cuts lbs. Excel processor reports auto-parse via SheetJS.
- Document attachments via the `batch-documents` Supabase Storage bucket.
- 24-color palette assigned by trailing batch number for visual distinction.
- Schedule conflicts detected by `detectConflicts` in `src/lib/conflicts.js`: hard conflicts for broiler-vs-broiler brooder/schooner overlap (with cleanout windows), soft conflicts for broiler-vs-layer.
- Week 4 + Week 6 weigh-in averages written back to the batch by `writeBroilerBatchAvg` in `src/lib/broiler.js` on session completion.

### 5.3 Layer housing model

- `layer_batches` — batch-level (name, original_count, feed cost rates, lifecycle dates).
- `layer_housings` — per-housing (housing_name, batch_id, `current_count` anchor, start_date).
- `current_count` is a verified anchor from physical counts. Projected count = anchor − mortalities since anchor date.
- "Retirement Home" is a permanent pseudo-batch that never closes. Edit modal hides lifecycle fields.
- Helpers: `setHousingAnchorFromReport`, `computeProjectedCount`, `computeLayerFeedCost` in `src/lib/layerHousing.js`.

### 5.4 Pig breeding system

- Breeding cycles: Boar Exposure → Paddock → Farrowing → Weaning → Grow-out.
- Constants (`src/lib/pig.js`): 45-day exposure, 116-day gestation, 42-day weaning, 183-day grow-out.
- Farrowing records linked to cycles by date window + sow tag → boar-tag lists (`boar1Tags`, `boar2Tags`); `resolveSire` in main.jsx does the lookup.
- Feeder groups with sub-batches and processing trips.
- Breeding pig registry (`INITIAL_BREEDERS` seed has 24 Podio-imported pigs; `INITIAL_FARROWING` has 13 historical records).

**Breeding cycle modal (`BreedingView.jsx`) — major operational refactor 2026-04-22**:
- Sow assignments are **chip-based**, not free-text textareas. Each boar has a chip row + `+ Add sow from Group N` dropdown filtered to that group.
- **Auto-pull from breeders**: when a cycle is unstarted, opening the modal merges any group sows not yet in either boar's list into Boar 1. `mergeSowsIntoB1(group, b1, b2, excluded)` skips `cycle.excludedSows[]` so removed sows don't keep coming back.
- **2-week grace period**: `isCycleLocked(exposureStart)` returns true 14 days after the cycle starts; chip × delete + auto-pull stop firing once locked. Banner switches to "Cycle locked".
- **Custom batch number**: optional `cycle.customSuffix` overrides the auto `YY-NN`. Used by `cycleLabel()` and the gantt bar label.
- **Color palette = blue family**: `PIG_GROUP_COLORS` per group has base + lighter (gilts) + darker (boars) shades. Group 1 sky `#0EA5E9`, Group 2 core blue `#2563EB`, Group 3 slate `#475569`.

**Transfer-to-Breeding flow (admin weigh-ins → breeders registry)**:
- `LivestockWeighInsView.jsx` → per-row **→ Breeding** button on pig sessions opens a modal: New tag, Group, Sex, Birth date (auto session date − 6 mo). No feed input — auto-computed.
- `feedAllocationLbs = pig.weight × FCR`. FCR fallback chain: `parent.fcrCached` → industry default `3.5`. (FCR cache is **not yet wired** — see roadmap.)
- On confirm: inserts breeders entry (with `transferredFromBatch: {batchName, subBatchName, transferDate, feedAllocationLbs, fcrUsed, sourceWeighInId}`), decrements parent + sub batch giltCount/boarCount and originalPigCount, accumulates `parent.feedAllocatedToTransfers` (subtracted from displayed `totalFeed` everywhere it shows).
- **Dup guard**: pre-insert check skips when an existing breeder already references the same `sourceWeighInId`.
- **Migration 014** adds `weigh_ins.transferred_to_breeding`, `transfer_breeder_id`, `feed_allocation_lbs` columns. Pre-migration fallback writes `[transferred_to_breeding breeder=ID feed_alloc=N lb] <note>` marker into `weigh_ins.note`. Both paths are detected by `isTransferred = !!e.transferred_to_breeding || /\[transferred_to_breeding/.test(e.note||'')`.
- **Undo Transfer**: per-row purple button reverses everything — drops breeder by `transfer_breeder_id` (or note marker), increments counts back, decrements `feedAllocatedToTransfers`, clears the weigh-in stamp + strips the note marker.
- **Breeding pig tile** (`SowsView.jsx`): transferred sows show purple banner `This gilt was saved from <subBatch> on <date>.` (word adapts: gilt/sow/boar).

**Pig batch tile (`PigBatchesView.jsx`)**:
- **Per-sub Mark Processed / Reactivate** buttons. Processed subs force `currentCount=0` and drop out of the public webform group dropdown via `syncWebformConfig`.
- **Mortality entry**: + Mortality button on each batch tile opens a modal (Sub-batch picker, Count, Comment). Stored on `feederGroup.pigMortalities[]` with auto date + admin email. Expandable list per tile shows history with delete.
- **Breeding-transfer note**: purple banner `→ Breeding: N pigs out of <sub> sent to breeding pigs group`. Live-derived from `breeders.transferredFromBatch.batchName`.
- **Feed → Breeding stat tile**: shows `−N lbs` when `feedAllocatedToTransfers > 0`. Total Feed tile hint reads `raw X − Y transferred out`.
- **Carcass yield %** only counts trips with `hangingWeight > 0`. Trips waiting on processor data don't drag the % down.
- **Editable `feedAllocatedToTransfers`** in Edit Batch modal (set to 0 to clear stale state from outside-the-undo-flow cleanup).
- **Trip source attribution**: each processing trip shows `From: P-26-01A (GILTS) (2), P-26-01B (BOARS) (2)` derived from `weigh_ins.sent_to_trip_id` join with sessions. Edit Trip modal includes a green "Sources:" block.

**Pig timeline gantt (`BreedingView.jsx`)**:
- 2x zoom (week-cell width `40px`, was `80px`) so ~8 months fit in the viewport.
- `borderRadius:8` on bars (also broiler).
- Bar labels honor `customSuffix` (`G3 · 26-01 — Sows in with Boars`).
- Newest cycle cards on top below the chart.

**Public weigh-ins (`WeighInsWebform.jsx`)**:
- Per-species team-member lists (admin panel has a Weigh-Ins tile with 4 boxes for Cattle / Sheep / Pig / Broiler). Falls back to global team list if a species' list is empty.
- Pig flow is **per-entry** (no 2x15 grid): Weight + Note + Save. Entry list shows ascending (#1 at top).
- Cattle flow modes renamed: `↻ Swap Tag` (was Retag) + `+ Missing Tag` (was Replacement Tag). Internal mode IDs (`'retag'` / `'replacement'`) and `old_tags.source` values (`'weigh_in'`) unchanged for historical resolution.
- Swap Tag button gated until a cow is picked in the dropdown; auto-populates the Prior tag field.
- Cattle/sheep entries show age + prior weight + ADG.
- Resume-session bug fixed: `cattleHerd` / `sheepFlock` now restored from session row.

**Per-pig weight history on breeding pigs (`SowsView.jsx`)**:
- Each tile has `+ Record` weight input below the stats. New entries append to `breeder.weighins: [{weight, date}]` and update `lastWeight`. Tile shows compact history row (latest 6) + `+N more` overflow.

### 5.5 Cattle module

- 4 active herds + 3 outcomes (see `src/lib/cattle.js`):
  - Active: `mommas`, `backgrounders`, `finishers`, `bulls`
  - Outcomes: `processed`, `deceased`, `sold`
- Palette: red family (no purple — Bulls is wine/deep red, outcomes are neutral).
- Breeding timeline constants: `BULL_EXPOSURE_DAYS=65`, `PREG_CHECK_OFFSET=30`, `GESTATION=274`, `CALVING_WINDOW=65`, `NURSING=213`. See `src/lib/cattleBreeding.js`.
- Per-head cost rollup (feed + processing) was deferred from the original module build.
- Podio data imported April 16–17, 2026: 469 cattle, 1,930 weigh-ins, 1,525 daily reports. The planner has been the source of truth for cattle dailys + weigh-ins since 2026-04-17 — no further Podio cattle import planned.
- All cattle data lives in dedicated tables (`cattle`, `cattle_dailys`, `cattle_feed_inputs`, `cattle_calving_records`, `cattle_processing_batches`, `cattle_feed_tests`, `cattle_comments`) — NOT `app_store`. See §Part 2 Decision 5.
- DNA test PDF parser: manual entry is the workaround for v1.

### 5.6 Sheep module

- Parallel structure to cattle but with sheep terminology (flock / ewe / ram / wether / lambing).
- Phase 1 UI shipped April 18: directory, flat/tile modes, add/edit/delete/transfer, inline detail, bulk import, dailys + weigh-ins. No nutrition targets (Phase 2).
- **Podio data imported 2026-04-21:** 67 Podio sheep + 18 newly-purchased lambs (Willie Nisewonger, $275/each, KATAHDIN, DOB 2026-01-01, tags `RAM 001`–`RAM 008` + `EWE 001`–`EWE 010`, all in `ewes` flock pending weigh-in retag). Also 26 synthesized lambing records, 6 historical weigh-in sessions (34 weigh-ins), and 639 `sheep_dailys` (3 null-date rows skipped). The planner is now the sole source of truth for sheep — no further Podio sheep import planned.
- Migration 009 (sheep schema) had been drafted pre-import but was never applied to Supabase until 2026-04-21. Migration 010 extended `weigh_in_sessions.species` CHECK to include `'sheep'` (mig 009 originally assumed the CHECK already allowed it). Both applied that day.
- Sheep-specific daily fields: bales of hay, alfalfa lbs, minerals given + % eaten, fence voltage kV, waterers working.

### 5.7 Daily reports / webforms

- Public webforms at `/webforms`, `/addfeed`, `/weighins` (no auth required).
- Programs: Broiler, Layer, Pig, Egg, Cattle daily reports. Plus the legacy pig-dailys form at `/webform` (extracted to `src/webforms/PigDailysWebform.jsx` in the 2026-04-21 polish).
- Per-form team member config (`per_form_team_members`). Admin-configurable required/optional fields.
- Add Group feature: submit multiple batch reports in one form submission (via `allowAddGroup`).
- All delete actions use `DeleteModal` (type "delete" to confirm) — never `window.confirm`.

### 5.8 Add Feed webform

- Route: `/addfeed`. Inserts a new row into the appropriate `*_dailys` table with `source='add_feed_webform'`. Does NOT merge, mutate, or check collisions.
- Works because all 16+ feed-aggregation sites use `.reduce()` over filtered row arrays — multiple rows per batch+date are already normal.
- Rows visually badged in the Reports list with a 🌾 icon. Edit modal hides non-feed fields.
- Tri-state filter chip in each Reports list: All / Daily Reports / Add Feed.
- Pig inserts omit `feed_type` entirely (`pig_dailys` has no such column).

### 5.9 Permissions

| Role | Capabilities |
|---|---|
| `farm_team` | Edit + delete own daily reports only |
| `management` | Edit anything; delete daily reports only |
| `admin` | Full access — edit + delete everything; only admin can delete batches / groups |

Per-program access via `profiles.program_access` text array. Null/empty = full access. Otherwise a list like `['cattle','broiler']`. Admins always bypass. Canonical check: `canAccessProgram(prog)` + `VIEW_TO_PROGRAM` map in `main.jsx`.

Role-derived predicates also live in main.jsx: `canEditAll`, `canDeleteDailys`, `canDeleteAll`, etc. Module-level versions (`canEditDailys`, `canEditAnything`, etc.) exist in `main.jsx` for component prop threading.

---

## 6. Conditional field rules + design preferences

### Conditional field rules (apply to ALL forms)

1. **Feed type** is only required when `feed_lbs > 0`. Enforced in `validateRequiredFields()` and explicit submit checks.
2. **Mortality reason** is hidden until `mortality_count > 0`; then required with red asterisk.
3. All delete confirmations use `DeleteModal` (type "delete" to confirm). No `window.confirm`.

### Design preferences

- **No purple colors anywhere.** Cattle palette uses reds/wines (Bulls is wine, not purple).
- Modals are centered overlays, never inline forms.
- Auto-save with 1.5s debounce on edit forms; save on close.
- Colored pills for yes/no fields, team members, comments.
- Delete button lives only in the modal footer when editing (no separate Done/Cancel because auto-save handles commit).
- Alternating colors on batch cards.
- The pig feed tile layout is the model for all feed-tab tiles.
- Program palette committed 2026-04-14 (commit `524b4c2`) — don't repaint programs without revisiting that commit.

---

## 7. Don't-touch list

If a change modifies any of the following, **stop and ask first.** These are ongoing constraints, not migration-era artifacts. They were originally documented in `MIGRATION_PLAN.md §10` and are promoted here as authoritative.

- **`wcfSelectAll` pagination** (`.range(from, from+999)` + while-loop pattern in `src/lib/pagination.js`). `.limit()` silently caps at 1000 — the pagination helper is the only correct way to load >1000 rows.
- **Two-query `loadCattleWeighInsCached`** in `src/lib/cattleCache.js`. Session IDs first, then `weigh_ins.in()`. **No `!inner` joins anywhere.**
- **Supabase auth config:** `detectSessionInUrl: false` + `storageKey: 'farm-planner-auth'` in `src/lib/supabase.js`. See §Part 2 for rationale — do not change without a migration plan for outstanding sessions.
- **Source-label workflow strings:** `'import'` / `'weigh_in'` / `'manual'` for `old_tags` history entries. Renaming breaks prior-tag reconciliation.
- **`cellDates: true`** in any `XLSX.read()` call. Excel date parsing is broken without it.
- **`_wcfPersistData` debounce timing (800ms).** Changing the window risks double-saves or lost saves.
- **Webform URL paths:** `/webforms`, `/addfeed`, `/weighins` — plus the legacy `/#` variants that the hash-compat shim rewrites. These are printed on materials in the field.
- **Per-program `canAccessProgram` rules** (admin always bypasses). Behavior contract with `profiles.program_access` rows.
- **`\u` JSX escape literals** (em-dashes, bullets, en-dashes). Preserve the exact escape form — mixing with unicode characters in source risks encoding drift across editors.
- **`cattle.old_tags` jsonb shape.** Retag reconciliation reads specific field names.
- **`weigh_in_sessions.species` column convention** (`broiler` / `pig` / `cattle` / `sheep`). The shared session table discriminates here.
- **Supabase RLS policies.** None are touched by frontend work anyway — flag any suggestion that would require an RLS change.
- **`breeders[].transferredFromBatch.sourceWeighInId` shape.** The pig Transfer-to-Breeding dup guard reads this exact key — renaming breaks dedup and lets fast double-clicks recreate duplicates.
- **`weigh_ins.note` `[transferred_to_breeding breeder=… feed_alloc=…]` marker.** Pre-migration-014 fallback path writes this; the LivestockWeighInsView badge detection regex (`/\[transferred_to_breeding/`) and the feed_alloc parser depend on the format.
- **Pig transfer `mode` identifiers** in weigh_ins flow (`'retag'` / `'replacement'`) and old_tags `source` values (`'import'` / `'weigh_in'` / `'manual'`). User-facing strings were renamed to "Swap Tag" / "Missing Tag" / "(swap)" but internal IDs stayed for historical-data resolution.
- **Pig color palette = blue family only.** `PIG_GROUP_COLORS` in `src/lib/pig.js` uses sky / core blue / slate. Per-group base, lighter for gilts grow-out, darker for boars grow-out. No purple anywhere in pig views (Ronnie's standing rule).
- **`pigMortalities`, `pigsTransferredOut` audit fields on feeder groups.** Mortality count + comment + team_member + date stored on `feederGroup.pigMortalities[]`; transfer counts derived from `breeders.transferredFromBatch.batchName`. Both arrays are append-only audit logs — don't mutate historical entries.
- **Podio `status='deleted'` filter in equipment seeders.** `scripts/import_equipment.cjs` + `scripts/patch_equipment_intervals.cjs` + `scripts/patch_equipment_help_text.cjs` must filter BOTH `field.status !== 'deleted'` AND `option.status !== 'deleted'` when walking Podio's app-config JSON. The API ships cruft from cloned templates (e.g. tractor fields still sitting in the Honda ATV app) that the published webform hides — removing the filter resurrects the cross-contaminated intervals on the planner. Surveyed 2026-04-23: 21 deleted fields + ~400 deleted options across 17 apps. Every piece is affected.
- **Equipment `total_tasks` in `equipment_fuelings.service_intervals_completed` is baked in at import time** — stored per-completion. After an interval's task count changes (e.g. Podio prunes an option, or the admin task editor deletes one), historical rows become stale. Don't add new consumers that read `total_tasks` directly — fetch the current `equipment.service_intervals[].tasks.length` or run `scripts/patch_equipment_completions.cjs --commit` to re-clamp. UI in `EquipmentDetail.jsx` expanded-row already computes live from current config.
- **`items_completed` slug format in completions.** Slugified via `text.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 50)`. Same slugify is used in `rebuildFromConfig` so IDs match. Changing either end will break the `taskById` lookup in the expanded fueling row and the matching in the completions patch.
- **`attachment_checklists` JSONB shape on equipment.** `[{name, hours_or_km, kind, label, tasks:[{id,label}], help_text}]`. Keyed in the webform by `name + kind + hours_or_km`. Detected at seed time by `/\s--\s|\s—\s/` in the Podio field label (e.g. "Tough Cut -- Every 50 Hours"). Don't co-mingle attachment and main intervals — the dedup on (kind, hours_or_km) will lose attachment data.
- **"Every Use" / "Every Session" interval sentinel = `hours_or_km: 0`.** Ventrac's attachments include per-session checks (not hour-based). `parseIntervalLabel` in `scripts/import_equipment.cjs` matches `\bEVERY\s+(USE|SESSION)\b` and returns `values: [0]`. Render logic on `EquipmentFuelingWebform.jsx` + `EquipmentWebformsAdmin.jsx` treats `hours_or_km === 0` as literal "Every Use" label. Don't change the sentinel — all existing attachment rows in Supabase use 0.
- **Podio external_id variants for the every-fillup field.** Some apps use `every-fuel-fill-up-checklist` (most), others use `every-fuel-fill-up` (2018 Hijet + a few). `import_equipment.cjs` tries both. When adding a NEW Podio app, grep its `*.config.json` for `external_id` first and extend the fallback list if you find a third variant. Silent data loss if you miss one.
- **Equipment status enum is `active | sold`** (migration 022 renamed `retired` → `sold`). Don't reintroduce `'retired'` — fleet view, admin modal, detail page, import script, and dedup all key on `'sold'` for the 6 sold pieces (JD-317/333/Gator, Kubota-RTV, Polaris-Ranger, Great-Plains-Drill).
- **`equipment.manuals` is operator-facing; `equipment.documents` is admin-only.** Same JSONB shape `[{type:'pdf'|'video', title, url, path?, uploadedAt}]`. ManualsCard (on `/fueling/<slug>` + `/equipment/<slug>`) reads ONLY `manuals`. Admin modal's DocumentsEditor reads/writes ONLY `documents`. Don't mix — admin paperwork (invoices, warranties, purchase docs) leaking onto the public webform is a confidentiality break.
- **`fuel_supplies` table ≠ `equipment_fuelings` table.** Fuel deliveries to the farm (portable cell, gas cans, farm truck fills) go to `fuel_supplies`. Per-piece fuelings go to `equipment_fuelings`. Consumption math = `SUM(equipment_fuelings.gallons)`. Never count `fuel_supplies` as consumption.
- **FuelingHub.jsx enumerates equipment columns explicitly** — when adding a new column to `equipment`, also add it to `FuelingHub.jsx:19`'s select list, or the public `/fueling/<slug>` webform won't see the new field. Same rule for `HomeDashboard.jsx` equipment fetch. Always grep `from('equipment')` across `src/` after a migration.
- **Dedup-then-scrub ordering is a trap.** `scripts/patch_dedup_fueling_pairs.cjs` merges winner data but keeps the winner's original `podio_source_app` label. If you then run `scripts/patch_scrub_fuel_log_only.cjs` (deletes by `podio_source_app='fuel_log'`), you destroy merged rows that carry checklist data. Either (a) update source labels in dedup, (b) scrub by content criteria via `scripts/patch_scrub_empty_checklists.cjs`, or (c) always re-import via `import_equipment.cjs --fuelings-only` before scrubbing by source.
- **`import_equipment.cjs --fuelings-only` flag.** Use this for every post-launch re-import. Full-import form wipes admin-patched fields on the `equipment` table (operator_notes, team_members, manuals, documents, attachment_checklists adjustments, hand-edited fluid specs). Full-import is only correct on a clean-slate initial seed.
- **Podio-side duplicate submissions are real.** Operators sometimes submit the same Checklist twice within 24-48 hours. Known pairs as of 2026-04-24: c362 ×2, gehl ×2, honda-atv-1 ×4, ps100 ×1. Planner collapses to 1 row per unique (date, reading, team) via fallback match. Raw Podio counts ≥ planner counts for those pieces — that's correct, not a bug.
- **Snap-to-nearest milestone semantics for service intervals** (`src/lib/equipment.js` `snapToNearestMilestone` + `aggregateCompletionsByMilestone`). Every full completion at reading R for interval I snaps to whichever milestone (multiple of I) is closer. Tie-break favors the previous milestone (treat as late completion of prior). Next-due = snapped milestone + I. Don't revert to floor-based math — it caused the "500hr at 968h flagged overdue at 1000h" bug. Divisor cascade uses parent's RAW reading, NOT parent's snapped milestone — each sub-interval does its own independent snap. (Cascading the parent's snap would over-credit subs — 600hr at 1596 snapping to 1800 would falsely satisfy 50hr's 1700/1750/1800.)
- **Cumulative-partial milestone model** (`aggregateCompletionsByMilestone`). All completions (full + partial) for a given interval are grouped by their snapped milestone. Within each group, the UNION of `items_completed` is what counts. If union ≥ task count, the milestone is virtually-fully-satisfied even when no single submission was full. This handles real-world maintenance flow where work spans multiple sessions (e.g. 500hr partial at 440h with 14/16 done + 500hr partial at 444h with the missing 2/16 = full coverage of the 500h milestone). `total_tasks` is read from CURRENT equipment config so admin task edits re-evaluate history correctly. Don't switch to "latest single completion wins" — Ronnie depends on this for parts-arrival workflows.
- **`syncWebformConfig` MUST merge, not replace, team-member keys.** `webform_config.team_members` is the canonical master list — admin can add names directly via `/admin → Equipment → Fuel Supply Webform` that aren't yet referenced by any webform's `teamMembers` array. Sync now reads existing master fresh and unions in the derived per-webform union. Same for `per_form_team_members`: any non-webform key (currently just `fuel-supply`) is preserved across sync writes. If you add another non-webform per-form key in the future, it'll be preserved automatically since the carry-over loop checks against `cfg.webforms[].id`. Don't re-introduce the old "set master = derived union" code — admin adds will silently revert on every page load.
- **Read-fresh-then-write for `webform_config` jsonb keys.** Toggling, adding, and removing names in the Fuel Supply admin always re-fetches the latest `team_members` and `per_form_team_members` from the DB right before its upsert, then merges the change. Don't trust local React state — concurrent toggles' setState effects may not have landed, and the upsert overwrites the entire `data` jsonb. The same pattern is needed any time multiple keys are stored under one row's jsonb and edits arrive faster than React renders.
- **`fuel_bills` + `fuel_bill_lines` are admin-only.** Migration 026. RLS = authenticated SELECT/INSERT/UPDATE/DELETE. The `fuel-bills` storage bucket is `public:false` — signed URLs only (10-min expiry via the BillDetail PdfLink component). Don't add anon access; bills carry financial info.
- **Tax allocation per fuel-bill line is proportional-by-gallons, stored at parse time.** `fuel_bill_lines.allocated_tax` is `(net_units / total_gallons) * tax_total`. The `effective_per_gal = (line_subtotal + allocated_tax) / net_units` is the all-in cost — used for reconciliation. Some Home Oil taxes are basis-specific (e.g. road taxes on gasoline only), but the parser does flat proportional allocation in v1. Admin can override `allocated_tax` manually after parse if a basis-aware breakdown is needed for a specific bill.
- **Photo→fueling matching falls back to `(equipment_id, date)`.** Original `pull_podio_equipment_photos.cjs --upload` matched only by `podio_item_id`. After the dedup-then-scrub flow merged Fuel Log + Checklist pairs (keeping Fuel Log's `podio_item_id`), photos attached to the now-deleted Checklist items lost their match — only 48 of 195 unique manifest items linked. `scripts/patch_relink_photos_by_date.cjs` reads each photo entry's date from the Podio item dump and matches by (equipment_id, date) instead. Brought coverage from 48 → 167 fuelings linked (552 photos). When importing future Podio apps with similar dedup pressure, prefer date-matching for the link step.

---

## 8. Open items / roadmap

### Near-term (known & actionable)

- **Import more Podio apps** (Ronnie has more workspaces coming over — animal dailys, breeding records, etc.). Budget time for each: inventory fields via dump, filter `status='deleted'`, match external_id variants (e.g. `every-fuel-fill-up` vs `-checklist`), design per-app → planner table mapping, add per-app Fuel-Log-style category map if applicable, add `--fuelings-only`-style flag if it touches a patched-admin table, dry-run, audit against Podio XLSX exports. All pitfalls in `HANDOFF_NEXT_SESSION.md` apply to each new import. **For photo links, prefer `(equipment_id, date)` matching from day 1** to avoid the 147-orphan problem we hit on the equipment apps.
- **Fuel Log smoke test** — `/fueling/supply` public webform + `/admin → Fuel Log → Supplies` ledger have shipped through several iterations. As of 2026-04-25 the form is stripped to date / team / destination / fuel type / gallons / notes (supplier + cost dropped — bills handle financial info). Still not yet operator-tested end-to-end. Ronnie should submit one entry to confirm RLS + dropdown filtering.
- **Fuel-bill PDF parser broader test.** `src/lib/fuelBillParser.js` (lazy-loaded `pdfjs-dist`) is built for the Home Oil format. Pull a handful of recent bills through `/admin → Fuel Log → Bills → + Upload bill` to validate the regex against month-to-month variation. Tax allocation is proportional-by-gallons in v1; for an obvious mis-attribution (e.g. a bill that itemizes a road tax on gasoline only), admin can override `allocated_tax` per line. v2 enhancement: basis-aware tax allocation reading the bill's per-line "Basis" column.
- **Bill ↔ supply reconciliation review.** `/admin → Fuel Log → Reconciliation` groups bills (delivered) by `delivery_date` month vs `fuel_supplies` (logged) by `date` month. Variance > 5% green / >10% orange / >20% red. As of 2026-04-25 there are no bills uploaded yet, so the table just shows historical supplies. Once bills accumulate, scan for monthly variances that look real vs. data-entry artifacts.
- **Per-view state internalization** (optional polish, parked 2026-04-21). ~40 `useState` hooks in App's body are view-local state that belongs inside the view component. Right approach: push each block INTO the view that uses it (webforms-admin state → `WebformsAdminView`; feed state → shared `FeedUIContext`; auto-save refs → per-context). Regressions only surface at runtime, so it needs the bare-name audit pattern (see §Part 3) and careful per-view verification. Estimated 5–7 commits.
- **Per-head cattle cost rollup.** Feed cost (from `cattle_dailys.feeds[].lbs_as_fed × landed_per_lb`) + processing cost (from `cattle_processing_batches`) per cow with attribution rules. Not blocking ops.
- **Feed system physical count verification.** The adjustment calculation (system estimate vs actual count) needs real-world validation. Code reviewed for edge cases.
- **Pig FCR cache.** Transfer-to-breeding feed allocation = `pig.weight × FCR`. FCR currently falls back to industry default `3.5` because no code path stamps `parent.fcrCached` after a trip is added. Wire a side effect: when a trip is added/edited (PigBatchesView trip form persist), recompute parent FCR (`totalFeed / totalLive`) and stamp `parent.fcrCached`. Then transfers from in-progress batches use the real number.
- **Cattle modal cleanup.** The `openEdit` / `openAdd` modal code still lives in `src/cattle/CattleHerdsView.jsx` even though no UI button reaches it (Edit was removed in favor of inline-editable expanded tile). Rip the modal JSX + `form` state out for clarity. Also: the Add-Cow path (top-right "+ Add Cow" button) still uses a modal — convert it to "create empty cow row, expand it inline" or keep modal-for-add only.
- **Equipment dashboard rollup** — HomeDashboard tiles for equipment: overdue services count, upcoming-due list, 14-day missed-fueling alerts, DEF + warranty warnings. Data's there (post-cleanup `service_intervals` + `equipment_fuelings`); just needs a tile like the other programs have.

### Deferred (no current owner)

- **DNA test PDF parser** for cattle — manual entry is the v1 workaround.
- **Weather API integration** — multi-program scope, no provider chosen. Farm coords in §2.
- **TypeScript conversion.**
- **Test suite** (Vitest + Playwright).
- **CSS framework** (Tailwind, etc.) or styled-components.
- **Service worker / PWA install.**
- **Splitting `app_store` jsonb blobs into dedicated tables** (per-feature).
- **Full router migration** (replace `setView('X')` with `useNavigate('/path')` across every view). The adapter works fine; this is pure churn for "idiomatic React Router" without user-visible benefit.
- **ESLint + Prettier.**
- **Sheep module Phase 2** — nutrition targets, retag flow.

### Known gotchas (watch for these)

- **The `housingBatchMap` shape** was not directly SQL-verified during the Add Feed design. Existing code treats it as `{housingName: batchName}` (flat object). If layer `batch_id` resolution misbehaves at runtime, that's the first place to look.
- **The `source` column** on dailys tables is nullable. Filter logic: `r.source !== 'add_feed_webform'` handles null correctly (returns true). No null guard needed.
- **Historical B-24-* broiler batches** use legacy manual feed fields. B-25+ batches pull from dailys. Don't unify these without backfilling the older data.
- **`dateUtils.thisMonday()` appears to return Sunday, not Monday.** `d.setDate(d.getDate() - d.getDay())` lands on Sunday (`getDay()===0`). Used by `BroilerTimelineView.jsx`'s "this monday" reset button + as `tlStartInit` in `BatchesProvider`. Needs a UX decision before changing — anchor the broiler timeline to Sunday or Monday? — because either fixing the impl or renaming the function/button shifts the timeline display by 1-2 days. Found 2026-04-27 while writing the test slice; deliberately left untested so the suspected bug isn't frozen in by the test suite.

---

# Part 2 — Design Decisions

Load-bearing choices with rationale and — where it matters — the alternatives that were rejected. Future sessions should not relitigate these without reading the "why" first.

## 2.1 Add Feed Webform (2026-04-12, shipped)

### What was decided

The Add Feed webform (route `/addfeed`) inserts a brand-new row into the appropriate `*_dailys` table with `source='add_feed_webform'`. It does **not** mutate any existing row. It does **not** merge. It does **not** check for collisions. It inserts a fresh row and walks away.

All 16+ feed-aggregation sites already use `.reduce((s,d) => s + (parseFloat(d.feed_lbs) || 0), 0)` over filtered row arrays. Multiple rows per batch+date are already normal. The new Add Feed row is automatically picked up by every existing total, average, cost-per-dozen, feed-per-hen, and dashboard tile, with zero changes to any calculation code.

Add Feed rows are visually badged in the three Reports lists (broiler / layer / pig) with a 🌾 icon when `source === 'add_feed_webform'`. A tri-state filter chip (All / Daily Reports / Add Feed) lives at the top of each list. Edit modals hide non-feed fields for Add Feed rows to prevent users from accidentally turning them into frankenrows.

### Why — rejected alternatives

We went through three rejected designs before landing here. Don't re-propose these:

**Rejected #1: Merge logic on the dailys row.** Original spec had Add Feed look up an existing dailys row for that batch+date, increment its `feed_lbs`, and handle feed_type collisions (insert new row if feed_type differs, update if same/empty). **Why rejected:** multiple daily reports per batch+date are normal — the existing webform just `.insert()`s a fresh row every submit, no upsert. So "find the existing row to mutate" has no unique answer when there are 2+ rows for the same batch+date. Mutating an arbitrary one, and then later editing the morning vs evening report, could overwrite or double-count. Brittle.

**Rejected #2: Separate `feed_edit_log` ledger table.** Parallel audit table with its own row per Add Feed submission, linked to the dailys row via `daily_report_id`. **Why rejected:** the "mutate the dailys row" half still had the multi-row problem. And once you stop mutating it, the ledger becomes redundant — the dailys row IS the audit trail, distinguished by `source`. The `feed_edit_log` table was created and then dropped during the design session. Do not reference it.

**Rejected #3: Dedicated Feed Log tab in each dailys view.** Initially planned as `Reports | Add Feed Log` tabs side by side. **Why rejected:** once Add Feed rows are just badged dailys rows, a separate tab is duplicate UI. A filter chip gives the same audit-scanning capability with one small UI control instead of a parallel tab + modal + list rendering.

### Why the chosen design wins

Zero changes to calculation infrastructure. No orphan handling (Add Feed always creates a complete row). No new tables. No new modals. No multi-row ambiguity. The editing constraints (lbs + feed_type only) are enforced via conditional rendering in the existing edit modal, ~5–10 lines per modal. Smallest footprint, maximum reuse.

### Verified facts (do not re-verify)

1. All feed-aggregation sites use `.reduce()` over filtered row arrays — none assume one row per batch+date. Verified via grep during the design session.
2. No code anywhere filters dailys rows by `source`. Adding the column is invisible to existing logic.
3. `source` column added to all three dailys tables (`layer_dailys`, `poultry_dailys`, `pig_dailys`) via `ALTER TABLE … ADD COLUMN IF NOT EXISTS source TEXT;`. Nullable, no default. Existing rows have null.
4. `pig_dailys` has **no `feed_type` column.** Add Feed inserts for pig must omit `feed_type` entirely — passing null fails because the column doesn't exist.

## 2.2 Cattle module (2026-04-15, shipped)

### Decision 1: Directory tab merged into Herds (no separate Directory)

**Decided:** 6 sub-tabs (Dashboard / Herds / Dailys / Weigh-Ins / Breeding / Batches) — no Directory. Herds combines per-herd-tile operational view AND flat searchable directory view.

**How it works:** Default = per-herd tiles for the 4 active herds, outcome herds (Processed / Deceased / Sold) collapsed at bottom. When the user types in search or picks a non-active status filter, the view switches to a flat sortable list across all matching cattle. Add / Edit / Transfer / Delete work in both modes.

**Why:** A separate Directory tab duplicates UI. The unique value of "Directory" was (1) cross-herd search, (2) flat sortable table, (3) outcome animals as first-class records — all achievable with a search box + status filter on top of Herds. One tab, less navigation, no confusion about "which tab do I edit a cow on."

### Decision 2: `is_creep` as a per-line flag on `cattle_dailys.feeds` (not a feed-input attribute, not a separate compound feed)

**Decided:** When a Mommas daily report includes creep-feed ingredients (alfalfa pellets, citrus pellets, sugar, colostrum supplement), each feed line can be flagged with an `is_creep` boolean. Creep lines are excluded from Mommas nutrition math (calves eat them, not the mommas) but included in cost totals. Stored inline in the `feeds` jsonb on each `cattle_dailys` row.

**Why:** Creep ingredients are NOT unique to creep — alfalfa pellets are also eaten by Bulls, citrus pellets also by Backgrounders/Finishers. So we can't tag the FEED itself as "exclude from nutrition." Tag the USAGE.

**Rejected: separate `cattle_creep_batches` table + standalone "Mix Creep Batch" form.** Rejected because Ronnie said "we don't need a creep feed standalone form, we just track ingredients and cost like everything else." Simpler = win.

**Rejected: `exclude_from_nutrition` boolean on `cattle_feed_inputs`.** Would mark alfalfa pellets as always-excluded — but then you can't feed them directly to bulls without it counting. Same ingredient, different usage. Per-line flag is the only model that works.

### Decision 3: Comments unified into one `cattle_comments` table with a `source` discriminator

**Decided:** All per-cow observations live in a single `cattle_comments` table. `source` distinguishes origin (`manual` / `weigh_in` / `daily_report` / `calving`). `reference_id` links back to the originating row when applicable. Cow profile shows a unified timeline.

**Why:** Observations naturally come from multiple sources — a weigh-in note, a calving observation, an ad-hoc field note. Unifying them means cow profiles show a single chronological timeline instead of stitching from `weigh_ins.note` + `cattle_calving_records.notes` + `cattle.notes`.

**Rejected: comment fields scattered across source tables** — would have required cow-profile views to query 4+ tables and merge client-side. Too much friction.

**Rejected: `cow.notes` as a single text field** — Ronnie wanted a date-stamped timeline, not a single editable blob.

### Decision 4: Snapshot nutrition onto `cattle_dailys.feeds` at submit time (not by-reference lookup)

**Decided:** Each feed line stores `nutrition_snapshot: {moisture_pct, nfc_pct, protein_pct}` captured at submit time. Editing the parent feed in admin does NOT rewrite historical reports.

**Why:** By-reference lookup means uploading a new test PDF for "Rye Baleage" would silently revise the calculated nutrition of every past daily report. Misleading — the cow ate the hay that was in the field at the time, not the hay's current spec.

### Decision 5: Cattle uses dedicated Supabase tables (not `app_store` jsonb)

**Decided:** All cattle data lives in dedicated tables. `app_store` is used only for legacy poultry/pig blobs.

**Why:** Matches the pattern used by `pig_dailys`, `layer_dailys`, `egg_dailys`, `poultry_dailys`, `layer_batches`, `layer_housings`. Dedicated tables have RLS policies, indexes, foreign keys, and SQL queryability. jsonb blobs are fine for a small handful of records but don't scale to 469+ cattle with weigh-ins and dailys.

### Decision 6: Delete Permanently (not Mark Inactive) for feed entries

**Decided:** Livestock Feed Inputs panel's edit modal has a "Delete Feed" button that permanently deletes the feed row + cascades to its tests + cleans up PDFs from storage. Historical `cattle_dailys` snapshots are preserved (nutrition is stored by-value per Decision 4).

**Why:** Ronnie asked for "I should be able to delete any feed tile." "Mark Inactive" was leftover from an earlier draft.

**Safety:** Cascade is intentional — `cattle_feed_tests.feed_input_id` has `ON DELETE CASCADE`. PDFs in storage are removed by app code (not Postgres cascade). Historical reports retain their snapshot values.

## 2.3 Supabase auth config

### `detectSessionInUrl: false` + `storageKey: 'farm-planner-auth'`

**Decided:** The Supabase client is initialized with `detectSessionInUrl: false` and `storageKey: 'farm-planner-auth'` in `src/lib/supabase.js`. `SetPasswordScreen` parses the recovery token from `window.location.hash` manually and calls `sb.auth.setSession(…)` itself.

**Why:** The default (`detectSessionInUrl: true`) makes supabase-js auto-consume the URL hash on client init — which races with React mount, can clear the hash before `SetPasswordScreen` sees it, and fights with `BrowserRouter`'s location parsing. Manual parsing is more verbose but puts ordering in our control.

**Why the custom storage key:** The default key (`sb-<project-ref>-auth-token`) changes if we ever migrate the Supabase project. Using a stable app-owned key means outstanding sessions survive a project-ref change.

**Don't change these** without a migration plan for currently-signed-in users (they'd lose their session on deploy).

## 2.4 Two-query `loadCattleWeighInsCached` (no `!inner` joins)

**Decided:** `src/lib/cattleCache.js` fetches weigh-in sessions first (IDs only), then `weigh_ins` via `.in('session_id', ids)`. Two round trips, not one.

**Why not a `!inner` join:** PostgREST's `!inner` emits a SQL inner join with subquery filters that, under our RLS policies + realistic row counts, generates query plans that time out or return incomplete result sets. The two-query pattern is explicitly safer. Verified during the original cattle build.

**Don't unify these into one PostgREST call** without rerunning the timing experiments from the April 16 cattle import session.

## 2.5 Vite migration — key decisions

### Feature-scoped Contexts over one god-Context or Zustand

**Decided:** 10 feature-scoped React Contexts — `AuthContext`, `BatchesContext`, `PigContext`, `LayerContext`, `DailysRecentContext`, `CattleHomeContext`, `SheepHomeContext`, `WebformsConfigContext`, `FeedCostsContext`, `UIContext`.

**Why:** One god-Context forces every consumer to re-render on every state change. Zustand is a fine library but introduces a dependency + mental model switch for zero incremental benefit over native React context. Feature scoping maps directly to the folder tree (each provider owns state for exactly one program/area) and the provider order in `main.jsx` makes dependency ordering explicit.

### BrowserRouter with a view↔URL adapter (not full `setView` → `useNavigate` migration)

**Decided:** Phase 3 wrapped the root in `<BrowserRouter>` and added two `useEffect`s inside `App` that mirror `view` state to `location.pathname`. Every existing `setView('X')` call site continues to work.

**Why:** A full migration would replace `setView('X')` with `useNavigate('/path')` at ~50 call sites across extracted views. Pure churn for idiomatic React Router — same user-visible outcome, same URLs, same back button. The adapter is a thin layer on top of a clean state machine; the state machine isn't a hack, it's a clean model that happens to mirror URLs now.

### Hook-based extraction with a systematic bare-name audit (not file-slice for every component)

**Decided:** Components with ≤100 lines of JSX that close over many App-scope names are extracted as hook-based components that consume their own contexts directly. Components that are pure JSX trees can be file-sliced. Every hook-based extraction runs through a bare-name audit before push.

**Why:** PowerShell file-slicing (the big-block cut-and-paste pattern from Phase 2 Rounds 1–5) is the right tool for components whose content never touches App's locals. Hook-based is the only option when the component reads 10+ pieces of shared state. Mixing the two approaches lets each component pick its lowest-risk path.

The bare-name audit (see §Part 3 "Lessons") caught zero misses in the Phase 2 finale sessions after one painful audit-less round produced 8 commits of runtime fixups.

### Hash-compat shim over user bookmark migration

**Decided:** `/#weighins`, `/#addfeed`, `/#webforms` bookmarks are rewritten to clean paths by a module-scope `history.replaceState` shim that runs before `root.render()`. Recovery hashes (`/#access_token=…&type=recovery`) are left intact.

**Why:** Users have those URLs printed on field materials, saved in Slack messages, and bookmarked in phones. A shim is invisible; a URL migration would silently 404 on every legacy bookmark until the user noticed and updated.

### Supabase password-recovery stays on hash (not `/reset?token=…`)

**Decided:** The Phase 3 plan originally called for switching `SetPasswordScreen` to read tokens from `/reset?token=…` as primary. **Skipped deliberately.**

**Why:** Auth tokens in URL query params end up in server logs, `Referer` headers, and browser history. Supabase's default hash-fragment format exists specifically to avoid those leaks. Moving them to query params is a security regression.

### What the migration deliberately did NOT do

- TypeScript conversion.
- Test suite (Vitest/Playwright).
- CSS framework (Tailwind etc.).
- Storybook.
- Service worker / PWA install.
- Splitting `app_store` jsonb blobs into dedicated tables.
- Bundle splitting beyond Vite's defaults.
- Any framework jump (Next.js, React Server Components).

Each can come later as its own initiative. Migration was purely toolchain + organization.

---

# Part 3 — History

## 3.1 Origin

WCF Planner started as a single `index.html` file serving the full app: ~19,445 lines of JSX inside a `<script type="text/jsx-source">` block, transpiled in the browser via Babel-standalone with a localStorage cache. React, ReactDOM, supabase-js, and xlsx were loaded from CDNs. No build step, no package.json, no `src/` tree. Deploy = commit `index.html` to GitHub, Netlify serves it.

The model held for months while features accumulated: broiler batch tracking, pig breeding + farrowing + feeder batches, layer housing, egg collection, public webforms with admin configuration, a cattle module (469 animals imported from Podio), a sheep module. By early April 2026, `index.html` was ~19k lines. Cold-load on mobile cellular ran Babel on every visit — ~2–3 seconds to interactive. A single accidental break could take the whole app down; there were no extraction boundaries.

## 3.2 Migration timeline (April 19–21, 2026 — ~4 calendar days, ~30 commits)

### Phase 1 — Vite scaffolding

Replace in-browser Babel with a proper Vite build. Same code, different toolchain.

- Moved the JSX source block verbatim into `src/main.jsx`. No logic changes. Replaced CDN `<script>` tags in `index.html` with `<script type="module" src="/src/main.jsx">`.
- Replaced `_wcfLoadXLSX` CDN fetch with `await import('xlsx')`. Same lazy-load contract.
- Deleted the `_wcfBabelCache` localStorage helper + eval bootstrap. Added a one-time `wcf-babel-*` purge to free ~600 KB per user.
- Added `public/_redirects` for Netlify SPA fallback.
- Build: `npm run build` → `dist/`. Netlify config: publish `dist/`, build command `npm run build`.
- Result: identical user experience, near-instant mobile cold load.

### Phase 2 — Component extraction (8 rounds)

Split the monolithic `src/main.jsx` into a feature-organized tree.

- **Round 0** — Extracted 10 feature-scoped Contexts (`AuthContext`, `BatchesContext`, `PigContext`, `LayerContext`, `DailysRecentContext`, `CattleHomeContext`, `SheepHomeContext`, `WebformsConfigContext`, `FeedCostsContext`, `UIContext`). App now wraps in a provider tree.
- **Rounds 1–5** — Leaf components + single-feature views + admin panels + public webforms. PowerShell file-slicing for big blocks that didn't close over App state. 30+ components moved.
- **Round 6** — Inline views inside App (the hard ones: `BroilerHomeView`, `BroilerListView`, `BroilerTimelineView`, `BroilerFeedView`, `BatchForm`, `PigsHomeView`, `BreedingView`, `FarrowingView`, `SowsView`, `PigBatchesView`, `PigFeedView`, plus `LayersHomeView`, `LayersView`, `LayerBatchesView`, and all cattle/sheep views). Hook-based extraction.
- **Round 7** — `HomeDashboard` (the biggest single extraction — ~540 lines reading every data context).
- **Round 8** — `EquipmentPlaceholder` stub.
- **Phase 2 cutover** — merge commit `9799960` to `main` on 2026-04-21. Ronnie's verdict: "everything looks good. Zero difference noticed actually."

End state: `src/main.jsx` 19,445 → ~2,000 lines of pure wiring.

### Phase 3 — URL routing

Add per-tab URLs + working browser back button via `react-router-dom@7`.

- Installed `react-router-dom`. Created `src/lib/routes.js` with `VIEW_TO_PATH`, `PATH_TO_VIEW`, `HASH_COMPAT` maps.
- Wrapped root in `<BrowserRouter>`. Added URL↔view adapter (two `useEffect`s with `syncingFromUrl` ref guard) inside `App`.
- Hash-compat shim at module scope, runs synchronously before `root.render()`. Rewrites `/#weighins`, `/#addfeed`, `/#webforms` to clean paths via `history.replaceState`. Recovery hash left alone.
- Polish: URLSync fallback preserves `location.hash` (protects password-recovery flow on mangled URLs). `UIContext.initialView()` reads pathname first — no LoginScreen flash on `/weighins` cold load.
- **Phase 3 cutover** — merge commit `7779750` to `main` on 2026-04-21. Ronnie's verdict: "Everything look great. We have 'urls' for each page and back button work."

### Post-migration polish

Four commits on a short-lived `polish` branch on 2026-04-21:

- `CATTLE_*` constants → `src/lib/cattle.js`. Fixed latent `ReferenceError` in `cattleBreeding.js` (had been using `CATTLE_*_DAYS` + `toISO` + `addDays` as bare refs with no imports).
- `detectConflicts` → `src/lib/conflicts.js`. Preserved `–` escape literals.
- `writeBroilerBatchAvg` → `src/lib/broiler.js`. Fixed second latent `ReferenceError` — `WeighInsWebform.jsx` + `LivestockWeighInsView.jsx` both called it with no import.
- `renderWebform` → `src/webforms/PigDailysWebform.jsx`. Moved 5 `wf*` state pieces into the new component as internal `useState`; dropped 10 unused props from `WebformsAdminView`.

Polish cutover: merge commit `8b3d1c0` to `main` on 2026-04-21.

## 3.3 Final numbers

| Metric | Pre-migration | Post-migration | Delta |
|---|---|---|---|
| `index.html` | 19,445 lines | ~30 lines | -99% |
| Main source file | — | `src/main.jsx` ~1,750 lines | — |
| Main source vs pre | `index.html` = 19,445 | main.jsx = 1,750 | **-91%** |
| Bundle size (gzipped) | Babel transpile every load | 308 KB + 143 KB lazy xlsx | — |
| Module count | 1 file | 162 modules | — |
| Extracted components | 0 | 54+ | — |
| Helper libs | inline | 14 in `src/lib/` | — |
| Contexts | 0 | 10 | — |
| URL support | hash-only | per-tab paths + working back button | — |
| Latent `ReferenceError` bugs caught along the way | — | 2 (in `cattleBreeding.js`, in 2 `writeBroilerBatchAvg` callers) | — |

## 3.4 Transferable lessons

These are session-independent patterns worth preserving for future Claude work on this codebase.

### The bare-name audit pattern (hook-based extractions)

Hook-based view extractions close over dozens of App-scope names. Missing a single one = runtime `ReferenceError` on first nav to that view. Builds pass silently; only the browser catches these. **Clean build is not proof of correctness.**

The cure: before pushing any hook-based extraction, run a systematic bare-name audit:

1. Parse the new file's imports + destructures + function params + local const/let/var + function declarations into a `known` set.
2. Scan every identifier-looking token in the body.
3. Strip comments + string literals + JSX text + property access (preceded by `.`) + object keys (followed by `:`) + JSX attributes (followed by `=`) + lowercase-HTML tag names.
4. Flag what's left.
5. Cross-check remaining suspects against every `lib/*` export, every context state name, and the App-helper blast list: `persist`, `del`, `confirmDelete`, `saveFeedCosts`, `loadUsers`, `refreshDailys`, `openEdit`, `submit`, `upd`, `closeForm`, `signOut`, `backupData`, `restoreData`, `sbSave`, `persistBreeding`, `persistFarrowing`, `persistFeeders`, `persistBreeders`, `persistBreedOptions`, `persistOriginOptions`, `persistWebforms`, `persistLayerGroups`, `persistLayerHousings`, `resolveSire`, `parseProcessorXlsx`.

A reference `tmp_audit.cjs` script was used during Phase 2 Round 6+ and the 2026-04-21 polish. It's dev-only — delete before push. Never commit it.

The pattern earned its keep: Phase 2 Round 6 had 8 fix-up commits before the audit was introduced. Round 6-tail, Round 7, Round 8, and the 2026-04-21 polish shipped with zero post-push `ReferenceError` fixups.

### The latent `ReferenceError` class of bug

Both `src/lib/cattleBreeding.js` (CATTLE_* constants + toISO + addDays) and `writeBroilerBatchAvg`'s callers (`WeighInsWebform.jsx` + `LivestockWeighInsView.jsx`) had bare-identifier references with no imports, apparently cold in production and therefore never caught. Vite doesn't error on unresolved identifiers at build time — only at runtime, and only when the specific call path executes.

**When doing any `src/lib/` lift, check every existing caller for an import statement.** Not having one isn't "don't need to add it" — it's "there's a latent bug here."

### PowerShell file-slicing (for big JSX blocks)

For components with minimal App-state coupling, byte-range slicing via PowerShell (`[System.Collections.ArrayList]::RemoveRange`) is faster and less error-prone than transcribing JSX through Read → Write. The file content never enters conversation context, so there's no drift.

Pattern: locate the target block's start + end line numbers (via Grep), verify the closing brace index, slice the byte range into the new file, remove from the source. Always verify with `npm run build` clean before commit.

### Module-scope synchronous shims run before React

For startup-order-sensitive work (hash-bookmark compat, the `wcf-babel-*` localStorage purge), module-scope code in `main.jsx` executes before `createRoot(…).render(…)`. This is the only safe place for logic that must happen before React's first render sees the URL or mutates the DOM.

### The `_wcfConfirmDelete` window escape hatch

App exposes `confirmDelete` as `window._wcfConfirmDelete` so deeply-nested components can trigger the confirmation modal without prop-drilling. Strict-mode-safe only if the consuming component has `confirmDelete` in scope — extracting a component that uses it as a bare identifier without making it a prop will crash (see the `LayerBatchesView` latent fix in Phase 2 Round 2 tail).

## 3.5 Backup paths still valid

- **Netlify UI → Deploys → "Publish deploy"** on any pre-incident build. Fastest rollback, ~60s to live.
- **`git revert -m 1 <merge-commit> && git push`.** Durable — preserves the incident commit in history.
- **`~/OneDrive/Desktop/WCF-planner-backups/index.html.pre-vite-2026-04-19`** (1.3 MB, blob SHA `e06c66df…`). Pre-migration single-file app. Nuclear option if git ever gets confused.

## 3.6 Stale branches (deleted post-cutover)

- `vite-migration` — Phase 2 work. Deleted 2026-04-21 session 3. Structurally merged via `9799960`.
- `phase-3-router` — Phase 3 work. Deleted 2026-04-21 session 3. Structurally merged via `7779750`.
- `polish` — 2026-04-21 polish + doc commits. Deleted same day. Structurally merged via `8b3d1c0`.

Only `main` remains (local + origin). All history preserved in merge commits on `main`.

---

# Part 4 — Session Index

One line per working session. Detail lives in git log (`git log --oneline --date=short`) and full per-session narratives in [`archive/SESSION_LOG.md`](archive/SESSION_LOG.md). The left column shows a representative commit SHA.

| Date | SHA (end) | Headline |
|---|---|---|
| 2026-04-12 | `021714b` | Initial setup: repo, Netlify auto-deploy, Add Feed Webform full feature build, pig feed planning tab, comprehensive PROJECT.md handover. |
| 2026-04-13 | `fbac585` | Feed tab overhaul — running ledger, order-timing model, suggested orders; pig/broiler feed inventory; breeding pigs redesign + farrowing cycle linkage. Three commits of feed-tab bugfixes. |
| 2026-04-14 | `85f17eb` | Program color palette applied across app (no purple); auto-generated pig breeding cycle labels; egg webform Group 1 bug fix; broiler feed projections updated from WCF historical data (`94f0d5e`); branded welcome/password-reset emails via Resend (`a7a9658`); B-24-02..B-25-01 migrated to FR breed. Cattle module Q&A captured. |
| 2026-04-15 | `5716420` | Cattle module Phase 1 build + Phase 2 (cattle/pig/broiler dailys) + Phase 3 Directory-merged-into-Herds. Admin feed inputs + test PDFs + cattle webforms + dailys view (`d8a4a67`, `be4525e`). Deployment SOP codified in docs. Two post-deploy hotfixes (`45756a5`, `05578a0`). |
| 2026-04-16 | `56bad15` | Cattle Podio data import: 469 cattle, 1,930 weigh-ins (`56bad15`), tag-swap history + New-Cow-vs-Replacement-Tag split (`6a40485`), per-schooner broiler weigh-in columns, admin tabs for broilers/pigs. |
| 2026-04-17 | `3874dca` | Cattle admin UX deep dive: weigh-in functionality, mortality fix, cattle batches + rolling nutrition panel (`618125c`), cow-detail polish + clickable lineage (`e8ca425`), Cost-by-Month tab + DM field (`bc2cc24`). |
| 2026-04-17 (eve) | `ac40fd8` | Cow detail: weight history polish + tag search + Prior Tags editor + on-the-spot retag flow. Six commits sitting unpushed at session end. |
| 2026-04-18 | (see archive) | Cattle bulk import tool (self-serve XLSX), auth hardening (SetPasswordScreen — invite + recovery), user management improvements, Sheep module Phase 1 (directory + flat/tile + add/edit/transfer + bulk import + dailys + weigh-ins). |
| 2026-04-19 | `6f15a29` | Vite migration plan drafted: goals, phased plan (Phases 1–3), risk register, don't-touch list, cutover checklist. Backup created. |
| 2026-04-20 (AM) | `67d2ae3` | Phase 1 preview verified. Phase 2 Round 0: all 10 Contexts extracted from App. |
| 2026-04-20 (PM) | `0f02b2c` | Phase 2 Rounds 1–5: leaf components + auth screens + single-feature dailys views + stateful views + admin panels + public webforms. PowerShell file-slicing pattern established. |
| 2026-04-20 (eve) | `7e9f999` | Phase 2 Round 6: all 12 inline views extracted. 8 commits of runtime ReferenceError fixups — the painful session that taught us to build the bare-name audit. |
| 2026-04-21 (AM) | `377211a` | Phase 2 finale: Round 6 tail (Header + BatchForm) + Round 7 (HomeDashboard) + Round 8 (EquipmentPlaceholder) + Round 2 tail (LayerBatchesView with latent-bug fix). Zero post-push fixups — the audit pattern earned its keep. |
| 2026-04-21 (midday) | `7779750` | Phase 2 cutover to production (`9799960`) + Phase 3 URL routing (3.1/3.2/3.3/polish) + Phase 3 cutover to production (`7779750`). Per-tab URLs + working back button live. |
| 2026-04-21 (eve) | `8b3d1c0` | Polish: CATTLE_* + detectConflicts + writeBroilerBatchAvg + renderWebform extractions. Two latent `ReferenceError` bugs caught and fixed. Polish cutover (`8b3d1c0`). |
| 2026-04-21 (wrap) | (this commit) | Doc consolidation: `archive/SESSION_LOG.md` frozen; `PROJECT.md` rewritten in 4 parts (Living Reference, Design Decisions, History, Session Index); `DECISIONS.md` + `MIGRATION_PLAN.md` to be deleted in the final commit. |
| 2026-04-21 (later) | (this commit) | Sheep Podio import: mig 009 (sheep module, never previously applied) + mig 010 (weigh_in_sessions.species CHECK extended with 'sheep') applied via SQL Editor; `scripts/import_sheep.cjs` landed 85 sheep (67 Podio + 18 new Willie Nisewonger lambs), 26 lambing records, 6 weigh-in sessions (34 weigh-ins), 639 sheep_dailys. Planner is now sole source of truth for sheep. |
| 2026-04-23 | `5cd306f` | **Equipment module v1** built autonomously while Ronnie was at lunch. Migration 016 adds three tables (`equipment`, `equipment_fuelings`, `equipment_maintenance_events`), extends `profiles.role` with `equipment_tech`, creates the `equipment-maintenance-docs` Storage bucket with RLS. `scripts/import_equipment.cjs` reads the existing Podio dump and builds 15 equipment rows (Tractors / ATVs / Hijets / Mowers / Skidsteers / Forestry), seeds `service_intervals` + `every_fillup_items` from each Podio checklist app's field config, and imports ~1,790 fueling rows (Fuel Log + 15 per-equipment checklist apps, deduped via the checklist's Fuel Log app-relation). `src/equipment/` — `EquipmentHome` (container with internal sub-routing), `EquipmentFleetView` (category-clustered tiles with service-due / warranty / missed-fueling badges), `EquipmentDetail` (inline-editable spec panel, upcoming-service calculator with the **divisor rule** — ticking 1000hr auto-counts any smaller interval that divides 1000, so 500/250/100/50 get checked off but 300 does not — fueling + checklist history, maintenance events with photo upload), `EquipmentFuelLogView` (flat audit with filters), `EquipmentMaintenanceModal` (photo upload into the new Storage bucket). Public `/fueling` webform (`FuelingHub` + `EquipmentFuelingWebform`) with category clusters + Quick Fuel Log tile; divisor rule applied in-form with auto-tick preview. `src/lib/equipment.js` holds category metadata, color tokens, `computeIntervalStatus` with divisor rule, 14-day missed-fueling threshold, 60-day warranty window. HomeDashboard's missed-daily list gained equipment rows (14+ days without fueling). URL adapter in `main.jsx` maps every `/equipment/*` path and every `/fueling/*` path to their respective hub views so EquipmentHome / FuelingHub own their own sub-routing (mirrors the existing `/webforms/*` pattern). All 10 open questions from `EQUIPMENT_PLAN.md §7` resolved: fuel types = diesel/gasoline/def; tracking_unit single (hours or km, never both); interval completion uses divisor rule; attachments via `parent_equipment_id` self-ref; all Podio items active; + Add Equipment auto-creates webform config; no vendor field (free text comments instead); photos imported via follow-up pull; anon-accessible webform; 14-day missed threshold; category clusters are Tractors / ATVs / Hijets / Mowers / Skidsteers / Forestry (Gyro-Trac / C362 / Mini X all in Forestry per Ronnie). **Still TODO** (not done this session): equipment_tech role gating on home + sub-nav, admin panel tab split (Program Webforms / Equipment Webforms), photo import from Podio (needs fresh pull with files endpoint), fuel-bill parser (deferred to Phase 7). Ronnie needs to: (1) run `supabase-migrations/016_equipment_module.sql` in SQL Editor, (2) `node scripts/import_equipment.cjs` (dry-run), (3) `node scripts/import_equipment.cjs --commit`. |
| 2026-04-22 | `642137c` | Massive operational session. Weigh-ins: per-species team-member admin, Swap Tag / Missing Tag rename, resume-bug fix, age + prior weight + ADG inline, pig weigh-in entry list (no grid). Pig breeding: chip UI for sow/boar assignment, 14-day grace period, auto-pull from breeders by group, custom batch number override, group-color recolor (blue family, no purple), 2x timeline zoom, rounded gantt bars, Close button, sow-pool banner. Pig batches: chick→sow Transfer-to-Breeding flow on admin weigh-ins (FCR×weight feed allocation, parent+sub count decrements, dup guard via `sourceWeighInId`, Undo Transfer reversal, editable `feedAllocatedToTransfers` field, sow tile "saved from" banner, batch tile "→ Breeding: N pigs out of <sub>" note), per-sub-batch Mark Processed + Reactivate buttons, processed subs force currentCount=0, mortality entry modal with sub-batch attribution. Broiler: Sonny's raw per-package XLSX parser (replaces never-matched pivot expectation), wings included in cuts, chick purchase cost field rolling into total cost, conflict-override flag auto-clears on save and hides on processed batches, hatch-suggestions hide once date is set, B-25-02 → VALLEY FARMS / B-25-03 → CREDO FARMS hatchery backfill, processor cuts use raw aggregation. Cattle: Edit Cow modal **deleted** in favor of inline-editable expanded tile (header inputs + identity/lineage/prior-tags/blacklist sections all auto-save on blur), collapsed row hides when expanded, X close button, breeding blacklist hidden for steers + maternal flag removed. Pig color family / contrast: `getReadableText(hexBg)` helper in `src/lib/styles.js` for dynamic dark-vs-light text against any palette bg. Migration 014 (`weigh_ins.transferred_to_breeding/transfer_breeder_id/feed_allocation_lbs`) shipped — runs in Supabase SQL Editor; pre-migration fallback writes `[transferred_to_breeding ...]` marker into `note` column and the UI detects either path. Dashboard: missed-daily list now skips pig batches whose sub-batches are all marked processed (was flagging the parent batch name every day after a final-trip processed everything). |
| 2026-04-25 | `f9ce5be`..`1551e75` | **Equipment math overhaul + fuel-bill module + admin team-member UX rebuild + photo relink.** 19 commits. The day's themes: (1) make the milestone math match how mechanics actually work, (2) ship the bill side of fuel reconciliation, (3) finish wiring the Fuel Supply form's admin into the master team list, (4) close the photo-link gap from the dedup era. **Fuel Supply relocate (Phase 1+2)**: dropped "Direct to equipment" destination, replaced warning copy with Ronnie's wording, fixed Reading/Team gridGap on `/equipment/fuel-log`, moved the form from `/fuel-supply` to a tile on `/fueling` (legacy URL kept as alias), added per-form team-member admin section to `EquipmentWebformsAdmin.jsx`. **Fuel Bills (migration 026 + Phase 3)**: new `fuel_bills` + `fuel_bill_lines` tables, admin-only `fuel-bills` storage bucket, lazy-loaded `pdfjs-dist` for the Home Oil format parser (`src/lib/fuelBillParser.js`), three-tab admin (`Supplies ledger / Bills / Reconciliation`) — bills upload modal walks pdf-text → editable preview → upload + insert; reconciliation groups by `delivery_date` month with variance % vs fuel_supplies. **Every-fillup miss streaks**: per-item yellow-chip warning on `/fueling/<slug>` showing "Not done at last N fillups · oldest <reading>h by <name>". Logic is purely done/not-done across consecutive prior fuelings (no time factor). Pre-deploy audit against current data via `scripts/audit_fillup_streaks.cjs` showed only 7 short streaks fleet-wide (no medium/long, no never-ticked) so shipped without a date cutoff. **Home dashboard rebuilt around actions**: dropped time-based "Outstanding Fuel Checklists" (14d / no-record), built Equipment Attention into a one-row-per-action section: each overdue interval is its own row (no more "+1 more interval" hiding), every-fillup streak summary per piece, warranty rows with manual Clear (only the warranty kind — overdue/streak rows auto-clear when the underlying state resolves). **Snap-to-nearest milestone math** (`src/lib/equipment.js`): full refactor of `computeIntervalStatus` + `computeDueIntervals`. Each completion snaps to the closer milestone; tie favors previous. Handles the 968h-=>-1000h-milestone case Ronnie raised (500hr at 968 was being treated as 468h-late completion of 500 milestone, then immediately overdue at 1000). **Cumulative-partial milestone merge**: shared `aggregateCompletionsByMilestone` helper groups completions by (interval, snapped milestone), takes the union of `items_completed` across all submissions in the group, treats union ≥ task count as virtual full. Solves Ronnie's c362 scenario where 440h had 14/16 + 444h had the missing 2/16 (parts arrival flow). `total_tasks` from current equipment config so historical re-evaluation works after admin task edits. **Divisor cascade fixed**: parent's RAW reading cascades to subs, each sub does its own snap (was over-crediting subs to the parent's snap point — JD-5065 50hr was getting credited to 1800h via 600's snap when it should have been 1600h via raw 1596). **Editable historical checklists**: clicking a sub-task on a prior fueling in `EquipmentDetail.jsx` toggles it in place (optimistic via `fuelingPatches` Map, no `onReload()` so the row doesn't collapse). Same for fillup items. New ✕ Remove button on each interval entry deletes just that one entry without nuking the row's photos/comments/other intervals. **Photo lightbox + per-row chips** on `EquipmentDetail.jsx`: photo thumbnails open a full-screen viewer with prev/next/close (Esc + arrow keys + click backdrop), and every history row shows compact chips: "50h ✓" "200h ◐" "📷 4" alongside notes — instant audit at-a-glance, no click required. **Upcoming Service tile polish**: ascending sort by interval (50 → 100 → 250 → 500 → 600 → 1200), each tile shows "Last done at <raw> · counted as <milestone>" so admin sees the snap reasoning, `until_due` rounded to 1 decimal at source (was showing `40.69999999999999h` from float drift). **Fuel Supply form cleanup**: dropped supplier + cost / total_cost + auto-derive fields (the bill captures financial info; this form just records "fuel not on a checklist"). **Fuel Supply admin team CRUD**: ✕ removes a name from master with cascade across all per-form lists + every `equipment.team_members` array; "+ Add" appends to master alphabetical-sorted. **Two race-condition bugs fixed in admin saves**: (a) read-fresh-then-write pattern — every toggle/add/remove re-reads `webform_config` from DB before upserting to avoid clobbering keys via stale React state. (b) `syncWebformConfig` no longer overwrites `team_members` and `per_form_team_members` — now MERGES the derived per-webform union into the existing stored master (preserves admin-direct adds), and CARRIES OVER any non-webform per-form key (preserves `fuel-supply`). Master is now the canonical list per Ronnie's mental model; per-form is the subset. **Photo relink** (`scripts/patch_relink_photos_by_date.cjs`): re-walks the photo manifest matching by (equipment_id, date) instead of `podio_item_id` (which broke during dedup-then-scrub when winners kept the Fuel Log id but photos were attached to dropped Checklist items). Coverage 48 → **167 fuelings linked / 552 photos**. **Removed Quick Fuel Log tile** from `/fueling` hub (was a checklist-bypass that undercut the streak/accountability system). **Migration applied**: 026_fuel_bills.sql by Ronnie in SQL Editor. **New deps**: `pdfjs-dist` (lazy-loaded, separate ~513KB chunk). **New files**: `src/admin/FuelBillsView.jsx`, `src/admin/FuelReconcileView.jsx`, `src/lib/fuelBillParser.js`, `scripts/audit_fillup_streaks.cjs`, `scripts/patch_relink_photos_by_date.cjs`. |
| 2026-04-24 | `b00f36f`+ | **Podio↔Planner data parity marathon + equipment admin UX + Fuel Log system + manuals/docs buckets.** ~20 commits. Shipped: migration **022** (`equipment.team_members` jsonb + `retired`→`sold` rename), **023** (`equipment.manuals` jsonb, operator-facing), **024** (`fuel_supplies` table w/ public-anon-insert RLS + `equipment_fuelings.suppressed` reserved flag), **025** (`equipment.documents` jsonb, admin-only). `/admin → Equipment` replaced its dropdown with a categorized lined list + Sold section; clicking a piece opens a **full-screen modal** (Esc/backdrop/Close to dismiss) with cards for Identity (slug row hidden), Team Members w/ CRUD over the `webform_config.team_members` master list, **Specs & Fluids** (moved out of `EquipmentDetail.jsx`), Manuals & Videos, Admin Documents, Webform Help Text, Every-fillup Items, Service Intervals, Attachment Checklists. HomeDashboard gained 🔧 EQUIPMENT ATTENTION (overdue services + warranty ≤60d) AND ⛽ OUTSTANDING FUEL CHECKLISTS sections, split out from MISSED DAILY REPORTS. Public `/fueling/<slug>`: team-member dropdown filters to operators assigned on this piece (falls back to master when empty), ManualsCard renders at top with empty-state message, Service Due copy rewrite drops divisor language + adds "Last N-hour checklist done at Xh", **Check Oil required-tick** for non-ATV/Toro (red asterisk + border + submit gate), partial-completion display suppressed when a full has happened since and shows missing-items + team_member when shown, "Every Use" attachments render proper label (was "0h"). New public `/fuel-supply` webform tracks fuel DELIVERED to the farm (cell/can/truck/direct/other) — writes to `fuel_supplies`, never counts as consumption. New `/admin → Fuel Log` tab with YTD + 30-day totals + inline edit/delete. `EquipmentDetail.jsx`: operator chips, "Mark sold" button, ManualsCard, Specs panel removed. Shared header: `📝 Dailys` + `⛽ Fueling` quick-access buttons site-wide. New shared `src/equipment/ManualsCard.jsx` (collapsible, PDFs as amber links + YouTube thumbnail grid). New scripts (all with --commit gating): `audit_equipment_ticks_and_oil.cjs`, `patch_equipment_fillup_ticks.cjs` (570 rows recovered — Podio external_id variants `every-fuel-fill-up` vs `-checklist`), `patch_equipment_operator_notes.cjs` (15 pieces), `patch_ventrac_every_use_attachments.cjs` (3 added, "Every Use" = `hours_or_km:0` sentinel), `patch_dedup_fueling_pairs.cjs` (187 pair merges), `patch_scrub_fuel_log_only.cjs`, `patch_scrub_empty_checklists.cjs`, `patch_restore_missing_checklists.cjs`, `patch_upload_equipment_documents.cjs` (33 PDFs → 27 manuals + 6 documents, filename-classified), `audit_planner_vs_podio_webforms.cjs`, `audit_ventrac_attachments.cjs`. `import_equipment.cjs` gained `--fuelings-only` flag (preserves admin-patched columns), external_id fallback, "Every Use" parsing, fallback match on `(date, reading, team)` when `fuel-log-app` relation missing, `'sold'` instead of `'retired'` in archived seed. Fresh Podio dump pulled mid-session picked up 5 new Fuel Log + 3 new Checklist items; re-import picked them up. Bugs caught: dashboard selected nonexistent `current_hours/current_km` on `equipment_fuelings` (correct columns are `hours_reading/km_reading`); FuelingHub explicit column list missed newly-added `team_members` + `manuals`; dedup didn't update `podio_source_app` label on merged winners, so an early source-based scrub wiped 372 rows including merges (recovered via `--fuelings-only` re-import). **Final parity**: all 15 active pieces match their Podio Checklist-app counts minus 9 genuine Podio-side duplicate submissions (c362 ×2, gehl ×2, honda-atv-1 ×4, ps100 ×1) where operators submitted the same Checklist twice. Netlify hit free-tier build-minutes cap mid-session — Ronnie added credits. HANDOFF_NEXT_SESSION.md fully rewritten with 10 Podio-import pitfalls for when more apps get brought over. |
| 2026-04-23 | `5cd306f`..`3d3d586` | **Equipment polish marathon** — root-cause cleanup of cross-contaminated webforms. The import script was seeding `status='deleted'` fields AND options from Podio's app-config API (the API returns them; the published webform hides them), which is why Honda ATV #1 was showing phantom 300/600/1200-hour *tractor* intervals. Survey found 21 deleted fields + ~400 deleted options spanning all 17 apps. `import_equipment.cjs` seeder + `patch_equipment_intervals.cjs` (targeted re-seed, 15/15 rows rebuilt) filter both. `patch_equipment_completions.cjs` normalized historical `equipment_fuelings.service_intervals_completed` against clean intervals — 98 rows rewritten, 134 stale `total_tasks` clamped, 32 `items_completed` filtered against current task IDs, 2 orphan 200KM completions dropped. Parser: "FIRST X & EVERY Y" → Y only (kills Toro's phantom 75h). HTML entity decode on Podio descriptions. **New help-text surface** surfaced into the webform: `operator_notes` top banner (Gyro-Trac rotor-bearing-every-4h note), `fuel_gallons_help` under gallons input (Toro fuel conditioner spec), `every_fillup_help` above fillup checks (tire pressure), per-interval `help_text` (lugnut torque / spark gap spec / etc.) — migrations 019 + 020. `patch_equipment_help_text.cjs` patches all these in one pass. **Attachment checklists** (migration 021, `attachment_checklists` JSONB) — Ventrac's Tough Cut / AERO-Vator / Landscape Rake checklists previously collided with main 50hr interval and got dedup-dropped; now stored separately and shown as optional sections on the webform, keyed by `name + kind + hours_or_km`. Latent bug squashed: `FuelingHub.jsx` select missed `takes_def` — DEF input never rendered on PS100 / Mini-Ex / Gyro-Trac / C362 webforms. **Admin tab moved** — all webform config editing (intervals, tasks, help text, fillup items, attachments, name, serial, status) extracted from `EquipmentDetail.jsx` into `src/admin/EquipmentWebformsAdmin.jsx`, reached via `/webforms` → new **Equipment** tab. EquipmentDetail is now a pure read view of the piece. Expanded fueling rows now render full checklist content: green pills for every-fillup ticks, per-interval cards with each ticked task as blue pills + N/M count + "full"/"partial" label, photo thumbnail grid. `scripts/inspect_equipment_state.cjs` added for future audits. **Photo pull got rate-limited by Podio** (420 after ~1,080 Fuel Log items, throttled for 3,600s) — `pull_podio_equipment_photos.cjs` needs retry + resume logic next session. |

**How to use this index:** if you need the exact commit message or a specific bugfix commit, run `git log --oneline <date>..` or filter by filename. If you need the narrator's-voice session-end summary, see the matching block in `archive/SESSION_LOG.md`. Git log is the authoritative timeline — this table is just the map.



