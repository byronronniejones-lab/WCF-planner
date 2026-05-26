import React from 'react';
import {useNavigate, useLocation} from 'react-router-dom';
// eslint-disable-next-line no-unused-vars -- JSX-only use
import CommentsSection from '../shared/CommentsSection.jsx';
// eslint-disable-next-line no-unused-vars -- JSX-only use
import InlineNotice from '../shared/InlineNotice.jsx';
// eslint-disable-next-line no-unused-vars -- JSX-only use
import RecordActivityLog from '../shared/RecordActivityLog.jsx';
import CattleSendToProcessorModal from '../cattle/CattleSendToProcessorModal.jsx';
import SheepSendToProcessorModal from '../sheep/SheepSendToProcessorModal.jsx';
import {loadCattleWeighInsCached, invalidateCattleWeighInsCache} from '../lib/cattleCache.js';
import {loadSheepWeighInsCached, invalidateSheepWeighInsCache} from '../lib/sheepCache.js';
import {detachCowFromBatch} from '../lib/cattleProcessingBatch.js';
import {detachSheepFromBatch} from '../lib/sheepProcessingBatch.js';
import {runMutation, recordFieldChange, recordStatusChange, recordActivityEvent} from '../lib/entityMutations.js';
import {buildChanges} from '../lib/activityChangeDiff.js';

const HERD_LABELS = {mommas: 'Mommas', backgrounders: 'Backgrounders', finishers: 'Finishers', bulls: 'Bulls'};
const FLOCK_LABELS = {rams: 'Rams', ewes: 'Ewes', feeders: 'Feeders'};
const SPECIES_BACK = {
  cattle: {path: '/cattle/weighins', label: 'Cattle Weigh-Ins'},
  sheep: {path: '/sheep/weighins', label: 'Sheep Weigh-Ins'},
  pig: {path: '/pig/weighins', label: 'Pig Weigh-Ins'},
  broiler: {path: '/broiler/weighins', label: 'Broiler Weigh-Ins'},
};
const inp = {
  fontSize: 12,
  padding: '4px 8px',
  border: '1px solid #d1d5db',
  borderRadius: 5,
  fontFamily: 'inherit',
  boxSizing: 'border-box',
};

function sortEntriesByTagAsc(a, b) {
  const at = a && a.tag,
    bt = b && b.tag;
  if (at == null && bt == null) return (a.entered_at || '').localeCompare(b.entered_at || '');
  if (at == null) return 1;
  if (bt == null) return -1;
  const an = parseFloat(at),
    bn = parseFloat(bt);
  if (Number.isFinite(an) && Number.isFinite(bn) && an !== bn) return an - bn;
  return String(at).localeCompare(String(bt));
}

function adgLbPerDay(priorWt, priorDate, curWt, curDate) {
  if (priorWt == null || curWt == null || !priorDate || !curDate) return null;
  const pd = new Date(priorDate + 'T12:00:00');
  const cd = new Date(curDate + 'T12:00:00');
  const days = Math.round((cd - pd) / 86400000);
  if (!Number.isFinite(days) || days < 1) return null;
  const adg = (parseFloat(curWt) - parseFloat(priorWt)) / days;
  return Number.isFinite(adg) ? adg : null;
}

function findAnimalByPriorTag(priorTag, animals) {
  if (!priorTag) return null;
  const pt = String(priorTag).trim();
  const byCurrent = animals.find((c) => c.tag === pt);
  if (byCurrent) return byCurrent;
  const byImport = animals.find(
    (c) => Array.isArray(c.old_tags) && c.old_tags.some((ot) => ot && ot.tag === pt && ot.source === 'import'),
  );
  if (byImport) return byImport;
  const byWeighIn = animals.find(
    (c) => Array.isArray(c.old_tags) && c.old_tags.some((ot) => ot && ot.tag === pt && ot.source === 'weigh_in'),
  );
  return byWeighIn || null;
}

