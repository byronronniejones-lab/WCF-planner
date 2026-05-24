# WCF Planner

Farm-management web app for White Creek Farm. React/Vite SPA, Supabase backend,
Netlify production deploy from GitHub `main`.

This file is project-specific truth: current state, active roadmap,
architecture map, and load-bearing contracts. Workflow, gates, and relay format
live in [HO.md](HO.md). Do not turn this file into a session transcript.

Last updated: 2026-05-24.

---

## Start Here

1. Read [HO.md](HO.md).
2. Read this file's Current State, Active Roadmap, and relevant Contracts.
3. Inspect `git status --short`, recent git log, and the files in the lane.

Default ownership: Codex plans/reviews; CC builds/validates. Codex edits source
only when Ronnie explicitly assigns it.

---

## Current State

- Production: `https://wcfplanner.com`
- Deploy: Netlify auto-deploy from `main`
- Latest live commit: `33a4dea fix(activity): merge Activity Log polish`
- PROD migrations live: `057` notifications, `058` activity events,
  `060` mention contract, `062` activity entity expansion, `063`
  notification activity resolution, `064` activity Phase 2 entities, `065`
  global activity log.
- PROD migrations drafted/stashed only: `059_daily_unique_indexes.sql` and
  `061_daily_report_soft_delete_restore.sql` are not applied.
- CI note: verify may be red from known unrelated Playwright flakes. Do not mix
  CI-stabilization work into feature lanes.

### Recent Shipped Work

| Area | State |
|---|---|
| Eggmobile 3 fallback | Live. Layer housing count fallback restored Eggmobile 3 and active layer totals. |
| Daily duplicate prevention | Live. Pre-submit duplicate guards are merged; DB unique-index migration `059` remains unapplied. |
| Broiler batch location labels | Live. Broiler daily/report dropdowns show current housing/location labels while storing the plain batch name. |
| Home Weather | Live. Tomorrow.io forecast proxy, 10-day forecast, rain/freeze focus, and animated radar are on Home. |
| Notifications Center | Live. `task_completed` and `mention` notifications use `public.notifications`; task and non-task mention deep-links are live. |
| Activity + @Mentions | Live. Comments, @mentions, compact chips, ActivityModal, and deep-links are live for 10 entity types. |
| Global Activity Log | Live at `/activity`. Permission-filtered RPC reads `activity_events`; deleted comments show a placeholder. |
| Hamburger cleanup | Live. Hamburger has Home, Activity, Webforms: Dailys/Equipment, Admin/Users, Sign Out. |
| Home farrow window wording | Live. Misleading `N pending` text removed from Home Next 30 Days farrowing windows. |
| Tasks v2 | Canonical at `/tasks`; old `/my-tasks` and `/admin/tasks` are aliases. |

### Parked WIP Stash

Working tree is intentionally clean after wrap. Stash numbers can change if new
stashes are added; always verify with `git stash list` before acting. Do not pop
or drop blindly.

| Lane | Files | Next action |
|---|---|---|
| `stash@{0}` stale global activity deep-link WIP | `src/lib/activityRegistry.js`, `src/lib/notificationsApi.js`, `src/shared/Header.jsx`, task deep-link files, notification static test | Likely superseded by merged commits. Inspect before dropping; do not apply unless unique changes are proven. |
| `stash@{1}` daily delete/restore | `supabase-migrations/061_daily_report_soft_delete_restore.sql`, `src/lib/dailyReportsApi.js`, `src/admin/RecentlyDeletedDailyReports.jsx`, six daily views, related filters/tests | Keep. Resume after Activity visibility/change-events unless Ronnie redirects. Needs migration gate planning. |
| `stash@{2}` old parked mixed lanes | Daily-report integrity files, superseded duplicate Home card files, shipped broiler-label files, `059_daily_unique_indexes.sql`, audit script | Do not pop. Contains shipped/superseded work mixed with possible future daily integrity/059 material. Inspect path-by-path only. |

---

## Active Roadmap

