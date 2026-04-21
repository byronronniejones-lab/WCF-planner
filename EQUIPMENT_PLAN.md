# Equipment Module — Plan of Action

**Session author:** 2026-04-21 (Ronnie + Claude Opus 4.7)
**Status:** Plan. No code yet beyond the Podio pull script.
**Supersedes:** PROJECT.md §8 "Equipment module" deferred stub.

Once the module ships, this file gets folded into PROJECT.md Parts 1–3 and archived, matching how the Vite-migration plan + sheep import plan were consolidated.

---

## 1. Podio findings (from the 2026-04-21 pull)

`scripts/pull_podio_equipment.cjs` dumped all 17 apps from the Podio "WCF - Equipment" workspace → `scripts/podio_equipment_dump/` (gitignored). 1,770 total items.

### 1.1 App inventory

| Podio app | Field count | Items | Role |
|---|---|---|---|
| **Equipment Maintenance** | 20 | 20 | Fleet master — one row per piece of equipment. Specs: serial, current hours/KM, fluids, filters, fuel-tank capacity, DEF-tank capacity, warranty, status. |
| **Fuel Log** | 9 | 1,080 | Central flat fuel log. Fields: date, name, type-of-fuel (DIESEL / GAS / etc.), equipment-being-fueled (category), gallons, mileage/hours, comments. |
| PS 100 Fueling Checklists | 16 | 32 | Per-equipment fueling + service-interval log |
| C362 Fueling Checklists | 17 | 69 | (John Deere tractor) |
| 5065 Fueling Checklists | 16 | 32 | (another JD tractor) |
| #1 Honda ATV Fueling Checklists | 16 | 122 | |
| #2 Honda ATV Fueling Checklists | 12 | 160 | |
| #3 Honda ATV Fueling Checklists | 12 | 74 | |
| #4 Honda ATV Fueling Checklists | 12 | 12 | |
| 2018 Hijet Fueling Checklists | 17 | 39 | KM-based intervals (not hours) |
| 2020 Hijet Fueling Checklists | 14 | 21 | KM-based |
| Gyro-Trac Fueling Checklists | 16 | 39 | |
| Toro Zero Turn Lawnmower | 14 | 10 | Mower-specific intervals (10hr, 25hr, first-75hr) |
| Ventrac Fueling Checklists | 26 | 35 | Attachment-specific intervals (Tough Cut etc.) |
| Mini Ex Fueling Checklists | 16 | 1 | |
| Gehl RT165 Fueling Checklists | 16 | 18 | |
| L328 Fueling Checklists | 16 | 6 | |

**17 apps = 2 central + 15 per-equipment** ≡ the "17 tabs" Ronnie described.

### 1.2 Fueling-checklist field pattern

Across the 15 per-equipment apps (51 distinct fields, consolidated):

**Common to every app (in 13–15 of 15):**
- `date`
- `team-member`
- `every-fuel-fill-up-checklist` (category: water/oil/hydraulic/etc. visual checks at every fill)
- `issues-comments`
- `hours` (13 / 15 — the KM-based Hijets and one other use KM instead)
- `every-50-hours-checklist` (13 / 15)
- **App-relations:** `Equipment Maintenance App`, `Fuel Log App` — each checklist entry links back to both the master equipment row and the Fuel Log entry

**Per-equipment variance (the whole reason 15 apps exist):** each machine has its own set of service-interval checklists (100hr / 200hr / 250hr / 300hr / 400hr / 500hr / 600hr / 800hr / 1000hr / 1200hr / 1500hr / 2000hr / 3600hr / 4000hr for heavy equipment; 200KM / 1000KM / 5000KM / 10,000KM / 40,000KM / 60,000KM for Hijets; 10hr / 25hr / first-75hr for Toro; attachment-specific for Ventrac).

This variance is Podio's limitation (can't have dynamic fields per item) — forced them into a separate app per machine. Supabase has no such constraint; we can collapse.

### 1.3 Sample Fuel Log item

```
  item_id: 2815584978
  created_on: 2024-05-23 19:32:09
  your-name: Matthew
  type-of-fuel: DIESEL
  equipment-being-fueled: JOHN DEERE TRACTOR
  gallons: 3.2
  mileage-hours: 1153.1
  comments: N/A
```

