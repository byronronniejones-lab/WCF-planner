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
- **Lane approval** (e.g., "go on C1 deploy", "go on C4") covers SQL writes,
  Vault provisioning, function deploys, `.env.prod.local`-driven psql, and mig
  applies inside that lane. Commit and push remain separate explicit
  approvals. `exec_sql` in PROD remains absolutely forbidden under any
  approval.
- Codex is the reviewer/gatekeeper. Codex does not execute. Anything Ronnie
  should paste to CC must be in a copyable block starting exactly:
  `Codex Review`.
- Codex should stay one step ahead: while CC builds the active lane, Codex
  should inspect the next likely lane and prepare the next CC-ready prompt.
- HO.md is updated at session wrap, not mid-build, unless Ronnie says
  otherwise.

---

## Current State Snapshot

**Latest pushed commit:** see `git log --oneline -1` (this session's wrap
captures Tasks Phase B PROD P1-P6 + Tasks v1 combined-build plan rev 5).

**Tasks Phase B PROD deploy: P1-P6 GREEN; P7 PENDING.** Operational deploy
lane completed 2026-05-01 by CC under Ronnie's Option B (CC drives every step
via psql + Supabase CLI). Vault has all 3 entries; Edge Function
`tasks-cron` deployed at `https://pzfujbjtayhkdlxiblwe.supabase.co/functions/v1/tasks-cron`;
function env secrets set via CLI with SHA256-verified zero-drift; mig 039
applied; manual 3-layer audit via `SELECT public.invoke_tasks_cron();` walked
end-to-end (HTTP 200 + run_mode='cron' + error_message NULL); HTTP probe
10/10 active probes (cases 6+8 admin-mode skipped cleanly per PROD-no-creds
allowance). Cron schedule `tasks-cron-daily` registered at `0 4 * * *` UTC
active=t. **P7 = post-fire audit at first scheduled fire 2026-05-02 04:00 UTC
= 2026-05-01 23:00 CDT.** PROD already carries one `tcr-probe-*` row from
P6's case 5 (kept as real audit per Codex Q4). PROJECT.md §8 "Next build"
carries P-by-P detail including the post-fire audit SQL block.

**`.env.prod.local` (gitignored, machine-local)** holds `PROD_DB_URL`
(Session Pooler URI; direct connection blocked by no-IPv4 on this network),
`PROD_SERVICE_ROLE_JWT` (legacy 219-char), `PROD_ANON_KEY`,
`PROD_TASKS_CRON_SECRET` (P1 mint capture). Reusable for P7 walk + future
PROD deploy lanes; lane approval still required per-lane.

**Tasks v1 combined-build plan: rev 5 APPROVED by Codex** (no remaining
architecture blockers). Direction: combine Phase C+D+E+F into one build with
4 internal checkpoints. **Code begins only after P7 verifies.** Per-checkpoint
Ronnie approval before code lands. Detail + locked decisions in PROJECT.md §8
"Next build" (C1-C4) + Part 4 session row.

**Migrations applied through current source AND PROD:** 030-039. Future v1
migs: 040 (C2 complete RPC), 041 (C3 public-submit + list-eligible RPCs),
042 (C4 weekly summary + new `task_summary_runs` table + Vault entry +
schedule).

**Edge Function deploy path locked: Supabase CLI** (Phase B Option B
precedent). Dashboard paste for function secrets is forbidden (whitespace
pitfall — see §7 Phase B deploy-lessons). C4 will deploy
`supabase/functions/tasks-summary/index.ts` (canonical CLI layout) + edit
existing legacy-flat `supabase-functions/rapid-processor.ts` for the new
`tasks_weekly_summary` payload type.

**Immediate operational lane:** P7 verification — post-fire 3-layer audit
walk in tomorrow's session (after 23:00 CDT 2026-05-01). On green, mark
Phase B PROD deploy COMPLETE in PROJECT.md §8.

**Next source build (gated behind P7 green):** Tasks v1 combined-build C1
(Admin Tasks UI). C2 → C3 → C4 follow in order. Each checkpoint has its own
pre-merge gate (format:check / lint / vitest / build / focused Playwright +
RLS-security regression).

**Known working-tree noise** (LF/CRLF only — do not stage casually):
`tests/home_dashboard_equipment.spec.js` and
`tests/scenarios/home_dashboard_equipment_seed.js`.

---

## Prompt For Claude Code