1. Activity visibility + meaningful change events:
   - Verify/fix visible Activity/comment affordances on all claimed entity
     surfaces. Ronnie reports Tasks are obvious, but broiler/layer/etc. are not.
   - Add a server-side activity/change-event RPC; clients must not insert
     directly into `activity_events`.
   - First wiring target: Layer batch note updates should appear in `/activity`
     and that entity's ActivityModal.
   - Do not log every keystroke or noisy autosave. Log meaningful saved changes
     such as notes/status/date/location/count changes.
2. Resume Daily Report Soft-Delete + Restore:
   - Soft-delete daily reports.
   - Recently Deleted admin view.
   - Restore flow.
   - Delete notifications.
   - Global audit/activity surface for deleted records.
3. Stash hygiene:
   - Inspect `stash@{0}` and drop only if it has no unique changes.
   - Treat `stash@{2}` as mixed/superseded; pull only specific files if a later
     lane needs them.
4. Optional daily-report DB hardening:
   - `059_daily_unique_indexes.sql` remains unapplied.
   - Do not apply until duplicate cleanup is explicitly approved and complete.
   - `egg_dailys` should stay pre-submit guard only unless a safe scope is
     designed.

---

## Locked Decisions

- No Home Dashboard duplicate-report card.
- No routine duplicate-report notification fanout.
- Future duplicate handling should prevent the duplicate before save where
  possible, then use DB constraints where the scope is valid.
- `egg_dailys` gets warning/pre-submit guard only. Its current data does not
  support a safe hard unique scope.
- Deleted records need global visibility because the original tile may no
  longer exist. Per-tile activity is not enough.
- Activity is Podio-style per entity/tile; a separate global audit/recently
  deleted surface is needed for deletes.
- Delete events may belong in Notifications Center because they are operational
  exceptions, not routine duplicate noise.
- Activity Log is accessible to all authenticated users and is permission
  filtered server-side. It is not admin-only.
- Current Activity Log shows existing `activity_events` only: comments,
  mentions, task completions, and any explicit system events. Normal row edits
  are not logged yet; that is the next activity lane.
- Meaningful change events should go through SECURITY DEFINER RPCs, use
  `_activity_can_write`, and avoid notification fanout unless explicitly
  requested.
- CC should not repitch skipped skill installs: UI UX Pro Max, Impeccable/Taste
  for WCF, Stop Slop, GSD, claude-mem for WCF, OpenSpec.

---

## Architecture Map

### Stack

- React 18 + Vite.
- Supabase Auth, Postgres, RLS, Storage, Edge Functions.
- BrowserRouter with view-to-URL adapter.
- Production deploy from `main` through Netlify.

### Roles

- `admin`: all authenticated surfaces and admin controls.
- `management`: operational app access where allowed.
- `farm`: field/operator access where allowed.
- `viewer`: read-oriented authenticated access.
- Public/anon: documented public webforms only.

### Routes

Authenticated:

- `/` home dashboard
- `/tasks`
- `/activity`
- `/broiler`, `/layer`, `/pig`, `/cattle`, `/sheep`
- `/fleet`
- `/admin`

Public:

- `/dailys`
- `/addfeed`
- `/weighins`
- `/equipment`
- `/equipment/<slug>`

Aliases:

- `/my-tasks` -> `/tasks`
- `/admin/tasks` -> `/tasks`

### Key Files

| Area | Files |
|---|---|
| App shell | `src/App.jsx`, `src/main.jsx`, `src/shared/Header.jsx` |
| Routes | `src/lib/routes.js` |
| Supabase | `src/lib/supabase.js`, `src/lib/pagination.js` |
| Tasks | `src/tasks/*`, `src/lib/tasks*Api.js`, `src/lib/tasksCenter*Api.js` |
| Notifications | `src/lib/notificationsApi.js`, `src/shared/Header.jsx` |
| Activity | `src/lib/activityApi.js`, `src/lib/activityRegistry.js`, `src/lib/globalActivityApi.js`, `src/activity/ActivityLogView.jsx`, `src/shared/ActivityPanel.jsx`, `src/shared/MentionTextarea.jsx`, `src/shared/ActivityModal.jsx` |
| Public forms | `src/webforms/*` |
| Icons | `src/lib/plannerIcons.js`, `src/components/PlannerIcon.jsx` |
| Offline | `src/lib/offline*.js`, `src/lib/useOffline*.js` |

