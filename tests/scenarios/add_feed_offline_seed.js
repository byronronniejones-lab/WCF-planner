// Phase 1C-A scenario for the parent-aware RPC offline queue.
//
// Seeds the minimum webform_config entries AddFeedWebform reads on mount
// so the broiler dropdown has options + "+ Add Another Group" is enabled.
// Mirrors the synchronous Test 9 seed in add_feed_parent_submission.spec.js.

const BROILER_GROUPS = ['B-26-01', 'B-26-02'];

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

  return {broilerGroups: BROILER_GROUPS};
}
