// Equipment child-log DELETE RPC client wrappers for the AUTHENTICATED record
// page (EquipmentDetail).
//
// These call the transactional SECDEF RPCs added in migration
// 102_equipment_log_delete_activity_rpcs.sql, which replace the last direct
// client hard-deletes of equipment fueling rows / maintenance events:
//   * admin_delete_equipment_fueling — deletes one equipment_fuelings row and
//     logs record.deleted on the equipment.item entity, atomically. (Renamed in
//     migration 104 from delete_equipment_fueling to avoid colliding with the
//     migration-091 owner-scoped delete_equipment_fueling(text).)
//   * delete_equipment_maintenance_event — deletes one
//     equipment_maintenance_events row and logs record.deleted, atomically.
//
// Auth shapes mirror each table's RLS and differ on purpose:
//   * fueling delete requires role in admin/management/farm_team/equipment_tech
//     (migration 092's equipment_fuelings_priv_delete);
//   * maintenance delete requires only an authenticated caller
//     (equipment_maintenance_auth_all, migration 016).
// The fueling current-reading resync stays client-side and runs after success.
//
// Both return the RPC's jsonb result unchanged on success and on business-rule
// results (e.g. {ok:false, reason:'no_fueling'}); on a transport/permission/role
// error they return {ok:false, reason:'rpc_error', error} rather than throwing,
// matching the other delete wrappers.

export async function deleteEquipmentFueling(sb, {fuelingId, entityLabel = null, teamMember = null} = {}) {
  // RPC is admin_delete_equipment_fueling (migration 104) — renamed from the
  // migration-102 delete_equipment_fueling to avoid colliding with the
  // migration-091 owner-scoped delete_equipment_fueling(text).
  const {data, error} = await sb.rpc('admin_delete_equipment_fueling', {
    p_fueling_id: fuelingId,
    p_entity_label: entityLabel,
    p_team_member: teamMember,
  });
  if (error) return {ok: false, reason: 'rpc_error', error: error.message || String(error)};
  return data || {ok: false, reason: 'no_result'};
}

export async function deleteEquipmentMaintenanceEvent(sb, {eventId, entityLabel = null, teamMember = null} = {}) {
  const {data, error} = await sb.rpc('delete_equipment_maintenance_event', {
    p_event_id: eventId,
    p_entity_label: entityLabel,
    p_team_member: teamMember,
  });
  if (error) return {ok: false, reason: 'rpc_error', error: error.message || String(error)};
  return data || {ok: false, reason: 'no_result'};
}