### Persistence

Hand-created prod tables that test bootstrap must seed before migrations alter
them:

`profiles`, `app_store`, `webform_config`, `poultry_dailys`, `layer_dailys`,
`egg_dailys`, `pig_dailys`, `layer_batches`, `layer_housings`.

Main table groups:

- Daily reports: `poultry_dailys`, `layer_dailys`, `egg_dailys`,
  `pig_dailys`, `cattle_dailys`, `sheep_dailys`.
- Tasks: `task_templates`, `task_instances`, `task_cron_runs`,
  `task_summary_runs`, `task_instance_*`, `task_system_rules`.
- Notifications/activity: `notifications`, `activity_events`,
  `activity_mentions`.
- Livestock: `cattle*`, `sheep*`, `weigh_in_sessions`, `weigh_ins`,
  `layer_batches`, `layer_housings`.
- Equipment/fuel: `equipment*`, `fuel_supplies`, `fuel_bills`,
  `fuel_bill_lines`, `equipment_service_materials`,
  `equipment_material_clears`.

Important `app_store` keys:

- `ppp-v4`: broiler batches.
- `ppp-feeders-v1`: pig feeder groups, sub-batches, planned trips,
  processing trips.
- `ppp-pigs-v1`, `ppp-breeding-v1`, `ppp-farrowing-v1`,
  `ppp-breeders-v1`: pig herd/breeding/farrowing data.
- `ppp-feed-orders-v1`, `ppp-pig-feed-inventory-v1`,
  `ppp-poultry-feed-inventory-v1`: feed planning.
- `ppp-pig-planned-trip-locks-v1`: pig planned-trip lock sidecar.
- `ppp-missed-cleared-v1`, `ppp-webforms-v1`: home/webform support.

Important `webform_config` keys:

- `team_roster`, `team_members`, `team_availability`
- `tasks_public_assignee_availability`
- `broiler_batch_meta`, `housing_batch_map`, `broiler_groups`,
  `active_groups`, `layer_groups`, `full_config`, `webform_settings`

Storage buckets:

- `batch-documents`
- `equipment-maintenance-docs`
- `fuel-bills`
- `daily-photos`
- `task-photos`
- `task-request-photos`

---

## Load-Bearing Contracts

Read the relevant contract before editing its files.

### Cross-App

- Do not change Supabase auth config in `src/lib/supabase.js` without a plan.
- Keep `wcfSelectAll`; Supabase `.limit()` silently caps at 1000.
- Keep BrowserRouter view-to-URL adapter unless doing a planned router lane.
- Do not introduce `window.confirm`, `window.alert`, or `window.prompt`.
- Use inline notices, `DeleteModal`, or typed confirmation surfaces.
- Public forms must keep no-auth access where documented.
- Netlify redirect order matters: `equipment.html` rules before SPA fallback.
- No migrations, RLS, Vault, Edge Function deploys, or production data actions
  without Ronnie's explicit gate from [HO.md](HO.md).

### Supabase And Storage

- Never delete directly from `storage.objects`; use Storage API list/remove
  recursion.
- Private buckets are read through signed URLs.
- Task photo uploads are append-only (`upsert:false`); duplicate object errors
  are retry success.
- Admin-created user emails, welcome emails, and password resets are sent by
  `rapid-processor` from `noreply@wcfplanner.com`.
- PROD `exec_sql` is forbidden.

### Tasks

- `/tasks` is canonical.
- Task writes go through v2 wrappers/RPCs only.
- Do not directly update `task_instances` or task sidecar tables from UI code.
- Do not call `generate_system_task_instance` from frontend code.
- `task_instance_photos` is canonical; legacy single-path columns are fallback
  display only.
