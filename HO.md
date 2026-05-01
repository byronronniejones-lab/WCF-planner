# HO - next-session launch prompts

This file is prompts only. Deep state, roadmap, contracts, and history live in
`PROJECT.md`, especially Section 7 (load-bearing rules), Section 8 (roadmap),
and Part 4 (session index). Keep this file lean enough that CC and Codex can
start fast.

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
- HO.md is updated at session wrap, not mid-build, unless Ronnie says
  otherwise.

---

## Current State Snapshot

**Latest pushed commit:** `4874f1d feat(tasks): Phase A schema + RLS + bucket (no UI)`.

Recent shipped work:

- `2dcdb20` fixed broiler reopen stale averages: reopening a complete broiler
  session now recomputes/clears that batch/week's stored `ppp-v4 wk*Lbs`.
- `4874f1d` shipped Tasks Module v1 Phase A: mig 036 task tables, mig 037
  `is_admin()` + RLS, mig 038 private `task-photos` bucket, and a TEST recon
  script. TEST recon was green; PROD + TEST + source are aligned.

**Migrations applied through current source:** 030-038. Task migrations 039-041
are still future work.

**Offline queue - what's wired:**

- FuelSupply: flat `useOfflineSubmit('fuel_supply')`.
- AddFeed: RPC queue via `useOfflineRpcSubmit('add_feed_batch')`.
- PigDailys standalone: flat queue with prepared-photo + atomic IDB enqueue.
- WebformHub broiler/pig/cattle/sheep daily reports: per-form hooks +
  aggregated stuck modal. Layer + egg stay online-direct.
- WeighIns pig + broiler fresh draft sessions only: RPC queue. Cattle/sheep +
  completion + processor + retag stay online-direct.

**Current planned next lane:** Tasks Module v1 Phase B + schema cleanup.

Locked decisions for that lane:

- Cron mechanism: Supabase Edge Function + pg_cron + pg_net + Vault.
- Daily generator schedule: 04:00 UTC.
- Weekly summary schedule: Monday 13:00 UTC.
- Recurrence enum includes quarterly.
- No required-photo support anywhere in Tasks v1. Phase B planning must remove
  or permanently disable Phase A's `requires_photo` columns before UI/RPC code
  can depend on them.

**Queued cattle planning now captured in PROJECT.md Section 8:**

- Cattle Herd tab filter/sort rebuild, including correct age sort direction,
  composable filters, grouped/flat toggle, and complete cattle maternal-issue
  retirement.
- Cattle Forecast tab replacing the Excel finisher forecast workflow with live
  current-year + 3-year projections, ADG rules, planned batches, and saved
  overrides.

**Known working-tree noise** (LF/CRLF only - do not stage casually):
`tests/home_dashboard_equipment.spec.js` and
`tests/scenarios/home_dashboard_equipment_seed.js`.

---

## Prompt For Claude Code

