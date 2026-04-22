// ============================================================================
// CattleWeighInsView — Phase 2.3.5 (recovered from Round-1 bundling bug)
// ============================================================================
// Verbatim byte-for-byte. Originally sat adjacent to PigSendToTripModal in
// main.jsx; Round-1 swept both into PigSendToTripModal.jsx. This splits.
// ============================================================================
import React from 'react';
import CattleNewWeighInModal from './CattleNewWeighInModal.jsx';
import UsersModal from '../auth/UsersModal.jsx';
import { loadCattleWeighInsCached, invalidateCattleWeighInsCache } from '../lib/cattleCache.js';
const CattleWeighInsView = ({sb, fmt, Header, authState, setView, showUsers, setShowUsers, allUsers, setAllUsers, loadUsers}) => {
  const {useState, useEffect} = React;
  const [sessions, setSessions] = useState([]);
  const [entries, setEntries] = useState({}); // session_id -> [entries]
  const [cattle, setCattle] = useState([]);
  const [loading, setLoading] = useState(true);
  const [expandedSession, setExpandedSession] = useState(null);
  const [statusFilter, setStatusFilter] = useState('all'); // all | draft | complete
  const [showNewModal, setShowNewModal] = useState(false);
  const [tagSearch, setTagSearch] = useState('');
  // Inline entry editing
  const [editingEntryId, setEditingEntryId] = useState(null);
  const [editForm, setEditForm] = useState({tag:'', weight:'', note:''});
  // Add-entry form per session
  const [addEntryForm, setAddEntryForm] = useState({tag:'', weight:'', note:'', priorTag:''});

  async function loadAll() {
    const [sR, eAll, cR] = await Promise.all([
      sb.from('weigh_in_sessions').select('*').eq('species','cattle').order('date',{ascending:false}).order('started_at',{ascending:false}),
      loadCattleWeighInsCached(sb),
      sb.from('cattle').select('id, tag, herd, old_tags'),
    ]);
    if(sR.data) setSessions(sR.data);
    // Group cache rows by session_id; entries within a session display oldest-first.
    const m = {};
    eAll.forEach(e => { if(!m[e.session_id]) m[e.session_id] = []; m[e.session_id].push(e); });
    for(const k in m) m[k].sort((a,b) => (a.entered_at||'').localeCompare(b.entered_at||''));
    setEntries(m);
    if(cR.data) setCattle(cR.data);
    setLoading(false);
  }
  useEffect(() => { loadAll(); }, []);

  async function reopenSession(s) {
    await sb.from('weigh_in_sessions').update({status:'draft', completed_at:null}).eq('id', s.id);
    await loadAll();
  }
  async function deleteSession(s) {
    if(!window._wcfConfirmDelete) return;
    window._wcfConfirmDelete('Delete this weigh-in session and all its entries? This cannot be undone.', async () => {
      // Cattle weigh-ins auto-publish a row into cattle_comments whenever an
      // entry has a note. cattle_comments has no FK to weigh_ins (reference_id
      // is plain text), so the cascade on weigh_in_sessions doesn't reach them.
      // Look up the session's weigh-in IDs first and wipe the matching comments
      // before the session itself is deleted -- otherwise they linger as
      // orphans on the cow's timeline.
      const wis = await sb.from('weigh_ins').select('id').eq('session_id', s.id);
      const wiIds = (wis && wis.data || []).map(r => r.id);
      if(wiIds.length > 0) {
        try { await sb.from('cattle_comments').delete().eq('source','weigh_in').in('reference_id', wiIds); }
        catch(e){ /* table may not exist on legacy schemas — ok to skip */ }
      }
      await sb.from('weigh_in_sessions').delete().eq('id', s.id);
      invalidateCattleWeighInsCache();
      await loadAll();
    });
  }
  async function reconcileNewTag(entry, knownCowId) {
    if(!knownCowId) return;
    const cow = cattle.find(c => c.id === knownCowId);
    if(!cow) return;
    // Tag-swap pattern: the WEIGH-IN keeps its new tag (the entry IS the new tag),
    // and the COW's tag gets updated to that new tag with the prior tag pushed to
    // old_tags. Mirrors the webform's reconcileEntryToCow. Reconciled after
    // entry → labeled "Retag" (source='weigh_in').
    const priorTag = cow.tag;
    const newTag = entry.tag;
    const updatedOldTags = (Array.isArray(cow.old_tags) ? cow.old_tags : [])
      .concat([{tag: priorTag, changed_at: new Date().toISOString(), source: 'weigh_in'}]);
    await sb.from('cattle').update({tag: newTag, old_tags: updatedOldTags}).eq('id', knownCowId);
    await sb.from('weigh_ins').update({new_tag_flag:false}).eq('id', entry.id);
    try { await sb.from('cattle_comments').update({cattle_id: knownCowId, cattle_tag: newTag}).eq('reference_id', entry.id); } catch(e){}
    invalidateCattleWeighInsCache();
    await loadAll();
  }

  async function completeSession(s) {
    await sb.from('weigh_in_sessions').update({status:'complete', completed_at:new Date().toISOString()}).eq('id', s.id);
    await loadAll();
  }
  function startEditEntry(e) {
    setEditingEntryId(e.id);
    setEditForm({tag: e.tag || '', weight: String(e.weight ?? ''), note: e.note || ''});
  }
  async function saveEntryEdit(e) {
    const newTag = (editForm.tag||'').trim() || null;
    const newWeight = parseFloat(editForm.weight);
    if(!Number.isFinite(newWeight) || newWeight <= 0) return;
    // If the tag changes, recompute new_tag_flag (true if no cow currently holds that tag)
    const cowWithTag = newTag ? cattle.find(c => c.tag === newTag) : null;
    const newTagFlag = newTag && !cowWithTag;
    await sb.from('weigh_ins').update({tag: newTag, weight: newWeight, note: editForm.note || null, new_tag_flag: newTagFlag}).eq('id', e.id);
    invalidateCattleWeighInsCache();
    setEditingEntryId(null);
    await loadAll();
  }
  async function deleteEntry(e) {
    if(!window._wcfConfirmDelete) {
      if(!window.confirm('Delete this weigh-in entry?')) return;
      await sb.from('weigh_ins').delete().eq('id', e.id);
      invalidateCattleWeighInsCache();
      await loadAll();
      return;
    }
    window._wcfConfirmDelete('Delete this weigh-in entry? This cannot be undone.', async () => {
      await sb.from('weigh_ins').delete().eq('id', e.id);
      invalidateCattleWeighInsCache();
      await loadAll();
    });
  }
  // Same walk as the webform's findCowByPriorTag: current tag →
  // import old_tags → weigh_in old_tags.
  function findCowByPriorTagAdmin(priorTag) {
    if(!priorTag) return null;
    const pt = String(priorTag).trim();
    const byCurrent = cattle.find(c => c.tag === pt);
    if(byCurrent) return byCurrent;
    const byImport = cattle.find(c => Array.isArray(c.old_tags) && c.old_tags.some(ot => ot && ot.tag === pt && ot.source === 'import'));
    if(byImport) return byImport;
    const byWeighIn = cattle.find(c => Array.isArray(c.old_tags) && c.old_tags.some(ot => ot && ot.tag === pt && ot.source === 'weigh_in'));
    return byWeighIn || null;
  }
  async function addEntryToSession(s) {
    const tag = (addEntryForm.tag||'').trim() || null;
    const weight = parseFloat(addEntryForm.weight);
    if(!Number.isFinite(weight) || weight <= 0) return;
    const priorTag = (addEntryForm.priorTag||'').trim();
    // Retag flow in admin: if a prior tag was supplied, swap the matching cow's
    // tag on the spot and stamp her old_tags. Mirrors the webform's retag mode.
    if(priorTag) {
      if(!tag) { alert('Enter a New tag # for the swap.'); return; }
      if(priorTag === tag) { alert('Prior tag and new tag cannot be the same.'); return; }
      const existingAtNewTag = cattle.find(c => c.tag === tag);
      if(existingAtNewTag) { alert('Tag #'+tag+' is already assigned to another cow.'); return; }
      const cow = findCowByPriorTagAdmin(priorTag);
      if(!cow) { alert('No cow found with prior tag #'+priorTag+'.'); return; }
      const updatedOldTags = (Array.isArray(cow.old_tags) ? cow.old_tags : [])
        .concat([{tag: priorTag, changed_at: new Date().toISOString(), source: 'import'}]);
      const cowUpd = await sb.from('cattle').update({tag, old_tags: updatedOldTags}).eq('id', cow.id);
      if(cowUpd.error) { alert('Tag swap failed: '+cowUpd.error.message); return; }
      const id = String(Date.now())+Math.random().toString(36).slice(2,6);
      await sb.from('weigh_ins').insert({
        id, session_id: s.id, tag, weight,
        note: addEntryForm.note || null,
        new_tag_flag: false,
        reconcile_intent: 'retag',
        entered_at: new Date().toISOString(),
      });
      invalidateCattleWeighInsCache();
      setAddEntryForm({tag:'', weight:'', note:'', priorTag:''});
      await loadAll();
      return;
    }
    const cowWithTag = tag ? cattle.find(c => c.tag === tag) : null;
    const newTagFlag = tag && !cowWithTag;
    const id = String(Date.now())+Math.random().toString(36).slice(2,6);
    await sb.from('weigh_ins').insert({
      id, session_id: s.id, tag, weight,
      note: addEntryForm.note || null,
      new_tag_flag: !!newTagFlag,
      entered_at: new Date().toISOString(),
    });
    invalidateCattleWeighInsCache();
    setAddEntryForm({tag:'', weight:'', note:'', priorTag:''});
    await loadAll();
  }
  async function createNewSession(opts) {
    const id = 'wsess-' + String(Date.now()) + Math.random().toString(36).slice(2,6);
    const rec = {
      id, date: opts.date, team_member: opts.team_member,
      species: 'cattle', herd: opts.herd,
      status: 'draft', started_at: new Date().toISOString(),
    };
    await sb.from('weigh_in_sessions').insert(rec);
    await loadAll();
    setExpandedSession(id);
    setShowNewModal(false);
  }

  // Tag search: filter both sessions and the entries-within-session. When a
  // search is active, sessions with zero matching entries drop out, and within
  // each surviving session only the matching entries render.
  const tagQ = tagSearch.trim().toLowerCase();
  const entryMatchesTag = (e) => !tagQ || (e.tag||'').toLowerCase().includes(tagQ);
  const statusFiltered = sessions.filter(s => statusFilter === 'all' || s.status === statusFilter);
  const filtered = tagQ
    ? statusFiltered.filter(s => (entries[s.id]||[]).some(entryMatchesTag))
    : statusFiltered;
  const visibleEntriesFor = (sid) => (entries[sid]||[]).filter(entryMatchesTag);
  const totalEntries = filtered.reduce((s,sess) => s + visibleEntriesFor(sess.id).length, 0);
  const matchedSessionCount = tagQ ? filtered.length : null;
  const HERD_LABELS = {mommas:'Mommas', backgrounders:'Backgrounders', finishers:'Finishers', bulls:'Bulls'};

  return (
    <div style={{minHeight:'100vh', background:'#f1f3f2'}}>
      {showUsers && <UsersModal sb={sb} authState={authState} allUsers={allUsers} setAllUsers={setAllUsers} setShowUsers={setShowUsers} loadUsers={loadUsers}/>}
      <Header/>
      <div style={{padding:'1rem', maxWidth:1100, margin:'0 auto'}}>
        <div style={{display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:12, flexWrap:'wrap', gap:8}}>
          <div>
            <div style={{fontSize:16, fontWeight:700, color:'#111827'}}>Cattle Weigh-In Sessions</div>
            <div style={{fontSize:12, color:'#6b7280', marginTop:2}}>
              {tagQ
                ? <span>Search <strong>{'#'+tagSearch}</strong>: {matchedSessionCount} session{matchedSessionCount===1?'':'s'} {'\u00b7'} {totalEntries} matching {totalEntries===1?'entry':'entries'}</span>
                : <span>{filtered.length} sessions {'\u00b7'} {totalEntries} total entries</span>}
            </div>
          </div>
          <div style={{display:'flex', gap:8, alignItems:'center', flexWrap:'wrap'}}>
            <div style={{position:'relative'}}>
              <input
                type="search"
                value={tagSearch}
                onChange={e=>{ setTagSearch(e.target.value); if(e.target.value) setExpandedSession(null); }}
                placeholder="Search by tag #..."
                style={{fontFamily:'inherit', fontSize:12, padding:'6px 28px 6px 10px', border:'1px solid #d1d5db', borderRadius:6, width:160, boxSizing:'border-box', background:'white', color:'#111827', outline:'none'}}
              />
              {tagSearch && <button type="button" onClick={()=>setTagSearch('')} title="Clear search" style={{position:'absolute', right:4, top:'50%', transform:'translateY(-50%)', background:'none', border:'none', fontSize:16, lineHeight:1, color:'#9ca3af', cursor:'pointer', padding:'2px 6px', fontFamily:'inherit'}}>{'\u00d7'}</button>}
            </div>
            <div style={{display:'flex', borderRadius:6, overflow:'hidden', border:'1px solid #d1d5db'}}>
              {[{k:'all',l:'All'},{k:'draft',l:'Drafts'},{k:'complete',l:'Complete'}].map((o,oi) => (
                <button key={o.k} onClick={()=>setStatusFilter(o.k)} style={{padding:'5px 10px', border:'none', borderRight:oi<2?'1px solid #d1d5db':'none', fontFamily:'inherit', fontSize:11, fontWeight:600, cursor:'pointer', background:statusFilter===o.k?'#1e40af':'white', color:statusFilter===o.k?'white':'#6b7280'}}>{o.l}</button>
              ))}
            </div>
            <button onClick={()=>setShowNewModal(true)} style={{padding:'7px 14px', borderRadius:7, border:'none', background:'#1e40af', color:'white', fontWeight:600, fontSize:12, cursor:'pointer', fontFamily:'inherit'}}>{'\u2696\ufe0f New Weigh-In'}</button>
          </div>
        </div>

        {loading && <div style={{textAlign:'center', padding:'2rem', color:'#9ca3af'}}>Loading{'\u2026'}</div>}
        {!loading && filtered.length === 0 && (
          <div style={{background:'white', border:'1px solid #e5e7eb', borderRadius:12, padding:'2rem', textAlign:'center', color:'#6b7280', fontSize:13}}>
            No weigh-in sessions yet. Click <strong>{'\u2696\ufe0f New Weigh-In'}</strong> to start one.
          </div>
        )}

        <div style={{display:'flex', flexDirection:'column', gap:8}}>
          {filtered.map(s => {
            const sEntriesAll = entries[s.id] || [];
            // When searching, each session row auto-expands to just the matches,
            // so the user doesn't have to click through each session to find tags.
            const isExpanded = tagQ ? true : (expandedSession === s.id);
            const sEntries = tagQ ? sEntriesAll.filter(entryMatchesTag) : sEntriesAll;
            const newTagCount = sEntriesAll.filter(e => e.new_tag_flag).length;
            const countLabel = tagQ
              ? (sEntries.length + ' of ' + sEntriesAll.length + ' match')
              : (sEntriesAll.length + ' ' + (sEntriesAll.length===1?'entry':'entries'));
            return (
              <div key={s.id} style={{background:'white', border:'1px solid #e5e7eb', borderRadius:10, overflow:'hidden'}}>
                <div onClick={()=>{ if(tagQ) return; setExpandedSession(isExpanded?null:s.id); }} style={{padding:'10px 16px', cursor:tagQ?'default':'pointer', display:'flex', alignItems:'center', gap:10, flexWrap:'wrap'}} className={tagQ?'':'hoverable-tile'}>
                  {!tagQ && <span style={{fontSize:11, color:'#9ca3af'}}>{isExpanded?'\u25bc':'\u25b6'}</span>}
                  <span style={{fontSize:13, fontWeight:700, color:'#111827', minWidth:120}}>{HERD_LABELS[s.herd]||s.herd||'Unknown herd'}</span>
                  <span style={{fontSize:10, fontWeight:700, padding:'2px 8px', borderRadius:10, background:s.status==='complete'?'#d1fae5':'#fef3c7', color:s.status==='complete'?'#065f46':'#92400e', textTransform:'uppercase'}}>{s.status}</span>
                  <span style={{fontSize:11, color:'#6b7280'}}>{s.date}</span>
                  <span style={{fontSize:11, color:'#6b7280'}}>{s.team_member}</span>
                  <span style={{fontSize:11, fontWeight:600, color:tagQ?'#065f46':'#1e40af'}}>{countLabel}</span>
                  {newTagCount > 0 && !tagQ && <span style={{fontSize:10, fontWeight:700, padding:'2px 6px', borderRadius:4, background:'#fef2f2', color:'#b91c1c'}}>{newTagCount + ' new tags'}</span>}
                </div>
                {isExpanded && (
                  <div style={{borderTop:'1px solid #f3f4f6', padding:'10px 16px', background:'#fafafa'}}>
                    <div style={{display:'flex', gap:8, marginBottom:10, flexWrap:'wrap'}}>
                      {s.status === 'draft' && <button onClick={()=>completeSession(s)} style={{padding:'4px 10px', borderRadius:6, border:'1px solid #047857', background:'#047857', color:'white', fontSize:11, fontWeight:600, cursor:'pointer', fontFamily:'inherit'}}>{'\u2713 Complete Session'}</button>}
                      {s.status === 'complete' && <button onClick={()=>reopenSession(s)} style={{padding:'4px 10px', borderRadius:6, border:'1px solid #d1d5db', background:'white', color:'#1d4ed8', fontSize:11, cursor:'pointer', fontFamily:'inherit'}}>Reopen Session</button>}
                      <button onClick={()=>deleteSession(s)} style={{marginLeft:'auto', padding:'4px 10px', borderRadius:6, border:'1px solid #F09595', background:'white', color:'#b91c1c', fontSize:11, cursor:'pointer', fontFamily:'inherit'}}>Delete Session</button>
                    </div>
                    {sEntries.length === 0 && <div style={{fontSize:12, color:'#9ca3af', fontStyle:'italic', marginBottom:8}}>No entries in this session.</div>}
                    {sEntries.length > 0 && (
                      <div style={{display:'grid', gridTemplateColumns:'repeat(auto-fill, minmax(260px, 1fr))', gap:6, marginBottom:8}}>
                        {sEntries.map(e => {
                          const cow = cattle.find(c => c.tag === e.tag);
                          const isEditing = editingEntryId === e.id;
                          return (
                            <div key={e.id} style={{background:'white', border:'1px solid '+(e.new_tag_flag?'#fca5a5':'#e5e7eb'), borderRadius:6, padding:'6px 10px', fontSize:12}}>
                              {isEditing ? (
                                <div style={{display:'flex', flexDirection:'column', gap:4}}>
                                  <div style={{display:'flex', gap:4}}>
                                    <input type="text" placeholder="Tag #" value={editForm.tag} onChange={ev=>setEditForm(f=>({...f, tag:ev.target.value}))} style={{fontSize:12, padding:'4px 8px', border:'1px solid #d1d5db', borderRadius:5, fontFamily:'inherit', flex:'0 0 80px', minWidth:0}}/>
                                    <input type="number" min="0" step="0.1" placeholder="lb" value={editForm.weight} onChange={ev=>setEditForm(f=>({...f, weight:ev.target.value}))} style={{fontSize:12, padding:'4px 8px', border:'1px solid #d1d5db', borderRadius:5, fontFamily:'inherit', flex:1, minWidth:0}}/>
                                  </div>
                                  <input type="text" placeholder="Note (optional)" value={editForm.note} onChange={ev=>setEditForm(f=>({...f, note:ev.target.value}))} style={{fontSize:12, padding:'4px 8px', border:'1px solid #d1d5db', borderRadius:5, fontFamily:'inherit'}}/>
                                  <div style={{display:'flex', gap:4, justifyContent:'flex-end'}}>
                                    <button onClick={()=>setEditingEntryId(null)} style={{padding:'3px 10px', borderRadius:5, border:'1px solid #d1d5db', background:'white', color:'#6b7280', fontSize:11, cursor:'pointer', fontFamily:'inherit'}}>Cancel</button>
                                    <button onClick={()=>saveEntryEdit(e)} disabled={!(parseFloat(editForm.weight)>0)} style={{padding:'3px 10px', borderRadius:5, border:'none', background:(parseFloat(editForm.weight)>0)?'#1e40af':'#d1d5db', color:'white', fontSize:11, fontWeight:600, cursor:(parseFloat(editForm.weight)>0)?'pointer':'not-allowed', fontFamily:'inherit'}}>Save</button>
                                  </div>
                                </div>
                              ) : (
                                <div style={{display:'flex', flexDirection:'column', gap:4}}>
                                  <div style={{display:'flex', alignItems:'center', gap:8, flexWrap:'wrap'}}>
                                    {e.tag ? <span style={{fontWeight:700, color:'#111827'}}>{'#'+e.tag}</span> : <span style={{color:'#9ca3af'}}>(no tag)</span>}
                                    <span style={{fontWeight:600, color:'#1e40af'}}>{e.weight} lb</span>
                                    {e.new_tag_flag && <span style={{fontSize:10, fontWeight:700, padding:'1px 6px', borderRadius:4, background:'#fef2f2', color:'#b91c1c'}}>NEW TAG</span>}
                                    {!e.new_tag_flag && cow && <span style={{fontSize:11, color:'#6b7280'}}>{HERD_LABELS[cow.herd]||cow.herd}</span>}
                                    <span style={{fontSize:10, color:'#9ca3af', marginLeft:'auto'}}>{(e.entered_at||'').slice(11,16)}</span>
                                  </div>
                                  {e.note && <div style={{fontSize:11, color:'#92400e', fontStyle:'italic'}}>{e.note}</div>}
                                  {e.new_tag_flag && (
                                    <select onChange={ev=>{if(ev.target.value){reconcileNewTag(e, ev.target.value);}}} defaultValue='' style={{fontSize:11, padding:'3px 6px', border:'1px solid #d1d5db', borderRadius:4, fontFamily:'inherit', width:'100%'}}>
                                      <option value=''>Reconcile to known cow...</option>
                                      {cattle.filter(c => c.tag).sort((a,b)=>(parseFloat(a.tag)||0)-(parseFloat(b.tag)||0)).map(c => <option key={c.id} value={c.id}>{'#'+c.tag+' ('+(c.herd||'?')+')'}</option>)}
                                    </select>
                                  )}
                                  <div style={{display:'flex', gap:4, justifyContent:'flex-end'}}>
                                    <button onClick={()=>startEditEntry(e)} style={{fontSize:10, color:'#1d4ed8', background:'none', border:'none', cursor:'pointer', padding:'2px 6px', fontFamily:'inherit'}}>Edit</button>
                                    <button onClick={()=>deleteEntry(e)} style={{fontSize:10, color:'#b91c1c', background:'none', border:'none', cursor:'pointer', padding:'2px 6px', fontFamily:'inherit'}}>Delete</button>
                                  </div>
                                </div>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    )}
                    {/* Add entry row. Prior tag # triggers the on-the-spot retag
                        flow (swaps matching cow's tag + stamps her old_tags). */}
                    <div style={{marginTop:8, background:'#eff6ff', border:'1px dashed #bfdbfe', borderRadius:6, padding:'8px 10px', display:'flex', alignItems:'center', gap:6, flexWrap:'wrap'}}>
                      <span style={{fontSize:11, fontWeight:600, color:'#1e40af'}}>+ Add entry:</span>
                      <input type="text" placeholder="Prior tag (swap)" title="Optional. Fill to swap a known cow's tag on the spot." value={addEntryForm.priorTag} onChange={ev=>setAddEntryForm(f=>({...f, priorTag:ev.target.value}))} style={{fontSize:12, padding:'4px 8px', border:'1px solid #d1d5db', borderRadius:5, fontFamily:'inherit', width:130, background:addEntryForm.priorTag?'#dbeafe':'white'}}/>
                      <input type="text" placeholder={addEntryForm.priorTag?'New tag #':'Tag #'} value={addEntryForm.tag} onChange={ev=>setAddEntryForm(f=>({...f, tag:ev.target.value}))} style={{fontSize:12, padding:'4px 8px', border:'1px solid #d1d5db', borderRadius:5, fontFamily:'inherit', width:90}}/>
                      <input type="number" min="0" step="0.1" placeholder="lb" value={addEntryForm.weight} onChange={ev=>setAddEntryForm(f=>({...f, weight:ev.target.value}))} style={{fontSize:12, padding:'4px 8px', border:'1px solid #d1d5db', borderRadius:5, fontFamily:'inherit', width:70}}/>
                      <input type="text" placeholder="Note (optional)" value={addEntryForm.note} onChange={ev=>setAddEntryForm(f=>({...f, note:ev.target.value}))} style={{fontSize:12, padding:'4px 8px', border:'1px solid #d1d5db', borderRadius:5, fontFamily:'inherit', flex:1, minWidth:100}}/>
                      <button onClick={()=>addEntryToSession(s)} disabled={!(parseFloat(addEntryForm.weight)>0)} style={{padding:'4px 12px', borderRadius:5, border:'none', background:(parseFloat(addEntryForm.weight)>0)?'#1e40af':'#d1d5db', color:'white', fontSize:11, fontWeight:600, cursor:(parseFloat(addEntryForm.weight)>0)?'pointer':'not-allowed', fontFamily:'inherit'}}>{addEntryForm.priorTag?'Swap + Add':'Add'}</button>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
      {showNewModal && <CattleNewWeighInModal sb={sb} onClose={()=>setShowNewModal(false)} onCreate={createNewSession}/>}
    </div>
  );
};

export default CattleWeighInsView;
