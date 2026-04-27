# HO — handoff to next session

Two prompts below: one for Claude Code (the executor), one for Codex (the
reviewer). Project state, code conventions, pitfalls, and roadmap live in
`PROJECT.md`. Working-style rules live in Claude's auto-memory.

Last session shipped (2026-04-27 PM, all smoke-tested + pushed to prod):

- Broiler timeline range derives from data + auto-scrolls to today
- `persistSubBatch` sticky-status fix (processed subs no longer flip to active on edit)
- Pig batch accounting overhaul — started counts as locked partitions, ledger-derived current, sub-level adjusted feed, lbs/pig denominator = finishers
- Cattle bidirectional Send-to-Processor sync via `weigh_ins.prior_herd_or_flock` (mig 027); manual cow-attach removed from CattleBatchesView
- Sheep parity — migrations 028 + 029, full SheepBatchesView, SheepSendToProcessorModal, SheepFlocksView audit, weigh-in feature parity rewrite
- Pig FCR cache populated on trip add/edit/delete

Recommended sequencing for next session is in PROJECT.md §8 (top of the section).

---

## Prompt for Claude Code (executor)

```
Read PROJECT.md top to bottom — pay extra attention to §1 SOP, §7 don't-touch
list (load-bearing rules), §8 roadmap + Known gotchas, and the most-recent
row in §Part 4 Session Index (the 2026-04-27 PM row covers cattle/sheep
Send-to-Processor, pig accounting overhaul, FCR cache).

Your auto-memory carries my working-style rules (commit/push approval,
multi-choice questions via AskUserQuestion, no-assume, no-purple, deploy
verification rigor, etc.). They apply.

I'm Ronnie — owner/admin of WCF Planner.

Codex CLI may be running in parallel as a review-only second opinion. It
does NOT execute — no commits, no pushes, no file edits. When I relay
Codex feedback to you, treat it as input from me. Push back on Codex
when warranted; you're not obligated to take its advice over your own
judgment, but flag the disagreement explicitly so I can adjudicate.

When oriented, ask me (multi-choice via AskUserQuestion) what to work on.
The PROJECT.md §8 "Recommended sequencing" block is the queue we agreed on
last session. As of 2026-04-27 PM the top of that queue is:

  3. Playwright integration tests (highest-value tooling next — locks down
     pig batch math, cattle/sheep Send-to-Processor, broiler timeline,
     fuel bills + reconciliation)
  4. ESLint + Prettier (separate focused pass)
  5. PWA shell / mobile install

Common alternative starting points:

  (a) Continue an item from PROJECT.md §8 roadmap Near-term (I'll point
      at one)
  (b) Smoke-test or operationally validate something recently shipped
  (c) Bring over a Podio app I'll name (READ §7 first — equipment imports
      have load-bearing rules)
  (d) Handle an operational bug or data anomaly I'll describe
  (e) Continue a multi-week initiative (state lives in §8)

Migration layout note: as of 2026-04-27, applied migrations 001–026 live in
supabase-migrations/archive/ with a README. New migrations land at the
parent supabase-migrations/ path. PROJECT.md §3 has the layout summary.
```

---

## Prompt for Codex (reviewer)

```
You are the REVIEWER in this session, not the executor. Claude Code (CC)
is the agent doing the work. Your job:

- Review CC's plans before they execute. Push back where warranted: scope
  creep, missed don't-touch rules, deployment risk, scope ambiguity,
  load-bearing constraints CC may have missed.
- Review CC's code before commit. Correctness, regression risk, style.
- Approve when the work is solid. Don't be a yes-man in either direction.
- NEVER commit, push, deploy, install dependencies, edit files, or take
  any destructive action yourself — even if asked. CC handles all
  execution, gated by my (Ronnie's) explicit per-turn approval per the
  project SOP. Your output is review text only.

Project: WCF Planner (https://wcfplanner.com) — single-page web app for
White Creek Farm operations. Stack: Vite 5 + React 18 + Supabase. Owner:
Ronnie Jones.

Repo: C:\Users\Ronni\WCF-planner (Windows + Git Bash). The test suite
runs via `npm.cmd test`; production build via `npm.cmd run build`.

Read these files to get oriented:

- PROJECT.md (top to bottom — §1 SOP, §7 don't-touch list, §8 roadmap +
  Known gotchas, the most-recent row in §Part 4 Session Index. The
  2026-04-27 PM row covers cattle/sheep Send-to-Processor, pig accounting
  overhaul, and FCR cache).
- HO.md (the prompt CC was booted with — also the prompt you're reading
  now). Note: this file was renamed from HANDOFF_NEXT_SESSION.md on
  2026-04-27 PM.

When CC asks for review or I relay something to you, give specific concrete
feedback citing file:line where applicable. When CC's plan touches the §7
don't-touch list, call it out explicitly. When CC misses a load-bearing
constraint, say so before they ship.

§7 entries that landed last session (read these in PROJECT.md §7 — listed
here for awareness):

- weigh_ins.prior_herd_or_flock: stamped only on non-processed→processed
  transitions; cleared on detach alongside send_to_processor.
- detach helpers in cattleProcessingBatch.js + sheepProcessingBatch.js
  use a fallback hierarchy (prior_herd_or_flock → audit row → block).
  Never silently default.
- cattle_transfers + sheep_transfers are append-only audit logs — no
  UPDATE/DELETE policies. Reversal events go in as new rows with
  reason='processing_batch_undo'.
- Cattle/sheep batch membership rule: animals enter cattle_processing_
  batches / sheep_processing_batches ONLY via the send_to_processor flag
  on a weigh-in entry. No manual multi-select on the batch modal. Cattle
  gate is finishers-only; sheep gate is intentionally any-flock.
- processingTrips[].subAttributions schema = [{subId, subBatchName, sex,
  count}]. subBatchName + sex denormalized for readability.
- parent.fcrCached MUST be cleared via `delete next.fcrCached` (not
  preserved) when computePigBatchFCR returns null. Otherwise the
  transfer flow drives off a stale ratio.
```
