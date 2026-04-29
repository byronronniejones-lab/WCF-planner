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

- `3c9135f feat(weighins): add draft session batch RPC precursor`

Recent live lane, newest first:

- `3c9135f` - Phase 1C-C DB precursor: mig 035
  `submit_weigh_in_session_batch` RPC. DB/RPC/tests only, no runtime form
  wiring.
- `c1827b5` - Phase 1C-B: PigDailys no-photo flat offline queue.
- `52c0d60` - Phase 1C-A: AddFeed parent-aware offline RPC queue.
- `5e50d71` - AddFeed parent table + `submit_add_feed_batch` RPC (mig 034).
- `194e117` - Team roster per-form availability filters + hard-delete cascade.
- `db9ff09` - Cattle calf lineage display cleanup.

Migration state:

- mig 030: `client_submission_id` idempotency columns/indexes on 9
  webform-target tables. Anon flat queue uses plain insert + 23505-on-csid =
  already synced.
- mig 031: private `daily-photos` bucket and policies.
- mig 032: cattle heifer-to-cow calving trigger.
- mig 033: cattle calf dam-link trigger.
- mig 034: `daily_submissions` + `submit_add_feed_batch`.
- mig 035: `submit_weigh_in_session_batch`; ran successfully without RLS
  policy edits. Runtime does not call it yet.

Offline queue state:

- FuelSupply canary uses flat `useOfflineSubmit('fuel_supply')`.
- AddFeed uses RPC queue via `useOfflineRpcSubmit('add_feed_batch')`.
- PigDailys no-photo submits use flat `useOfflineSubmit('pig_dailys')`.
- PigDailys with photos remains online-only with explicit connection copy.
- WeighIns has only the DB precursor RPC. Runtime queue wiring is not shipped.
- Photos are not offline-queued yet.

Known working-tree exclusions:

- `HO.md` can be dirty during wrap.
- `tests/home_dashboard_equipment.spec.js`
- `tests/scenarios/home_dashboard_equipment_seed.js`

The two test files above are known LF/CRLF noise unless a future build
intentionally changes them. Do not stage them casually.

Queued later item:

- PWA/home-screen fix: `public/manifest.webmanifest` currently has
  `start_url: "/"`, so Add to Home Screen can launch the login/admin app.
  Later fix should use one operator entry point, `/webforms`, and keep the
  instruction simple: "Open https://wcfplanner.com/webforms and Add to Home
  Screen." Do not promote separate AddFeed/WeighIns install links.

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

- Latest pushed commit should be `3c9135f feat(weighins): add draft session
  batch RPC precursor`.
- Run `git status --short` and `git log --oneline -12` before any plan.
- Expected unstaged noise may include:
  `tests/home_dashboard_equipment.spec.js` and
  `tests/scenarios/home_dashboard_equipment_seed.js` from LF/CRLF churn. Do
  not stage these unless you make real content changes.

Current feature state:

- Initiative C Phase 1B FuelSupply offline queue is live.
- Phase 1C-A AddFeed parent-aware RPC offline queue is live.
- Phase 1C-B PigDailys no-photo flat offline queue is live.
- Phase 1C-C WeighIns draft session batch RPC precursor is pushed. Mig 035
  applied cleanly without RLS/policy edits. No runtime WeighIns wiring exists
  yet.
- AddFeed/PigDailys/PWA changes already shipped; photos still need connection
  except already-uploaded online flows. Offline photo queue is a later phase.

Load-bearing reminders for likely next work:

- Flat anon queue path uses plain insert and treats 23505 on the
  `client_submission_id` unique index as already synced. Do not use anon
  upsert/onConflict for flat webforms.
- RPC queue path is different: RPCs own idempotency internally. A 23505
  escaping an RPC is a bug, not a success.
- AddFeed child rows keep `client_submission_id` NULL. Parent owns dedup.
- WeighIns mig 035 child `weigh_ins.client_submission_id` also stays NULL.
  Parent `weigh_in_sessions.client_submission_id` owns dedup.
- WeighIns RPC v1 is pig/broiler draft sessions only. No cattle, sheep,
  completion, processor, retag, comments, or photos in that RPC.
- Team roster writer is single-owner: TeamRosterEditor/WebformsAdminView only.
  Public forms read roster/availability; they do not write roster.
- Do not enable RLS on hand-created pig/poultry/layer daily tables without a
  paired policy plan.

Default first action:

Stand by for Ronnie/Codex's next `Codex Review` planning prompt. If Ronnie
asks you to choose a next lane, propose a plan packet first. Likely lanes:

1. PWA/webforms home-screen fix: manifest start_url `/webforms`, one
   operator-facing entry point, regression checks that `/webforms` is public
   and not LoginScreen.
2. Phase 1C-D: WeighIns runtime wiring for pig/broiler draft sessions through
   `submit_weigh_in_session_batch` and the RPC offline queue, with no
   cattle/sheep/completion side effects.
3. Offline daily-photo queue phase: larger design first. Do not sneak photos
   into a smaller queue build.
4. Tasks module v1 design/build only after rereading the locked decisions in
   PROJECT.md.

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

- Latest pushed commit: `3c9135f feat(weighins): add draft session batch RPC
  precursor`.
- Phase 1C-C shipped DB/RPC/tests only. Mig 035 adds
  `submit_weigh_in_session_batch(parent_in jsonb, entries_in jsonb)`.
- Mig 035 ran successfully without RLS/policy edits. Runtime does not call it
  yet.
- Live queue features: FuelSupply flat queue, AddFeed RPC queue, PigDailys
  no-photo flat queue.
- Photos remain online-only until the photo offline queue phase.
- PWA home-screen bug is queued: manifest `start_url` is `/`, so Add to Home
  Screen can launch login/admin. Desired later fix is one operator entry point:
  `/webforms`.

High-risk contracts to keep front of mind:

- Flat anon queue: plain insert + 23505-on-csid = synced. No anon upsert.
- RPC queue: idempotency happens inside SECURITY DEFINER RPCs. 23505 escaping
  RPC is a bug.
- AddFeed and WeighIns RPC children keep `client_submission_id` NULL; parent
  owns dedup.
- WeighIns RPC v1 is pig/broiler draft sessions only. No cattle/sheep,
  completion, processor, retag, comments, or photos.
- Team roster writer is single-owner. Public forms only read roster and
  availability.
- Hand-created pig/poultry/layer daily tables likely have RLS disabled. Do
  not broaden/narrow RLS casually.

Likely next prompt to prepare:

Option A, small field-facing fix:
PWA/webforms home-screen fix. Change manifest start_url to `/webforms`, keep
scope `/` unless tests show standalone navigation trouble, add a small note on
the webforms page if desired, and test direct `/webforms` public load.

Option B, architecture lane:
Phase 1C-D WeighIns runtime wiring. Use the existing RPC queue architecture
for pig/broiler draft sessions only. No cattle/sheep/completion/processor
flows. Needs a plan packet before code because WeighIns has multiple existing
submit paths and side effects.

When producing a CC-ready block, keep it concise and copyable. Start with
`Codex Review`.
```
