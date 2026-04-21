// Auto-extracted by Phase 2 Round 2 (verbatim). See MIGRATION_PLAN §6.
import React from 'react';

const CollapsibleOutcomeSections = ({cattle, weighIns, HERD_COLORS, HERD_LABELS, OUTCOMES, fmt, setStatusFilter, navigateToCow}) => {
  const [expanded, setExpanded] = React.useState({});
  return (
    <div style={{marginTop:8}}>
      {OUTCOMES.map(h => {
        const cows = cattle.filter(c => c.herd === h);
        if(cows.length === 0) return null;
        const hc = HERD_COLORS[h];
        const isExpanded = expanded[h];
        return (
          <div key={h} style={{background:'white', border:'1px solid #e5e7eb', borderRadius:10, marginBottom:8, overflow:'hidden'}}>
            <div onClick={()=>setExpanded({...expanded, [h]:!isExpanded})} style={{padding:'10px 16px', background:hc.bg, cursor:'pointer', display:'flex', alignItems:'center', gap:10}}>
              <span style={{fontSize:11, color:hc.tx}}>{isExpanded?'\u25bc':'\u25b6'}</span>
              <span style={{fontSize:13, fontWeight:700, color:hc.tx}}>{HERD_LABELS[h]}</span>
              <span style={{fontSize:11, color:hc.tx, opacity:.7}}>{cows.length}</span>
              <button onClick={(e)=>{e.stopPropagation(); setStatusFilter(h);}} style={{marginLeft:'auto', fontSize:11, color:hc.tx, background:'none', border:'none', cursor:'pointer', textDecoration:'underline'}}>View all</button>
            </div>
            {isExpanded && (
              <div>
                {cows.slice(0, 50).map(c => (
                  <div key={c.id} onClick={() => navigateToCow && navigateToCow(c)} style={{padding:'8px 16px', borderTop:'1px solid #f3f4f6', fontSize:12, color:'#4b5563', display:'flex', gap:10, flexWrap:'wrap', cursor: navigateToCow ? 'pointer' : 'default'}} className={navigateToCow ? 'hoverable-tile' : ''}>
                    <span style={{fontWeight:600, color:'#111827', minWidth:60}}>{c.tag ? '#'+c.tag : '(no tag)'}</span>
                    <span>{c.sex||'\u2014'}</span>
                    <span>{c.breed||'\u2014'}</span>
                    {c.death_date && <span>{'died '+fmt(c.death_date)}</span>}
                    {c.sale_date && <span>{'sold '+fmt(c.sale_date)}</span>}
                  </div>
                ))}
                {cows.length > 50 && <div style={{padding:'8px 16px', fontSize:11, color:'#9ca3af'}}>{cows.length-50} more {'\u2014'} click "View all" above to filter to this section.</div>}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
};

export default CollapsibleOutcomeSections;
