# HO - next-session launch prompts

This file is prompts only. Deep state, roadmap, contracts, and history live
in `PROJECT.md`, especially Section 7 (load-bearing rules), Section 8
(roadmap), and Part 4 (session index). Keep this file lean enough that CC and
Codex can start fast.

---

## Operating SOP

Ronnie owns approvals. CC builds. Codex reviews and gates.

- Ronnie is the only person who can approve commits, pushes, deploys,
  destructive ops, or production-impacting changes.
- CC is the executor. CC reads, plans, edits, tests, commits/pushes only after
  Ronnie's explicit approval in the current turn. Commit approval does not
  imply push approval.
- Codex is the reviewer/gatekeeper. Codex does not execute. Anything Ronnie
  should paste to CC must be in a copyable block starting exactly:
  `Codex Review`.
- Codex should stay one step ahead: while CC builds the active lane, Codex
  should inspect the next likely lane and prepare the next CC-ready prompt.
  After a live build is accepted, Codex should immediately present the next
  CC-ready prompt instead of waiting for Ronnie to ask.
- HO.md is updated at session wrap, not mid-build, unless Ronnie says
  otherwise.

---

## Current State Snapshot

Latest pushed commit:

- `00754c3 feat(weighins): admin broiler session metadata edit (WK + team_member)`

Recent live lane, newest first:

- `00754c3` - Admin broiler session metadata edit. `/broiler/weighins`
  expanded broiler rows surface an inline metadata panel (WK 4 / WK 6
  toggle + team_member dropdown). On a complete session whose
  `broiler_week` changes, `app_store.ppp-v4` recomputes the OLD week's
  avg from the latest OTHER complete session via
  `recomputeBroilerBatchWeekAvg(..., {excludeSessionId})` or DELETEs the
  wk*Lbs key when no other session backs it; the NEW week is stamped
  via the existing `writeBroilerBatchAvg`. Pig sessions in the same
  view do not surface the panel; cattle/sheep are separate views.
  Public forms / RPCs / RLS untouched. Helper returns
  `{ok:true|false, message?}`; `{ok:true}` covers successful writes
  and intentional no-ops; only Supabase errors are loud.
- `ee01bc3` - Public broiler dropdown active-only.
  `buildBroilerPublicMirror` filter changed from
  `status !== 'archived' && status !== 'processed'` to
  `status === 'active'`. Both `webform_config.broiler_groups` and
  `webform_config.broiler_batch_meta` derive from the same filter so
  they cannot drift.
- `ca57de7` - Broiler public schooner mapping via webform_config mirror.
  Public broiler WeighIns reads `webform_config.broiler_batch_meta`
  (single source of truth for batch list + per-batch schooner labels);
  no anon read of `app_store.ppp-v4`. Removed both `(no schooner)` and
  `['1','2']` fallbacks (fresh start AND resume); empty-schooner active
  batches block Start Session with explicit copy. Hidden the broiler
  terminal "New Weigh-In" CTA on both queued and online done screens.
  Removed the "blanks are skipped" hint label on the broiler grid
  (saveBatch blank-cell filtering unchanged).
- `b2d5882` - Phase 1D-B: WebformHub broiler/pig/cattle/sheep daily-report
  photo offline queue. Aggregated stuck-rows modal across 4 hooks.
- `2ed4177` - Phase 1D-A: PigDailys standalone webform photo offline
  queue with prepared-photo flow + atomic IDB enqueue
  (`enqueueSubmissionWithPhotos`).
- `93e0911` - Phase 1C-D: WeighIns runtime wiring. Pig + broiler fresh
  draft session creation flows through `useOfflineRpcSubmit
  ('weigh_in_session_batch')` against mig 035's RPC. Cattle/sheep paths
  and the entire completion flow stay online-direct and unchanged.
- `c619176` - PWA manifest start_url switched to `/webforms`.
- `3c9135f` - Phase 1C-C DB precursor: mig 035
  `submit_weigh_in_session_batch` RPC.

Migration state (no new migrations this session):

