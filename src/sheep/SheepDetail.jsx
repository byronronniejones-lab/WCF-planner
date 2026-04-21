// Auto-extracted by Phase 2 Round 2 (verbatim). See MIGRATION_PLAN §6.
import React from 'react';

const SheepDetail = ({sheep, weighIns, lambing, comments, lambs, dam, fmt, FLOCK_LABELS, onEdit, onTransfer, onDelete, onComment, onAddLambing, onDeleteLambing}) => {
  const {useState} = React;
  const [commentText, setCommentText] = useState('');
  const [showLambForm, setShowLambForm] = useState(false);
  const [lambForm, setLambForm] = useState({lambing_date:'', total_born:'', deaths:'', complications_flag:false, complications_desc:'', notes:''});
  const sectionT = {fontSize:11, color:'#6b7280', textTransform:'uppercase', letterSpacing:.5, fontWeight:700, marginBottom:6};
  const inpS = {fontSize:13, padding:'7px 10px', border:'1px solid #d1d5db', borderRadius:6, fontFamily:'inherit', boxSizing:'border-box', width:'100%'};
  const wiSorted = [...weighIns].sort((a,b)=>(b.entered_at||'').localeCompare(a.entered_at||''));
  return (
    <div style={{padding:'14px 18px', background:'#f9fafb', borderTop:'2px solid #0f766e', borderBottom:'2px solid #0f766e', borderLeft:'2px solid #0f766e', borderRight:'2px solid #0f766e', borderRadius:8, margin:'0 8px 8px'}}>
      <div style={{display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:14, gap:8, flexWrap:'wrap'}}>
        <div style={{display:'flex', gap:6}}>
          <button onClick={onEdit} style={{fontSize:11, padding:'4px 10px', borderRadius:6, border:'1px solid #d1d5db', background:'white', color:'#374151', cursor:'pointer', fontWeight:600, fontFamily:'inherit'}}>Edit</button>
          <select onChange={e=>{ if(e.target.value){ onTransfer(e.target.value); e.target.value=''; }}} defaultValue="" style={{...inpS, width:'auto', padding:'4px 8px', fontSize:11}}>
            <option value="">Transfer\u2026</option>
            {Object.entries(FLOCK_LABELS).filter(([k])=>k!==sheep.flock).map(([k,l]) => <option key={k} value={k}>{l}</option>)}
          </select>
          <button onClick={onDelete} style={{fontSize:11, padding:'4px 10px', borderRadius:6, border:'1px solid #fecaca', background:'white', color:'#7f1d1d', cursor:'pointer', fontWeight:600, fontFamily:'inherit'}}>Delete</button>
        </div>
      </div>

      <div style={{display:'grid', gridTemplateColumns:'1fr 1fr', gap:18, marginBottom:18}}>
        <div>
          <div style={sectionT}>Identity</div>
          <div style={{fontSize:12, color:'#374151', lineHeight:1.7}}>
            <div>Tag: <strong>{sheep.tag||'\u2014'}</strong></div>
            <div>Sex: <strong>{(sheep.sex||'\u2014').toUpperCase()}</strong></div>
            <div>Breed: <strong>{sheep.breed||'\u2014'}</strong></div>
            <div>Origin: <strong>{sheep.origin||'\u2014'}</strong></div>
            <div>DOB: <strong>{sheep.birth_date ? fmt(sheep.birth_date) : '\u2014'}</strong></div>
            <div>Purchased: <strong>{sheep.purchase_date ? fmt(sheep.purchase_date)+(sheep.purchase_amount?' \u00b7 $'+Number(sheep.purchase_amount).toLocaleString():'') : '\u2014'}</strong></div>
            <div>Breeding: <strong>{sheep.breeding_status||'\u2014'}</strong></div>
          </div>
        </div>
        <div>
          <div style={sectionT}>Lineage</div>
          <div style={{fontSize:12, color:'#374151', lineHeight:1.7}}>
            <div>Dam: <strong>{sheep.dam_tag||'\u2014'}</strong>{sheep.dam_reg_num?' (reg '+sheep.dam_reg_num+')':''}{dam ? ' \u00b7 in '+(FLOCK_LABELS[dam.flock]||dam.flock):''}</div>
            <div>Sire: <strong>{sheep.sire_tag||'\u2014'}</strong>{sheep.sire_reg_num?' (reg '+sheep.sire_reg_num+')':''}</div>
            <div>Lambs in directory: <strong>{lambs.length}</strong></div>
            {Array.isArray(sheep.old_tags) && sheep.old_tags.length > 0 && <div>Prior tags: <strong>{sheep.old_tags.map(t=>'#'+t.tag).join(', ')}</strong></div>}
          </div>
        </div>
      </div>

      <div style={{marginBottom:18}}>
        <div style={sectionT}>Weight History ({wiSorted.length})</div>
        {wiSorted.length === 0 ? <div style={{fontSize:12, color:'#9ca3af'}}>No weigh-ins yet.</div> : (
          <div style={{maxHeight:200, overflowY:'auto', border:'1px solid #e5e7eb', borderRadius:6}}>
            <table style={{width:'100%', fontSize:12, borderCollapse:'collapse'}}>
              <thead><tr style={{background:'#f3f4f6'}}><th style={{padding:'5px 10px', textAlign:'left', fontWeight:600}}>Date</th><th style={{padding:'5px 10px', textAlign:'right', fontWeight:600}}>Weight</th><th style={{padding:'5px 10px', textAlign:'left', fontWeight:600}}>Note</th></tr></thead>
              <tbody>
                {wiSorted.map(w => <tr key={w.id} style={{borderTop:'1px solid #f3f4f6'}}><td style={{padding:'5px 10px'}}>{fmt(w.entered_at?w.entered_at.slice(0,10):'')}</td><td style={{padding:'5px 10px', textAlign:'right', fontWeight:600}}>{w.weight} lb</td><td style={{padding:'5px 10px', color:'#6b7280'}}>{w.note||'\u2014'}</td></tr>)}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {sheep.sex === 'ewe' && (
        <div style={{marginBottom:18}}>
          <div style={{display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:6}}>
            <div style={sectionT}>Lambing History ({lambing.length})</div>
            <button onClick={()=>setShowLambForm(s=>!s)} style={{fontSize:11, padding:'3px 10px', borderRadius:5, border:'1px solid #0f766e', background:showLambForm?'#0f766e':'white', color:showLambForm?'white':'#0f766e', cursor:'pointer', fontWeight:600, fontFamily:'inherit'}}>{showLambForm?'Cancel':'+ Add Lambing'}</button>
          </div>
          {showLambForm && (
            <div style={{padding:10, background:'white', border:'1px solid #d1d5db', borderRadius:6, marginBottom:8, display:'grid', gridTemplateColumns:'1fr 1fr 1fr', gap:8}}>
              <div><label style={{fontSize:10, color:'#6b7280', display:'block', marginBottom:2}}>Date</label><input type="date" value={lambForm.lambing_date} onChange={e=>setLambForm({...lambForm, lambing_date:e.target.value})} style={inpS}/></div>
              <div><label style={{fontSize:10, color:'#6b7280', display:'block', marginBottom:2}}>Total born</label><input type="number" value={lambForm.total_born} onChange={e=>setLambForm({...lambForm, total_born:e.target.value})} style={inpS}/></div>
              <div><label style={{fontSize:10, color:'#6b7280', display:'block', marginBottom:2}}>Deaths</label><input type="number" value={lambForm.deaths} onChange={e=>setLambForm({...lambForm, deaths:e.target.value})} style={inpS}/></div>
              <div style={{gridColumn:'1/-1'}}><label style={{fontSize:10, color:'#6b7280', display:'block', marginBottom:2}}>Notes</label><input type="text" value={lambForm.notes} onChange={e=>setLambForm({...lambForm, notes:e.target.value})} style={inpS}/></div>
              <button onClick={async ()=>{ const ok = await onAddLambing(lambForm); if(ok){ setLambForm({lambing_date:'', total_born:'', deaths:'', complications_flag:false, complications_desc:'', notes:''}); setShowLambForm(false); }}} style={{gridColumn:'1/-1', padding:'7px 14px', background:'#0f766e', color:'white', border:'none', borderRadius:6, cursor:'pointer', fontSize:12, fontWeight:600, fontFamily:'inherit'}}>Save Lambing Record</button>
            </div>
          )}
          {lambing.length === 0 ? <div style={{fontSize:12, color:'#9ca3af'}}>No lambing records yet.</div> : (
            <div style={{maxHeight:160, overflowY:'auto', border:'1px solid #e5e7eb', borderRadius:6}}>
              <table style={{width:'100%', fontSize:12, borderCollapse:'collapse'}}>
                <thead><tr style={{background:'#f3f4f6'}}><th style={{padding:'5px 10px', textAlign:'left', fontWeight:600}}>Date</th><th style={{padding:'5px 10px', textAlign:'right', fontWeight:600}}>Born</th><th style={{padding:'5px 10px', textAlign:'right', fontWeight:600}}>Deaths</th><th style={{padding:'5px 10px', textAlign:'left', fontWeight:600}}>Notes</th><th></th></tr></thead>
                <tbody>
                  {lambing.map(r => <tr key={r.id} style={{borderTop:'1px solid #f3f4f6'}}><td style={{padding:'5px 10px'}}>{fmt(r.lambing_date)}</td><td style={{padding:'5px 10px', textAlign:'right'}}>{r.total_born}</td><td style={{padding:'5px 10px', textAlign:'right', color:r.deaths>0?'#b91c1c':'#9ca3af'}}>{r.deaths}</td><td style={{padding:'5px 10px', color:'#6b7280'}}>{r.notes||'\u2014'}</td><td style={{padding:'5px 10px'}}><button onClick={()=>onDeleteLambing(r.id)} style={{fontSize:10, padding:'2px 6px', borderRadius:4, border:'1px solid #fecaca', color:'#7f1d1d', background:'white', cursor:'pointer', fontFamily:'inherit'}}>{'\u00d7'}</button></td></tr>)}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      <div>
        <div style={sectionT}>Comments Timeline ({comments.length})</div>
        <div style={{display:'flex', gap:8, marginBottom:8}}>
          <input type="text" value={commentText} onChange={e=>setCommentText(e.target.value)} placeholder="Add a comment\u2026" style={{...inpS, flex:1}}/>
          <button onClick={()=>{ if(commentText.trim()){ onComment(commentText.trim()); setCommentText(''); }}} style={{padding:'7px 14px', background:'#0f766e', color:'white', border:'none', borderRadius:6, cursor:'pointer', fontSize:12, fontWeight:600, fontFamily:'inherit'}}>Add</button>
        </div>
        {comments.length === 0 ? <div style={{fontSize:12, color:'#9ca3af'}}>No comments yet.</div> : (
          <div style={{maxHeight:200, overflowY:'auto'}}>
            {comments.map(c => (
              <div key={c.id} style={{padding:'6px 0', borderBottom:'1px solid #f3f4f6', fontSize:12}}>
                <div style={{color:'#374151'}}>{c.comment}</div>
                <div style={{color:'#9ca3af', fontSize:10, marginTop:2}}>{fmt(c.created_at?c.created_at.slice(0,10):'')} {c.team_member?' \u00b7 '+c.team_member:''} {c.source?' \u00b7 '+c.source:''}</div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

export default SheepDetail;
