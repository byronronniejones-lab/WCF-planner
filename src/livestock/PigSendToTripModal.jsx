// ============================================================================
// PigSendToTripModal — Phase 2.1.4
// ============================================================================
// Verbatim byte-for-byte extraction from main.jsx. Pig weigh-in flow modal
// for assigning selected weigh-in entries to a processing trip. Self-contained
// — props carry session, selected entries, feeder groups, and callbacks.
// ============================================================================
import React from 'react';
const PigSendToTripModal = ({session, selectedEntries, feederGroups, onClose, onConfirm}) => {
  const {useState} = React;
  const [groupId, setGroupId] = useState('');
  const [mode, setMode] = useState('existing'); // existing | new
  const [tripId, setTripId] = useState('');
  const [newDate, setNewDate] = useState((session && session.date) || new Date().toISOString().slice(0,10));
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const active = feederGroups.filter(g => g.status === 'active');
  const group = feederGroups.find(g => g.id === groupId);
  const trips = group ? [...(group.processingTrips||[])].sort((a,b)=>(b.date||'').localeCompare(a.date||'')) : [];
  const totalWeight = selectedEntries.reduce((s,e)=>s+(parseFloat(e.weight)||0), 0);
  async function go() {
    if(!groupId) { setErr('Pick a feeder group.'); return; }
    if(mode === 'existing' && !tripId) { setErr('Pick an existing trip or switch to New.'); return; }
    if(mode === 'new' && !newDate) { setErr('Pick a date for the new trip.'); return; }
    setBusy(true); setErr('');
    try {
      await onConfirm({
        groupId,
        tripId: mode === 'existing' ? tripId : null,
        createNewWithDate: mode === 'new' ? newDate : null,
      });
    } catch(e){ setErr(e.message||'Failed'); setBusy(false); }
  }
  const lblS = {display:'block', fontSize:12, color:'#374151', marginBottom:4, fontWeight:600};
  const inpS = {fontFamily:'inherit', fontSize:13, padding:'8px 10px', border:'1px solid #d1d5db', borderRadius:6, width:'100%', boxSizing:'border-box', background:'white'};
  return (
    <div style={{position:'fixed', inset:0, background:'rgba(0,0,0,.45)', zIndex:500, display:'flex', alignItems:'center', justifyContent:'center', padding:16}}>
      <div style={{background:'white', borderRadius:12, maxWidth:460, width:'100%', padding:'18px 20px', boxShadow:'0 12px 40px rgba(0,0,0,.25)'}}>
        <div style={{fontSize:15, fontWeight:700, color:'#111827', marginBottom:10}}>{'\ud83d\ude9a Send '+selectedEntries.length+' weigh-ins to Trip'}</div>
        <div style={{fontSize:11, color:'#6b7280', marginBottom:14}}>{'Total live weight: '+totalWeight.toFixed(1)+' lb'}</div>
        <div style={{marginBottom:10}}>
          <label style={lblS}>Feeder group *</label>
          <select value={groupId} onChange={e=>{setGroupId(e.target.value); setTripId(''); setMode('existing');}} style={inpS}>
            <option value=''>Select group...</option>
            {active.map(g => <option key={g.id} value={g.id}>{g.batchName+' ('+(g.processingTrips||[]).length+' trips)'}</option>)}
          </select>
        </div>
        {groupId && (
          <div style={{marginBottom:10}}>
            <div style={{display:'flex', gap:6, marginBottom:6}}>
              <button type="button" onClick={()=>setMode('existing')} disabled={trips.length===0} style={{flex:1, padding:'6px 10px', borderRadius:6, border:'1px solid '+(mode==='existing'?'#1e40af':'#d1d5db'), background:mode==='existing'?'#1e40af':'white', color:mode==='existing'?'white':(trips.length===0?'#d1d5db':'#374151'), fontSize:12, fontWeight:600, cursor:trips.length===0?'not-allowed':'pointer', fontFamily:'inherit'}}>{'Existing trip ('+trips.length+')'}</button>
              <button type="button" onClick={()=>setMode('new')} style={{flex:1, padding:'6px 10px', borderRadius:6, border:'1px solid '+(mode==='new'?'#1e40af':'#d1d5db'), background:mode==='new'?'#1e40af':'white', color:mode==='new'?'white':'#374151', fontSize:12, fontWeight:600, cursor:'pointer', fontFamily:'inherit'}}>+ New trip</button>
            </div>
            {mode === 'existing' && (
              <select value={tripId} onChange={e=>setTripId(e.target.value)} style={inpS}>
                <option value=''>Select trip...</option>
                {trips.map(t => <option key={t.id} value={t.id}>{t.date+' \u00b7 '+((t.pigCount||0))+' pigs'}</option>)}
              </select>
            )}
            {mode === 'new' && (
              <div>
                <label style={lblS}>Trip date *</label>
                <input type="date" value={newDate} onChange={e=>setNewDate(e.target.value)} style={inpS}/>
              </div>
            )}
          </div>
        )}
        {err && <div style={{color:'#b91c1c', fontSize:12, marginBottom:10, padding:'6px 10px', background:'#fef2f2', borderRadius:6}}>{err}</div>}
        <div style={{display:'flex', gap:8, justifyContent:'flex-end'}}>
          <button onClick={onClose} disabled={busy} style={{padding:'8px 14px', borderRadius:7, border:'1px solid #d1d5db', background:'white', color:'#374151', fontWeight:600, fontSize:12, cursor:busy?'not-allowed':'pointer', fontFamily:'inherit'}}>Cancel</button>
          <button onClick={go} disabled={busy || !groupId || (mode==='existing' && !tripId)} style={{padding:'8px 16px', borderRadius:7, border:'none', background:(busy||!groupId||(mode==='existing'&&!tripId))?'#9ca3af':'#047857', color:'white', fontWeight:700, fontSize:12, cursor:(busy||!groupId||(mode==='existing'&&!tripId))?'not-allowed':'pointer', fontFamily:'inherit'}}>{busy?'Sending\u2026':'Send'}</button>
        </div>
      </div>
    </div>
  );
};

export default PigSendToTripModal;
