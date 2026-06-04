// Cattle breeding-cycle API. Create/update/delete goes through SECDEF RPCs
// that mutate cattle_breeding_cycles and log cattle.breeding Activity in one
// transaction.

export async function upsertCattleBreedingCycle(sb, cycle) {
  if (!sb) throw new Error('upsertCattleBreedingCycle: sb required');
  const {data, error} = await sb.rpc('upsert_cattle_breeding_cycle', {
    p_cycle_id: cycle?.id || null,
    p_herd: cycle?.herd || 'mommas',
    p_bull_exposure_start: cycle?.bull_exposure_start || null,
    p_bull_tags: cycle?.bull_tags || null,
    p_cow_tags: cycle?.cow_tags || null,
    p_notes: cycle?.notes || null,
  });
  if (error) throw new Error(`upsertCattleBreedingCycle: ${error.message || String(error)}`);
  return data;
}

export async function deleteCattleBreedingCycle(sb, cycleId) {
  if (!sb) throw new Error('deleteCattleBreedingCycle: sb required');
  const {data, error} = await sb.rpc('delete_cattle_breeding_cycle', {
    p_cycle_id: cycleId,
  });
  if (error) throw new Error(`deleteCattleBreedingCycle: ${error.message || String(error)}`);
  return data;
}