```text
Read PROJECT.md top to bottom before planning. Pay special attention to:

- Section 1 SOP: explicit approval gates. Commit approval is not push
  approval. Lane approval covers SQL + function deploys inside that lane.
- Section 3 hand-created prod tables: some prod tables are not migration-
  owned.
- Section 7 load-bearing rules. Walk every touched rule in your plan.
- Section 8 "Next build" — Phase B PROD deploy P1-P7 status block (currently
  P1-P6 green, P7 pending) + Tasks v1 combined-build plan rev 5 (C1-C4).
- Part 4 recent session rows + `git log --oneline -12`.

You are Claude Code (CC), the builder. Ronnie owns approvals. Codex is the
reviewer/gatekeeper. Ronnie will paste Codex messages to you in blocks that
start with `Codex Review`; treat those as Ronnie-relayed review instructions.
If Codex is wrong, say so clearly and explain why so Ronnie can adjudicate.

Current repo state to verify at session start:

- Run `git status --short` and `git log --oneline -12` before any plan.
- Expected unstaged noise: `tests/home_dashboard_equipment.spec.js` and
  `tests/scenarios/home_dashboard_equipment_seed.js` (LF/CRLF). Do not stage.
- `.env.prod.local` should be gitignored (verify with `git check-ignore -v
  .env.prod.local`); if unexpectedly tracked, STOP and surface to Ronnie.

Current feature state: see HO.md "Current State Snapshot" above this fence.

Default first action: **P7 verification.**

If the current local time is past 23:00 CDT 2026-05-01 (= 2026-05-02 04:00
UTC, the first scheduled cron fire), run the post-fire 3-layer audit. Use
psql against PROD with `.env.prod.local` PROD_DB_URL (Phase B Option B
precedent; no `exec_sql` in PROD; Ronnie's lane-approval applies):

```sql
-- Layer 1: cron.job_run_details — did pg_cron's scheduler fire?
SELECT j.jobname, jrd.runid, jrd.start_time, jrd.end_time,
       jrd.status, jrd.return_message
FROM cron.job_run_details jrd
JOIN cron.job j ON j.jobid = jrd.jobid
WHERE j.jobname = 'tasks-cron-daily'
ORDER BY jrd.start_time DESC LIMIT 5;

-- Layer 2: net._http_response — did the http_post deliver?
SELECT id, status_code, content::text, error_msg, timed_out, created
FROM net._http_response
ORDER BY created DESC LIMIT 5;

-- Layer 3: task_cron_runs — did the function execute its logic?
SELECT id, ran_at, run_mode, generated_count, skipped_count,
       error_message, cap_exceeded