The `date` field was undefined here — some early entries rely on `created_on` as the timestamp. Import script will fall back accordingly.

---

## 2. Recommended data model

Three Supabase tables, no per-equipment table explosion.

### 2.1 `equipment` (master registry)

Maps 1:1 to the Equipment Maintenance app. ~20 rows.

| column | type | notes |
|---|---|---|
| `id` | text PK | deterministic, e.g. `eq-john-deere-c362` |
| `podio_item_id` | bigint UNIQUE | the Equipment Maintenance Podio item_id — lets cross-refs survive the cutover |
| `name` | text NOT NULL | e.g. "C362 John Deere Tractor" |
| `status` | text | active / retired / in-shop |
| `serial_number` | text | |
| `fuel_type` | text | diesel / gasoline / mixed — inferred from most-common Fuel Log type for this equipment |
| `fuel_tank_gal` | numeric | |
| `def_tank_gal` | numeric | |
| `current_hours` | numeric | last-reported value; derived from the latest fueling entry |
| `current_km` | numeric | for KM-tracked equipment (hijets) |
| `tracking_unit` | text CHECK IN ('hours','km') | which unit the equipment uses |
| `engine_oil` / `oil_filter` / `hydraulic_oil` / `hydraulic_filter` / `coolant` / `brake_fluid` / `fuel_filter` / `def_filter` / `gearbox_drive_oil` / `air_filters` | text | spec values, free-form (as in Podio) |
| `warranty_description` | text | |
| `warranty_expiration` | date | |
| `service_intervals` | jsonb NOT NULL DEFAULT '[]' | **Key column.** Array of `{hours_or_km: 50, label: "50hr check", kind: "hours"}` entries defining which intervals this equipment tracks. Each new fueling writes a completion flag per interval if it falls on a multiple. Seeded from the union of checklist categories in that equipment's Podio app. Admin can add/edit. |
| `notes` | text | |
| `created_at`, `updated_at` | timestamptz | |

### 2.2 `equipment_fuelings` (central log — supersedes Fuel Log + 15 checklist apps)

Every fill-up + service-interval completion in one table.

| column | type | notes |
|---|---|---|
| `id` | text PK | `fuel-<uuid-or-datestamp>` |
| `podio_item_id` | bigint | the originating Podio item — from Fuel Log OR one of the 15 checklist apps |
| `podio_source_app` | text | `fuel_log` \| `checklist_ps100` \| `checklist_c362` \| ... — for audit/dedup during import |
| `equipment_id` | text NOT NULL REFERENCES equipment(id) | |
| `date` | date NOT NULL | |
| `team_member` | text | |
| `fuel_type` | text | diesel / gasoline / def / none (for non-fueling check-only entries) |
| `gallons` | numeric | null for KM vehicles that log in L, or for check-only entries |
| `hours_reading` | numeric | |
| `km_reading` | numeric | |
| `every_fillup_check` | jsonb | array of visual-check items completed this fill — "water level OK", "oil level OK", etc. shape: `[{id:'oil', ok:true},{id:'water',ok:false,note:'low'}]` |
| `service_intervals_completed` | jsonb NOT NULL DEFAULT '[]' | array of intervals hit on this entry: `[{interval:500, kind:'hours', label:'500hr check', completed_at:'2026-04-21'}]`. Written by the webform when the team ticks a service checklist. |
| `comments` | text | |
| `source` | text | `fuel_log_webform` / `checklist_webform` / `admin_add` / `podio_import` |
| `submitted_at` | timestamptz NOT NULL DEFAULT now() | |

Indexes: `(equipment_id, date DESC)`, `(podio_item_id)` for dedup on reruns.

### 2.3 `equipment_maintenance_events` (ad-hoc repairs/service)

Not directly 1:1 with any Podio app — the Equipment Maintenance app is really a registry, not a log. But sheep/cattle modules both have event tables (calving, comments) and equipment benefits from the same.

| column | type | notes |
|---|---|---|
| `id` | text PK | |
| `equipment_id` | text NOT NULL REFERENCES equipment(id) | |
| `event_date` | date NOT NULL | |
| `event_type` | text CHECK IN ('repair','service','inspection','other') | |
| `title` | text | |
| `description` | text | |
| `cost` | numeric | |
| `vendor` | text | |
| `hours_at_event` | numeric | snapshot of equipment hours when service happened |
| `attachments` | jsonb | `[{name, url}]` — optional receipts, work orders |
| `team_member` | text | |
| `created_at` | timestamptz NOT NULL DEFAULT now() | |

