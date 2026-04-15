# WCF Planner — Cattle Module Design

Updated April 15, 2026.
Status: **Draft for review.** No code written yet.

---

# 1. Overview

The Cattle module replicates the depth of the existing Broiler/Pig/Layer programs but adds new capabilities: per-head weigh-ins, nutrition tracking with rolling windows, compound-ration creep feeding, breeding cycle timeline, and a full animal directory with lifecycle tracking.

Decision: build **all 3 phases at once** (no disruption, one deploy).

**Phase 1** — Daily operations foundation: webforms, dailys, feed admin, creep mixing, breeding cycles, herds.
**Phase 2** — Weigh-ins: per-species session flows with autosave.
**Phase 3** — Directory, calving, processing batches, sales, per-head cost.

Default palette: **cattle = red** (committed in 524b4c2, values in PROJECT.md §12).

---

# 2. Active Herds + Outcomes

Hardcoded for launch (can revisit if real need emerges).

| Herd | Type | Description |
|---|---|---|
| Mommas | Active | Breeding cows + their unweaned calves (calves stay with mom until weaned). Creep feeder supplements calves. |
| Backgrounders | Active | Post-weaning grow phase, roughly 500 lb / 9 mo threshold moves in from Mommas. **Currently empty** — populated later. |
| Finishers | Active | Grow-out phase, 50/50 hay + citrus + 2 tubs molasses/month. ~48,000 lbs live weight today. |
| Bulls | Active | Breeding bulls + grow-out bulls. Currently 1 bull, likely sold. |
| Processed | Outcome | Auto-moved when attached to a completed processing batch. Collapsed by default. |
| Deceased | Outcome | Manual move on death event. Collapsed by default. |
| Sold | Outcome | Manual move on sale event. Collapsed by default. |

Status field on `cattle` row drives membership. Status changes are logged in `cattle_transfers` for audit.

---

# 3. Data Model (Supabase)

All tables follow the existing app convention: `id` text PK, `created_at`/`updated_at` timestamps where useful, `data` jsonb where flexibility is needed. All daily-report-style tables use the dedicated-table pattern (like `pig_dailys`, `layer_dailys`) not app_store blobs.

## 3.1 `cattle_feed_inputs`

Master list of every feed/mineral used on the farm. Reusable by sheep later.

| Column | Type | Notes |
|---|---|---|
| id | text (PK) | slug of name |
| name | text | "Rye Baleage", "Citrus Pellets", "Molasses", "Sugar", "Salt", etc. |
| category | text | `hay` \| `pellet` \| `liquid` \| `mineral` \| `other` |
| unit | text | `bale` \| `lb` \| `tub` \| `bag` |
| unit_weight_lbs | numeric | Lbs per unit (1500 for a rye bale, 2975 for a 250-gal molasses tote, 1 for per-lb feeds). |
| cost_per_unit | numeric | $ per unit pre-freight |
| freight_per_truck | numeric | Shipping $ per truck |
| units_per_truck | int | Units arriving per truck shipment |
| landed_per_lb | numeric (computed) | `(cost_per_unit + freight_per_truck/units_per_truck) / unit_weight_lbs` |
| moisture_pct | numeric | Latest as-fed % |
| nfc_pct | numeric | Latest as-fed % |
| protein_pct | numeric | Latest adjusted crude protein, as fed |
| status | text | `active` \| `inactive` |
| herd_scope | text[] | Which herds the webform dropdown should show this feed for. E.g. `["mommas","finishers"]`. Minerals = all. |
| notes | text | |
| created_at | timestamptz | |
| updated_at | timestamptz | |

Seeds for launch:
- Rye Baleage (hay, bale, 1500 lb)
- Alfalfa Hay, Clover Hay (hay, bale, weights TBD)
- Alfalfa Pellets (pellet, lb)
- Citrus Pellets (pellet, lb)
- Molasses (liquid, tub, 2975 lb)
- Sugar (other, lb)
- Minerals (mineral, lb): Salt, Bicarb, Conditioner, Calcium, Biochar, Colostrum

**Creep feed is NOT a separate feed entry.** Per Ronnie's clarification, creep feed ingredients (alfalfa pellets, citrus pellets, sugar, colostrum supplement) are tracked like any other feed. No compound-feed record, no mix-event table, no separate inventory.

## 3.2 `cattle_feed_tests`

Version history for every nutritional test (Dairy One or equivalent). Stamped-at-submit means daily reports always use whatever values were current at their submit time. Updating the values in `cattle_feed_inputs` does NOT retroactively change past reports.

