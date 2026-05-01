# WCF Planner

**Farm-management web app for White Creek Farm.** Owner + admin: Ronnie Jones. Live at [https://wcfplanner.com](https://wcfplanner.com).

Started as a single-file ~19,445-line `index.html` using Babel-in-browser. Over April 19–21, 2026 it was migrated to a Vite build with 54+ extracted components under `src/`, 14 feature-scoped libs, 10 React Contexts, and per-tab URLs via a React Router adapter. Production serves the Vite bundle from branch `main`. This doc is the living reference; for per-session narrative history see [`archive/SESSION_LOG.md`](archive/SESSION_LOG.md).

**Last consolidated:** 2026-04-21 session 3 (post-polish cutover). **Last session-index update:** 2026-04-29 (Initiative C through Phase 1C-C WeighIns RPC precursor).

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

### Migration layout (since 2026-04-27)

`supabase-migrations/` shows only new/upcoming migrations awaiting application. Migrations 001–026 (already applied to production) live in `supabase-migrations/archive/` along with a README explaining the move. References to migration numbers in this doc + inline source comments still resolve conceptually — find files by number under `archive/`. New migrations always land at the parent path; archive happens later, optionally, in cleanup commits.

2026-04-27 batch:
- `027_weigh_ins_prior_herd_or_flock.sql` — revert anchor for cattle/sheep Send-to-Processor flow
- `028_sheep_processing_batches.sql` — mirrors `cattle_processing_batches`
- `029_sheep_transfers.sql` — append-only flock-change audit log

### Hand-created prod tables (not in any migration)

Nine tables exist in production but were created by hand in the Supabase dashboard (or via Supabase auth templates) before any migration in this repo was written. No `.sql` file creates them. Discovered 2026-04-28 while scaffolding the Playwright test harness — the bootstrap bundle for a fresh test project must seed these explicitly (see `scripts/build_test_bootstrap.js` → `hand_created_tables_seed` block) before any migration that ALTERs them (e.g. mig 008 ALTER profiles, mig 011 UPDATE webform_config) can run.

Affected: `profiles`, `app_store`, `webform_config`, `poultry_dailys`, `layer_dailys`, `egg_dailys`, `pig_dailys`, `layer_batches`, `layer_housings`. Schemas captured from prod via `information_schema.columns`. If any of these schemas drift on prod, the bootstrap bundle stays stale until regenerated against the new shape.

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
| `task_templates`, `task_instances`, `task_cron_runs` | Tasks Module v1 Phase A (migs 036-038, shipped 2026-05-01). Schema + RLS + private task photo bucket only; no UI/RPC/cron consumers yet. Templates are admin-only. Instances are admin-all plus assignee SELECT-own. Cron runs are admin SELECT only and service-role append-only. |
| `batch-documents` | Storage bucket for broiler batch file attachments. |
| `equipment-maintenance-docs` | Storage bucket for equipment manuals + documents + fueling photos. Public bucket (anon read), authenticated/anon write per the policies in migrations 016 + 018. |
| `fuel-bills` | Storage bucket for uploaded supplier invoices. `public:false` — authenticated-only via 10-min signed URLs from the admin Bills view. |
| `task-photos` | Private bucket from mig 038. Present from Phase A, but Ronnie later removed required-photo support from Tasks v1; do not make any task require a photo. Optional completion photos, if kept, need a fresh Phase D decision. |

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
| `broiler_batch_meta` | Active broiler batch metadata for public WeighIns schooner labels. Canonical public source; never read `app_store.ppp-v4` from the public broiler form. |
| `active_groups` | Active pig group names (string array) |
| `team_roster` | Canonical team roster: `[{id, name}]`. Sole writer is the central Webforms admin roster editor. |
| `team_members` | Legacy all-names mirror (`string[]`) kept for old readers. Written atomically by the roster helper, not by public forms. |
| `team_availability` | Per-public-form hidden roster IDs. Empty/missing means every roster member is visible for that form. |
| `per_form_team_members` | _Retired 2026-04-29._ Per-form filtering eliminated; existing rows preserved (no destructive op) but no longer read or written. See §7 `team_roster` entry. |
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
    <BatchesProvider formInit={EMPTY_FORM}>
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
| `dateUtils.js` | `addDays`, `toISO`, `fmt`, `fmtS`, `todayISO` |
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

**Transfer-to-Breeding flow (admin weigh-ins → breeders registry)** — rewritten 2026-04-27:
- `LivestockWeighInsView.jsx` → per-row **→ Breeding** button on pig sessions opens a modal: New tag, Group, Sex, Birth date (auto session date − 6 mo). No feed input — auto-computed.
- `feedAllocationLbs = pig.weight × FCR`. FCR resolves via `parent.fcrCached` (now populated by `computePigBatchFCR` in `src/lib/pig.js` on every trip add/edit/delete) → industry default `3.5` when no valid trips yet.
- On confirm: inserts breeders entry (`transferredFromBatch: {batchName, subBatchName, transferDate, feedAllocationLbs, fcrUsed, sourceWeighInId}`) and accumulates `parent.feedAllocatedToTransfers`. **Started counts (giltCount/boarCount/originalPigCount on parent + sub) are NOT mutated** — they record what entered the batch. Transfer events live in the breeders[] audit log; "current" pig count is derived ledger-style on display.
- **Dup guard**: pre-insert check skips when an existing breeder already references the same `sourceWeighInId`.
- **Migration 014** adds `weigh_ins.transferred_to_breeding`, `transfer_breeder_id`, `feed_allocation_lbs` columns. Pre-migration fallback writes `[transferred_to_breeding breeder=ID feed_alloc=N lb] <note>` marker into `weigh_ins.note`.
- **Undo Transfer**: drops breeder by `transfer_breeder_id` (or note marker), reverses `feedAllocatedToTransfers`, clears weigh-in stamp + strips note marker. Started counts stay untouched (symmetric with attach).
- **Breeding pig tile** (`SowsView.jsx`): transferred sows show banner `This gilt was saved from <subBatch> on <date>.` (word adapts: gilt/sow/boar).

**Pig batch accounting model (rewritten 2026-04-27, see commit `3fab65d` and predecessors)**:
- **Started counts** are authoritative. Sub-batches are **partitions** of their parent — sum of subs.giltCount === parent.giltCount and same for boars. Sub-batches are single-sex (Add Sub-batch modal has Gilts/Boars selector + single count). Edit Sub-batch is rename-only; counts read-only. Parent batch modal has a "Distribute across sub-batches" section with sex-specific sum-vs-parent validation.
- **Current = ledger-derived**: `started − Σ(trip pigs attributed via subAttributions) − Σ(transfers from breeders[]) − Σ(mortality)`. Status='processed' override forces 0. Diagnostic chip when latest daily count diverges from ledger by >2.
- **Adjusted feed = raw feed − transfer credits**, where credits are sourced per-sub from `breeders[].transferredFromBatch.subBatchName + feedAllocationLbs` (not the parent-aggregate `feedAllocatedToTransfers`). Sum-of-subs reconciles to parent within rounding.
- **Lbs/pig denominator = finishers (started − transferred − mortality)**, NOT started. Numerator is adjusted feed. Mixing the two frames produced the 1644 vs 1186 lbs/pig bug on P-26-01A.
- **Trips originate from weigh-ins via Send-to-Trip only.** "+ Add Trip" was removed from PigBatchesView. Each trip carries `subAttributions: [{subId, subBatchName, sex, count}]` so the ledger can attribute trip pigs to specific subs.
- **First-load reconcile** in `reconcileFeederGroupsFromBreeders` (`src/lib/pig.js`) enforces only the deterministic invariant `sub.originalPigCount === sub.giltCount + sub.boarCount` when sex sums already match parent. Mismatches are skipped with a console warning — admin resolves via the partition UI (no silent redistribute).
- **Recompute scope** (intentional limit): FCR cache refreshes only on trip add/edit/delete. Daily-feed and transfer-credit changes don't refresh the cache mid-cycle; the ratio updates organically on the next trip write. Acceptable per the scoped roadmap item.

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
- **Processing batch flow (rewritten 2026-04-27):** admin creates an empty batch shell on `/cattle/batches`; cattle enter and leave a batch ONLY via the `send_to_processor` flag on a finishers weigh-in entry. No manual cow attach in the batch view (multi-select + "+ Add cow from finishers" dropdown removed). Clearing the flag, deleting the entry, deleting the session, or deleting the batch all detach attached cows and revert their herd via the `weigh_ins.prior_herd_or_flock` → `cattle_transfers` audit fallback hierarchy. Detach blocks with admin warning if no prior herd is recorded (no silent default). See §7 + `src/lib/cattleProcessingBatch.js`.
- DNA test PDF parser: manual entry is the workaround for v1.

### 5.6 Sheep module

- Parallel structure to cattle but with sheep terminology (flock / ewe / ram / wether / lambing).
- 3 active flocks + 3 outcomes: Active `rams`, `ewes`, `feeders`; Outcomes `processed`, `deceased`, `sold`.
- Phase 1 UI shipped April 18: directory, flat/tile modes, add/edit/delete/transfer, inline detail, bulk import, dailys + weigh-ins. No nutrition targets (Phase 2).
- **Podio data imported 2026-04-21:** 67 Podio sheep + 18 newly-purchased lambs (Willie Nisewonger, $275/each, KATAHDIN, DOB 2026-01-01, tags `RAM 001`–`RAM 008` + `EWE 001`–`EWE 010`, all in `ewes` flock pending weigh-in retag). Also 26 synthesized lambing records, 6 historical weigh-in sessions (34 weigh-ins), and 639 `sheep_dailys` (3 null-date rows skipped). The planner is now the sole source of truth for sheep — no further Podio sheep import planned.
- Migration 009 (sheep schema) had been drafted pre-import but was never applied to Supabase until 2026-04-21. Migration 010 extended `weigh_in_sessions.species` CHECK to include `'sheep'` (mig 009 originally assumed the CHECK already allowed it). Both applied that day.
- Sheep-specific daily fields: bales of hay, alfalfa lbs, minerals given + % eaten, fence voltage kV, waterers working.
- **Processing batch flow (added 2026-04-27, mirrors cattle):** `/sheep/batches` view + `+ New Batch` empty shell + per-row × detach + Delete-batch loop with revert. Migrations 028 (`sheep_processing_batches`) + 029 (`sheep_transfers` append-only audit) installed in the same session. `src/lib/sheepProcessingBatch.js` mirrors the cattle helpers; `SheepSendToProcessorModal` triggers from session-complete on `/sheep/weighins` AND the public `/weighins` webform. SheepHome has a Processing Batches tile.
- **Sheep weigh-in feature parity (added 2026-04-27):** SheepWeighInsView rewritten 185 → ~390 lines to match CattleWeighInsView. `SheepNewWeighInModal` for session create. Status filter (all / draft / complete) + tag search + Edit / Delete per entry + Swap Tag + Missing Tag + reconcile-new-tag + Send-to-Processor toggle + ADG vs prior completed session. Send-to-Processor gate is intentionally LOOSER than cattle's: any draft session, any flock (cattle stays finishers-only). `SheepFlocksView.transferSheep` writes a `sheep_transfers` audit row.

### 5.7 Daily reports / webforms

- Public webforms at `/webforms`, `/addfeed`, `/weighins` (no auth required).
- Programs: Broiler, Layer, Pig, Egg, Cattle daily reports. Plus the legacy pig-dailys form at `/webform` (extracted to `src/webforms/PigDailysWebform.jsx` in the 2026-04-21 polish).
- Team-member dropdowns read the master roster (`webform_config.team_roster`, legacy `team_members` mirror); per-form filtering retired 2026-04-29. Admin-configurable required/optional fields.
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
- **`fuel_supplies` table ≠ `equipment_fuelings` table — and consumption combines them.** `equipment_fuelings` holds per-piece fueling-checklist rows (fuel pulled from the cell into a specific piece of equipment, recorded at `/fueling/<slug>`). `fuel_supplies` holds anything dispensed at `/fueling/supply` — the `destination` field discriminates: `gas_can` / `farm_truck` / `other` are CONSUMPTION (fuel leaving the cell into a non-equipment target); `cell` is INVENTORY MOVEMENT (fuel going INTO the portable cell from a supplier delivery — same event a `fuel_bills` row covers). Total consumption math for reconciliation = `SUM(equipment_fuelings.gallons WHERE NOT suppressed)` + `SUM(fuel_supplies.gallons WHERE destination != 'cell')`. DEF on equipment_fuelings is in a separate `def_gallons` column (added during a fillup) — aggregate it independently of `gallons`+`fuel_type`. NEVER count `cell`-destination supply rows as consumption — they double up against bills, which already capture the same delivery.
- **FuelingHub.jsx enumerates equipment columns explicitly** — when adding a new column to `equipment`, also add it to `FuelingHub.jsx:19`'s select list, or the public `/fueling/<slug>` webform won't see the new field. Same rule for `HomeDashboard.jsx` equipment fetch. Always grep `from('equipment')` across `src/` after a migration.
- **Dedup-then-scrub ordering is a trap.** `scripts/patch_dedup_fueling_pairs.cjs` merges winner data but keeps the winner's original `podio_source_app` label. If you then run `scripts/patch_scrub_fuel_log_only.cjs` (deletes by `podio_source_app='fuel_log'`), you destroy merged rows that carry checklist data. Either (a) update source labels in dedup, (b) scrub by content criteria via `scripts/patch_scrub_empty_checklists.cjs`, or (c) always re-import via `import_equipment.cjs --fuelings-only` before scrubbing by source.
- **`import_equipment.cjs --fuelings-only` flag.** Use this for every post-launch re-import. Full-import form wipes admin-patched fields on the `equipment` table (operator_notes, team_members, manuals, documents, attachment_checklists adjustments, hand-edited fluid specs). Full-import is only correct on a clean-slate initial seed.
- **Podio-side duplicate submissions are real.** Operators sometimes submit the same Checklist twice within 24-48 hours. Known pairs as of 2026-04-24: c362 ×2, gehl ×2, honda-atv-1 ×4, ps100 ×1. Planner collapses to 1 row per unique (date, reading, team) via fallback match. Raw Podio counts ≥ planner counts for those pieces — that's correct, not a bug.
- **Snap-to-nearest milestone semantics for service intervals** (`src/lib/equipment.js` `snapToNearestMilestone` + `aggregateCompletionsByMilestone`). Every full completion at reading R for interval I snaps to whichever milestone (multiple of I) is closer. Tie-break favors the previous milestone (treat as late completion of prior). Next-due = snapped milestone + I. Don't revert to floor-based math — it caused the "500hr at 968h flagged overdue at 1000h" bug. Divisor cascade uses parent's RAW reading, NOT parent's snapped milestone — each sub-interval does its own independent snap. (Cascading the parent's snap would over-credit subs — 600hr at 1596 snapping to 1800 would falsely satisfy 50hr's 1700/1750/1800.)
- **Cumulative-partial milestone model** (`aggregateCompletionsByMilestone`). All completions (full + partial) for a given interval are grouped by their snapped milestone. Within each group, the UNION of `items_completed` is what counts. If union ≥ task count, the milestone is virtually-fully-satisfied even when no single submission was full. This handles real-world maintenance flow where work spans multiple sessions (e.g. 500hr partial at 440h with 14/16 done + 500hr partial at 444h with the missing 2/16 = full coverage of the 500h milestone). `total_tasks` is read from CURRENT equipment config so admin task edits re-evaluate history correctly. Don't switch to "latest single completion wins" — Ronnie depends on this for parts-arrival workflows.
- **`syncWebformConfig` no longer touches team-member keys** (superseded 2026-04-29 by the `team_roster` cleanup — see entry below). The merge-vs-replace contract that previously lived here was retired alongside `per_form_team_members` + `weighins_team_members` writes. Master roster reads/writes go through `saveRoster`/`loadRoster` in `src/lib/teamMembers.js`. Don't reintroduce derived-union writes from this path.
- **Read-fresh-then-write for `webform_config` jsonb keys.** Any caller that edits a JSONB-valued row in `webform_config` must re-fetch the latest `data` from the DB right before its upsert and merge against fresh state, NEVER trust local React state alone. The upsert overwrites the entire `data` field, so concurrent toggles' setState effects may not have landed and stale-state writes silently drop other keys' edits. `saveRoster` in `src/lib/teamMembers.js` is the canonical implementation of this pattern (read-fresh-then-merge by id, with a documented first-canonical-save shortcut to avoid duplicating legacy names). Any future JSONB-key editor on `webform_config` (or any similar wide-jsonb store) follows the same pattern.
- **`fuel_bills` + `fuel_bill_lines` are admin-only.** Migration 026. RLS = authenticated SELECT/INSERT/UPDATE/DELETE. The `fuel-bills` storage bucket is `public:false` — signed URLs only (10-min expiry via the BillDetail PdfLink component). Don't add anon access; bills carry financial info.
- **Tax allocation depends on the bill format detected in `parseFuelBillText`.** Home Oil prints the literal phrase `Tax and Other Charges Included in Price` above its tax block — the unit_price column is already the all-in (post-tax) $/gal, and the tax block is informational. For these bills the parser sets `allocated_tax = 0`, `line_total = line_subtotal`, and `effective_per_gal = unit_price`; sum of line_totals matches the invoice total, so reconciliation cost is correct. For tax-EXCLUSIVE bill formats (no "Included in Price" tag), the parser falls back to additive allocation: `allocated_tax = (net_units / total_gallons) * tax_total`, `line_total = line_subtotal + allocated_tax`. Header `subtotal` is derived as `total − tax_total` for tax-included bills (a true pre-tax figure) and stays as `sum(line_subtotal)` for tax-exclusive bills. Don't revert the format detection — without it, Home Oil bills double-count tax (~9% over-statement on every line and on monthly reconciliation cost).
- **`weigh_ins.prior_herd_or_flock` semantics (mig 027).** Stamped at attach time with the animal's herd (cattle) or flock (sheep) BEFORE the move to `'processed'`, AND ONLY when transitioning non-processed → processed. The detach helper reads it first to revert. Multi-batch reattach must NOT capture `'processed'` as the prior state. On detach, BOTH `target_processing_batch_id` AND `send_to_processor` are cleared on every matching `weigh_ins` row (the second clear was a fix in commit `448152e` after the per-row × on the batch view left orphan flag chips).
- **Detach fallback hierarchy (cattle + sheep).** `detachCowFromBatch` / `detachSheepFromBatch` resolve prior herd/flock via: (1) `weigh_ins.prior_herd_or_flock` for the entry that attached this animal, (2) most recent `cattle_transfers` / `sheep_transfers` row with `reason='processing_batch' AND reference_id=batchId`, use `from_herd`/`from_flock`, (3) BLOCK with `reason:'no_prior_herd'` / `'no_prior_flock'` — never silently default. Callers surface the block to admin.
- **`cattle_transfers` + `sheep_transfers` are append-only audit logs.** RLS allows authenticated INSERT + SELECT only — no UPDATE/DELETE policies. Reversal events go in as new rows with `reason='processing_batch_undo'`.
- **Cattle/sheep batch membership rule.** Animals enter `cattle_processing_batches` / `sheep_processing_batches` ONLY via the `send_to_processor` flag on a finishers (cattle) or any-flock (sheep) weigh-in entry, then through the SendToProcessor modal at session-complete time. There is no manual cow/sheep multi-select on the batch modal anymore. The batch view's per-row × button calls the detach helper; Delete-batch loops detach over every row with success/failure reporting (Codex Edge Case #2). The cattle gate stays strict (finishers-only); sheep gate is intentionally looser per Ronnie's request — any draft session, any flock.
- **`processingTrips[].subAttributions` schema** = `[{subId, subBatchName, sex, count}]`. `subBatchName` and `sex` are denormalized for readability + future-proofing (per Codex review). Send-to-Trip in `LivestockWeighInsView` stamps these on every trip; the cattle/sheep send-to-processor flows do equivalent stamping. Legacy P-26-01 trips were patched via `scripts/patch_p26_01_trip_attributions.cjs --commit`.
- **`parent.fcrCached` clear-on-null contract.** `computePigBatchFCR` returns null when no valid trips remain or rawFeed ≤ credits. Both `persistTrip` and `deleteTrip` MUST `delete next.fcrCached` (not leave the previous value) when the helper returns null, so the transfer flow's `parent.fcrCached || 3.5` falls back to default rather than a stale ratio.
- **Photo→fueling matching falls back to `(equipment_id, date)`.** Original `pull_podio_equipment_photos.cjs --upload` matched only by `podio_item_id`. After the dedup-then-scrub flow merged Fuel Log + Checklist pairs (keeping Fuel Log's `podio_item_id`), photos attached to the now-deleted Checklist items lost their match — only 48 of 195 unique manifest items linked. `scripts/patch_relink_photos_by_date.cjs` reads each photo entry's date from the Podio item dump and matches by (equipment_id, date) instead. Brought coverage from 48 → 167 fuelings linked (552 photos). When importing future Podio apps with similar dedup pressure, prefer date-matching for the link step.
- **`daily-photos` storage bucket is private; reads via signed URLs only** (migration 031, 2026-04-28 eve queue). New bucket for daily-report photos: `public:false` on creation. Two policies on `storage.objects` scoped to `bucket_id='daily-photos'`: `daily_photos_anon_insert` (write-only, with `bucket_id` check) + `daily_photos_auth_select` (authenticated read). Zero anon SELECT, zero anon/authenticated UPDATE or DELETE. App code stores the storage path in the daily-report row's `photos` jsonb and renders via signed URL when an authenticated admin views the row. Don't add a `publicUrl` path — it would silently fail anyway because the bucket is private, but more importantly the manuals-vs-documents principle (§7 above on `equipment.manuals` operator-facing vs `equipment.documents` admin-only) extends to operator-context photos that may capture animal welfare context, employee identities, or other content that shouldn't be public-readable like equipment manuals are. Bucket scope split: `equipment-maintenance-docs` (public-readable, equipment manuals + admin docs + equipment fueling photos) ≠ `daily-photos` (private, daily-report uploads).
- **`client_submission_id` is the queue idempotency key on 9 webform-target tables** (migration 030, 2026-04-28 eve queue). Nullable text + non-partial unique index on each of: `pig_dailys`, `poultry_dailys`, `layer_dailys`, `cattle_dailys`, `sheep_dailys`, `weigh_in_sessions`, `weigh_ins`, `equipment_fuelings`, `fuel_supplies`. Index has NO `WHERE … IS NOT NULL` predicate — Postgres NULLS DISTINCT keeps multiple legacy null rows valid without one. **Anon webforms must use plain `.insert(record)` and treat code 23505 referencing `*_client_submission_id_uq` as already-synced, NOT `.upsert(record, {onConflict: 'client_submission_id', ignoreDuplicates: true})`** (Phase 1B canary, 2026-04-29). The original Phase 1A plan called for upsert+ignoreDuplicates but PostgREST's `ON CONFLICT` path requires SELECT privilege on the conflict-target column, and the public webform tables (fuel_supplies / weigh_ins / weigh_in_sessions / equipment_fuelings) grant anon INSERT only — anon upsert returns 42501 (RLS denial) every time. The unique index alone gives the same dedup guarantee under plain insert. Authenticated callers (admin tools, server-side scripts) can still upsert because authenticated has the full RLS surface. Validation gate: when adding a new form_kind, run a Playwright spec that double-submits the same csid as anon and asserts (a) the first row lands, (b) the second raises 23505 with `client_submission_id` in the message, (c) DB row count stays at 1. The dedup spec at `tests/offline_queue_dedup.spec.js` is the template.
- **3 hand-created prod tables (`pig_dailys`, `poultry_dailys`, `layer_dailys`) likely have RLS disabled in prod.** They appeared in PROJECT.md §3 as hand-created; Ronnie's pg_policies dashboard export (2026-04-28 eve+) confirmed they have NO policies — none exist for those tables. The public webforms write to them anonymously and it works because RLS isn't enforced (RLS-disabled = everyone has access regardless of policies). **Don't ENABLE RLS on these tables without first establishing INSERT policies for the anon/public role** — doing so would break AddFeedWebform and PigDailysWebform on the next deploy. If a future build needs RLS on these tables (e.g. for tenancy isolation), it must come paired with policy creation in the same migration.
- **Team-member master roster: `webform_config.team_roster` is canonical; `webform_config.team_members` is the legacy all-names mirror** (Team Member Master List Cleanup, 2026-04-29; revised the same day for hard-delete + per-form availability filters). Canonical shape going forward is `[{id, name}]` with stable random `tm-${uuid}` IDs minted at first registration; names are editable display text and may change without affecting the id. **Legacy `[{id, name, active: false}]` entries are passively dropped by `normalizeRoster` on read** — they vanish from public dropdowns and from the next canonical write. Legacy `team_members: string[]` is preserved indefinitely as the all-names mirror so unmigrated readers keep working — `loadRoster(sb)` in `src/lib/teamMembers.js` reads canonical first, falls back to legacy, and normalizes both shapes to the canonical object[]. **The central admin editor (`TeamRosterEditor` inside `WebformsAdminView`) is the ONLY writer of either key.** It calls `saveRoster(sb, next)` which read-fresh-then-merges by id (concurrent admin tabs preserve each other's changes) and writes both keys atomically (mirror is `merged.map(name)` — every roster name, no active filter). Public-form code paths NEVER write the roster — they only read via `loadRoster` and render `activeNames(roster)`. Retired in prior 2026-04-29 cleanup: per-form team-member filtering (`webform_config.per_form_team_members`), per-species weigh-ins filtering (`webform_config.weighins_team_members`), and the per-piece master add/remove on `EquipmentWebformsAdmin.TeamMembersEditor` (kept as display-only assignment toggle). **Active/inactive (soft-delete) UX retired the same day.** Hard delete via `removeMember` + the coordinated cascade (see entry below) is the only removal path. The "temporarily inactive worker" workflow is intentionally gone — admins re-add a returning worker as a new entry; the new id ensures availability hide-state and equipment assignments don't bleed across the gap. **Coordinated delete order (load-bearing): clean `team_availability` hiddenIds for the deleted id → cascade-remove the deleted name from every `equipment.team_members` array → `saveRoster` LAST.** If any pre-roster step fails, the roster entry stays put so the admin still has a UI handle to retry; `removeRosterMemberCoordinated`-style code in `WebformsAdminView` surfaces a per-step error banner. Idempotency: each cleanup step is safe to re-run (availability cleanup is purely subtractive; equipment cascade pre-fetches by `.contains([name])` so already-cleaned rows skip naturally; saveRoster's read-fresh-then-merge handles already-removed ids). `equipment.team_members` (per-piece operator assignment) stays as a CONCEPT — only the deleted name's references are scrubbed; remaining names on each row are untouched. Historical `*_dailys.team_member`, `weigh_ins.team_member`, `equipment_fuelings.team_member`, `fuel_supplies.team_member` rows keep storing display-name strings — **NEVER rewrite history.** New submissions still write `team_member: name` strings (compat with everything that has ever written there). Tasks (queued build) will assign to `profiles.id`, NOT roster IDs — different identity space.
- **Team-member per-form availability: `webform_config.team_availability` is a sibling key to `team_roster`** (added 2026-04-29). Shape: `{forms: {<formKey>: {hiddenIds: [<rosterId>, ...]}}}`. Empty / missing formKey = every active roster member visible. Stable roster IDs are referenced (not names) — renames preserve hide state; same-name re-add (delete + add) does NOT inherit prior hide state because the new id differs. Form keys (8 total): `cattle-dailys`, `sheep-dailys`, `pig-dailys`, `broiler-dailys`, `layer-dailys`, `egg-dailys`, `fuel-supply`, `weigh-ins`. **Sole writer is `TeamAvailabilityEditor` inside `WebformsAdminView`.** Public-form code paths only read via `loadAvailability` + `availableNamesFor(formKey, roster, availability)` (helper module `src/lib/teamAvailability.js`). `saveAvailability(sb, next)` follows the read-fresh-then-merge pattern (per-formKey local-wins; concurrent admin work on a different formKey preserved). Orphan IDs in `hiddenIds` (no longer in roster) are tolerated — `availableNamesFor` filters by id intersection, so stale ids are no-ops. Active cleanup happens at delete time via `cleanAvailabilityForDeletedId` (see the team_roster delete cascade above) — hygiene, not correctness. Per-piece `equipment.team_members` is a separate filter, NOT folded into this system. AddFeed webform is intentionally NOT wired to availability (out of scope for this build).
- **`submit_weigh_in_session_batch` RPC** (mig 035, added 2026-04-29 as Phase 1C-C DB precursor). Lets future offline-queue code create one `weigh_in_sessions` parent + N `weigh_ins` children atomically per operator submission. **No new parent table** — `weigh_in_sessions` already IS the natural parent (mig 001) and got `client_submission_id` from mig 030. **v1 species allowlist enforced inside the function:** `pig` and `broiler` only. `cattle` / `sheep` rejected with explicit RAISE — those have side-effect-heavy completion/processor/retag flows that need their own design (deferred). **v1 status allowlist:** `'draft'` only. Completion stays online-only — the runtime form's `finalizeSession` + `writeBroilerBatchAvg` paths are out of scope for the RPC. **Required fields with explicit RAISE before insert** (clear messages, not generic constraint errors): `client_submission_id`, `id`, `species` ∈ allowlist, `status='draft'`, `date`, `team_member`, `entries_in` non-empty, plus `broiler_week` ∈ {4, 6} for `species='broiler'`. **Zero-entry rejection** is deliberate — avoids accidental offline submits creating empty draft sessions on prod replay. **`broiler_week` for `species='pig'` is ignored** (coerced to NULL on insert) so a future caller doesn't accidentally taint pig sessions with a stale week value. **Side-effect columns NOT written by this RPC** (deliberate — runtime concerns deferred): `weigh_ins.transferred_to_breeding`/`transfer_breeder_id`/`feed_allocation_lbs` (pig Transfer-to-Breeding), `weigh_ins.prior_herd_or_flock` (cattle/sheep processor flow), `weigh_ins.send_to_processor`/`target_processing_batch_id` (cattle/sheep processor), `weigh_ins.sent_to_trip_id` (pig Send-to-Trip). Future runtime cutover that needs those must extend the RPC + tests, NOT bypass it. **Race-safe idempotency** via `INSERT … ON CONFLICT (client_submission_id) DO NOTHING RETURNING + fallback SELECT` — same pattern as mig 034, no 23505 surfaces to the caller. Tagged dollar-quote `$weigh_in_session_batch$`. **Children carry NULL `client_submission_id`** — parent owns dedup. Mig 030's unique index on `weigh_ins.client_submission_id` would 23505 on entry #2 if the parent's csid bled through; locked by `tests/weigh_in_session_batch_rpc.spec.js` Test 4. Why NULL is safe: the RPC is atomic at the parent level; replay short-circuits BEFORE the FOR loop runs (function exits on `idempotent_replay: true`), so children are never re-inserted. Per-entry deterministic csids would only matter for partial-child replay (e.g., adding entries to an existing session post-creation) — that's deferred to a v2 RPC if/when needed. **No new RLS policies** — `weigh_in_sessions` and `weigh_ins` already have anon SELECT/INSERT/UPDATE policies (mig 001) and this build did not broaden or narrow them; the RPC is just an additional anon-callable surface (`EXECUTE` granted to anon + authenticated). **Returns** `{session_id, entry_count, idempotent_replay}`. **Runtime wiring landed 2026-04-30 in Phase 1C-D (commit `93e0911`):** `WeighInsWebform.jsx` routes pig + broiler **fresh draft session creation** through `useOfflineRpcSubmit('weigh_in_session_batch')`. Cattle/sheep paths and the entire completion flow (`finalizeSession` + `writeBroilerBatchAvg`) stay online-direct and untouched. State machine via `sessionIsFresh`: `startNewSession` for pig/broiler skips the DB INSERT; per-entry pig writes / broiler grid writes stay local-only until the operator hits Save Draft / Save Weights, which fires the RPC. On `state='synced'`, `sessionIsFresh` flips false, `session.id` becomes `parent_in.id`, entry IDs swap to `record.args.entries_in[i].id`, operator stays on the session screen so the existing online Complete path still works (no double-mint risk). On `state='queued'`, terminal "Saved on this device" screen. Schema/P0001 throws surface inline with no enqueue. The classifier in `useOfflineRpcSubmit._classifyError` treats SQLSTATE P0001 as schema-class on both status-known and codeless branches — without that, mig 034/035 RAISE EXCEPTIONs would burn retry budget. Future builds extending the RPC v1 surface (cattle/sheep, completion side effects, photos, etc.) MUST extend the RPC + tests, not bypass it.
- **Public broiler WeighIns reads `webform_config.broiler_batch_meta`; never `app_store.ppp-v4`** (added 2026-04-30, commits `ca57de7` + `ee01bc3`). Anon SELECT on `app_store` is blocked under prod RLS — the public broiler weigh-in form previously fell through to a `(no schooner)` literal column when the read returned null. Fix routes the public form through a sibling webform_config key. **Single source of truth helper:** `src/lib/broilerBatchMeta.js` exports `splitSchooners(raw)`, `buildBroilerPublicMirror(batchRows)`, and `deriveBroilerColumnLabels(meta, batchId)`. **Filter contract:** `status === 'active'` (active-only; planned/archived/processed all dropped — Ronnie's call after a planned batch surfaced live in the public dropdown). **Both** `webform_config.broiler_groups` (string[] of names) **and** `webform_config.broiler_batch_meta` (Array<{name, schooners: string[]}>) are derived together via `buildBroilerPublicMirror` at both writer sites in `main.jsx` (the app-load block and `syncWebformConfig`'s Promise.all). They cannot drift. **Schooner-string convention** (per `src/lib/broiler.js` `SCHOONERS = ['1','2&3','4&5','6&6A','7&7A']`): bare numeric labels joined by `&` with no spaces (e.g. `'2&3'`). The grid renders `'Schooner ' + label` and `saveBatch` writes the bare label into `weigh_ins.tag` so admin's `LivestockWeighInsView.hydrateGrid` (`e.tag === label`) matches. **No fallbacks:** `deriveBroilerColumnLabels` returns `[]` when the batch is missing OR has empty schooners; `WeighInsWebform.jsx` blocks `startNewSession` AND `resumeSession` with explicit `"This batch has no schooners assigned. Ask admin to set schooners on the batch before weighing."` copy when labels resolve empty. The previous `(no schooner)` and `['1','2']` escape hatches are gone. **Done-screen UX:** the public broiler queued-terminal AND online-done CTAs hide the "New Weigh-In" button (cattle/sheep/pig keep it). **Static lock:** `tests/static/weighinswebform_no_app_store.test.js` asserts `src/webforms/WeighInsWebform.jsx` contains zero `app_store` / `ppp-v4` literals. **Network lock:** the public broiler flow makes ZERO `/rest/v1/app_store?key=eq.ppp-v4` requests (Playwright `T_negative` in `tests/broiler_weigh_in_schooners.spec.js`). Admin-side `LivestockWeighInsView` keeps reading `app_store.ppp-v4` directly under authenticated RLS — that path is intentionally unchanged.
- **Admin broiler session metadata edit + `recomputeBroilerBatchWeekAvg` helper** (added 2026-04-30, commit `00754c3`; reopen cleanup followed in `2dcdb20`). `/broiler/weighins` expanded broiler rows surface an always-visible inline metadata-edit panel (broiler-only; pig sessions in the same view do not show it; cattle/sheep are routed through different views). Admin can change `broiler_week` (WK 4 / WK 6 toggle) and `team_member`. **Side-effect contract:** when status === 'complete' AND `broiler_week` changes, `app_store.ppp-v4[batch].wk*Lbs` for the OLD week is recomputed/cleared via `recomputeBroilerBatchWeekAvg(sb, batchId, oldWeek, {excludeSessionId: s.id})`, then the NEW week's avg is stamped via the existing `writeBroilerBatchAvg`. Draft sessions and team-only edits do NOT touch ppp-v4 (matches today's `writeBroilerBatchAvg` complete-only gate). **Reopen contract:** when a complete broiler session is reopened to draft, the old week's stored avg is recomputed/cleared with the reopened session excluded, so `ppp-v4 wk*Lbs` cannot linger from a no-longer-complete session. **Helper contract** (`src/lib/broiler.js`): `{ok: true|false, message?}`. `{ok: true}` covers successful recompute, successful delete, OR intentional no-op (no usable entries on the picked session, batch row not found in ppp-v4, ppp-v4 row missing). `{ok: false, message}` ONLY for actual Supabase read/upsert errors. `saveSessionMetadata` only treats `{ok: false}` as a user-visible save failure. **`excludeSessionId` is mandatory** for the admin metadata path and reopen path so the moved/reopened session cannot win its own old-week recompute. **DELETE semantics on no-other-session:** the helper does `delete next[fieldKey]` on the batch row — clean "field absent" rather than null, matches "no saved average exists" intent. **Last-write-wins per (batch, week) preserved:** when multiple complete sessions exist, the latest by `completed_at` wins (matches `writeBroilerBatchAvg`'s single-session aggregation today). **Legacy team_member preservation:** if `s.team_member` is no longer in the active roster, the dropdown injects it as `'<name> (retired)'` so historical sessions don't blank-render or force a team change on save. The retired option is per-session — switching TO a retired name from a different one is not possible. **`writeBroilerBatchAvg` signature unchanged**; only the new helper is "loud" (returns `{ok, message}`). Other callers (`completeFromAdmin`, `saveAdminGrid`, `completeSession`, `finalizeSession`) keep today's quiet semantics.
- **Tasks Module v1 Phase A RLS contract** (migs 036-038, commit `4874f1d`, shipped 2026-05-01). `public.is_admin()` is the single admin-role helper for task RLS and future task RPCs. It is `SECURITY DEFINER`, `STABLE`, `SET search_path = public`, and checks `profiles.id = auth.uid()` with `role = 'admin'`. Grant pattern is deliberate: `REVOKE ALL FROM PUBLIC` + `GRANT EXECUTE TO authenticated`, with no explicit `REVOKE EXECUTE FROM anon`; anon may call and receives `false` because `auth.uid()` is NULL. A stricter anon revoke caused Supabase/PostgREST schema-cache/auth sign-in failures during recon, so do not reintroduce it without a fresh failing/proving test. `task_templates` are admin-only. `task_instances` are admin-all plus assignee SELECT-own; no direct assignee UPDATE. `task_cron_runs` are admin SELECT only; cron/admin generation writes through service role. The private `task-photos` bucket exists, but Ronnie later removed required-photo support from Tasks v1: do not build any "requires photo" task behavior.
- **`daily_submissions` parent table + `submit_add_feed_batch` RPC** (mig 034, added 2026-04-29). Add Feed produces N child daily rows from one operator submission (e.g. broiler 3 batches in one submit), and the offline-queue's flat per-row insert model breaks atomicity + photo attribution for that case. Mig 034 introduces a parent table `daily_submissions {id, client_submission_id, submitted_at, form_kind, program, source, team_member, date, payload}` and a soft-pointer `daily_submission_id text` column on the 5 child daily tables (`pig_dailys`, `poultry_dailys`, `layer_dailys`, `cattle_dailys`, `sheep_dailys`). `egg_dailys` is deliberately excluded — Add Feed has no egg flow. **No FK constraint** on `daily_submission_id` because three of those tables (pig/poultry/layer_dailys) are hand-created in prod and lack a managed schema lifecycle (§3); referential integrity is enforced inside the RPC (always sets a valid id at insert time). **Submit path:** `submit_add_feed_batch(parent_in jsonb, children_in jsonb)` is `SECURITY DEFINER` + `SET search_path = public`, with `EXECUTE` granted to anon + authenticated. The function body uses a tagged dollar-quote (`$add_feed_batch$`) to avoid colliding with the test bootstrap's `exec_sql()` plain `$$` quoting. **Idempotency contract (race-safe):** the RPC's parent insert is `INSERT INTO daily_submissions … ON CONFLICT (client_submission_id) DO NOTHING RETURNING id`; if `RETURNING` is empty, the function does a fallback `SELECT … WHERE client_submission_id = v_csid` and returns `{parent_id, child_count, idempotent_replay: true}`. **No 23505 ever surfaces to the caller** — replay is deterministic. The §7 anon-cannot-use-onConflict rule (around `client_submission_id`) does NOT apply to this RPC because the SQL `ON CONFLICT` runs inside the SECURITY DEFINER function body as the function owner; the rule was about PostgREST `.upsert()` from supabase-js as anon. **Child rows DO NOT carry their own `client_submission_id`** — parent owns dedup. If multi-child Add Feed wrote the parent's csid to every child, mig 030's unique index on each child table's `client_submission_id` would 23505 on insert #2; locked by `tests/add_feed_parent_submission.spec.js` Test 7. **Program key:** `pig | broiler | layer | cattle | sheep` (matches AddFeedWebform's existing app-facing keys). `broiler` routes to `poultry_dailys` inside the RPC — the table name has been `poultry_dailys` since the early days; the user-facing program key is `broiler`. **Pig children OMIT `feed_type`** because `pig_dailys` has no such column (locked by Test 3). **Atomicity:** the function body is one implicit transaction; any `RAISE EXCEPTION` rolls back parent + every child inserted before the failure (locked by Test 5). **`source = 'add_feed_webform'`** continues to be written on every child row so the existing dailys-list filter chip still finds them (locked by Test 8). **RLS on `daily_submissions`:** authenticated SELECT/ALL only; NO anon policies — anon reaches the parent table ONLY through the RPC. Hand-created child tables (pig/poultry/layer_dailys) keep their RLS-disabled state; the SECURITY DEFINER context bypasses RLS on every target table inside the function. **Historical Add Feed rows have null `daily_submission_id`** — the migration adds the column with no backfill; legacy rows stay unlinked. `AddFeedWebform.jsx` was cutover from direct `.insert(*_dailys)` to `.rpc('submit_add_feed_batch', ...)` in this build; the form is still synchronous (no `useOfflineSubmit` wiring yet — that's the next phase). The stale upsert comment in `src/lib/offlineForms.js` was updated alongside to reflect the post-Phase-1B insert+23505 contract for direct anon paths and the parent-RPC contract for multi-row forms.

---

## 8. Open items / roadmap

### Recommended sequencing (set 2026-04-27, updated 2026-04-28 late PM)

Playwright Phase 1 wrapped 2026-04-28 (late PM) with A8b. Initiative B Phase 1 + surgical Phase 2 cleanups landed lint at **0 errors / 636 warnings**. A10 CI workflow live; first run validated lint/vitest/build/install/cache/artifacts (e2e fails fast until 5 GitHub Actions secrets are configured — safe failure, the assertTestDatabase guard refuses to mutate without env). Equipment dashboard rollup + Playwright regression coverage shipped.

1. ~~**Cattle/sheep processor workflow.**~~ **DONE** 2026-04-27 (commits `f1adb81` + `448152e` + `802f393` + `6d70669` + `62e1064`).
2. ~~**Pig FCR cache.**~~ **DONE** 2026-04-27 (commit `a8c7133`).
3. ~~**Playwright Phase 1 integration tests.**~~ **DONE** — 9 specs + smoke shipped through 2026-04-28 (late PM):
   - ~~**A2** harness (`0ad8fc2`)~~. Local-only Playwright runner against isolated Supabase test project. `assertTestDatabase` guard, 29-table truncate whitelist, `exec_sql` RPC, single-bundle bootstrap, DEV-only backend sentinel, `--strictPort`.
   - ~~**A4** pig batch math (`3234ff6`)~~. Send-to-Trip happy-path; subAttributions schema, lbs/pig finishers-denominator regression.
   - ~~**A5** cattle Send-to-Processor (`e320237`)~~. 9 tests: attach, toggle-clear, entry-delete, session-delete (3-cow loop), batch-delete (3-cow loop), audit-row fallback, null-from-herd truthy guard, no-prior-herd block, no-manual-bypass.
   - ~~**A6** sheep Send-to-Processor (`7101484`)~~. 10 tests: A5 mirror + 1 unique looser-gate (rams flock CAN attach). Copy alignment to match §7 any-flock contract.
   - ~~**A7** broiler timeline (`be7df4c`)~~. 4 tests: range derivation, auto-scroll, today-line indicator. Added `data-week-header` + `data-iso` + `data-today-line` hooks.
   - ~~**A8a** fuel bill PDF parser (`d9fa8ba`)~~. 3 tests driving real Home Oil PDF through pdfjs → parser → modal → Save → Supabase rows + storage.
   - ~~**A8b** fuel reconciliation UI (`b2e3f13`, 2026-04-28 late PM)~~. 4 tests for variance bands (green/orange/red) + §7 cell-destination exclusion. Production patch: `data-month` + `data-fuel-type` + `data-cell` on all 9 fuel-type cells per row, plus `data-variance-band` on the 3 variance cells. New `varBand(pct)` helper sources from same `VARIANCE_WARN_PCT` constant as `varColor` (no drift).
   - ~~**A9** FCR cache spec (`b089505`)~~. 3 tests: Edit→Close populates fcrCached, Edit→Close deletes when adjFeed≤credits, Delete Trip clears via real DeleteModal.
4. ~~**A10 CI workflow** (`8906598`, 2026-04-28 late PM)~~. **DONE.** `.github/workflows/ci.yml` runs lint + vitest + build + e2e on every PR + push to main. Single sequential job, ubuntu-latest, Node 20, npm ci, Playwright cache by package-lock.json hash, fixed concurrency group `wcf-test-db` (cross-PR serialization to protect shared test Supabase project), 20-min job timeout, `contents: read` permissions only, artifacts uploaded on failure. **Five GitHub Actions secrets required** (configure in repo Settings → Secrets and variables → Actions): `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `VITE_TEST_ADMIN_EMAIL`, `VITE_TEST_ADMIN_PASSWORD`. First post-merge run validated lint/vitest/build/install/cache/artifacts; e2e fails fast on missing-secrets until configured. After first green run, branch protection can be enabled (Settings → Branches → require the `verify` check) — that step is intentionally separate from this PR.
5. ~~**Initiative B Phase 1 (ESLint + Prettier baseline)** (`ed19d4d`, 2026-04-28 late PM)~~ + ~~**surgical Phase 2 cleanups**~~. ESLint 9 flat config + Prettier 3 + 4 npm scripts + 6 devDeps. Conservative rule set: `@eslint/js` recommended + `react-hooks/rules-of-hooks` (src/ only — Playwright `use(...)` fixture pattern collides with the heuristic, scoped accordingly) + `react-hooks/exhaustive-deps` warn + `no-unused-vars` warn. Initial baseline: 738 problems / 81 errors / 657 warnings. Surgical cleanups: SheepBulkImport helper extraction + `/* global XLSX */` (`900aed1`, fixed runtime ReferenceError on `/sheep` bulk import), real-signal lint (`5716838` — main.jsx XLSX directive, BatchForm.jsx `setShowForm`→`closeForm` real bug, AdminAddReportModal.jsx `housingBatchMap` state load real bug, LivestockWeighInsView.jsx dead-line removal), mechanical cleanup (`8096226` — 23 no-empty / 12 no-useless-escape / 2 no-empty-pattern). **Final: 0 errors / 636 warnings.**
6. ~~**Equipment dashboard rollup** (`a2159b5`, 2026-04-28 late PM)~~ + ~~**A1 regression spec** (`0f57d47`, 2026-04-28 late PM)~~ + ~~**hotfix: drop upcoming + missed_fueling**~~ (this commit, 2026-04-28 eve hotfix). HomeDashboard EQUIPMENT ATTENTION rollup originally added `upcoming` (next_due within 50h/km) and `missed_fueling` (>14 days since last fueling) alongside `overdue` / `fillup_streak` / `warranty`. Ronnie clarified post-deploy that **equipment maintenance is hour/km-based, not calendar-based** — animal daily reports are the calendar/time workflow, equipment is not. The two calendar-time-flavored kinds were noisy without action signal and have been removed. Final live kinds: **overdue / fillup_streak / warranty**. The two removed kinds' Playwright tests were rewritten as negative regression locks (near-due seed AND stale-fueling seed both prove no row renders). DEF-low warnings still deferred (no current-level data model).
7. ~~**Initiative C Phase 1B — adapter foundation + FuelSupply canary** (`b5a07a9`, 2026-04-29)~~. **DONE.** `idb` + `fake-indexeddb` deps; 5 new lib modules (`clientSubmissionId`, `offlineForms`, `offlineQueue`, `photoCompress`, `useOfflineSubmit`) with 49 vitest cases; FuelSupplyWebform rewired through `useOfflineSubmit('fuel_supply')` with synced/queued copy + stuck-modal trigger; PWA `manifest.webmanifest` + 192/512 placeholder icons + `index.html` link/meta/apple-touch-icon (no Service Worker — Phase 3); 7 new Playwright tests across canary + dedup specs. **Design correction during build**: anon webforms use plain `.insert()` + 23505-on-csid = synced, NOT `.upsert(onConflict, ignoreDuplicates: true)` — anon RLS lacks SELECT on the conflict-target column so PostgREST's `ON CONFLICT` path returns 42501. The unique index alone gives the same idempotency. See §7 entry on `client_submission_id` and the docs/comments at the top of `useOfflineSubmit.js` for the full contract. **Codex-flagged limbo bug fixed pre-commit**: `recoverStaleSyncing(formKind, {staleAfterMs: 30_000})` resets orphaned `syncing` rows back to `queued` on the next sync pass so a tab/crash mid-flight doesn't strand a row in a status that neither `listQueued` nor `listStuck` would surface.

### Deferred Initiative B follow-ups (Phase 2.5-2.6)

Lint at 0 errors closed Initiative B's hard milestone. Phase 2.4 (Prettier) shipped 2026-04-28 (eve+). Remaining cleanup is mechanical churn that doesn't unlock anything:

- ~~**Phase 2.4 Prettier autofix.**~~ **DONE** 2026-04-28 (eve+). 203 files reformatted across 3 format-only commits (110 src/ + 26 tests+configs+supabase-functions + 67 scripts/). `npm run format:check` added to `.github/workflows/ci.yml` between Playwright install and lint, so future PRs are gated on formatting. §7 invariants spot-verified across `supabase.js`, `pagination.js`, `cattleCache.js`, `pig.js`, `routes.js`, `equipment.js`, `fuelBillParser.js`, `import_equipment.cjs`, `patch_relink_photos_by_date.cjs`. `\u` JSX escapes preserved.
- **Phase 2.5 `no-unused-vars` cleanup** — 596 warnings, mostly dead Phase-2-extraction imports. Some `eslint --fix`-able; rest is per-site removal. Largest of the three.
- **Phase 2.6 `react-hooks/exhaustive-deps` triage** — 61 warnings, case-by-case judgment.

### Remaining initiatives

- **Initiative C — Mobile install + offline/photo-capable webform queue.** Plan-approved 2026-04-28 (eve+). Phase 1A/1B/1C-D/1D-A/1D-B are shipped through 2026-04-30: FuelSupply, AddFeed, PigDailys, daily-report photos, and pig/broiler fresh draft WeighIns are wired as described in §7 and Part 4. Mig 031 (`daily-photos` bucket) is applied. Remaining Initiative C work is future polish/expansion (for example service worker shell), not an immediate blocker.

### Initiative C v1 plan capture (locked 2026-04-28 eve+)

**Goal:** Five public webforms become installable + offline-queue-capable + photo-capture-ready. Adapter/registry pattern from day one so the upcoming new public webform Ronnie has coming drops in with a registry entry, not a queue rewrite. All daily reports get photos in a future phase using the same plumbing.

**Locked decisions (Q&A rounds 2026-04-28 eve+):**
- WeighInsWebform queue runs **alongside** existing draft sessions — additive, not replacing.
- Photo compression: **1024px max-edge / JPEG 0.7 / ~80KB target** at capture time.
- Equipment `current_hours/km` UPDATE silently fails under prod RLS (recon proved 6 of 16 active pieces drift). Queue replay does NOT retry it. Reconciliation belongs in admin path, NOT the public queue. Tracked in §8 Near-term.
- Sync trigger: **auto on `online` event + manual button + 60s tick while a webform tab is open.** Failed-after-3-retry submissions surface in a stuck-submission modal on next form-open.
- Storage path scheme: `<form_kind>/<client_submission_id>/<photo_key>.jpg` (deterministic, replay-safe).
- `daily-photos` bucket: PRIVATE. Anon INSERT, authenticated SELECT only. NO public SELECT, NO publicUrl in DB.
- Photos jsonb columns: only on the 5 daily-report tables (`pig_dailys`, `poultry_dailys`, `layer_dailys`, `cattle_dailys`, `sheep_dailys`). NOT on `egg_dailys`, NOT on `fuel_supplies`. Already exists on `equipment_fuelings` from mig 018 (different bucket).
- Idempotency: `client_submission_id text` (client-generated UUID/id, no specific package locked-in). Non-partial unique index. **Anon webforms use plain `.insert(record)` and treat code 23505 referencing `*_client_submission_id_uq` as already-synced** (revised 2026-04-29 during Phase 1B canary). The original Phase 1A plan called for `.upsert(onConflict, ignoreDuplicates: true)` but that breaks under anon RLS — PostgREST's `ON CONFLICT` path requires SELECT privilege on the conflict-target column, and the public webform tables grant anon INSERT only. The unique index alone gives the same dedup guarantee. See §7 entry on `client_submission_id` for the full contract + validation gate.
- Migration 031 RLS scope narrowed: existing webform policies are already in migration history (001/009/016/018/024/026); the new migration only creates the `daily-photos` bucket + its 2 policies.
- Photos as first-class on every queued submission from Phase 1 — IDB photo_blobs store + photoCompress.js land in Phase 1, not Phase 2. Future-proofs the upcoming webform.

**Status summary:**
- Shipped: Phase 1A/1B/1C-A/1C-B/1C-D/1D-A/1D-B. See §7 and Part 4 for the exact contracts and commit ranges.
- Still future: Service Worker/app-shell caching and any additional offline form expansion. Treat these as fresh plan packets; do not rely on the older phase names as active work.
- Locked test pattern remains: unit coverage for queue helpers and focused Playwright specs that prove online, offline, replay/idempotency, stuck-state, and storage/RLS behavior for each newly wired form.

### Next build

- **Tasks Module v1 Phase B + schema cleanup.** Phase A (migs 036-038) is shipped on TEST + PROD + source. The next task lane should start with a plan packet before code. It must handle Ronnie's post-Phase-A decision that Tasks v1 does **not** need required-photo support anywhere. Preferred cleanup: remove or permanently disable `requires_photo` before UI/RPC code can depend on it; if removing columns, use a new migration because Phase A is already shipped. Phase B then builds the scheduled generator edge function + migration 039 schedule using pg_cron + pg_net + Supabase Vault.

### Locked decisions for queued builds

These are pre-locked design decisions Ronnie has captured for the upcoming roadmap items. CC should walk these at PLAN time before each build, not just at edit time (per the §7 working rule).

**Daily Report Photos (Phase 3 of Initiative C):**
- Scope: pig, poultry, layer, cattle, sheep. **Egg explicitly excluded.**
- Storage: `daily-photos` private bucket (mig 031). Anon insert, authenticated SELECT only. App stores path; admin reads via signed URL.
- UI: camera icon + photo count on Dailys list tiles. Thumbnails only render in expanded/detail view (not the list).
- Max photo count and max byte budget per submission: decision needed before build starts. Compression target locked at 1024px max-edge / JPEG 0.7 / ~80KB target (already in `photoCompress.js`).

**Cattle Improvements (queued):**
- Momma herd cow tile shows derived calf count.
- Heifer auto-promotion and dam-link triggers are already shipped (migs 032-033). Do not plan them as future work unless a backfill/audit issue is discovered.

**Cattle Herd filters + maternal-field retirement (queued):**
- This is for the Cattle Herd tab, not the Forecasting tab. Forecasting can use
  the same helper data later, but the first build is the day-to-day Herd list.
- Replace the current single `statusFilter` + single `sortBy` setup with a
  structured filter array and ordered sort array. Filters/sorts should compose,
  e.g. sex + age + calved status + blacklist.
- Fix the age sort contract while doing this: "youngest first" should sort by
  newest birth date first, and "oldest first" by oldest birth date first.
- Planned filters: herd/outcome, sex, age or birth-date range, calved/never
  calved, last-calved range, calf count, breeding blacklist, breeding status,
  lineage present/missing, last weight/no weight/stale weight, breed, origin,
  and Wagyu percent.
- Add an explicit grouped-vs-flat view toggle. The default should remain the
  current active grouped herd view, but filters and sorts should work in either
  mode instead of silently forcing flat mode.
- Retire maternal issue completely for cattle. Do not include it in filters,
  sorting, AI helper vocabulary, UI badges, forms, or new docs. Remove existing
  cattle UI reads/writes for `maternal_issue_flag` and `maternal_issue_desc`.
  Dropping those database columns requires a separate explicit migration gate
  after checking test/prod data and confirming no live consumer still depends on
  them. Sheep has analogous maternal fields, so decide during planning whether
  sheep cleanup is part of this lane or a separate sheep lane.
- AI helper is a follow-up after the deterministic filter/sort engine is solid:
  it should translate natural language into validated filter/sort chips for
  review, never write data, never run arbitrary SQL, and never invent unsupported
  fields.
- Test plan: unit coverage for predicate/sort helpers; Playwright coverage for
  age sort direction, sex+age multi-sort, calved vs never-calved filtering,
  blacklist filtering, grouped/flat mode, and maternal issue controls/badges
  being absent from cattle UI.

**Cattle Forecast tab (queued):**
- Add a new Cattle Forecast tab/view for finisher processing projections. This
  is distinct from the Herd tab filter/sort rebuild. It should replace the
  current manual Excel workflow (`Steer_2026_Processing_Forecast.xlsx`) and stay
  live from planner data instead of requiring Podio/app exports.
- Forecast horizon: current year plus 3 years ahead. Default to calendar-year
  buckets, with month-level detail and a rolling "as of today" calculation.
- Source data: `cattle` rows, completed cattle `weigh_in_sessions` +
  `weigh_ins`, current herd/status, birth date/age, sex, origin, breed/Wagyu
  percent, and existing `cattle_processing_batches` where relevant. Use current
  and prior tags so retagged animals keep their weigh history.
- Locked target window: a forecast animal is process-ready at **1,250-1,450 lb
  live weight**.
- `Processed/month` means calculated readiness: how many head could be processed
  in that month based on projected weight. Already processed cattle do not count.
- Default eligibility: active `finishers` + active `backgrounders` + all active
  steers. Also support saved manual inclusion of heifers that are still in the
  momma herd. Exclude processed/deceased/sold from the active forecast unless a
  separate historical view is added later.
- Calculation model:
  - Find each eligible animal's latest completed weigh-in and previous completed
    weigh-in.
  - For animals currently in `finishers` or `backgrounders`, compute ADG from a
    rolling 3-week average where enough completed weigh-in history exists.
  - For animals outside those herds, or animals without enough recent data, use
    the editable fallback ADG setting. Default fallback: **1.18 lb/day**.
  - Project future live weight to the **15th of each month**.
  - Surface confidence/exception states for no weight, stale weight, negative
    ADG, tiny date gaps, missing birth date, and missing origin.
- Forecast should suggest animal-to-month assignments. V1 also needs saved
  manual overrides: include/exclude a specific animal and lock a specific
  processing month.
- UI surfaces:
  - Summary cards: ready this year, ready next 3 years, overdue/over-target,
    missing-data count, projected live-weight total by month.
  - Month/year buckets: forecast processing counts by month with animal lists,
    projected weights, average age, origin mix, and total projected live weight.
  - Animal table: tag, sex, herd, origin, age, latest weight/date, previous
    weight/date, ADG source, projected ready date/month, projected weight at
    month, and exception badges.
  - Scenario controls: target processing weight or range, monthly processor
    capacity, checkpoint day-of-month, ADG fallback, stale-weight threshold, and
    include/exclude herds.
- Persistence is required in v1. Plan a migration-owned forecast table or tables
  for saved settings and per-animal overrides; do not hide this state in
  localStorage. Keep RLS authenticated/admin-shaped like the rest of cattle
  admin surfaces.
- Processing-batch integration:
  - WeighIns remains the official/final send-to-processor action.
  - Forecast can create **planned** processing batches from forecast month
    assignments.
  - Forecast must not mark cattle processed or attach cattle as final processor
    entries. Those transitions remain in the WeighIns send-to-processor flow.
  - Batches tab needs a status rework: `planned` = forecast/scheduled,
    `in_progress` = cattle sent to processor but hanging/final data not entered,
    `complete` = processed/final weights entered.
  - When WeighIns sends cattle to an existing planned batch, that batch should
    become `in_progress`.
- No CSV/XLSX export in v1. The planner view should be good enough that the
  spreadsheet/export workflow is no longer needed.
- Test plan: pure unit tests for ADG, checkpoint projection, readiness date,
  month assignment, capacity bucketing, missing-data flags, and retag history;
  Playwright seed covering a new completed cattle weigh-in changing the forecast
  without manual refresh/export; regression that processed/sold/deceased cattle
  do not appear unless explicitly included.

**Equipment Material List (queued):**
- Add structured `parts_required` metadata to each `equipment.service_intervals[].tasks[]` entry.
- Build admin material list view: due-within-100-hours hour-based equipment surfaces with the parts manifest aggregated.
- Hijets (km-based) include all material-tagged maintenance regardless of distance window (Ronnie's call — Hijet maintenance batches differently).
- Clearable like missed reports; clear expires when relevant interval state changes (next fueling logged, interval reset, etc.).

**Tasks Module v1 (queued, biggest scope):**
- Phase A is shipped (commit `4874f1d`): mig 036 tables, mig 037 `is_admin()` + RLS, mig 038 private `task-photos` bucket. No UI/RPC/cron consumers yet.
- Next lane is Phase B + schema cleanup. Required-photo support is removed from v1 by product decision; do not expose any "requires photo" setting or completion gate. Because Phase A already shipped `requires_photo` columns, Phase B planning must either remove them with a new migration or leave them dormant with tests proving no code path uses them.
- Assignee: `profiles.id` of a login user only. Not team-member objects; assignees must be app users because they need to log in and see their task list.
- Public `/webforms/tasks` route: anyone (no auth) can submit a task. Creator is selected from the team-member dropdown (display-name string captured on the row). The task webform needs its own central availability allocation from the master roster so only the intended creator names appear.
- One assignee per task in v1. No comments/status updates, no priority field.
- Recurrence: once / daily / weekly / biweekly / monthly / quarterly. Recurring instances are anchored from the original due date and generated automatically 3 days before due. Missed/overdue instances stack (no auto-skip). Completed tasks remain visible in history.
- Weekly summary email/notification goes through the existing `rapid-processor` / email path. Recipients: only users with outstanding tasks (not the assigner by default, not Ronnie/admin unless they personally have outstanding tasks).
- Cron mechanism is locked: Supabase Edge Function + pg_cron + pg_net + Supabase Vault. Daily generator schedule: 04:00 UTC. Weekly summary schedule: Monday 13:00 UTC. Cron sends service-role JWT in `Authorization` plus `x-cron-secret`; admin manual "Run Cron Now" authorizes through the caller's JWT + `rpc('is_admin')`.
- **Required before prod ship:** scheduled generator that creates the next-3-days instances. App-open generation is not part of v1 — users who do not open the app must still receive new instances.

**Small cleanup (queued, non-blocking):**
- Replace Mowers handsaw icon with a mower/tractor-style icon.
- Remove old Backup/Restore UI after confirming no current path depends on it (grep `backupData|restoreData|_wcfBackup` first; the helpers live in `main.jsx`).

### Near-term (known & actionable)

- **Import more Podio apps** (Ronnie has more workspaces coming over — animal dailys, breeding records, etc.). Budget time for each: inventory fields via dump, filter `status='deleted'`, match external_id variants (e.g. `every-fuel-fill-up` vs `-checklist`), design per-app → planner table mapping, add per-app Fuel-Log-style category map if applicable, add `--fuelings-only`-style flag if it touches a patched-admin table, dry-run, audit against Podio XLSX exports. All Podio-import pitfalls live in §7 (don't-touch list). **For photo links, prefer `(equipment_id, date)` matching from day 1** to avoid the 147-orphan problem we hit on the equipment apps.
- **`/fueling/supply` operator smoke test.** Bills + Reconciliation paths are smoke-tested end-to-end (2026-04-27, real Home Oil PDF), but the public supply form itself hasn't had an operator submission this iteration. Ronnie should submit one entry to confirm anon insert + per-form team filter + the relabeled cell-refill destination warning.
- **Multi-month Home Oil bill validation.** First real bill (`IN-0195942`, Mar 2026 delivery) parsed clean end-to-end. Pull a handful more through `/admin → Fuel Log → Bills → + Upload bill` to confirm regex stability across month-to-month variation. New supplier formats will need their own detection branch — `parseFuelBillText` currently keys on the literal `Tax and Other Charges Included in Price` phrase to pick tax-included vs additive logic.
- **Purchased ↔ consumed reconciliation review.** `/admin → Fuel Log → Reconciliation` groups bills (`fuel_bills` + `fuel_bill_lines`, by `delivery_date` month) on the PURCHASED side, vs (`equipment_fuelings` excluding `suppressed` + non-cell `fuel_supplies`, by `date` month) on the CONSUMED side. Variance bands: ≤5% green / 5–10% orange / >10% red (driven by `VARIANCE_WARN_PCT = 5` in `FuelReconcileView.jsx`). Single-month variance is rarely meaningful — month timing (bill arrives one month, fuel gets used the next) and inventory carryover in the cell make exact monthly matches uncommon. Look at multi-month trends. Once bills accumulate, scan for sustained patterns rather than single-month deltas.
- **Per-view state internalization** (optional polish, parked 2026-04-21). ~40 `useState` hooks in App's body are view-local state that belongs inside the view component. Right approach: push each block INTO the view that uses it (webforms-admin state → `WebformsAdminView`; feed state → shared `FeedUIContext`; auto-save refs → per-context). Regressions only surface at runtime, so it needs the bare-name audit pattern (see §Part 3) and careful per-view verification. Estimated 5–7 commits.
- **Per-head cattle cost rollup.** Feed cost (from `cattle_dailys.feeds[].lbs_as_fed × landed_per_lb`) + processing cost (from `cattle_processing_batches`) per cow with attribution rules. Not blocking ops.
- **Feed system physical count verification.** The adjustment calculation (system estimate vs actual count) needs real-world validation. Code reviewed for edge cases.
- **Cattle modal cleanup.** The `openEdit` / `openAdd` modal code still lives in `src/cattle/CattleHerdsView.jsx` even though no UI button reaches it (Edit was removed in favor of inline-editable expanded tile). Rip the modal JSX + `form` state out for clarity. Also: the Add-Cow path (top-right "+ Add Cow" button) still uses a modal — convert it to "create empty cow row, expand it inline" or keep modal-for-add only.
- **A10 CI Actions secrets configuration** (Ronnie task, ~5 min). Five repo Actions secrets needed at [Settings → Secrets and variables → Actions](https://github.com/byronronniejones-lab/WCF-planner/settings/secrets/actions): `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `VITE_TEST_ADMIN_EMAIL`, `VITE_TEST_ADMIN_PASSWORD`. Values come from `.env.test` / `.env.test.local`. Until configured, the CI workflow's e2e step fails fast on the assertTestDatabase guard (lint/vitest/build pass). After configuration, re-run failed jobs from the Actions UI or push any change to validate end-to-end.
- **HomeDashboard equipment alerts: sort-order + auto-clear-on-resolve specs.** A1 (`0f57d47`) plus the 2026-04-28 eve hotfix together cover each of the 3 live alert kinds (overdue / fillup_streak / warranty) plus 2 negative locks (near-due / stale-fueling). Two follow-ups remain uncovered: (a) sort-order across multiple kinds in one seed, asserting overdue → fillup_streak → warranty; (b) auto-clear semantics — e.g., overdue row vanishes after the interval is ticked complete on a fueling. Both are deferrable scope.
- **Equipment Reading Reconciliation Follow-Up** (separate from Initiative C v1). Recon 2026-04-28 (eve drift) confirmed anon UPDATE on `equipment.current_hours/km` from the public `/fueling/<slug>` webform silently fails under prod RLS for **6 of 16 active pieces**. Latest-by-date drift table: hijet-2020 (+182km), ps100 (+14h), honda-atv-1 (+13h, masked under max-reading ordering by a 2025-01-11 legacy 5437h import outlier — ignore the legacy row), honda-atv-2 (+8h), honda-atv-3 (+5.5h), l328 (+2h). Phase 0 (commit `2e02f81`) shipped a HomeDashboard read-side workaround via `latestSaneReading` so the overdue-interval math compensates for the drift, but the parent `equipment.current_*` fields stay stale. Long-term fix options: (a) authenticated admin reconciliation script that admins run periodically (simplest), (b) Supabase Edge Function called by the anon webform with a constrained payload that updates `equipment.current_*` in admin context (most automated), (c) derive current reading on read from MAX(sane fueling) instead of trusting `equipment.current_*` fields anywhere they're consumed (most invasive). Decision deferred to a future session. Don't add anon UPDATE policy on `equipment` as a quick fix — the table holds admin-controlled spec data (warranty dates, manuals, documents, attachment_checklists adjustments) and broadening anon write access is a real attack surface increase. Re-run `node scripts/recon_initiative_c.cjs` for fresh drift numbers any time before committing to a fix.

### Deferred (no current owner)

- **DNA test PDF parser** for cattle — manual entry is the v1 workaround.
- **Weather API integration** — multi-program scope, no provider chosen. Farm coords in §2.
- **TypeScript conversion.**
- **Additional Playwright coverage beyond Phase 1.** All 9 planned specs + smoke + A1 follow-up shipped 2026-04-28 (late PM); see §8 sequencing for SHAs. Future candidates as the app grows: equipment fueling webform flows, public weigh-ins webform, layer housing math, Add-Feed webform, /sheep bulk import (now-functional after `900aed1` — would lock the runtime fix). Each can land as its own focused spec following the established cadence.
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
- **PigsHomeView shows feed=0 once a pig batch's subs are all processed.** `PigsHomeView.jsx:100-103` filters dailys by ACTIVE subs only — when every sub is marked processed, the filter excludes the whole batch's daily reports and total feed reports as 0 on the home dashboard. PigBatchesView's totals are unaffected (it reads all subs regardless). Pre-dates the 2026-04-27 accounting overhaul; left as follow-up.
- **Imported sheep weigh-in sessions have `herd=null`.** Podio import never set `weigh_in_sessions.herd`. The Send-to-Processor toggle on `/sheep/weighins` is gated to draft sessions only (no flock check); admin can flag any sheep on those legacy sessions. New sessions created via "+ New Weigh-In" set the flock correctly. Cattle gate stays strict (finishers-only).
- **`pigSlug('P-26-01A') === 'p-26-01a'` (NO dash before the letter).** `pigSlug` in `src/lib/pig.js` slugifies via `/[^a-z0-9]+/g` — uppercase letters become alphanumeric after `toLowerCase()`, so the `A` in `P-26-01A` merges with the digits beside it instead of getting a separating dash. `LivestockWeighInsView.sendEntriesToTrip` resolves which sub a session's entries belong to by `pigSlug(session.batch_id) === pigSlug(sub.name)` — feed it `'p-26-01-a'` (hand-typed dashed form) and the match silently fails, producing a trip with empty `subAttributions`. Foot-gun for any future test seed or operator who builds `weigh_in_sessions.batch_id` by hand. Always run input through `pigSlug` rather than typing the dashed form.
- **Nine prod tables are hand-created, no migration owns them.** `profiles`, `app_store`, `webform_config`, `poultry_dailys`, `layer_dailys`, `egg_dailys`, `pig_dailys`, `layer_batches`, `layer_housings`. They exist in production from manual dashboard setup or Supabase auth templates that pre-date the migration history in this repo. The bootstrap bundle (`scripts/build_test_bootstrap.js` → `hand_created_tables_seed`) seeds them on a fresh test project; if any of these schemas drift on prod, regenerate the bundle against the new shape. See §3 for the full list + capture date.
- **Pig batch tile uses no `.hoverable-tile` class and doesn't click-to-expand.** `PigBatchesView.jsx:836+` renders each feeder group inline — trips and sub-batches are always visible inside the batch card. Cattle/sheep/broiler tiles all use `.hoverable-tile` + click-to-expand state, so test selectors that copy the cattle/sheep pattern silently fail on `/pig/batches`. For Playwright specs targeting trip rows, anchor on text content (date + pig count) plus the always-present Edit button — see `tripRow()` in `tests/pig_fcr_cache.spec.js` for the canonical helper.
- **Supabase blocks direct DELETE on `storage.objects`.** Service-role queries via `exec_sql` get back `Direct deletion from storage tables is not allowed. Use the Storage API instead.` Test reset for storage cleanup must use `sb.storage.from(bucket).list()` + `.remove()` recursion, NOT raw SQL. See `cleanupFuelBillsStorage` in `tests/setup/reset.js`. If a future test needs cleanup for another bucket, follow that pattern (top-level `list()` returns folder-shaped entries; recurse into each to get file paths).
- **DOM hooks added 2026-04-28 for stable Playwright selection** (no logic change, no semantic meaning beyond test infrastructure):
    - `BroilerTimelineView.jsx`: `data-gantt="1"` + `data-week-header="1"` + `data-iso={isoString}` + `data-today-line="1"` (shipped PM, A7).
    - `FuelReconcileView.jsx`: `data-month="YYYY-MM"` + `data-fuel-type="diesel|gasoline|def"` + `data-cell="purchased|consumed|variance"` on the 9 fuel-type cells per row, plus `data-variance-band="green|orange|red"` on the 3 variance cells (shipped late PM, A8b).
    - `HomeDashboard.jsx`: `data-attention-kind="overdue|fillup_streak|warranty"` + `data-equipment-slug="<slug>"` on each EQUIPMENT ATTENTION row (shipped late PM, A1 follow-up; reduced from 5 kinds to 3 in the 2026-04-28 eve hotfix when Ronnie clarified equipment is hour/km-based, not calendar-based).

    If a future refactor renames or removes these attributes, the corresponding Playwright spec breaks — search for `data-` in `tests/` before refactoring view files.
- **Vite dev-server cleanup race on consecutive `npm run test:e2e` runs.** With `reuseExistingServer: false` in `playwright.config.js`, the dev server takes a few seconds to release port 5173 between back-to-back invocations. A second `test:e2e` started immediately after the first finishes can hit a 20s `page.goto` timeout in `tests/setup/global.setup.js` because Vite hasn't fully bound 5173 yet. The race only affects local development cadence (one test run after another in quick succession); CI is unaffected because each workflow run gets a fresh runner. Workaround: wait 5-10 seconds between runs, or kill any zombie node process listening on 5173 before starting (`Get-NetTCPConnection -LocalPort 5173`). Not a test code issue.
- **Selector trap on labels with text-collision against table headers.** Both `<label>Subtotal</label>` (form field) and `<th>Subtotal</th>` (line items column header) appear in the FuelBillsView upload modal. A naive `:has(text="Subtotal", exact)` filter matches both, and `.last()` lands deep in the table. Anchor on the element name: `label:text-is("Subtotal")` instead. Same trap likely exists for any modal that has both a header form AND a table with overlapping column names.

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

| 2026-04-27 | (current) | **Test-suite Phase 1 + fuel-ops closeout + reconciliation pivot.** Two-segment session. **Phase 1 of test-suite initiative**: Vitest 2.x harness pinned to pair with Vite 5 (Codex caught a 4.x-pulls-Vite-8 toolchain skew before commit). Three lib test files added (38 tests, all green): `src/lib/equipment.test.js` (snap-to-nearest, divisor cascade raw, cumulative-partial union, until_due rounding, soonestDue priority — public API only, no production exports added), `src/lib/dateUtils.test.js` (addDays / toISO / fmt / fmtS / todayISO — `thisMonday()` deliberately untested per a Sunday/Monday name-vs-impl discrepancy logged in §8 gotchas), `src/lib/routes.test.js` (VIEW_TO_PATH ↔ PATH_TO_VIEW round-trip + canonical /webforms /addfeed /weighins anchors). `npm test` + `npm run test:watch` scripts shipped. Plan was 4 phases (tests → ESLint config → PWA shell → Playwright); deliberately paused after Phase 1 to avoid momentum-drift into pure-tooling work. **Fuel-ops closeout build**: 8 more tests on the fuel-bill parser (Home Oil tax-included happy paths + tax-exclusive fallback + value-before-label layout quirk + empty / missing dates / unclassifiable failures). Tiny export seam added: `parseFuelBillText(text)` exposed so tests don't need PDF fixtures. **PDF parser bugs found and fixed via real Home Oil bill smoke test** (`ODBIN-0195942_2.PDF`): (a) **pdfjs v5 worker required** — `workerSrc=''` silently failed (warning was `No "GlobalWorkerOptions.workerSrc" specified`); switched to Vite `?url` import for `pdf.worker.mjs`, which Vite emits as a separate ~2.3MB asset and resolves to a runtime URL. (b) **Tax-included pricing** — Home Oil's `Tax and Other Charges Included in Price` header means the printed unit_price is already all-in; old additive `allocateTax` was double-counting tax (~9% over-statement on every line + monthly reconciliation cost). Added literal-string format detection in `parseFuelBillText`; for tax-included bills `allocated_tax = 0`, `line_total = line_subtotal`, `effective_per_gal = unit_price`, and bill `subtotal` is derived from `total - tax_total` for a true pre-tax figure. Tax-exclusive bills still use the additive logic for any future supplier without the tag. (c) **Line-aware label search** — pdfjs Y-grouping puts the Invoice No / Invoice Date / Delivery Date VALUES on the line BEFORE their labels (column-major extraction interleaves left-column address with right-column header fields). New `findValueNearLabel` checks the label line + ±2 neighbors, ID pattern requires at least one letter so pure-digit street numbers (`5744 E US Highway 84`) don't match the Invoice No grabber. (d) **Tax rounding** at parse time (was showing `93.17999999999999` from float drift; now `Math.round(taxSum * 100) / 100`). **Bill save rollback**: on `fuel_bill_lines` insert failure after `fuel_bills` row + PDF upload landed, now cleans up the bill row (cascade clears any partial lines via `ON DELETE CASCADE`) and removes the orphan PDF from storage. Also: validation that every line has `fuel_type` set before save (otherwise the line's $ contributes to monthly cost but the gallons land in no fuel-type column — silent distortion). **Reconciliation rebuilt around purchased-vs-consumed** (was bill-vs-supply): bills are PURCHASED side; CONSUMED side combines `equipment_fuelings` (excluding `suppressed`) + non-cell `fuel_supplies`. `destination='cell'` rows on `fuel_supplies` are inventory movement (filling the portable cell from a supplier delivery), excluded so the same gallons aren't double-counted once equipment checklists log what was pulled out of the cell later. Header copy rewritten to explain the model + warn that single-month variance is rarely meaningful (timing/carryover). DEF aggregation reads `equipment_fuelings.def_gallons` separately from `gallons + fuel_type` (DEF on equipment fuelings is a separate column added during a fillup, not a `fuel_type` value). `FuelSupplyWebform` cell destination relabeled `⚠ Cell refill (inventory only — not consumption)` and pushed to bottom of dropdown; warning copy expanded to spell out the distinction. **PROJECT.md §7 updates**: `fuel_supplies` vs `equipment_fuelings` rule rewritten for the new consumption model (cell vs non-cell distinction); tax-allocation entry rewritten for the two-format detection; reconciliation entry rewritten to `purchased ↔ consumed`. **Variance threshold doc fix**: §8 said `5/10/20 green/orange/red` but code was `≤5 / ≤10 / >10`; doc + reconciliation header now cite `VARIANCE_WARN_PCT = 5` as the source of truth. **HANDOFF_NEXT_SESSION.md restructured** per a new doc-structure rule: HANDOFF is now prompt-only (a clean copy-paste prompt that points the next Claude at PROJECT.md); all session recaps + state + pitfalls + roadmap live in PROJECT.md. **Memories saved**: 3 new feedback/project memory files — cross-check don't-touch list at planning stage (not just edit stage), deploy-verification rigor proportional to change risk, HANDOFF-vs-PROJECT.md doc structure. **Smoke test passed end-to-end** with `ODBIN-0195942_2.PDF`: parser populated every header field correctly (Invoice IN-0195942, Invoice Date 2026-04-01, Delivery Date 2026-03-30, BOL 417159, Subtotal $1,009.28, Tax $93.18, Total $1,102.46), both line items correct (Nonethanol 87 gas + Dyed Diesel) with `allocated_tax = 0`, save → bill row + line items + PDF storage upload all worked, signed-URL PDF retrieval works, expanded-row line items display correctly, reconciliation tab now shows 15+ months of equipment consumption (Mar 2025 — Apr 2026, 13–42 fuelings/month, 50–200 gal diesel + 30–110 gal gasoline) alongside the new Mar 2026 bill. |

| 2026-04-27 (PM) | `1f7a299`..`a8c7133` | **Pig accounting overhaul + cattle/sheep Send-to-Processor + Pig FCR cache.** ~12 commits across one long working session, all smoke-tested live. **Broiler timeline**: drops the "Today" button + `thisMonday()` helper; range derives from data (today−90d → max(today+30d, latestEnd+30d)) with auto-scroll to today on mount (`1f7a299`). **persistSubBatch sticky-status fix**: rebuild was hardcoding `status:"active"`, flipping processed subs back to active on edit/autosave/close (`3226fa7`). **Pig accounting overhaul** (`3fab65d` + predecessors): started counts no longer mutated by transfers; sub-batches as locked single-sex partitions of parent; sex selector on Add Sub-batch + read-only counts on Edit; parent batch modal gains "Distribute across sub-batches" with sex-specific sum-vs-parent validation; "+ Add Trip" removed (trips originate only from weigh-ins via Send-to-Trip); `subAttributions:[{subId,subBatchName,sex,count}]` schema on trips; ledger-derived current = started − processed − transferred − mortality; sub adjusted feed = raw − transfer credits sourced per-sub from breeders[]; lbs/pig denominator = finishers (started − transferred − mortality), not started. P-26-01 reads 1186/1037/1124 lbs/pig (was 1644/1037/1173). One-off `scripts/patch_p26_01_trip_attributions.cjs --commit` stamped legacy trip sub-attribution. First-load `reconcileFeederGroupsFromBreeders` enforces only the OPC=gilt+boar invariant when sex sums match parent; mismatches skipped with console warn. **Cattle bidirectional Send-to-Processor sync** (`f1adb81` + `448152e` flag-clear fix): migration **027** adds `weigh_ins.prior_herd_or_flock`. New `detachCowFromBatch` in `src/lib/cattleProcessingBatch.js` with fallback hierarchy: `prior_herd_or_flock` → `cattle_transfers` audit row → block with `no_prior_herd` (no silent default). CattleBatchesView removes manual cow multi-select + "+ Add cow from finishers" dropdown — batches are empty shells; cattle enter only via the `send_to_processor` flag. Detach wired into toggle-clear, entry delete, session delete, batch delete (with per-cow success/failure reporting). Detach also clears `send_to_processor` so the chip disappears (the 448152e fix). Migrations 001–026 archived to `supabase-migrations/archive/` with a README. **Sheep parity** (`802f393` Phase 2 + `6d70669` Phase 3 + `62e1064` gate loosen): migrations **028** (`sheep_processing_batches`) + **029** (`sheep_transfers` append-only audit). New `src/lib/sheepProcessingBatch.js` + `src/lib/sheepCache.js` + `src/sheep/SheepBatchesView.jsx` + `src/sheep/SheepSendToProcessorModal.jsx` + `src/sheep/SheepNewWeighInModal.jsx`. SheepWeighInsView rewritten 185 → ~390 lines: status filter + tag search + Edit / Delete + Swap Tag + Missing Tag + reconcile-new-tag + Send-to-Processor toggle + ADG. Sheep gate intentionally looser than cattle (any draft session, not feeders-only — Podio imports have herd=null). SheepFlocksView.transferSheep writes audit rows. SheepHome got a Processing Batches tile. WeighInsWebform extended for sheep send-to-processor end-to-end. **Pig FCR cache** (`a8c7133`): `parent.fcrCached` populates on trip add/edit/delete via `computePigBatchFCR` (adjusted feed ÷ total trip live wt); cleared via `delete next.fcrCached` when no valid trips remain so transfers fall back to 3.5 default rather than a stale ratio (Codex fix). PROJECT.md §1 SOP + §7 don't-touch unchanged except for new entries (prior_herd_or_flock semantics, detach fallback hierarchy, transfers append-only, batch membership rule, subAttributions schema, fcrCached clear-on-null). |

| 2026-04-28 | `0ad8fc2`..`3234ff6` | **Phase A2 + A4 of the Playwright test initiative.** 2 commits, both committed locally, neither pushed. Reviewer-driven session: Codex (running in parallel as relay-only review) gated every meaningful step. **A2 — Playwright harness against an isolated Supabase test project** (commit `0ad8fc2`). New test Supabase project (`msxvjupafhkcrerulolv`); `scripts/build_test_bootstrap.js` generates a 99 KB ordered SQL bundle (9 hand-created prod-table seeds + 26 archived migrations + 3 new migrations + test-only `exec_sql` function with revoked grants for non-service_role) so a fresh test project bootstraps in one paste. Discovered + documented that 9 prod tables are hand-created with no migration owning them (see §3 + §8 known gotcha). `tests/setup/assertTestDatabase.js` hard guard: throws unless `WCF_TEST_DATABASE === '1'` AND URL doesn't contain prod project ref `pzfujbjtayhkdlxiblwe` (7 vitest cases lock all rejection paths). `tests/setup/reset.js` TRUNCATEs a hardcoded 29-table whitelist via `exec_sql` RPC (defense in depth: env flag + URL match + service_role + whitelist + RLS-bypass-by-design). `tests/setup/global.setup.js` does one-time login → `tests/.auth/admin.json` storageState reused by all specs; **backend sentinel** (Codex-mandated) checks `window.__WCF_SUPABASE_URL` (DEV-only, tree-shaken from prod via `import.meta.env.DEV` gate) contains the test project ref before any login attempt — fails loudly with kill-the-zombie hint instead of silent "Invalid credentials" if a stale `npm run dev` zombie is squatting on 5173. `playwright.config.js` chromium-only, workers=1, `webServer: npm run dev:test` with `reuseExistingServer:false` and `--strictPort` (the actual root cause of an early debug session — a 9-AM zombie dev server on 5173 was serving the test in development+prod-Supabase mode while the new test mode bound 5174). `src/lib/supabase.js` URL/anon-key now read from `import.meta.env.VITE_X` with the existing prod literals as fallback (auth config — `detectSessionInUrl: false`, `storageKey: 'farm-planner-auth'`, `lock: pass-through` — untouched per §7). Verified zero diff in production bundle (1654.66 kB byte-identical). Smoke spec: 2 cases (dashboard renders without LoginScreen, supabaseAdmin query against test backend works). 3 commands green: `npm test` 53/53, `npm run build` clean, `npm run test:e2e` 4/4. **A4 — pig batch math regression spec** (commit `3234ff6`). One happy-path Send-to-Trip test using a `p2601Scenario` fixture (beforeEach reset+reseed). Scenario seeds the P-26-01 batch state from the 2026-04-27 PM accounting overhaul: parent giltCount=10 + boarCount=10, sub A 10 gilts (1 mortality, 2 transferred-to-breeding for 1000 lbs credit), sub B 10 boars, 4 dailys × 2500 lbs per sub (20000 lbs total raw), draft pig weigh-in session with 5 entries on sub A at 250 lbs each. Spec drives Send-to-Trip via UI ("Select all unsent (5)" + "→ Send 5 to Trip" + modal Send) and asserts: trip's `subAttributions = [{subId, subBatchName:'P-26-01A', sex:'Gilts', count:5}]` (matches §7 schema), parent tile shows `Current: 12` (20−5−2−1), parent tile shows `1118 lbs/pig` (19000/17, regression-locks the 1644 vs 1186 P-26-01A bug). Codex's 4th ask (FCR cache populates) was DEFERRED — Send-to-Trip in `LivestockWeighInsView.sendEntriesToTrip` doesn't run `computePigBatchFCR`; that contract lives in `PigBatchesView.persistTrip` (Edit Trip → Save). Mis-scoped during planning. Spec asserts `fcrCached` stays undefined post-Send-to-Trip (locks the contract negatively). A9 spec covers the populated path. Iteration findings (test-design bugs, not production): Playwright `selectOption` doesn't take RegExp for label (switched to exact `'P-26-01 (0 trips)'`); `pigSlug('P-26-01A') === 'p-26-01a'` no dash before the letter (uppercase becomes alphanumeric in `/[^a-z0-9]+/g` — see §8 known gotcha). Reviewer-driven changes between failing runs: switched to `expect.poll` around the persisted-trip read (decouples from modal-close timing), wrapped every Supabase write in a `must()` helper that throws with a precise label on schema drift, made admin email read from `process.env.VITE_TEST_ADMIN_EMAIL` instead of hardcoded. Final: `npm run test:e2e` 4/4 green at end of session. This row was written before the session-end push; A2/A4 were pushed later that same session. |

| 2026-04-28 PM | spec commits `e320237`..`d9fa8ba`; wrap docs in following commit | Playwright Phase 1 expanded from A5 through A8a: cattle processor, sheep processor, broiler timeline, pig FCR cache, and fuel PDF upload all shipped / pushed / deploy-verified. Current baseline: 34 e2e + 53 vitest green. A8b fuel reconciliation is next and plan-approved; A10 remains blocked by Initiative B. Durable gotchas added below. |

| 2026-04-28 (late PM) | `b2e3f13`..`0f57d47` | **Playwright Phase 1 closed + Initiative B Phase 1 + A10 CI live + equipment dashboard rollup.** 8 pushed commits across one long working session, all deploy-verified. **A8b fuel reconciliation UI spec** (`b2e3f13`) closes Playwright Phase 1 — 4 tests for variance bands (green/orange/red) + §7 cell-destination exclusion. Production patch adds `data-month` + `data-fuel-type` + `data-cell` on all 9 fuel-type cells per row plus `data-variance-band` on the 3 variance cells. New `varBand(pct)` helper sources from same `VARIANCE_WARN_PCT` constant as `varColor`. **Initiative B Phase 1** (`ed19d4d`) lands ESLint 9 flat config + Prettier 3 + 4 npm scripts + 6 devDeps. Conservative rules (`@eslint/js` recommended + `react-hooks/rules-of-hooks` scoped to src/ — tests/ Playwright `use()` fixture pattern collides with the heuristic). Initial baseline: 738 problems / 81 errors / 657 warnings. **Initiative B Phase 2.1 SheepBulkImport fix** (`900aed1`) extracts `VALID_BREED_STATUS` + `parseImportDate` + `parseImportNumber` + `normTagStr` from `CattleBulkImport.jsx` to a new `src/lib/bulkImport.js` shared module + 15 vitest cases + `/* global XLSX */` directives on both bulk-import files. Closes a latent runtime ReferenceError on `/sheep` bulk import (Phase 2 Round 2 verbatim extraction left the helpers undefined; never hit post-Vite because Ronnie's only sheep import used `scripts/import_sheep.cjs` (Node)). **Initiative B Phase 2.2 real-signal lint** (`5716838`) — 4 surgical fixes diagnosed individually: `main.jsx` `/* global XLSX */` directive (9 no-undef), `BatchForm.jsx:520` `setShowForm(false)` → `closeForm()` (real bug — broiler edit modal stayed open after delete because `setShowForm` was a stale reference from Phase 2 Round 6 extraction), `AdminAddReportModal.jsx` `housingBatchMap` state load via the existing Promise.all (real bug — layer-dailys "Active in batch" hint renders for the first time since pre-Vite; also dropped a stale 7-line header comment that documented the bug as "separate bug hunt"), `LivestockWeighInsView.jsx:729` dead-line removal (`{false && false && <span>...</span>}`). **Initiative B Phase 2.3 mechanical lint cleanup** (`8096226`) — 23 no-empty (16 silent with `_e` + comment, 7 `console.warn` for cascade-persistence), 12 no-useless-escape (regex char-class normalization, behavior-identical, vitest-covered in `bulkImport.test.js` + `fuelBillParser.test.js`), 2 no-empty-pattern (Playwright fixture inline-disable). **Lint baseline now 0 errors / 636 warnings**, the gate Codex named for A10. **A10 CI workflow** (`8906598`) — `.github/workflows/ci.yml` runs lint + vitest + build + e2e on every PR + push to main. Single sequential job, ubuntu-latest, Node 20, npm ci, Playwright cache by package-lock.json hash, fixed concurrency group `wcf-test-db` (cross-PR serialization to protect shared test Supabase project), 20-min timeout, `contents: read` only, artifacts uploaded on failure. 5 GitHub Actions secrets required (see §8 Near-term "A10 CI Actions secrets configuration"). First post-merge run validated lint/vitest/build/install/cache/artifacts; e2e fails fast on missing-secrets until Ronnie configures them — safe failure (assertTestDatabase guard). **Equipment dashboard rollup** (`a2159b5`) adds `upcoming` + `missed_fueling` alerts to the HomeDashboard EQUIPMENT ATTENTION section. Recon found §8's listed alerts (overdue / fillup_streak / warranty) were already implemented; these closed the gap. Auto-clear semantics on the new kinds (no Clear button); only `warranty` remains manually clearable. DEF-low warnings deferred (no current-level data model — `def_tank_gal` is a static spec, not a level reading). **Equipment alerts spec** (`0f57d47`) — A1 follow-up: 5 Playwright tests covering all five existing alert kinds. Production patch: `data-attention-kind` + `data-equipment-slug` on each attention row. Tests use double-attr selectors (defensive) + `toContainText` for midnight-flake safety on day counts. **Final state**: 0 lint errors / 636 warnings, 68 vitest, 43 e2e, A10 workflow live (pending secrets validation). |
| 2026-04-28 (eve) | (this commit) | **Feed physical count delivery-included flag** (queued late PM by Ronnie + Codex). Persists `inv.includesCurrentMonthDelivery: bool` on pig + per-poultry-type count records — when true, the count value is treated as already absorbing this month's feed delivery, so the count's-own-month order is suppressed from EOM math AND added to the system-side count-adjustment compare (so a perfect count shows zero phantom Adj). Default false; old records read as false. No DB migration. No §7 entries touched. Two views modified: **`src/pig/PigFeedView.jsx`** — save helper signature gains `includesCurrentMonthDelivery`; UI gains a bordered chip wrapping the checkbox + "Includes this month's feed delivery" label (single-line, black text, `accentColor:#000` checkbox, sits at input-row baseline via parent `flex-end`); top-tile EOM math at L187-194 skips count's-own-month order when flag fires; top-tile `physCountAdjustment` at L184-194 generalized to any count month — fresh reduce: orders strictly before `invYM` always, plus `invYM` only when flag=true (Codex-driven fix, also corrects pre-existing past-dated-count phantom adj); top-tile EOM helper copy at L268 switches to "Delivery included in count" when flag fires; ledger `lgCountAdj` at L332-336 includes count's-own-month order when flag=true; ledger `lgOrd` at L341 = 0 when flag=true; ledger entry adds `rawOrdered` + `deliveryInCount` so the per-month tile Ordered cell can render `(in count)` italic green hint instead of "arrives end of mo." for the count's month. **`src/broiler/BroilerFeedView.jsx`** — `useState` import, top-of-component `const [countType, setCountType] = useState('starter')` to make the feed-type dropdown controlled (Codex fix — the prior uncontrolled dropdown + uncontrolled checkbox was a stale-state trap when switching types); `<select>` becomes `value={countType} onChange={...}`; checkbox uses `key={countType}` so React remounts it with fresh `defaultChecked={!!pInv?.[countType]?.includesCurrentMonthDelivery}` on type switch; `savePoultryFeedCount` signature gains `includesCurrentMonthDelivery`; per-type ledger at L142-156 includes type's current-month order in `cAdj` when flag=true and excludes it from `ord` when flag=true; per-month tile Ordered cell renders `(in count)` hint when `lg.deliveryInCount` per type. UI iterations: chip first rendered with text wrapping into 3 lines and looking visually heavy; fixed via `whiteSpace:'nowrap'` + `display:'inline-flex'` + tighter padding; text + accentColor switched to pure black per Ronnie's preference. Codex review: 3 rounds — initial plan packet (approved with 2 open decisions resolved via AskUserQuestion), then 3 fixes called out (badge math reconciliation at 3 sites, EOM helper copy update, controlled dropdown), then a 4th: top-tile `physCountAdjustment` was only patched for current-month case — generalized to any count month to match the ledger's `lgCountAdj` shape. Pre-commit gate: **68/68 vitest, 0 errors / 636 warnings lint, clean build (6.21s)**. Browser smoke verified the chip UX + per-type checkbox refresh + `(in count)` hint placement; Codex-listed math invariants verified by inspection. PROJECT.md §8 "Next build" marked done; HO.md "Where we are" + prompts refreshed for next session. |

| 2026-04-28 (eve hotfix) | (this commit) | **HomeDashboard equipment-attention noise removal.** Single isolated commit, branched from `origin/main` so the 4 local Prettier commits would not contaminate the production hotfix. Codex flagged the operator-facing regression in screenshots: blue "due in X h" rows + orange "No fueling logged for N days" rows were flooding the home page with not-yet-actionable equipment status. Ronnie clarified the operational rule that drives this fix: **equipment maintenance/checklist obligations are hour/km-based; animal daily reports are the calendar/time-based workflow.** Calendar-time alerts on equipment confused the two systems and produced action-less noise. Hotfix scope: **`src/dashboard/HomeDashboard.jsx`** drops `kind:'upcoming'` (near-due-but-not-overdue services within 50h/km of next_due) and `kind:'missed_fueling'` (>14 days since last fueling); keeps `overdue` (still hour/km-based, actually past due), `fillup_streak` (real per-item checklist-completion miss across submitted fuelings — not time-based), `warranty`. Removes `MISSED_FUELING_DAYS` import (kept `daysSince` since warranty uses it), removes local `UPCOMING_WINDOW=50` constant, prunes `KIND_ORDER` to `{overdue:0, fillup_streak:1, warranty:2}`, prunes the palette branches, simplifies the click target so only `fillup_streak` routes to `/fueling/<slug>` and overdue+warranty go to `/equipment/<slug>`. **`tests/home_dashboard_equipment.spec.js`** rewrites the upcoming + missed_fueling positive tests as **negative regression locks**: same seed shapes (60h current vs 100h interval; fueling 20 days ago) but the assertion flips — `expect(page.locator('[data-equipment-slug=...]')).toHaveCount(0)`. Negative tests use the boot-loader fade-out (`#wcf-boot-loader` toHaveCount(0)) as a load gate, mirroring the smoke spec pattern. **`tests/scenarios/home_dashboard_equipment_seed.js`** adjusts the seed header to label upcoming/missed_fueling as NEGATIVE seeds; drops `expectedSubstrings` from those branches since negative tests don't assert text. PROJECT.md §8 sequencing #6 amended with hotfix note; §8 Near-term drops the "never logged" follow-up (unreachable now); §8 Known gotchas data-attention-kind hook list reduced to `overdue\|fillup_streak\|warranty`. HO.md "Where we are" + prompts refreshed. **Net live alert kinds: 3 (down from 5).** The 4 Prettier commits remain on local main, untouched, queued to rebase onto the new `origin/main` after this hotfix verifies in production. Pre-commit gate: vitest + lint + build all green; targeted Playwright run on home_dashboard_equipment.spec.js if test env available locally. |

| 2026-04-28 (eve+) | `f3862d9`..(this commit) | **Initiative B Phase 2.4 — Prettier go-live**, replayed on top of the eve hotfix. Codex flagged a sequencing concern after the original Prettier series committed locally: 4 commits queued behind a production-facing dashboard regression. Hotfix (cc457d7) shipped first, isolated on a branch from origin/main; Prettier was then **replayed** as 4 fresh commits on top of the post-hotfix HEAD rather than rebased through likely conflicts on HomeDashboard.jsx + the spec + seed + docs. The original 4 Prettier commits (8c60621 / e7ad316 / 32ed0c7 / 32a97d9) remain in the local reflog but never touched origin. **Commit 1 `f3862d9` `style: prettier autoformat src/`** — 110 files; main.jsx needed a second prettier --write pass on Windows (CRLF/LF round-trip). **Commit 2 `4158257` `style: prettier autoformat tests/ + configs + supabase-functions`** — 26 files; preserves the negative-test pattern from the eve hotfix on home_dashboard_equipment.spec.js. **Commit 3 `489ec51` `style: prettier autoformat scripts/`** — 67 files. **Commit 4 (this) `ci: enforce prettier in CI + docs for Phase 2.4 wrap`** — `.github/workflows/ci.yml` gains `Format check (prettier)` step between Playwright install and lint, so future PRs and pushes to main are gated on Prettier formatting. `npm run format:check` runs in seconds and fails fast before the heavier e2e step. PROJECT.md §8 deferred Phase 2.4 marked DONE; HO.md "Where we are" + prompts refreshed to name all three of today's builds. Format-only across the 3 chunks; no semantic changes; §7 invariants spot-verified per chunk on the prior original-series pass. **Three builds shipped this session:** (1) feed delivery-included flag (eve), (2) HomeDashboard equipment-attention noise removal (eve hotfix), (3) Prettier go-live + CI enforcement (eve+). Pre-commit gate (full repo): prettier --check clean, vitest 68/68, lint 0 errors / 636 warnings, build clean. CRLF/LF warnings on Windows are git auto-conversion notices and don't represent file corruption — content is LF on disk per Prettier default. |

| 2026-04-28 (eve drift) | `2e02f81` | **HomeDashboard equipment current-reading drift fix (Phase 0 ahead of Initiative C).** Read-only recon (`scripts/recon_initiative_c.cjs`, new file in this commit) found anon UPDATEs to `equipment.current_hours/km` from the public `/fueling/<slug>` webform are silently failing under prod RLS for 6 of 16 active pieces. With **latest-by-date** comparison (matches the shipped helper): hijet-2020 +182km, ps100 +14h, honda-atv-1 +13h, honda-atv-2 +8h, honda-atv-3 +5.5h, l328 +2h. The honda-atv-1 row is the operative case for the date-ordering choice — under max-reading ordering it would have surfaced as +4349h drift (a 2025-01-11 legacy import outlier of 5437h vs the actual recent fueling at 1101h). Without the fix, HomeDashboard's overdue-interval math runs against stale `equipment.current_*` values and underreports overdue services. **`src/lib/equipment.js`** gains `latestSaneReading(eq, fuelings)` helper. Picks the latest fueling by **date** (not by reading magnitude) so legacy import outliers don't propagate. Returns the fueling reading when it exceeds `equipment.current_*`, falls back to `equipment.current_*` otherwise (admin manual corrections stay authoritative when ahead). Handles blank/undefined `equipment.current_*` by returning the latest fueling reading rather than NaN — Codex caught this edge case before commit. **`src/dashboard/HomeDashboard.jsx`** swaps the overdue-interval calc's reading source to call `latestSaneReading(eq, equipmentFuelings[eq.id] || [])`. Comment explains the recon-driven motivation. **`src/lib/equipment.test.js`** adds 7 vitest cases: latest-fueling-wins, admin-ahead-fallback, no-fuelings-fallback, outlier-rejection-via-date (locks the honda-atv-1 case), km-unit handling, wrong-column safety, blank-current-* edge case. **`scripts/recon_initiative_c.cjs`** — read-only audit script (no production writes, no `exec_sql` install attempted on prod). Comments explicitly state we deliberately did NOT install `exec_sql` in prod for the `pg_policies` recon branch (test-DB-only). Re-runnable for future drift checks; orders by date desc to match `latestSaneReading`'s contract. Pre-commit gate: vitest 75/75 (was 68 + 7 new), lint 0 errors / 636 warnings, build clean (7.14s), targeted Playwright on `home_dashboard_equipment.spec.js` 7/7. The 5-row attention spec still passes (3 positive + 2 negative locks) — the helper switch doesn't regress existing alert behavior. Equipment Reading Reconciliation Follow-Up tracked separately in §8 Near-term. |
| 2026-04-28 (eve queue) | `9e93e0a` | **Initiative C Phase 1A — offline queue schema contracts (DB-only).** Two new migrations land the schema the IndexedDB queue + photo-capable webform UX will depend on. NO UI / queue / service-worker changes; runtime build will land additively in later phases. **`supabase-migrations/030_offline_queue_contracts.sql`** adds nullable `client_submission_id text` + a non-partial unique index on each of 9 webform-target tables: `pig_dailys`, `poultry_dailys`, `layer_dailys`, `cattle_dailys`, `sheep_dailys`, `weigh_in_sessions`, `weigh_ins`, `equipment_fuelings`, `fuel_supplies`. Index is non-partial (no `WHERE … IS NOT NULL` predicate) so PostgREST's `.upsert(onConflict: 'client_submission_id')` can match the conflict target directly — partial-predicate indexes can't be expressed in PostgREST's onConflict syntax (Codex blocker fix before commit). Postgres NULLS DISTINCT semantics keep legacy null rows valid. Also adds `photos jsonb NOT NULL DEFAULT '[]'::jsonb` to the 5 daily-report tables (pig/poultry/layer/cattle/sheep_dailys), mirroring `equipment_fuelings.photos` shape from migration 018. Deliberately NO photos column on `egg_dailys` (Ronnie's call: no photo capture planned), `fuel_supplies` (anon webform; no photos planned), `weigh_in_sessions`/`weigh_ins` (numeric-only flow), `equipment_fuelings` (already has photos jsonb). All `ALTER TABLE IF EXISTS / ADD COLUMN IF NOT EXISTS / CREATE UNIQUE INDEX IF NOT EXISTS` — fully idempotent. **`supabase-migrations/031_daily_photos_bucket.sql`** creates a NEW private `daily-photos` storage bucket (`public=false`) for daily-report uploads, separate from the existing public-readable `equipment-maintenance-docs`. Two new RLS policies on `storage.objects` scoped to `bucket_id='daily-photos'` (each in a `DO $$ … IF NOT EXISTS (SELECT 1 FROM pg_policies …) … END $$` block since Postgres has no `CREATE POLICY IF NOT EXISTS`): `daily_photos_anon_insert` (anon write, with `bucket_id` check) + `daily_photos_auth_select` (authenticated read; signed URLs gate access in app code). NO public SELECT → uploads aren't open-web readable. NO anon UPDATE/DELETE → operators submit-and-walk-away. NO anon UPDATE on equipment (recon-proven broken; queue replay does not retry it). **Migration 031 deliberately omits policy-capture for existing webform tables.** Recon found every policy in Ronnie's pg_policies dashboard export is already captured in existing migrations (001 / 009 / 016 / 018 / 024 / 026); restating them would just duplicate migration history. Filename narrowed from Codex's expected `031_webform_rls_and_daily_photos.sql` to `031_daily_photos_bucket.sql` reflecting actual content. Pre-commit gate: `node scripts/build_test_bootstrap.js` regenerated `scripts/test-bootstrap.sql` (31 migrations + exec_sql, 116.8 KB), format:check clean, vitest 75/75, lint 0 errors / 636 warnings, build clean. Phase 1B (registry + IndexedDB queue + canary form wire-up) is the next implementation phase — see §8 Initiative C v1 plan capture. |
| 2026-04-28 (eve wrap) | (this commit) | **Session wrap commit.** Per the new doc-cadence rule (memory: `feedback_doc_update_cadence`), build commits 2e02f81 + 9e93e0a shipped without PROJECT.md/HO.md edits. This wrap consolidates: §Part 4 rows for eve drift (Phase 0) + eve queue (Phase 1A) + this wrap, §7 entries for the new `daily-photos` bucket and `client_submission_id` semantics + the RLS-disabled note on the 3 hand-created daily-report tables, §8 Initiative C v1 plan capture (locked decisions, phase plan, schema additions) replacing the prior "PWA shell — lowest urgency" placeholder, §8 Near-term Equipment Reading Reconciliation Follow-Up entry, HO.md "Where we are" + state-at-session-start + CC + Codex prompts refreshed for tomorrow's session. **Final session score: 7 commits, 4 prod deploys, all bundle-hash-verified.** (1) feed delivery-included flag, (2) dashboard noise removal hotfix, (3-6) Prettier go-live x4 commits, (7) Phase 0 drift fix; Phase 1A schema contracts not deployed (DB-only, requires Ronnie's manual SQL run for migrations 030 + 031 against prod when convenient). Pre-commit gate (this wrap): vitest 75/75, lint 0 errors / 636 warnings, format:check clean, build clean. |
| 2026-04-30 | `c619176`..`00754c3` | **Initiative C Phase 1C-D + Phase 1D-A/B + broiler public schooner mirror + admin broiler metadata edit.** 7 build commits, 4 prod deploys verified by asset-hash rotation + behavior probe. (1) `c619176` PWA `manifest.webmanifest` `start_url` `/` → `/webforms` so Add to Home Screen lands on the public operator hub. (2) `93e0911` Phase 1C-D: WeighIns runtime wiring routes pig + broiler **fresh draft session** creation through `useOfflineRpcSubmit('weigh_in_session_batch')` against mig 035's RPC. Cattle/sheep paths and the entire completion flow stay online-direct. State machine via `sessionIsFresh`; classifier treats P0001 as schema-class on both status-known + codeless branches; pre-deploy probe `scripts/probe_weigh_in_session_batch_rpc.cjs` runs an anon RPC with empty payload expecting P0001 + `client_submission_id required`. 11 Playwright cases in `tests/offline_queue_weigh_ins.spec.js`. (3) `2ed4177` Phase 1D-A: PigDailys standalone webform photo offline queue. New IDB store `photo_blobs` (atomic 2-store transaction in `enqueueSubmissionWithPhotos`); prepared-photo flow (compress ONCE at submit, replay with `upsert:false` because anon RLS on `daily-photos` only grants INSERT, not UPDATE); 401/403 → stuck-modal immediate, 409 → success-continue, 5xx/429 → queue, P0001 → schema. Pre-deploy probe `scripts/probe_daily_photos_bucket.cjs` verifies bucket contracts (anon INSERT succeeds, anon SELECT denied). 23 vitest + 9 Playwright cases. (4) `b2d5882` Phase 1D-B: WebformHub broiler/pig/cattle/sheep daily-report photo offline queue. 4 hooks mounted at WebformHub top; aggregated stuck-rows modal across all 4 forms with `hookByFormKind` dispatch for retry/discard. Layer + egg paths in WebformHub deliberately stay online-direct. 19 vitest + 10 Playwright cases. (5) `ca57de7` Broiler public schooner mapping via webform_config mirror. New `src/lib/broilerBatchMeta.js` helper (`splitSchooners`, `buildBroilerPublicMirror`, `deriveBroilerColumnLabels`) exported as the single source of truth; both `main.jsx` writer sites (app-load block + `syncWebformConfig`) call the helper so `webform_config.broiler_groups` + `webform_config.broiler_batch_meta` cannot drift. Public form switched from `app_store.ppp-v4` (anon-blocked) to `webform_config.broiler_batch_meta`; both `(no schooner)` and `['1','2']` fallbacks deleted from fresh start AND resume; empty-schooner active batches block Start Session with explicit copy. Broiler terminal "New Weigh-In" CTA hidden on both queued + online done screens (cattle/sheep/pig keep it). "Blanks are skipped" hint label removed (saveBatch filtering unchanged). Static lock `tests/static/weighinswebform_no_app_store.test.js` asserts the public form file has zero `app_store` / `ppp-v4` literals; network lock asserts zero `/rest/v1/app_store` requests during the public broiler flow. (6) `ee01bc3` Public broiler dropdown active-only follow-up. `buildBroilerPublicMirror` filter tightened from `status !== 'archived' && status !== 'processed'` to `status === 'active'` after a planned batch surfaced live; helper test sample unchanged but assertions inverted to lock active-only + planned-dropped behavior. (7) `00754c3` Admin broiler session metadata edit. New `recomputeBroilerBatchWeekAvg(sb, batchId, week, {excludeSessionId})` helper in `src/lib/broiler.js` returning `{ok, message?}` (`{ok:true}` covers successful writes AND intentional no-ops; only Supabase errors are loud). `/broiler/weighins` expanded broiler rows surface an always-visible inline metadata panel (broiler-only) for `broiler_week` (WK 4 / WK 6 toggle) + `team_member` dropdown. On a complete session whose `broiler_week` changes, `app_store.ppp-v4[batch].wk*Lbs` for the OLD week recomputes from the latest OTHER complete session via `excludeSessionId`, or DELETEs the wk*Lbs key when no other session backs it; NEW week stamped via existing `writeBroilerBatchAvg`. Draft sessions + team-only edits do NOT touch ppp-v4. Historical `team_member` values not in the active roster are preserved in the dropdown with a `(retired)` marker per-session — saves don't force a team change. 13 vitest + 7 Playwright cases. **Deploy verifications** (asset-hash rotation + behavior probe):  `b2d5882` `BtZjlTcU → B1A7owOu`, `/webforms` 200; `ca57de7` `B1A7owOu → BXUd1xiw`, `/weighins` 200; `ee01bc3` `BXUd1xiw → BA49uByv`, `/weighins` 200; `00754c3` `BA49uByv → Ck_R1zlv`, `/broiler/weighins` 200, bundle markers `broiler-meta-panel` + `SESSION METADATA` present. Codex relayed multi-round reviews on every lane; pre-commit packets included full gate reports (format:check / lint / vitest / build / focused Playwright / adjacent sanity Playwright). No new migrations, no RLS / RPC / cattle / sheep / public-form / active-only-mirror changes in the admin metadata-edit lane. §7 entries added for the broiler public-mirror contract and the admin metadata-edit + `recomputeBroilerBatchWeekAvg` helper. §8 follow-up: reopen-session avg cleanup (same staleness class as the WK-change case; deferred). |
| 2026-05-01 | `4874f1d` + this wrap | **Broiler reopen avg cleanup + Tasks Module Phase A + future-build planning.** `2dcdb20` fixed the deferred broiler stale-average case: reopening a complete broiler session now excludes that session and recomputes/clears `ppp-v4 wk*Lbs` via the same helper contract as the metadata-edit lane. `4874f1d` shipped Tasks Phase A (migs 036-038): task tables, `is_admin()` helper + RLS policies, indexes, private `task-photos` bucket, and a TEST recon script. TEST recon was green across anon/farm_team self/farm_team other/admin/service-role plus task-photos bucket policies; PROD + TEST + source are aligned. Decisions locked for Tasks Phase B: pg_cron + pg_net + Vault, daily generator 04:00 UTC, weekly summary Monday 13:00 UTC, quarterly recurrence included, and no required-photo behavior anywhere. Planning captured for future cattle work: Herd tab filter/sort rebuild with maternal issue retired from cattle, and a Forecast tab replacing the Excel finisher forecast workflow with live projections, planned batches, ADG rules, and saved overrides. |
| 2026-04-29 | `b5a07a9` + this wrap | **Initiative C Phase 1B — adapter foundation + FuelSupply canary** (1 build commit + 1 doc-wrap commit). **Build commit (`b5a07a9`):** New deps `idb` + `fake-indexeddb`. Five new lib modules (`src/lib/clientSubmissionId.js` / `offlineForms.js` / `offlineQueue.js` / `photoCompress.js` / `useOfflineSubmit.js`) totaling 49 new vitest cases. New shared `src/webforms/StuckSubmissionsModal.jsx`. `FuelSupplyWebform.jsx` rewired through `useOfflineSubmit('fuel_supply')` with dual synced/queued copy + stuck-modal trigger in the header. PWA scaffolding: `public/manifest.webmanifest` (name/short_name/start_url/display/theme_color/background_color + 192/512 icons), `public/icons/icon-{192,512}.png` placeholder tiles generated reproducibly via `scripts/generate_pwa_icons.cjs` (pure-Node PNG encoder, no canvas/sharp dep). `index.html` link rel=manifest + meta theme-color + apple-touch-icon. No service worker yet (Phase 3). Two new Playwright specs: `tests/offline_queue_canary.spec.js` (3 tests under anon context — synced / queued / recovery) + `tests/offline_queue_dedup.spec.js` (4 tests covering service-role upsert, distinct csids, NULLS DISTINCT, anon insert + 23505 + the upsert-fails-as-anon negative lock). New `tests/scenarios/fuel_supply_offline_seed.js` + fixture wiring. Test-DB utilities `scripts/apply_test_offline_migrations.cjs` (030 only — 031 errors out through exec_sql, documented inline) + `scripts/reload_test_schema.cjs` (NOTIFY pgrst). **Design correction during build:** Codex's plan packet specified `.upsert(record, {onConflict: 'client_submission_id', ignoreDuplicates: true})`. That returned 42501 RLS denial under anon every time — PostgREST's `ON CONFLICT` path requires SELECT privilege on the conflict-target column, and the public webform tables (fuel_supplies / weigh_ins / weigh_in_sessions / equipment_fuelings) grant anon INSERT only. Switched to plain `.insert(record)` + treat 23505 referencing `*_client_submission_id_uq` as already-synced. Same idempotency guarantee from the unique index alone, no RLS expansion. Documented inline at top of `useOfflineSubmit.js` and locked in dedup spec Test 4 + the §7 entry on `client_submission_id`. **Codex-flagged limbo bug fixed pre-commit:** `recoverStaleSyncing(formKind, {staleAfterMs: 30_000})` resets orphan `syncing` rows back to `queued` on every sync pass. A row that flipped to `syncing` but never reached `markSynced`/`markFailed` (tab close, reload, crash mid-flight) would otherwise sit in limbo indefinitely — `listQueued` only returns `queued`, `listStuck` only returns `failed`. 5 new vitest cases lock the contract: orphan recovery, fresh-row-untouched, no retry-count-bump, formKind-filter, custom-threshold. Background sync triggers: `online` event + 60s tick + manual button + mount. 3-retry budget then stuck-modal surface (matches §8 v1 plan capture). Pre-commit gate: vitest 129/129, lint 0 errors / 638 warnings (was 636; +2 from new JSX imports per existing repo convention — same shape as FuelingHub), format:check clean, build clean, Playwright Phase 1B specs 9/9. **Prod deploy verified:** bundle hash rotated `B1aTCUgy → CBq-evJH`, `/manifest.webmanifest` 200, `/icons/icon-192.png` 200, `index.html` carries the manifest + theme-color + apple-touch-icon links. Migration 030 applied to prod 2026-04-29; mig 031 (`daily-photos` bucket) still pending manual SQL Editor apply (Phase 2 dependency, not Phase 1B). **Wrap commit (this):** §7 amends the `client_submission_id` entry to capture the anon-insert + 23505 contract; §8 Initiative C v1 plan marks Phase 1B done + carries forward the design correction; §8 sequencing list gets a #7 entry; new §8 "Locked decisions for queued builds" subsection captures Ronnie's roadmap (Team Member Master List Cleanup as next build, Daily Report Photos pig/poultry/layer/cattle/sheep scope, Add Feed parent-submission RPC preference, cattle calf-count + heifer-auto-promote, equipment material list, Tasks module v1 spec, small cleanup); §Part 4 row (this) added. |

**How to use this index:** if you need the exact commit message or a specific bugfix commit, run `git log --oneline <date>..` or filter by filename. If you need the narrator's-voice session-end summary, see the matching block in `archive/SESSION_LOG.md`. Git log is the authoritative timeline — this table is just the map.



