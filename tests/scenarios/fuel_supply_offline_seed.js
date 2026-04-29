// Phase 1B canary scenario for the offline submission queue.
//
// Seeds the minimum webform_config entries the FuelSupplyWebform reads on
// mount so the team-member dropdown has a value. The form needs at least
// one team_members row to render a selectable option; without it the
// canary spec can't reach the Submit button.

const TEAM_MEMBERS = ['BMAN', 'BRIAN', 'RONNIE'];

export async function seedFuelSupplyOffline(supabaseAdmin) {
  const {error: e1} = await supabaseAdmin
    .from('webform_config')
    .upsert({key: 'team_members', data: TEAM_MEMBERS}, {onConflict: 'key'});
  if (e1) throw new Error(`seedFuelSupplyOffline: team_members upsert failed: ${e1.message}`);

  // Empty per-form override → form falls back to master list.
  const {error: e2} = await supabaseAdmin
    .from('webform_config')
    .upsert({key: 'per_form_team_members', data: {'fuel-supply': []}}, {onConflict: 'key'});
  if (e2) throw new Error(`seedFuelSupplyOffline: per_form_team_members upsert failed: ${e2.message}`);

  return {teamMembers: TEAM_MEMBERS};
}