| Column | Type | Notes |
|---|---|---|
| id | text (PK) | |
| feed_input_id | text (FK → cattle_feed_inputs.id) | |
| effective_date | date | When this test becomes the current values. Defaults to `Recvd` date from the PDF. |
| moisture_pct | numeric | |
| nfc_pct | numeric | |
| protein_pct | numeric | Adjusted crude protein as fed |
| pdf_path | text | Path in storage bucket |
| pdf_file_name | text | Original filename |
| bale_weight_lbs | numeric (hay only) | |
| notes | text | |
| uploaded_by | text | team member name |
| uploaded_at | timestamptz | |

When admin uploads a new test: a new row is inserted, and the parent `cattle_feed_inputs` row's nutrition fields are updated to the latest test's values (used as defaults for the webform feed snapshot).

## 3.3 `cattle_nutrition_targets`

Per-herd nutritional goals. Admin-editable. Used by the recommendation engine and the Dashboard rolling-window comparison.

| Column | Type | Notes |
|---|---|---|
| herd | text (PK) | `mommas` \| `backgrounders` \| `finishers` \| `bulls` |
| target_dm_pct_body | numeric | Default 2.5 — lbs DM per 100 lbs body weight per day |
| target_cp_pct_dm | numeric | Crude protein % of DM |
| target_nfc_pct_dm | numeric | NFC % of DM |
| notes | text | |
| updated_at | timestamptz | |

Seed values (starting point, to be tuned in the field):
- Mommas: DM 2.5%, CP 10%, NFC 30%
- Backgrounders: DM 2.5%, CP 13%, NFC 40%
- Finishers: DM 2.8%, CP 12%, NFC 50%
- Bulls: DM 2.0%, CP 10%, NFC 25%

## 3.4 `cattle_dailys`

Daily herd report. Parallels `pig_dailys` structure.

| Column | Type | Notes |
|---|---|---|
| id | text (PK) | |
| submitted_at | timestamptz | |
| date | date | |
| team_member | text | |
| herd | text | `mommas` \| `backgrounders` \| `finishers` \| `bulls` |
| feeds | jsonb | Array: `[{feed_input_id, qty, unit, lbs_as_fed, is_creep, nutrition_snapshot: {moisture, nfc, protein}}]`. `is_creep` defaults false; set true for feed lines consumed by calves via creep feeder — excluded from herd nutrition math but counted for cost. |
| minerals | jsonb | Array: `[{feed_input_id, lbs}]` |
| fence_voltage | numeric | kV |
| water_checked | bool | |
| mortality_count | int | |
| mortality_reason | text | Required when mortality_count > 0 |
| issues | text | Free text, "type 0 if nothing" pattern from other forms |
| source | text | `daily_webform` \| `add_feed_webform` \| `admin_entry` |

Raw inputs only. All %/totals/recommendations computed at display time.

## 3.5 `weigh_in_sessions` + `weigh_ins`

Parent/child tables that serve all three species.

### `weigh_in_sessions`

| Column | Type | Notes |
|---|---|---|
| id | text (PK) | |
| date | date | |
| team_member | text | |
| species | text | `cattle` \| `pig` \| `broiler` |
| herd | text (cattle) | Selected group |
| batch_id | text (pig/broiler) | FK to pig feeder group or broiler batch |
| broiler_week | int (broiler) | 4 or 6 |
| status | text | `draft` \| `complete` |
| started_at | timestamptz | |
| completed_at | timestamptz | |
| notes | text | |

### `weigh_ins`

| Column | Type | Notes |
|---|---|---|
| id | text (PK) | |
| session_id | text (FK) | |
| tag | text | Cattle: tag #. Pig: null. Broiler: bird index (optional). |
| weight | numeric | |
| note | text | Per-entry note (e.g. "lame back leg") |
| new_tag_flag | bool | TRUE if entered via "+ New Tag" during a cattle session. Admin reconciles later in Directory. |
| entered_at | timestamptz | |

## 3.6 `cattle` (Directory)

Full animal record. Populated from Podio import + ongoing births/purchases.

