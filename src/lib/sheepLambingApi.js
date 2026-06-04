// Sheep lambing-record delete API. Uses a transactional SECDEF RPC that
// deletes the row and logs a record.deleted Activity event scoped to the dam's
// sheep.animal record in one transaction.

export async function deleteSheepLambingRecord(sb, recordId, teamMember) {
  if (!sb) throw new Error('deleteSheepLambingRecord: sb required');
  const {data, error} = await sb.rpc('delete_sheep_lambing_record', {
    p_record_id: recordId,
    p_team_member: teamMember || null,
  });
  if (error) throw new Error(`deleteSheepLambingRecord: ${error.message || String(error)}`);
  return data;
}
