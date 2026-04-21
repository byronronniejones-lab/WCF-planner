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
| `batch-documents` | Storage bucket for broiler batch file attachments. |

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

### 5.5 Cattle module

- 4 active herds + 3 outcomes (see `src/lib/cattle.js`):
  - Active: `mommas`, `backgrounders`, `finishers`, `bulls`
  - Outcomes: `processed`, `deceased`, `sold`
- Palette: red family (no purple — Bulls is wine/deep red, outcomes are neutral).
- Breeding timeline constants: `BULL_EXPOSURE_DAYS=65`, `PREG_CHECK_OFFSET=30`, `GESTATION=274`, `CALVING_WINDOW=65`, `NURSING=213`. See `src/lib/cattleBreeding.js`.
- Per-head cost rollup (feed + processing) was deferred from the original module build.
- Podio data imported April 16–17, 2026: 469 cattle, 1,930 weigh-ins, 1,525 daily reports. Fresh exports pending.
- All cattle data lives in dedicated tables (`cattle`, `cattle_dailys`, `cattle_feed_inputs`, `cattle_calving_records`, `cattle_processing_batches`, `cattle_feed_tests`, `cattle_comments`) — NOT `app_store`. See §Part 2 Decision 5.
- DNA test PDF parser: manual entry is the workaround for v1.

### 5.6 Sheep module

- Parallel structure to cattle but with sheep terminology (flock / ewe / ram / wether / lambing).
- Phase 1 shipped April 18: directory, flat/tile modes, add/edit/delete/transfer, inline detail, bulk import, dailys + weigh-ins. No nutrition targets (Phase 2).
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

---

## 8. Open items / roadmap

### Near-term (known & actionable)

- **Per-view state internalization** (optional polish, parked 2026-04-21). ~40 `useState` hooks in App's body are view-local state that belongs inside the view component. Right approach: push each block INTO the view that uses it (webforms-admin state → `WebformsAdminView`; feed state → shared `FeedUIContext`; auto-save refs → per-context). Regressions only surface at runtime, so it needs the bare-name audit pattern (see §Part 3) and careful per-view verification. Estimated 5–7 commits.
- **Podio cattle re-import.** Awaiting a fresh export from Ronnie once the public webforms have been live in the field for ≥1 day.
- **Per-head cattle cost rollup.** Feed cost (from `cattle_dailys.feeds[].lbs_as_fed × landed_per_lb`) + processing cost (from `cattle_processing_batches`) per cow with attribution rules. Not blocking ops.
- **Send-to-trip wiring on pig weigh-ins.** Pigs aren't tagged; Trip view should pull recent session entries by checkbox.
- **Feed system physical count verification.** The adjustment calculation (system estimate vs actual count) needs real-world validation. Code reviewed for edge cases.

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
- **Equipment module.** Currently a placeholder stub at `/equipment`.
- **Sheep module Phase 2** — nutrition targets, Podio sheep import, retag flow.

### Known gotchas (watch for these)

- **The `housingBatchMap` shape** was not directly SQL-verified during the Add Feed design. Existing code treats it as `{housingName: batchName}` (flat object). If layer `batch_id` resolution misbehaves at runtime, that's the first place to look.
- **The `source` column** on dailys tables is nullable. Filter logic: `r.source !== 'add_feed_webform'` handles null correctly (returns true). No null guard needed.
- **Historical B-24-* broiler batches** use legacy manual feed fields. B-25+ batches pull from dailys. Don't unify these without backfilling the older data.