| Column | Type | Notes |
|---|---|---|
| id | text (PK) | tag number with prefix (e.g. `c-47`) |
| tag | text | Current tag number — unique when present, nullable for brand-new unweaned calves |
| pic_path | text | Storage path (optional) |
| purchase_tag_id | text | Original seller tag |
| sex | text | `cow` \| `heifer` \| `bull` \| `steer` |
| herd | text | Current membership (drives which tile shows them) |
| breed | text | Editable dropdown (like pigs) |
| breeding_blacklist | bool | Flag preventing breeding |
| breeding_blacklist_reason | text | |
| pct_wagyu | int | 0-100 |
| origin | text | |
| birth_date | date | |
| purchase_date | date | |
| receiving_weight | numeric | |
| purchase_amount | numeric | |
| dam_tag | text | Mother's tag (for calf↔mom linking) |
| sire_tag | text | Father's tag or reg # |
| sire_reg_num | text | For embryos / off-farm breedings |
| registration_num | text | |
| dna_test_pdf_path | text | Manual upload, parser deferred |
| maternal_issue_flag | bool | |
| maternal_issue_desc | text | Required when flag is TRUE |
| processing_batch_id | text (FK) | Set when sent to a batch |
| hanging_weight | numeric | Filled from processing batch |
| carcass_yield_pct | numeric | Computed |
| sale_date | date | |
| sale_amount | numeric | |
| death_date | date | |
| death_reason | text | |
| notes | text | |
| archived | bool | Matches pig pattern |
| created_at / updated_at | timestamptz | |

## 3.7 `cattle_calving_records`

Running history per cow, independent of cycle (Q4 from Apr 14: deep cross-link deferred).

| Column | Type | Notes |
|---|---|---|
| id | text (PK) | |
| dam_tag | text | |
| calving_date | date | |
| calf_tag | text | Nullable (if no calf born / stillborn) |
| calf_id | text (FK → cattle) | Set when calf is also added to directory |
| sire_tag | text | |
| cycle_id | text (FK → cattle_breeding_cycles) | Auto-linked by date window |
| total_born | int | |
| deaths | int | |
| complications_flag | bool | |
| complications_desc | text | Required when flag is TRUE |
| notes | text | |
| created_at | timestamptz | |

## 3.8 `cattle_breeding_cycles`

Breeding cycle timeline. Phase 1 includes this (scope bump per your confirmation).

Constants (from PROJECT.md §12):
- 65-day bull exposure
- Preg check 30 days after exposure end (blood-based at-home test)
- 9-month gestation
- 65-day calving window
- 7-month nursing → wean

| Column | Type | Notes |
|---|---|---|
| id | text (PK) | |
| herd | text | Usually `mommas` but could be a bull-exposure paddock group |
| bull_exposure_start | date | User-entered |
| bull_exposure_end | date (computed) | start + 65d |
| preg_check_date | date (computed) | exposure_end + 30d |
| calving_window_start | date (computed) | exposure_start + 9 months |
| calving_window_end | date (computed) | calving_window_start + 65d |
| weaning_date | date (computed) | calving_window_end + 7 months (approx per-cow override via calving record) |
| bull_tags | text | Newline-separated tag numbers (can be more than one bull in a cycle) |
| cow_tags | text | Newline-separated tag numbers in the cycle |
| status | text (computed) | `planned` \| `exposure` \| `pregcheck` \| `calving` \| `nursing` \| `weaned` \| `complete` |
| notes | text | |
| created_at | timestamptz | |

The **"Outstanding cows"** view on the breeding timeline filters `cow_tags − cows with calving_record.cycle_id = this`. The herd Mommas tile's "missed last cycle" sort uses the same data source.

## 3.9 `cattle_processing_batches`

Processing batch records. Naming: `C-26-01`, etc. Parallels broiler batches.

| Column | Type | Notes |
|---|---|---|
| id | text (PK) | |
| name | text | `C-26-01`, `B-26-02`, etc. Admin-editable prefix for future flexibility. |
| planned_process_date | date | |
| actual_process_date | date | |
| cow_tags | text[] | Denormalized for quick summary — source of truth is `cattle.processing_batch_id` |
| total_live_weight | numeric (computed) | Sum of cow latest weigh-ins |
| total_hanging_weight | numeric | Manually entered after processing |
| avg_yield_pct | numeric (computed) | hanging / live × 100 |
| processing_cost | numeric | |
| documents | jsonb | Array of {name, path, url, size, uploadedAt} matching broiler pattern |
| notes | text | |
| status | text | `planned` \| `complete` |
| created_at | timestamptz | |

## 3.10 `cattle_transfers` (audit log)

Every herd change (manual or auto) gets logged.

