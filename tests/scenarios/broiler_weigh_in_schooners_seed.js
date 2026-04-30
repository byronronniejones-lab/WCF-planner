// Schooner-mapping hotfix scenario for the public broiler weigh-in form.
//
// Seeds three ACTIVE broiler batches in webform_config so the public form
// can exercise:
//   - Two-schooner batch (B-26-01, schooner '2&3' → headers "Schooner 2" + "Schooner 3")
//   - One-schooner batch (B-26-02, schooner '1'   → header  "Schooner 1")
//   - Zero-schooner active batch (B-26-03, schooner '' → admin misconfig
//     on an active batch; Start Session blocks with explicit error)
//
// All three are status='active'. The buildBroilerPublicMirror helper
// filters to active-only (per the 2026-04-30 follow-up after a planned
// batch surfaced in the public dropdown post-rollout). Empty-schooner
// handling stays — but only for active batches with missing schooners.
//
// Schooner-string convention: per src/lib/broiler.js SCHOONERS the canonical
// values are bare numbers joined by '&' (no spaces) — e.g. '2&3'. The grid
// renders headers as 'Schooner ' + label, and saveBatch writes the bare
// label into weigh_ins.tag so admin's hydrateGrid (e.tag === label) matches.
//
// app_store.ppp-v4 is seeded with matching schooner strings so the
// admin-side LivestockWeighInsView hydration test (T5) works against the
// canonical batch store. The public form does NOT consult app_store —
// its independence is proven via network + static locks in the spec.

const BROILER_GROUPS = ['B-26-01', 'B-26-02', 'B-26-03'];

const BROILER_BATCH_META = [
  {name: 'B-26-01', schooners: ['2', '3']},
  {name: 'B-26-02', schooners: ['1']},
  {name: 'B-26-03', schooners: []},
];

const PPPV4 = [
  {
    name: 'B-26-01',
    schooner: '2&3',
    breed: 'CC',
    hatchery: 'CREDO FARMS',
    status: 'active',
  },
  {
    name: 'B-26-02',
    schooner: '1',
    breed: 'CC',
    hatchery: 'CREDO FARMS',
    status: 'active',
  },
  {
    name: 'B-26-03',
    schooner: '',
    breed: 'CC',
    hatchery: 'CREDO FARMS',
    status: 'active',
  },
];

const ROSTER = [{id: 'tm-bman', name: 'BMAN'}];

export async function seedBroilerWeighInSchooners(supabaseAdmin) {
  let r = await supabaseAdmin
    .from('webform_config')
    .upsert({key: 'broiler_groups', data: BROILER_GROUPS}, {onConflict: 'key'});
  if (r.error) throw new Error(`seedBroilerWeighInSchooners: broiler_groups upsert failed: ${r.error.message}`);

  r = await supabaseAdmin
    .from('webform_config')
    .upsert({key: 'broiler_batch_meta', data: BROILER_BATCH_META}, {onConflict: 'key'});
  if (r.error) throw new Error(`seedBroilerWeighInSchooners: broiler_batch_meta upsert failed: ${r.error.message}`);

  r = await supabaseAdmin.from('webform_config').upsert({key: 'team_roster', data: ROSTER}, {onConflict: 'key'});
  if (r.error) throw new Error(`seedBroilerWeighInSchooners: team_roster upsert failed: ${r.error.message}`);

  r = await supabaseAdmin.from('webform_config').upsert({key: 'team_members', data: ['BMAN']}, {onConflict: 'key'});
  if (r.error) throw new Error(`seedBroilerWeighInSchooners: team_members upsert failed: ${r.error.message}`);

  r = await supabaseAdmin.from('app_store').upsert({key: 'ppp-v4', data: PPPV4}, {onConflict: 'key'});
  if (r.error) throw new Error(`seedBroilerWeighInSchooners: ppp-v4 upsert failed: ${r.error.message}`);

  return {
    broilerGroups: BROILER_GROUPS,
    broilerBatchMeta: BROILER_BATCH_META,
    pppv4: PPPV4,
    roster: ROSTER,
  };
}
