# WCF Planner — Vite Migration Plan

**Status:** Draft for Ronnie's review. **Do NOT begin migration until approved.**
**Branch:** `vite-migration` (current). `main` stays deployable until cutover.
**Backup:** `~/OneDrive/Desktop/WCF-planner-backups/index.html.pre-vite-2026-04-19` (SHA `1a535f73…`).
**Drafted:** 2026-04-19, after reading the full `index.html` (19,445 lines, 39 components).

---

## 1. Goals + non-goals

### Goals
- Replace in-browser Babel transpilation with a proper Vite build (cold-load on mobile drops from "noticeable" to "imperceptible").
- Split the single 19k-line `index.html` into a feature-organized `src/` tree so single-file accidents stop being catastrophic.
- Add real URLs + working browser back button via React Router.
- Same Supabase backend, same Netlify deploy, same domain, same auth, same edge function. **Zero new services or logins.**
- Existing webform bookmarks (`wcfplanner.com/#weighins`, `/#webforms`, `/#addfeed`) keep working transparently.

### Non-goals (during this migration)
- No feature changes. Behavior identical to the pre-migration build.
- No TypeScript conversion (stays JSX).
- No test suite (separate effort if/when desired).
- No CSS framework switch (existing inline styles + scoped `#webform-container` styles ported as-is).
- No Supabase schema changes.
- No edge function changes (`rapid-processor` untouched).
- No "clever" refactors (Babel-in-browser-specific patterns like `\u` JSX escapes stay; removing them is risk-for-nothing).

---

## 2. Decisions locked (from 2026-04-19 Q&A)