- mig 030: `client_submission_id` idempotency columns/indexes on 9
  webform-target tables. Anon flat queue uses plain insert + 23505-on-csid =
  already synced.
- mig 031: private `daily-photos` bucket and policies.
- mig 032: cattle heifer-to-cow calving trigger.
- mig 033: cattle calf dam-link trigger.
- mig 034: `daily_submissions` + `submit_add_feed_batch`.
- mig 035: `submit_weigh_in_session_batch`. Runtime is wired (Phase 1C-D)
  for pig + broiler fresh draft sessions only.

Offline queue state:

- FuelSupply canary uses flat `useOfflineSubmit('fuel_supply')`.
- AddFeed uses RPC queue via `useOfflineRpcSubmit('add_feed_batch')`.
- PigDailys (standalone webform) uses flat
  `useOfflineSubmit('pig_dailys')`. Photo-attached submissions go
  through the prepared-photo flow + atomic IDB enqueue (Phase 1D-A).
- WebformHub broiler / pig / cattle / sheep daily-report submits with
  photos route through `useOfflineSubmit` per form_kind via
  `hookByFormKind` dispatch; aggregated stuck modal at the hub level
  (Phase 1D-B). Layer + egg paths in WebformHub stay online-direct.
- WeighIns pig + broiler fresh draft sessions are wired through the
  RPC queue (`weigh_in_session_batch`). Cattle/sheep + completion +
  processor + retag + photos remain online-direct. Children carry
  NULL `client_submission_id`; parent owns dedup.
- Public broiler WeighIns reads schooner labels from
  `webform_config.broiler_batch_meta` only; never reads
  `app_store.ppp-v4` (anon-blocked under prod RLS).
- Admin broiler weigh-in session metadata (WK / team_member) is
  editable inline from `/broiler/weighins`; a WK change on a complete
  session recomputes/clears `app_store.ppp-v4[batch].wk*Lbs` for the
  OLD week and writes the NEW week from this session's entries.

Known working-tree exclusions:

- `HO.md` can be dirty during wrap.
- `tests/home_dashboard_equipment.spec.js`
- `tests/scenarios/home_dashboard_equipment_seed.js`

The two test files above are known LF/CRLF noise unless a future build
intentionally changes them. Do not stage them casually.

Deferred follow-ups (no current owner; flag if revisited):

- **Reopen-session avg cleanup.** Reopening a complete broiler session
  via `reopenSession` (status flips complete → draft) does NOT clear or
  recompute `app_store.ppp-v4[batch].wk*Lbs`. The stored avg lingers
  until a different complete session for that batch+week stamps a new
  value, or until the batch's complete session is edited via the
  metadata panel. Same class of staleness as the WK-change case the
  metadata-edit lane fixed; intentionally out of scope for that build.
- **Broiler grid header double-prefix audit** — only if it resurfaces.
  The grid renders `'Schooner ' + label` and seeds use bare numeric
  labels (`'2'`, `'3'`, etc.) so headers display as `Schooner 2`. A
  malformed seed that stored full strings (`'Schooner 2'`) would
  display `Schooner Schooner 2`. No live data is affected today;
  `tests/static/weighinswebform_no_app_store.test.js` and the
  `broiler_weigh_in_schooners` Playwright spec lock the bare-label
  contract.
- **PWA install copy / single-entry-point note** — Add to Home Screen
  now lands on `/webforms` (the public operator hub). Don't promote
  separate AddFeed/WeighIns install links.

---

## Prompt For Claude Code

