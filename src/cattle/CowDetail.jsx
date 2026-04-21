// Auto-extracted by Phase 2 Round 2 (verbatim). See MIGRATION_PLAN §6.
import React from 'react';

const CowDetail = ({cow, weighIns, calving, comments, calves, dam, cattleList, fmt, HERDS, HERD_LABELS, HERD_COLORS, onEdit, onTransfer, onDelete, onComment, onEditComment, onDeleteComment, onAddCalving, onDeleteCalving, onNavigateToCow, onNavigateBack, canNavigateBack, backToTag}) => {
  const [commentText, setCommentText] = React.useState('');
  const [showTransfer, setShowTransfer] = React.useState(false);
  const [showCalvingForm, setShowCalvingForm] = React.useState(false);
  const [editingCommentId, setEditingCommentId] = React.useState(null);
  const [editingCommentText, setEditingCommentText] = React.useState('');
  const [calvingForm, setCalvingForm] = React.useState({calving_date:new Date().toISOString().slice(0,10), calf_tag:'', sire_tag:'', total_born:'', deaths:'', complications_flag:false, complications_desc:'', notes:''});
  const [weightView, setWeightView] = React.useState('table'); // 'table' | 'chart'
  const [chartHover, setChartHover] = React.useState(null);   // {idx, x, y}
  const sectionTitle = {fontSize:11, fontWeight:700, color:'#4b5563', textTransform:'uppercase', letterSpacing:.5, marginBottom:6};
  const isMomma = cow.herd === 'mommas';
  async function submitCalving() {
    const ok = await onAddCalving(calvingForm);
    if(ok) { setShowCalvingForm(false); setCalvingForm({calving_date:new Date().toISOString().slice(0,10), calf_tag:'', sire_tag:'', total_born:'', deaths:'', complications_flag:false, complications_desc:'', notes:''}); }
  }
  const inpC = {fontSize:12, padding:'5px 8px', border:'1px solid #d1d5db', borderRadius:5, fontFamily:'inherit', width:'100%', boxSizing:'border-box'};
  const lblC = {fontSize:10, color:'#6b7280', display:'block', marginBottom:2, fontWeight:500};

  // Tag lookup helper for cross-cow navigation (calving → calf, lineage → dam/sire)
  const findByTag = (t) => t && Array.isArray(cattleList) ? cattleList.find(x => x.tag === t) : null;
  const accentColor = (HERD_COLORS && HERD_COLORS[cow.herd] && HERD_COLORS[cow.herd].tx) || '#991b1b';
  const linkStyle = {color:'#1d4ed8', cursor:'pointer', textDecoration:'underline', background:'none', border:'none', padding:0, font:'inherit'};
  const TagLink = ({tag, prefix, label}) => {
    const t = findByTag(tag);
    if(!t || !onNavigateToCow) return <span>{(prefix||'')+(label||('#'+tag))}</span>;
    return <button type="button" onClick={(e)=>{e.stopPropagation(); onNavigateToCow(t);}} style={linkStyle}>{(prefix||'')+(label||('#'+tag))}</button>;
  };
  return (
    <div style={{background:'#ffffff', padding:'14px 18px', border:'2px solid '+accentColor, borderRadius:8, boxShadow:'0 2px 6px rgba(0,0,0,.06)', margin:'8px 12px 14px'}}>
      {canNavigateBack && onNavigateBack && (
        <div style={{marginBottom:10, padding:'6px 10px', background:'#eff6ff', border:'1px solid #bfdbfe', borderRadius:6, display:'flex', alignItems:'center', gap:8}}>
          <button type="button" onClick={(e)=>{e.stopPropagation(); onNavigateBack();}} style={{...linkStyle, fontWeight:600}}>{'\u2190 Back'+(backToTag?(' to #'+backToTag):'')}</button>
          <span style={{fontSize:11, color:'#6b7280'}}>— you navigated here from another cow</span>
        </div>
      )}
      <div style={{display:'flex', alignItems:'center', gap:10, marginBottom:10, paddingBottom:8, borderBottom:'1px solid #f3f4f6'}}>
        <span style={{fontSize:16, fontWeight:700, color:accentColor}}>{cow.tag ? '#'+cow.tag : '(no tag)'}</span>
        <span style={{fontSize:11, padding:'2px 8px', borderRadius:4, background:'#f3f4f6', color:'#374151', fontWeight:600}}>{HERD_LABELS[cow.herd]||cow.herd}</span>
        {cow.sex && <span style={{fontSize:11, color:'#6b7280', textTransform:'capitalize'}}>{cow.sex}</span>}
        {cow.breed && <span style={{fontSize:11, color:'#6b7280'}}>{cow.breed}</span>}
      </div>
      <div style={{display:'grid', gridTemplateColumns:'1fr 1fr', gap:16}}>
        {/* Identity */}
        <div>
          <div style={sectionTitle}>Identity</div>
          <div style={{fontSize:12, color:'#374151', display:'grid', gridTemplateColumns:'auto 1fr', gap:'2px 8px'}}>
            {cow.registration_num && <><span style={{color:'#9ca3af'}}>Reg #:</span><span>{cow.registration_num}</span></>}
            {cow.pct_wagyu != null && <><span style={{color:'#9ca3af'}}>% Wagyu:</span><span>{cow.pct_wagyu}%</span></>}
            {cow.origin && <><span style={{color:'#9ca3af'}}>Origin:</span><span>{cow.origin}</span></>}
            {cow.birth_date && <><span style={{color:'#9ca3af'}}>Birth:</span><span>{fmt(cow.birth_date)}</span></>}
            {cow.purchase_date && <><span style={{color:'#9ca3af'}}>Purchased:</span><span>{fmt(cow.purchase_date)} {cow.purchase_amount?('\u00b7 $'+cow.purchase_amount):''}</span></>}
            {(cow.sex==='cow'||cow.sex==='heifer') && cow.breeding_status && <><span style={{color:'#9ca3af'}}>Breeding:</span><span style={{textTransform:'capitalize'}}>{String(cow.breeding_status).toLowerCase()}</span></>}
            {Array.isArray(cow.old_tags) && cow.old_tags.length > 0 && (
              <>
                <span style={{color:'#9ca3af'}}>Prior tags:</span>
                <span>{cow.old_tags.slice().reverse().map(function(t,i){
                  var dateStr = t.changed_at ? (' ' + fmt((t.changed_at||'').slice(0,10))) : '';
                  var srcLabel = t.source === 'import' ? ' (purchase)'
                               : t.source === 'weigh_in' ? ' (retag)'
                               : '';
                  return (i>0?', ':'') + '#' + t.tag + dateStr + srcLabel;
                }).join('')}</span>
              </>
            )}
          </div>
        </div>
        {/* Lineage */}
        <div>
          <div style={sectionTitle}>Lineage</div>
          <div style={{fontSize:12, color:'#374151', display:'grid', gridTemplateColumns:'auto 1fr', gap:'2px 8px'}}>
            <span style={{color:'#9ca3af'}}>Dam:</span>
            <span>{cow.dam_tag
              ? (findByTag(cow.dam_tag)
                  ? <><TagLink tag={cow.dam_tag}/> <span style={{color:'#9ca3af'}}>{'('+(findByTag(cow.dam_tag).breed||'?')+')'}</span></>
                  : <span>{'#'+cow.dam_tag+' (not in directory)'}</span>)
              : '\u2014'}</span>
            <span style={{color:'#9ca3af'}}>Sire:</span>
            <span>{cow.sire_tag
              ? (findByTag(cow.sire_tag)
                  ? <><TagLink tag={cow.sire_tag}/> <span style={{color:'#9ca3af'}}>{'('+(findByTag(cow.sire_tag).breed||'?')+')'}</span></>
                  : <span>{'#'+cow.sire_tag+' (not in directory)'}</span>)
              : '\u2014'}</span>
          </div>
        </div>
      </div>

      {/* Weigh-in history — table / chart toggle with per-row ADG + lifetime footer */}
      {weighIns && weighIns.length > 0 && (() => {
        // Build chronological (oldest→newest) records so per-row deltas compare
        // each weigh-in to the previous one. We flip to newest-first for display.
        const asc = [...weighIns].sort((a,b) => (a.entered_at||'').localeCompare(b.entered_at||''));
        const rows = asc.map((w, i) => {
          const d = (w.entered_at||'').slice(0,10);
          const wt = parseFloat(w.weight) || 0;
          const prev = i > 0 ? asc[i-1] : null;
          const prevD = prev ? (prev.entered_at||'').slice(0,10) : null;
          const prevW = prev ? parseFloat(prev.weight) || 0 : 0;
          const dDays = prev ? Math.round((new Date(d+'T12:00:00') - new Date(prevD+'T12:00:00')) / 86400000) : null;
          const dWt   = prev ? Math.round((wt - prevW) * 10) / 10 : null;
          const lbDay = (prev && dDays > 0) ? Math.round((dWt / dDays) * 100) / 100 : null;
          const isReceiving = i === 0 && (
            (w.session_id||'').startsWith('wsess-rcv-') ||
            (w.note||'').toLowerCase().includes('receiving')
          );
          return { ...w, date: d, wt, dDays, dWt, lbDay, isReceiving };
        });
        const desc = [...rows].reverse();
        const first = rows[0], last = rows[rows.length-1];
        const lifetimeDays = first && last && first.date && last.date
          ? Math.round((new Date(last.date+'T12:00:00') - new Date(first.date+'T12:00:00')) / 86400000)
          : 0;
        const lifetimeWt  = last && first ? Math.round((last.wt - first.wt) * 10) / 10 : 0;
        const lifetimeADG = lifetimeDays > 0 ? Math.round((lifetimeWt / lifetimeDays) * 100) / 100 : null;
        const colorFor = v => v == null ? '#9ca3af' : v < 0 ? '#b91c1c' : v >= 0.3 ? '#065f46' : '#a16207';
        const fmtSigned = (v, suffix) => v == null ? '\u2014' : (v > 0 ? '+' : '') + v + (suffix||'');

        // Sparkline: plot asc series on a fixed viewBox, normalize to weight range
        const W = 620, H = 120, padT = 14, padB = 22, padL = 8, padR = 40;
        const chartW = W - padL - padR, chartH = H - padT - padB;
        const weights = rows.map(r => r.wt);
        const minW = Math.min(...weights), maxW = Math.max(...weights);
        const spanW = Math.max(1, maxW - minW);
        const dates = rows.map(r => new Date(r.date+'T12:00:00').getTime());
        const minT = Math.min(...dates), maxT = Math.max(...dates);
        const spanT = Math.max(1, maxT - minT);
        const pts = rows.map((r, i) => {
          const x = padL + (rows.length === 1 ? chartW/2 : ((new Date(r.date+'T12:00:00').getTime() - minT) / spanT) * chartW);
          const y = padT + (1 - (r.wt - minW) / spanW) * chartH;
          return { x, y, row: r, i };
        });
        const linePath = pts.map((p,i) => (i === 0 ? 'M' : 'L') + p.x + ',' + p.y).join(' ');

        return (
          <div style={{marginTop:12}}>
            <div style={{display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:6}}>
              <div style={{...sectionTitle, marginBottom:0}}>Weight History ({rows.length})</div>
              <div style={{display:'flex', borderRadius:6, overflow:'hidden', border:'1px solid #d1d5db'}}>
                {[{k:'table', l:'Table'}, {k:'chart', l:'Chart'}].map((o, oi) => (
                  <button key={o.k} onClick={()=>setWeightView(o.k)} style={{padding:'3px 10px', border:'none', borderRight:oi<1?'1px solid #d1d5db':'none', fontFamily:'inherit', fontSize:10, fontWeight:600, cursor:'pointer', background:weightView===o.k?'#1e40af':'white', color:weightView===o.k?'white':'#6b7280'}}>{o.l}</button>
                ))}
              </div>
            </div>

            {weightView === 'table' && (
              <div style={{background:'white', border:'1px solid #e5e7eb', borderRadius:8, overflow:'hidden', maxWidth:640}}>
                <div style={{display:'grid', gridTemplateColumns:'120px 80px 80px 80px 90px', gap:0, background:'#f9fafb', padding:'6px 12px', fontSize:10, fontWeight:700, color:'#6b7280', textTransform:'uppercase', letterSpacing:.5, borderBottom:'1px solid #e5e7eb'}}>
                  <div>Date</div>
                  <div style={{textAlign:'right'}}>Weight</div>
                  <div style={{textAlign:'right'}}>Days Since</div>
                  <div style={{textAlign:'right'}}>Change</div>
                  <div style={{textAlign:'right'}}>Lb / Day</div>
                </div>
                {desc.map((r, i) => {
                  const isBaseline = r.isReceiving || (r.dDays == null);
                  return (
                    <div key={r.id} style={{display:'grid', gridTemplateColumns:'120px 80px 80px 80px 90px', gap:0, padding:'6px 12px', fontSize:12, borderBottom:i < desc.length-1 ? '1px solid #f3f4f6' : 'none', fontVariantNumeric:'tabular-nums', background:isBaseline?'#fafafa':'white'}}>
                      <div style={{color:'#111827'}}>
                        {fmt(r.date)}
                        {r.isReceiving && <div style={{fontSize:9, color:'#92400e', marginTop:2, padding:'1px 5px', borderRadius:3, background:'#fef3c7', fontWeight:600, display:'inline-block'}}>RECEIVING</div>}
                      </div>
                      <div style={{textAlign:'right', fontWeight:700, color:'#111827'}}>{r.wt.toLocaleString()} lb</div>
                      <div style={{textAlign:'right', color:'#6b7280'}}>{r.dDays != null ? r.dDays : '\u2014'}</div>
                      <div style={{textAlign:'right', color:colorFor(r.dWt != null && r.dDays > 0 ? r.dWt / r.dDays : null), fontWeight:600}}>{fmtSigned(r.dWt)}</div>
                      <div style={{textAlign:'right', color:colorFor(r.lbDay), fontWeight:700}}>{r.lbDay != null ? fmtSigned(r.lbDay) : '\u2014'}</div>
                    </div>
                  );
                })}
                {rows.length > 1 && (
                  <div style={{padding:'8px 12px', fontSize:11, background:'#f3f4f6', borderTop:'2px solid #d1d5db', color:'#374151', display:'flex', gap:10, flexWrap:'wrap', alignItems:'center'}}>
                    <div style={{fontWeight:700, textTransform:'uppercase', letterSpacing:.5, fontSize:10, color:'#6b7280'}}>Lifetime</div>
                    <strong>{first.wt} {'\u2192'} {last.wt} lb</strong>
                    <span style={{color:colorFor(lifetimeWt / Math.max(1, lifetimeDays))}}>{fmtSigned(lifetimeWt, ' lb')}</span>
                    <span>{'over '+lifetimeDays.toLocaleString()+'d'}</span>
                    <strong style={{color:colorFor(lifetimeADG)}}>{lifetimeADG != null ? fmtSigned(lifetimeADG, ' lb/day') : '\u2014'}</strong>
                  </div>
                )}
              </div>
            )}

            {weightView === 'chart' && (
              <div style={{background:'white', border:'1px solid #e5e7eb', borderRadius:8, padding:'10px 12px'}}>
                <svg viewBox={'0 0 '+W+' '+H} preserveAspectRatio="none" style={{width:'100%', height:140, display:'block', overflow:'visible'}} onMouseLeave={()=>setChartHover(null)}>
                  {/* baseline */}
                  <line x1={padL} y1={padT+chartH} x2={padL+chartW} y2={padT+chartH} stroke="#e5e7eb" strokeWidth="1"/>
                  {/* area fill under line */}
                  {pts.length > 1 && (
                    <path d={linePath + ' L '+pts[pts.length-1].x+','+(padT+chartH)+' L '+pts[0].x+','+(padT+chartH)+' Z'} fill="#eff6ff" opacity="0.8"/>
                  )}
                  {/* line */}
                  {pts.length > 1 && <path d={linePath} fill="none" stroke="#1e40af" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round"/>}
                  {/* points */}
                  {pts.map(p => (
                    <g key={p.row.id}>
                      <circle cx={p.x} cy={p.y} r={chartHover && chartHover.idx === p.i ? 5 : 3} fill={p.row.isReceiving ? '#a16207' : '#1e40af'} stroke="white" strokeWidth="1.5"/>
                      <circle cx={p.x} cy={p.y} r="12" fill="transparent" style={{cursor:'pointer'}} onMouseEnter={()=>setChartHover({idx:p.i, x:p.x, y:p.y})}/>
                    </g>
                  ))}
                  {/* min/max labels on right */}
                  <text x={padL+chartW+4} y={padT+4} fontSize="10" fill="#6b7280" fontFamily="inherit">{maxW+' lb'}</text>
                  <text x={padL+chartW+4} y={padT+chartH+4} fontSize="10" fill="#6b7280" fontFamily="inherit">{minW+' lb'}</text>
                  {/* first / last date labels */}
                  <text x={padL} y={H-6} fontSize="10" fill="#9ca3af" fontFamily="inherit">{fmt(rows[0].date)}</text>
                  <text x={padL+chartW} y={H-6} fontSize="10" fill="#9ca3af" fontFamily="inherit" textAnchor="end">{fmt(rows[rows.length-1].date)}</text>
                  {/* hover tooltip */}
                  {chartHover && (() => {
                    const p = pts[chartHover.idx];
                    if(!p) return null;
                    const tx = Math.min(Math.max(p.x, padL+60), padL+chartW-60);
                    const ty = Math.max(p.y - 30, padT+10);
                    return (
                      <g pointerEvents="none">
                        <rect x={tx-55} y={ty-14} width="110" height="30" rx="4" fill="#111827" opacity="0.92"/>
                        <text x={tx} y={ty-1} fontSize="11" fontWeight="700" fill="white" fontFamily="inherit" textAnchor="middle">{p.row.wt + ' lb'}</text>
                        <text x={tx} y={ty+11} fontSize="9" fill="#d1d5db" fontFamily="inherit" textAnchor="middle">{fmt(p.row.date)}{p.row.lbDay != null ? ('  '+fmtSigned(p.row.lbDay, ' lb/d')) : ''}</text>
                      </g>
                    );
                  })()}
                </svg>
                {rows.length > 1 && (
                  <div style={{marginTop:6, paddingTop:8, borderTop:'1px solid #f3f4f6', fontSize:11, color:'#374151', textAlign:'center'}}>
                    <strong>{first.wt} {'\u2192'} {last.wt} lb</strong>
                    {'  \u00b7  '}<span style={{color:colorFor(lifetimeWt / Math.max(1, lifetimeDays))}}>{fmtSigned(lifetimeWt, ' lb')}</span>
                    {'  over '+lifetimeDays.toLocaleString()+' days  \u00b7  '}
                    <strong style={{color:colorFor(lifetimeADG)}}>{lifetimeADG != null ? fmtSigned(lifetimeADG, ' lb/day') : '\u2014'} lifetime ADG</strong>
                  </div>
                )}
              </div>
            )}
          </div>
        );
      })()}

      {/* Calving history + add (Mommas only) */}
      {isMomma && (
        <div style={{marginTop:12}}>
          <div style={{display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:6}}>
            <div style={sectionTitle}>Calving History</div>
            {!showCalvingForm && <button type="button" onClick={()=>setShowCalvingForm(true)} style={{fontSize:11, color:'#991b1b', background:'none', border:'1px solid #fca5a5', borderRadius:5, padding:'3px 8px', cursor:'pointer', fontFamily:'inherit'}}>+ Add Calving</button>}
          </div>
          {showCalvingForm && (
            <div style={{background:'#fef2f2', border:'1px solid #fca5a5', borderRadius:8, padding:'10px 12px', marginBottom:8}}>
              <div style={{display:'grid', gridTemplateColumns:'1fr 1fr', gap:8, marginBottom:6}}>
                <div><label style={lblC}>Calving date *</label><input type="date" value={calvingForm.calving_date} onChange={e=>setCalvingForm({...calvingForm, calving_date:e.target.value})} style={inpC}/></div>
                <div><label style={lblC}>Calf tag (optional)</label><input value={calvingForm.calf_tag} onChange={e=>setCalvingForm({...calvingForm, calf_tag:e.target.value})} placeholder="e.g. 92" style={inpC}/></div>
                <div><label style={lblC}>Sire tag</label><input value={calvingForm.sire_tag} onChange={e=>setCalvingForm({...calvingForm, sire_tag:e.target.value})} style={inpC}/></div>
                <div></div>
                <div><label style={lblC}>Total born</label><input type="number" min="0" value={calvingForm.total_born} onChange={e=>setCalvingForm({...calvingForm, total_born:e.target.value})} placeholder="0" style={inpC}/></div>
                <div><label style={lblC}>Deaths</label><input type="number" min="0" value={calvingForm.deaths} onChange={e=>setCalvingForm({...calvingForm, deaths:e.target.value})} placeholder="0" style={inpC}/></div>
                <div style={{gridColumn:'1/-1'}}>
                  <label style={{display:'flex', alignItems:'center', gap:6, fontSize:11, color:'#7f1d1d', cursor:'pointer'}}>
                    <input type="checkbox" checked={calvingForm.complications_flag} onChange={e=>setCalvingForm({...calvingForm, complications_flag:e.target.checked})}/>
                    Complications flag
                  </label>
                  {calvingForm.complications_flag && (
                    <textarea value={calvingForm.complications_desc} onChange={e=>setCalvingForm({...calvingForm, complications_desc:e.target.value})} placeholder="Required: describe complications" rows={2} style={{...inpC, marginTop:4, resize:'vertical'}}/>
                  )}
                </div>
                <div style={{gridColumn:'1/-1'}}>
                  <label style={lblC}>Notes</label>
                  <textarea value={calvingForm.notes} onChange={e=>setCalvingForm({...calvingForm, notes:e.target.value})} rows={2} style={{...inpC, resize:'vertical'}}/>
                </div>
              </div>
              <div style={{display:'flex', gap:6}}>
                <button type="button" onClick={submitCalving} style={{padding:'6px 14px', borderRadius:6, border:'none', background:'#991b1b', color:'white', fontSize:12, fontWeight:600, cursor:'pointer', fontFamily:'inherit'}}>Save Calving</button>
                <button type="button" onClick={()=>setShowCalvingForm(false)} style={{padding:'6px 12px', borderRadius:6, border:'1px solid #d1d5db', background:'white', color:'#6b7280', fontSize:12, cursor:'pointer', fontFamily:'inherit'}}>Cancel</button>
              </div>
            </div>
          )}
          {(() => {
            var recordedTags = new Set((calving||[]).map(function(r){return r.calf_tag;}).filter(Boolean));
            var syntheticFromCalves = (calves||[]).filter(function(cf){return cf.tag && !recordedTags.has(cf.tag);}).map(function(cf){
              return {id:'synthetic-'+cf.id, synthetic:true, calving_date:cf.birth_date||null, calf_tag:cf.tag, total_born:1, deaths:0};
            });
            var combined = [...(calving||[]), ...syntheticFromCalves].sort(function(a,b){
              return (b.calving_date||'').localeCompare(a.calving_date||'');
            });
            if(combined.length === 0) {
              if(showCalvingForm) return null;
              return <div style={{fontSize:11, color:'#9ca3af', fontStyle:'italic'}}>No calving records yet.</div>;
            }
            return combined.map(function(r){
              var calfCow = r.calf_tag ? findByTag(r.calf_tag) : null;
              return (
                <div key={r.id} style={{background:'white', border:'1px solid #e5e7eb', borderRadius:6, padding:'6px 10px', marginBottom:4, fontSize:11, display:'flex', gap:10, flexWrap:'wrap', alignItems:'center'}}>
                  <strong style={{color:'#111827'}}>{r.calving_date ? fmt(r.calving_date) : 'date unknown'}</strong>
                  {!r.synthetic && <span>{r.total_born+' born, '+r.deaths+' died'}</span>}
                  {r.calf_tag && (calfCow && onNavigateToCow
                    ? <button type="button" onClick={function(){onNavigateToCow(calfCow);}} style={{color:'#1d4ed8', cursor:'pointer', textDecoration:'underline', background:'none', border:'none', padding:0, font:'inherit', fontWeight:600}}>{'calf #'+r.calf_tag}</button>
                    : <span style={{color:'#7f1d1d'}}>{'calf #'+r.calf_tag}</span>)}
                  {calfCow && <span style={{fontSize:10, color:'#6b7280'}}>{'\u00b7 '+(HERD_LABELS[calfCow.herd]||calfCow.herd)+(calfCow.breed?' \u00b7 '+calfCow.breed:'')}</span>}
                  {r.complications_flag && <span style={{color:'#b91c1c', fontWeight:600}}>{'\u26a0 complications'}</span>}
                  {r.notes && <span style={{color:'#6b7280', fontStyle:'italic'}}>{r.notes}</span>}
                  {r.synthetic && <span style={{fontSize:10, color:'#9ca3af', fontStyle:'italic'}}>{'(from calf record)'}</span>}
                  {!r.synthetic && onDeleteCalving && <button type="button" onClick={function(){onDeleteCalving(r.id);}} style={{marginLeft:'auto', fontSize:10, color:'#b91c1c', background:'none', border:'none', cursor:'pointer'}}>Delete</button>}
                </div>
              );
            });
          })()}
        </div>
      )}
      {!isMomma && calving && calving.length > 0 && (
        <div style={{marginTop:12}}>
          <div style={sectionTitle}>Calving History (historical)</div>
          {calving.map(r => (
            <div key={r.id} style={{background:'white', border:'1px solid #e5e7eb', borderRadius:6, padding:'6px 10px', marginBottom:4, fontSize:11, display:'flex', gap:10, flexWrap:'wrap'}}>
              <strong style={{color:'#111827'}}>{fmt(r.calving_date)}</strong>
              <span>{r.total_born} born, {r.deaths} died</span>
              {r.calf_tag && <span style={{color:'#7f1d1d'}}>calf #{r.calf_tag}</span>}
            </div>
          ))}
        </div>
      )}

      {/* Comments timeline + add */}
      <div style={{marginTop:12}}>
        <div style={sectionTitle}>Comments Timeline</div>
        <div style={{display:'flex', gap:6, marginBottom:6}}>
          <input type="text" value={commentText} onChange={e=>setCommentText(e.target.value)} placeholder="Add a comment..." style={{flex:1, fontSize:12, padding:'6px 10px', border:'1px solid #d1d5db', borderRadius:6, fontFamily:'inherit'}}/>
          <button onClick={()=>{onComment(commentText); setCommentText('');}} disabled={!commentText.trim()} style={{padding:'6px 14px', borderRadius:6, border:'none', background:commentText.trim()?'#991b1b':'#d1d5db', color:'white', fontSize:12, fontWeight:600, cursor:commentText.trim()?'pointer':'not-allowed', fontFamily:'inherit'}}>Add</button>
        </div>
        {comments && comments.length > 0 ? (
          <div style={{maxHeight:260, overflowY:'auto'}}>
            {comments.map(c => {
              const isEditing = editingCommentId === c.id;
              return (
                <div key={c.id} style={{background:'white', border:'1px solid #e5e7eb', borderRadius:6, padding:'6px 10px', marginBottom:4, fontSize:11}}>
                  <div style={{display:'flex', gap:8, alignItems:'center', marginBottom:2, flexWrap:'wrap'}}>
                    <span style={{fontSize:10, fontWeight:700, padding:'1px 6px', borderRadius:4, background:c.source==='weigh_in'?'#eff6ff':c.source==='calving'?'#fef2f2':c.source==='daily_report'?'#ecfdf5':c.source==='import'?'#fef3c7':'#f3f4f6', color:c.source==='weigh_in'?'#1e40af':c.source==='calving'?'#991b1b':c.source==='daily_report'?'#065f46':c.source==='import'?'#92400e':'#374151'}}>{c.source}</span>
                    <span style={{color:'#9ca3af'}}>{fmt((c.created_at||'').slice(0,10))}</span>
                    {c.team_member && <span style={{color:'#9ca3af', fontWeight:600}}>{'\u00b7 '+c.team_member}</span>}
                    {!isEditing && onEditComment && (
                      <button type="button" onClick={()=>{setEditingCommentId(c.id); setEditingCommentText(c.comment||'');}} style={{marginLeft:'auto', fontSize:10, color:'#1d4ed8', background:'none', border:'none', cursor:'pointer', padding:'2px 4px', fontFamily:'inherit'}}>Edit</button>
                    )}
                    {!isEditing && onDeleteComment && (
                      <button type="button" onClick={()=>onDeleteComment(c.id)} style={{fontSize:10, color:'#b91c1c', background:'none', border:'none', cursor:'pointer', padding:'2px 4px', fontFamily:'inherit'}}>Delete</button>
                    )}
                  </div>
                  {isEditing ? (
                    <div>
                      <textarea value={editingCommentText} onChange={e=>setEditingCommentText(e.target.value)} rows={2} style={{width:'100%', fontSize:11, padding:'4px 8px', border:'1px solid #d1d5db', borderRadius:5, fontFamily:'inherit', boxSizing:'border-box', resize:'vertical'}}/>
                      <div style={{display:'flex', gap:6, marginTop:4}}>
                        <button type="button" onClick={()=>{onEditComment(c.id, editingCommentText); setEditingCommentId(null); setEditingCommentText('');}} disabled={!editingCommentText.trim()} style={{padding:'3px 10px', borderRadius:5, border:'none', background:editingCommentText.trim()?'#991b1b':'#d1d5db', color:'white', fontSize:10, fontWeight:600, cursor:editingCommentText.trim()?'pointer':'not-allowed', fontFamily:'inherit'}}>Save</button>
                        <button type="button" onClick={()=>{setEditingCommentId(null); setEditingCommentText('');}} style={{padding:'3px 10px', borderRadius:5, border:'1px solid #d1d5db', background:'white', color:'#6b7280', fontSize:10, cursor:'pointer', fontFamily:'inherit'}}>Cancel</button>
                      </div>
                    </div>
                  ) : (
                    <div style={{color:'#374151'}}>{c.comment}</div>
                  )}
                </div>
              );
            })}
          </div>
        ) : (
          <div style={{fontSize:11, color:'#9ca3af', fontStyle:'italic'}}>No comments yet.</div>
        )}
        {cow.breeding_blacklist && (
          <div style={{marginTop:8, background:'#fecaca', border:'1px solid #f87171', borderRadius:6, padding:'6px 10px', fontSize:11, display:'flex', gap:8, alignItems:'center'}}>
            <span style={{fontSize:10, fontWeight:700, padding:'1px 6px', borderRadius:4, background:'#991b1b', color:'white'}}>BREEDING BLACKLIST</span>
            <span style={{color:'#7f1d1d', fontWeight:600}}>{'Flagged \u2014 do not breed.'}</span>
          </div>
        )}
      </div>

      {/* Action buttons */}
      <div style={{marginTop:12, display:'flex', gap:6, flexWrap:'wrap', borderTop:'1px solid #e5e7eb', paddingTop:10}}>
        <button onClick={onEdit} style={{padding:'6px 12px', borderRadius:6, border:'1px solid #d1d5db', background:'white', color:'#374151', fontSize:12, cursor:'pointer', fontFamily:'inherit'}}>Edit</button>
        {!showTransfer && <button onClick={()=>setShowTransfer(true)} style={{padding:'6px 12px', borderRadius:6, border:'1px solid #d1d5db', background:'white', color:'#1d4ed8', fontSize:12, cursor:'pointer', fontFamily:'inherit'}}>Transfer</button>}
        {showTransfer && (
          <select onChange={e=>{if(e.target.value){onTransfer(e.target.value); setShowTransfer(false);}}} style={{fontSize:12, padding:'5px 8px', border:'1px solid #d1d5db', borderRadius:6, fontFamily:'inherit'}}>
            <option value=''>Select target herd...</option>
            {HERDS.filter(h => h !== cow.herd).map(h => <option key={h} value={h}>Move to {HERD_LABELS[h]}</option>)}
          </select>
        )}
        {showTransfer && <button onClick={()=>setShowTransfer(false)} style={{padding:'6px 12px', borderRadius:6, border:'1px solid #d1d5db', background:'white', color:'#6b7280', fontSize:12, cursor:'pointer', fontFamily:'inherit'}}>Cancel</button>}
        <button onClick={onDelete} style={{padding:'6px 12px', borderRadius:6, border:'1px solid #F09595', background:'white', color:'#b91c1c', fontSize:12, cursor:'pointer', fontFamily:'inherit', marginLeft:'auto'}}>Delete</button>
      </div>
    </div>
  );
};

export default CowDetail;
