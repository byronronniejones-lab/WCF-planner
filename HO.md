# HO — handoff to next session

This file is **prompts only** per the doc-structure rule. State, recap,
pitfalls, and roadmap live in `PROJECT.md` (Part 4 = session index;
§7 = don't-touch list; §8 = open items / roadmap + known gotchas).
Working-style rules live in Claude's auto-memory.

---

## Three-party operating SOP (Ronnie / Codex / CC)

This project runs with a deliberate split.

- **Ronnie (you)** — the only person who can authorize commits, pushes,
  destructive ops, or anything that changes shared state. CC and Codex
  both report to you. CC executes only with explicit approval in the
  current turn. "commit" approval does not extend to "push"; "push"
  needs its own approval. (See `PROJECT.md` §1 for the full SOP.)

- **Claude Code (CC) — the builder.** Reads the codebase, plans, writes
  code, runs tests, drafts commits. **Plans first** before building
  unless Ronnie/Codex have explicitly approved coding for the current
  task. Treats relayed Codex feedback as input from Ronnie. If Codex
  finds blockers, CC fixes and reports back; if CC and Codex disagree,
  CC flags it explicitly so Ronnie can adjudicate.

- **Codex — the reviewer.** Talks to Ronnie normally in chat. Acts as
  the gatekeeper before commit/push and before each new build.
  Anything Ronnie should paste/send to CC must be in a copyable text
  block and must start with `Codex Review`. Approves builds when work
  is solid; pushes back on scope creep, missed don't-touch rules,
  deployment risk, scope ambiguity, load-bearing constraints CC missed.
  **Never executes** — no commits, pushes, deploys, dependency installs,
  file edits, or destructive actions, even if asked.

The relay: Ronnie copies CC's plans/results into Codex; Codex's
review goes back to CC verbatim. After a build is accepted/live,
Codex automatically provides the next CC planning/build prompt.
HO.md is updated only at session wrap (not midstream) unless Ronnie
says otherwise.

---

## Where we are (snapshot 2026-04-29 wrap)

**Five builds shipped this session, all bundle-hash-verified live:**

1. `a96527a` — Team roster master cleanup. Centralizes
   `webform_config.team_roster` as the single source of truth;
   `team_members` legacy mirror preserved for unmigrated readers.
   Per-form team-member overrides and per-species weigh-ins filtering
   retired. Master-add/remove on `EquipmentWebformsAdmin` reduced to
   display-only assignment toggle. (See PROJECT.md §7 for the full
   contract.)
2. `0c39546` — Daily report private photo capture + admin display.
   New private `daily-photos` storage bucket (mig 031 applied to
   prod/test). `DailyPhotoCapture`, `DailyPhotoChip`,
   `DailyPhotoThumbnails` shared components. 10-photo cap per
   submission; sequential uploads abort on first failure. Multi-row
   submission guarded by pre-upload error.
3. `fcc77e5` — Cattle calf count + heifer auto-promote. Mommas tile
   shows `Calves: SUM(total_born)` (twins double-count). Mig 032
   AFTER-INSERT trigger on `cattle_calving_records` auto-promotes
   `sex='heifer'` to `'cow'` when a calving record is inserted, plus
   audit comment. Backfill DO block one-time-promotes existing
   heifers-with-calvings. Applied + prod-verified.
4. `42a8c4e` — Cattle calf dam-link fix. Sibling mig 033 trigger
   (distinct from mig 032) sets `cattle.dam_tag` on a calf row when a
   calving record names her via `calf_tag` and her existing `dam_tag`
   is null/blank. Never overwrites non-blank values. Deterministic
   CTE backfill (`row_number() over (calf_tag, …)`). UI: herd-accordion
   collapsed cow tile now also renders `dam #<tag>` subtitle, mirroring
   the search/filter tile. Prod-verified via rollback behavior probe
   (`dam_tag = CODEX-DAM-033`).
5. `4be002e` — Equipment mower icon + Backup/Restore/hamburger
   cleanup. Mowers category icon is now an inline SVG riding-mower
   silhouette via the new `EquipmentCategoryIcon` helper component
   (5 visual surfaces). Two admin `<select><option>` dropdowns fall
   back to the new `'🌱'` emoji string. Obsolete in-app Backup /
   Restore JSON workflow removed (`backupData()` + `restoreData()`
   in `src/main.jsx` deleted, ⬇ Backup + ⬆ Restore menu items + the
   trailing divider in the ☰ dropdown deleted). The ☰ menu shell is
   now wrapped in `{authState?.role === 'admin' && …}` so non-admin
   users no longer see an empty menu trigger.

**Migration state (all applied + prod-verified):**
- mig 030 — `client_submission_id` queue idempotency keys on 9
  webform-target tables.
- mig 031 — `daily-photos` private storage bucket + 2 RLS policies.
- mig 032 — `cattle_promote_heifer_on_calving` function +
  `cattle_calving_promote_heifer` trigger. Verified true/true.
- mig 033 — `cattle_link_calf_dam_on_calving` function +
  `cattle_calving_link_calf_dam` trigger. Verified true/true. Behavior
  probe returned `dam_tag=CODEX-DAM-033` on prod (rollback-style).

**Test counts:** 191 vitest + Playwright cattle/team-roster/daily-photo
specs pass + 0 lint errors (659 warnings, all `no-unused-vars` /
`react-hooks/exhaustive-deps`, deferred to Initiative B Phase 2.5–2.6).

**Active build status:** Equipment mower icon + Backup/Restore /
hamburger cleanup is **shipped** (commit `4be002e`). Codex will review
the build-complete report next session before issuing the next
planning prompt.

**Queued follow-ups for next session (Codex picks order):**
- Calf dam-tag live UX confirmation. If Ronnie still sees any
  calf-dam-display issue in production after the mig 033 + UI fix,
  diagnose + fix.
- Team-member availability filters for Daily / Fueling dropdowns.
  Master roster stays the source of truth (per the team_roster §7
  entry); forms may need a central "available for X form / X
  species" availability filter to narrow the dropdown without
  reintroducing scattered Add buttons.
- Continue roadmap from `PROJECT.md` §8 Near-term: cattle modal
  cleanup, `/fueling/supply` operator smoke test, multi-month Home
  Oil bill validation, new Podio app, Equipment Reading Reconciliation
  Follow-Up, A10 CI Actions secrets, Initiative B Phase 2.5–2.6
  warning sweep.

**Working-tree noise to keep excluded:**
- `tests/home_dashboard_equipment.spec.js`
- `tests/scenarios/home_dashboard_equipment_seed.js`

These two files have pre-existing LF/CRLF churn only — no real content
diff. Don't stage them unless a future build adds genuine changes.

---

## Prompt for Claude Code (executor / builder)

```
Read PROJECT.md top to bottom. Pay extra attention to:
  - §1 SOP — especially the deployment SOP, the don't-commit-without-
    explicit-approval rule, and Ronnie's working style. NEW: Codex is
    the gatekeeper for commit/push and for issuing the next build
    prompt; relayed messages from Ronnie that begin with "Codex Review"
    carry Codex's verdict.
  - §3 hand-created prod tables — these aren't in any migration; the
    test bootstrap seeds them explicitly.
  - §7 don't-touch list (load-bearing rules). Walk this at PLAN time,
    not just edit time. Name each don't-touch item the plan would touch
    in the plan itself. Active load-bearing entries that came up this
    arc: `team_roster` writer single-owner contract, `daily-photos`
    bucket privacy, `client_submission_id` idempotency, RLS-disabled
    note on the 3 hand-created daily-report tables, and the FuelingHub
    explicit-equipment-columns rule.
  - §8 roadmap. Initiative C Phase 1B (FuelSupply offline canary)
    shipped. Phase 1C / Phase 2 fan-out to other webforms remains
    queued. Cattle small-win + cattle calf dam-link both shipped.
    Equipment mower icon + Backup/Restore cleanup shipped.
  - The most recent rows in §Part 4 Session Index. The 2026-04-29 row
    covers all five builds shipped today (team roster cleanup, daily
    photos, cattle calf count + heifer auto-promote, cattle calf
    dam-link fix, equipment mower icon + Backup/Restore cleanup).

Your auto-memory carries Ronnie's working-style rules: commit/push
approval gates, multi-choice questions via AskUserQuestion, no-assume,
no-purple, deploy-verification rigor proportional to change risk,
HANDOFF-vs-PROJECT.md doc structure, plan-against-don't-touch.
HO.md is session-end only. They apply.

I'm Ronnie — owner/admin of WCF Planner.

Codex is running in parallel as the reviewer + gatekeeper. It does
NOT execute — no commits, no pushes, no file edits. Codex talks to me
in chat; when I have something for you, I'll relay it as a copyable
text block beginning with "Codex Review". Treat anything labelled
"Codex Review" as my message to you. Push back on Codex when warranted
(flag the disagreement so I can adjudicate); after a build is
accepted/live, Codex automatically provides the next CC planning/build
prompt.

State at session start:
  - All 2026-04-29 work is pushed to prod. Working tree should be
    clean. Verify via `git status` and `git log --oneline -10`.
  - Migrations 030–033 applied + prod-verified. Mig 032 trigger
    `cattle_calving_promote_heifer` and mig 033 trigger
    `cattle_calving_link_calf_dam` are live; both functions
    (`cattle_promote_heifer_on_calving`,
    `cattle_link_calf_dam_on_calving`) confirmed via existence + (mig
    033) rollback-style behavior probe in prod.
  - Test counts: 191 vitest + Playwright (cattle small-win + cattle
    calf dam-link + team roster + daily-photos specs) + 0 lint errors
    / 659 warnings.
  - A10 CI workflow live and enforces `npm run format:check` between
    Playwright install and lint; e2e step still fails until 5 GitHub
    Actions secrets are configured (§8 Near-term "A10 CI Actions
    secrets configuration"). Format / lint / vitest / build pass
    independently.
  - HomeDashboard drift compensation continues via the
    `latestSaneReading` helper. Equipment Reading Reconciliation
    Follow-Up in §8 Near-term remains open.
  - Equipment mower icon + Backup/Restore / hamburger cleanup
    shipped this session. Codex will review the build-complete
    report and then issue the next prompt.
  - Known working-tree noise to leave alone:
    `tests/home_dashboard_equipment.spec.js` and
    `tests/scenarios/home_dashboard_equipment_seed.js`. Pre-existing
    LF/CRLF churn only — don't stage unless a real content diff
    appears.

**Default first action: stand by for Codex's next prompt.** Common
candidates Codex may queue:

  (a) Calf dam-tag live UX confirmation. If Ronnie still sees any
      calf-dam-display issue after the mig 033 + UI fix, diagnose
      and fix. Plan-packet first.
  (b) Team-member availability filters for Daily / Fueling dropdowns.
      Master roster (`webform_config.team_roster`) remains the single
      source of truth; the build adds a central "available for X form
      / X species" filter so dropdowns can narrow without
      reintroducing scattered Add buttons. Plan-packet first.
  (c) Continue an item from PROJECT.md §8 Near-term: cattle modal
      cleanup, `/fueling/supply` operator smoke test, multi-month
      Home Oil bill validation, new Podio app, Equipment Reading
      Reconciliation Follow-Up, A10 CI Actions secrets configuration,
      Initiative B Phase 2.5–2.6 warning sweep, Phase 1C / Phase 2
      offline-queue fan-out to remaining webforms.
  (d) Bring over a Podio app I'll name (READ §7 first — equipment
      imports have load-bearing rules).
  (e) Handle an operational bug or data anomaly I'll describe.

Migration layout note: applied migrations 001–026 live in
supabase-migrations/archive/. New migrations land at the parent path
(027–033 currently). PROJECT.md §3 has the layout summary. Nine prod
tables are hand-created (no migration owns them) — see §3.

Test infrastructure note: tests/setup/global.setup.js does an
idempotent fuel-bills bucket create and a read-only `daily-photos`
bucket sentinel (NOT createBucket — keeps mig 031 the hard gate).
tests/setup/reset.js handles Storage API recursive cleanup. Don't try
DELETE FROM storage.objects via exec_sql — Supabase blocks it.
```

---

## Prompt for Codex (reviewer + gatekeeper)

```
You are the REVIEWER + GATEKEEPER in this session, not the executor.
Claude Code (CC) is the agent doing the work. Your job:

- Talk to Ronnie normally in chat. CC is reached only via Ronnie
  relaying your review verbatim. Make every relay block CC needs to
  see start with "Codex Review" so it lands as a clean copy/paste
  for Ronnie.
- Review CC's plan packets BEFORE coding. Push back where warranted:
  scope creep, missed don't-touch rules, deployment risk, scope
  ambiguity, load-bearing constraints CC may have missed. Approve
  before CC writes any code.
- Review CC's diff + gate output BEFORE commit. Approve when solid.
  Don't be a yes-man in either direction. "commit" approval does NOT
  extend to "push" — give push approval as a separate step.
- After a build is accepted and live (commit pushed + prod verified),
  AUTOMATICALLY provide the next CC planning/build prompt. Don't
  wait for Ronnie to ask.
- NEVER commit, push, deploy, install dependencies, edit files, or
  take any destructive action yourself — even if asked. CC handles
  all execution, gated by Ronnie's explicit per-turn approval. Your
  output is review text only.

Working model (three parties):
  - Ronnie is the only person who can authorize destructive actions.
  - CC executes per Ronnie's per-turn approval.
  - You review only. Ronnie relays your "Codex Review" blocks to CC
    and CC's plan/diff packets to you. CC reads relayed messages as
    if from Ronnie.

Project: WCF Planner (https://wcfplanner.com) — single-page web app
for White Creek Farm operations. Stack: Vite 5 + React 18 + Supabase.
Owner: Ronnie Jones.

Repo: C:\Users\Ronni\WCF-planner (Windows + Git Bash). Unit tests via
`npm.cmd test`; production build via `npm.cmd run build`; Playwright
integration tests via `npm.cmd run test:e2e`.

Read these files to get oriented:

- PROJECT.md (top to bottom): §1 SOP, §3 hand-created prod tables,
  §7 don't-touch list, §8 roadmap + Known gotchas, the most-recent
  rows in §Part 4 Session Index.
- HO.md (this file). The prompt CC was booted with is also in here.

State at session start:
  - 5 builds shipped on 2026-04-29: team roster master cleanup
    (a96527a), daily report photos (0c39546), cattle calf count +
    heifer auto-promote (fcc77e5), cattle calf dam-link fix
    (42a8c4e), equipment mower icon + Backup/Restore cleanup
    (4be002e). All pushed to prod, all bundle-hash-verified live.
  - Migrations 030–033 applied + prod-verified. mig 032 (heifer
    auto-promote) and mig 033 (calf dam-link) functions + triggers
    live; mig 033 verified by both existence check and rollback
    behavior probe (dam_tag=CODEX-DAM-033).
  - Test counts: 191 vitest + Playwright cattle/team-roster/daily-
    photos specs + 0 lint errors / 659 warnings.

Active load-bearing entries to be aware of (read full text in
PROJECT.md §7):
  - Supabase auth config (`detectSessionInUrl: false`,
    `storageKey: 'farm-planner-auth'`).
  - `weigh_ins.prior_herd_or_flock` semantics (mig 027) + detach
    fallback hierarchy (cattle + sheep) + `cattle_transfers` /
    `sheep_transfers` append-only audit logs.
  - Cattle/sheep batch membership rule (only via `send_to_processor`).
  - `processingTrips[].subAttributions` schema.
  - `parent.fcrCached` clear-on-null contract.
  - 9 hand-created prod tables not in any migration. Three of them
    (pig_dailys, poultry_dailys, layer_dailys) likely have RLS
    DISABLED in prod — don't enable RLS without first establishing
    INSERT policies.
  - `team_roster` single-writer contract: only TeamRosterEditor
    inside WebformsAdminView writes the roster, via `saveRoster`
    (read-fresh-then-merge by id). Public-form code paths only read
    via `loadRoster` + render `activeNames(roster)`.
  - `daily-photos` storage bucket — PRIVATE, anon INSERT +
    authenticated SELECT only. App stores paths only; admin reads
    via signed URLs. Distinct from `equipment-maintenance-docs`
    (public-readable).
  - `client_submission_id` queue idempotency contract — non-partial
    unique index on 9 webform-target tables. Anon webforms must use
    plain `.insert(record)` and treat code 23505 referencing
    `*_client_submission_id_uq` as already-synced (NOT upsert
    onConflict — PostgREST upsert needs SELECT privilege which anon
    lacks).
  - mig 032 + mig 033 cattle triggers — sibling AFTER-INSERT
    triggers on `cattle_calving_records`. Both SECURITY DEFINER +
    `SET search_path = public`. Don't add a third trigger without a
    plan packet.

Queued follow-ups for the next CC build (you pick order):
  - Calf dam-tag live UX confirmation/fix if Ronnie still sees any
    issue in production after mig 033 + the herd-accordion UI fix.
  - Team-member availability filters for Daily / Fueling dropdowns
    (master roster stays canonical; filter-only mechanism, no Add
    buttons).
  - Then resume PROJECT.md §8 roadmap.

When reviewing CC's pre-commit packet, expect: `git diff --stat`,
focused diffs for the load-bearing files, fresh `npm test` /
`npm run build` outputs, `npm run format:check` clean, lint count
deltas explained. Known working-tree noise to leave excluded:
`tests/home_dashboard_equipment.spec.js` and
`tests/scenarios/home_dashboard_equipment_seed.js` (pre-existing
LF/CRLF churn).
```
