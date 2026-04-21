// Phase 2 Round 3 extraction (verbatim).
import React from 'react';
import UsersModal from '../auth/UsersModal.jsx';
import AdminAddReportModal from '../shared/AdminAddReportModal.jsx';
import AdminNewWeighInModal from '../shared/AdminNewWeighInModal.jsx';
import PigSendToTripModal from '../livestock/PigSendToTripModal.jsx';
import CattleNewWeighInModal from './CattleNewWeighInModal.jsx';
import LivestockWeighInsView from '../livestock/LivestockWeighInsView.jsx';
import { loadCattleWeighInsCached } from '../lib/cattleCache.js';
const CattleBatchesView = ({sb, fmt, Header, authState, setView, showUsers, setShowUsers, allUsers, setAllUsers, loadUsers}) => {
  const {useState, useEffect} = React;
  const [batches, setBatches] = useState([]);
  const [cattle, setCattle] = useState([]);
  const [weighIns, setWeighIns] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editId, setEditId] = useState(null);
  const [form, setForm] = useState(null);
  // Per-cow weight input local state keyed by `${batchId}|${cattleId}|${field}`
  // so editing doesn't round-trip to Supabase on every keystroke.
  const [cowDraft, setCowDraft] = useState({});

  async function loadAll() {
    const [bR, cR, wAll] = await Promise.all([
      sb.from('cattle_processing_batches').select('*').order('planned_process_date',{ascending:false}),
      sb.from('cattle').select('*'),
      loadCattleWeighInsCached(sb),
    ]);
    if(bR.data) setBatches(bR.data);
    if(cR.data) setCattle(cR.data);
    setWeighIns(wAll);
    setLoading(false);
  }
  useEffect(()=>{ loadAll(); }, []);

  function cowTagSet(cow) {
    // Includes current WCF tag + prior WCF tags (source='weigh_in' retags).
    // Excludes purchase-farm tags (source='import') because those are the
    // selling farm's numbers and can collide with other WCF cows' tags.
    const set = new Set();
    if(cow && cow.tag) set.add(cow.tag);
    if(cow && Array.isArray(cow.old_tags)) {
      for(const ot of cow.old_tags) {
        if(!ot || !ot.tag) continue;
        if(ot.source === 'import') continue;
        set.add(ot.tag);
      }
    }
    return set;
  }
  function lastWeight(cow) {
    const tags = cowTagSet(cow);
    if(tags.size === 0) return null;
    const sorted = [...weighIns].filter(w => tags.has(w.tag)).sort((a,b)=>(b.entered_at||'').localeCompare(a.entered_at||''));
    return sorted[0] ? parseFloat(sorted[0].weight) : null;
  }

  function cowsDetailOf(batch) {
    return Array.isArray(batch.cows_detail) ? batch.cows_detail : [];
  }
  function recomputeTotals(rows) {
    const live = rows.reduce((s,r) => s + (parseFloat(r.live_weight)||0), 0);
    const hang = rows.reduce((s,r) => s + (parseFloat(r.hanging_weight)||0), 0);
    return {
      total_live_weight: live > 0 ? Math.round(live*10)/10 : null,
      total_hanging_weight: hang > 0 ? Math.round(hang*10)/10 : null,
    };
  }

  function openAdd() {
    const yr = new Date().getFullYear().toString().slice(-2);
    const existing = batches.filter(b => b.name && b.name.startsWith('C-'+yr+'-')).map(b => parseInt(b.name.slice(5))||0);
    const next = (Math.max(0, ...existing)+1).toString().padStart(2,'0');
    setForm({name:'C-'+yr+'-'+next, planned_process_date:'', actual_process_date:'', processing_cost:'', notes:'', status:'planned', selectedCowIds:[]});
    setEditId(null);
    setShowForm(true);
  }
  function openEdit(b) {
    setForm({
      name: b.name,
      planned_process_date: b.planned_process_date || '',
      actual_process_date: b.actual_process_date || '',
      processing_cost: b.processing_cost != null ? String(b.processing_cost) : '',
      notes: b.notes || '',
      status: b.status || 'planned',
      selectedCowIds: [],
    });
    setEditId(b.id);
    setShowForm(true);
  }
  async function saveBatch() {
    if(!form.name.trim()) { alert('Batch name required.'); return; }
    const rec = {
      name: form.name.trim(),
      planned_process_date: form.planned_process_date || null,
      actual_process_date: form.actual_process_date || null,
      processing_cost: form.processing_cost !== '' ? parseFloat(form.processing_cost) : null,
      notes: form.notes || null,
      status: form.status || 'planned',
    };
    if(editId) {
      await sb.from('cattle_processing_batches').update(rec).eq('id', editId);
      // If marking complete, auto-move all linked cattle to 'processed'
      if(rec.status === 'complete') {
        const linked = cattle.filter(c => c.processing_batch_id === editId);
        for(const c of linked) {
          if(c.herd !== 'processed') {
            await sb.from('cattle').update({herd:'processed'}).eq('id', c.id);
            await sb.from('cattle_transfers').insert({
              id: String(Date.now())+Math.random().toString(36).slice(2,6),
              cattle_id: c.id,
              from_herd: c.herd,
              to_herd: 'processed',
              reason: 'processing_batch',
              reference_id: editId,
              team_member: authState && authState.name ? authState.name : null,
            });
          }
        }
      }
    } else {
      const id = String(Date.now())+Math.random().toString(36).slice(2,6);
      // Build cows_detail from selected cows + wire processing_batch_id + transfers
      const selected = (form.selectedCowIds||[]).map(cid => cattle.find(c => c.id === cid)).filter(Boolean);
      const cows_detail = selected.map(c => ({
        cattle_id: c.id,
        tag: c.tag || null,
        live_weight: lastWeight(c),
        hanging_weight: null,
      }));
      const tots = recomputeTotals(cows_detail);
      await sb.from('cattle_processing_batches').insert({id, ...rec, cows_detail, ...tots});
      for(const c of selected) {
        await sb.from('cattle').update({processing_batch_id: id, herd:'processed'}).eq('id', c.id);
        if(c.herd !== 'processed') {
          await sb.from('cattle_transfers').insert({
            id: String(Date.now())+Math.random().toString(36).slice(2,6),
            cattle_id: c.id,
            from_herd: c.herd,
            to_herd: 'processed',
            reason: 'processing_batch',
            reference_id: id,
            team_member: authState && authState.name ? authState.name : null,
          });
        }
      }
    }
    await loadAll();
    setShowForm(false); setEditId(null); setForm(null);
  }
  async function deleteBatch(id) {
    if(!window._wcfConfirmDelete) return;
    window._wcfConfirmDelete('Delete this processing batch? Linked cattle will keep their processed_batch_id set to NULL.', async () => {
      // Clear processing_batch_id on all linked cows so they don't hold stale FKs.
      await sb.from('cattle').update({processing_batch_id: null}).eq('processing_batch_id', id);
      await sb.from('cattle_processing_batches').delete().eq('id', id);
      await loadAll();
      setShowForm(false); setEditId(null); setForm(null);
    });
  }
  async function addCowToBatch(batch, cowId) {
    const cow = cattle.find(c => c.id === cowId);
    if(!cow) return;
    // Append to cows_detail if not already present
    const rows = cowsDetailOf(batch);
    if(!rows.some(r => r.cattle_id === cowId)) {
      const newRows = [...rows, {cattle_id: cowId, tag: cow.tag || null, live_weight: lastWeight(cow), hanging_weight: null}];
      const tots = recomputeTotals(newRows);
      await sb.from('cattle_processing_batches').update({cows_detail: newRows, ...tots}).eq('id', batch.id);
    }
    await sb.from('cattle').update({processing_batch_id: batch.id, herd: 'processed'}).eq('id', cowId);
    if(cow.herd !== 'processed') {
      await sb.from('cattle_transfers').insert({
        id: String(Date.now())+Math.random().toString(36).slice(2,6),
        cattle_id: cowId,
        from_herd: cow.herd,
        to_herd: 'processed',
        reason: 'processing_batch',
        reference_id: batch.id,
        team_member: authState && authState.name ? authState.name : null,
      });
    }
    await loadAll();
  }
  async function removeCowFromBatch(batch, cow) {
    const rows = cowsDetailOf(batch).filter(r => r.cattle_id !== cow.id);
    const tots = recomputeTotals(rows);
    await sb.from('cattle_processing_batches').update({cows_detail: rows, ...tots}).eq('id', batch.id);
    await sb.from('cattle').update({processing_batch_id: null}).eq('id', cow.id);
    await loadAll();
  }
  async function saveCowWeight(batch, cattleId, field, value) {
    const rows = cowsDetailOf(batch).map(r => r.cattle_id === cattleId
      ? {...r, [field]: value === '' || value == null ? null : parseFloat(value)}
      : r);
    const tots = recomputeTotals(rows);
    await sb.from('cattle_processing_batches').update({cows_detail: rows, ...tots}).eq('id', batch.id);
    setBatches(prev => prev.map(b => b.id === batch.id ? {...b, cows_detail: rows, ...tots} : b));
  }

  const inpS = {fontSize:13, padding:'7px 10px', border:'1px solid #d1d5db', borderRadius:6, fontFamily:'inherit', width:'100%', boxSizing:'border-box'};
  const lbl = {fontSize:11, color:'#6b7280', display:'block', marginBottom:3, fontWeight:500};

  return (
    <div style={{minHeight:'100vh', background:'#f1f3f2'}}>
      {showUsers && <UsersModal sb={sb} authState={authState} allUsers={allUsers} setAllUsers={setAllUsers} setShowUsers={setShowUsers} loadUsers={loadUsers}/>}
      <Header/>
      <div style={{padding:'1rem', maxWidth:1100, margin:'0 auto'}}>
        <div style={{display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:12}}>
          <div style={{fontSize:16, fontWeight:700, color:'#111827'}}>Processing Batches <span style={{fontSize:13, fontWeight:400, color:'#6b7280'}}>({batches.length})</span></div>
          <button onClick={openAdd} style={{padding:'7px 16px', borderRadius:7, border:'none', background:'#991b1b', color:'white', fontWeight:600, fontSize:12, cursor:'pointer', fontFamily:'inherit'}}>+ New Batch</button>
        </div>

        {loading && <div style={{textAlign:'center', padding:'2rem', color:'#9ca3af'}}>Loading{'\u2026'}</div>}
        {!loading && batches.length === 0 && (
          <div style={{background:'white', border:'1px solid #e5e7eb', borderRadius:12, padding:'2rem', textAlign:'center', color:'#6b7280', fontSize:13}}>
            No processing batches yet. Click <strong>+ New Batch</strong> to plan one. Once created, you can attach cattle from the Herds tab.
          </div>
        )}

        <div style={{display:'flex', flexDirection:'column', gap:10}}>
          {batches.map(b => {
            const rows = cowsDetailOf(b);
            const totalLive = rows.reduce((s,r) => s + (parseFloat(r.live_weight)||0), 0);
            const totalHang = rows.reduce((s,r) => s + (parseFloat(r.hanging_weight)||0), 0);
            const yieldPct = totalLive > 0 && totalHang > 0 ? Math.round((totalHang/totalLive)*1000)/10 : null;
            const draftKey = (cid, field) => `${b.id}|${cid}|${field}`;
            const draftVal = (cid, field, curr) => {
              const k = draftKey(cid, field);
              return cowDraft[k] != null ? cowDraft[k] : (curr != null ? String(curr) : '');
            };
            return (
              <div key={b.id} style={{background:'white', border:'1px solid #e5e7eb', borderRadius:12, padding:'14px 18px'}}>
                <div style={{display:'flex', alignItems:'center', gap:10, marginBottom:8, flexWrap:'wrap'}}>
                  <span style={{fontSize:14, fontWeight:700, color:'#111827'}}>{b.name}</span>
                  <span style={{fontSize:10, fontWeight:700, padding:'2px 8px', borderRadius:10, background:b.status==='complete'?'#374151':'#1d4ed8', color:'white', textTransform:'uppercase'}}>{b.status}</span>
                  <span style={{fontSize:11, color:'#6b7280'}}>{rows.length} {rows.length===1?'cow':'cows'}</span>
                  {b.planned_process_date && <span style={{fontSize:11, color:'#6b7280'}}>planned {fmt(b.planned_process_date)}</span>}
                  {b.actual_process_date && <span style={{fontSize:11, color:'#065f46'}}>processed {fmt(b.actual_process_date)}</span>}
                  <button onClick={()=>openEdit(b)} style={{marginLeft:'auto', fontSize:11, color:'#1d4ed8', background:'none', border:'none', cursor:'pointer'}}>Edit</button>
                </div>
                <div style={{display:'grid', gridTemplateColumns:'repeat(auto-fit, minmax(120px, 1fr))', gap:8, fontSize:11, color:'#4b5563', marginBottom:10}}>
                  <div><div style={{color:'#9ca3af', fontSize:10, textTransform:'uppercase'}}>Live wt total</div><div style={{fontWeight:600}}>{totalLive>0?Math.round(totalLive).toLocaleString()+' lb':'\u2014'}</div></div>
                  <div><div style={{color:'#9ca3af', fontSize:10, textTransform:'uppercase'}}>Hanging wt</div><div style={{fontWeight:600}}>{totalHang>0?Math.round(totalHang).toLocaleString()+' lb':'\u2014'}</div></div>
                  <div><div style={{color:'#9ca3af', fontSize:10, textTransform:'uppercase'}}>Yield</div><div style={{fontWeight:600, color:yieldPct?'#065f46':'#9ca3af'}}>{yieldPct?yieldPct+'%':'\u2014'}</div></div>
                  <div><div style={{color:'#9ca3af', fontSize:10, textTransform:'uppercase'}}>Cost</div><div style={{fontWeight:600}}>{b.processing_cost?'$'+b.processing_cost.toLocaleString():'\u2014'}</div></div>
                </div>
                {rows.length > 0 && (
                  <div style={{border:'1px solid #f3f4f6', borderRadius:8, overflow:'hidden', marginBottom:8}}>
                    <div style={{display:'grid', gridTemplateColumns:'70px 90px 1fr 1fr 60px 28px', gap:6, background:'#f9fafb', padding:'6px 10px', fontSize:10, fontWeight:700, color:'#6b7280', textTransform:'uppercase', letterSpacing:.5, alignItems:'center'}}>
                      <div>Tag</div>
                      <div>Breed</div>
                      <div>Live wt (lb)</div>
                      <div>Hanging wt (lb)</div>
                      <div style={{textAlign:'right'}}>Yield</div>
                      <div></div>
                    </div>
                    {rows.map(r => {
                      const cow = cattle.find(c => c.id === r.cattle_id);
                      const lv = parseFloat(r.live_weight);
                      const hw = parseFloat(r.hanging_weight);
                      const y = (lv > 0 && hw > 0) ? Math.round((hw/lv)*1000)/10 : null;
                      return (
                        <div key={r.cattle_id} style={{display:'grid', gridTemplateColumns:'70px 90px 1fr 1fr 60px 28px', gap:6, padding:'5px 10px', fontSize:12, borderTop:'1px solid #f3f4f6', alignItems:'center'}}>
                          <div style={{fontWeight:700, color:'#111827'}}>{'#'+(r.tag||cow?.tag||'?')}</div>
                          <div style={{fontSize:11, color:'#6b7280'}}>{cow?.breed||'\u2014'}</div>
                          <input type="number" min="0" step="0.1" placeholder="\u2014"
                            value={draftVal(r.cattle_id,'live',r.live_weight)}
                            onChange={e => setCowDraft(p => ({...p, [draftKey(r.cattle_id,'live')]: e.target.value}))}
                            onBlur={e => { saveCowWeight(b, r.cattle_id, 'live_weight', e.target.value); setCowDraft(p => { const x={...p}; delete x[draftKey(r.cattle_id,'live')]; return x; }); }}
                            style={{fontSize:12, padding:'4px 8px', border:'1px solid #e5e7eb', borderRadius:5, fontFamily:'inherit', width:'100%', boxSizing:'border-box'}}/>
                          <input type="number" min="0" step="0.1" placeholder="\u2014"
                            value={draftVal(r.cattle_id,'hanging',r.hanging_weight)}
                            onChange={e => setCowDraft(p => ({...p, [draftKey(r.cattle_id,'hanging')]: e.target.value}))}
                            onBlur={e => { saveCowWeight(b, r.cattle_id, 'hanging_weight', e.target.value); setCowDraft(p => { const x={...p}; delete x[draftKey(r.cattle_id,'hanging')]; return x; }); }}
                            style={{fontSize:12, padding:'4px 8px', border:'1px solid #e5e7eb', borderRadius:5, fontFamily:'inherit', width:'100%', boxSizing:'border-box'}}/>
                          <div style={{textAlign:'right', fontSize:11, color:y?'#065f46':'#9ca3af', fontWeight:y?600:400}}>{y?y+'%':'\u2014'}</div>
                          <button onClick={()=>removeCowFromBatch(b, cow||{id:r.cattle_id})} title="Remove from batch" style={{background:'none', border:'none', color:'#b91c1c', cursor:'pointer', fontSize:14, lineHeight:1, padding:'0 2px', fontFamily:'inherit'}}>{'\u00d7'}</button>
                        </div>
                      );
                    })}
                  </div>
                )}
                {(() => {
                  const inBatch = new Set(rows.map(r => r.cattle_id));
                  const available = cattle.filter(c => c.herd === 'finishers' && !c.processing_batch_id && !inBatch.has(c.id)).sort((a,b)=>(parseFloat(a.tag)||0)-(parseFloat(b.tag)||0));
                  return (
                    <select value="" onChange={e => { if(e.target.value) addCowToBatch(b, e.target.value); e.target.value=''; }} style={{fontSize:11, padding:'4px 8px', borderRadius:5, border:'1px solid #d1d5db', fontFamily:'inherit', maxWidth:320}}>
                      <option value="">{'+ Add cow from finishers ('+available.length+' available)'}</option>
                      {available.map(c => <option key={c.id} value={c.id}>{'#'+c.tag+(c.breed?' \u00b7 '+c.breed:'')+(lastWeight(c)?' \u00b7 '+Math.round(lastWeight(c))+' lb':'')}</option>)}
                    </select>
                  );
                })()}
                {b.notes && <div style={{marginTop:6, fontSize:11, color:'#6b7280', fontStyle:'italic'}}>{b.notes}</div>}
              </div>
            );
          })}
        </div>
      </div>

      {/* Batch form modal */}
      {showForm && form && (
        <div onClick={()=>{setShowForm(false); setEditId(null); setForm(null);}} style={{position:'fixed', top:0, left:0, right:0, bottom:0, background:'rgba(0,0,0,.45)', zIndex:500, display:'flex', alignItems:'flex-start', justifyContent:'center', padding:'1rem', overflowY:'auto'}}>
          <div onClick={e=>e.stopPropagation()} style={{background:'white', borderRadius:12, width:'100%', maxWidth:480, boxShadow:'0 8px 32px rgba(0,0,0,.2)', marginTop:40}}>
            <div style={{padding:'14px 20px', borderBottom:'1px solid #e5e7eb', display:'flex', justifyContent:'space-between', alignItems:'center'}}>
              <div style={{fontSize:15, fontWeight:600, color:'#991b1b'}}>{editId ? 'Edit Batch' : 'New Processing Batch'}</div>
              <button onClick={()=>{setShowForm(false); setEditId(null); setForm(null);}} style={{background:'none', border:'none', fontSize:22, cursor:'pointer', color:'#9ca3af'}}>{'\u00d7'}</button>
            </div>
            <div style={{padding:'16px 20px'}}>
              <div style={{display:'grid', gridTemplateColumns:'1fr 1fr', gap:10}}>
                <div style={{gridColumn:'1/-1'}}><label style={lbl}>Name *</label><input value={form.name} onChange={e=>setForm({...form, name:e.target.value})} style={inpS}/></div>
                <div><label style={lbl}>Status</label>
                  <select value={form.status} onChange={e=>setForm({...form, status:e.target.value})} style={inpS}>
                    <option value='planned'>Planned</option><option value='complete'>Complete</option>
                  </select>
                </div>
                <div><label style={lbl}>Processing Cost ($)</label><input type="number" min="0" step="0.01" value={form.processing_cost} onChange={e=>setForm({...form, processing_cost:e.target.value})} style={inpS}/></div>
                <div><label style={lbl}>Planned Process Date</label><input type="date" value={form.planned_process_date} onChange={e=>setForm({...form, planned_process_date:e.target.value})} style={inpS}/></div>
                <div><label style={lbl}>Actual Process Date</label><input type="date" value={form.actual_process_date} onChange={e=>setForm({...form, actual_process_date:e.target.value})} style={inpS}/></div>
                <div style={{gridColumn:'1/-1'}}><label style={lbl}>Notes</label><textarea value={form.notes} onChange={e=>setForm({...form, notes:e.target.value})} rows={2} style={{...inpS, resize:'vertical'}}/></div>
              </div>
              {!editId && (() => {
                const available = cattle.filter(c => c.herd === 'finishers' && !c.processing_batch_id).sort((a,b)=>(parseFloat(a.tag)||0)-(parseFloat(b.tag)||0));
                const selectedSet = new Set(form.selectedCowIds||[]);
                const toggle = (cowId) => {
                  const next = new Set(selectedSet);
                  if(next.has(cowId)) next.delete(cowId); else next.add(cowId);
                  setForm({...form, selectedCowIds:[...next]});
                };
                return (
                  <div style={{marginTop:12}}>
                    <div style={{display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:6}}>
                      <label style={{...lbl, margin:0}}>{'Add cows from finishers ('+available.length+' available, '+selectedSet.size+' selected)'}</label>
                      {available.length > 0 && (
                        <button type="button" onClick={()=>setForm({...form, selectedCowIds: selectedSet.size===available.length?[]:available.map(c=>c.id)})} style={{fontSize:11, color:'#1d4ed8', background:'none', border:'none', cursor:'pointer', fontFamily:'inherit'}}>{selectedSet.size===available.length?'Clear all':'Select all'}</button>
                      )}
                    </div>
                    {available.length === 0 && <div style={{fontSize:11, color:'#9ca3af', fontStyle:'italic'}}>No unassigned finishers available.</div>}
                    {available.length > 0 && (
                      <div style={{maxHeight:220, overflowY:'auto', border:'1px solid #e5e7eb', borderRadius:6, padding:6, display:'grid', gridTemplateColumns:'repeat(auto-fill, minmax(140px, 1fr))', gap:4}}>
                        {available.map(c => {
                          const selected = selectedSet.has(c.id);
                          const lw = lastWeight(c);
                          return (
                            <label key={c.id} style={{display:'flex', alignItems:'center', gap:6, padding:'4px 8px', borderRadius:5, background:selected?'#dbeafe':'transparent', cursor:'pointer', fontSize:12}}>
                              <input type="checkbox" checked={selected} onChange={()=>toggle(c.id)} style={{margin:0}}/>
                              <span style={{fontWeight:700, color:'#111827'}}>{'#'+c.tag}</span>
                              {lw && <span style={{fontSize:11, color:'#6b7280', marginLeft:'auto'}}>{Math.round(lw)} lb</span>}
                            </label>
                          );
                        })}
                      </div>
                    )}
                  </div>
                );
              })()}
              {form.status === 'complete' && editId && (
                <div style={{marginTop:10, padding:'8px 12px', background:'#fef3c7', border:'1px solid #fde68a', borderRadius:6, fontSize:11, color:'#92400e'}}>
                  {'\u26a0 Marking this batch complete will auto-move all linked cattle to the Processed herd.'}
                </div>
              )}
            </div>
            <div style={{padding:'12px 20px', borderTop:'1px solid #e5e7eb', display:'flex', gap:8}}>
              <button onClick={saveBatch} style={{padding:'8px 20px', borderRadius:7, border:'none', background:'#991b1b', color:'white', fontWeight:600, fontSize:13, cursor:'pointer', fontFamily:'inherit'}}>Save</button>
              {editId && <button onClick={()=>deleteBatch(editId)} style={{padding:'8px 16px', borderRadius:7, border:'1px solid #F09595', background:'white', color:'#b91c1c', fontSize:13, cursor:'pointer', fontFamily:'inherit'}}>Delete</button>}
              <button onClick={()=>{setShowForm(false); setEditId(null); setForm(null);}} style={{padding:'8px 16px', borderRadius:7, border:'1px solid #d1d5db', background:'white', color:'#6b7280', fontSize:13, cursor:'pointer', fontFamily:'inherit'}}>Cancel</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default CattleBatchesView;
