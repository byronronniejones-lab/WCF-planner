**WCF PLANNER**

White Creek Farm

*Full System Handover Document*

April 11, 2026

*Built during April 9-11, 2026 build session*

**1. How to Work With the Next Claude Instance**

This section is the most important one. Ronnie has a specific way of
working and the previous Claude learned it over two days. Read this
carefully before starting any work.

**1.1 Ronnie\'s Working Style**

-   Ask lots of questions before building. Ronnie explicitly said \"I
    like to operate with lots of questions and clarifying.\" Never jump
    into code without fully understanding scope.

-   Always use ask_user_input_v0 with multiple choice options for
    clarifying questions --- never as plain text bullet lists. This is a
    standing instruction in userMemories.

-   When scope is large (like the Layer Batch system), map out the FULL
    design, confirm it, then build in phases. Ronnie said: \"Thank you
    for really digging in and figuring all this out and getting the
    scope of the build before just jumping in. This is the way I like to
    operate.\"

-   Never assume. If something is ambiguous, ask.

-   Be honest about mistakes. When Claude gave a false answer about role
    gating (saying Add Report was admin-only when it wasn\'t), the right
    move was to own it clearly and correct it.

-   Ronnie notices when Claude confirms things without checking the
    code. Always verify before confirming.

-   Backup before major changes. Ronnie learned to run SQL backup tables
    before touching database records. Always suggest this.

**1.2 How to Start Each Session**

-   Read this document top to bottom first.

-   Copy the current index.html into /home/claude/index.html as the
    working file.

-   Ask what Ronnie wants to work on --- don\'t assume.

-   If a feature request is large, ask all clarifying questions BEFORE
    writing any code. Use multiple rounds of ask_user_input_v0 if
    needed.

-   Check if there are pending items from this document\'s \"Pending /
    Not Yet Built\" section.

**1.3 Known Gotchas With This Codebase**

-   Babel in-browser transpiler is strict about special characters
    inside JSX. Never use template literals with special chars (·, ‹, ›,
    →, ---) inside JSX. Use string concatenation + unicode escapes
    instead (e.g. \'\\u00b7\' for ·).

-   Never use const {useState} = React destructuring at the top of
    standalone components that are defined near the App function. Use
    React.useState() directly to avoid \"useState already declared\"
    errors.

-   The app is ONE file --- index.html, \~8,400 lines. All React, CSS,
    and JS live in it. Deploy = download + drag to Netlify.

-   Supabase sessions expire. If daily records show 0, tell Ronnie to
    sign out and sign back in. This has happened multiple times and is
    always the fix.

-   app_store saves are JSON blobs --- always use sbSave() helper which
    has retry logic and timeout handling.

-   str_replace fails if content has changed since last view. Always
    re-read the file section before editing.

**1.4 Deployment Process**

-   Edit /home/claude/index.html

-   Copy to /mnt/user-data/outputs/index.html

-   Present the file to Ronnie

-   Ronnie downloads it and drags to Netlify (app.netlify.com → Farm
    Team → wcfplanner.com)

-   Hard refresh: Cmd/Ctrl+Shift+R

-   Sign out and sign back in after deploy to refresh Supabase session

**2. Infrastructure Overview**

**2.1 Hosting & Domain**

  -----------------------------------------------------------------------
  **Service**            **Details**
  ---------------------- ------------------------------------------------
  Live URL               https://wcfplanner.com

  Hosting                Netlify --- Farm Team account (ronnie-ipfsd1e)

  Deploy method          Manual drag-and-drop of index.html in Netlify
                         dashboard

  DNS                    Netlify DNS (ns1-4.p09.nsone.net)

  Domain registrar       Managed via Netlify
  -----------------------------------------------------------------------

**2.2 Supabase (Database + Auth + Edge Functions)**

  ----------------------------------------------------------------------------
  **Item**               **Value**
  ---------------------- -----------------------------------------------------
  Project ID             pzfujbjtayhkdlxiblwe

  Project URL            https://pzfujbjtayhkdlxiblwe.supabase.co

  Project Name           Farm Planner

  Dashboard              supabase.com/dashboard/project/pzfujbjtayhkdlxiblwe

  Anon Key               eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9\... (in
                         index.html line 132)

  Admin email            ronnie@whitecreek.farm
  ----------------------------------------------------------------------------

**2.3 Email (Resend)**

  -----------------------------------------------------------------------
  **Item**               **Value**
  ---------------------- ------------------------------------------------
  Service                Resend (resend.com)

  Sending domain         wcfplanner.com (verified)

  From address           reports@wcfplanner.com

  Edge function          rapid-processor (Supabase Edge Functions)

  Secret                 RESEND_API_KEY stored in Supabase Edge Function
                         Secrets

  JWT verification       OFF on rapid-processor

  DNS records            4 records added to Netlify DNS (DKIM, SPF MX,
                         SPF TXT, DMARC)
  -----------------------------------------------------------------------

**2.4 Tech Stack**

-   React 18 (Babel in-browser transpiler --- no build step)

-   Supabase JS v2 (auth, database, edge functions)

-   SheetJS (Excel export, if used)

-   All in one single index.html file (\~8,400 lines, \~622KB)

-   No npm, no bundler, no separate CSS file

**3. Database Schema**

Supabase (PostgreSQL). All data lives here. The app_store table is the
main JSON blob store.

**3.1 Supabase Tables**

  -------------------------------------------------------------------------
  **Table**         **Purpose**           **Key Fields**
  ----------------- --------------------- ---------------------------------
  app_store         Main JSON blob store  key (string), data (jsonb)
                    --- all non-daily     
                    data                  

  webform_config    Config for public     key (string), data (jsonb)
                    webforms (anon        
                    access)               

  batches           Broiler batches       name, status, hatchDate, breed,
                                          brooder, schooner,
                                          processingDate, etc.

  poultry_dailys    Broiler daily reports date, batch_label, feed_type,
                                          feed_lbs, grit_lbs,
                                          mortality_count, team_member

  layer_dailys      Layer daily reports   date, batch_label, feed_type,
                                          feed_lbs, grit_lbs, layer_count,
                                          mortality_count, team_member

  egg_dailys        Egg collection        date, team_member,
                    reports               group1-4_name/count,
                                          daily_dozen_count, dozens_on_hand

  pig_dailys        Pig daily reports     date, batch_label, feed_lbs,
                                          pig_count, fence_voltage,
                                          team_member

  layer_batches     Layer batch parent    id, name, status, arrival_date,
                    records (NEW)         brooder_name/dates,
                                          schooner_name/dates

  layer_housings    Layer housing         id, batch_id, housing_name,
                    sub-batches (NEW)     status, allocated_count,
                                          current_count, start_date,
                                          retired_date

  profiles          User profiles + roles id, full_name, role
                                          (farm_team/management/admin)

  batch-documents   File attachments on   batch_id, filename, url
                    batches               
  -------------------------------------------------------------------------

**3.2 app_store Keys**

  -----------------------------------------------------------------------
  **Key**                    **Contents**
  -------------------------- --------------------------------------------
  ppp-v4                     Broiler batches array (the main batch data)

  ppp-layer-groups-v1        Layer groups array (Eggmobile 2, Eggmobile
                             3, Layer Schooner, Retirement Home)

  ppp-webforms-v1            Webform configuration (fields, labels, team
                             members per form)

  ppp-feeders-v1             Pig feeder groups / batches

  ppp-pigs-v1                Pig sow/boar data

  ppp-breeding-v1            Breeding cycle records

  ppp-farrowing-v1           Farrowing records

  ppp-breeders-v1            Breeding pig registry

  ppp-feed-costs-v1          Feed cost per lb (starter, grower, layer,
                             pig)

  ppp-broiler-notes-v1       Broiler section notes

  ppp-pig-notes-v1           Pig section notes

  ppp-layer-notes-v1         Layer section notes

  ppp-missed-cleared-v1      Set of cleared missed-report alerts
  -----------------------------------------------------------------------

**3.3 webform_config Keys**

  ------------------------------------------------------------------------
  **Key**                 **Contents**
  ----------------------- ------------------------------------------------
  full_config             Full webform config including layerGroups,
                          broilerGroups, teamMembers, webforms

  broiler_groups          Active broiler batch names for webform dropdown

  active_groups           Active pig group names for webform dropdown

  team_members            All team member names

  per_form_team_members   Team members per form ID

  webform_settings        allowAddGroup per form

  housing_batch_map       Maps housing name → active batch name (e.g.
                          \"Eggmobile 2\" → \"L-26-01\")

  layer_groups            Active layer group names (legacy, also in
                          full_config)
  ------------------------------------------------------------------------

**3.4 Backup Tables (Created April 10, 2026)**

These backup tables were created before major data operations. They can
be used to restore data if needed.

-   \_backup_layer_dailys (2,022 records)

-   \_backup_egg_dailys (996 records)

-   \_backup_app_store (11 records)

-   \_backup_webform_config (6 records)

-   \_backup_layer_batches (3 records)

-   \_backup_layer_housings (3 records)

> *To restore: INSERT INTO layer_dailys SELECT \* FROM
> \_backup_layer_dailys WHERE NOT EXISTS (SELECT 1 FROM layer_dailys
> WHERE layer_dailys.id = \_backup_layer_dailys.id);*

**4. App Architecture**

**4.1 File Structure**

Everything is in one file: index.html. Sections in order:

-   Lines 1-130: HTML head, CSS styles, CDN script tags (React, Babel,
    Supabase, SheetJS)

-   Lines 131-155: Supabase client init + wcfSendEmail helper

-   Lines 156-475: Global constants (BROODER_DAYS, SCHOONERS, RESOURCES,
    COLORS, STATUS_STYLE, etc.)

-   Lines 476-682: LoginScreen component

-   Lines 683-873: UsersModal component

-   Lines 874-1474: WebformHub component (public-facing webforms)

-   Lines 1449-1475: DeleteModal component

-   Lines 1476+: App() --- the main application (\~5,000 lines)

-   Lines 6769+: WcfYN, WcfToggle, AdminAddReportModal standalone
    components

-   Lines 7097+: BroilerDailysView standalone component

-   Lines 7280+: LayerBatchesView standalone component (NEW)

-   Lines 7785+: LayersView standalone component

-   Lines 7941+: LayerDailysView standalone component

-   Lines 8116+: EggDailysView standalone component

-   Lines 8285+: PigDailysView standalone component

-   Final lines: ReactDOM.createRoot render

**4.2 User Roles**

  ---------------------------------------------------------------------------
  **Role**        **Access Level**                   **Who**
  --------------- ---------------------------------- ------------------------
  admin           Full access. Can delete anything,  ronnie@whitecreek.farm
                  manage users, edit webform config  

  management      Can edit most things. Cannot       Mak and others
                  delete arbitrary records or manage 
                  users                              

  farm_team       Can submit daily reports, view all Simon, Josh, Jenny, etc.
                  data, add reports                  

  inactive        Login blocked                      Former team members
  ---------------------------------------------------------------------------

> *Add Report button is visible to ALL roles --- not just admin. This
> was a point of confusion in the build session. The code has no role
> gating on it.*

**4.3 Navigation Views (VALID_VIEWS)**

  ------------------------------------------------------------------------
  **View**        **Section**     **Description**
  --------------- --------------- ----------------------------------------
  home            Global          Main home --- shows all 3 section
                                  cards + timeline + admin recent reports

  broilerHome     Broilers        Broiler dashboard

  timeline        Broilers        Gantt chart --- broiler batches + layer
                                  batches weeks 1-22

  list            Broilers        Broiler batch list

  feed            Broilers        Feed calculator / monthly summary

  broilerdailys   Broilers        Broiler daily reports view

  pigsHome        Pigs            Pig dashboard

  breeding        Pigs            Breeding timeline

  farrowing       Pigs            Farrowing records

  sows            Pigs            Breeding pig registry

  pigbatches      Pigs            Pig feeder batches

  pigfeed         Pigs            Pig feed calculator

  pigs            Pigs            Pig feed calculator (alias)

  pigdailys       Pigs            Pig daily reports

  layersHome      Layers          Layer dashboard

  layerbatches    Layers          Layer batch management (NEW)

  layerdailys     Layers          Layer daily reports

  eggdailys       Layers          Egg daily reports

  webforms        Webforms        Admin webform config

  webformhub      Webforms        Public webform hub (farm team submits
                                  here)

  webform         Webforms        Individual webform submission

  layers          Layers          Layer groups view (hidden from nav but
                                  still routed)
  ------------------------------------------------------------------------

**5. Broiler System**

**5.1 Timing Constants**

  ------------------------------------------------------------------------
  **Constant**        **Value**       **Meaning**
  ------------------- --------------- ------------------------------------
  BROODER_DAYS        14 days         Time in brooder for meat birds

  CC_SCHOONER         35 days         Cornish Cross schooner duration

  WR_SCHOONER         42 days         White Ranger schooner duration

  BROODER_CLEANOUT    3 days          Cleanout buffer after brooder

  SCHOONER_CLEANOUT   4 days          Cleanout buffer after schooner

  WEEKS_SHOWN         52 weeks        Timeline window size
  ------------------------------------------------------------------------

**5.2 Infrastructure (RESOURCES)**

-   Brooder 1, Brooder 2, Brooder 3 (max 750 birds each)

-   Schooner 1 (solo, 650 birds)

-   Schooner 2&3, 4&5, 6&6A, 7&7A (pairs)

**5.3 Batch Statuses**

-   planned --- future batch

-   active --- currently on farm

-   processed --- harvested (previously \"archived\", auto-migrated on
    load)

**5.4 Broiler Timeline**

The Gantt chart at Broilers → Timeline shows:

-   Each resource row (brooder 1, 2, 3, schooner 1, 2&3, etc.) with
    batch bars

-   Light color = brooder phase, dark color = schooner phase

-   Conflict detection: warns if two batches overlap on same resource
    (including cleanout buffer)

-   conflictOverride flag allows manual override of conflicts

-   Layer batch rows shown below broiler rows in amber section (NEW)

-   Hover tooltip works for both broiler and layer batches

**5.5 Broiler Daily Reports**

Table: poultry_dailys. Fields: date, batch_label, feed_type
(STARTER/GROWER), feed_lbs, grit_lbs, group_moved, waterer_checked,
mortality_count, mortality_reason, comments, team_member.

**6. Layer System (Most Complex --- Read Carefully)**

The layer system was substantially redesigned during this build session.
Read this section thoroughly before making any changes.

**6.1 Layer Batch Lifecycle**

Layer chicks go through 3 phases tracked in layer_batches:

-   Phase 1 --- BROODER: 3 weeks (21 days) fixed. Batch name (e.g.
    L-26-01) shows on daily reports. Feed type = STARTER.

-   Phase 2 --- SCHOONER: 3-20 weeks (default 17 weeks / 119 days).
    Batch name shows on daily reports. Feed type = GROWER. Uses same
    schooner resources as broilers.

-   Phase 3 --- HOUSING: Birds split into 2-3 housings (eggmobiles,
    layer schooner). Housing name shows on daily reports. Feed type =
    LAYER.

> *Layer batches appear on the Broiler Timeline during weeks 1-22
> (brooder + schooner phases) to prevent double-booking of brooders and
> schooners. Hover tooltip shows batch details.*

**6.2 Current Layer Batches**

  ------------------------------------------------------------------------------
  **Batch**    **Status**   **Arrived**   **Housings**               **Notes**
  ------------ ------------ ------------- -------------------------- -----------
  L-23-01      Retired      Unknown       Eggmobile #2 - 2023, Layer 2023 flock
                                          Schooner - 2023,           --- all
                                          Retirement Home - 2023     retired

  L-25-01      Active       Feb 13, 2025  Eggmobile 3 (from Jun 24,  
                                          2025)                      

  L-26-01      Active       Sep 25, 2025  Eggmobile 2 + Layer        
                                          Schooner (from Jan 28,     
                                          2026)                      

  Retirement   Permanent    N/A           None (standalone)          Never
  Home                                                               closes.
                                                                     Receives
                                                                     aged birds
                                                                     from all
                                                                     batches.
  ------------------------------------------------------------------------------

**6.3 Current Layer Housings (layer_housings table)**

  --------------------------------------------------------------------------
  **Housing**      **Batch**    **Status**   **Start Date**   **Capacity**
  ---------------- ------------ ------------ ---------------- --------------
  Eggmobile 3      L-25-01      Active       Jun 24, 2025     250 birds

  Eggmobile 2      L-26-01      Active       Jan 28, 2026     250 birds

  Layer Schooner   L-26-01      Active       Jan 28, 2026     450 birds

  Eggmobile #2 -   L-23-01      Retired      Aug 31, 2023     250 birds
  2023                                                        

  Layer Schooner - L-23-01      Retired      Dec 4, 2023      450 birds
  2023                                                        

  Retirement       L-23-01      Retired      Unknown          Unlimited
  Home - 2023                                                 
  --------------------------------------------------------------------------

**6.4 Housing Lock Rules**

-   A housing that is ACTIVE under any batch cannot be selected for
    another batch --- it shows as disabled in the dropdown with \"In use
    by \[batch\]\".

-   EXCEPTION: Retired batches can select any housing regardless of lock
    status (historical record-keeping).

-   Retiring a housing immediately unlocks it for other batches.

-   Retiring a batch does NOT auto-retire its housings --- Ronnie
    prefers to manually retire housings first, then retire the batch.

-   Housing capacity warnings: Layer Schooner = 450, Eggmobiles = 250.
    Warning shown but not a hard block.

**6.5 Daily Report Name Mapping**

This is critical --- the batch_label in daily reports maps to housings
by name AND date range:

  ------------------------------------------------------------------------
  **batch_label in   **Maps to**         **Date range**
  DB**                                   
  ------------------ ------------------- ---------------------------------
  L-26-01 or L-25-01 Batch               Before first housing start_date
                     (brooder/schooner   
                     phase)              

  Eggmobile 3        L-25-01 housing     Jun 24, 2025 onward

  Eggmobile 2        L-26-01 housing     Jan 28, 2026 onward

  Layer Schooner     L-26-01 housing     Jan 28, 2026 onward

  Retirement Home    Retirement Home     All time
                     batch               

  Eggmobile #2 -     L-23-01 housing     Aug 31, 2023 onward
  2023                                   

  Layer Schooner -   L-23-01 housing     Dec 4, 2023 onward
  2023                                   

  Retirement Home -  L-23-01 housing     All time
  2023                                   
  ------------------------------------------------------------------------

> **⚠ Date range filtering is critical. If the same housing name is
> reused by a future batch, stats would bleed across batches without
> date filtering. The inRange() function in LayerBatchesView handles
> this.**

**6.6 Feed Type Classification**

  ------------------------------------------------------------------------
  **Feed      **Phase**   **Period (L-25-01)**   **Period (L-26-01)**
  Type**                                         
  ----------- ----------- ---------------------- -------------------------
  STARTER     Brooder     Feb 13 - Mar 6, 2025   Sep 25 - Oct 16, 2025

  GROWER      Schooner    Mar 7 - Jun 23, 2025   Oct 17, 2025 - Jan 27,
                                                 2026

  LAYER       Housing     Jun 24, 2025+          Jan 28, 2026+
  ------------------------------------------------------------------------

Historical records (imported from Podio before April 2026) were
backfilled using SQL UPDATE based on these date ranges.

**6.7 Starter Feed Alert**

Fires when STARTER feed for a layer batch crosses 1,400 lbs (same
threshold as broilers). Email sent to Simon.rosa3@gmail.com, CC
mak@whitecreek.farm. Edge function checks both poultry_dailys and
layer_dailys tables based on the \"table\" param.

**6.8 Layer Groups (webform_config)**

The active layer groups that appear in webform dropdowns are:

-   Eggmobile 2 (in use --- L-26-01)

-   Eggmobile 3 (in use --- L-25-01)

-   Layer Schooner (in use --- L-26-01)

-   Retirement Home

Logic: If a batch has active housings → housing names appear in webform
(NOT the batch name). If a batch has no active housings yet
(brooder/schooner phase) → batch name appears.

The housing_batch_map in webform_config tells the webform which batch
each housing belongs to, shown as a blue info note when selected.

**7. Pig System**

The pig system tracks sows, boars, breeding cycles, farrowing, and
feeder (market) pig batches. Data stored in app_store JSON blobs.

**7.1 Pig Sections**

-   Dashboard (pigsHome) --- active cycles, sow count, active batches

-   Timeline (breeding) --- breeding cycle Gantt (boar exposure →
    farrowing → weaning)

-   Farrowing --- farrowing records with outcomes

-   Breeding Pigs (sows) --- sow and boar registry

-   Batches (pigbatches) --- feeder pig batches with sub-batches

-   Feed Calculator (pigs/pigfeed) --- feed planning

-   Pig Dailys --- daily reports per pig batch

**7.2 Pig Daily Reports**

Table: pig_dailys. Fields: date, batch_label, batch_id, feed_lbs,
pig_count, fence_voltage, group_moved, nipple_drinker_moved/working,
troughs_moved, fence_walked, issues, team_member.

Pig batches use sub-batches (similar to layer housings). Sub-batch names
show in daily report dropdowns. The active_groups in webform_config
contains SOWS, BOARS, and all active pig sub-batch names.

**7.3 Auto-Save**

Pig batch forms auto-save with a 1.5 second debounce when editing
existing records (same as broiler batches). Layer group forms also have
auto-save.

**8. Email Automation**

**8.1 Edge Function: rapid-processor**

Deployed to Supabase as \"rapid-processor\". Handles two email types.
JWT verification is OFF. RESEND_API_KEY stored as a Supabase secret.

**8.2 Email 1 --- Egg Report**

  -----------------------------------------------------------------------
  **Field**          **Value**
  ------------------ ----------------------------------------------------
  Trigger            Every egg report submission (webform OR admin Add
                     Report)

  To                 isabel@sonnysfarm.com

  CC                 brian@sonnysfarm.com, jessica@marbellagroup.com

  BCC                ronnie@whitecreek.farm

  Subject            Inventory Egg Report - 10 April 2026 (en-GB date
                     format)

  Design             Olive green header (#566542), two stat cards, White
                     Creek Farm branding

  Content            Dozens on Hand (\<2 weeks old) + Dozens Collected
                     Today

  From               reports@wcfplanner.com (WCF Planner)
  -----------------------------------------------------------------------

**8.3 Email 2 --- Starter Feed Alert**

  -----------------------------------------------------------------------
  **Field**          **Value**
  ------------------ ----------------------------------------------------
  Trigger            When STARTER feed for a batch crosses 1,400 lbs for
                     the first time

  To                 Simon.rosa3@gmail.com

  CC                 mak@whitecreek.farm

  Subject            STARTER FEED LIMIT - NEAR CUTOFF FOR \[batch name\]

  Content            \"Dear Supreme Chicken Raiser\...\" --- batch name +
                     total lbs + 1,500 lb max warning

  Applies to         Both broiler (poultry_dailys) and layer
                     (layer_dailys) batches

  One-time only      Only fires when total CROSSES 1,400. Not on every
                     subsequent report.
  -----------------------------------------------------------------------

**8.4 Test Mode**

Pass test_to in the edge function body to override recipients (sends
only to that address with \[TEST\] prefix). Example from browser console
on wcfplanner.com:

sb.functions.invoke(\'rapid-processor\', {body: {type:\'egg_report\',
test_to:\'ronnie@whitecreek.farm\', data:{date:\'2026-04-10\',
team_member:\'Simon\', dozens_on_hand:14.5,
daily_dozen_count:8}}}).then(r=\>console.log(r))

**9. Webforms (Public Submission)**

**9.1 Overview**

Available at wcfplanner.com/#webforms --- no login required. Farm team
uses this daily. The WebformHub component handles all public form
submissions.

**9.2 Active Webforms**

-   Broiler Daily --- submits to poultry_dailys. STARTER feed triggers
    starter alert email.

-   Layer Daily --- submits to layer_dailys. Shows housing name + which
    batch it belongs to. STARTER feed triggers alert.

-   Egg Daily --- submits to egg_dailys. Triggers egg report email.
    Computes daily_dozen_count automatically.

-   Pig Daily --- submits to pig_dailys.

**9.3 Webform Config**

Each webform is fully configurable from the Admin → Webforms section:

-   Fields can be toggled on/off, marked required, renamed

-   Team members per form (shown in dropdown)

-   allowAddGroup --- allows \"Add Another Group\" button

-   Config stored in app_store (ppp-webforms-v1) and synced to
    webform_config (full_config) for anon access

**9.4 Admin Add Report**

The AdminAddReportModal component mirrors the WebformHub --- same
fields, same config. Available in all daily views (Broiler Dailys, Layer
Dailys, Egg Dailys, Pig Dailys). Visible to ALL roles. Also triggers
emails same as webform submissions.

**10. Known Issues & Lessons Learned from This Build Session**

**10.1 Mistakes Made (Don\'t Repeat)**

-   Claude said \"Add Report is admin only\" without checking the code.
    It wasn\'t. Always verify before confirming.

-   Claude used template literals with special characters (·, ‹, ›, →)
    inside JSX --- caused repeated Babel syntax errors. NEVER do this.
    Use string concatenation + \\u escapes.

-   The Python file replacement script accidentally duplicated a comment
    and removed a closing \</div\>, breaking the Gantt chart. Always
    verify replacements carefully.

-   syncWebformConfig had stale closure issues --- lgData and lhData
    params must be passed explicitly, not read from state inside the
    function.

-   The initial layer batch stats computation had no date filtering ---
    L-23-01 was pulling L-26-01 data because \"Eggmobile 2\" matched
    regardless of date. Always filter by start_date and retired_date.

-   L-23-01 housings were initially seeded with names \"Eggmobile 2\"
    and \"Layer Schooner\" instead of \"Eggmobile #2 - 2023\" and
    \"Layer Schooner - 2023\", causing data bleed. Fixed with SQL
    UPDATE.

**10.2 Recurring Issues**

-   Supabase 401 errors → session expiry → fix = sign out + sign in.
    Happens regularly. Always ask Ronnie to try this first.

-   str_replace failing → file has changed since last view → re-read the
    target section before editing.

-   Babel errors from special chars in JSX → see 10.1 above.

**10.3 Technical Debt / Known Limitations**

-   Retiring a batch does NOT auto-retire its housings. Ronnie is OK
    with this (manual process).

-   The housing capacity warning (250/450 birds) is a warning only, not
    a hard block. Ronnie chose this.

-   Eggmobile 2 has no STARTER/GROWER records from the pre-housing phase
    (Sep 25 - Jan 27). Those records were likely logged under a
    different name in Podio and weren\'t imported. Not a data problem
    Claude created.

-   The \"layers\" view is still in VALID_VIEWS and routed, just not in
    the nav. The LayersView component still works if navigated to
    directly.

**11. Pending / Not Yet Built**

These items were discussed or partially scoped but not completed:

-   Broiler timeline conflict detection does not yet check layer batches
    against broiler resource IDs (only visual). The schooner names used
    by layer batches (e.g. \"Schooner 2&3\") need to map to RESOURCES
    IDs for proper conflict detection.

-   No automated feed cost tracking per batch (cost per lb × lbs fed =
    total feed cost).

-   No batch-level summary report / export for completed layer batches.

-   The Layers Dashboard \"Active Groups\" stat tile still reads from
    layerGroups (the old system) rather than layerHousings. Could be
    updated to show housing-level stats.

-   Current hen count on housings is manually updated --- not
    automatically decremented when mortality is reported. Ronnie may
    want this automated in future.

-   No scheduled/cron egg email (original Podio flow was daily cron).
    The current implementation sends on submission which Ronnie chose.

**12. Quick Reference**

**12.1 Key People & Emails**

  -----------------------------------------------------------------------
  **Person**      **Role**           **Email**
  --------------- ------------------ ------------------------------------
  Ronnie Jones    Admin / Owner      ronnie@whitecreek.farm

  Mak             Management         mak@whitecreek.farm

  Simon           Farm Team          Simon.rosa3@gmail.com

  Josh            Farm Team          ---

  Jenny           Farm Team          ---

  Isabel          Sonny\'s Farm (egg isabel@sonnysfarm.com
                  report recipient)  

  Brian           Sonny\'s Farm (CC  brian@sonnysfarm.com
                  on egg report)     

  Jessica         Marbella Group (CC jessica@marbellagroup.com
                  on egg report)     
  -----------------------------------------------------------------------

**12.2 Key URLs**

  ------------------------------------------------------------------------------------------
  **Item**           **URL**
  ------------------ -----------------------------------------------------------------------
  Live app           https://wcfplanner.com

  Webforms (public)  https://wcfplanner.com/#webforms

  Netlify dashboard  https://app.netlify.com/teams/ronnie-ipfsd1e

  Supabase dashboard https://supabase.com/dashboard/project/pzfujbjtayhkdlxiblwe

  Supabase edge      https://supabase.com/dashboard/project/pzfujbjtayhkdlxiblwe/functions
  functions          

  Supabase SQL       https://supabase.com/dashboard/project/pzfujbjtayhkdlxiblwe/sql
  editor             

  Resend dashboard   https://resend.com (login with Ronnie\'s account)
  ------------------------------------------------------------------------------------------

**12.3 Common SQL Operations**

Check what\'s in layer_dailys:

SELECT batch_label, feed_type, COUNT(\*) FROM layer_dailys GROUP BY
batch_label, feed_type ORDER BY batch_label;

Restore from backup (example):

INSERT INTO layer_dailys SELECT \* FROM \_backup_layer_dailys WHERE id
NOT IN (SELECT id FROM layer_dailys);

Check housing status:

SELECT h.housing_name, h.status, b.name as batch FROM layer_housings h
JOIN layer_batches b ON h.batch_id = b.id ORDER BY b.name;

**12.4 Webform Config Sync**

After any change to layer groups, layer batches, or layer housings ---
sign out and sign back in. This triggers syncWebformConfig which pushes
the updated housing_batch_map, full_config, and active group lists to
webform_config for the public webform to read.

**13. Closing Notes**

This document was written at the end of an intensive two-day build
session (April 9-11, 2026) in which the WCF Planner was built from
scratch and significantly extended.

The project started with a handover document from a previous Claude
instance. This document supersedes that one and contains everything a
new Claude instance needs to continue the work.

The attached index.html is the complete, current, deployed version of
the application. **Always start a new session by reading this document
AND loading that file into /home/claude/index.html.**

> *Ronnie\'s words at the end of the session: \"It was good working with
> you. See you on the other side.\" --- The feeling is mutual. This is a
> well-designed, thoughtfully built farm management system. Treat it
> with care.*

*--- End of Handover Document ---*
