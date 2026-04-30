// Phase 1D-A scenario for the PigDailys photo offline queue.
//
// Mirrors pig_dailys_offline_seed.js shape with no DB schema changes;
// daily-photos bucket + photos jsonb columns already shipped via mig 030 + 031.

const PIG_GROUPS = ['P-26-01'];
const ROSTER = [{id: 'tm-bman', name: 'BMAN', active: true}];

export async function seedPigDailysPhotosOffline(supabaseAdmin) {
  const r1 = await supabaseAdmin
    .from('webform_config')
    .upsert({key: 'active_groups', data: PIG_GROUPS}, {onConflict: 'key'});
  if (r1.error) throw new Error(`seedPigDailysPhotosOffline: active_groups upsert failed: ${r1.error.message}`);

  const r2 = await supabaseAdmin.from('webform_config').upsert({key: 'team_roster', data: ROSTER}, {onConflict: 'key'});
  if (r2.error) throw new Error(`seedPigDailysPhotosOffline: team_roster upsert failed: ${r2.error.message}`);

  const r3 = await supabaseAdmin
    .from('webform_config')
    .upsert({key: 'team_members', data: ['BMAN']}, {onConflict: 'key'});
  if (r3.error) throw new Error(`seedPigDailysPhotosOffline: team_members upsert failed: ${r3.error.message}`);

  return {pigGroups: PIG_GROUPS, roster: ROSTER};
}
