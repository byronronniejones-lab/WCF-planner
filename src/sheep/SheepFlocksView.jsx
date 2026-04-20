// Phase 2 Round 3 extraction (verbatim).
import React from 'react';
import SheepBulkImport from './SheepBulkImport.jsx';
import SheepDetail from './SheepDetail.jsx';
const SheepFlocksView = ({sb, fmt, Header, authState, setView, showUsers, setShowUsers, allUsers, setAllUsers, loadUsers, pendingEdit, setPendingEdit}) => {
  const {useState, useEffect} = React;
  const [sheep, setSheep] = useState([]);
  const [weighIns, setWeighIns] = useState([]);
  const [lambingRecs, setLambingRecs] = useState([]);
  const [comments, setComments] = useState([]);
  const [breedOpts, setBreedOpts] = useState([]);
  const [originOpts, setOriginOpts] = useState([]);
  const [loading, setLoading] = useState(true);

  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('active');
  const [sortBy, setSortBy] = useState('tag-asc');
  const [showAddForm, setShowAddForm] = useState(false);
  const [showBulkImport, setShowBulkImport] = useState(false);
  const [editId, setEditId] = useState(null);
  const [form, setForm] = useState(null);
  const [saving, setSaving] = useState(false);
  const [expandedSheep, setExpandedSheep] = useState(null);
  const [expandedFlocks, setExpandedFlocks] = useState({});

  const FLOCKS = ['rams','ewes','feeders'];
  const OUTCOMES = ['processed','deceased','sold'];
  const ALL_FLOCKS = [...FLOCKS, ...OUTCOMES];
  const FLOCK_LABELS = {rams:'Rams', ewes:'Ewes', feeders:'Feeders', processed:'Processed', deceased:'Deceased', sold:'Sold'};
  const FLOCK_COLORS = {rams:{bg:'#f0fdfa',tx:'#0f766e',bd:'#5eead4'}, ewes:{bg:'#fdf4ff',tx:'#86198f',bd:'#f0abfc'}, feeders:{bg:'#fefce8',tx:'#854d0e',bd:'#fde047'}, processed:{bg:'#f3f4f6',tx:'#374151',bd:'#d1d5db'}, deceased:{bg:'#f9fafb',tx:'#6b7280',bd:'#e5e7eb'}, sold:{bg:'#eff6ff',tx:'#1e40af',bd:'#bfdbfe'}};

  const EMPTY_SHEEP = {
    tag:'', sex:'ewe', flock:'ewes', breed:'', breeding_blacklist:false,
    origin:'', birth_date:'', purchase_date:'', purchase_amount:'',
    dam_tag:'', dam_reg_num:'', sire_tag:'', sire_reg_num:'', registration_num:'',
    breeding_status:'', maternal_issue_flag:false, maternal_issue_desc:'',
    sale_date:'', sale_amount:'', death_date:'', death_reason:'',
    old_tags:[],
  };

  async function loadAll() {
    // Two-step weigh-in load (matches existing pattern — no relationship-name joins)
    const sessR = await sb.from('weigh_in_sessions').select('id,date,herd').eq('species','sheep');
    const sessIds = (sessR.data||[]).map(s => s.id);
    const wR = sessIds.length > 0 ? await sb.from('weigh_ins').select('*').in('session_id', sessIds).order('entered_at',{ascending:false}) : {data:[]};
    const [sR, lR, cR, brR, orR] = await Promise.all([
      sb.from('sheep').select('*').order('tag'),
      sb.from('sheep_lambing_records').select('*').order('lambing_date',{ascending:false}),
      sb.from('sheep_comments').select('*').order('created_at',{ascending:false}),
      sb.from('sheep_breeds').select('*').order('label'),
      sb.from('sheep_origins').select('*').order('label'),
    ]);
    if(sR.data) setSheep(sR.data);
    if(wR.data) setWeighIns(wR.data);
    if(lR.data) setLambingRecs(lR.data);
    if(cR.data) setComments(cR.data);
    if(brR.data) setBreedOpts(brR.data);
    if(orR.data) setOriginOpts(orR.data);
    setLoading(false);
  }
  useEffect(()=>{ loadAll(); }, []);

  function age(birth) {
    if(!birth) return null;
    const days = Math.floor((Date.now() - new Date(birth+'T12:00:00').getTime())/86400000);
    if(days < 0) return null;
    const y = Math.floor(days/365), m = Math.floor((days%365)/30);
    if(y > 0) return y+'y '+m+'m';
    return m+'m';
  }
  function lastWeight(s) {
    if(!s.tag) return null;
    const w = weighIns.find(x => x.tag === s.tag);
    return w ? parseFloat(w.weight) : null;
  }
  function calfCount(tag) { return sheep.filter(s => s.dam_tag === tag).length; }

  const filtered = sheep.filter(s => {
    const searching = !!search;
    if(!searching && statusFilter === 'active' && !FLOCKS.includes(s.flock)) return false;
    if(statusFilter !== 'all' && statusFilter !== 'active' && s.flock !== statusFilter) return false;
    if(searching) {
      const q = search.toLowerCase().trim();
      const fields = [s.tag, s.dam_tag, s.sire_tag, s.breed, s.origin].map(x => (x||'').toLowerCase());
      if(!fields.some(f => f.includes(q))) return false;
    }
    return true;
  });
  const sorted = [...filtered].sort((a,b) => {
    if(sortBy === 'tag-asc') return (parseFloat(a.tag)||0) - (parseFloat(b.tag)||0) || (a.tag||'').localeCompare(b.tag||'');
    if(sortBy === 'tag-desc') return (parseFloat(b.tag)||0) - (parseFloat(a.tag)||0) || (b.tag||'').localeCompare(a.tag||'');
    if(sortBy === 'age-asc') return (a.birth_date||'9999').localeCompare(b.birth_date||'9999');
    if(sortBy === 'age-desc') return (b.birth_date||'').localeCompare(a.birth_date||'');
    if(sortBy === 'weight-desc') return (lastWeight(b)||0) - (lastWeight(a)||0);
    if(sortBy === 'weight-asc') return (lastWeight(a)||0) - (lastWeight(b)||0);
    return 0;
  });

  function openAdd() { setForm({...EMPTY_SHEEP}); setEditId(null); setShowAddForm(true); }
  function openEdit(s) {
    setForm({...EMPTY_SHEEP, ...s,
      purchase_amount: s.purchase_amount != null ? String(s.purchase_amount) : '',
      sale_amount: s.sale_amount != null ? String(s.sale_amount) : '',
      birth_date: s.birth_date || '', purchase_date: s.purchase_date || '',
      sale_date: s.sale_date || '', death_date: s.death_date || '',
      breeding_status: s.breeding_status || '',
      maternal_issue_desc: s.maternal_issue_desc || '',
      old_tags: Array.isArray(s.old_tags) ? s.old_tags : [],
    });
    setEditId(s.id); setShowAddForm(true);
  }
  async function saveSheep() {
    if(!form.tag.trim()) { if(!confirm('Save sheep without a tag?')) return; }
    setSaving(true);
    const isEwe = form.sex === 'ewe';
    const rec = {
      tag: form.tag.trim() || null,
      sex: form.sex, flock: form.flock,
      breed: form.breed || null,
      breeding_blacklist: !!form.breeding_blacklist,
      origin: form.origin || null,
      birth_date: form.birth_date || null,
      purchase_date: form.purchase_date || null,
      purchase_amount: form.purchase_amount !== '' ? parseFloat(form.purchase_amount) : null,
      dam_tag: form.dam_tag || null, dam_reg_num: form.dam_reg_num || null,
      sire_tag: form.sire_tag || null, sire_reg_num: form.sire_reg_num || null,
      registration_num: form.registration_num || null,
      breeding_status: isEwe ? (form.breeding_status || null) : null,
      maternal_issue_flag: !!form.maternal_issue_flag,
      maternal_issue_desc: form.maternal_issue_desc || null,
      sale_date: form.sale_date || null,
      sale_amount: form.sale_amount !== '' ? parseFloat(form.sale_amount) : null,
      death_date: form.death_date || null, death_reason: form.death_reason || null,
      old_tags: Array.isArray(form.old_tags) ? form.old_tags : [],
    };
    let newId = editId;
    if(editId) {
      const {error} = await sb.from('sheep').update(rec).eq('id', editId);
      if(error) { alert('Save failed: '+error.message); setSaving(false); return; }
    } else {
      newId = (rec.tag ? 's-'+rec.tag : 's-'+Date.now()) + '-' + Math.random().toString(36).slice(2,5);
      const {error} = await sb.from('sheep').insert({id:newId, ...rec});
      if(error) { alert('Save failed: '+error.message); setSaving(false); return; }
    }
    setSaving(false); await loadAll();
    setShowAddForm(false); setEditId(null); setForm(null);
  }
  async function deleteSheep(id) {
    if(!confirm('Permanently delete this sheep? Lambing records, comments, and weigh-ins for this tag remain.')) return;
    await sb.from('sheep').delete().eq('id', id);
    await loadAll();
    setShowAddForm(false); setEditId(null); setForm(null); setExpandedSheep(null);
  }
  async function transferSheep(id, newFlock) {
    const s = sheep.find(x => x.id === id); if(!s) return;
    const updates = {flock: newFlock};
    if(newFlock === 'deceased' && !s.death_date) updates.death_date = new Date().toISOString().slice(0,10);
    if(newFlock === 'sold' && !s.sale_date) updates.sale_date = new Date().toISOString().slice(0,10);
    await sb.from('sheep').update(updates).eq('id', id);
    await loadAll();
  }
  async function addQuickComment(sheepId, sheepTag, text) {
    await sb.from('sheep_comments').insert({
      id: String(Date.now())+Math.random().toString(36).slice(2,6),
      sheep_id: sheepId, sheep_tag: sheepTag, comment: text,
      team_member: authState && authState.name ? authState.name : null, source: 'manual',
    });
    await loadAll();
  }
  async function addLambingRecord(s, formData) {
    if(!formData.lambing_date) { alert('Lambing date required.'); return false; }
    const id = String(Date.now())+Math.random().toString(36).slice(2,6);
    const rec = {
      id, dam_tag: s.tag, lambing_date: formData.lambing_date,
      total_born: parseInt(formData.total_born) || 0,
      deaths: parseInt(formData.deaths) || 0,
      complications_flag: !!formData.complications_flag,
      complications_desc: formData.complications_desc || null,
      notes: formData.notes || null,
    };
    const {error} = await sb.from('sheep_lambing_records').insert(rec);
    if(error) { alert('Save failed: '+error.message); return false; }
    try {
      const note = rec.total_born+' born'+(rec.deaths>0?', '+rec.deaths+' died':'');
      await sb.from('sheep_comments').insert({
        id: String(Date.now())+Math.random().toString(36).slice(2,6),
        sheep_id: s.id, sheep_tag: s.tag, comment: note,
        team_member: authState && authState.name ? authState.name : null,
        source: 'lambing', reference_id: id,
      });
    } catch(e){}
    await loadAll();
    return true;
  }
  async function deleteLambingRecord(recId) {
    if(!confirm('Delete this lambing record?')) return;
    await sb.from('sheep_lambing_records').delete().eq('id', recId);
    try { await sb.from('sheep_comments').delete().eq('reference_id', recId); } catch(e){}
    await loadAll();
  }

  const inpS = {fontSize:13, padding:'7px 10px', border:'1px solid #d1d5db', borderRadius:6, fontFamily:'inherit', width:'100%', boxSizing:'border-box'};
  const isFlatMode = search || (statusFilter !== 'active');

  return (
    <div style={{minHeight:'100vh', background:'#f1f3f2'}}>
      {showUsers && <UsersModal sb={sb} authState={authState} allUsers={allUsers} setAllUsers={setAllUsers} setShowUsers={setShowUsers} loadUsers={loadUsers}/>}
      <Header/>
      <div style={{padding:'1rem', maxWidth:1200, margin:'0 auto'}}>
        <div style={{background:'white', border:'1px solid #e5e7eb', borderRadius:10, padding:'12px 16px', marginBottom:14, display:'flex', alignItems:'center', gap:10, flexWrap:'wrap'}}>
          <input type="text" value={search} onChange={e=>setSearch(e.target.value)} placeholder="Search tag, dam, sire, breed, origin\u2026" style={{...inpS, flex:1, minWidth:200}}/>
          <select value={statusFilter} onChange={e=>setStatusFilter(e.target.value)} style={{...inpS, width:'auto'}}>
            <option value="active">All Active Flocks</option>
            <option value="all">All (incl. outcomes)</option>
            <option disabled>{'\u2500\u2500\u2500'}</option>
            {FLOCKS.map(f => <option key={f} value={f}>{FLOCK_LABELS[f]}</option>)}
            <option disabled>{'\u2500\u2500\u2500'}</option>
            {OUTCOMES.map(f => <option key={f} value={f}>{FLOCK_LABELS[f]}</option>)}
          </select>
          <select value={sortBy} onChange={e=>setSortBy(e.target.value)} style={{...inpS, width:'auto'}}>
            <option value="tag-asc">Tag {'\u2191'}</option><option value="tag-desc">Tag {'\u2193'}</option>
            <option value="age-asc">Age (youngest)</option><option value="age-desc">Age (oldest)</option>
            <option value="weight-desc">Weight {'\u2193'}</option><option value="weight-asc">Weight {'\u2191'}</option>
          </select>
          <button onClick={()=>setShowBulkImport(true)} style={{padding:'7px 14px', borderRadius:7, border:'1px solid #0f766e', background:'white', color:'#0f766e', fontWeight:600, fontSize:12, cursor:'pointer', fontFamily:'inherit', whiteSpace:'nowrap'}}>{'\ud83d\udce5'} Bulk Import</button>
          <button onClick={openAdd} style={{padding:'7px 16px', borderRadius:7, border:'none', background:'#0f766e', color:'white', fontWeight:600, fontSize:12, cursor:'pointer', fontFamily:'inherit', whiteSpace:'nowrap'}}>+ Add Sheep</button>
        </div>

        {showBulkImport && <SheepBulkImport sb={sb} breedOpts={breedOpts} originOpts={originOpts} existingSheep={sheep} onClose={()=>setShowBulkImport(false)} onComplete={loadAll}/>}

        {loading && <div style={{textAlign:'center', padding:'3rem', color:'#9ca3af'}}>Loading{'\u2026'}</div>}
        {!loading && sheep.length === 0 && (
          <div style={{background:'white', border:'1px solid #e5e7eb', borderRadius:12, padding:'2rem', textAlign:'center', color:'#6b7280', fontSize:13}}>
            No sheep records yet. Click <strong>+ Add Sheep</strong> or <strong>Bulk Import</strong>.
          </div>
        )}

        {!loading && isFlatMode && sheep.length > 0 && (
          <div style={{background:'white', border:'1px solid #e5e7eb', borderRadius:12, overflow:'hidden'}}>
            <div style={{padding:'10px 16px', borderBottom:'1px solid #e5e7eb', background:'#f9fafb', fontSize:12, fontWeight:600, color:'#4b5563'}}>{sorted.length} sheep match</div>
            {sorted.map((s, i) => {
              const fc = FLOCK_COLORS[s.flock] || FLOCK_COLORS.ewes;
              const lw = lastWeight(s);
              const isExp = expandedSheep === s.id;
              const myWi = weighIns.filter(w => w.tag === s.tag);
              const myLamb = lambingRecs.filter(r => r.dam_tag === s.tag);
              const myCom = comments.filter(c => c.sheep_id === s.id || c.sheep_tag === s.tag).slice(0, 20);
              return (
                <div key={s.id} style={{borderBottom:i<sorted.length-1?'1px solid #f3f4f6':'none'}}>
                  <div onClick={()=>setExpandedSheep(isExp?null:s.id)} style={{padding:'10px 16px', display:'grid', gridTemplateColumns:'24px 16px 70px 100px 60px 180px 70px 90px 1fr', alignItems:'center', gap:10, cursor:'pointer'}} className="hoverable-tile">
                    <span style={{fontSize:11, color:'#9ca3af', fontVariantNumeric:'tabular-nums', fontWeight:600}}>{i+1}</span>
                    <span style={{fontSize:11, color:'#9ca3af'}}>{isExp?'\u25bc':'\u25b6'}</span>
                    <span style={{fontWeight:700, fontSize:13, color:'#111827'}}>{s.tag ? '#'+s.tag : '(no tag)'}</span>
                    <span style={{fontSize:11, padding:'2px 8px', borderRadius:4, background:fc.bg, color:fc.tx, border:'1px solid '+fc.bd, fontWeight:600, textAlign:'center', whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis'}}>{FLOCK_LABELS[s.flock]}</span>
                    <span style={{fontSize:11, color:'#6b7280'}}>{(s.sex||'\u2014').toUpperCase()}</span>
                    <span style={{fontSize:11, color:'#6b7280', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap'}}>{s.breed||'\u2014'}</span>
                    <span style={{fontSize:11, color:'#6b7280'}}>{age(s.birth_date)||'\u2014'}</span>
                    <span style={{fontSize:11, color:lw?'#065f46':'#9ca3af', fontWeight:lw?600:400}}>{lw ? lw.toLocaleString()+' lb' : 'no weigh-in'}</span>
                    <span style={{display:'flex', gap:8, alignItems:'center', flexWrap:'wrap'}}>
                      {s.dam_tag && <span style={{fontSize:11, color:'#9ca3af'}}>{'dam #'+s.dam_tag}</span>}
                    </span>
                  </div>
                  {isExp && <SheepDetail sheep={s} weighIns={myWi} lambing={myLamb} comments={myCom} lambs={sheep.filter(x => x.dam_tag === s.tag)} dam={sheep.find(x => x.tag === s.dam_tag)} fmt={fmt} FLOCK_LABELS={FLOCK_LABELS} onEdit={()=>openEdit(s)} onTransfer={(nf)=>transferSheep(s.id, nf)} onDelete={()=>deleteSheep(s.id)} onComment={(t)=>addQuickComment(s.id, s.tag, t)} onAddLambing={(d)=>addLambingRecord(s, d)} onDeleteLambing={(rid)=>deleteLambingRecord(rid)}/>}
                </div>
              );
            })}
          </div>
        )}

        {!loading && !isFlatMode && sheep.length > 0 && (
          <div style={{display:'flex', flexDirection:'column', gap:12}}>
            {FLOCKS.map(f => {
              const flockSheep = sorted.filter(s => s.flock === f);
              const fc = FLOCK_COLORS[f];
              const open = !!expandedFlocks[f];
              return (
                <div key={f} style={{background:'white', border:'1px solid #e5e7eb', borderRadius:12, overflow:'hidden'}}>
                  <div onClick={()=>setExpandedFlocks({...expandedFlocks, [f]:!open})} style={{padding:'12px 18px', background:fc.bg, borderBottom:open?'1px solid '+fc.bd:'none', display:'flex', alignItems:'center', gap:12, cursor:'pointer'}}>
                    <span style={{fontSize:12, color:fc.tx}}>{open?'\u25bc':'\u25b6'}</span>
                    <span style={{fontSize:15, fontWeight:700, color:fc.tx}}>{'\ud83d\udc11 '+FLOCK_LABELS[f]}</span>
                    <span style={{fontSize:12, color:fc.tx, opacity:.8}}>{flockSheep.length} {flockSheep.length===1?'sheep':'sheep'}</span>
                  </div>
                  {open && flockSheep.length === 0 && <div style={{padding:'1rem', color:'#9ca3af', fontSize:12, fontStyle:'italic'}}>No sheep in this flock.</div>}
                  {open && flockSheep.map((s, idx) => {
                    const lw = lastWeight(s);
                    const isExp = expandedSheep === s.id;
                    const myWi = weighIns.filter(w => w.tag === s.tag);
                    const myLamb = lambingRecs.filter(r => r.dam_tag === s.tag);
                    const myCom = comments.filter(c => c.sheep_id === s.id || c.sheep_tag === s.tag).slice(0, 20);
                    return (
                      <div key={s.id} style={{borderBottom:'1px solid #f3f4f6'}}>
                        <div onClick={()=>setExpandedSheep(isExp?null:s.id)} style={{padding:'10px 18px', display:'grid', gridTemplateColumns:'24px 16px 70px 60px 180px 70px 90px 1fr', alignItems:'center', gap:10, cursor:'pointer'}} className="hoverable-tile">
                          <span style={{fontSize:11, color:'#9ca3af', fontVariantNumeric:'tabular-nums', fontWeight:600}}>{idx+1}</span>
                          <span style={{fontSize:11, color:'#9ca3af'}}>{isExp?'\u25bc':'\u25b6'}</span>
                          <span style={{fontWeight:700, fontSize:13}}>{s.tag ? '#'+s.tag : '(no tag)'}</span>
                          <span style={{fontSize:11, color:'#6b7280'}}>{(s.sex||'\u2014').toUpperCase()}</span>
                          <span style={{fontSize:11, color:'#6b7280', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap'}}>{s.breed||'\u2014'}</span>
                          <span style={{fontSize:11, color:'#6b7280'}}>{age(s.birth_date)||'\u2014'}</span>
                          <span style={{fontSize:11, color:lw?'#065f46':'#9ca3af', fontWeight:lw?600:400}}>{lw ? lw.toLocaleString()+' lb' : 'no weigh-in'}</span>
                          <span style={{display:'flex', gap:8}}>{s.dam_tag && <span style={{fontSize:11, color:'#9ca3af'}}>{'dam #'+s.dam_tag}</span>}</span>
                        </div>
                        {isExp && <SheepDetail sheep={s} weighIns={myWi} lambing={myLamb} comments={myCom} lambs={sheep.filter(x => x.dam_tag === s.tag)} dam={sheep.find(x => x.tag === s.dam_tag)} fmt={fmt} FLOCK_LABELS={FLOCK_LABELS} onEdit={()=>openEdit(s)} onTransfer={(nf)=>transferSheep(s.id, nf)} onDelete={()=>deleteSheep(s.id)} onComment={(t)=>addQuickComment(s.id, s.tag, t)} onAddLambing={(d)=>addLambingRecord(s, d)} onDeleteLambing={(rid)=>deleteLambingRecord(rid)}/>}
                      </div>
                    );
                  })}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {showAddForm && form && (
        <div onClick={()=>{setShowAddForm(false);setForm(null);setEditId(null);}} style={{position:'fixed', inset:0, background:'rgba(0,0,0,0.5)', zIndex:1000, display:'flex', alignItems:'flex-start', justifyContent:'center', padding:'2rem 1rem', overflowY:'auto'}}>
          <div onClick={e=>e.stopPropagation()} style={{background:'white', borderRadius:12, maxWidth:600, width:'100%', boxShadow:'0 20px 25px -5px rgba(0,0,0,0.1)'}}>
            <div style={{padding:'14px 20px', borderBottom:'1px solid #e5e7eb', display:'flex', justifyContent:'space-between'}}>
              <h2 style={{margin:0, fontSize:16, color:'#0f766e', fontWeight:700}}>{editId ? 'Edit Sheep' : 'Add Sheep'}</h2>
              <button onClick={()=>{setShowAddForm(false);setForm(null);setEditId(null);}} style={{background:'none', border:'none', fontSize:20, cursor:'pointer'}}>{'\u00d7'}</button>
            </div>
            <div style={{padding:'20px', display:'grid', gridTemplateColumns:'1fr 1fr', gap:12}}>
              <div><label style={{fontSize:11, color:'#6b7280'}}>Tag #</label><input type="text" value={form.tag} onChange={e=>setForm({...form, tag:e.target.value})} style={inpS}/></div>
              <div><label style={{fontSize:11, color:'#6b7280'}}>Sex</label><select value={form.sex} onChange={e=>setForm({...form, sex:e.target.value})} style={inpS}><option value="ewe">Ewe</option><option value="ram">Ram</option><option value="wether">Wether</option></select></div>
              <div><label style={{fontSize:11, color:'#6b7280'}}>Flock *</label><select value={form.flock} onChange={e=>setForm({...form, flock:e.target.value})} style={inpS}>{ALL_FLOCKS.map(f => <option key={f} value={f}>{FLOCK_LABELS[f]}</option>)}</select></div>
              <div><label style={{fontSize:11, color:'#6b7280'}}>Breed</label><select value={form.breed} onChange={e=>setForm({...form, breed:e.target.value})} style={inpS}><option value="">\u2014</option>{breedOpts.map(b => <option key={b.id} value={b.label}>{b.label}</option>)}</select></div>
              <div><label style={{fontSize:11, color:'#6b7280'}}>Origin</label><select value={form.origin} onChange={e=>setForm({...form, origin:e.target.value})} style={inpS}><option value="">\u2014</option>{originOpts.map(o => <option key={o.id} value={o.label}>{o.label}</option>)}</select></div>
              <div><label style={{fontSize:11, color:'#6b7280'}}>Birth Date</label><input type="date" value={form.birth_date} onChange={e=>setForm({...form, birth_date:e.target.value})} style={inpS}/></div>
              <div><label style={{fontSize:11, color:'#6b7280'}}>Purchase Date</label><input type="date" value={form.purchase_date} onChange={e=>setForm({...form, purchase_date:e.target.value})} style={inpS}/></div>
              <div><label style={{fontSize:11, color:'#6b7280'}}>Purchase Amount ($)</label><input type="number" value={form.purchase_amount} onChange={e=>setForm({...form, purchase_amount:e.target.value})} style={inpS}/></div>
              <div><label style={{fontSize:11, color:'#6b7280'}}>Dam Tag</label><input type="text" value={form.dam_tag} onChange={e=>setForm({...form, dam_tag:e.target.value})} style={inpS}/></div>
              <div><label style={{fontSize:11, color:'#6b7280'}}>Dam Reg #</label><input type="text" value={form.dam_reg_num} onChange={e=>setForm({...form, dam_reg_num:e.target.value})} style={inpS}/></div>
              <div><label style={{fontSize:11, color:'#6b7280'}}>Sire Tag</label><input type="text" value={form.sire_tag} onChange={e=>setForm({...form, sire_tag:e.target.value})} style={inpS}/></div>
              <div><label style={{fontSize:11, color:'#6b7280'}}>Sire Reg #</label><input type="text" value={form.sire_reg_num} onChange={e=>setForm({...form, sire_reg_num:e.target.value})} style={inpS}/></div>
              <div><label style={{fontSize:11, color:'#6b7280'}}>Registration #</label><input type="text" value={form.registration_num} onChange={e=>setForm({...form, registration_num:e.target.value})} style={inpS}/></div>
              {form.sex === 'ewe' && <div><label style={{fontSize:11, color:'#6b7280'}}>Breeding Status</label><select value={form.breeding_status} onChange={e=>setForm({...form, breeding_status:e.target.value})} style={inpS}><option value="">\u2014</option><option value="Open">Open</option><option value="Pregnant">Pregnant</option><option value="N/A">N/A</option></select></div>}
            </div>
            <div style={{padding:'14px 20px', borderTop:'1px solid #e5e7eb', display:'flex', gap:10, justifyContent:'flex-end'}}>
              {editId && <button onClick={()=>deleteSheep(editId)} style={{padding:'8px 16px', borderRadius:7, border:'1px solid #fecaca', background:'white', color:'#7f1d1d', fontSize:13, fontWeight:600, cursor:'pointer', fontFamily:'inherit'}}>Delete</button>}
              <button onClick={()=>{setShowAddForm(false);setForm(null);setEditId(null);}} style={{padding:'8px 16px', borderRadius:7, border:'1px solid #d1d5db', background:'white', fontSize:13, fontWeight:600, cursor:'pointer', fontFamily:'inherit'}}>Cancel</button>
              <button onClick={saveSheep} disabled={saving} style={{padding:'8px 20px', borderRadius:7, border:'none', background:'#0f766e', color:'white', fontWeight:600, fontSize:13, cursor:saving?'not-allowed':'pointer', opacity:saving?.6:1, fontFamily:'inherit'}}>{saving ? 'Saving\u2026' : (editId ? 'Save' : 'Add Sheep')}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default SheepFlocksView;