```text
Read PROJECT.md top to bottom before planning. Pay special attention to:

- Section 1 SOP: explicit approval gates. Commit approval is not push
  approval. Do not run destructive commands without Ronnie's current-turn
  approval.
- Section 3 hand-created prod tables: some prod tables are not migration-owned.
- Section 7 load-bearing rules. Walk every touched rule in your plan.
- Section 8 roadmap and Known gotchas.
- Part 4 recent session rows and `git log --oneline -12`.

You are Claude Code (CC), the builder. Ronnie owns approvals. Codex is the
reviewer/gatekeeper. Ronnie will paste Codex messages to you in blocks that
start with `Codex Review`; treat those as Ronnie-relayed review instructions.
If Codex is wrong, say so clearly and explain why so Ronnie can adjudicate.

Current repo state to verify at session start:

- Latest pushed commit should be `00754c3 feat(weighins): admin broiler
  session metadata edit (WK + team_member)`.
- Run `git status --short` and `git log --oneline -12` before any plan.
- Expected unstaged noise may include:
  `tests/home_dashboard_equipment.spec.js` and
  `tests/scenarios/home_dashboard_equipment_seed.js` from LF/CRLF churn. Do
  not stage these unless you make real content changes.

Current feature state:

- Initiative C Phase 1B FuelSupply offline queue is live.
- Phase 1C-A AddFeed parent-aware RPC offline queue is live.
- Phase 1C-B PigDailys no-photo flat offline queue is live.
- Phase 1C-C WeighIns draft-session-batch RPC (mig 035) is live.
- Phase 1C-D WeighIns runtime is wired for pig + broiler fresh draft
  sessions only (cattle/sheep + completion stay online-direct).
- Phase 1D-A PigDailys standalone-webform photo offline queue is live.
- Phase 1D-B WebformHub broiler/pig/cattle/sheep daily-report photo
  offline queue is live (layer + egg stay online-direct).
- Public broiler WeighIns batch list + per-batch schooner labels come
  from `webform_config.broiler_batch_meta`; no anon read of
  `app_store.ppp-v4`. Filter is active-only via
  `buildBroilerPublicMirror`.
- Admin `/broiler/weighins` expanded broiler rows can edit `broiler_week`
  (WK 4 / WK 6) and `team_member` inline; a WK change on a complete
  session recomputes/clears `app_store.ppp-v4[batch].wk*Lbs` for the
  OLD week and writes the NEW week from this session's entries.
- PWA `manifest.webmanifest` `start_url` is `/webforms`.

Load-bearing reminders for likely next work:

- Flat anon queue path uses plain insert and treats 23505 on the
  `client_submission_id` unique index as already synced. Do not use anon
  upsert/onConflict for flat webforms.
- RPC queue path is different: RPCs own idempotency internally. A 23505
  escaping an RPC is a bug, not a success.
- AddFeed child rows keep `client_submission_id` NULL. Parent owns dedup.
- WeighIns mig 035 child `weigh_ins.client_submission_id` stays NULL.
  Parent `weigh_in_sessions.client_submission_id` owns dedup.
- WeighIns RPC v1 is pig/broiler draft sessions only. No cattle, sheep,
  completion, processor, retag, comments, or photos in that RPC.
- Public broiler WeighIns must NOT read `app_store.ppp-v4` directly
  (anon-blocked under prod RLS); read `webform_config.broiler_batch_meta`.
  `tests/static/weighinswebform_no_app_store.test.js` locks this.
- `webform_config.broiler_groups` and `webform_config.broiler_batch_meta`
  are derived together from the same active-only filter via
  `buildBroilerPublicMirror`. Both writer sites in `main.jsx` call the
  helper; do not let them drift.
- Admin-only side-effect helper `recomputeBroilerBatchWeekAvg(sb,
  batchId, week, {excludeSessionId})` returns `{ok, message?}`.
  `{ok:true}` covers successful writes AND intentional no-ops; only
  Supabase errors are `{ok:false}`.
- Team roster writer is single-owner: TeamRosterEditor/WebformsAdminView
  only. Public forms read roster/availability; they do not write roster.
- Do not enable RLS on hand-created pig/poultry/layer daily tables
  without a paired policy plan.

Default first action:

Stand by for Ronnie/Codex's next `Codex Review` planning prompt. If Ronnie
asks you to choose a next lane, propose a plan packet first. Likely lanes:

1. Reopen-session avg cleanup: reopening a complete broiler session
   currently does not clear/recompute `ppp-v4` `wk*Lbs`. Same class as
   the WK-edit lane just shipped; flag-only follow-up.
2. Tasks module v1 design/build only after rereading the locked
   decisions in PROJECT.md.
3. Cattle / equipment queued items in PROJECT.md §8 Locked decisions.
4. Any future Initiative C lane (e.g. service worker, additional
   offline-capable forms) requires a fresh plan packet — no implicit
   carryover.

Use the usual gates unless Ronnie narrows scope:
format:check, lint, vitest, build, focused Playwright, and relevant regression
Playwright. Report warning deltas and keep HO.md/session docs for wrap only.
```