Not imported from Podio — empty at cutover. New records ship via the admin UI and a "Maintenance Event" webform.

---

## 3. Frontend architecture

### 3.1 Sub-navigation (17 tabs)

Mirror Ronnie's Podio mental model. Under `/equipment`:

| # | Tab | Route | Backing data |
|---|---|---|---|
| 1 | **Fleet** (Equipment list) | `/equipment` | `equipment` — all rows, status-filterable |
| 2 | **Fuel Log** (flat) | `/equipment/fuel-log` | `equipment_fuelings` — all rows, equipment+date+team filterable |
| 3–17 | Per-equipment detail pages (15 of them) | `/equipment/<slug>` (e.g. `/equipment/c362`, `/equipment/honda-atv-1`) | Single `equipment` row + its `equipment_fuelings` + upcoming service calculator |

Tab labels and order come from `equipment.name` / `equipment.status` — active equipment first, retired collapsed.

### 3.2 Per-equipment detail view (the Phase-3 workhorse)

One view, parameterized by `:slug`. Sections:

1. **Header tile** — name, serial, hours/km, status, fuel type
2. **Spec panel** — fluids / filters / capacities (editable inline, admin only)
3. **Upcoming service calculator** — reads `equipment.service_intervals` + latest `hours_reading` → "Next 500hr check due at 2,000 hrs (140 hours away)"
4. **Fueling + checklist history** — table of `equipment_fuelings` for this equipment, date DESC. Each row expands to show `every_fillup_check` + `service_intervals_completed` + comments.
5. **Maintenance events** — chronological list from `equipment_maintenance_events`, plus "+ Add Event" button.
6. **Upcoming warranty flag** — if `warranty_expiration` is within 60 days.
7. **Total fuel consumed** (lifetime or configurable window) — sum `gallons`.

### 3.2.1 Role-gated equipment views — the `equipment_tech` user

New role added to `profiles.role` enum: **`equipment_tech`** (alongside existing `farm_team` / `management` / `admin` / `inactive`). Session decision 2026-04-21.

When a user logs in as `equipment_tech`:

| UI surface | Behavior |
|---|---|
| Home dashboard | Only the 🚜 Equipment card renders. Cattle/sheep/pig/broiler/layer/admin cards all hidden. |
| `/equipment` sub-nav | Only the 15 per-equipment tabs render. **Fleet list** and **Fuel Log flat view** tabs hidden. |
| Per-equipment detail page (`/equipment/<slug>`) | Only the **Fueling + checklist history** section renders. Spec panel, warranty status, maintenance events, upcoming-service calculator, lifetime-fuel totals all hidden. |
| + Log Fueling button | Visible — they can add fueling/checklist entries via the webform. |
| Edit equipment / transfer / delete | All hidden. Row click still expands the history; no write access beyond fueling submission. |

Canonical access-check helper `canAccessProgram('equipment')` stays true for `equipment_tech`. A new helper `isEquipmentTech(authState)` gates the above behavior. The `program_access` array mechanism is unchanged.

Migration 014 adds the role value via `ALTER TYPE` / CHECK-constraint update. Existing 4 roles unaffected.

### 3.3 Home-dashboard integration

Add an "Equipment" card next to Cattle/Sheep/Pig on the home page (already exists as placeholder per PROJECT.md §8). Content:

- Fleet count (X active / Y total)
- **Service due soon** — count of equipment with an interval coming up in the next 50 hours / 500 km
- **Overdue services** — red flag if any equipment is past-due
- **Warranty expiring** — count within 60 days

Plus a "Missed Fueling" row in the existing Last-7-Days missed-reports list (if active equipment had no fueling entry in N days — TBD whether daily fueling checks apply here).

### 3.4 Colors

Equipment program color needs a dedicated palette slot. Current programs use yellow (broiler), brown (layer), blue (pig), red (cattle), teal (sheep). Equipment should be distinct — proposing slate/steel gray (`#57534e` / `#fafaf9`) matching the existing placeholder stub.

---

## 4. Public webform architecture