- Header task badge soft-fails to zero and must not break Header rendering.
- Task assignee dropdowns use `loadTaskAssignableProfilesById` and fail closed
  on config read errors.

### Notifications

- Client cannot insert/delete notifications.
- Notification writes happen inside SECURITY DEFINER paths.
- Recipient-only RLS: users can select/update only their own rows.
- Recipient UPDATE grant is column-scoped to `read_at`.
- `complete_task_instance` notification insert must never roll back the task
  completion.
- Skip task-completed notification when creator is null or completer is creator.
- Valid `notifications.type`: `task_completed`, `mention`. New types require a
  migration that widens the CHECK.
- Header bell soft-fails to zero and must not break Header rendering.

### Activity And Mentions

- All activity reads/writes go through SECURITY DEFINER RPCs:
  `list_activity_events`, `count_activity_for_entity`,
  `post_activity_comment`, `edit_activity_event`, `delete_activity_event`,
  `list_global_activity`.
- No direct `.from('activity_events')` or `.from('activity_mentions')` in
  `src`.
- `_activity_can_read(entity_type, entity_id)` is fail-closed. Entity existence
  is checked before role shortcuts; admin does not bypass fake-id rejection.
- Supported entity types are: `task.instance`, `broiler.batch`, `pig.batch`,
  `layer.batch`, `layer.housing`, `cattle.animal`, `cattle.processing`,
  `sheep.animal`, `sheep.processing`, `equipment.item`.
- New entity type = one `_activity_can_read` resolver branch, one
  `activityRegistry` entry, route/deep-link mapping, and one surface wire-up.
- `/activity` is a permission-filtered global timeline backed by
  `list_global_activity`; it must never bypass `_activity_can_read`.
- Normal field edits are not automatically activity events yet. The next lane
  should add meaningful change events through a new SECDEF RPC that checks
  `_activity_can_write`.
- Mentions use `p_mentions[]` as identity. Visible body stays user-friendly
  plain `@Name`; UUIDs must not appear in body text.
- Server validates mentions: profile exists, profile active, max 10 mentions,
  caller can write. Self-mention records the mention but sends no notification.
- `delete_activity_event` is soft-delete only; author or admin.
- If a SECDEF RPC return shape changes, migration must end with
  `NOTIFY pgrst, 'reload schema'`.

### Daily Reports

- Add Feed quick-log rows can share daily tables but are not a substitute for a
  full daily report. Missed-report checks exclude `source='add_feed_webform'`.
- Duplicate prevention target:
  - poultry/pig/layer: `(date, batch_label)`
  - cattle: `(date, herd)`
  - sheep: `(date, flock)`
  - partial indexes exclude Add Feed rows
  - `egg_dailys`: warning/pre-submit guard only, no hard unique index yet
- Existing PROD duplicate cleanup is required before applying migration `059`.
- Future delete lane should use soft-delete plus global Recently Deleted/Audit;
  hard delete hides evidence operators need.

### Pig

- Feeder group started counts are authoritative.
- Current count is ledger-derived, not persisted `currentCount`.
- Planned-trip row shape stays exactly:
  `{id, date, sex, subBatchId, plannedCount, order}`.
- Lock state lives only in `ppp-pig-planned-trip-locks-v1`.
- `processingTrips[].subAttributions` must be stamped as
  `{subId, subBatchName, sex, count}`.
- Send-to-Trip from `/pig/weighins` may reconcile a locked planned trip count,
  but cannot change the locked date.
- Use `pigSlug` for sub-batch matching.

### Broiler And Layers

- Broiler batches live in `ppp-v4`.
- Public `/weighins` cannot read or mutate `app_store.ppp-v4` directly.
- Public week 4/6 completion uses `stamp_broiler_batch_avg` RPC.
- Do not grant anon direct `app_store` access.
- Admin weigh-in paths may use authenticated `app_store` helpers.
- Layer `current_count` is physical anchor; projected count subtracts
  mortalities since anchor.

### Feed Planning