FROM public.task_cron_runs
ORDER BY ran_at DESC LIMIT 5;
```

Expected post-fire shape: L1 row with status='succeeded'; L2 row HTTP 200 +
body `{"ok":true,"generated_count":0,...}`; L3 row run_mode='cron' counts 0/0
error_message NULL (no templates exist yet — counts will become non-zero
once C1 ships and admin creates active templates). **Missing L3 ≠ "cron
didn't fire"** — walk all three. If only L1+L2 present, check Edge Function
logs via Supabase Dashboard for the deploy ref before retrying.

On all 3 green: edit PROJECT.md §8 to mark P7 ✓ and call Phase B PROD deploy
COMPLETE. That doc edit is part of the next wrap commit (don't auto-commit;
wait for Ronnie's approval).

After P7 green: **Tasks v1 combined-build C1** is ready to begin (admin
Tasks UI). See PROJECT.md §8 "Next build" → C1 detail. Plan packet was rev 5;
no further plan revisions expected unless Codex flags new issues. Wait for
Ronnie's per-checkpoint "go" before C1 code lands.

If Ronnie redirects to C1 code BEFORE P7 verifies: that is an explicit gate
override — record it in PROJECT.md §8 + this wrap.

Use the usual gates unless Ronnie narrows scope: format:check, lint, vitest,
build, focused Playwright per checkpoint, RLS/security Playwright. Report
warning deltas. HO.md/session docs are session-end only.
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
- Treat commit and push as separate gates. Lane approval covers SQL +
  function deploys inside, NOT commit/push.
- Stay one step ahead. While CC builds, inspect the next likely lane and have
  the next CC-ready prompt ready.
- Do not edit files, commit, push, deploy, install deps, or run destructive
  actions. CC performs the work.

Read:

- PROJECT.md top to bottom, especially Section 7, Section 8 "Next build"
  (Phase B P1-P7 status + Tasks v1 combined-build C1-C4), and Part 4 recent
  rows.
- HO.md current snapshot.
- `git log --oneline -12`.

Current state: see HO.md "Current State Snapshot" above this fence.

High-risk contracts to keep front of mind:

- **Tasks Phase B PROD deploy: P1-P6 GREEN, P7 PENDING tonight's cron fire.**
  Don't call Phase B PROD deploy complete until CC walks all 3 audit layers
  cleanly post-fire (L1 cron.job_run_details + L2 net._http_response + L3
  task_cron_runs).
- **Tasks v1 combined-build plan rev 5 is plan-only and approved.** C1 code
  begins only after P7 verification + Ronnie's per-checkpoint go.
- **No required-photo behavior anywhere in Tasks v1.** C2 photos are optional
  only; never required.
- **C2 photo path canonical shape:** storage upload arg uses
  `<uid>/<id>/<filename>`; DB column + RPC arg + RPC validation use
  `task-photos/<uid>/<id>/<filename>`. Converters in `src/lib/tasks.js` lock
  this. Path validation uses `left()`+`substring()` (NOT `LIKE` — `_`/`%` are
  wildcards).
- **C3 public-form people model:** assignee = profiles.id login user;
  submitted-by = team-roster display-name string filtered by
  team_availability['tasks-public'].hiddenIds. Assignee never resolves to a
  roster id. `submit_task_instance` validates submitted_by_team_member
  against the same source the UI dropdown uses (read-fresh roster + null-safe
  coalesce).
- **C3 offline registry path:** `src/lib/offlineRpcForms.js` (RPC-mediated),
  NOT `offlineForms.js` (flat-insert). Entry shape uses `rpc` + `buildArgs`
  + returns `{rpc, args:{parent_in}}`. TasksWebform passes `opts.parentId =
  'ti-' + crypto.randomUUID()` since the hook's default doesn't match.
- **C4 audit lives in `task_summary_runs` (mig 042 new table)**, separate
  from `task_cron_runs`. Do NOT overload `generated_count`/`skipped_count`
  with summary semantics.
- **C4 Vault strategy:** mint only `TASKS_SUMMARY_FUNCTION_URL`; reuse
  `TASKS_CRON_SECRET` + `TASKS_CRON_SERVICE_ROLE_KEY`. CLI for any secret
  writes; no Dashboard paste.
- **`exec_sql` is TEST-ONLY; absolutely forbidden in PROD** under any
  approval shape.
- **Edge Function deploy is CLI-canonical:** `supabase functions deploy
  <name> --project-ref pzfujbjtayhkdlxiblwe`. C4 deploys
  `supabase/functions/tasks-summary/index.ts` (canonical layout). Existing
  `supabase-functions/rapid-processor.ts` (legacy flat layout, in-repo) gets
  a new `tasks_weekly_summary` payload-type handler branch as part of C4.
- **Audit model is three layers, no overlap:** cron.job_run_details (joined
  to cron.job on jobid; run_details has no jobname column), net._http_response,
  task_cron_runs. Missing L3 ≠ "cron didn't fire" — walk all three.
- **`is_admin()` grant strategy:** no explicit anon revoke (Supabase
  schema-cache quirk). Anon gets false because auth.uid() is NULL.
- **Component-level admin guard** (`UnauthorizedRedirect`) is mandatory for
  C1's `/admin/tasks`. Header dropdown gate alone is not sufficient — direct
  URL navigation must redirect non-admin to home.

Likely next prompt to prepare:

The immediate gate is **Phase B P7 verification review** — confirm CC walks
the 3 audit layers cleanly + marks Phase B complete only when L1+L2+L3 all
match expected shape (HTTP 200, run_mode='cron', error_message NULL on first
scheduled fire). Confirm CC does not silently retry on missing layers.

After P7 verifies, prepare the C1 plan-review block: scope (template CRUD +
Run Cron Now admin-mode + audit footer + UnauthorizedRedirect guard), test
plan (admin access redirect regression + template CRUD + Run Cron Now
idempotency where second click yields generated=0/skipped=0 + audit
visibility), and confirm no `requires_photo` field surfaces anywhere in the
template form.

When producing a CC-ready block, keep it concise and copyable. Start with
`Codex Review`.
```
