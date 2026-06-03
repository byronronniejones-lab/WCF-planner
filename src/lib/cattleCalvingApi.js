// Cattle calving-record delete API. Uses a transactional SECDEF RPC that
// deletes the row and logs a record.deleted Activity event (scoped to the
// dam's cattle.animal record) in one transaction — no bare client delete.

export async function deleteCattleCalvingRecord(sb, recordId, teamMember) {
  if (!sb) throw new Error('deleteCattleCalvingRecord: sb required');
  const {data, error} = await sb.rpc('delete_cattle_calving_record', {
    p_record_id: recordId,
    p_team_member: teamMember || null,
  });
  if (error) throw new Error(`deleteCattleCalvingRecord: ${error.message || String(error)}`);
  return data;
}