| Column | Type | Notes |
|---|---|---|
| id | text (PK) | |
| cattle_id | text (FK) | |
| from_herd | text | |
| to_herd | text | |
| reason | text | `manual` \| `processing_batch` \| `death` \| `sale` \| `weaned_from_mom` \| etc. |
| reference_id | text | Optional FK (processing batch id, etc.) |
| team_member | text | |
| transferred_at | timestamptz | |

## 3.11 Storage

**New bucket: `cattle-feed-pdfs`** — for feed test result PDFs. Public-read OK (no sensitive data). Size cap 20 MB per file.

**Reuse existing bucket `batch-documents`** for cattle processing batch documents (same semantics as broiler batches).

**New bucket: `cattle-directory-docs`** — for DNA test PDFs, purchase receipts, photos on animal records. Size cap 20 MB.

---

# 4. Admin UI — Feed tab restructure

Current `FeedCostsPanel` component (index.html:2276-2334) becomes the top section of a renamed **"Feed"** admin tab.

## 4.1 New layout

```
Admin → Feed
├── Simple $/lb (existing FeedCostsPanel, unchanged)
│   └── Poultry Starter, Grower, Layer Feed, Pig Feed, Grit
│
├── Livestock Feed Inputs (NEW)
│   ├── Filter: [All] [Hay] [Pellets] [Liquid] [Mineral] [Compound]
│   ├── + Add Feed button
│   └── Cards per feed:
│       ┌─────────────────────────────────────────────────┐
│       │ 🌾 Rye Baleage · Hay                        [Edit] │
│       │ Bale weight: 1,500 lb · Landed: $0.12/lb          │
│       │ Moisture 50.5% · NFC 17.7% DM · CP 16.6% DM       │
│       │ Herds: Mommas, Backgrounders, Finishers, Bulls    │
│       │ Tests: 2 on file [▼ expand history]              │
│       │   ├─ 2025-08-07 · Dairy One #30898810  [PDF]     │
│       │   └─ 2024-05-12 · ...                             │
│       └─────────────────────────────────────────────────┘
│
└── Nutrition Targets (NEW)
    ├── Herd table (Mommas / Backgrounders / Finishers / Bulls)
    │   Columns: Target DM % body, Target CP % DM, Target NFC % DM, Notes
    │   Each row inline-editable with autosave
    └── [+ Reset to defaults] link
```

## 4.2 Add/Edit Feed modal

Fields grouped into sections:

- **Identity:** name, category, status, herd_scope (multi-select chips)
- **Unit & cost:** unit, unit_weight_lbs, cost_per_unit, freight_per_truck, units_per_truck → `landed_per_lb` shows as computed preview
- **Nutrition:** moisture_pct, nfc_pct, protein_pct (read-only if tests exist — editable only by uploading a new test)
- **Test history:** list of `cattle_feed_tests` rows with PDF links; **+ Upload New Test** button opens test form:
  - Effective date, moisture, NFC, protein, bale weight (hay), PDF upload, notes, uploaded by
- **Nutrition toggle:** `exclude_from_nutrition` checkbox (checked for creep feed)
- **Notes**

Autosave pattern from existing modals (1.5s debounce, save on close). Follow PROJECT.md "use var in conditional blocks" rule.

---

# 5. Public webforms

All on `#webforms` (WebformHub). The top-level card grid gets:

```
┌─────────┐  ┌─────────┐  ┌─────────┐  ┌─────────┐  ┌─────────┐
│ 🐔 Broi │  │ 🐓 Layer│  │ 🥚 Egg  │  │ 🐷 Pig  │  │ 🐄 Cattle│
└─────────┘  └─────────┘  └─────────┘  └─────────┘  └─────────┘
┌─────────┐                                         ┌─────────┐
│ 🌾 Add  │                                         │ ⚖ Weigh │
│   Feed  │                                         │   Ins   │
└─────────┘                                         └─────────┘
Existing Add Feed card (cattle added as 4th program)     New 5th card (Phase 2)
```

## 5.1 Cattle Daily Report form

Flow and field list:

| Field | Type | Notes |
|---|---|---|
| Date | date | Required, defaults today |
| Team Member | dropdown | From per-form team members config |
| Cattle Group | dropdown | Mommas / Backgrounders / Finishers / Bulls |
| **Feed section** (dynamic) | | |
| Feed Type 1 | dropdown | Filtered by selected herd's herd_scope |
| Qty 1 | number | Unit inferred from feed (bale / lb / tub) |
| `+ Add Feed` button | | Adds Feed Type 2, Qty 2, etc. |
| **Minerals section** (dynamic) | | |
| Mineral 1 | dropdown | All minerals, all herds |
| Lbs 1 | number | |
| `+ Add Mineral` button | | |
| Fence Voltage | number | kV |
| Water checked? | Yes/No | |
| Mortalities | number | |
| Mortality reason | text | **Conditionally required** when count > 0 (existing pattern) |
| Issues / Comments | textarea | "Type 0 if nothing to report" helper (matches other webforms) |

