// ============================================================================
// LivestockWeighInsView — Phase 2.3.6 (recovered from Round-1 bundling bug)
// ============================================================================
// Verbatim byte-for-byte. This view + AdminNewWeighInModal originally sat
// adjacent in main.jsx and the Round-1 anchor extracted both into the same
// file by accident; this commit splits them.
// ============================================================================
import React from 'react';
import AdminNewWeighInModal from '../shared/AdminNewWeighInModal.jsx';
import UsersModal from '../auth/UsersModal.jsx';
import { writeBroilerBatchAvg } from '../lib/broiler.js';
import PigSendToTripModal from './PigSendToTripModal.jsx';
const LivestockWeighInsView = ({sb, fmt, Header, authState, setView, showUsers, setShowUsers, allUsers, setAllUsers, loadUsers, species}) => {
  const {useState, useEffect} = React;
  const [sessions, setSessions] = useState([]);
  const [entries, setEntries] = useState({}); // session_id -> [entries]
  const [loading, setLoading] = useState(true);
  const [expandedSession, setExpandedSession] = useState(null);
  const [statusFilter, setStatusFilter] = useState('all');
  const [broilerBatchRecs, setBroilerBatchRecs] = useState([]);
  const [showNewModal, setShowNewModal] = useState(false);
  // Per-expanded-tile grid editing state. Only one tile is expanded at a time.
  const [gridLabels, setGridLabels] = useState([]);   // ['2','3'] for broiler etc.
  const [gridInputs, setGridInputs] = useState([]);   // weight strings, length = labels*15
  const [gridUnlocked, setGridUnlocked] = useState(false); // false locks fields on complete
  const [gridNote, setGridNote] = useState('');
  const [savingGrid, setSavingGrid] = useState(false);
  const [gridErr, setGridErr] = useState('');
  // Pig send-to-trip state (no-op for broilers)
  const [feederGroups, setFeederGroups] = useState([]);
  const [selectedEntryIds, setSelectedEntryIds] = useState(new Set());
  const [tripModal, setTripModal] = useState(null); // {session, entries: []}
  // Pig inline add-entry state (per expanded session — scoped via expandedSession)
  const [pigAddEntry, setPigAddEntry] = useState({weight:'', note:''});
  const [pigBusy, setPigBusy] = useState(false);
  const [pigErr, setPigErr] = useState('');

  const speciesLabel = species === 'broiler' ? 'Broiler' : 'Pig';

  // Derive column labels for a session: broiler → split batch.schooner on '&'; pig → ['1','2'].
  function deriveLabels(s) {
    if(!s) return [];
    if(s.species === 'broiler') {
      const rec = broilerBatchRecs.find(b => (b.name||'') === s.batch_id);
      const raw = rec && rec.schooner ? String(rec.schooner) : '';
      const parts = raw.split('&').map(x => x.trim()).filter(Boolean);
      return parts.length > 0 ? parts : ['(no schooner)'];
    }
    // Pig admin view moved to per-entry list (no grid) — labels stay empty.
    return [];
  }
  // Distribute a session's saved entries into a weights grid (mirrors the public webform).
  // Entries already sent to a processing trip are excluded here — they live in
  // the Send-to-Trip panel below the grid so re-saves don't wipe them.
  function hydrateGrid(s, sEntries, labels) {
    const grid = Array(labels.length * 15).fill('');
    const free = (sEntries||[]).filter(e => !e.sent_to_trip_id);
    if(s.species === 'broiler') {
      labels.forEach(function(label, colIdx){
        const colE = free.filter(function(e){ return (e.tag||'') === label; });
        colE.slice(0, 15).forEach(function(e, i){ grid[colIdx*15 + i] = String(e.weight); });
      });
    } else {
      free.slice(0, labels.length * 15).forEach(function(e, i){ grid[i] = String(e.weight); });
    }
    return grid;
  }

  async function loadAll() {
    setLoading(true);
    const sR = await sb.from('weigh_in_sessions').select('*').eq('species', species).order('date',{ascending:false}).order('started_at',{ascending:false});
    if(sR.data) {
      setSessions(sR.data);
      if(sR.data.length > 0) {
        const ids = sR.data.map(s => s.id);
        const eR = await sb.from('weigh_ins').select('*').in('session_id', ids).order('entered_at',{ascending:true});
        if(eR.data) {
          const m = {};
          eR.data.forEach(e => { if(!m[e.session_id]) m[e.session_id] = []; m[e.session_id].push(e); });
          setEntries(m);
        }
      } else {
        setEntries({});
      }
    }
    setLoading(false);
  }
  useEffect(() => { loadAll(); }, [species]);
  // Broilers: load app_store ppp-v4 once so we can resolve schooner per batch.
  useEffect(() => {
    if(species !== 'broiler') return;
    sb.from('app_store').select('data').eq('key','ppp-v4').maybeSingle().then(({data}) => {
      if(data && Array.isArray(data.data)) setBroilerBatchRecs(data.data);
    });
  }, [species]);
  // Pigs: load feeder groups so the Send-to-Trip modal can list them.
  useEffect(() => {
    if(species !== 'pig') return;
    sb.from('app_store').select('data').eq('key','ppp-feeders-v1').maybeSingle().then(({data}) => {
      if(data && Array.isArray(data.data)) setFeederGroups(data.data);
    });
  }, [species]);
  async function reloadFeederGroups() {
    const {data} = await sb.from('app_store').select('data').eq('key','ppp-feeders-v1').maybeSingle();
    if(data && Array.isArray(data.data)) setFeederGroups(data.data);
  }
  // When the user expands a tile, derive labels + hydrate the grid + reset edit lock.
  // Drafts are auto-unlocked; complete sessions stay locked until the user clicks Edit.
  useEffect(() => {
    if(!expandedSession) {
      setGridLabels([]); setGridInputs([]); setGridUnlocked(false); setGridNote(''); setGridErr('');
      setPigAddEntry({weight:'', note:''}); setPigErr('');
      return;
    }
    const s = sessions.find(x => x.id === expandedSession);
    if(!s) return;
    const labels = deriveLabels(s);
    const sEntries = entries[s.id] || [];
    setGridLabels(labels);
    setGridInputs(hydrateGrid(s, sEntries, labels));
    setGridUnlocked(s.status === 'draft');
    setGridNote(s.notes || '');
    setGridErr('');
  }, [expandedSession, sessions, entries, broilerBatchRecs]);

  async function reopenSession(s) {
    await sb.from('weigh_in_sessions').update({status:'draft', completed_at:null}).eq('id', s.id);
    await loadAll();
  }
  async function completeFromAdmin(s) {
    // If this session is the currently-expanded tile, flush any pending grid
    // edits to DB first so what's on screen is what gets recorded as complete.
    if(expandedSession === s.id && s.species === 'broiler') {
      await saveAdminGrid(s);
    }
    await sb.from('weigh_in_sessions').update({status:'complete', completed_at: new Date().toISOString()}).eq('id', s.id);
    if(species === 'broiler') {
      const eR = await sb.from('weigh_ins').select('*').eq('session_id', s.id);
      // Override status locally so writeBroilerBatchAvg's complete-only gate fires.
      await writeBroilerBatchAvg(sb, {...s, status:'complete'}, (eR && eR.data) || []);
    }
    await loadAll();
  }
  // ── Pig per-entry admin helpers ───────────────────────────────────────────
  // Pigs moved off the grid flow; editing/deleting/adding happens one row at a
  // time, like cattle/sheep. Sent-to-trip entries can't be edited or deleted
  // (they'd desync from the trip's liveWeights string in app_store).
  async function addPigEntry(sessionId) {
    const w = parseFloat(pigAddEntry.weight);
    if(!Number.isFinite(w) || w <= 0) { setPigErr('Weight is required.'); return; }
    setPigBusy(true); setPigErr('');
    const id = String(Date.now())+Math.random().toString(36).slice(2,6);
    const rec = { id, session_id: sessionId, tag: null, weight: w, note: pigAddEntry.note || null, new_tag_flag: false };
    const { error } = await sb.from('weigh_ins').insert(rec);
    setPigBusy(false);
    if(error) { setPigErr('Save failed: '+error.message); return; }
    setPigAddEntry({weight:'', note:''});
    await loadAll();
  }
  async function updatePigEntry(entryId, fields) {
    if(!entryId || !fields) return;
    const { error } = await sb.from('weigh_ins').update(fields).eq('id', entryId);
    if(error) { setPigErr('Update failed: '+error.message); return; }
    await loadAll();
  }
  async function deletePigEntry(entryId) {
    if(!window._wcfConfirmDelete) return;
    window._wcfConfirmDelete('Delete this weigh-in entry?', async () => {
      await sb.from('weigh_ins').delete().eq('id', entryId);
      await loadAll();
    });
  }
  async function savePigSessionNote(sessionId, note) {
    await sb.from('weigh_in_sessions').update({notes: note || null}).eq('id', sessionId);
    await loadAll();
  }
  async function deleteSession(s) {
    if(!window._wcfConfirmDelete) return;
    window._wcfConfirmDelete('Delete this weigh-in session and all its entries? This cannot be undone.', async () => {
      await sb.from('weigh_in_sessions').delete().eq('id', s.id);
      await loadAll();
    });
  }
  // Admin save: wipe+rewrite semantics on the UNSENT pool. Entries with
  // sent_to_trip_id set are protected — they stay in weigh_ins and continue
  // referencing their trip in app_store.ppp-feeders-v1.
  async function saveAdminGrid(s) {
    if(!s) return;
    const rows = [];
    for(let i=0;i<gridInputs.length;i++){
      const w = gridInputs[i];
      if(w === '' || isNaN(parseFloat(w)) || parseFloat(w) <= 0) continue;
      const colIdx = Math.floor(i / 15);
      const tag = (s.species === 'broiler' && gridLabels[colIdx]) ? gridLabels[colIdx] : null;
      rows.push({weight: parseFloat(w), tag: tag});
    }
    setSavingGrid(true); setGridErr('');
    const del = await sb.from('weigh_ins').delete().eq('session_id', s.id).is('sent_to_trip_id', null);
    if(del.error) { setSavingGrid(false); setGridErr('Save failed (clear): '+del.error.message); return; }
    let recs = [];
    if(rows.length > 0) {
      const t0 = Date.now();
      recs = rows.map(function(r, i){
        return {
          id: String(t0+i)+Math.random().toString(36).slice(2,6),
          session_id: s.id,
          tag: r.tag,
          weight: r.weight,
          note: null,
          new_tag_flag: false,
        };
      });
      const ins = await sb.from('weigh_ins').insert(recs);
      if(ins.error) { setSavingGrid(false); setGridErr('Save failed (insert): '+ins.error.message); return; }
    }
    if(gridNote !== (s.notes || '')) {
      await sb.from('weigh_in_sessions').update({notes: gridNote || null}).eq('id', s.id);
    }
    if(s.species === 'broiler') {
      await writeBroilerBatchAvg(sb, s, recs);
    }
    setSavingGrid(false);
    // Re-lock complete sessions after save so the field stays read-only by default.
    if(s.status === 'complete') setGridUnlocked(false);
    await loadAll();
  }

  // Send-to-Trip: merge the selected weigh-ins into a trip inside a feeder group.
  // Trip's pigCount gets incremented by the selection count. liveWeights gets
  // the weights space-appended (matches the existing liveWeights string format).
  // Each weigh-in row is stamped with sent_to_trip_id + sent_to_group_id so it
  // survives grid saves and shows up in the Sent panel.
  async function sendEntriesToTrip({groupId, tripId, createNewWithDate}) {
    if(!tripModal) return;
    const { session, entries: selectedEntries } = tripModal;
    if(!groupId || selectedEntries.length === 0) return;
    const groups = feederGroups.slice();
    const gi = groups.findIndex(g => g.id === groupId);
    if(gi < 0) return;
    const g = {...groups[gi]};
    const trips = (g.processingTrips||[]).slice();
    const addWeights = selectedEntries.map(e => parseFloat(e.weight)||0).filter(w => w > 0);
    const addCount = selectedEntries.length;
    let effectiveTripId = tripId;
    if(!tripId && createNewWithDate) {
      // Create a new trip with this selection seeded
      effectiveTripId = String(Date.now())+Math.random().toString(36).slice(2,6);
      trips.push({
        id: effectiveTripId,
        date: createNewWithDate,
        pigCount: addCount,
        liveWeights: addWeights.join(' '),
        hangingWeight: 0,
        notes: '',
      });
    } else {
      const ti = trips.findIndex(t => t.id === tripId);
      if(ti < 0) return;
      const t = {...trips[ti]};
      t.pigCount = (parseInt(t.pigCount)||0) + addCount;
      const existing = (t.liveWeights||'').trim();
      t.liveWeights = (existing ? existing + ' ' : '') + addWeights.join(' ');
      trips[ti] = t;
    }
    trips.sort((a,b) => (a.date||'').localeCompare(b.date||''));
    g.processingTrips = trips;
    groups[gi] = g;
    await sb.from('app_store').upsert({key:'ppp-feeders-v1', data: groups}, {onConflict:'key'});
    // Mark the weigh_ins rows
    for(const e of selectedEntries) {
      await sb.from('weigh_ins').update({
        sent_to_trip_id: effectiveTripId,
        sent_to_group_id: groupId,
      }).eq('id', e.id);
    }
    setFeederGroups(groups);
    setSelectedEntryIds(new Set());
    setTripModal(null);
    await loadAll();
  }
  async function undoSendToTrip(entry) {
    if(!entry || !entry.sent_to_trip_id || !entry.sent_to_group_id) return;
    const groups = feederGroups.slice();
    const gi = groups.findIndex(g => g.id === entry.sent_to_group_id);
    if(gi >= 0) {
      const g = {...groups[gi]};
      const trips = (g.processingTrips||[]).map(t => {
        if(t.id !== entry.sent_to_trip_id) return t;
        const nt = {...t};
        nt.pigCount = Math.max(0, (parseInt(nt.pigCount)||0) - 1);
        // Remove one occurrence of the weight from the liveWeights string
        const targetW = parseFloat(entry.weight);
        const parts = (nt.liveWeights||'').split(/\s+/).filter(Boolean);
        const idx = parts.findIndex(p => parseFloat(p) === targetW);
        if(idx >= 0) parts.splice(idx, 1);
        nt.liveWeights = parts.join(' ');
        return nt;
      });
      g.processingTrips = trips;
      groups[gi] = g;
      await sb.from('app_store').upsert({key:'ppp-feeders-v1', data: groups}, {onConflict:'key'});
      setFeederGroups(groups);
    }
    await sb.from('weigh_ins').update({sent_to_trip_id: null, sent_to_group_id: null}).eq('id', entry.id);
    await loadAll();
  }

  const filtered = sessions.filter(s => statusFilter === 'all' || s.status === statusFilter);
  const totalEntries = filtered.reduce((s,sess) => s + (entries[sess.id]?entries[sess.id].length:0), 0);

  return (
    <div style={{minHeight:'100vh', background:'#f1f3f2'}}>
      {showUsers && <UsersModal sb={sb} authState={authState} allUsers={allUsers} setAllUsers={setAllUsers} setShowUsers={setShowUsers} loadUsers={loadUsers}/>}
      <Header/>
      <div style={{padding:'1rem', maxWidth:1100, margin:'0 auto'}}>
        <div style={{display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:12, flexWrap:'wrap', gap:8}}>
          <div>
            <div style={{fontSize:16, fontWeight:700, color:'#111827'}}>{speciesLabel} Weigh-In Sessions</div>
            <div style={{fontSize:12, color:'#6b7280', marginTop:2}}>{filtered.length} sessions {'\u00b7'} {totalEntries} total entries</div>
          </div>
          <div style={{display:'flex', gap:8, alignItems:'center'}}>
            <div style={{display:'flex', borderRadius:6, overflow:'hidden', border:'1px solid #d1d5db'}}>
              {[{k:'all',l:'All'},{k:'draft',l:'Drafts'},{k:'complete',l:'Complete'}].map((o,oi) => (
                <button key={o.k} onClick={()=>setStatusFilter(o.k)} style={{padding:'5px 10px', border:'none', borderRight:oi<2?'1px solid #d1d5db':'none', fontFamily:'inherit', fontSize:11, fontWeight:600, cursor:'pointer', background:statusFilter===o.k?'#1e40af':'white', color:statusFilter===o.k?'white':'#6b7280'}}>{o.l}</button>
              ))}
            </div>
            <button onClick={()=>setShowNewModal(true)} style={{padding:'7px 14px', borderRadius:7, border:'none', background:'#1e40af', color:'white', fontWeight:600, fontSize:12, cursor:'pointer', fontFamily:'inherit'}}>{'\u2696\ufe0f New Weigh-In'}</button>
          </div>
        </div>
        {showNewModal && <AdminNewWeighInModal sb={sb} species={species} onClose={()=>setShowNewModal(false)} onCreated={(rec)=>{ loadAll().then(()=>setExpandedSession(rec.id)); }}/>}

        {loading && <div style={{textAlign:'center', padding:'2rem', color:'#9ca3af'}}>Loading{'\u2026'}</div>}
        {!loading && filtered.length === 0 && (
          <div style={{background:'white', border:'1px solid #e5e7eb', borderRadius:12, padding:'2rem', textAlign:'center', color:'#6b7280', fontSize:13}}>
            No weigh-in sessions yet. Click <strong>{'\u2696\ufe0f New Weigh-In'}</strong> to start one.
          </div>
        )}

        <div style={{display:'flex', flexDirection:'column', gap:8}}>
          {filtered.map(s => {
            const isExpanded = expandedSession === s.id;
            const sEntries = entries[s.id] || [];
            const avgWeight = sEntries.length > 0 ? sEntries.reduce((sum,e)=>sum+(parseFloat(e.weight)||0),0) / sEntries.length : 0;
            const isComplete = s.status === 'complete';
            const fieldsLocked = isComplete && !gridUnlocked;
            const inpEditableStyle = {fontFamily:'inherit', fontSize:13, padding:'6px 8px', border:'1px solid #d1d5db', borderRadius:6, width:'100%', boxSizing:'border-box', background:'white', color:'#111827', outline:'none'};
            const inpLockedStyle = {...inpEditableStyle, background:'#f3f4f6', color:'#374151', cursor:'not-allowed'};
            return (
              <div key={s.id} style={{background:'white', border:'1px solid #e5e7eb', borderRadius:10, overflow:'hidden'}}>
                <div onClick={()=>setExpandedSession(isExpanded?null:s.id)} style={{padding:'10px 16px', cursor:'pointer', display:'flex', alignItems:'center', gap:10, flexWrap:'wrap'}} className="hoverable-tile">
                  <span style={{fontSize:11, color:'#9ca3af'}}>{isExpanded?'\u25bc':'\u25b6'}</span>
                  <span style={{fontSize:13, fontWeight:700, color:'#111827', minWidth:120}}>{s.batch_id||'Unknown batch'}</span>
                  {species==='broiler' && s.broiler_week && <span style={{fontSize:10, fontWeight:700, padding:'2px 8px', borderRadius:10, background:'#fef3c7', color:'#92400e'}}>{'WK '+s.broiler_week}</span>}
                  <span style={{fontSize:10, fontWeight:700, padding:'2px 8px', borderRadius:10, background:isComplete?'#d1fae5':'#fef3c7', color:isComplete?'#065f46':'#92400e', textTransform:'uppercase'}}>{s.status}</span>
                  <span style={{fontSize:11, color:'#6b7280'}}>{s.date}</span>
                  <span style={{fontSize:11, color:'#6b7280'}}>{s.team_member}</span>
                  <span style={{fontSize:11, fontWeight:600, color:'#1e40af'}}>{sEntries.length} {sEntries.length===1?'entry':'entries'}</span>
                  {avgWeight > 0 && <span style={{fontSize:12, fontWeight:700, color:'#065f46', padding:'2px 10px', borderRadius:10, background:'#d1fae5'}}>avg {Math.round(avgWeight*100)/100} lb</span>}
                  {species==='broiler' && avgWeight > 0 && s.broiler_week && <span style={{fontSize:10, color:'#6b7280', fontStyle:'italic'}}>{'\u2192 batch wk'+s.broiler_week+'Lbs'}</span>}
                </div>
                {isExpanded && (
                  <div style={{borderTop:'1px solid #f3f4f6', padding:'12px 16px', background:'#fafafa'}}>
                    <div style={{display:'flex', gap:8, marginBottom:10, flexWrap:'wrap'}}>
                      {isComplete && !gridUnlocked && <button onClick={()=>setGridUnlocked(true)} style={{padding:'4px 10px', borderRadius:6, border:'1px solid #1e40af', background:'#eff6ff', color:'#1e40af', fontSize:11, fontWeight:600, cursor:'pointer', fontFamily:'inherit'}}>{'\u270e Edit Weights'}</button>}
                      {!isComplete && <button onClick={()=>completeFromAdmin(s)} style={{padding:'4px 10px', borderRadius:6, border:'1px solid #047857', background:'#047857', color:'white', fontSize:11, fontWeight:600, cursor:'pointer', fontFamily:'inherit'}}>{'\u2713 Complete Weigh-In'}</button>}
                      <button onClick={()=>deleteSession(s)} style={{marginLeft:'auto', padding:'4px 10px', borderRadius:6, border:'1px solid #F09595', background:'white', color:'#b91c1c', fontSize:11, cursor:'pointer', fontFamily:'inherit'}}>Delete Weigh-In</button>
                    </div>

                    {gridLabels.length > 0 && (
                      <React.Fragment>
                        <div style={{display:'grid', gridTemplateColumns:'repeat('+gridLabels.length+', 1fr)', gap:8, marginBottom:10}}>
                          {gridLabels.map(function(label, col){
                            return (
                              <div key={col}>
                                <div style={{fontSize:11, fontWeight:700, color:'#374151', textAlign:'center', padding:'4px 0', marginBottom:4, background:'#eef2ff', borderRadius:6}}>{species==='broiler'?'Schooner '+label:'Col '+label}</div>
                                {Array.from({length:15}).map(function(_, row){
                                  var idx = col*15 + row;
                                  return (
                                    <div key={row} style={{display:'flex', alignItems:'center', gap:4, marginBottom:3}}>
                                      <span style={{fontSize:10, color:'#9ca3af', minWidth:18, textAlign:'right', fontVariantNumeric:'tabular-nums'}}>{row+1}</span>
                                      <input
                                        type="number" min="0" step="0.1"
                                        value={gridInputs[idx]||''}
                                        disabled={fieldsLocked}
                                        readOnly={fieldsLocked}
                                        onChange={function(e){
                                          var v = e.target.value;
                                          setGridInputs(function(prev){ var next = prev.slice(); next[idx] = v; return next; });
                                        }}
                                        placeholder="0"
                                        style={fieldsLocked?inpLockedStyle:inpEditableStyle}
                                      />
                                    </div>
                                  );
                                })}
                              </div>
                            );
                          })}
                        </div>
                        <div style={{marginBottom:10}}>
                          <label style={{display:'block', fontSize:12, color:'#374151', marginBottom:4, fontWeight:600}}>Session note</label>
                          <textarea value={gridNote} disabled={fieldsLocked} readOnly={fieldsLocked} onChange={ev=>setGridNote(ev.target.value)} rows={2} placeholder="Optional" style={{...(fieldsLocked?inpLockedStyle:inpEditableStyle), resize:'vertical'}}/>
                        </div>
                        {gridErr && <div style={{color:'#b91c1c', fontSize:12, marginBottom:8, padding:'6px 10px', background:'#fef2f2', borderRadius:6}}>{gridErr}</div>}
                        {!fieldsLocked && (
                          <button onClick={()=>saveAdminGrid(s)} disabled={savingGrid} style={{padding:'8px 16px', borderRadius:7, border:'none', background:savingGrid?'#9ca3af':'#1e40af', color:'white', fontSize:12, fontWeight:600, cursor:savingGrid?'not-allowed':'pointer', fontFamily:'inherit'}}>{savingGrid?'Saving\u2026':'Save Weights'}</button>
                        )}
                        {isComplete && !gridUnlocked && <div style={{fontSize:11, color:'#6b7280', fontStyle:'italic'}}>Click <strong>{'\u270e Edit Weights'}</strong> above to make changes.</div>}
                      </React.Fragment>
                    )}
                    {species === 'pig' && (() => {
                      const lookupTrip = (e) => {
                        const g = feederGroups.find(x => x.id === e.sent_to_group_id);
                        if(!g) return null;
                        const t = (g.processingTrips||[]).find(x => x.id === e.sent_to_trip_id);
                        return t ? { group: g, trip: t } : null;
                      };
                      const toggle = (id) => setSelectedEntryIds(prev => { const n = new Set(prev); if(n.has(id)) n.delete(id); else n.add(id); return n; });
                      const unsent = sEntries.filter(e => !e.sent_to_trip_id);
                      const sel = unsent.filter(e => selectedEntryIds.has(e.id));
                      const rowInpS = {fontSize:12, padding:'5px 8px', border:'1px solid #d1d5db', borderRadius:5, fontFamily:'inherit', boxSizing:'border-box', background:'white'};
                      return (
                        <div style={{marginTop:4, paddingTop:12, borderTop:'1px dashed #d1d5db'}}>
                          <div style={{fontSize:12, fontWeight:700, color:'#374151', marginBottom:8}}>Weights ({sEntries.length})</div>
                          {sEntries.length === 0 && <div style={{fontSize:11, color:'#9ca3af', fontStyle:'italic', padding:'6px 0'}}>No entries in this session yet.</div>}
                          {sEntries.map(e => {
                            const isSent = !!e.sent_to_trip_id;
                            const link = isSent ? lookupTrip(e) : null;
                            const checked = selectedEntryIds.has(e.id);
                            return (
                              <div key={e.id} style={{display:'flex', alignItems:'center', gap:6, padding:'5px 0', borderBottom:'1px solid #f3f4f6', flexWrap:'wrap'}}>
                                {!isSent && !fieldsLocked
                                  ? <input type="checkbox" checked={checked} onChange={()=>toggle(e.id)} style={{margin:0}} title="Select to send to trip"/>
                                  : <span style={{width:13}}/>}
                                {!isSent && !fieldsLocked
                                  ? <input type="number" min="0" step="0.1" defaultValue={e.weight} onBlur={ev=>{const v=parseFloat(ev.target.value); if(Number.isFinite(v)&&v>0&&v!==parseFloat(e.weight)) updatePigEntry(e.id,{weight:v});}} style={{...rowInpS, width:80}}/>
                                  : <span style={{fontWeight:700, color:isSent?'#047857':'#1e40af', minWidth:80, fontSize:13}}>{e.weight} lb</span>}
                                {!isSent && !fieldsLocked
                                  ? <input type="text" placeholder="Note (optional)" defaultValue={e.note||''} onBlur={ev=>{const v=(ev.target.value||'').trim()||null; if(v!==(e.note||null)) updatePigEntry(e.id,{note:v});}} style={{...rowInpS, flex:1, minWidth:120}}/>
                                  : (e.note && <span style={{fontSize:11, color:'#6b7280', fontStyle:'italic', flex:1}}>{e.note}</span>)}
                                {isSent && link && <span style={{fontSize:11, padding:'2px 8px', borderRadius:4, background:'#d1fae5', color:'#065f46', fontWeight:600, whiteSpace:'nowrap'}}>{'\u2192 '+link.group.batchName+' \u00b7 '+link.trip.date}</span>}
                                {isSent && !link && <span style={{fontSize:11, color:'#b91c1c', fontStyle:'italic'}}>(missing trip)</span>}
                                {isSent && <button onClick={()=>undoSendToTrip(e)} title="Undo send to trip" style={{background:'none', border:'1px solid #fecaca', borderRadius:5, color:'#b91c1c', cursor:'pointer', fontSize:11, padding:'2px 8px', fontFamily:'inherit'}}>Undo send</button>}
                                {!isSent && !fieldsLocked && <button onClick={()=>deletePigEntry(e.id)} title="Delete entry" style={{background:'none', border:'1px solid #fecaca', borderRadius:5, color:'#b91c1c', cursor:'pointer', fontSize:11, padding:'2px 8px', fontFamily:'inherit'}}>Delete</button>}
                              </div>
                            );
                          })}

                          {/* Add entry row */}
                          {!fieldsLocked && (
                            <div style={{display:'flex', alignItems:'center', gap:6, marginTop:10, padding:'8px 10px', background:'#eff6ff', border:'1px dashed #bfdbfe', borderRadius:6, flexWrap:'wrap'}}>
                              <span style={{fontSize:11, fontWeight:600, color:'#1e40af'}}>+ Add:</span>
                              <input type="number" min="0" step="0.1" placeholder="Weight (lb)" value={pigAddEntry.weight} onChange={ev=>setPigAddEntry(p=>({...p, weight:ev.target.value}))} style={{...rowInpS, width:110}}/>
                              <input type="text" placeholder="Note (optional)" value={pigAddEntry.note} onChange={ev=>setPigAddEntry(p=>({...p, note:ev.target.value}))} style={{...rowInpS, flex:1, minWidth:120}}/>
                              <button onClick={()=>addPigEntry(s.id)} disabled={pigBusy || !pigAddEntry.weight} style={{padding:'6px 14px', borderRadius:5, border:'none', background:(pigBusy||!pigAddEntry.weight)?'#9ca3af':'#1e40af', color:'white', fontSize:12, fontWeight:600, cursor:(pigBusy||!pigAddEntry.weight)?'not-allowed':'pointer', fontFamily:'inherit'}}>{pigBusy?'Saving\u2026':'Add'}</button>
                            </div>
                          )}
                          {pigErr && <div style={{color:'#b91c1c', fontSize:12, marginTop:8, padding:'6px 10px', background:'#fef2f2', borderRadius:6}}>{pigErr}</div>}

                          {/* Session note */}
                          <div style={{marginTop:12}}>
                            <label style={{display:'block', fontSize:12, color:'#374151', marginBottom:4, fontWeight:600}}>Session note</label>
                            <textarea defaultValue={s.notes||''} disabled={fieldsLocked} readOnly={fieldsLocked} onBlur={ev=>{ if((ev.target.value||'') !== (s.notes||'')) savePigSessionNote(s.id, ev.target.value||''); }} rows={2} placeholder="Optional" style={{...(fieldsLocked?inpLockedStyle:inpEditableStyle), resize:'vertical'}}/>
                          </div>

                          {/* Send-to-Trip action bar */}
                          {unsent.length > 0 && !fieldsLocked && (
                            <div style={{marginTop:12, paddingTop:10, borderTop:'1px dashed #e5e7eb', display:'flex', alignItems:'center', gap:10, flexWrap:'wrap'}}>
                              <span style={{fontSize:11, color:'#6b7280'}}>{'\ud83d\ude9a Send to trip:'}</span>
                              <button onClick={()=>setSelectedEntryIds(new Set(unsent.map(e=>e.id)))} style={{fontSize:11, color:'#1d4ed8', background:'none', border:'none', cursor:'pointer', fontFamily:'inherit'}}>Select all unsent ({unsent.length})</button>
                              {selectedEntryIds.size > 0 && <button onClick={()=>setSelectedEntryIds(new Set())} style={{fontSize:11, color:'#6b7280', background:'none', border:'none', cursor:'pointer', fontFamily:'inherit'}}>Clear</button>}
                              <button disabled={sel.length===0} onClick={()=>setTripModal({session:s, entries:sel})} style={{marginLeft:'auto', padding:'6px 14px', borderRadius:6, border:'none', background:sel.length>0?'#047857':'#d1d5db', color:'white', fontSize:12, fontWeight:600, cursor:sel.length>0?'pointer':'not-allowed', fontFamily:'inherit'}}>{'\u2192 Send '+sel.length+' to Trip'}</button>
                            </div>
                          )}
                        </div>
                      );
                    })()}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
      {tripModal && <PigSendToTripModal
        session={tripModal.session}
        selectedEntries={tripModal.entries}
        feederGroups={feederGroups}
        onClose={()=>setTripModal(null)}
        onConfirm={sendEntriesToTrip}
      />}
    </div>
  );
};

export default LivestockWeighInsView;