- Feed math lives in `src/lib/feedPlanner.js`; views should not rebuild it.
- `LEAD_TIME_DAYS = 7`, `RESERVE_DAYS.default = 30`,
  `ORDER_ROUNDING_LBS = 50`, `STALE_SNAPSHOT_DAYS = 21`.
- Feed types: `pig`, `starter`, `grower`, `layerfeed`.
- Snapshot counts are anchors; today's on-hand subtracts consumption since the
  snapshot date.
- Poultry burn uses existing broiler/layer schedule helpers.

### Cattle And Sheep

- Cattle and sheep use dedicated Supabase tables, not `app_store`.
- Cattle herds: `mommas`, `backgrounders`, `finishers`, `bulls`.
- Sheep flocks: `rams`, `ewes`, `feeders`.
- Cattle processing storage statuses remain `scheduled`, `active`, `complete`;
  UI may label `complete` as Processed.
- Cattle move only when Send-to-Processor promotes a row to `active`.
- `loadCattleWeighInsCached` keeps the two-query pattern. Do not rewrite to
  `!inner`.
- Old cattle tag source strings are load-bearing: `import`, `weigh_in`,
  `manual`.

### Cattle And Sheep Inputs

- Admin panel: `src/admin/LivestockFeedInputsPanel.jsx`.
- Public/new-record dropdowns hide only `status === 'inactive'`; legacy
  blank/null status remains selectable.
- Daily edit/history surfaces must load inactive referenced inputs for snapshot
  rebuilding; filter inactive rows at dropdown render sites, not load time.

### Equipment

- Logged-in Equipment: `/fleet`.
- Public equipment/fueling: `/equipment` and `/equipment/<slug>`.
- Public fueling uses `submit_equipment_fueling` RPC.
- Fuel-log edit/delete paths recompute current readings from remaining fuel logs.
- Equipment checklist/material textboxes must not reload, lose focus, or reorder
  list items on click/edit.
- Rolling materials clears are bucketed by due service cycle.

### Icons

- Use `public/icons/planner` through `PlannerIcon` or `plannerIconUrl`.
- App code must not reference `C:\Users\Ronni\OneDrive\Desktop\planner pics`.
- Do not put images inside `<option>` elements; use text fallback there.

---

## Validation Map

Use [HO.md](HO.md) for the required validation floor and gates.

Common commands:

```bash
npm run format:check
npm run lint
npm test
npm run build
npm run test:e2e
```

Focused starting points:

| Area | Tests |
|---|---|
| Routes | `src/lib/routes.test.js`, `tests/url_alias_redirects.spec.js` |
| Tasks | `tests/static/tasks_*.test.js`, `tests/tasks_v2_*.spec.js`, `src/lib/tasksCenterApi.test.js` |
| Activity | `tests/activity_phase1.spec.js`, `tests/static/activity_static.test.js`, `tests/static/global_activity_deep_links_static.test.js`, `tests/static/mention_deep_links_static.test.js`, `tests/static/activity_phase2_entities_static.test.js`, `tests/static/global_activity_log_static.test.js` |
| Daily reports | `tests/static/daily_report_integrity.test.js` |
| Broiler | `src/lib/broiler.test.js`, `tests/broiler_*.spec.js`, `tests/static/weighinswebform_no_app_store.test.js` |
| Pig | `src/lib/pigForecast.test.js`, `tests/pig_*.spec.js` |
| Cattle | `src/lib/cattleForecast.test.js`, `tests/cattle_*.spec.js` |
| Sheep | `tests/sheep_send_to_processor.spec.js` |
| Equipment | `tests/equipment_*.spec.js`, `tests/static/equipment_materials.test.js` |
| Offline/public forms | `tests/offline_*.spec.js`, `tests/team_availability.spec.js`, `tests/daily_report_photos.spec.js` |

---

## Archives

- Older narrative history: `archive/SESSION_LOG.md`.
- Research, screenshots, audits, and video evaluations:
  `C:\Users\Ronni\cc-research\`.
- Use git log for detailed shipped-code history; keep this file as the compact
  project map.