On submit: store as `cattle_dailys` row. For each feed line, snapshot the feed's current nutrition values into the `feeds` jsonb so retroactive edits to the feed panel don't distort past reports (per answer 5(a)).

Add Group (multi-herd single submission): disabled for cattle initially — revisit if needed. Different herds use different feed options so "add group" is clunky.

## 5.2 Add Feed webform — Cattle added

Existing `#addfeed` (AddFeedWebform) gains Cattle as the 4th program. Quick-log pattern:

- Program toggle: Pig / Broiler / Layer / **Cattle**
- When Cattle picked: Cattle Group dropdown
- Feed type dropdown (filtered by herd)
- Qty in appropriate unit
- `+ Add Feed` works as on other programs
- Submits to `cattle_dailys` with `source = 'add_feed_webform'` and only the feed-related fields populated (all checks nullable)

Mirrors the existing pig/broiler/layer Add Feed handling. Feed snapshot captured at submit.

## 5.3 Weigh-Ins webform (5th card, Phase 2)

Flow:

1. Pick species: **Broilers / Pigs / Cattle**
2. Species-specific flow — see §8.

---

# 6. Authenticated Cattle Program

New top-level program next to Broilers / Layers / Pigs on the Home Dashboard.

## 6.1 Home Dashboard Cattle card

4th program card on the Home Dashboard. Shows: `{N active herds} · {total cattle} on farm · {N} in calving window`.

"Animals on Farm" tile expands from 4 cols → **5 cols**: Broilers / Layer Hens / Pigs / Cattle / Total. Sheep stays deferred per earlier decision.

## 6.2 Cattle sub-tabs

Sub-nav (matches existing pig/layer nav pattern):

```
Cattle → [ Dashboard · Herds · Dailys · Weigh-Ins · Breeding · Directory · Processing Batches ]
```

### Dashboard

Tiles (minimum viable, per answer R):
- Total cattle on farm
- Active herds breakdown (Mommas N · Backgrounders N · Finishers N · Bulls N)
- Total live weight (from latest weigh-ins)
- Outstanding calving (cow_tags in active cycle without calving record)
- Missed cycles (cows with no calving record in most recent completed cycle)
- Feed cost last 30 days
- Mortality last 30 days
- Rolling nutrition panel per herd (30d / 90d / 120d CP %, NFC % vs target — green/yellow/red)
- Carcass yield trend (from processing batches)

### Herds

Tile per herd (4 active + 3 collapsed outcomes).

**Herd tile layout:**

```
┌─────────────────────────────────────────────────────────────┐
│ 🐄 Mommas · 24 cows                                [Expand ▼]│
│ Live weight: 28,800 lbs · Avg 1,200 lb · 28.8 cow units      │
│ Feed needed today: DM 720 lb · CP 72 lb · NFC 216 lb         │
│ Actual (30d avg): DM 705 ✓ · CP 68 ⚠ · NFC 225 ✓            │
├─────────────────────────────────────────────────────────────┤
│ Sort by: [Tag▲] [Age] [Weight] [Missed Cycle]                │
│ [+ Add Cow] [Transfer] [Weigh-In]                            │
│                                                               │
│ Tag 47 · Angus · 3y 2m · 1,150 lb · ✓ Cycle 25-03           │
│ Tag 48 · Angus · 4y 1m · 1,280 lb · ⚠ Missed last cycle      │
│ ...                                                          │
└─────────────────────────────────────────────────────────────┘
```

Actions per herd:
- **Add Cow** → opens Directory add form scoped to this herd
- **Transfer** → multi-select cows, pick target herd, confirm
- **Weigh-In** → jumps to #webforms weigh-in card pre-selecting this herd

Per-cow expand shows: weigh history graph, calving history (Mommas only), notes, actions.

**Finisher tile additions:**
- `[Send to Processing Batch]` button — multi-select cows → pick existing Planned batch → confirm. Cows' `processing_batch_id` is set and `herd` auto-flips to `processed` on batch completion (not on selection — selection just reserves them).