export default function WeighInSessionPage({sb, fmt, authState, Header}) {
  const navigate = useNavigate();
  const location = useLocation();
  const sessionId = location.pathname.replace('/weigh-in-sessions/', '');

  const [session, setSession] = React.useState(null);
  const [sEntries, setSEntries] = React.useState([]);
  const [animals, setAnimals] = React.useState([]);
  const [allSessions, setAllSessions] = React.useState([]);
  const [allEntries, setAllEntries] = React.useState([]);
  const [loading, setLoading] = React.useState(true);
  const [accessDenied, setAccessDenied] = React.useState(false);
  const [notice, setNotice] = React.useState(null);
  const [entryEdits, setEntryEdits] = React.useState({});
  const [addForm, setAddForm] = React.useState({tag: '', weight: '', note: '', priorTag: ''});
  const [sessionForModal, setSessionForModal] = React.useState(null);

  function invalidateCache() {
    if (session && session.species === 'sheep') invalidateSheepWeighInsCache();
    else invalidateCattleWeighInsCache();
  }

  function canAccessSpecies(species) {
    if (!species) return false;
    if (!authState || authState === false || !authState.profile) return true;
    if (authState.role === 'admin') return true;
    const list = authState.profile.program_access;
    if (!Array.isArray(list) || list.length === 0) return true;
    return list.includes(species);
  }

  async function loadAll() {
    const {data: sess} = await sb
      .from('weigh_in_sessions')
      .select('id, species, herd, date, team_member, status, started_at, completed_at, notes')
      .eq('id', sessionId)
      .single();
    if (sess) setSession(sess);
    const sp = sess ? sess.species : null;
    if (sp !== 'cattle' && sp !== 'sheep') {
      setLoading(false);
      return;
    }
    if (!canAccessSpecies(sp)) {
      setAccessDenied(true);
      setLoading(false);
      return;
    }
    const animalQuery =
      sp === 'cattle' ? sb.from('cattle').select('*').is('deleted_at', null) : sb.from('sheep').select('*');
    const [{data: eData}, aR, sR] = await Promise.all([
      sb.from('weigh_ins').select('*').eq('session_id', sessionId),
      animalQuery,
      sb.from('weigh_in_sessions').select('*').eq('species', sp).order('date', {ascending: false}),
    ]);
    const sorted = (eData || []).sort(sortEntriesByTagAsc);
    setSEntries(sorted);
    const edits = {};
    for (const e of sorted) edits[e.id] = {tag: e.tag || '', weight: String(e.weight ?? ''), note: e.note || ''};
    setEntryEdits(edits);
    if (aR.data) setAnimals(aR.data);
    if (sR.data) setAllSessions(sR.data);
    const allWI = sp === 'cattle' ? await loadCattleWeighInsCached(sb) : await loadSheepWeighInsCached(sb);
    setAllEntries(allWI || []);
    setLoading(false);
  }

  React.useEffect(() => {
    setSession(null);
    setLoading(true);
    setNotice(null);
    setAccessDenied(false);
    loadAll();
  }, [sessionId, authState]);

  React.useEffect(() => {
    if (!loading && location.hash) {
      const anchor = location.hash.slice(1);
      setTimeout(() => {
        const el = document.getElementById(anchor);
        if (el) el.scrollIntoView({behavior: 'smooth', block: 'center'});
      }, 200);
    }
  }, [loading, location.hash]);

  function computePriors() {
    const byTag = {};
    if (!session) return byTag;
    const earlier = allSessions.filter((o) => {
      if (o.id === session.id) return false;
      if (o.status !== 'complete') return false;
      if (o.herd !== session.herd) return false;
      if ((o.date || '') < (session.date || '')) return true;
      if ((o.date || '') === (session.date || '')) return (o.started_at || '') < (session.started_at || '');
      return false;
    });
    const entriesBySession = {};
    for (const e of allEntries) {
      if (!entriesBySession[e.session_id]) entriesBySession[e.session_id] = [];
      entriesBySession[e.session_id].push(e);
    }
    for (const o of earlier) {
      const es = entriesBySession[o.id] || [];
      for (const e of es) {
        if (!e.tag) continue;
        const existing = byTag[e.tag];
        const sd = o.date;
        if (!existing || sd > existing.date) byTag[e.tag] = {weight: parseFloat(e.weight) || 0, date: sd};
      }
    }
    return byTag;
  }

  function sessionLabel() {
    const groupLabels = session.species === 'sheep' ? FLOCK_LABELS : HERD_LABELS;
    const groupKey = session.species === 'sheep' ? session.herd : session.herd;
    return (session.date || '') + ' · ' + (groupLabels[groupKey] || groupKey || session.species);
  }

  async function reopenSession() {
    await runMutation(
      () => sb.from('weigh_in_sessions').update({status: 'draft', completed_at: null}).eq('id', session.id),
      {
        activity: () =>
          recordStatusChange(sb, {
            entityType: 'weighin.session',
            entityId: session.id,
            entityLabel: sessionLabel(),
            from: 'complete',
            to: 'draft',
          }),
      },
    );
    invalidateCache();
    await loadAll();
  }

  async function deleteSession() {
    if (!window._wcfConfirmDelete) return;
    window._wcfConfirmDelete(
      'Delete this weigh-in session and all its entries? Attached cows will be detached and reverted to prior herds where possible.',
      async () => {
        const sessEntries = sEntries.filter((e) => e.target_processing_batch_id);
        const blocked = [];
        for (const e of sessEntries) {
          const cow = e.tag ? animals.find((c) => c.tag === e.tag) : null;
          if (!cow) {
            blocked.push({tag: e.tag || '?', reason: 'no_cow_for_tag'});
            continue;
          }
          const detachFn = session.species === 'sheep' ? detachSheepFromBatch : detachCowFromBatch;
          const r = await detachFn(sb, cow.id, e.target_processing_batch_id, {
            teamMember: authState && authState.name ? authState.name : null,
          });
          if (!r.ok && r.reason !== 'not_in_batch') blocked.push({tag: e.tag || '?', reason: r.reason});
        }
        async function finishDelete() {
          try {
            await recordActivityEvent(sb, {
              entityType: 'weighin.session',
              entityId: session.id,
              eventType: 'record.deleted',
              entityLabel: sessionLabel(),
              body: 'Deleted session with ' + sEntries.length + ' entries',
            });
          } catch (_e) {
            /* best-effort */
          }
          const wis = await sb.from('weigh_ins').select('id').eq('session_id', session.id);
          const wiIds = ((wis && wis.data) || []).map((r) => r.id);
          if (wiIds.length > 0) {
            const commentsTable = session.species === 'sheep' ? 'sheep_comments' : 'cattle_comments';
            try {
              await sb.from(commentsTable).delete().eq('source', 'weigh_in').in('reference_id', wiIds);
            } catch (_e) {
              /* table may not exist on legacy schemas */
            }
          }
          await sb.from('weigh_in_sessions').delete().eq('id', session.id);
          if (session.species === 'sheep') invalidateSheepWeighInsCache();
          else invalidateCattleWeighInsCache();
          navigate(backInfo.path);
        }
        if (blocked.length > 0) {
          const lines = blocked.map((x) => '#' + x.tag + ' (' + x.reason + ')').join(', ');
          window._wcfConfirmDelete('Some cows could not be auto-reverted: ' + lines + '. Delete anyway?', finishDelete);
          return;
        }
        await finishDelete();
      },
    );
  }

  async function completeSession() {
    const canSendToProcessor = session.species === 'sheep' || session.herd === 'finishers';
    if (canSendToProcessor) {
      const flagged = sEntries.filter((e) => e.send_to_processor === true);
      if (flagged.length > 0) {
        setSessionForModal(session);
        return;
      }
    }
    await finalizeComplete();
  }

  async function finalizeComplete() {
    await runMutation(
      () =>
        sb
          .from('weigh_in_sessions')
          .update({status: 'complete', completed_at: new Date().toISOString()})
          .eq('id', session.id),
      {
        activity: () =>
          recordStatusChange(sb, {
            entityType: 'weighin.session',
            entityId: session.id,
            entityLabel: sessionLabel(),
            from: 'draft',
            to: 'complete',
          }),
      },
    );
    invalidateCache();
    await loadAll();
  }

  async function toggleProcessor(e, next) {
    setNotice(null);
    if (!next && e.target_processing_batch_id) {
      const cow = e.tag ? animals.find((c) => c.tag === e.tag) : null;
      if (cow) {
        const detachFn = session.species === 'sheep' ? detachSheepFromBatch : detachCowFromBatch;
        const r = await detachFn(sb, cow.id, e.target_processing_batch_id, {
          teamMember: authState && authState.name ? authState.name : null,
        });
        if (!r.ok && r.reason !== 'not_in_batch') {
          setNotice({
            kind: 'error',
            message:
              'Cannot clear flag for #' +
              (e.tag || '?') +
              ': ' +
              (r.reason === 'no_prior_herd' ? 'no prior herd recorded.' : r.reason),
          });
          return;
        }
      }
    }
    const result = await runMutation(() => sb.from('weigh_ins').update({send_to_processor: !!next}).eq('id', e.id), {
      activity: () =>
        recordActivityEvent(sb, {
          entityType: 'weighin.session',
          entityId: session.id,
          eventType: 'field.updated',
          entityLabel: sessionLabel(),
          body: (next ? 'Flagged' : 'Unflagged') + ' #' + (e.tag || '?') + ' for processor',
        }),
    });
    if (!result.ok) {
      setNotice({kind: 'error', message: 'Could not update: ' + (result.error || 'unknown error')});
      return;
    }
    invalidateCache();
    setSEntries((prev) => prev.map((x) => (x.id === e.id ? {...x, send_to_processor: !!next} : x)));
    if (!next && e.target_processing_batch_id) await loadAll();
  }

  function setEntryField(entryId, field, value) {
    setEntryEdits((prev) => ({...prev, [entryId]: {...(prev[entryId] || {}), [field]: value}}));
  }

  function revertEntry(e) {
    setEntryEdits((prev) => ({
      ...prev,
      [e.id]: {tag: e.tag || '', weight: String(e.weight ?? ''), note: e.note || ''},
    }));
  }

  async function saveEntry(e) {
    const ef = entryEdits[e.id] || {};
    const newTag = (ef.tag || '').trim() || null;
    const newWeight = parseFloat(ef.weight);
    if (!Number.isFinite(newWeight) || newWeight <= 0) return;
    const cowWithTag = newTag ? animals.find((c) => c.tag === newTag) : null;
    const newTagFlag = newTag && !cowWithTag;
    const updates = {tag: newTag, weight: newWeight, note: ef.note || null, new_tag_flag: newTagFlag};
    await runMutation(() => sb.from('weigh_ins').update(updates).eq('id', e.id), {
      activity: () => {
        const changes = buildChanges(e, updates, {
          exclude: [
            'id',
            'session_id',
            'entered_at',
            'reconcile_intent',
            'send_to_processor',
            'target_processing_batch_id',
            'prior_herd_or_flock',
          ],
          labels: {tag: 'Tag', weight: 'Weight', note: 'Note', new_tag_flag: 'New tag'},
        });
        if (changes.length === 0) return;
        return recordFieldChange(sb, {
          entityType: 'weighin.session',
          entityId: session.id,
          entityLabel: sessionLabel(),
          changes,
        });
      },
    });
    invalidateCache();
    await loadAll();
  }

  async function deleteEntry(e) {
    window._wcfConfirmDelete('Delete this weigh-in entry?', async () => {
      async function finish() {
        const {error} = await sb.from('weigh_ins').delete().eq('id', e.id);
        if (!error) {
          try {
            await recordActivityEvent(sb, {
              entityType: 'weighin.session',
              entityId: session.id,
              eventType: 'record.deleted',
              entityLabel: sessionLabel(),
              body: 'Deleted entry #' + (e.tag || '?') + ' (' + (e.weight || '?') + ' lb)',
            });
          } catch (_e) {
            /* best-effort */
          }
        }
        invalidateCache();
        await loadAll();
      }
      if (e.target_processing_batch_id) {
        const cow = e.tag ? animals.find((c) => c.tag === e.tag) : null;
        if (cow) {
          const detachFn2 = session.species === 'sheep' ? detachSheepFromBatch : detachCowFromBatch;
          const r = await detachFn2(sb, cow.id, e.target_processing_batch_id, {
            teamMember: authState && authState.name ? authState.name : null,
          });
          if (!r.ok && r.reason !== 'not_in_batch') {
            window._wcfConfirmDelete(
              '#' + (e.tag || '?') + ' could not be auto-reverted (' + r.reason + '). Delete anyway?',
              finish,
            );
            return;
          }
        }
      }
      await finish();
    });
  }

  async function reconcileNewTag(entry, knownCowId) {
    if (!knownCowId) return;
    const cow = animals.find((c) => c.id === knownCowId);
    if (!cow) return;
    const priorTag = cow.tag;
    const newTag = entry.tag;
    const updatedOldTags = (Array.isArray(cow.old_tags) ? cow.old_tags : []).concat([
      {tag: priorTag, changed_at: new Date().toISOString(), source: 'weigh_in'},
    ]);
    const animalTable = session.species === 'sheep' ? 'sheep' : 'cattle';
    await sb.from(animalTable).update({tag: newTag, old_tags: updatedOldTags}).eq('id', knownCowId);
    await sb.from('weigh_ins').update({new_tag_flag: false}).eq('id', entry.id);
    const commentsTable2 = session.species === 'sheep' ? 'sheep_comments' : 'cattle_comments';
    const idCol = session.species === 'sheep' ? 'sheep_id' : 'cattle_id';
    const tagCol = session.species === 'sheep' ? 'sheep_tag' : 'cattle_tag';
    try {
      await sb
        .from(commentsTable2)
        .update({[idCol]: knownCowId, [tagCol]: newTag})
        .eq('reference_id', entry.id);
    } catch (_e) {
      /* soft-fail */
    }
    try {
      await recordActivityEvent(sb, {
        entityType: 'weighin.session',
        entityId: session.id,
        eventType: 'field.updated',
        entityLabel: sessionLabel(),
        body: 'Reconciled new tag #' + newTag + ' → cow #' + priorTag,
      });
    } catch (_e) {
      /* best-effort */
    }
    invalidateCache();
    await loadAll();
  }

  async function addEntry() {
    setNotice(null);
    const tag = (addForm.tag || '').trim() || null;
    const weight = parseFloat(addForm.weight);
    if (!Number.isFinite(weight) || weight <= 0) return;
    const priorTag = (addForm.priorTag || '').trim();
    if (priorTag) {
      if (!tag) {
        setNotice({kind: 'error', message: 'Enter a New tag # for the swap.'});
        return;
      }
      if (priorTag === tag) {
        setNotice({kind: 'error', message: 'Prior tag and new tag cannot be the same.'});
        return;
      }
      const existingAtNewTag = animals.find((c) => c.tag === tag);
      if (existingAtNewTag) {
        setNotice({kind: 'error', message: 'Tag #' + tag + ' is already assigned to another cow.'});
        return;
      }
      const cow = findAnimalByPriorTag(priorTag, animals);
      if (!cow) {
        setNotice({kind: 'error', message: 'No cow found with prior tag #' + priorTag + '.'});
        return;
      }
      const updatedOldTags = (Array.isArray(cow.old_tags) ? cow.old_tags : []).concat([
        {tag: priorTag, changed_at: new Date().toISOString(), source: 'import'},
      ]);
      const swapTable = session.species === 'sheep' ? 'sheep' : 'cattle';
      const cowUpd = await sb.from(swapTable).update({tag, old_tags: updatedOldTags}).eq('id', cow.id);
      if (cowUpd.error) {
        setNotice({kind: 'error', message: 'Tag swap failed: ' + cowUpd.error.message});
        return;
      }
      const id = String(Date.now()) + Math.random().toString(36).slice(2, 6);
      const {error: insErr} = await sb.from('weigh_ins').insert({
        id,
        session_id: session.id,
        tag,
        weight,
        note: addForm.note || null,
        new_tag_flag: false,
        reconcile_intent: 'retag',
        entered_at: new Date().toISOString(),
      });
      if (insErr) {
        setNotice({kind: 'error', message: 'Add entry failed: ' + insErr.message});
        return;
      }
      try {
        await recordActivityEvent(sb, {
          entityType: 'weighin.session',
          entityId: session.id,
          eventType: 'record.created',
          entityLabel: sessionLabel(),
          body: 'Added entry #' + tag + ' (' + weight + ' lb) — retag from #' + priorTag,
        });
      } catch (_e) {
        /* best-effort */
      }
      invalidateCache();
      setAddForm({tag: '', weight: '', note: '', priorTag: ''});
      await loadAll();
      return;
    }
    const cowWithTag = tag ? animals.find((c) => c.tag === tag) : null;
    const newTagFlag = tag && !cowWithTag;
    const id = String(Date.now()) + Math.random().toString(36).slice(2, 6);
    const {error: insErr2} = await sb.from('weigh_ins').insert({
      id,
      session_id: session.id,
      tag,
      weight,
      note: addForm.note || null,
      new_tag_flag: !!newTagFlag,
      entered_at: new Date().toISOString(),
    });
    if (insErr2) {
      setNotice({kind: 'error', message: 'Add entry failed: ' + insErr2.message});
      return;
    }
    try {
      await recordActivityEvent(sb, {
        entityType: 'weighin.session',
        entityId: session.id,
        eventType: 'record.created',
        entityLabel: sessionLabel(),
        body: 'Added entry' + (tag ? ' #' + tag : '') + ' (' + weight + ' lb)',
      });
    } catch (_e) {
      /* best-effort */
    }
    invalidateCache();
    setAddForm({tag: '', weight: '', note: '', priorTag: ''});
    await loadAll();
  }

  if (loading) {
    return (
      <div style={{minHeight: '100vh', background: '#f1f3f2'}}>
        {Header && <Header />}
        <div style={{padding: 24, textAlign: 'center', color: '#6b7280', fontSize: 14}}>Loading…</div>
      </div>
    );
  }

  if (accessDenied) {
    return (
      <div data-access-denied="1" style={{minHeight: '100vh', background: '#f1f3f2'}}>
        {Header && <Header />}
        <div style={{padding: 24}}>
          <button
            type="button"
            onClick={() => navigate('/')}
            style={{
              background: 'none',
              border: 'none',
              color: '#1d4ed8',
              cursor: 'pointer',
              fontSize: 14,
              fontFamily: 'inherit',
              padding: 0,
            }}
          >
            ← Home
          </button>
          <div style={{marginTop: 16, color: '#6b7280', fontSize: 14}}>You do not have access to this program.</div>
        </div>
      </div>
    );
  }

  if (!session) {
    return (
      <div style={{minHeight: '100vh', background: '#f1f3f2'}}>
        {Header && <Header />}
        <div style={{padding: 24}}>
          <button
            type="button"
            onClick={() => navigate('/')}
            style={{
              background: 'none',
              border: 'none',
              color: '#1d4ed8',
              cursor: 'pointer',
              fontSize: 14,
              fontFamily: 'inherit',
              padding: 0,
            }}
          >
            ← Back to Weigh-Ins
          </button>
          <div style={{marginTop: 16, color: '#6b7280', fontSize: 14}}>Session not found.</div>
        </div>
      </div>
    );
  }

  if (session.species !== 'cattle' && session.species !== 'sheep') {
    const back = SPECIES_BACK[session.species] || {path: '/', label: 'Home'};
    return (
      <div data-unsupported-species="1" style={{minHeight: '100vh', background: '#f1f3f2'}}>
        {Header && <Header />}
        <div style={{padding: 24}}>
          <button
            type="button"
            onClick={() => navigate(back.path)}
            style={{
              background: 'none',
              border: 'none',
              color: '#1d4ed8',
              cursor: 'pointer',
              fontSize: 14,
              fontFamily: 'inherit',
              padding: 0,
            }}
          >
            ← Back to {back.label}
          </button>
          <div style={{marginTop: 16, color: '#6b7280', fontSize: 14}}>
            {session.species.charAt(0).toUpperCase() + session.species.slice(1)} weigh-in session record pages are not
            yet available. Use the {back.label} list view.
          </div>
        </div>
      </div>
    );
  }

  const priors = computePriors();
  const curDate = session.date;
  const adgs = sEntries
    .map((e) => {
      const p = priors[e.tag];
      return p ? adgLbPerDay(p.weight, p.date, e.weight, curDate) : null;
    })
    .filter((a) => a != null);
  const avgAdg = adgs.length > 0 ? adgs.reduce((x, v) => x + v, 0) / adgs.length : null;
  const groupLabelsMap = session.species === 'sheep' ? FLOCK_LABELS : HERD_LABELS;
  const entityLabel = (session.date || '') + ' · ' + (groupLabelsMap[session.herd] || session.herd || session.species);
  const backInfo = SPECIES_BACK[session.species] || {path: '/', label: 'Home'};

  return (
    <div style={{minHeight: '100vh', background: '#f1f3f2'}}>
      {Header && <Header />}
      <div style={{maxWidth: 900, margin: '0 auto', padding: '12px 16px'}}>
        <div style={{marginBottom: 12}}>
          <button
            type="button"
            onClick={() => navigate(backInfo.path)}
            style={{
              background: 'none',
              border: 'none',
              color: '#1d4ed8',
              cursor: 'pointer',
              fontSize: 14,
              fontFamily: 'inherit',
              padding: 0,
              fontWeight: 500,
            }}
          >
            ← Back to {backInfo.label}
          </button>
        </div>

        <div style={{display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginBottom: 12}}>
          <h1 data-record-title="1" style={{fontSize: 24, fontWeight: 700, color: '#111827', margin: 0}}>
            {groupLabelsMap[session.herd] || session.herd} — {fmt(session.date)}
          </h1>
          <span
            style={{
              fontSize: 10,
              fontWeight: 700,
              padding: '2px 8px',
              borderRadius: 10,
              background: session.status === 'complete' ? '#d1fae5' : '#fef3c7',
              color: session.status === 'complete' ? '#065f46' : '#92400e',
              textTransform: 'uppercase',
            }}
          >
            {session.status}
          </span>
          {session.team_member && <span style={{fontSize: 12, color: '#6b7280'}}>{session.team_member}</span>}
          <span style={{fontSize: 12, color: '#6b7280'}}>
            {sEntries.length} {sEntries.length === 1 ? 'entry' : 'entries'}
          </span>
          {avgAdg != null && (
            <span
              title={adgs.length + ' of ' + sEntries.length + ' entries have a prior weigh-in'}
              style={{
                padding: '3px 10px',
                borderRadius: 6,
                background: avgAdg >= 0 ? '#ecfdf5' : '#fef2f2',
                color: avgAdg >= 0 ? '#065f46' : '#b91c1c',
                border: '1px solid ' + (avgAdg >= 0 ? '#a7f3d0' : '#fecaca'),
                fontSize: 11,
                fontWeight: 700,
              }}
            >
              {'avg ADG ' +
                (avgAdg >= 0 ? '+' : '') +
                avgAdg.toFixed(2) +
                ' lb/d (' +
                adgs.length +
                '/' +
                sEntries.length +
                ')'}
            </span>
          )}
        </div>

        {notice && <InlineNotice kind={notice.kind} message={notice.message} onDismiss={() => setNotice(null)} />}

        <div style={{display: 'flex', gap: 8, marginBottom: 12, flexWrap: 'wrap'}}>
          {session.status === 'draft' && (
            <button
              onClick={completeSession}
              style={{
                padding: '6px 14px',
                borderRadius: 6,
                border: '1px solid #047857',
                background: '#047857',
                color: 'white',
                fontSize: 12,
                fontWeight: 600,
                cursor: 'pointer',
                fontFamily: 'inherit',
              }}
            >
              ✓ Complete Session
            </button>
          )}
          {session.status === 'complete' && (
            <button
              onClick={reopenSession}
              style={{
                padding: '6px 14px',
                borderRadius: 6,
                border: '1px solid #d1d5db',
                background: 'white',
                color: '#1d4ed8',
                fontSize: 12,
                cursor: 'pointer',
                fontFamily: 'inherit',
              }}
            >
              Reopen Session
            </button>
          )}
          <button
            onClick={deleteSession}
            style={{
              padding: '6px 14px',
              borderRadius: 6,
              border: '1px solid #fca5a5',
              background: 'white',
              color: '#b91c1c',
              fontSize: 12,
              cursor: 'pointer',
              fontFamily: 'inherit',
            }}
          >
            Delete Session
          </button>
        </div>

        <div
          data-weighin-entries="1"
          style={{background: 'white', border: '1px solid #e5e7eb', borderRadius: 10, padding: '14px 18px'}}
        >
          {sEntries.length === 0 && (
            <div style={{fontSize: 12, color: '#9ca3af', fontStyle: 'italic', marginBottom: 8}}>No entries yet.</div>
          )}
          {sEntries.length > 0 && (
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))',
                gap: 6,
                marginBottom: 8,
              }}
            >
              {sEntries.map((e) => {
                const cow = animals.find((c) => c.tag === e.tag);
                const ef = entryEdits[e.id] || {tag: e.tag || '', weight: String(e.weight ?? ''), note: e.note || ''};
                const prior = priors[e.tag];
                const adg = prior ? adgLbPerDay(prior.weight, prior.date, e.weight, curDate) : null;
                return (
                  <div
                    key={e.id}
                    style={{
                      background: e.send_to_processor ? '#fef2f2' : 'white',
                      border: '1px solid ' + (e.send_to_processor ? '#fca5a5' : e.new_tag_flag ? '#fca5a5' : '#e5e7eb'),
                      borderRadius: 6,
                      padding: '6px 10px',
                      fontSize: 12,
                    }}
                  >
                    <div style={{display: 'flex', flexDirection: 'column', gap: 4}}>
                      <div style={{display: 'flex', gap: 4, alignItems: 'center'}}>
                        <input
                          type="text"
                          placeholder="Tag #"
                          value={ef.tag}
                          onChange={(ev) => setEntryField(e.id, 'tag', ev.target.value)}
                          style={{...inp, flex: '0 0 80px', minWidth: 0}}
                        />
                        <input
                          type="number"
                          min="0"
                          step="0.1"
                          placeholder="lb"
                          value={ef.weight}
                          onChange={(ev) => setEntryField(e.id, 'weight', ev.target.value)}
                          style={{...inp, flex: '0 0 70px', minWidth: 0}}
                        />
                        <input
                          type="text"
                          placeholder="Note"
                          value={ef.note}
                          onChange={(ev) => setEntryField(e.id, 'note', ev.target.value)}
                          style={{...inp, flex: 1, minWidth: 60}}
                        />
                      </div>
                      <div style={{display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap'}}>
                        {prior && (
                          <span style={{fontSize: 10, color: '#6b7280'}} title={'prior ' + prior.date}>
                            {'prior ' + Math.round(prior.weight) + ' lb'}
                          </span>
                        )}
                        {adg != null && (
                          <span
                            style={{
                              fontSize: 10,
                              fontWeight: 700,
                              padding: '1px 6px',
                              borderRadius: 4,
                              background: adg >= 0 ? '#ecfdf5' : '#fef2f2',
                              color: adg >= 0 ? '#065f46' : '#b91c1c',
                              border: '1px solid ' + (adg >= 0 ? '#a7f3d0' : '#fecaca'),
                            }}
                          >
                            {(adg >= 0 ? '+' : '') + adg.toFixed(2) + ' lb/d'}
                          </span>
                        )}
                        {e.new_tag_flag && (
                          <span
                            style={{
                              fontSize: 10,
                              fontWeight: 700,
                              padding: '1px 6px',
                              borderRadius: 4,
                              background: '#fef2f2',
                              color: '#b91c1c',
                            }}
                          >
                            NEW TAG
                          </span>
                        )}
                        {!e.new_tag_flag && cow && (
                          <span style={{fontSize: 11, color: '#6b7280'}}>
                            {groupLabelsMap[cow.herd || cow.flock] || cow.herd || cow.flock}
                          </span>
                        )}
                        <span style={{fontSize: 10, color: '#9ca3af', marginLeft: 'auto'}}>
                          {(e.entered_at || '').slice(11, 16)}
                        </span>
                      </div>
                      {e.new_tag_flag && (
                        <select
                          onChange={(ev) => {
                            if (ev.target.value) reconcileNewTag(e, ev.target.value);
                          }}
                          defaultValue=""
                          style={{
                            fontSize: 11,
                            padding: '3px 6px',
                            border: '1px solid #d1d5db',
                            borderRadius: 4,
                            fontFamily: 'inherit',
                            width: '100%',
                          }}
                        >
                          <option value="">Reconcile to known cow...</option>
                          {animals
                            .filter((c) => c.tag)
                            .sort((a, b) => (parseFloat(a.tag) || 0) - (parseFloat(b.tag) || 0))
                            .map((c) => (
                              <option key={c.id} value={c.id}>
                                {'#' + c.tag + ' (' + (c.herd || c.flock || '?') + ')'}
                              </option>
                            ))}
                        </select>
                      )}
                      <div
                        style={{
                          display: 'flex',
                          gap: 4,
                          justifyContent: 'flex-end',
                          alignItems: 'center',
                          flexWrap: 'wrap',
                        }}
                      >
                        {(session.species === 'sheep' || session.herd === 'finishers') &&
                          session.status === 'draft' && (
                            <button
                              onClick={() => toggleProcessor(e, !e.send_to_processor)}
                              style={{
                                fontSize: 10,
                                fontWeight: 700,
                                padding: '3px 8px',
                                borderRadius: 4,
                                border: '1px solid ' + (e.send_to_processor ? '#991b1b' : '#d1d5db'),
                                background: e.send_to_processor ? '#991b1b' : 'white',
                                color: e.send_to_processor ? 'white' : '#6b7280',
                                cursor: 'pointer',
                                fontFamily: 'inherit',
                              }}
                            >
                              {e.send_to_processor ? '✓ Processor' : '→ Processor'}
                            </button>
                          )}
                        {(session.species === 'sheep' || session.herd === 'finishers') &&
                          session.status !== 'draft' &&
                          e.send_to_processor && (
                            <span
                              style={{
                                fontSize: 10,
                                fontWeight: 700,
                                padding: '3px 8px',
                                borderRadius: 4,
                                background: '#991b1b',
                                color: 'white',
                              }}
                            >
                              ✓ Processor
                            </span>
                          )}
                        <button
                          onClick={() => revertEntry(e)}
                          style={{
                            fontSize: 10,
                            color: '#6b7280',
                            background: 'none',
                            border: 'none',
                            cursor: 'pointer',
                            padding: '2px 6px',
                            fontFamily: 'inherit',
                          }}
                        >
                          Revert
                        </button>
                        <button
                          onClick={() => saveEntry(e)}
                          disabled={!(parseFloat(ef.weight) > 0)}
                          style={{
                            fontSize: 10,
                            fontWeight: 600,
                            color: 'white',
                            background: parseFloat(ef.weight) > 0 ? '#1e40af' : '#d1d5db',
                            border: 'none',
                            borderRadius: 4,
                            cursor: parseFloat(ef.weight) > 0 ? 'pointer' : 'not-allowed',
                            padding: '3px 8px',
                            fontFamily: 'inherit',
                          }}
                        >
                          Save
                        </button>
                        <button
                          onClick={() => deleteEntry(e)}
                          style={{
                            fontSize: 10,
                            color: '#b91c1c',
                            background: 'none',
                            border: 'none',
                            cursor: 'pointer',
                            padding: '2px 6px',
                            fontFamily: 'inherit',
                          }}
                        >
                          Delete
                        </button>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          <div
            style={{
              marginTop: 8,
              background: '#eff6ff',
              border: '1px dashed #bfdbfe',
              borderRadius: 6,
              padding: '8px 10px',
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              flexWrap: 'wrap',
            }}
          >
            <span style={{fontSize: 11, fontWeight: 600, color: '#1e40af'}}>+ Add entry:</span>
            <input
              type="text"
              placeholder="Prior tag (swap)"
              value={addForm.priorTag}
              onChange={(ev) => setAddForm((f) => ({...f, priorTag: ev.target.value}))}
              style={{...inp, width: 130, background: addForm.priorTag ? '#dbeafe' : 'white'}}
            />
            <input
              type="text"
              placeholder={addForm.priorTag ? 'New tag #' : 'Tag #'}
              value={addForm.tag}
              onChange={(ev) => setAddForm((f) => ({...f, tag: ev.target.value}))}
              style={{...inp, width: 90}}
            />
            <input
              type="number"
              min="0"
              step="0.1"
              placeholder="lb"
              value={addForm.weight}
              onChange={(ev) => setAddForm((f) => ({...f, weight: ev.target.value}))}
              style={{...inp, width: 70}}
            />
            <input
              type="text"
              placeholder="Note"
              value={addForm.note}
              onChange={(ev) => setAddForm((f) => ({...f, note: ev.target.value}))}
              style={{...inp, flex: 1, minWidth: 100}}
            />
            <button
              onClick={addEntry}
              disabled={!(parseFloat(addForm.weight) > 0)}
              style={{
                padding: '4px 12px',
                borderRadius: 5,
                border: 'none',
                background: parseFloat(addForm.weight) > 0 ? '#1e40af' : '#d1d5db',
                color: 'white',
                fontSize: 11,
                fontWeight: 600,
                cursor: parseFloat(addForm.weight) > 0 ? 'pointer' : 'not-allowed',
                fontFamily: 'inherit',
              }}
            >
              {addForm.priorTag ? 'Swap + Add' : 'Add'}
            </button>
          </div>
        </div>

        <div style={{marginTop: 16}}>
          <CommentsSection
            sb={sb}
            authState={authState}
            entityType="weighin.session"
            entityId={session.id}
            entityLabel={entityLabel}
          />
        </div>

        <div style={{marginTop: 16}}>
          <RecordActivityLog sb={sb} entityType="weighin.session" entityId={session.id} />
        </div>
      </div>

      {sessionForModal &&
        session.species === 'sheep' &&
        React.createElement(SheepSendToProcessorModal, {
          sb,
          session: sessionForModal,
          flaggedEntries: sEntries.filter((e) => e.send_to_processor === true),
          sheepList: animals,
          teamMember: (authState && authState.name) || null,
          onCancel: () => setSessionForModal(null),
          onConfirmed: async () => {
            setSessionForModal(null);
            await finalizeComplete();
          },
        })}
      {sessionForModal &&
        session.species !== 'sheep' &&
        React.createElement(CattleSendToProcessorModal, {
          sb,
          session: sessionForModal,
          flaggedEntries: sEntries.filter((e) => e.send_to_processor === true),
          cattleList: animals,
          weighIns: allEntries,
          teamMember: (authState && authState.name) || null,
          authState,
          onCancel: () => setSessionForModal(null),
          onConfirmed: async () => {
            setSessionForModal(null);
            await finalizeComplete();
          },
        })}
    </div>
  );
}
