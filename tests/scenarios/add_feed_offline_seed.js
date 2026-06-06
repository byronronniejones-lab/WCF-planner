// Phase 1C-A scenario for the parent-aware RPC offline queue.
//
// Seeds the minimum webform_config entries AddFeedWebform reads on mount
// so the broiler dropdown has options + "+ Add Another Group" is enabled.
// Mirrors the synchronous Test 9 seed in add_feed_parent_submission.spec.js.
//
// Login-required note: /addfeed is now login-required, so the spec runs inside
// the full authenticated admin app. On boot the admin app loads app_store and
// re-syncs webform_config from the canonical stores (syncWebformConfig +
// buildBroilerPublicMirror in main.jsx). That sync would CLOBBER bare
// webform_config seeds — broiler_groups gets rebuilt from ppp-v4's active
// batches, and webform_settings.allowAddGroup gets rebuilt from
// ppp-webforms-v1. So we seed the canonical source stores too, shaped to
// produce exactly the config the form needs. (Anon never booted the admin
// app, so the old bare seeds survived; under auth they don't.)

const BROILER_GROUPS = ['B-26-01', 'B-26-02'];

// Canonical broiler batch store. buildBroilerPublicMirror filters to
// status==='active' and maps b.name → broiler_groups, so two active batches
// named B-26-01/B-26-02 reproduce BROILER_GROUPS after the admin boot sync.
// schooner is irrelevant to the AddFeed flow (no schooner columns rendered).
const PPPV4 = [
  {name: 'B-26-01', schooner: '1', breed: 'CC', hatchery: 'CREDO FARMS', status: 'active'},
  {name: 'B-26-02', schooner: '1', breed: 'CC', hatchery: 'CREDO FARMS', status: 'active'},
];

// Canonical webforms config. syncWebformConfig rebuilds
// webform_settings.allowAddGroup from (ppp-webforms-v1).webforms[].allowAddGroup
// keyed by webform id, so the add-feed-webform entry must carry
// allowAddGroup:true for the "+ Add Another Group" button to render.
const PPP_WEBFORMS = {
  webforms: [{id: 'add-feed-webform', allowAddGroup: true, sections: []}],
};

export async function seedAddFeedOffline(supabaseAdmin) {
  const {error: e1} = await supabaseAdmin
    .from('webform_config')
    .upsert({key: 'broiler_groups', data: BROILER_GROUPS}, {onConflict: 'key'});
  if (e1) throw new Error(`seedAddFeedOffline: broiler_groups upsert failed: ${e1.message}`);

  // allowAddGroup=true gates the "+ Add Another Group" button on /addfeed
  // for the broiler/pig/layer multi-row paths.
  const {error: e2} = await supabaseAdmin
    .from('webform_config')
    .upsert({key: 'webform_settings', data: {allowAddGroup: {'add-feed-webform': true}}}, {onConflict: 'key'});
  if (e2) throw new Error(`seedAddFeedOffline: webform_settings upsert failed: ${e2.message}`);

  // Canonical source stores so the authenticated admin boot's
  // syncWebformConfig re-derives the same broiler_groups + allowAddGroup
  // instead of clobbering the bare seeds above with empty defaults.
  const {error: e3} = await supabaseAdmin.from('app_store').upsert({key: 'ppp-v4', data: PPPV4}, {onConflict: 'key'});
  if (e3) throw new Error(`seedAddFeedOffline: ppp-v4 upsert failed: ${e3.message}`);

  const {error: e4} = await supabaseAdmin
    .from('app_store')
    .upsert({key: 'ppp-webforms-v1', data: PPP_WEBFORMS}, {onConflict: 'key'});
  if (e4) throw new Error(`seedAddFeedOffline: ppp-webforms-v1 upsert failed: ${e4.message}`);

  return {broilerGroups: BROILER_GROUPS, pppv4: PPPV4, pppWebforms: PPP_WEBFORMS};
}