**Collapsed outcome sections:**
- Processed: grouped by batch (`C-26-01`, `B-26-02`, etc.)
- Deceased: sorted by death_date desc
- Sold: sorted by sale_date desc

### Dailys

Mirrors pig/layer `*DailysView` component. List view with date filter + herd filter + source filter (All / Daily Reports / Add Feed). Edit modal respects the conditional-validation rules. Source-aware UI: add-feed rows hide the checks/mortality fields like other dailys views.

### Weigh-Ins

List of all weigh-in sessions for cattle. Click a session → view all entries. Mobile-friendly. For sessions still in `draft` status, shows a "Resume session" link that opens the webform directly into that session.

### Breeding (Phase 1)

Gantt-style timeline similar to `view==="breeding"` (pig breeding). Rows = breeding cycles. Phases: Bull Exposure → Preg Check → Calving Window → Nursing → Weaned. Cards below list each cycle with cow/bull tags, key dates, status, and the Outstanding Cows pill.

Outstanding cows list at bottom — computed from `cow_tags − dam_tags in calving_records where cycle_id = this`. Click to jump to the cow in Directory.

Auto-generated label: `Cattle Cycle YY-NN` using the same per-year global sequence pattern as pig `buildCycleSeqMap`.

### Directory (Phase 3)

Sortable/filterable table + card view of all `cattle` rows, not just active.

Columns: Tag, Sex, Herd, Breed, Age, Last weight, Dam, Sire, Status, Actions.

Filter chips: Active / Processed / Deceased / Sold / All. Plus search by tag/dam.

Per-row actions: Edit, Transfer, Send to Batch, Mark Deceased, Mark Sold, Upload DNA.

### Processing Batches (Phase 3)

List view of `cattle_processing_batches`. Tile per batch with cow list, live weight total, hanging weight, yield %, cost, documents. Parallels broiler batch processed-card layout.

---

# 7. Calculations reference

## 7.1 1000-lb cow units per herd

```
cow_units(herd) = Σ(latest_weigh_in(cow) for cow in herd) / 1000
```

If a cow has no weigh-in: use a fallback per herd:
- Mommas: 1,200 lb
- Backgrounders: 650 lb
- Finishers: 1,100 lb
- Bulls: 1,800 lb

These fallbacks are editable in Admin → Feed → Nutrition Targets panel (extra columns).

## 7.2 Daily nutrition delivered (per report)

For each feed line on a daily report:
```
lbs_dm   = lbs_as_fed × (1 − moisture_pct/100)
lbs_cp   = lbs_dm × (cp_pct_dm/100)   [where cp_pct_dm uses the snapshot]
lbs_nfc  = lbs_dm × (nfc_pct_dm/100)
```

**Creep feed handling:** when a Mommas daily report includes creep ingredients, those lines can be flagged per-line as creep via an `is_creep` boolean on the feed entry. Creep lines are **excluded** from Mommas nutrition totals (since the calves eat it, not the mommas) but **included** in cost totals. See §11 open question — this flag is the default assumption; alternative is to accept the inaccuracy and count everything.

Per herd daily totals:
```
herd_dm_day  = Σ(lbs_dm) across all feeds on all reports for that herd+date
herd_cp_day  = Σ(lbs_cp)
herd_nfc_day = Σ(lbs_nfc)
```

Per-cow-unit rates:
```
dm_per_unit   = herd_dm_day  / cow_units(herd)
cp_pct_dm     = (herd_cp_day / herd_dm_day) × 100
nfc_pct_dm    = (herd_nfc_day / herd_dm_day) × 100
```

## 7.3 Rolling windows (30 / 90 / 120 day)

Simple average of the above daily rates across the window. Render as:
- Green when within ±5% of target
- Yellow when within ±15%
- Red when worse than ±15%

## 7.4 Feed recommendation engine

Given herd targets and current cow_units:
```
target_dm_day  = cow_units × 10 × target_dm_pct_body  [×10 because pct of 1000-lb body]
target_cp_day  = target_dm_day × target_cp_pct_dm/100
target_nfc_day = target_dm_day × target_nfc_pct_dm/100
```

Recommendation: show the shortfall/surplus for each metric, and for Finishers/Backgrounders suggest citrus-pellet lbs to hit NFC, and hay bales to hit protein. Iterative — v1 flags shortfall; v2 actually solves for ingredient mix.

## 7.5 Molasses landed cost (from your invoice)

```
250 gal × 11.9 lb/gal = 2,975 lb per tote
per tote landed = (2,899.92 + 575) / 3 = $1,158.31
per lb landed = 1,158.31 / 2,975 = $0.389/lb
```

