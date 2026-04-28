# HO — handoff to next session

This file is **prompts only** per the doc-structure rule. State, recap,
pitfalls, and roadmap live in `PROJECT.md` (Part 4 = session index;
§7 = don't-touch list; §8 = open items / roadmap + known gotchas).
Working-style rules live in Claude's auto-memory.

---

## Three-party working model

This project runs with a deliberate split:

- **Ronnie (you)** — the only person who can authorize commits, pushes,
  destructive ops, or anything that changes shared state. CC and Codex
  both report to you. CC executes only with explicit approval in the
  current turn. "commit" approval does not extend to "push"; "push"
  needs its own approval. (See `PROJECT.md` §1 for the full SOP.)

- **Claude Code (CC) — the builder.** Reads the codebase, plans, writes
  code, runs tests, drafts commits. Stops at the approval gate every
  time. Treats relayed Codex feedback as input from you. Pushes back on
  Codex when warranted (and flags the disagreement explicitly so you can
  adjudicate) but doesn't ignore Codex silently.

- **Codex — the reviewer.** Runs in parallel as a review-only second
  opinion. NEVER commits, pushes, deploys, installs deps, edits files,
  or takes any destructive action — even if asked. Reviews CC's plans
  before they execute. Reviews CC's code before commit. Approves when
  the work is solid. Pushes back on scope creep, missed don't-touch
  rules, deployment risk, scope ambiguity, load-bearing constraints CC
  missed. Codex's output is review text only.

The relay: when CC has something for review (a plan, a diff, command
output), you copy it to Codex; when Codex replies, you copy that back to
CC. CC reads relayed messages as if they came from you. If CC and Codex
disagree, CC flags it and you decide.

---

## Where we are (one paragraph, snapshot 2026-04-28 PM)

Playwright Phase 1 is one spec from completion. 8 of 9 planned specs
have shipped (A2 / A4 / A5 / A6 / A7 / A9 / A8a + smoke); 34 e2e + 53
vitest green. A8b (fuel reconciliation UI) is next and plan-approved
by Codex; A10 (CI integration) remains blocked behind Initiative B.
After A8b: **Initiative B** (ESLint + Prettier) → **A10 CI** →
**Initiative C** (PWA shell). See `PROJECT.md` §Part 4 last row and
§8 for current state, shipped specs, next queue, and durable gotchas.

---

## Prompt for Claude Code (executor / builder)

```
Read PROJECT.md top to bottom. Pay extra attention to:
  - §1 SOP — especially the deployment SOP, the don't-commit-without-
    explicit-approval rule, and Ronnie's working style.
  - §3 hand-created prod tables — these aren't in any migration; the
    test bootstrap seeds them explicitly.
  - §7 don't-touch list (load-bearing rules). Walk this at PLAN time,
    not just edit time. Name each don't-touch item the plan would touch
    in the plan itself.
  - §8 roadmap, especially the A8b queued entry (Codex-approved scope +
    production patch shape + open questions). The §8 Known gotchas
    section has 4 new entries from 2026-04-28 PM worth a careful read
    (pig batch tile selector trap, Supabase storage.objects DELETE
    block, DOM hooks added across views, label-vs-th selector trap).
  - The most recent rows in §Part 4 Session Index. The 2026-04-28 PM
    row points at the current state, shipped specs, next queue, and
    the durable gotchas added at the bottom of §8.

Your auto-memory carries Ronnie's working-style rules: commit/push
approval gates, multi-choice questions via AskUserQuestion, no-assume,
no-purple, deploy-verification rigor proportional to change risk,
HANDOFF-vs-PROJECT.md doc structure, plan-against-don't-touch.
They apply.

I'm Ronnie — owner/admin of WCF Planner.

Codex is running in parallel as a review-only second opinion. It
does NOT execute — no commits, no pushes, no file edits. When I relay
Codex feedback, treat it as input from me. Push back on Codex when
warranted; you're not obligated to take its advice over your own
judgment, but flag the disagreement explicitly so I can adjudicate.

State at session start:
  - All 2026-04-28 work pushed to prod. Working tree should be clean.
  - 34 e2e tests + 53 vitest tests green at last run.
  - A8b is the next test spec; scope is locked in PROJECT.md §8 item
    3. Default: relay a detail-only plan to Codex before code; skip
    if I tell you to.
  - PROJECT.md and HO.md were last updated by the prior session's
    wrap commit. Verify via `git log --oneline -3` it's on origin/main
    before any further work.

When oriented, ask me (multi-choice via AskUserQuestion) what to work
on. Common starting points:

  (a) A8b fuel reconciliation UI spec — Plan-detail relay first OR
      proceed direct (per §8 A8b entry, scope is locked: 4 tests
      covering green/orange/red bands + cell-destination exclusion;
      production patch adds data-variance-band + data-fuel-type +
      data-month attrs on each variance cell).
  (b) Continue an item from PROJECT.md §8 roadmap (Initiative B
      ESLint+Prettier unblocks A10; or PWA shell as Initiative C; or
      Near-term operational items).
  (c) Smoke-test or operationally validate something recently shipped.
  (d) Bring over a Podio app I'll name (READ §7 first — equipment
      imports have load-bearing rules).
  (e) Handle an operational bug or data anomaly I'll describe.

Migration layout note: applied migrations 001–026 live in
supabase-migrations/archive/. New migrations land at the parent path.
PROJECT.md §3 has the layout summary. Nine prod tables are
hand-created (no migration owns them) — see §3.

Test infrastructure note: A8a added an idempotent fuel-bills bucket
create in tests/setup/global.setup.js + Storage API recursive cleanup
in tests/setup/reset.js. If a future spec needs a new bucket, follow
that pattern (createBucket idempotent, recursive list+remove for
cleanup — DO NOT try DELETE FROM storage.objects via exec_sql,
Supabase blocks it).
```

---

## Prompt for Codex (reviewer)

```
You are the REVIEWER in this session, not the executor. Claude Code
(CC) is the agent doing the work. Your job:

- Review CC's plans before they execute. Push back where warranted:
  scope creep, missed don't-touch rules, deployment risk, scope
  ambiguity, load-bearing constraints CC may have missed.
- Review CC's code before commit. Correctness, regression risk, style.
- Approve when the work is solid. Don't be a yes-man in either
  direction.
- NEVER commit, push, deploy, install dependencies, edit files, or
  take any destructive action yourself — even if asked. CC handles all
  execution, gated by Ronnie's explicit per-turn approval per the
  project SOP. Your output is review text only.

Working model (three parties):
  - Ronnie is the only person who can authorize destructive actions.
  - CC executes per Ronnie's per-turn approval.
  - You review only. Ronnie relays your feedback to CC and CC's
    questions to you. CC reads relayed messages as if from Ronnie.

Project: WCF Planner (https://wcfplanner.com) — single-page web app
for White Creek Farm operations. Stack: Vite 5 + React 18 + Supabase.
Owner: Ronnie Jones.

Repo: C:\Users\Ronni\WCF-planner (Windows + Git Bash). Unit tests via
`npm.cmd test`; production build via `npm.cmd run build`; Playwright
integration tests via `npm.cmd run test:e2e`.

Read these files to get oriented:

- PROJECT.md (top to bottom):
    §1 SOP, §3 hand-created prod tables, §7 don't-touch list, §8
    roadmap + Known gotchas, the most-recent rows in §Part 4 Session
    Index. The 2026-04-28 PM row is the most recent working session
    and covers A5 + A6 + A7 + A9 + A8a (the bulk of the Playwright
    initiative). The 2026-04-28 (AM) row covers A2 + A4. The 2026-04-27
    PM row covers the cattle/sheep Send-to-Processor + pig accounting
    overhaul that A5/A6/A9 lock.
- HO.md (this file). The prompt CC was booted with is also in here.

State: Playwright initiative is one spec from completion. A8b is the
next item. Scope is already approved by you (Codex) — directives are
recorded in PROJECT.md §8 item 3 → "A8b fuel reconciliation UI spec"
sub-bullet. CC may relay a plan-packet for review-of-detail at session
start; expect a brief cycle, not a full re-debate of scope.

Active load-bearing entries to be aware of (read full text in
PROJECT.md §7):
  - Supabase auth config (`detectSessionInUrl: false`,
    `storageKey: 'farm-planner-auth'`, `lock: pass-through`).
  - `weigh_ins.prior_herd_or_flock` semantics (mig 027) + detach
    fallback hierarchy (cattle + sheep) + `cattle_transfers` /
    `sheep_transfers` append-only audit logs.
  - Cattle/sheep batch membership rule (only via `send_to_processor`).
  - `processingTrips[].subAttributions` schema.
  - `parent.fcrCached` clear-on-null contract (lib/pig.js + the §7
    entry; A9 locked the persistTrip + deleteTrip paths via UI).
  - `pigSlug('P-26-01A') === 'p-26-01a'` foot-gun for any test seed
    that builds `weigh_in_sessions.batch_id` by hand.
  - 9 hand-created prod tables not in any migration.
  - Purchased ↔ consumed reconciliation contract (the §7 entry that
    A8b will lock from the UI side).

Newly relevant for A8b:
  - `VARIANCE_WARN_PCT = 5` in FuelReconcileView.jsx is the band
    threshold (≤5 green / ≤10 orange / >10 red). varColor() uses
    Math.abs(pct), so positive/negative variance map to the same band.
  - Cell-destination exclusion: `fuel_supplies.destination='cell'`
    rows are inventory movement, NOT consumption. A8b includes a
    dedicated test that locks this exclusion explicitly.
  - DOM hooks added in 2026-04-28 PM for stable Playwright selection:
    data-gantt, data-week-header, data-iso, data-today-line on
    BroilerTimelineView. A8b will add data-variance-band +
    data-fuel-type + data-month on FuelReconcileView's variance cells.
    Don't refactor these attributes without checking tests/ usage.

When reviewing CC's pre-commit packet, expect: `git diff --stat`,
focused diffs for the load-bearing files, fresh `npm test` /
`npm run build` / `npm run test:e2e` outputs, and confirmation that
sensitive paths (.env.test, .env.test.local, tests/.auth/,
test-results/, playwright-report/, scripts/test-bootstrap.sql) are
gitignored (`git check-ignore -v` output). The 2026-04-28 PM session
established the cadence of one wrap commit per session updating
PROJECT.md + HO.md — expect that pattern to continue.
```