Ronnie's ask: "17 tabs with accompanying webforms at a separate webform link." So webforms live at a new URL.

### 4.1 Route

Propose `/fueling` as the top-level hub (distinct from the existing `/webforms` which is for daily reports). Reasoning: "fueling" reads as what the team does, and keeps it short on materials printed in the field.

Alternatives to consider:
- `/equipment-webforms/` (matches the admin URL pattern but long)
- `/logs/` (too generic)

### 4.2 Hub selector

Same pattern as `/webforms`: landing page with a tile per form. 17 tiles is a lot on mobile, so cluster:

```
🚜 Tractors           (3 tiles: C362, 5065, PS100)
🛻 UTVs/Trucks        (2 tiles: 2018 Hijet, 2020 Hijet)
🛵 ATVs               (4 tiles: Honda ATV #1–#4)
🪚 Specialty          (5 tiles: Gyro-Trac, Toro, Ventrac, Mini Ex, Gehl, L328)
⛽ Quick Fuel Log     (1 tile — the flat one, no checklist)
```

Plus "Maintenance Event" as a rare-use form (1 tile).

Total = **17 tiles on the hub + 1 general fuel log + 1 maintenance event** ≈ 19 forms. Matches the "17 + accompanying" scope.

### 4.3 Per-equipment webform shape

Same skeleton as the sheep form, customized per equipment:

- Date (defaults to today)
- Team Member (dropdown)
- Fuel type + Gallons (or L for Hijets)
- Hours or KM reading
- **Every-fillup checklist** — 5–8 yes/no items pulled from the equipment's Podio "every-fuel-fill-up-checklist" config
- **Service intervals** — dynamic list from `equipment.service_intervals` that are due or coming up. User checks any that they performed during this fill.
- Comments

Writes one `equipment_fuelings` row. No duplication — the flat Fuel Log tab is a query over the same table.

### 4.4 URL routing with back-button support

Fueling sub-forms mirror the `/webforms/<program>` pattern shipped 2026-04-21 for sheep/cattle:

- `/fueling` → hub selector (category-clustered tiles)
- `/fueling/<equipment-slug>` → per-equipment form (slug matches `equipment.id` suffix, e.g. `c362`, `honda-atv-1`)
- `/fueling/quick` → flat Fuel Log quick-entry
- `/fueling/maintenance` → Maintenance Event form

Browser back button:
- On a sub-form → returns to the hub
- On the hub → returns to wherever the user came from (admin home, external QR scan, etc.)

Implemented via the same `useLocation` + `useNavigate` adapter pattern already in `WebformHub.jsx`. main.jsx's URL↔view adapter treats every `/fueling/*` path as `view='fuelingHub'` (new view value in `src/lib/routes.js`) so `FuelingHub` owns its sub-routing without the top-level adapter clobbering the sub-path.

### 4.5 Admin webform config

Admin panel **reorganized** into two tabs:

- **Program Webforms** (rename of existing `Admin → Webforms` tab) — covers broiler, layer, pig, cattle, sheep, egg, add-feed. All existing forms.
- **Equipment Webforms** (new tab) — covers the 15 per-equipment fueling forms + quick-fuel + maintenance-event.

Both use the same `WebformsAdminView` component with a form-type filter. Admin workflow on either tab:

- Enable/disable per-form team members (standard)
- Toggle individual fields
- Edit the every-fillup checklist items
- Edit service-interval definitions (persists to `equipment.service_intervals` for equipment forms)
- Rename/reorder forms

Form IDs follow a consistent prefix convention:
- Program: `broiler-dailys`, `cattle-dailys`, `sheep-dailys` etc. (existing)
- Equipment: `equipment-fueling-c362`, `equipment-fueling-honda-atv-1`, `equipment-fueling-quick`, `equipment-maintenance-event`

---

## 5. Data migration

One script — `scripts/import_podio_equipment.js` — reads the dump and writes Supabase.

### 5.1 Steps

1. **Parse `equipment-maintenance` app → 20 `equipment` rows.** Match each row's name against the 15 per-equipment Podio apps to derive `podio_checklist_app_id` for cross-referencing. Build `service_intervals` jsonb from the union of that app's service-interval categories.

2. **Parse `fuel-log` app → `equipment_fuelings` rows.** Resolve `equipment_being_fueled` category → our `equipment_id`. Store `podio_source_app='fuel_log'`.

