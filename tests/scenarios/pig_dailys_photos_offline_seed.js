// Phase 1D-A scenario for the PigDailys photo offline queue.
//
// Mirrors pig_dailys_offline_seed.js shape with no DB schema changes;
// daily-photos bucket + photos jsonb columns already shipped via mig 030 + 031.

const PIG_GROUPS = ['P-26-01'];

export async function seedPigDailysPhotosOffline(supabaseAdmin) {
  const r1 = await supabaseAdmin
    .from('webform_config')
    .upsert({key: 'active_groups', data: PIG_GROUPS}, {onConflict: 'key'});
  if (r1.error) throw new Error(`seedPigDailysPhotosOffline: active_groups upsert failed: ${r1.error.message}`);

  return {pigGroups: PIG_GROUPS};
}
