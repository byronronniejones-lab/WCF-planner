// Phase 1D-B scenario for the WebformHub daily-report photo offline queue.
//
// Seeds the minimum data the in-hub broiler / pig / cattle / sheep daily
// forms need to render submit-able with photos, plus the layer + egg
// minimums for negative-lock tests.

const ROSTER = [{id: 'tm-bman', name: 'BMAN', active: true}];

export async function seedWebformHubDailysPhotosOffline(supabaseAdmin) {
  // Roster (canonical + legacy mirror).
  let r = await supabaseAdmin.from('webform_config').upsert({key: 'team_roster', data: ROSTER}, {onConflict: 'key'});
  if (r.error) throw new Error(`seed: team_roster ${r.error.message}`);
  r = await supabaseAdmin.from('webform_config').upsert({key: 'team_members', data: ['BMAN']}, {onConflict: 'key'});
  if (r.error) throw new Error(`seed: team_members ${r.error.message}`);

  // Broiler groups (drives /webforms/broiler batch dropdown). Two entries
  // so the Add-Group rejection negative-lock test can pick a distinct
  // extra batch.
  r = await supabaseAdmin
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

  return {roster: ROSTER, feedInputs: feedRows};
}