```text
Read PROJECT.md top to bottom before planning. Pay special attention to:

- Section 1 SOP: explicit approval gates. Commit approval is not push approval.
  Do not run destructive commands without Ronnie's current-turn approval.
- Section 3 hand-created prod tables: some prod tables are not migration-owned.
- Section 7 load-bearing rules. Walk every touched rule in your plan.
- Section 8 roadmap and Known gotchas.
- Part 4 recent session rows and `git log --oneline -12`.

You are Claude Code (CC), the builder. Ronnie owns approvals. Codex is the
reviewer/gatekeeper. Ronnie will paste Codex messages to you in blocks that
start with `Codex Review`; treat those as Ronnie-relayed review instructions.
If Codex is wrong, say so clearly and explain why so Ronnie can adjudicate.

Current repo state to verify at session start:

- Latest pushed commit should be `4874f1d feat(tasks): Phase A schema + RLS +
  bucket (no UI)`.
- Run `git status --short` and `git log --oneline -12` before any plan.
- Expected unstaged noise may include:
  `tests/home_dashboard_equipment.spec.js` and
  `tests/scenarios/home_dashboard_equipment_seed.js` from LF/CRLF churn. Do not
  stage these unless you make real content changes.

Current feature state: see HO.md "Current State Snapshot" above this fence.

Load-bearing reminders for likely next work:

- Tasks Phase A is shipped; do not roll it back. Use new migrations for any
  schema cleanup.
- `public.is_admin()` deliberately does NOT explicitly revoke anon EXECUTE.
  Anon calls return false because `auth.uid()` is NULL. A stricter anon revoke
  caused Supabase/PostgREST schema-cache/auth sign-in failures during recon.
- Tasks v1 has no required-photo behavior. Remove/disable `requires_photo`
  before UI/RPC code can use it.
- Tasks assignees are `profiles.id`, not team roster IDs.
- Flat anon queue path uses plain insert and treats 23505 on the
  `client_submission_id` unique index as already synced. Do not use anon
  upsert/onConflict for flat webforms.
- RPC queue path is different: RPCs own idempotency internally. A 23505
  escaping an RPC is a bug, not a success.
- AddFeed and WeighIns RPC children keep `client_submission_id` NULL; parent
  owns dedup.
- WeighIns RPC v1 is pig/broiler draft sessions only. No cattle/sheep,
  completion, processor, retag, comments, or photos.
- Public broiler WeighIns must NOT read `app_store.ppp-v4` directly; use
  `webform_config.broiler_batch_meta`.
- Team roster writer is single-owner: TeamRosterEditor/WebformsAdminView only.
  Public forms read roster/availability; they do not write roster.
- Do not enable RLS on hand-created pig/poultry/layer daily tables without a
  paired policy plan.

Default first action:

Prepare a plan packet for Tasks Module v1 Phase B + schema cleanup. No code,
no migrations, no function deploy, no docs edits, no commit/push/deploy until
Ronnie and Codex approve the plan.

Minimum Phase B plan topics:

- How to remove or permanently disable required-photo support after Phase A.
- Edge function `tasks-cron` authorization: cron secret path plus admin
  user-JWT path using `rpc('is_admin')`.
- Migration 039 schedule using pg_cron + pg_net + Vault preflight.
- Quarterly recurrence generation.
- Test plan: unit, focused Playwright/function tests, and any TEST DB recon or
  smoke steps needed before prod.

Use the usual gates unless Ronnie narrows scope: format:check, lint, vitest,
build, focused Playwright, and relevant regression Playwright. Report warning
deltas and keep HO.md/session docs for wrap only.
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
  the next CC-ready prompt ready.
- Do not edit files, commit, push, deploy, install deps, or run destructive
  actions. CC performs the work.

Read:

- PROJECT.md top to bottom, especially Section 7 and Section 8.
- HO.md current snapshot.
- `git log --oneline -12`.

Current state: see HO.md "Current State Snapshot" above this fence.

High-risk contracts to keep front of mind:

- Tasks Phase A is shipped on TEST + PROD + source. Schema cleanup requires a
  new migration; no rollback shortcut.
- Required-photo support is removed from Tasks v1. Do not let Phase B/C/D add a
  UI, RPC, or completion gate that treats photos as required.
- `is_admin()` grant strategy is intentional: no explicit anon revoke.
- Cron choice is locked: Edge Function + pg_cron + pg_net + Vault; daily
  04:00 UTC; weekly Monday 13:00 UTC; quarterly recurrence included.
- Flat anon queue: plain insert + 23505-on-csid = synced. No anon upsert.
- RPC queue: idempotency happens inside SECURITY DEFINER RPCs. 23505 escaping
  an RPC is a bug.
- Public broiler WeighIns must NOT read `app_store.ppp-v4` directly.
- Team roster writer is single-owner. Public forms only read roster and
  availability.
- Hand-created pig/poultry/layer daily tables likely have RLS disabled. Do not
  broaden/narrow RLS casually.

Likely next prompt to prepare:

Tasks Module v1 Phase B + schema cleanup plan review. Ensure CC plans the
required-photo cleanup, cron authorization, Vault preflight, quarterly
recurrence, and test/recon/smoke gates before code.

When producing a CC-ready block, keep it concise and copyable. Start with
`Codex Review`.
```
