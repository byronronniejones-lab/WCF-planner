// Phase 1C-B scenario for the PigDailys offline queue.
//
// Seeds the minimum webform_config entries PigDailysWebform reads on mount:
//   - active_groups: array of pig group names (drives the Pig group dropdown)
//   - team_roster: roster with one active member (so the team-member
//     dropdown has a selectable value)
//
// Mirrors the shape used by add_feed_offline_seed.js + fuel_supply_offline_seed.js.

const PIG_GROUPS = ['P-26-01'];
const ROSTER = [{id: 'tm-bman', name: 'BMAN'}];

export async function seedPigDailysOffline(supabaseAdmin) {
  const r1 = await supabaseAdmin
    .from('webform_config')
    .upsert({key: 'active_groups', data: PIG_GROUPS}, {onConflict: 'key'});
  if (r1.error) throw new Error(`seedPigDailysOffline: active_groups upsert failed: ${r1.error.message}`);

  const r2 = await supabaseAdmin.from('webform_config').upsert({key: 'team_roster', data: ROSTER}, {onConflict: 'key'});
  if (r2.error) throw new Error(`seedPigDailysOffline: team_roster upsert failed: ${r2.error.message}`);

  // Legacy mirror so any unmigrated readers also see BMAN.
  const r3 = await supabaseAdmin
    .from('webform_config')
    .upsert({key: 'team_members', data: ['BMAN']}, {onConflict: 'key'});
  if (r3.error) throw new Error(`seedPigDailysOffline: team_members upsert failed: ${r3.error.message}`);

  return {pigGroups: PIG_GROUPS, roster: ROSTER};
}