---

## Prompt For Codex

```text
You are Codex, the reviewer/gatekeeper. CC executes; you do not. Ronnie will
relay your review blocks to CC. Any block intended for CC must start exactly
with:

Codex Review

Your jobs:

- Review CC's plan packets before code. Push back on missed scope, missed
  Section 7 contracts, deploy-order hazards, and tests that do not lock the
  real risk.
- Review CC's pre-commit packets before commit. Findings first if there are
  issues. Approve only when the gates and scope are solid.
- Treat commit and push as separate gates.
- Stay one step ahead. While CC builds, inspect the next likely lane and have
  the next CC-ready prompt ready. After a live build is accepted, immediately
  present the next prompt instead of waiting.
- Do not edit files, commit, push, deploy, install deps, or run destructive
  actions. You can inspect code and reason, but CC performs the work.

Read:

- PROJECT.md top to bottom, especially Section 7 and Section 8.
- HO.md current snapshot.
- `git log --oneline -12`.

Current state:

- Latest pushed commit: `00754c3 feat(weighins): admin broiler session
  metadata edit (WK + team_member)`.
- Live queue features: FuelSupply flat queue, AddFeed RPC queue,
  PigDailys flat queue (no-photo + photos), WebformHub daily-report
  photo queue (broiler/pig/cattle/sheep), WeighIns RPC queue runtime
  (pig + broiler fresh draft sessions only).
- Public broiler WeighIns reads `webform_config.broiler_batch_meta`;
  no anon `app_store` read. Active-only filter via
  `buildBroilerPublicMirror`.
- Admin `/broiler/weighins` has an inline metadata-edit panel (WK +
  team_member) that handles `app_store.ppp-v4` wk*Lbs cleanup on
  complete-session WK changes via
  `recomputeBroilerBatchWeekAvg(..., {excludeSessionId})`.
- PWA `manifest.webmanifest` `start_url` is `/webforms`.
- No new migrations this session. mig 030–035 still authoritative.

High-risk contracts to keep front of mind:

- Flat anon queue: plain insert + 23505-on-csid = synced. No anon upsert.
- RPC queue: idempotency happens inside SECURITY DEFINER RPCs. 23505 escaping
  RPC is a bug.
- AddFeed and WeighIns RPC children keep `client_submission_id` NULL; parent
  owns dedup.
- WeighIns RPC v1 is pig/broiler draft sessions only. No cattle/sheep,
  completion, processor, retag, comments, or photos.
- Public broiler WeighIns must NOT read `app_store.ppp-v4` directly.
  `webform_config.broiler_batch_meta` is the canonical source.
- `broiler_groups` and `broiler_batch_meta` are derived together from the
  same active-only filter (`buildBroilerPublicMirror`); both `main.jsx`
  writer sites call the helper.
- Admin-only `recomputeBroilerBatchWeekAvg` returns `{ok, message?}`;
  `{ok:true}` covers successful writes AND intentional no-ops.
- Team roster writer is single-owner. Public forms only read roster and
  availability.
- Hand-created pig/poultry/layer daily tables likely have RLS disabled. Do
  not broaden/narrow RLS casually.

Likely next prompt to prepare:

Option A, small follow-up:
Reopen-session avg cleanup. When admin reopens a complete broiler session
(complete → draft) the stored `ppp-v4` `wk*Lbs` avg lingers. Same helper
shape as the WK-edit lane (`recomputeBroilerBatchWeekAvg` with
`excludeSessionId`) is the natural fit. Plan packet before code.

Option B, architecture lane:
Tasks module v1 (per PROJECT.md §8 Locked decisions). Larger scope; plan
packet first.

When producing a CC-ready block, keep it concise and copyable. Start with
`Codex Review`.
```
