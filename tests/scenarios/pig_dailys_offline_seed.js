// Phase 1C-B scenario for the PigDailys offline queue.
//
// Seeds the minimum webform_config entries PigDailysWebform reads on mount:
//   - active_groups: array of pig group names (drives the Pig group dropdown)
//
// Mirrors the shape used by add_feed_offline_seed.js + fuel_supply_offline_seed.js.

const PIG_GROUPS = ['P-26-01'];

export async function seedPigDailysOffline(supabaseAdmin) {
  const r1 = await supabaseAdmin
    .from('webform_config')
    .upsert({key: 'active_groups', data: PIG_GROUPS}, {onConflict: 'key'});
  if (r1.error) throw new Error(`seedPigDailysOffline: active_groups upsert failed: ${r1.error.message}`);

  return {pigGroups: PIG_GROUPS};
}
