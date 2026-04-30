// Phase 1C-D scenario for the WeighIns RPC offline queue.
//
// Seeds the minimum webform_config + app_store entries WeighInsWebform reads
// when the operator picks pig or broiler:
//   - active_groups          : pig batches (filtered by component to skip SOWS/BOARS)
//   - broiler_groups         : broiler batch labels
//   - broiler_batch_meta     : public schooner mirror — Array<{name, schooners[]}>
//                              (the public form's column-label source)
//   - app_store/ppp-v4       : full broiler batch records (admin-side weigh-ins
//                              view still reads this; not consulted by the
//                              public form post-hotfix)
//   - team_roster + legacy   : roster so the team-member dropdown has BMAN
//
// Mirrors add_feed_offline_seed.js + pig_dailys_offline_seed.js shapes.

const PIG_GROUPS = ['P-26-01'];
const BROILER_GROUPS = ['B-26-01'];
const ROSTER = [{id: 'tm-bman', name: 'BMAN'}];

// The grid renders one column per schooner, so we provide a 2-schooner record.
// Public form reads the parsed shape from broiler_batch_meta below; ppp-v4
// retains the raw '&'-joined string for admin parity.
const BROILER_BATCH_META = [{name: 'B-26-01', schooners: ['A', 'B']}];

const PPPV4 = [
  {
    name: 'B-26-01',
    schooner: 'A & B',
    breed: 'CC',
    hatchery: 'CREDO FARMS',
    status: 'active',
  },
];

export async function seedWeighInsOffline(supabaseAdmin) {
  const r1 = await supabaseAdmin
    .from('webform_config')
    .upsert({key: 'active_groups', data: PIG_GROUPS}, {onConflict: 'key'});
  if (r1.error) throw new Error(`seedWeighInsOffline: active_groups upsert failed: ${r1.error.message}`);

  const r2 = await supabaseAdmin
    .from('webform_config')
    .upsert({key: 'broiler_groups', data: BROILER_GROUPS}, {onConflict: 'key'});
  if (r2.error) throw new Error(`seedWeighInsOffline: broiler_groups upsert failed: ${r2.error.message}`);

  const rMeta = await supabaseAdmin
    .from('webform_config')
    .upsert({key: 'broiler_batch_meta', data: BROILER_BATCH_META}, {onConflict: 'key'});
  if (rMeta.error) throw new Error(`seedWeighInsOffline: broiler_batch_meta upsert failed: ${rMeta.error.message}`);

  const r3 = await supabaseAdmin.from('webform_config').upsert({key: 'team_roster', data: ROSTER}, {onConflict: 'key'});
  if (r3.error) throw new Error(`seedWeighInsOffline: team_roster upsert failed: ${r3.error.message}`);

  // Legacy mirror so any unmigrated readers see BMAN too.
  const r4 = await supabaseAdmin
    .from('webform_config')
    .upsert({key: 'team_members', data: ['BMAN']}, {onConflict: 'key'});
  if (r4.error) throw new Error(`seedWeighInsOffline: team_members upsert failed: ${r4.error.message}`);

  // Broiler batch full record (admin-side weigh-ins view still reads ppp-v4).
  const r5 = await supabaseAdmin.from('app_store').upsert({key: 'ppp-v4', data: PPPV4}, {onConflict: 'key'});
  if (r5.error) throw new Error(`seedWeighInsOffline: ppp-v4 upsert failed: ${r5.error.message}`);

  return {
    pigGroups: PIG_GROUPS,
    broilerGroups: BROILER_GROUPS,
    broilerBatchMeta: BROILER_BATCH_META,
    roster: ROSTER,
    pppv4: PPPV4,
  };
}