| Decision | Choice |
|---|---|
| Router | **BrowserRouter** + on-load hash-compat shim (existing `/#weighins` etc. `history.replaceState`'d to clean paths) |
| Folder layout | **By feature** — `src/auth/ src/webforms/ src/admin/ src/cattle/ src/sheep/ src/broiler/ src/layer/ src/pig/ src/dashboard/ src/shared/` |
| Shared state | **Multiple feature-scoped React Contexts** (AuthContext, BatchesContext, DailysContext, CattleContext, SheepContext, WebformsConfigContext, FeedCostsContext). NOT one god-Context, NOT Zustand. |
| Package manager | **npm** (already installed `node_modules`, matches Netlify default) |

---

## 3. Current state inventory (what we're moving)

### File shape
- `index.html` — 19,445 lines. Structure:
  - Lines 1–207: `<head>` (CDN scripts, base CSS, webform CSS, Babel cache helper, lazy-XLSX helper, boot loader CSS).
  - Lines 208: opens `<script type="text/jsx-source" id="wcf-app-source">`.
  - Lines 209–19347: the entire JSX app source as a single string.
  - Line 19348: closes that script.
  - Lines 19349–19445: bootstrap (`Babel.transform` → `eval`, with localStorage cache lookup).

### Top-level CDN dependencies (all become npm packages)
- `react@18` + `react-dom@18` → `npm i react react-dom`
- `@babel/standalone` → **removed entirely** (Vite handles transpilation at build time)
- `@supabase/supabase-js@2` → `npm i @supabase/supabase-js`
- `xlsx@0.18.5` (lazy-loaded from cdnjs via `_wcfLoadXLSX`) → `npm i xlsx` + `await import('xlsx')`
- Geist font from Google Fonts → keep as `<link>` in `index.html` template

### Top-level helpers + globals (move to `src/lib/`)
- `sb` — Supabase client init (with `detectSessionInUrl: false`, `storageKey: 'farm-planner-auth'`). **Critical config — preserve verbatim.**
- `wcfSendEmail(type, data)` — fire-and-forget edge function call.
- `wcfSelectAll(buildRangeQuery, pageSize)` — **the pagination helper Ronnie called out**. `.range(from, from+999)` in a loop; `.limit()` silently caps at 1000. **Move verbatim. Do not touch.**
- `loadCattleWeighInsCached(sb)` — two-query pattern (session IDs first, then `weigh_ins.in()`). **No `!inner` joins.** Keep verbatim.
- `wcfFmt`, `wcfToISO`, `addDays`, `todayISO`, `wcfPersistData` (debounced jsonb blob save), `cycleHashSeed`, etc.
- `_wcfLoadXLSX` — replaced by `await import('xlsx')` once on Vite.
- `_wcfBabelCache` — entire mechanism deleted in Phase 1.

### Component inventory (39 total)
Grouped by target folder.

**`src/auth/`** (3)
- `SetPasswordScreen` — invite/recovery landing. Manually parses `#access_token` from URL hash because `detectSessionInUrl: false`. **Fragile + critical.**
- `LoginScreen` — email/password sign-in + forgot-password.
- `UsersModal` — admin user management (add/delete/role/program-access).

**`src/webforms/`** (3) — public, no auth required
- `AddFeedWebform`
- `WeighInsWebform`
- `WebformHub`

**`src/admin/`** (4)
- `FeedCostsPanel`, `FeedCostByMonthPanel`, `LivestockFeedInputsPanel`, `NutritionTargetsPanel`

**`src/shared/`** (5)
- `DeleteModal`, `WcfYN`, `WcfToggle`, `AdminAddReportModal`, `AdminNewWeighInModal`

**`src/broiler/`** (1 + several inline-in-App)
- `BroilerDailysView` (extracted)
- `BroilerHomeView`, `BatchesListView`, `TimelineView`, `FeedView`, `BatchForm` (currently inline JSX inside `App()` — must be extracted in Phase 2 Round 6)

**`src/layer/`** (4)
- `LayersView`, `LayerBatchesView`, `LayerDailysView`, `EggDailysView`
- `LayersHomeDashboard` (currently inline in App)

**`src/pig/`** (1 + several inline-in-App)
- `PigDailysView` (extracted)
- `PigsHomeDashboard`, `PigBreedingView`, `PigFarrowingView`, `PigSowsView`, `PigBatchesView`, `PigFeedView`, `BreedingForm`, `FarrowingForm`, `FeederForm`, `BreederForm` (inline)

**`src/cattle/`** (8)
- `CattleHomeView`, `CattleHerdsView`, `CowDetail`, `CollapsibleOutcomeSections`, `CattleBreedingView`, `CattleBatchesView`, `CattleDailysView`, `CattleWeighInsView`, `CattleBulkImport`, `CattleNewWeighInModal`

**`src/sheep/`** (6)
- `SheepHomeView`, `SheepFlocksView`, `SheepDetail`, `SheepDailysView`, `SheepWeighInsView`, `SheepBulkImport`

**`src/livestock/`** (2 — broiler + pig shared weigh-in flow)
- `LivestockWeighInsView`, `PigSendToTripModal`

**`src/dashboard/`** (1 huge, currently inline in App)
- `HomeDashboard` — top stats, missed reports, NEXT 30 DAYS, LAST 5 DAYS section. Probably the single biggest extraction effort because it consumes ~all of App's state.

**`src/equipment/`** (1)
- `EquipmentPlaceholder` — current "coming soon" stub. Easy.

### `App()` state — 50+ useState hooks
Will be split across these contexts (Phase 2 Round 0):

| Context | Owns |
|---|---|
| `AuthContext` | `authState`, `pwRecovery`, `dataLoaded`, `saveStatus`, `showUsers`, `allUsers`, `inviteEmail`, `inviteRole`, `inviteMsg` |
| `BatchesContext` | `batches`, `view` (initially), `showForm`, `editId`, `form`, `originalForm`, `conflicts`, `tlStart`, `tooltip`, `override`, `showLegacy`, `parsedProcessor`, `docUploading`, `deleteConfirm` |
| `PigContext` | `pigData`, `breedingCycles`, `farrowingRecs`, `boarNames`, `feederGroups`, `breeders`, `breedOptions`, `originOptions`, all pig form state (`showBreedForm`, `showFarrowForm`, `showFeederForm`, `breedForm`, `farrowForm`, `feederForm`, `editBreedId`, etc.), `archivedSows`, `expandedSow`, `sowSearch`, `activeTripBatchId`, `tripForm`, `editTripId` |
| `LayerContext` | `layerGroups`, `layerBatches`, `layerHousings`, `allLayerDailys`, `allEggDailys`, `layerDashPeriod`, `retHomeDashPeriod` |
| `DailysRecentContext` | `broilerDailys`, `pigDailys`, `layerDailysRecent`, `eggDailysRecent`, `cattleDailysRecent`, `sheepDailysRecent` (all fed by App-level loaders + `refreshDailys`) |
| `CattleHomeContext` | `cattleForHome`, `cattleOnFarmCount` |
| `SheepHomeContext` | `sheepForHome` |
| `WebformsConfigContext` | `wfGroups`, `wfTeamMembers`, `webformsConfig` |
| `FeedCostsContext` | `feedCosts`, `broilerNotes`, `missedCleared` |
| `UIContext` | `view`, `pendingEdit`, `showAllComparison`, `showMenu` |

### View dispatcher
`App()` currently has ~40 `if(view === "X") return React.createElement(...)` lines. In Phase 3 these become `<Route path="/X" element={<X/>} />` declarations.

### Hash routing today (becomes BrowserRouter routes + shim)
- `/#weighins` → `<WeighInsWebform>`
- `/#webforms` → `<WebformHub>`
- `/#addfeed` → `<AddFeedWebform>`
- `/#access_token=…&type=recovery` → `<SetPasswordScreen>` (kept as hash because Supabase recovery links generate this format)

### Gotchas the migration must respect (the "don't touch" list)
1. `wcfSelectAll` pagination pattern. Move file, don't rewrite.
2. Two-query `loadCattleWeighInsCached` pattern. No `!inner` joins anywhere.
3. `detectSessionInUrl: false` Supabase config + `storageKey: 'farm-planner-auth'`.
4. Source-label workflow (`'import'` / `'weigh_in'` / `'manual'`) for `old_tags`.
5. `cellDates:true` in any `XLSX.read()` call.
6. Webform URLs: `/#weighins`, `/#webforms`, `/#addfeed` must keep working.
7. `_wcfPersistData` debounce + jsonb blob save to `app_store` table.
8. `\u`-escaped JSX literals (em-dashes, bullets, etc.) — leave them. Removing mid-migration is pure risk.
9. Per-program access gates (`canAccessProgram`, `VIEW_TO_PROGRAM` map). Move to a hook (`usePermissions`), don't redesign.
10. `SetPasswordScreen` URL-hash token parsing + `setSession` fallback. Test after every Phase 1 + Phase 3 commit.

---

## 4. Target architecture

```
WCF-planner/
├─ index.html              # Vite entry (~30 lines: head, root div, script src=main.jsx)
├─ vite.config.js
├─ package.json
├─ public/
│  ├─ _redirects           # Netlify SPA fallback: /*  /index.html  200
│  └─ favicon.ico
├─ src/
│  ├─ main.jsx             # ReactDOM root, RouterProvider
│  ├─ App.jsx              # Layout + provider tree + <Outlet/>
│  ├─ routes.jsx           # All <Route> declarations
│  ├─ lib/
│  │  ├─ supabase.js       # sb client init (detectSessionInUrl:false etc.)
│  │  ├─ pagination.js     # wcfSelectAll
│  │  ├─ email.js          # wcfSendEmail
│  │  ├─ dateUtils.js      # toISO, addDays, todayISO, wcfFmt
│  │  ├─ persist.js        # wcfPersistData debounce
│  │  └─ permissions.js    # canAccessProgram, VIEW_TO_PROGRAM
│  ├─ contexts/
│  │  ├─ AuthContext.jsx
│  │  ├─ BatchesContext.jsx
│  │  ├─ PigContext.jsx
│  │  ├─ LayerContext.jsx
│  │  ├─ DailysRecentContext.jsx
│  │  ├─ CattleHomeContext.jsx
│  │  ├─ SheepHomeContext.jsx
│  │  ├─ WebformsConfigContext.jsx
│  │  ├─ FeedCostsContext.jsx
│  │  └─ UIContext.jsx
│  ├─ shared/
│  │  ├─ DeleteModal.jsx
│  │  ├─ WcfYN.jsx
│  │  ├─ WcfToggle.jsx
│  │  ├─ AdminAddReportModal.jsx
│  │  ├─ AdminNewWeighInModal.jsx
│  │  └─ Header.jsx        # extracted from App
│  ├─ auth/
│  │  ├─ SetPasswordScreen.jsx
│  │  ├─ LoginScreen.jsx
│  │  └─ UsersModal.jsx
│  ├─ webforms/
│  │  ├─ AddFeedWebform.jsx
│  │  ├─ WeighInsWebform.jsx
│  │  └─ WebformHub.jsx
│  ├─ admin/
│  │  ├─ FeedCostsPanel.jsx
│  │  ├─ FeedCostByMonthPanel.jsx
│  │  ├─ LivestockFeedInputsPanel.jsx
│  │  └─ NutritionTargetsPanel.jsx
│  ├─ dashboard/
│  │  └─ HomeDashboard.jsx
│  ├─ broiler/
│  ├─ layer/
│  ├─ pig/
│  ├─ cattle/
│  ├─ sheep/
│  ├─ livestock/
│  └─ equipment/
├─ supabase-migrations/    # unchanged
├─ scripts/                # unchanged (one-off Node import scripts)
├─ PROJECT.md              # unchanged
├─ DECISIONS.md            # unchanged
└─ MIGRATION_PLAN.md       # this doc
```

---

## 5. Phase 1 — Vite scaffolding (commit-by-commit)

Goal: app runs identically to today, just from a Vite build instead of Babel-in-browser. **Zero JSX changes.** No component extraction. No routing changes. Just toolchain.

| # | Commit | Verification |
|---|---|---|
| 1.1 | `Add Vite scaffolding (package.json, vite.config.js, .gitignore)` | `npm install` succeeds, `dist/` and `node_modules/` ignored |
| 1.2 | `Move app source to src/main.jsx (no logic changes)` | New file is the contents of the old `<script type="text/jsx-source">` block, line-for-line, with the supabase-js + xlsx CDN globals replaced by ESM imports at the top |
| 1.3 | `Replace CDN script tags with ESM imports` | `index.html` becomes ~30 lines (head, root div, `<script type="module" src="/src/main.jsx">`); React/ReactDOM/supabase-js imported in main.jsx |
| 1.4 | `Replace _wcfLoadXLSX CDN call with await import("xlsx")` | xlsx still lazy-loads, just from npm not cdnjs |
| 1.5 | `Remove Babel cache + bootstrap script` | `_wcfBabelCache` localStorage helper deleted; bootstrap eval script deleted; existing localStorage `wcf-babel-*` keys harmless (untouched) |
| 1.6 | `Add Netlify _redirects for SPA fallback` | `public/_redirects`: `/*  /index.html  200` so deep links don't 404 |
| 1.7 | `Update Netlify build: npm run build, publish dist/` | Verify on a deploy preview branch BEFORE merging to main |

**Smoke test after each commit (Section 8 below).**

**Cutover (end of Phase 1):** merge `vite-migration` into `main`, push, watch Netlify deploy. Run smoke test on production. Have rollback ready (`git revert` the merge commit) if anything breaks.

---

## 6. Phase 2 — Component extraction (commit-by-commit, ordered)

Goal: split the monolithic `src/main.jsx` (still ~19k lines after Phase 1) into the feature folders.

**Round 0 — Contexts FIRST.** Without this, every extracted component just becomes a tendril back to a god-object App.
| # | Commit |
|---|---|
| 2.0.1 | `Extract AuthContext` |
| 2.0.2 | `Extract BatchesContext` |
| 2.0.3 | `Extract PigContext` |
| 2.0.4 | `Extract LayerContext` |
| 2.0.5 | `Extract DailysRecentContext (incl. cattle + sheep recent)` |
| 2.0.6 | `Extract CattleHomeContext + SheepHomeContext + WebformsConfigContext + FeedCostsContext + UIContext` |

After Round 0, App.jsx wraps everything in a provider tree but otherwise unchanged.

**Round 1 — Leaf components (no shared state, lowest risk).**
| # | Commit |
|---|---|
| 2.1.1 | `Extract WcfYN + WcfToggle to src/shared/` |
| 2.1.2 | `Extract DeleteModal to src/shared/` |
| 2.1.3 | `Extract Header to src/shared/` |
| 2.1.4 | `Extract AdminAddReportModal + AdminNewWeighInModal + PigSendToTripModal + CattleNewWeighInModal` |
| 2.1.5 | `Extract SetPasswordScreen + LoginScreen to src/auth/` (test forgot-password flow!) |

**Round 2 — Single-feature view components (medium risk).**
| # | Commit |
|---|---|
| 2.2.1 | `Extract BroilerDailysView` |
| 2.2.2 | `Extract LayerBatchesView + LayerDailysView + EggDailysView` |
| 2.2.3 | `Extract PigDailysView` |
| 2.2.4 | `Extract CattleDailysView` |
| 2.2.5 | `Extract CattleBulkImport + SheepBulkImport` |
| 2.2.6 | `Extract SheepDetail + SheepDailysView + SheepWeighInsView` |
| 2.2.7 | `Extract CowDetail + CollapsibleOutcomeSections` |

**Round 3 — Bigger stateful views (consume multiple contexts).**
| # | Commit |
|---|---|
| 2.3.1 | `Extract LayersView + LayersHomeDashboard` |
| 2.3.2 | `Extract CattleHomeView` |
| 2.3.3 | `Extract CattleHerdsView` |
| 2.3.4 | `Extract SheepHomeView + SheepFlocksView` |
| 2.3.5 | `Extract CattleBreedingView + CattleBatchesView + CattleWeighInsView` |
| 2.3.6 | `Extract LivestockWeighInsView` |
| 2.3.7 | `Extract UsersModal` |

**Round 4 — Admin panels.**
| # | Commit |
|---|---|
| 2.4.1 | `Extract FeedCostsPanel + FeedCostByMonthPanel` |
| 2.4.2 | `Extract LivestockFeedInputsPanel + NutritionTargetsPanel` |

**Round 5 — Public webforms (high public-impact, careful).**
| # | Commit |
|---|---|
| 2.5.1 | `Extract WebformHub` |
| 2.5.2 | `Extract AddFeedWebform` (test public submission immediately after deploy) |
| 2.5.3 | `Extract WeighInsWebform` (test public submission immediately after deploy) |

**Round 6 — Inline views inside App (the hard part).**
This is where Pig/Broiler/Layer pages currently live inline as `if(view==="X") return ...` JSX inside App. Each gets extracted to its own component.
| # | Commit |
|---|---|
| 2.6.1 | `Extract BroilerHomeView` |
| 2.6.2 | `Extract BatchesListView` (the broiler list page) |
| 2.6.3 | `Extract TimelineView` (broiler timeline) |
| 2.6.4 | `Extract FeedView` (poultry feed) |
| 2.6.5 | `Extract BatchForm (broiler add/edit form)` |
| 2.6.6 | `Extract PigsHomeDashboard` |
| 2.6.7 | `Extract PigBreedingView + BreedingForm` |
| 2.6.8 | `Extract PigFarrowingView + FarrowingForm` |
| 2.6.9 | `Extract PigSowsView + BreederForm` |
| 2.6.10 | `Extract PigBatchesView + FeederForm` |
| 2.6.11 | `Extract PigFeedView` |

**Round 7 — Home dashboard (last + biggest single piece).**
| # | Commit |
|---|---|
| 2.7.1 | `Extract HomeDashboard (top stats + missed reports + last 5 days)` |

**Round 8 — Equipment placeholder.** Trivial.
| # | Commit |
|---|---|
| 2.8.1 | `Extract EquipmentPlaceholder to src/equipment/` |

**Result after Phase 2:** `src/App.jsx` is ~100 lines (provider tree + view dispatch + Header + Footer). All real logic lives in feature folders.

---

## 7. Phase 3 — React Router

Goal: real URLs + working back button. Existing `setView('X')` calls become `<Link to="/X">` or `useNavigate()`.

| # | Commit |
|---|---|
| 3.1 | `Add react-router-dom + define top-level <Route> map` (no internal usages yet) |
| 3.2 | `Replace setView(X) calls with useNavigate()` (one feature folder per commit) |
| 3.3 | `Add hash-compat shim: on app mount, detect /#weighins / /#addfeed / /#webforms / /#access_token=… and history.replaceState() to clean path` |
| 3.4 | `Switch SetPasswordScreen to read tokens from /reset?token=… as primary, fall back to URL hash for legacy email links` |
| 3.5 | `Remove the old hash-detection useEffect from App.jsx` |
| 3.6 | `Add 404 catch-all route → home` |

After 3.3 the URL shape is:
- `/` — home dashboard
- `/broiler/dashboard`, `/broiler/dailys`, `/broiler/timeline`, `/broiler/list`, `/broiler/feed`
- `/layer/dashboard`, `/layer/batches`, `/layer/dailys`, `/layer/eggs`
- `/pig/dashboard`, `/pig/sows`, `/pig/breeding`, `/pig/farrowing`, `/pig/batches`, `/pig/dailys`, `/pig/feed`
- `/cattle/dashboard`, `/cattle/herds`, `/cattle/dailys`, `/cattle/weighins`, `/cattle/breeding`, `/cattle/batches`
- `/sheep/dashboard`, `/sheep/flocks`, `/sheep/dailys`, `/sheep/weighins`
- `/equipment` — placeholder
- `/webforms`, `/weighins`, `/addfeed` — public webforms (no auth)
- `/admin/feed`, `/admin/users` — admin panels
- `/login`, `/reset` — auth screens

**Hash compat shim** (runs once on app mount, before the router decides anything):
```js
const h = window.location.hash;
const compatMap = {
  '#weighins': '/weighins',
  '#addfeed': '/addfeed',
  '#webforms': '/webforms',
};
if(compatMap[h]) {
  history.replaceState(null, '', compatMap[h]);
}
// Recovery hash (#access_token=… &type=recovery) is NOT rewritten —
// SetPasswordScreen still parses it from the hash for backward compat.
```

---

## 8. Smoke test (run after EVERY Phase 1 + Phase 3 commit, periodically in Phase 2)

1. Cold load `wcfplanner.com` (incognito) → home renders within 3s.
2. `/weighins` (or `/#weighins` for back-compat verification) → public weigh-ins webform renders.
3. `/webforms` → WebformHub renders.
4. `/addfeed` → AddFeedWebform renders.
5. Sign in as admin → home renders, all 6 program tiles visible, sub-nav works.
6. Sign in as a non-admin user with restricted program access → only allowed tiles visible.
7. Click "Forgot password?" → email arrives → click link → SetPasswordScreen renders → "Verifying…" briefly → "Set Password" enables → submit → continues to home.
8. Cattle → Herds → expand a cow → weight history + lambing/calving + comments all render.
9. Sheep → Flocks → add a test sheep → appears in directory.
10. Submit a Cattle daily report from the public webform → appears in admin Cattle Dailys list within ~2s.
11. Browser back button works between any two pages.
12. Console: no red errors.

**If any step fails, revert the commit and diagnose before re-attempting.**

---

## 9. Risk register

| # | Risk | Mitigation |
|---|---|---|
| R1 | Forgot-password flow breaks because `SetPasswordScreen` URL-hash parsing assumes the `#` survives router init | Test after every Phase 1 + Phase 3 commit. Keep hash-token parsing as the primary path until 3.4. |
| R2 | Existing webform bookmarks (`/#weighins`) silently redirect to home if shim fails | Shim runs synchronously on app mount, BEFORE router. Smoke step #2 catches this. |
| R3 | `app_store` jsonb blob save (`wcfPersistData`) loses debounce timing across context split → double-saves or lost saves | Move `wcfPersistData` to `src/lib/persist.js` once, untouched. Each Context that owns a blob calls it the same way as today. |
| R4 | Babel-in-browser-specific JSX patterns (`\u` escapes in template literals) behave differently under SWC/esbuild | They behave identically. Verified — esbuild handles `\u00d7` in JSX text the same way Babel does. Leave them. |
| R5 | `localStorage` `wcf-babel-*` keys (~600KB per user) become dead data | Add a one-time cleanup in `src/main.jsx`: `Object.keys(localStorage).filter(k=>k.startsWith('wcf-babel-')).forEach(k=>localStorage.removeItem(k))`. Runs on every app mount; idempotent; harmless. |
| R6 | Catastrophic deletion during a Round-7 (HomeDashboard) extraction | Keep file size of any single in-flight commit small. Backup + branch already in place. If a single component extraction PR exceeds ~1500 lines moved, split it. |
| R7 | Netlify build fails on first deploy because `dist/` config is wrong | Test on a deploy preview from `vite-migration` branch BEFORE merging to main. Don't merge until preview is green. |
| R8 | Supabase `farm-planner-auth` localStorage key behavior changes when supabase-js loads via ESM | It doesn't. Same package, same version, same key. Verified by grepping the package source. |
| R9 | Dev/prod parity: Vite dev server vs Vite build output behave differently | Run `npm run build && npm run preview` locally before any push. Smoke-test from preview, not just dev. |
| R10 | The `<script type="text/jsx-source">` script tag has any DOM dependencies (querySelector etc.) that ran in a specific order | None observed in the read-through. App's first React render handles all DOM mutations. Boot loader fade-out happens via React effect after first paint. |
| R11 | Edge function calls fail because `sb` is initialized differently | Same Supabase client config, same edge function URL. Verified the only change is import path. |

---

## 10. Don't-touch list (during migration)

These are explicit. If a migration commit modifies any of them, **revert and ask first.**

- `wcfSelectAll` pagination loop (the `.range(from, from+999)` + while-loop pattern).
- Two-query `loadCattleWeighInsCached` (no `!inner` joins).
- `detectSessionInUrl: false` and `storageKey: 'farm-planner-auth'` Supabase config.
- Source-label workflow strings (`'import'` / `'weigh_in'` / `'manual'`).
- `cellDates: true` xlsx read option.
- `_wcfPersistData` debounce timing (800ms today).
- Webform URL paths.
- Per-program `canAccessProgram` rules (admin always bypasses).
- `\u` JSX escape literals.
- `cattle.old_tags` jsonb shape.
- The `weigh_in_sessions.species` column convention.
- Supabase RLS policies (none of these are touched by frontend migration anyway).

---

## 11. Resolved questions (Ronnie 2026-04-19)

1. **ESLint + Prettier** — **Defer.** Lint warnings during a structural migration are noise; add later as a separate initiative.
2. **Source maps in production** — **Yes** (`build.sourcemap: true`). Worth the ~30% disk cost for debuggable stack traces.
3. **Vite dev server port** — **Default 5173** (Ronnie pushed back on the 3000 recommendation, correctly: "boring standard Vite" wins on turnover; 3000 is squatted by Next.js + lots of Node backends; the number-on-bookmark argument is thin).
4. **`wcf-babel-*` localStorage cleanup** in main.jsx — **Yes.** One-time idempotent purge on app mount; frees ~600KB per user.
5. **First production deploy of Phase 1** — **Deploy preview first.** Push `vite-migration` to GitHub → Netlify auto-builds a preview URL → smoke-test there → only merge to main when green.
6. **Phase pacing** — **Phase 1 in one session, Phase 2 paced one round per session, Phase 3 in one session.** Phase 1 is mechanical (one shot is fine); Phase 2 component extractions benefit from per-round verification.
7. **PROJECT.md updates** — **Yes, §17 onward per session.** Same pattern as §16 / §16.11. Each migration session gets a brief log so future Claude can trace the path from monolith to Vite without re-reading every commit.
8. **`scripts/` location** — **Stay at repo root.** They're CLI Node scripts, not part of the Vite bundle. Moving under `src/` would force exclude config + add friction.

---

## 12. What this plan deliberately defers

These are good ideas that DON'T belong in the migration:
- TypeScript conversion
- Test suite (Vitest + Playwright)
- CSS framework (Tailwind, etc.) or styled-components
- Storybook
- Service worker / PWA install
- Splitting `app_store` jsonb blobs into dedicated tables (per-feature)
- Bundle splitting beyond Vite's defaults
- React Server Components / Next.js / any framework jump

Each can come later as its own initiative. The migration is purely a toolchain + organization move.

---

## 13. Cutover checklist (end of Phase 1)

Before merging `vite-migration` → `main`:
- [ ] `npm run build` clean, no warnings.
- [ ] `npm run preview` runs the production build locally.
- [ ] All 12 smoke-test steps pass on `npm run preview`.
- [ ] Netlify deploy preview from `vite-migration` branch is green.
- [ ] All 12 smoke-test steps pass on the deploy preview URL.
- [ ] `wcf-babel-*` localStorage cleanup verified (open DevTools → Application → Local Storage → no `wcf-babel-*` entries after one app load).
- [ ] PROJECT.md §17 drafted with the change summary.
- [ ] Backup of `index.html` confirmed at `~/OneDrive/Desktop/WCF-planner-backups/`.

Then: merge, push, watch Netlify, run smoke test on production, declare cutover complete.

---

## 14. Progress log (append-only — newest entries at the bottom)

### 2026-04-19 — Phase 1 complete + Phase 2.0.0 (lib extraction) done
Branch: `vite-migration` (pushed). Main + production untouched.

**Phase 1 — Vite scaffolding** (all 7 commits done):
| SHA | Commit | What landed |
|---|---|---|
| `26ba711` | 1.1 Vite scaffolding | `package.json`, `vite.config.js` (sourcemap:true, default port 5173), `package-lock.json`. `npm install` succeeded. |
| `d304908` | 1.2 Move app source to src/main.jsx | Verbatim port of the 19,131-line `<script type="text/jsx-source">` block. ESM imports added; old `const { createClient } = supabase;` destructure dropped. |
| `78ed759` | 1.3 Replace CDN scripts | `index.html` 19,445 → 208 lines. CDN preloads + script tags + JSX inline source + Babel.transform bootstrap all deleted. Single `<script type="module" src="/src/main.jsx">`. Boot loader fade-out added to main.jsx. |
| `b14ffd2` | 1.4 + 1.5 XLSX + Babel cleanup | `_wcfLoadXLSX` switched to dynamic `import('xlsx')` (Vite auto-code-splits the chunk). `_wcfBabelCache` deleted. One-time `wcf-babel-*` localStorage purge added on app mount. |
| `3045a99` | 1.6 + 1.7 Netlify config | `public/_redirects` (SPA fallback). `netlify.toml` (build command, NODE_VERSION 20, publish dir). |

**Phase 2 — Component extraction**, Round 0 (Contexts) — first commit done:
| SHA | Commit | What landed |
|---|---|---|
| `9956d13` | 2.0.0 Extract sb + helpers to src/lib/ | `src/lib/supabase.js` (sb client + `window.sb` side-effect), `src/lib/email.js` (`wcfSendEmail`), `src/lib/pagination.js` (`wcfSelectAll` — pagination loop preserved verbatim per don't-touch rule). main.jsx imports all three at top. |

**Verification status:**
- Local `npm run build` passes after every commit. Bundle: ~1.26 MB main + 429 kB xlsx (auto-split, lazy-loaded).
- Production (`wcfplanner.com` / `cheerful-narwhal-1e39f5.netlify.app`) is untouched, still on `main`.
- Deploy preview (`deploy-preview-1--cheerful-narwhal-1e39f5.netlify.app`): SSL was provisioning at first push; verify it's live before relying on it.
- SetPasswordScreen (forgot password flow) confirmed working on production after a clean test.
- **Full smoke test §8 NOT yet run on the deploy preview** — that's the next pre-merge gate.

**What's next (Phase 2 Round 0 remaining):**
- 2.0.1 Extract AuthContext (carries the URL hash recovery logic + auth state listener — most complex Context)
- 2.0.2 Extract BatchesContext
- 2.0.3 Extract PigContext
- 2.0.4 Extract LayerContext
- 2.0.5 Extract DailysRecentContext (broiler / pig / layer / egg / cattle / sheep recent dailys)
- 2.0.6 Extract CattleHomeContext + SheepHomeContext + WebformsConfigContext + FeedCostsContext + UIContext (5 small ones bundled)

After Round 0: rounds 1–8 (component extractions) per §6.

---

## 15. Resuming this migration in a new Claude Code session

### URL cheat sheet (read first — easy to confuse)
| What | URL | Branch | Who deploys here |
|---|---|---|---|
| Production | `https://wcfplanner.com` (alias `https://cheerful-narwhal-1e39f5.netlify.app`) | `main` | Auto-deploys on every push to `main` |
| Deploy preview | `https://deploy-preview-N--cheerful-narwhal-1e39f5.netlify.app` (N = PR number, currently 1) | `vite-migration` | Auto-deploys on every push to `vite-migration` |

If a smoke-test URL starts with `https://cheerful-narwhal…` directly (no `deploy-preview-N` prefix), you are testing **production**, NOT the migration. Two different code bases. We hit this confusion on 2026-04-19; don't repeat it.

### Critical workflow rules (also in PROJECT.md memory, restated for visibility)
- **`commit` = full commit, no follow-up.** When Ronnie says "commit," do it (status line only) and don't ask "ready to push?".
- **`push` / `deploy` / merge ALWAYS needs a fresh explicit approval** in the same turn. The commit-no-prompt rule does NOT extend to push.
- **Never merge `vite-migration` to `main` without explicit "merge" or "cutover" from Ronnie.** Production is on `main`; the migration is mid-flight. An accidental merge promotes a half-done refactor to live for the farm team.
- **Never run destructive Supabase ops** (DROP, TRUNCATE, large DELETEs without WHERE) without explicit approval.

### Phase gates (don't skip)
- **Phase 1 must be verified on the deploy preview URL before any Phase 2 commit lands.** Run the §8 smoke test on `deploy-preview-1--cheerful-narwhal-1e39f5.netlify.app`. If anything fails, fix it before extracting Contexts. As of last update to §14, smoke test is still pending — confirm with Ronnie that it passed before continuing Round 0.
- **Each Phase 2 round (0, 1, 2, … 8) is a session boundary.** Don't compress two rounds into one session even if context budget seems to allow it; the per-round verify-build-and-confirm pause is the safety net.
- **Phase 3 (React Router) cannot start until all of Phase 2 is verified-merged.** Routing changes how the SetPasswordScreen URL hash gets read; do not interleave with Context extraction.

### Read order (before touching code)
If you (a future Claude) are picking this up cold, do these in order before touching code:

1. **Read** `PROJECT.md` end-to-end for general project context. The don't-touch rules in §15.7, §15.11, §16.4, §16.10 apply to ALL work, not just the migration. The auth-recovery + `detectSessionInUrl: false` saga in §16 is critical context for any Phase 2 / Phase 3 commit that touches auth.
2. **Read** this `MIGRATION_PLAN.md` cover-to-cover. §10 (don't-touch list) and §3 (current state inventory) are most load-bearing.
3. **Check git state:**
   - `git checkout vite-migration` (the migration branch)
   - `git log --oneline main..vite-migration` (see what's already done)
   - `git status` (should be clean except `.claude/`)
4. **Verify build still passes locally:**
   - `npm install` (in case node_modules is out of date or fresh clone)
   - `npm run build` (must succeed without errors before you change anything)
5. **Read §14 above** to find the most recent commit + the next-up commit per the plan. If a phase is partially complete, finish it before moving to the next round.
6. **Confirm with Ronnie before** any of the following:
   - Merging `vite-migration` to `main` (production cutover)
   - Pushing the branch (auto-triggers Netlify deploy preview rebuild)
   - Any commit that touches auth, payment-like flows, or the `wcfSelectAll` pagination loop
   - Any structural decision not already locked in §11 (router, folders, state, package mgr)
7. **After every meaningful commit:**
   - `npm run build` to verify the bundle still produces
   - For phases that touch auth or routing, also walk through §8 smoke test mentally before claiming done
   - Append a new dated entry to §14 with SHA + what landed + verification status

**Pacing rule (decided 2026-04-19):** Phase 1 in one session (mechanical), Phase 2 paced one round per session, Phase 3 in one session. Don't try to compress this. The deletion-incident risk Ronnie called out in his original prompt is real; small per-session blast radius is the protection.

**Edit-tool note for working in main.jsx:** The file is currently ~19,100 lines. Edit-tool's unique-`old_string` requirement still works, but reads/edits are slow. Prefer extracting whole chunks (Read → Write to new file → Edit-replace original chunk with import). Don't try to surgically rename inside the verbatim port — too fragile.

**Backup:** A pre-migration `index.html` is at `~/OneDrive/Desktop/WCF-planner-backups/index.html.pre-vite-2026-04-19` (SHA `1a535f73…`) as belt-and-suspenders. If a commit goes wrong and you need to recover the pre-Vite shape, it's there.

---

*End of plan. Living document — append to §14 as each phase progresses.*