3. **Parse 15 checklist apps → `equipment_fuelings` rows.** Each item becomes a fueling row. If it also shows up in the Fuel Log (via the `Fuel Log App` relation), **merge** rather than duplicate: use the Fuel Log `podio_item_id` as primary, layer the checklist fields on top (`every_fillup_check`, `service_intervals_completed`).

4. **Dedup.** Any `(equipment_id, date, gallons, hours_reading, team_member)` cluster gets collapsed to a single row.

5. **Report** — console output: equipment created, fueling rows imported, duplicates merged, unresolved references.

### 5.2 Constraints

- Idempotent (rerun-safe): deterministic IDs keyed off `podio_item_id`.
- Podio relation fields (e.g. Fuel Log → Equipment Maintenance) get resolved client-side in the script, not stored as FKs, so the script handles out-of-order parsing.
- Dry-run mode (no `--commit` flag = preview only), matching the cattle/sheep import pattern.

### 5.3 Schema migration

`supabase-migrations/014_equipment_module.sql` — creates the three tables, RLS policies (authenticated all-access, anon insert on fuelings for the public webform), indexes, no seed data. Apply via SQL Editor before import.

Also in migration 014:
- Extends the `profiles.role` CHECK constraint to allow the new `equipment_tech` value. Existing roles (`farm_team`, `management`, `admin`, `inactive`) unchanged.

---

## 6. Phased build order

Recommend shipping in 6 phases, roughly a week each. Each phase is a separate PR / commit cluster with its own smoke test.

### Phase 1 — Schema + data migration (week 1, ~6 commits)

- Migration 014
- Import script (with dry-run)
- Apply migration → run import → spot-check via diagnostic script
- No UI changes yet; data just sits in Supabase.

**Ships when:** `select count(*) from equipment_fuelings` returns ~1,080 matching rows.

### Phase 2 — Equipment home + Fleet tab (week 1/2, ~4 commits)

- Replace `EquipmentPlaceholder` with `EquipmentHome`
- Add sub-navigation bar (Fleet, Fuel Log, 15 equipment tabs)
- Fleet view: table of 20 equipment with status/hours/fuel-type
- Wire routes in `src/lib/routes.js` + main.jsx dispatch
- Add "Equipment" nav-card color + wire canAccessProgram

**Ships when:** clicking an equipment row navigates to a placeholder detail view with just the header tile populated.

### Phase 3 — Per-equipment detail view (week 2, ~5 commits)

- `EquipmentDetail.jsx` component (parameterized by equipment id)
- Spec panel (read-only first)
- Fueling + checklist history table with expand-row
- Maintenance events section (+ Add Event modal)
- Upcoming service calculator

**Ships when:** opening `/equipment/c362` shows the full history, service-due countdown, and maintenance event list.

### Phase 4 — Fuel Log flat view (week 2, ~2 commits)

- `EquipmentFuelLog.jsx` — table with filters (equipment, date range, team, fuel type)
- Summary header (total gallons, total cost if fuel-costs get wired)
- Source-filter chip (same tri-state pattern as dailys)

**Ships when:** filtering to `C362 + last 90 days` returns the same data Ronnie sees in Podio today.

### Phase 5 — Public webforms (week 3, ~6 commits)

- `src/webforms/FuelingHub.jsx` — landing at `/fueling` with 17+ tiles
- Per-equipment fueling form (parameterized by equipment slug)
- General "Quick Fuel Log" form (no service checklist — fast entry)
- `webform_config` entries seeded via migration 015
- Legacy bookmarks / QR codes for field materials TBD

**Ships when:** a team member can submit a fueling from the tractor cab and see it appear in `/equipment/c362` within 60s.

### Phase 6 — Admin webform split + role gating + home-dashboard hooks (week 3/4, ~6 commits)

- `WebformsAdminView` split: rename existing tab to "Program Webforms", add new "Equipment Webforms" tab. Same component, form-type filter.
- `equipment_tech` role gating in `EquipmentHome` + `EquipmentDetail` + home dashboard nav cards.
- UsersModal: add the new role to the role-picker dropdown. Admin can assign a user to `equipment_tech` + program_access=['equipment'].
- Home dashboard: Equipment card with service-due + warranty-expiring counts.
- Missed-fueling alerts if any active equipment hasn't logged in N days.
- Final doc consolidation into PROJECT.md Parts 1–3.

