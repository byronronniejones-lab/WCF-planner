# Handoff — next Claude session

This file contains only the copy-paste prompt that boots the next session. All
session recaps, code conventions, pitfalls, roadmap, and project state live in
`PROJECT.md` (durable doc) — the prompt below directs Claude there.

---

## Copy-paste prompt for next session

```
Read PROJECT.md top to bottom. Pay extra attention to §1 SOP (deployment +
working style), §7 don't-touch list (load-bearing rules — equipment math,
fuel reconciliation, webform_config writes, etc.), §8 roadmap + Known
gotchas, and the most-recent row in §Part 4 Session Index for what shipped
last session.

I'm Ronnie — farm owner, admin of WCF Planner (white-creek-farm
operations app). Working style:

- Use the AskUserQuestion tool (multi-choice pop-out boxes) for clarifying
  questions, not inline prose.
- Don't ask questions that PROJECT.md already answers.
- Don't assume — ask if scope is ambiguous.
- Push back when warranted; don't be a yes-man. I sometimes have Codex
  acting as a second-opinion reviewer in the same session.
- Never commit, push, or deploy without my explicit approval in the
  current turn. "commit and push" in one turn is one approval covering both.
- No purple in the UI.
- For multi-step builds, use TaskCreate / TaskUpdate to track progress.
- After any push, match deploy verification to risk: dev-only push (tests,
  docs, devDeps that don't enter the bundle) → a 200 from prod is enough.
  Runtime push → need direct deploy status, asset-hash rotation, or a
  behavior probe (Netlify doesn't post commit statuses on this repo).

When you've read enough to be oriented, ask me (multi-choice via
AskUserQuestion) what to work on. Common starting points:

  (a) Continue an item in PROJECT.md §8 roadmap (I'll point at a specific one)
  (b) Smoke-test or operationally validate something we just shipped
  (c) Bring over a Podio app I'll name (READ the don't-touch list first —
      especially equipment imports have load-bearing rules in §7)
  (d) Handle an operational bug or data anomaly I'll describe
  (e) Continue a multi-week initiative (e.g. test suite phase 1 is done;
      Phase 2 ESLint/Prettier was scoped but not started)
```
