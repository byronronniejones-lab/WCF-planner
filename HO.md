# HO — handoff to next session

Two prompts below: one for Claude Code (the executor / builder), one for
Codex (the reviewer). Project state, code conventions, pitfalls, and
roadmap live in `PROJECT.md`. Working-style rules live in Claude's
auto-memory.

---

## Three-party working model

This project runs with a deliberate split:

- **Ronnie (you)** — the only person who can authorize commits, pushes,
  destructive ops, or anything that changes shared state. CC and Codex
  both report to you. CC executes only with explicit approval in the
  current turn (per the SOP in `PROJECT.md` §1). "commit" approval does
  not extend to "push"; "push" needs its own approval.

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

## Last session shipped (2026-04-28, both commits LOCAL-ONLY — not pushed)

- **A2 Playwright harness** (commit `0ad8fc2`). Local-only Playwright
  runner against an isolated Supabase test project
  (`msxvjupafhkcrerulolv`). `assertTestDatabase` guard, 29-table
  truncate whitelist, `exec_sql` RPC, single-bundle bootstrap generator
  (`scripts/build_test_bootstrap.js` → 99 KB output, gitignored), DEV-only
  backend sentinel, `--strictPort` to prevent zombie-dev-server
  contamination. Smoke spec (2 cases) green.
- **A4 pig batch math regression spec** (commit `3234ff6`). One
  happy-path Send-to-Trip test asserting the `subAttributions` schema,
  ledger current count, and the lbs/pig finishers-denominator
  regression for the 1644 vs 1186 P-26-01A bug. Reads
  `VITE_TEST_ADMIN_EMAIL` from env, wraps every Supabase write in a
  `must()` helper, polls `app_store` after modal close.
- **PROJECT.md updates** — §3 hand-created tables note, §8 sequencing
  with A2/A4 marked done + A5–A10 queued, §8 Known gotchas for the
  `pigSlug('P-26-01A') === 'p-26-01a'` foot-gun and the 9
  hand-created-prod-tables fact, Part 4 Session Index row.

End-of-session command results (all run before commits): `npm test`
53/53 passing, `npm run build` 1,654.66 kB (byte-identical to A2 — no
prod-bundle leak from the DEV-only sentinel), `npm run test:e2e` 4/4
passing.

**Before any push**: re-run all three commands together, review both
local commits as a unit, then approve the push as one block per Codex's
end-of-session note.

---

## Recommended next steps

`PROJECT.md` §8 has the priority queue. Top of stack as of 2026-04-28:

- **A5 — cattle Send-to-Processor spec.** Drive the bidirectional
  attach/detach flow (toggle clear, entry delete, session delete, batch
  delete) through the UI. Asserts `prior_herd_or_flock` stamping, the
  detach fallback hierarchy, and the §7 batch-membership rule. **Touches
  §7 heavily — review at PLAN time, not just edit time.**
- **A6 — sheep Send-to-Processor spec.** Mirror of A5 but verifies the
  intentionally looser gate (any draft session, any flock, vs. cattle's
  finishers-only).
- **A7 — broiler timeline spec.** Range derives from data, auto-scrolls
  to today.
- **A8a — fuel bill PDF parser spec.** Real PDF fixture
  (`ODBIN-0195942_2.PDF`) → `parseFuelBillText` end-to-end.
- **A8b — fuel reconciliation UI spec.** Seeded
  `fuel_bill_lines` + `equipment_fuelings` + `fuel_supplies` asserting
  variance bands.
- **A9 — FCR cache spec (Edit Trip).** Followup from A4. Drives
  `PigBatchesView.persistTrip` via Edit Trip → Save to verify
  `parent.fcrCached` populates on add and clears via
  `delete next.fcrCached` on null.
- **A10 — CI integration.** GitHub Actions running lint + vitest +
  playwright on every PR. Deferred per Codex review until lint baseline
  is clean (Initiative B).

After the Playwright initiative: ESLint + Prettier (Initiative B), then
PWA shell (Initiative C). Both have draft phase plans in `PROJECT.md`
§8 / chat history (relay if Codex needs context).

---

## Test-harness operational notes

- **Test Supabase project URL**:
  `https://msxvjupafhkcrerulolv.supabase.co`. Anon + service-role keys
  are in `.env.test` and `.env.test.local` respectively (both
  gitignored). Test admin user: `wcf-test-admin@example.com`.
- **Bootstrap a fresh test project**: `node scripts/build_test_bootstrap.js`
  → paste `scripts/test-bootstrap.sql` once into the test project's SQL
  Editor → run a profiles INSERT for the test admin user. CC has done
  this once; if the test project ever gets reset, repeat.
- **Run tests**: `npm test` (vitest, fast), `npm run test:e2e`
  (Playwright, slower), `npm run test:e2e -- <spec>` to run a single
  spec.