---

# 8. Weigh-in flows (Phase 2)

## 8.1 Broilers

- Pick active batch (only `status='active'` broiler batches)
- Pick week: **Week 4** or **Week 6**
- Enter individual weights one by one (no tag — just `bird_index` auto-incremented)
- On complete: computed average is written to `batch.week4Lbs` or `batch.week6Lbs`
- Batch edit form shows these fields as **read-only** with a "From weigh-in session · N birds · {date}" subtitle. A button lets admin unlock for manual override (audit-logged).
- Individual weights preserved in `weigh_ins` table (accessible from the session tile, per answer I).

## 8.2 Pigs

- Pick active feeder batch
- Enter weights one by one (no tag — just row index)
- Per-row note field
- On complete: tile shows all entries, each with a **checkbox "Send to trip"**
- `+ Create Processing Trip` button (visible when ≥1 checked) → opens the existing trip modal pre-filled with:
  - pigCount = number of checked rows
  - liveWeights = comma-joined checked weights
  - date = today (editable)
  - Rest of trip fields blank for manual entry
- When trip is saved, the weigh-in rows are linked to the trip (audit).

## 8.3 Cattle (autosave model)

**Session creation:**
- Pick herd → system creates `weigh_in_sessions` row with `status='draft'`
- Resume screen (on re-open): shows all draft sessions within last 7 days with progress. Pick one to continue.

**Entry screen:**
- Header: Herd · Date · Team member · `27 of 48 weighed` progress pill
- Tag dropdown (ascending, diminishing — weighed tags removed from list)
- Weight input
- Per-entry note (optional)
- `Save Entry` button → writes to `weigh_ins` immediately, tag removed from dropdown
- **`+ New Tag`** button — prompts for a new tag # + weight + note → saves with `new_tag_flag=true`. Admin reconciles later in Directory (decides whether it's a brand-new cow or a lost-tag replacement).

**Complete:**
- `Complete Session` button → sets status='complete', prompts confirmation showing outstanding tags (not weighed) and new-tag flags
- Session stays in the Weigh-Ins list for editing

