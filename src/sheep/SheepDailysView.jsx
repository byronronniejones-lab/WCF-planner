// Auto-extracted by Phase 2 Round 2 (verbatim). See MIGRATION_PLAN §6.
import React from 'react';

const SheepDailysView = ({sb, fmt, Header, authState, pendingEdit, setPendingEdit, refreshDailys}) => {
  const {useState, useEffect} = React;
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editId, setEditId] = useState(null);
  const [form, setForm] = useState(null);
  const [saving, setSaving] = useState(false);
  const [filterFlock, setFilterFlock] = useState('all');
  const FLOCKS = ['rams','ewes','feeders'];
  const FLOCK_LABELS = {rams:'Rams', ewes:'Ewes', feeders:'Feeders'};
  const EMPTY_FORM = {
    date: new Date().toISOString().slice(0,10),
    team_member: (authState && authState.name) || '', flock: 'ewes',
    bales_of_hay: '', lbs_of_alfalfa: '',
    minerals_given: false, minerals_pct_eaten: '',
    fence_voltage_kv: '', waterers_working: true,
    mortality_count: '', comments: '',
  };

  async function loadAll() {
    setLoading(true);
    const {data} = await sb.from('sheep_dailys').select('*').order('date',{ascending:false}).order('submitted_at',{ascending:false}).limit(500);
    if(data) setRows(data);
    setLoading(false);
  }
  useEffect(()=>{ loadAll(); }, []);

  function openAdd() { setForm({...EMPTY_FORM}); setEditId(null); setShowForm(true); }
  function openEdit(r) {
    setForm({
      date: r.date || '', team_member: r.team_member || '', flock: r.flock || 'ewes',
      bales_of_hay: r.bales_of_hay != null ? String(r.bales_of_hay) : '',
      lbs_of_alfalfa: r.lbs_of_alfalfa != null ? String(r.lbs_of_alfalfa) : '',
      minerals_given: !!r.minerals_given,
      minerals_pct_eaten: r.minerals_pct_eaten != null ? String(r.minerals_pct_eaten) : '',
      fence_voltage_kv: r.fence_voltage_kv != null ? String(r.fence_voltage_kv) : '',
      waterers_working: r.waterers_working == null ? true : !!r.waterers_working,
      mortality_count: r.mortality_count != null ? String(r.mortality_count) : '',
      comments: r.comments || '',
    });
    setEditId(r.id); setShowForm(true);
  }
  async function save() {
    if(!form.date) { alert('Date is required.'); return; }
    if(!form.flock) { alert('Flock is required.'); return; }
    setSaving(true);
    const rec = {
      date: form.date, team_member: form.team_member || null, flock: form.flock,
      bales_of_hay: form.bales_of_hay !== '' ? parseFloat(form.bales_of_hay) : null,
      lbs_of_alfalfa: form.lbs_of_alfalfa !== '' ? parseFloat(form.lbs_of_alfalfa) : null,
      minerals_given: !!form.minerals_given,
      minerals_pct_eaten: form.minerals_pct_eaten !== '' ? parseFloat(form.minerals_pct_eaten) : null,
      fence_voltage_kv: form.fence_voltage_kv !== '' ? parseFloat(form.fence_voltage_kv) : null,
      waterers_working: !!form.waterers_working,
      mortality_count: form.mortality_count !== '' ? parseInt(form.mortality_count) : null,
      comments: form.comments || null,
    };
    if(editId) {
      const {error} = await sb.from('sheep_dailys').update(rec).eq('id', editId);
      if(error) { alert('Save failed: '+error.message); setSaving(false); return; }
    } else {
      const id = String(Date.now())+Math.random().toString(36).slice(2,6);
      const {error} = await sb.from('sheep_dailys').insert({id, ...rec, source:'admin'});
      if(error) { alert('Save failed: '+error.message); setSaving(false); return; }
    }
    setSaving(false); await loadAll();
    setShowForm(false); setEditId(null); setForm(null);
  }
  async function del(id) {
    if(!confirm('Delete this daily report?')) return;
    await sb.from('sheep_dailys').delete().eq('id', id);
    await loadAll();
  }

  const filtered = filterFlock === 'all' ? rows : rows.filter(r => r.flock === filterFlock);
  const inpS = {fontSize:13, padding:'7px 10px', border:'1px solid #d1d5db', borderRadius:6, fontFamily:'inherit', width:'100%', boxSizing:'border-box'};

  return (
    <div style={{minHeight:'100vh', background:'#f1f3f2'}}>
      <Header/>
      <div style={{padding:'1rem', maxWidth:1200, margin:'0 auto'}}>
        <div style={{background:'white', border:'1px solid #e5e7eb', borderRadius:10, padding:'12px 16px', marginBottom:14, display:'flex', alignItems:'center', gap:10, flexWrap:'wrap'}}>
          <div style={{fontSize:15, fontWeight:700, color:'#0f766e'}}>{'\ud83d\udc11 Sheep Daily Reports'}</div>
          <select value={filterFlock} onChange={e=>setFilterFlock(e.target.value)} style={{...inpS, width:'auto'}}>
            <option value="all">All Flocks</option>
            {FLOCKS.map(f => <option key={f} value={f}>{FLOCK_LABELS[f]}</option>)}
          </select>
          <div style={{flex:1}}/>
          <button onClick={openAdd} style={{padding:'7px 16px', borderRadius:7, border:'none', background:'#0f766e', color:'white', fontWeight:600, fontSize:12, cursor:'pointer', fontFamily:'inherit'}}>+ Add Report</button>
        </div>

        {loading && <div style={{textAlign:'center', padding:'2rem', color:'#9ca3af'}}>Loading{'\u2026'}</div>}
        {!loading && filtered.length === 0 && <div style={{background:'white', border:'1px solid #e5e7eb', borderRadius:12, padding:'2rem', textAlign:'center', color:'#6b7280', fontSize:13}}>No daily reports yet. Click <strong>+ Add Report</strong>.</div>}

        {!loading && filtered.length > 0 && (
          <div style={{background:'white', border:'1px solid #e5e7eb', borderRadius:12, overflow:'hidden'}}>
            <table style={{width:'100%', borderCollapse:'collapse', fontSize:12}}>
              <thead style={{background:'#f9fafb'}}>
                <tr>
                  <th style={{padding:'8px 10px', textAlign:'left', fontWeight:600, color:'#4b5563', borderBottom:'1px solid #e5e7eb'}}>Date</th>
                  <th style={{padding:'8px 10px', textAlign:'left', fontWeight:600, color:'#4b5563', borderBottom:'1px solid #e5e7eb'}}>Flock</th>
                  <th style={{padding:'8px 10px', textAlign:'left', fontWeight:600, color:'#4b5563', borderBottom:'1px solid #e5e7eb'}}>Team</th>
                  <th style={{padding:'8px 10px', textAlign:'right', fontWeight:600, color:'#4b5563', borderBottom:'1px solid #e5e7eb'}}>Hay</th>
                  <th style={{padding:'8px 10px', textAlign:'right', fontWeight:600, color:'#4b5563', borderBottom:'1px solid #e5e7eb'}}>Alfalfa</th>
                  <th style={{padding:'8px 10px', textAlign:'left', fontWeight:600, color:'#4b5563', borderBottom:'1px solid #e5e7eb'}}>Minerals</th>
                  <th style={{padding:'8px 10px', textAlign:'right', fontWeight:600, color:'#4b5563', borderBottom:'1px solid #e5e7eb'}}>Fence kV</th>
                  <th style={{padding:'8px 10px', textAlign:'left', fontWeight:600, color:'#4b5563', borderBottom:'1px solid #e5e7eb'}}>Waterers</th>
                  <th style={{padding:'8px 10px', textAlign:'right', fontWeight:600, color:'#4b5563', borderBottom:'1px solid #e5e7eb'}}>Mort</th>
                  <th style={{padding:'8px 10px', textAlign:'left', fontWeight:600, color:'#4b5563', borderBottom:'1px solid #e5e7eb'}}>Comments</th>
                  <th style={{padding:'8px 10px', borderBottom:'1px solid #e5e7eb'}}></th>
                </tr>
              </thead>
              <tbody>
                {filtered.map(r => (
                  <tr key={r.id} style={{borderBottom:'1px solid #f3f4f6'}}>
                    <td style={{padding:'6px 10px', fontWeight:600}}>{fmt(r.date)}</td>
                    <td style={{padding:'6px 10px'}}>{FLOCK_LABELS[r.flock] || r.flock}</td>
                    <td style={{padding:'6px 10px'}}>{r.team_member||'\u2014'}</td>
                    <td style={{padding:'6px 10px', textAlign:'right'}}>{r.bales_of_hay != null ? r.bales_of_hay+' bales' : '\u2014'}</td>
                    <td style={{padding:'6px 10px', textAlign:'right'}}>{r.lbs_of_alfalfa != null ? r.lbs_of_alfalfa+' lb' : '\u2014'}</td>
                    <td style={{padding:'6px 10px'}}>{r.minerals_given ? (r.minerals_pct_eaten!=null ? r.minerals_pct_eaten+'% eaten' : 'yes') : 'no'}</td>
                    <td style={{padding:'6px 10px', textAlign:'right'}}>{r.fence_voltage_kv != null ? r.fence_voltage_kv : '\u2014'}</td>
                    <td style={{padding:'6px 10px'}}>{r.waterers_working ? '\u2713' : (r.waterers_working === false ? '\u2717' : '\u2014')}</td>
                    <td style={{padding:'6px 10px', textAlign:'right', color:(r.mortality_count||0)>0?'#b91c1c':'#9ca3af', fontWeight:(r.mortality_count||0)>0?700:400}}>{r.mortality_count||0}</td>
                    <td style={{padding:'6px 10px', color:'#6b7280', maxWidth:200, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap'}}>{r.comments||'\u2014'}</td>
                    <td style={{padding:'6px 10px', whiteSpace:'nowrap'}}>
                      <button onClick={()=>openEdit(r)} style={{fontSize:11, padding:'3px 8px', borderRadius:5, border:'1px solid #d1d5db', background:'white', cursor:'pointer', fontFamily:'inherit', marginRight:4}}>Edit</button>
                      <button onClick={()=>del(r.id)} style={{fontSize:11, padding:'3px 8px', borderRadius:5, border:'1px solid #fecaca', color:'#7f1d1d', background:'white', cursor:'pointer', fontFamily:'inherit'}}>{'\u00d7'}</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {showForm && form && (
        <div onClick={()=>{setShowForm(false);setForm(null);setEditId(null);}} style={{position:'fixed', inset:0, background:'rgba(0,0,0,0.5)', zIndex:1000, display:'flex', alignItems:'flex-start', justifyContent:'center', padding:'2rem 1rem', overflowY:'auto'}}>
          <div onClick={e=>e.stopPropagation()} style={{background:'white', borderRadius:12, maxWidth:560, width:'100%'}}>
            <div style={{padding:'14px 20px', borderBottom:'1px solid #e5e7eb', display:'flex', justifyContent:'space-between'}}>
              <h2 style={{margin:0, fontSize:16, color:'#0f766e', fontWeight:700}}>{editId ? 'Edit Daily Report' : 'Add Daily Report'}</h2>
              <button onClick={()=>{setShowForm(false);setForm(null);setEditId(null);}} style={{background:'none', border:'none', fontSize:20, cursor:'pointer'}}>{'\u00d7'}</button>
            </div>
            <div style={{padding:'20px', display:'grid', gridTemplateColumns:'1fr 1fr', gap:12}}>
              <div><label style={{fontSize:11, color:'#6b7280'}}>Date *</label><input type="date" value={form.date} onChange={e=>setForm({...form, date:e.target.value})} style={inpS}/></div>
              <div><label style={{fontSize:11, color:'#6b7280'}}>Flock *</label><select value={form.flock} onChange={e=>setForm({...form, flock:e.target.value})} style={inpS}>{FLOCKS.map(f => <option key={f} value={f}>{FLOCK_LABELS[f]}</option>)}</select></div>
              <div style={{gridColumn:'1/-1'}}><label style={{fontSize:11, color:'#6b7280'}}>Team Member</label><input type="text" value={form.team_member} onChange={e=>setForm({...form, team_member:e.target.value})} style={inpS}/></div>
              <div><label style={{fontSize:11, color:'#6b7280'}}>Bales of Hay</label><input type="number" step="0.25" value={form.bales_of_hay} onChange={e=>setForm({...form, bales_of_hay:e.target.value})} style={inpS}/></div>
              <div><label style={{fontSize:11, color:'#6b7280'}}>Alfalfa (lbs)</label><input type="number" value={form.lbs_of_alfalfa} onChange={e=>setForm({...form, lbs_of_alfalfa:e.target.value})} style={inpS}/></div>
              <div style={{gridColumn:'1/-1', display:'flex', alignItems:'center', gap:10}}>
                <label style={{fontSize:13, display:'flex', alignItems:'center', gap:6, cursor:'pointer'}}><input type="checkbox" checked={form.minerals_given} onChange={e=>setForm({...form, minerals_given:e.target.checked})}/>Minerals given?</label>
                {form.minerals_given && <div style={{flex:1}}><input type="number" min="0" max="100" placeholder="% eaten" value={form.minerals_pct_eaten} onChange={e=>setForm({...form, minerals_pct_eaten:e.target.value})} style={inpS}/></div>}
              </div>
              <div><label style={{fontSize:11, color:'#6b7280'}}>Fence Voltage (kV)</label><input type="number" step="0.1" value={form.fence_voltage_kv} onChange={e=>setForm({...form, fence_voltage_kv:e.target.value})} style={inpS}/></div>
              <div><label style={{fontSize:13, display:'flex', alignItems:'center', gap:6, cursor:'pointer', paddingTop:18}}><input type="checkbox" checked={form.waterers_working} onChange={e=>setForm({...form, waterers_working:e.target.checked})}/>Waterers working?</label></div>
              <div><label style={{fontSize:11, color:'#6b7280'}}>Mortality Count</label><input type="number" value={form.mortality_count} onChange={e=>setForm({...form, mortality_count:e.target.value})} style={inpS}/></div>
              <div style={{gridColumn:'1/-1'}}><label style={{fontSize:11, color:'#6b7280'}}>Issues / Comments</label><textarea rows={3} value={form.comments} onChange={e=>setForm({...form, comments:e.target.value})} style={{...inpS, resize:'vertical'}}/></div>
            </div>
            <div style={{padding:'14px 20px', borderTop:'1px solid #e5e7eb', display:'flex', gap:10, justifyContent:'flex-end'}}>
              <button onClick={()=>{setShowForm(false);setForm(null);setEditId(null);}} style={{padding:'8px 16px', borderRadius:7, border:'1px solid #d1d5db', background:'white', fontSize:13, fontWeight:600, cursor:'pointer', fontFamily:'inherit'}}>Cancel</button>
              <button onClick={save} disabled={saving} style={{padding:'8px 20px', borderRadius:7, border:'none', background:'#0f766e', color:'white', fontWeight:600, fontSize:13, cursor:saving?'not-allowed':'pointer', opacity:saving?.6:1, fontFamily:'inherit'}}>{saving ? 'Saving\u2026' : 'Save'}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default SheepDailysView;
