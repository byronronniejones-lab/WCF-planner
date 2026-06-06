// Phase 1D-B scenario for the WebformHub daily-report photo offline queue.
//
// Seeds the minimum data the in-hub broiler / pig / cattle / sheep daily
// forms need to render submit-able with photos, plus the layer + egg
// minimums for negative-lock tests.
//
// Login-required note: /webforms/<slug> is now login-required, so the spec
// runs inside the full authenticated admin app. On boot the admin app re-syncs
// webform_config from the canonical app_store stores (main.jsx
// buildBroilerPublicMirror + syncWebformConfig). That sync CLOBBERS bare
// webform_config seeds with values derived from app_store — broiler_groups is
// rebuilt from ppp-v4's active batches (clobbered EARLY, before the form's own
// mount read can win the race), and webform_settings.allowAddGroup is rebuilt
// from ppp-webforms-v1.webforms[].allowAddGroup. So we seed those canonical
// source stores too, shaped to reproduce exactly the config below. (Anon never
// booted the admin app, so the old bare seeds survived; under auth they don't.)

// Canonical broiler batch store. buildBroilerPublicMirror filters to
// status==='active' and maps b.name → broiler_groups, reproducing the two
// bare broiler_groups entries after the admin boot sync.
const PPPV4 = [
  {name: 'B-26-01', schooner: '1', breed: 'CC', hatchery: 'CREDO FARMS', status: 'active'},
  {name: 'B-26-02', schooner: '1', breed: 'CC', hatchery: 'CREDO FARMS', status: 'active'},
];

// Canonical webforms config. syncWebformConfig rebuilds
// webform_settings.allowAddGroup from (ppp-webforms-v1).webforms[].allowAddGroup
// keyed by webform id, so these ids must carry allowAddGroup:true to match the
// bare webform_settings seed and keep the "+ Add Another Group" button armed.
const PPP_WEBFORMS = {
  webforms: [
    {id: 'broiler-dailys', allowAddGroup: true, sections: []},
    {id: 'pig-dailys', allowAddGroup: true, sections: []},
    {id: 'layer-dailys', allowAddGroup: true, sections: []},
  ],
};

// Canonical pig feeder store. activePigFeederDailyTargets pulls the active
// sub-batches of active feeder groups, and syncWebformConfig folds those names
// into active_groups on the authenticated admin boot. Without this, the boot
// clobbers the bare active_groups seed below down to SOWS/BOARS and the pig
// batch dropdown loses P-26-01/P-26-02 (a race the bare seed loses).
const PPP_FEEDERS = [
  {
    id: 'fg-26-1d-b',
    batchName: 'FG-26',
    status: 'active',
    giltCount: 0,
    boarCount: 0,
    subBatches: [
      {id: 'sb-p-26-01', name: 'P-26-01', status: 'active', giltCount: 0, boarCount: 0},
      {id: 'sb-p-26-02', name: 'P-26-02', status: 'active', giltCount: 0, boarCount: 0},
    ],
  },
];

export async function seedWebformHubDailysPhotosOffline(supabaseAdmin) {
  // Broiler groups (drives /webforms/broiler batch dropdown). Two entries
  // so the Add-Group rejection negative-lock test can pick a distinct
  // extra batch.
  let r = await supabaseAdmin
    .from('webform_config')
    .upsert({key: 'broiler_groups', data: ['B-26-01', 'B-26-02']}, {onConflict: 'key'});
  if (r.error) throw new Error(`seed: broiler_groups ${r.error.message}`);

  // Pig active groups (drives /webforms/pig batch dropdown).
  r = await supabaseAdmin
    .from('webform_config')
    .upsert({key: 'active_groups', data: ['P-26-01', 'P-26-02']}, {onConflict: 'key'});
  if (r.error) throw new Error(`seed: active_groups ${r.error.message}`);

  // Enable Add-Group for broiler/pig/layer so the rejection negative-lock
  // can actually exercise the multi-row branch.
  r = await supabaseAdmin.from('webform_config').upsert(
    {
      key: 'webform_settings',
      data: {
        allowAddGroup: {
          'broiler-dailys': true,
          'pig-dailys': true,
          'layer-dailys': true,
        },
      },
    },
    {onConflict: 'key'},
  );
  if (r.error) throw new Error(`seed: webform_settings ${r.error.message}`);

  // Canonical source stores so the authenticated admin boot's
  // buildBroilerPublicMirror + syncWebformConfig re-derive the same
  // broiler_groups + allowAddGroup instead of clobbering the bare seeds above.
  r = await supabaseAdmin.from('app_store').upsert({key: 'ppp-v4', data: PPPV4}, {onConflict: 'key'});
  if (r.error) throw new Error(`seed: ppp-v4 ${r.error.message}`);

  r = await supabaseAdmin.from('app_store').upsert({key: 'ppp-webforms-v1', data: PPP_WEBFORMS}, {onConflict: 'key'});
  if (r.error) throw new Error(`seed: ppp-webforms-v1 ${r.error.message}`);

  // Canonical pig feeder store so the admin boot's syncWebformConfig re-derives
  // active_groups (SOWS/BOARS + the P-26-01/P-26-02 daily targets) instead of
  // clobbering the bare active_groups seed above down to just SOWS/BOARS.
  r = await supabaseAdmin.from('app_store').upsert({key: 'ppp-feeders-v1', data: PPP_FEEDERS}, {onConflict: 'key'});
  if (r.error) throw new Error(`seed: ppp-feeders-v1 ${r.error.message}`);

  // Cattle/sheep feed inputs — needed for the feeds + minerals pickers.
  // Only one feed + one mineral; the form layer composes nutrition snapshot
  // from these, then passes pre-built feedsJ/mineralsJ to the hook.
  const feedRows = [
    {
      id: 'fi-alfalfa-1d-b',
      name: 'Alfalfa hay',
      category: 'hay',
      unit: 'bale',
      unit_weight_lbs: 50,
      moisture_pct: 12,
      nfc_pct: 30,
      protein_pct: 18,
      status: 'active',
      herd_scope: ['all'],
    },
    {
      id: 'fi-salt-1d-b',
      name: 'Salt block',
      category: 'mineral',
      unit: 'lb',
      unit_weight_lbs: 1,
      moisture_pct: 0,
      nfc_pct: 0,
      protein_pct: 0,
      status: 'active',
      herd_scope: ['all'],
    },
  ];
  for (const f of feedRows) {
    const ins = await supabaseAdmin.from('cattle_feed_inputs').upsert(f, {onConflict: 'id'});
    if (ins.error) throw new Error(`seed: cattle_feed_inputs ${f.id} ${ins.error.message}`);
  }

  return {feedInputs: feedRows};
}
