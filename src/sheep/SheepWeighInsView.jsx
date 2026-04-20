// Auto-extracted by Phase 2 Round 2 (verbatim). See MIGRATION_PLAN §6.
import React from 'react';

const SheepWeighInsView = ({sb, fmt, Header, authState, setView, showUsers, setShowUsers, allUsers, setAllUsers, loadUsers}) => {
  const {useState, useEffect} = React;
  const [sessions, setSessions] = useState([]);
  const [entries, setEntries] = useState({}); // session_id → entries[]
  const [sheep, setSheep] = useState([]);
  const [loading, setLoading] = useState(true);
  const [expandedId, setExpandedId] = useState(null);
  const [showNewSession, setShowNewSession] = useState(false);
  const [newSessForm, setNewSessForm] = useState({date: new Date().toISOString().slice(0,10), team_member:(authState && authState.name) || '', herd:'ewes', notes:''});
  const [tagSearch, setTagSearch] = useState('');
  const [addEntry, setAddEntry] = useState({tag:'', weight:'', note:''});
  const [busy, setBusy] = useState(false);
  const FLOCKS = ['rams','ewes','feeders'];
  const FLOCK_LABELS = {rams:'Rams', ewes:'Ewes', feeders:'Feeders'};

  async function loadAll() {
    setLoading(true);
    const sR = await sb.from('weigh_in_sessions').select('*').eq('species','sheep').order('date',{ascending:false}).limit(200);
    const sessIds = (sR.data||[]).map(s => s.id);
    const eR = sessIds.length > 0 ? await sb.from('weigh_ins').select('*').in('session_id', sessIds).order('entered_at',{ascending:true}) : {data:[]};
    const shR = await sb.from('sheep').select('id,tag,flock').order('tag');
    if(sR.data) setSessions(sR.data);
    if(eR.data) {
      const grouped = {};
      eR.data.forEach(e => { (grouped[e.session_id] = grouped[e.session_id] || []).push(e); });
      setEntries(grouped);
    }
    if(shR.data) setSheep(shR.data);
    setLoading(false);
  }
  useEffect(()=>{ loadAll(); }, []);

  async function createSession() {
    if(!newSessForm.team_member) { alert('Pick a team member.'); return; }
    setBusy(true);
    const id = String(Date.now())+Math.random().toString(36).slice(2,6);
    const rec = {id, date:newSessForm.date, team_member:newSessForm.team_member, species:'sheep', herd:newSessForm.herd, status:'draft', notes:newSessForm.notes||null};
    const {error} = await sb.from('weigh_in_sessions').insert(rec);
    setBusy(false);
    if(error) { alert('Could not create session: '+error.message); return; }
    setShowNewSession(false);
    setNewSessForm({date: new Date().toISOString().slice(0,10), team_member:(authState && authState.name) || '', herd:'ewes', notes:''});
    await loadAll();
    setExpandedId(id);
  }
  async function addNewEntry(sessionId) {
    if(!addEntry.tag.trim() || !addEntry.weight || parseFloat(addEntry.weight) <= 0) { alert('Tag and weight are required.'); return; }
    setBusy(true);
    const id = String(Date.now())+Math.random().toString(36).slice(2,6);
    const rec = {id, session_id:sessionId, tag:addEntry.tag.trim(), weight:parseFloat(addEntry.weight), note:addEntry.note||null};
    const {error} = await sb.from('weigh_ins').insert(rec);
    setBusy(false);
    if(error) { alert('Save failed: '+error.message); return; }
    if(addEntry.note && addEntry.note.trim()) {
      const cow = sheep.find(s => s.tag === rec.tag);
      try {
        await sb.from('sheep_comments').insert({
          id: String(Date.now())+Math.random().toString(36).slice(2,6),
          sheep_id: cow ? cow.id : null, sheep_tag: rec.tag,
          comment: addEntry.note.trim(), team_member: newSessForm.team_member,
          source:'weigh_in', reference_id: id,
        });
      } catch(e){}
    }
    setAddEntry({tag:'', weight:'', note:''});
    await loadAll();
  }
  async function delEntry(id) {
    if(!confirm('Delete this entry?')) return;
    await sb.from('weigh_ins').delete().eq('id', id);
    try { await sb.from('sheep_comments').delete().eq('reference_id', id); } catch(e){}
    await loadAll();
  }
  async function completeSession(id) {
    if(!confirm('Mark session complete?')) return;
    await sb.from('weigh_in_sessions').update({status:'complete', completed_at:new Date().toISOString()}).eq('id', id);
    await loadAll();
  }
  async function delSession(id) {
    if(!confirm('Delete this session AND all its entries?')) return;
    await sb.from('weigh_ins').delete().eq('session_id', id);
    await sb.from('weigh_in_sessions').delete().eq('id', id);
    setExpandedId(null);
    await loadAll();
  }

  const filteredSessions = !tagSearch.trim() ? sessions : sessions.filter(s => {
    const ents = entries[s.id] || [];
    return ents.some(e => (e.tag||'').toLowerCase().includes(tagSearch.toLowerCase().trim()));
  });
  const inpS = {fontSize:13, padding:'7px 10px', border:'1px solid #d1d5db', borderRadius:6, fontFamily:'inherit', boxSizing:'border-box'};
  const tagSet = new Set(sheep.map(s => s.tag).filter(Boolean));

  return (
    <div style={{minHeight:'100vh', background:'#f1f3f2'}}>
      {showUsers && <UsersModal sb={sb} authState={authState} allUsers={allUsers} setAllUsers={setAllUsers} setShowUsers={setShowUsers} loadUsers={loadUsers}/>}
      <Header/>
      <div style={{padding:'1rem', maxWidth:1200, margin:'0 auto'}}>
        <div style={{background:'white', border:'1px solid #e5e7eb', borderRadius:10, padding:'12px 16px', marginBottom:14, display:'flex', alignItems:'center', gap:10, flexWrap:'wrap'}}>
          <div style={{fontSize:15, fontWeight:700, color:'#0f766e'}}>{'\ud83d\udc11 Sheep Weigh-Ins'}</div>
          <input type="text" value={tagSearch} onChange={e=>setTagSearch(e.target.value)} placeholder="Search tag #\u2026" style={{...inpS, width:180}}/>
          <div style={{flex:1}}/>
          <button onClick={()=>setShowNewSession(true)} style={{padding:'7px 16px', borderRadius:7, border:'none', background:'#0f766e', color:'white', fontWeight:600, fontSize:12, cursor:'pointer', fontFamily:'inherit'}}>+ New Session</button>
        </div>

        {showNewSession && (
          <div style={{background:'white', border:'1px solid #0f766e', borderRadius:10, padding:'14px 18px', marginBottom:14, display:'grid', gridTemplateColumns:'1fr 1fr 1fr 2fr auto', gap:10, alignItems:'end'}}>
            <div><label style={{fontSize:11, color:'#6b7280'}}>Date</label><input type="date" value={newSessForm.date} onChange={e=>setNewSessForm({...newSessForm, date:e.target.value})} style={inpS}/></div>
            <div><label style={{fontSize:11, color:'#6b7280'}}>Team Member</label><input type="text" value={newSessForm.team_member} onChange={e=>setNewSessForm({...newSessForm, team_member:e.target.value})} style={inpS}/></div>
            <div><label style={{fontSize:11, color:'#6b7280'}}>Flock</label><select value={newSessForm.herd} onChange={e=>setNewSessForm({...newSessForm, herd:e.target.value})} style={inpS}>{FLOCKS.map(f => <option key={f} value={f}>{FLOCK_LABELS[f]}</option>)}</select></div>
            <div><label style={{fontSize:11, color:'#6b7280'}}>Notes (optional)</label><input type="text" value={newSessForm.notes} onChange={e=>setNewSessForm({...newSessForm, notes:e.target.value})} style={inpS}/></div>
            <div style={{display:'flex', gap:6}}>
              <button onClick={()=>setShowNewSession(false)} style={{padding:'7px 14px', borderRadius:6, border:'1px solid #d1d5db', background:'white', fontSize:12, cursor:'pointer', fontFamily:'inherit'}}>Cancel</button>
              <button onClick={createSession} disabled={busy} style={{padding:'7px 16px', borderRadius:6, border:'none', background:'#0f766e', color:'white', fontSize:12, fontWeight:600, cursor:busy?'not-allowed':'pointer', fontFamily:'inherit'}}>Create</button>
            </div>
          </div>
        )}

        {loading && <div style={{textAlign:'center', padding:'2rem', color:'#9ca3af'}}>Loading{'\u2026'}</div>}
        {!loading && filteredSessions.length === 0 && <div style={{background:'white', border:'1px solid #e5e7eb', borderRadius:12, padding:'2rem', textAlign:'center', color:'#6b7280', fontSize:13}}>{tagSearch ? 'No sessions match that tag.' : 'No sheep weigh-in sessions yet. Click + New Session.'}</div>}

        {!loading && filteredSessions.map(s => {
          const isExp = expandedId === s.id;
          const ents = entries[s.id] || [];
          const visibleEnts = !tagSearch.trim() ? ents : ents.filter(e => (e.tag||'').toLowerCase().includes(tagSearch.toLowerCase().trim()));
          const totalWt = ents.reduce((sum,e)=>sum+(parseFloat(e.weight)||0), 0);
          const isComplete = s.status === 'complete';
          return (
            <div key={s.id} style={{background:'white', border:'1px solid #e5e7eb', borderRadius:12, marginBottom:10, overflow:'hidden'}}>
              <div onClick={()=>setExpandedId(isExp?null:s.id)} style={{padding:'10px 16px', display:'flex', alignItems:'center', gap:10, cursor:'pointer', borderBottom:isExp?'1px solid #e5e7eb':'none'}}>
                <span style={{fontSize:11, color:'#9ca3af'}}>{isExp?'\u25bc':'\u25b6'}</span>
                <span style={{fontSize:13, fontWeight:700, color:'#111827'}}>{fmt(s.date)}</span>
                <span style={{fontSize:11, padding:'2px 8px', borderRadius:4, background:'#f0fdfa', color:'#0f766e', border:'1px solid #5eead4', fontWeight:600}}>{FLOCK_LABELS[s.herd] || s.herd || '\u2014'}</span>
                <span style={{fontSize:11, color:'#6b7280'}}>{s.team_member||'\u2014'}</span>
                <span style={{fontSize:11, color:'#6b7280'}}>{visibleEnts.length}{tagSearch?' of '+ents.length:''} {ents.length===1?'entry':'entries'}</span>
                {totalWt > 0 && <span style={{fontSize:11, color:'#065f46', fontWeight:600}}>{Math.round(totalWt).toLocaleString()} lb total</span>}
                {isComplete ? <span style={{fontSize:10, padding:'1px 6px', borderRadius:3, background:'#dcfce7', color:'#166534', fontWeight:700}}>COMPLETE</span> : <span style={{fontSize:10, padding:'1px 6px', borderRadius:3, background:'#fef3c7', color:'#92400e', fontWeight:700}}>DRAFT</span>}
                <div style={{flex:1}}/>
                {!isComplete && <button onClick={(e)=>{e.stopPropagation();completeSession(s.id);}} style={{fontSize:11, padding:'3px 10px', borderRadius:5, border:'1px solid #166534', color:'#166534', background:'white', cursor:'pointer', fontFamily:'inherit', fontWeight:600}}>Mark Complete</button>}
                <button onClick={(e)=>{e.stopPropagation();delSession(s.id);}} style={{fontSize:11, padding:'3px 10px', borderRadius:5, border:'1px solid #fecaca', color:'#7f1d1d', background:'white', cursor:'pointer', fontFamily:'inherit'}}>Delete</button>
              </div>
              {isExp && (
                <div style={{padding:'12px 16px'}}>
                  {!isComplete && (
                    <div style={{display:'grid', gridTemplateColumns:'120px 100px 1fr auto', gap:8, marginBottom:12, alignItems:'end', padding:10, background:'#f9fafb', border:'1px solid #e5e7eb', borderRadius:8}}>
                      <div><label style={{fontSize:11, color:'#6b7280'}}>Tag #</label><input list="sheep-tags" type="text" value={addEntry.tag} onChange={e=>setAddEntry({...addEntry, tag:e.target.value})} style={inpS}/></div>
                      <div><label style={{fontSize:11, color:'#6b7280'}}>Weight (lb)</label><input type="number" value={addEntry.weight} onChange={e=>setAddEntry({...addEntry, weight:e.target.value})} style={inpS}/></div>
                      <div><label style={{fontSize:11, color:'#6b7280'}}>Note (optional)</label><input type="text" value={addEntry.note} onChange={e=>setAddEntry({...addEntry, note:e.target.value})} style={inpS}/></div>
                      <button onClick={()=>addNewEntry(s.id)} disabled={busy} style={{padding:'7px 14px', borderRadius:6, border:'none', background:'#0f766e', color:'white', fontSize:12, fontWeight:600, cursor:busy?'not-allowed':'pointer', fontFamily:'inherit'}}>+ Add Entry</button>
                      <datalist id="sheep-tags">{sheep.map(sh => <option key={sh.id} value={sh.tag}/>)}</datalist>
                    </div>
                  )}
                  {visibleEnts.length === 0 ? <div style={{fontSize:12, color:'#9ca3af', fontStyle:'italic'}}>No entries yet.</div> : (
                    <div style={{display:'grid', gridTemplateColumns:'repeat(auto-fill, minmax(200px, 1fr))', gap:8}}>
                      {visibleEnts.map(e => {
                        const known = tagSet.has(e.tag);
                        return (
                          <div key={e.id} style={{padding:'8px 10px', background:known?'white':'#fef3c7', border:'1px solid '+(known?'#e5e7eb':'#fde68a'), borderRadius:8, display:'flex', flexDirection:'column', gap:2}}>
                            <div style={{display:'flex', justifyContent:'space-between', alignItems:'center'}}>
                              <span style={{fontSize:13, fontWeight:700, color:known?'#111827':'#92400e'}}>{'#'+e.tag}{!known && ' \u2009*'}</span>
                              <button onClick={()=>delEntry(e.id)} style={{fontSize:10, padding:'1px 6px', borderRadius:3, border:'1px solid #fecaca', color:'#7f1d1d', background:'white', cursor:'pointer', fontFamily:'inherit'}}>{'\u00d7'}</button>
                            </div>
                            <div style={{fontSize:14, fontWeight:600, color:'#065f46'}}>{e.weight} lb</div>
                            {e.note && <div style={{fontSize:10, color:'#6b7280'}}>{e.note}</div>}
                            {!known && <div style={{fontSize:9, color:'#92400e'}}>* tag not in directory</div>}
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
};

export default SheepWeighInsView;