**Mobile considerations:**
- Large tap targets (min 44px)
- Auto-focus the weight input after tag selection
- Preserve session on navigation away (it's already in Supabase)
- No offline mode v1 — phone must have connectivity. If that becomes an issue, add IndexedDB queue as v2.

**Edge cases addressed:**
- Phone drops / runs out of battery: open session on another device, resume where you left off
- Duplicate tag entered: reject with "Tag 47 already recorded at 14:32 (1,150 lb) in this session"
- Session interrupted for hours: still resumable from draft list
- Session in wrong herd: admin can edit session record to fix

---

# 9. Build order (within Phase 1)

Bottom-up. Each step ends with local testing, no deploy until everything clears.

1. **Supabase migrations** — all 11 tables (no creep batches table), RLS policies, indexes
2. **Storage buckets** — `cattle-feed-pdfs`, `cattle-directory-docs`
3. **Constants** — cattle groups, breeding cycle constants, seed nutrition targets, cattle red palette constants in index.html
4. **Admin Feed tab restructure** — `FeedCostsPanel` split + `LivestockFeedInputsPanel` + `NutritionTargetsPanel`
5. **Test PDF upload flow** — form, version history display
6. **Add/edit feed modal** — full fields, autosave, herd_scope chips
7. **Cattle Daily webform** — full field list, dynamic feed/mineral sections with per-line `is_creep` toggle, nutrition snapshot
8. **Add Feed webform — Cattle added** — fourth program card on `#addfeed`; per-line `is_creep` toggle on Mommas feed entries
9. **`CattleDailysView`** component — list, filters, edit modal
10. **Herds tab** — 4 active tiles + 3 collapsed outcome sections, sort controls, per-cow list
11. **Breeding tab** — Gantt + cycle cards + outstanding cows
12. **Calving records** — form + history display inline under cows
13. **Cattle Home Dashboard** — tiles + rolling nutrition panel
14. **Home page Cattle card + Animals on Farm 5th column**
15. **Routing** — add `cattleHome`, `cattleherds`, `cattledailys`, `cattlebreeding`, `cattledirectory`, `cattlebatches` to `VALID_VIEWS`

**Phase 2 (in same build):**
16. `weigh_in_sessions` + `weigh_ins` tables
17. Weigh-Ins webform — 5th card, species picker
18. Broiler weigh-in flow + batch field read-only integration
19. Pig weigh-in flow + trip creation integration
20. Cattle weigh-in flow with autosave sessions
21. `WeighInsView` tab under each species

**Phase 3 (in same build):**
22. Cattle Directory table + filters + actions
23. Add/edit cow modal with all Podio fields
24. Mom↔calf relationship UI
25. Processing Batches tab + send-to-batch flow + auto-move on complete
26. Sale / Deceased modals + auto-move
27. Per-head cost rollup

---

# 10. Test checklist

**Feed admin**
- [ ] Add new feed entry of each category
- [ ] Upload test PDF → values update, history row created, past reports unchanged
- [ ] Herd scope filter correctly on webform dropdown
- [ ] Nutrition targets save per herd and render on dashboard rolling panel
- [ ] Landed cost math matches hand calc for molasses invoice

**Webforms**
- [ ] Cattle Daily submits with mixed feed + mineral rows
- [ ] Mortality reason required when count > 0
- [ ] Feed snapshot preserves values when feed later updated
- [ ] Add Feed webform for cattle posts to `cattle_dailys` with `source=add_feed_webform`
- [ ] Per-line `is_creep` toggle on Mommas daily report excludes from nutrition but counts for cost

**Herds**
- [ ] Tile live weight matches sum of latest weigh-ins
- [ ] Transfer between herds logs in `cattle_transfers` and updates `cattle.herd`
- [ ] Outcome sections auto-populate on processing batch complete / death / sale
- [ ] Missed cycle filter correctly flags cows without calving in last completed cycle

**Breeding**
- [ ] Cycle timeline computes correct dates from exposure start
- [ ] Outstanding cows list updates when a calving record is added
- [ ] Auto-label `Cattle Cycle YY-NN` sequences per year

**Weigh-ins**
- [ ] Broiler session → week field on batch goes read-only with correct avg
- [ ] Pig session → send-to-trip button pre-fills trip modal correctly
- [ ] Cattle session survives full page reload (Supabase persistence)
- [ ] Resume-draft shows correct progress
- [ ] Diminishing dropdown hides tags already weighed
- [ ] New-tag flag visible in completion review

**Integrations**
- [ ] Cattle count in "Animals on Farm" matches directory count
- [ ] Dashboard rolling windows match hand calc for a test date range
- [ ] Cost per head on processing batch = (cycle feed cost × days) / cow count

---

# 11. Open items / assumptions to verify

Flagging things I chose without explicit confirmation. Ronnie: please call out any that are wrong.

- **Creep feed model (confirmed):** no standalone form, no compound-feed entry, no separate table. Ingredients (alfalfa pellets, citrus pellets, sugar, colostrum) are regular feed entries in the Feed Inputs panel. Creep consumption is logged on Mommas daily reports with a per-line `is_creep` toggle — those lines count for cost but not for Mommas nutrition math.
- **Sugar** IS a standalone feed entry (updated from Q1 default).
- **Nutrition target seeds** (§3.3): starting values before real calibration. First 30 days in field will tell us whether they need tuning.
- **Fallback cow weights** (§7.1): 1,200 / 650 / 1,100 / 1,800 lb. Admin-editable.
- **Tag-less calves:** allowed in the Directory with `tag=null`. Rendered as "Calf of #47 (untagged)" until tagged.
- **Natural deaths auto-move to Deceased:** when admin marks a cow as deceased (form in Directory), `herd` auto-flips to `deceased` and a `cattle_transfers` row is logged. Same for sales.
- **Processing-batch UX:** selecting cattle into a **Planned** batch reserves them (shows in batch tile) but doesn't flip their `herd`. Only on batch completion does `herd` flip to `processed` and hanging weight / yield fields unlock.
- **No offline mode** for cattle weigh-ins v1. Connectivity required. Re-evaluate after 2-4 weeks of field use.
- **Herd scope field on feeds** rather than a hardcoded map — feels more maintainable and lets admin adjust if they add a quarantine group later.
- **Auto-prune of test PDFs:** not implemented. All history retained indefinitely. Storage cost is negligible at test frequency.

---

# 12. SOP update (to be applied to PROJECT.md §1 at session end)

> **Deployment gate**: NEVER run `git commit`, `git push`, or any deploy command without explicit user approval in the current session turn. Approval for one change does not imply approval for subsequent changes. After completing code changes, pause and ask the user to review the diff before committing.

---

*End of design doc. Awaiting Ronnie's review before any code is written.*