- **No CI yet** — local-only. A10 wires GitHub Actions later.

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
  - §8 roadmap + known gotchas — especially the
    `pigSlug('P-26-01A') === 'p-26-01a'` foot-gun if writing pig
    seeds, and the 9 hand-created prod tables note.
  - The most recent rows in §Part 4 Session Index (2026-04-28 covers
    A2 + A4 of the Playwright initiative).

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
  - 2 local commits from 2026-04-28 not yet pushed: 0ad8fc2 (A2) +
    3234ff6 (A4). PROJECT.md updates landed in a separate commit at
    end of last session.
  - Test infrastructure (Playwright + isolated Supabase test project)
    is operational. `npm run test:e2e` should be 4/4 green.
  - The test-only files .env.test, .env.test.local, .auth/, and
    scripts/test-bootstrap.sql are local-only and gitignored. Verify
    via `git status --short` they are not tracked before suggesting
    any commit.

Recommended sequencing for this session is in PROJECT.md §8. Top of
the queue is A5 (cattle Send-to-Processor spec) — touches §7 heavily,
plan first.

When oriented, ask me (multi-choice via AskUserQuestion) what to work
on. Common starting points:

  (a) A5 cattle Send-to-Processor spec — Plan + design before code.
      Foundational seed (cattle records + draft weigh-in session +
      empty processing batch shell) is upstream of the workflow under
      test; the attach/detach flow itself MUST go through the UI.
  (b) Continue an item from PROJECT.md §8 roadmap Near-term (I'll
      point at one).
  (c) Push the 2026-04-28 local commits to prod — re-run npm test +
      npm run build + npm run test:e2e first, review both as a unit.
  (d) Smoke-test or operationally validate something recently shipped.
  (e) Bring over a Podio app I'll name (READ §7 first — equipment
      imports have load-bearing rules).
  (f) Handle an operational bug or data anomaly I'll describe.

Migration layout note: applied migrations 001–026 live in
supabase-migrations/archive/. New migrations land at the parent path.
PROJECT.md §3 has the layout summary. Nine prod tables are
hand-created (no migration owns them) — see §3.
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

Repo: C:\Users\Ronni\WCF-planner (Windows + Git Bash). The unit-test
suite runs via `npm.cmd test`; production build via `npm.cmd run build`;
Playwright integration tests via `npm.cmd run test:e2e`.

Read these files to get oriented:

- PROJECT.md (top to bottom — §1 SOP, §3 hand-created prod tables, §7
  don't-touch list, §8 roadmap + Known gotchas, the most-recent rows
  in §Part 4 Session Index. The 2026-04-28 row covers Phase A2 + A4
  of the Playwright initiative).
- HO.md (this file). The prompt CC was booted with is also in here.

Phase A2 + A4 just landed locally (commits 0ad8fc2 and 3234ff6),
NEITHER PUSHED. The test harness lives in:
  - playwright.config.js
  - tests/setup/{assertTestDatabase,reset,global.setup}.js
  - tests/{fixtures,smoke.spec}.js
  - tests/scenarios/p2601_seed.js
  - tests/pig_batch_math.spec.js
  - scripts/build_test_bootstrap.js
  - .env.test + .env.test.local (gitignored)
  - scripts/test-bootstrap.sql (gitignored)
  - src/lib/supabase.js (env-driven URL/key with prod fallback;
    DEV-only backend sentinel via `window.__WCF_SUPABASE_URL`)

When CC asks for review or Ronnie relays something, give specific
concrete feedback citing file:line where applicable. When CC's plan
touches the §7 don't-touch list, call it out explicitly. When CC
misses a load-bearing constraint, say so before they ship.

Active load-bearing entries to be aware of (read full text in
PROJECT.md §7):
  - Supabase auth config (`detectSessionInUrl: false`,
    `storageKey: 'farm-planner-auth'`, `lock: pass-through`).
  - `weigh_ins.prior_herd_or_flock` semantics (mig 027).
  - Detach fallback hierarchy (cattle + sheep).
  - `cattle_transfers` + `sheep_transfers` append-only.
  - Cattle/sheep batch membership rule (only via `send_to_processor`).
  - `processingTrips[].subAttributions` schema.
  - `parent.fcrCached` clear-on-null contract.
  - `pigSlug('P-26-01A') === 'p-26-01a'` (no dash — uppercase letter
    is alphanumeric in /[^a-z0-9]+/g; foot-gun for any future test
    seed or operator hand-typing session.batch_id values).
  - 9 hand-created prod tables not in any migration.

Known queue (PROJECT.md §8):
  3. Playwright tests — IN PROGRESS. A2 + A4 done locally. A5 cattle
     Send-to-Processor next (touches §7 heavily — gate at PLAN time).
     A6 sheep, A7 broiler timeline, A8a/b fuel bills, A9 FCR cache
     via Edit Trip, A10 CI to follow.
  4. ESLint + Prettier (Initiative B) — pending.
  5. PWA shell (Initiative C) — pending.

When reviewing CC's pre-commit packet, expect: `git diff --stat`,
focused diffs for the load-bearing files, fresh `npm test` /
`npm run build` / `npm run test:e2e` outputs, and confirmation that
sensitive paths (.env.test, .env.test.local, tests/.auth/,
test-results/, playwright-report/, scripts/test-bootstrap.sql) are
gitignored (`git check-ignore -v` output).
```
