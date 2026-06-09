import {useState} from 'react';
import {sb} from '../lib/supabase.js';
import {recordActivityEvent} from '../lib/activityApi.js';
import {todayISO} from '../lib/dateUtils.js';

// Pig.batch mortality workflow (CP7 extraction from PigBatchesView). Owns the
// modal/form/busy/expanded state plus the open/save/delete handlers. This is a
// verbatim lift — behavior, persisted shape (feederGroup.pigMortalities written
// to app_store ppp-feeders-v1 via setFeederGroups + the inline upsert), and the
// mortality audit-log semantics are unchanged. The modal + mortality-log JSX
// stay in PigBatchesView and consume the returned values.
//
// Dependencies are passed in explicitly so the hook stays React-context-free:
//   feederGroups / setFeederGroups — the ppp-feeders-v1 source of truth
//   setNotice                      — shared inline notice
//   authState                      — for the team_member stamp
export function usePigMortality({feederGroups, setFeederGroups, setNotice, authState}) {
  const [mortalityModal, setMortalityModal] = useState(null);
  const [mortalityForm, setMortalityForm] = useState({sub_batch_id: '', count: '', comment: ''});
  const [mortalityBusy, setMortalityBusy] = useState(false);
  const [expandedMortality, setExpandedMortality] = useState(null);

  function openMortalityModal(batchId) {
    setNotice(null);
    setMortalityModal({batchId});
    setMortalityForm({sub_batch_id: '', count: '', comment: ''});
  }

  async function saveMortality() {
    if (!mortalityModal) return;
    setNotice(null);
    const count = parseInt(mortalityForm.count);
    if (!Number.isFinite(count) || count <= 0) {
      setNotice({kind: 'error', message: 'Enter a count of 1 or more.'});
      return;
    }
    setMortalityBusy(true);
    const batchId = mortalityModal.batchId;
    const subId = mortalityForm.sub_batch_id || null;
    const target = feederGroups.find((g) => g.id === batchId);
    const subName = subId ? ((target && target.subBatches) || []).find((s) => s.id === subId)?.name || null : null;
    const entry = {
      id: String(Date.now()) + Math.random().toString(36).slice(2, 6),
      date: todayISO(),
      sub_batch_id: subId,
      sub_batch_name: subName,
      count,
      comment: (mortalityForm.comment || '').trim() || null,
      team_member: (authState && authState.user && authState.user.email) || 'unknown',
      created_at: new Date().toISOString(),
    };
    const nb = feederGroups.map((g) =>
      g.id === batchId ? {...g, pigMortalities: [...(g.pigMortalities || []), entry]} : g,
    );
    setFeederGroups(nb);
    try {
      await sb.from('app_store').upsert({key: 'ppp-feeders-v1', data: nb}, {onConflict: 'key'});
    } catch (e) {
      setNotice({kind: 'error', message: 'Save failed: ' + (e.message || 'unknown')});
      setMortalityBusy(false);
      return;
    }
    // Close the modal + clear busy immediately once the save commits; the
    // audit emit below is best-effort and must not delay the UI.
    setMortalityBusy(false);
    setMortalityModal(null);
    // Best-effort pig.batch Activity (entity_id = group.id = batchId): a new
    // mortality record. Logged only after the upsert succeeds; never blocks.
    try {
      await recordActivityEvent(sb, {
        entityType: 'pig.batch',
        entityId: batchId,
        eventType: 'record.created',
        entityLabel: (target && target.batchName) || batchId,
        body: 'Recorded mortality: ' + count + (subName ? ' in "' + subName + '"' : '') + ' by ' + entry.team_member,
        payload: {
          record: 'pig.mortality',
          batchName: (target && target.batchName) || null,
          mortalityId: entry.id,
          subBatchId: subId,
          subBatchName: subName,
          count,
          comment: entry.comment,
          team_member: entry.team_member,
        },
      });
    } catch (_e) {
      /* best-effort — never block the save */
    }
  }

  async function deleteMortality(batchId, entryId) {
    if (!window._wcfConfirmDelete) return;
    window._wcfConfirmDelete('Delete this mortality entry?', async () => {
      setNotice(null);
      // Snapshot the parent group + the entry being removed BEFORE the filter,
      // so the best-effort Activity payload can describe what was deleted.
      const target = feederGroups.find((g) => g.id === batchId) || null;
      const removed = target ? (target.pigMortalities || []).find((m) => m.id === entryId) || null : null;
      const nb = feederGroups.map((g) =>
        g.id === batchId ? {...g, pigMortalities: (g.pigMortalities || []).filter((m) => m.id !== entryId)} : g,
      );
      setFeederGroups(nb);
      try {
        await sb.from('app_store').upsert({key: 'ppp-feeders-v1', data: nb}, {onConflict: 'key'});
      } catch (e) {
        setNotice({kind: 'error', message: 'Delete failed: ' + (e.message || 'unknown')});
        return;
      }
      // Best-effort pig.batch Activity (entity_id = group.id = batchId): mortality
      // record deleted. Logged only after the upsert succeeds; never blocks.
      try {
        await recordActivityEvent(sb, {
          entityType: 'pig.batch',
          entityId: batchId,
          eventType: 'record.deleted',
          entityLabel: (target && target.batchName) || batchId,
          body:
            'Deleted mortality record' +
            (removed
              ? ': ' +
                (parseInt(removed.count) || 0) +
                (removed.sub_batch_name ? ' in "' + removed.sub_batch_name + '"' : '')
              : ''),
          payload: {
            record: 'pig.mortality',
            batchName: (target && target.batchName) || null,
            mortalityId: entryId,
            subBatchId: removed ? removed.sub_batch_id : null,
            subBatchName: removed ? removed.sub_batch_name : null,
            count: removed ? parseInt(removed.count) || 0 : null,
            comment: removed ? removed.comment : null,
            team_member: removed ? removed.team_member : null,
          },
        });
      } catch (_e) {
        /* best-effort — never block the delete */
      }
    });
  }

  return {
    mortalityModal,
    setMortalityModal,
    mortalityForm,
    setMortalityForm,
    mortalityBusy,
    expandedMortality,
    setExpandedMortality,
    openMortalityModal,
    saveMortality,
    deleteMortality,
  };
}