**Ships when:** Ronnie opens the home dashboard on Monday morning and sees "3 services due this week" across the fleet, AND a newly-created `equipment_tech` user logs in and can only see the 15 equipment tabs + checklist entries.

**Total estimate:** 27–32 commits, 3–4 calendar weeks of focused work.

---

## 7. Open questions (need Ronnie input before starting Phase 1)

1. **Fuel type canonical list.** Podio categories show "DIESEL" / "GAS" / "GASOLINE" / maybe "DEF". Standardize to `diesel` / `gasoline` / `def` / `mixed`?

2. **KM vs hours tracking per equipment.** Confirmable from the Podio data (Hijets have KM-based checklists). I'll populate `tracking_unit` during import, but is there any equipment that tracks BOTH (e.g. shows both on the dash)?

3. **Service interval completion semantics.** When a team member checks "500hr check" on a fueling at 520 hours, is that the completion for the 500hr milestone (so next due is 1000hr)? Or does it reset a countdown from 520? Matters for the "service due" calculator.

4. **Fuel cost tracking.** Is fuel cost per gallon tracked elsewhere, or not yet? Would affect whether we add a `fuel_cost_per_gal_at_date` concept to `equipment_fuelings`.

5. **Mobile-form access.** `/fueling` is anon-accessible by default (like `/webforms`). Is that what you want, or does it need an equipment-pin gate to prevent random submissions?

6. **Maintenance events — vendor list.** Do you want a seeded vendor dropdown (tractor dealer, oil-change service, etc.), or free-text for now?

7. **Decommissioned equipment.** Any equipment retired / sold in the past that shouldn't be in the active fleet? Will mark `status='retired'` during import if I can tell from Podio.

8. **Attachments.** Ventrac has "Tough Cut" + attachment-specific intervals. Should each attachment be its own `equipment` row, or a jsonb on the tractor row? Lean: own row, with a `parent_equipment_id` self-reference. TBD.

9. **The "17 tabs" number.** With 2 central + 15 per-equipment = 17, matches perfectly. But the hub layout I proposed (§4.2) clusters them into category tiles instead of 17 flat tiles. Is the cluster layout OK, or do you want a flat grid with 17 equal tiles?

10. **New equipment onboarding.** When you buy a new piece, do you want an admin "+ Add Equipment" button, and should it auto-create the corresponding webform entry in `webform_config`?

---

## 8. Risk register

| Risk | Likelihood | Mitigation |
|---|---|---|
| Import creates duplicate fueling rows across Fuel Log + checklist apps | High | Dedup step in script (§5.1.4). Dry-run first. |
| Service interval jsonb schema drifts as new equipment is added | Medium | Admin panel edits `equipment.service_intervals`; keep shape backwards-compatible (just append). |
| Per-equipment webform duplication (15 near-identical forms) becomes a maintenance burden | Medium | Render from one `EquipmentFuelingWebform` component parameterized by equipment id — not 15 separate files. |
| Mobile webform hub with 17+ tiles hard to tap | Low | Category clusters (§4.2). 5 groups of 2–5 tiles each. |
| Service-due math wrong for KM-tracked equipment | Low | `tracking_unit` column + unit-aware calculator; test against historical Hijet data. |
| Team members submit fuelings without the checklist at all | Low | Form UX: checklist items default to unchecked, not required. Fueling itself is the primary data point. |

---

## 9. What's already in place

- `scripts/pull_podio_equipment.cjs` — one-shot pull from Podio. Committed.
- `scripts/podio_equipment_dump/` — raw data dump, gitignored.
- `.gitignore` updated to exclude both the env vars and the dump dir.
- `EquipmentPlaceholder` component at `src/equipment/EquipmentPlaceholder.jsx` — the current `/equipment` stub. Replaced in Phase 2.
- `canAccessProgram('equipment')` route gate — already wired.

## 10. Next actions

**This session is closing.** When you want to start Phase 1:

1. Skim §7 (open questions) and answer — the answers drive schema details.
2. Confirm the phased order in §6 or propose changes.
3. I'll start Phase 1 with migration 014 + the import script dry-run.

Until then the Podio data is safe on disk, nothing's wired in app.
