// FuelingHub — public (no-auth) hub at /fueling. Shows category clusters
// of equipment tiles + a Quick Fuel Log tile + a Maintenance Event tile.
// Each tile navigates to /fueling/<slug> or /fueling/quick.
//
// Own sub-routing under /fueling/* just like WebformHub owns /webforms/*.
import React from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { EQUIPMENT_CATEGORIES, CATEGORY_BY_KEY } from '../lib/equipment.js';
import EquipmentFuelingWebform from './EquipmentFuelingWebform.jsx';

export default function FuelingHub({sb}) {
  const [equipment, setEquipment] = React.useState([]);
  const [loading, setLoading] = React.useState(true);
  const [missingSchema, setMissingSchema] = React.useState(false);
  const location = useLocation();
  const navigate = useNavigate();

  React.useEffect(() => {
    sb.from('equipment').select('id,name,slug,category,tracking_unit,fuel_type,every_fillup_items,every_fillup_help,service_intervals,current_hours,current_km').eq('status','active').order('name').then(({data, error}) => {
      if (error && /does not exist|relation/i.test(error.message||'')) { setMissingSchema(true); setLoading(false); return; }
      if (data) setEquipment(data);
      setLoading(false);
    });
  }, []);

  // Sub-routing from pathname.
  const path = location.pathname;
  let subRoute = 'hub';
  let slug = null;
  if (path === '/fueling/quick') subRoute = 'quick';
  else if (path.startsWith('/fueling/')) {
    slug = path.slice('/fueling/'.length);
    subRoute = 'form';
  }

  const wfBg = {minHeight:'100vh', background:'linear-gradient(135deg,#fafaf9 0%,#e7e5e4 100%)', padding:'1rem', fontFamily:'inherit'};
  const logoEl = (
    <div style={{textAlign:'center', marginBottom:20}}>
      <div style={{fontSize:18, fontWeight:800, color:'#57534e', letterSpacing:-.3}}>⛽ WCF Planner</div>
      <div style={{fontSize:12, color:'#6b7280', marginTop:2}}>Fueling Log</div>
    </div>
  );

  if (missingSchema) {
    return (
      <div style={wfBg}>
        <div style={{maxWidth:480, margin:'0 auto', paddingTop:'1rem'}}>
          {logoEl}
          <div style={{background:'#fff7ed', border:'1px solid #fdba74', borderRadius:10, padding:'1rem', color:'#9a3412', fontSize:13}}>
            Equipment tables not yet set up. Ask the admin to run migration 016.
          </div>
        </div>
      </div>
    );
  }
  if (loading) return <div style={wfBg}><div style={{maxWidth:480, margin:'0 auto', paddingTop:'1rem'}}>{logoEl}<div style={{textAlign:'center', color:'#9ca3af'}}>Loading{'…'}</div></div></div>;

  if (subRoute === 'form') {
    const eq = equipment.find(e => e.slug === slug);
    if (!eq) {
      return (
        <div style={wfBg}>
          <div style={{maxWidth:480, margin:'0 auto', paddingTop:'1rem'}}>
            {logoEl}
            <div style={{background:'white', border:'1px solid #e5e7eb', borderRadius:12, padding:'1rem', textAlign:'center', color:'#6b7280'}}>
              No equipment with slug <code>{slug}</code>.
              <div><button onClick={()=>navigate('/fueling')} style={{marginTop:10, color:'#1d4ed8', background:'none', border:'none', cursor:'pointer', textDecoration:'underline', fontFamily:'inherit'}}>← Back to hub</button></div>
            </div>
          </div>
        </div>
      );
    }
    return <EquipmentFuelingWebform sb={sb} equipment={eq} onBack={()=>navigate('/fueling')}/>;
  }

  if (subRoute === 'quick') {
    // Quick Fuel Log — same form but prompts user to pick equipment at top.
    return <EquipmentFuelingWebform sb={sb} equipment={null} equipmentList={equipment} onBack={()=>navigate('/fueling')}/>;
  }

  // HUB — category clusters
  const grouped = EQUIPMENT_CATEGORIES.map(cat => ({
    ...cat,
    rows: equipment.filter(e => e.category === cat.key),
  })).filter(g => g.rows.length > 0);

  return (
    <div style={wfBg}>
      <div style={{maxWidth:720, margin:'0 auto', paddingTop:'1rem'}}>
        {logoEl}
        <div style={{fontSize:13, color:'#6b7280', textAlign:'center', marginBottom:20}}>Tap your equipment to log a fueling</div>

        {grouped.map(g => (
          <div key={g.key} style={{marginBottom:18}}>
            <div style={{display:'flex', alignItems:'center', gap:8, marginBottom:8, paddingLeft:4}}>
              <span style={{fontSize:20}}>{g.icon}</span>
              <span style={{fontSize:13, fontWeight:700, color:g.color, textTransform:'uppercase', letterSpacing:.4}}>{g.label}</span>
            </div>
            <div style={{display:'grid', gridTemplateColumns:'repeat(auto-fill, minmax(180px, 1fr))', gap:8}}>
              {g.rows.map(eq => (
                <button key={eq.id} onClick={()=>navigate('/fueling/'+eq.slug)}
                  style={{background:g.bg, border:'1px solid '+g.bd, borderRadius:10, padding:'14px 14px', textAlign:'left', cursor:'pointer', fontFamily:'inherit'}}>
                  <div style={{fontSize:14, fontWeight:700, color:g.color, marginBottom:2}}>{eq.name}</div>
                  <div style={{fontSize:11, color:g.color, opacity:.8}}>{eq.tracking_unit === 'km' ? ((eq.current_km||'?')+' km') : ((eq.current_hours||'?')+' hrs')}{eq.fuel_type ? ' · '+eq.fuel_type : ''}</div>
                </button>
              ))}
            </div>
          </div>
        ))}

        <div style={{marginTop:20, marginBottom:12}}>
          <div style={{display:'flex', alignItems:'center', gap:8, marginBottom:8, paddingLeft:4}}>
            <span style={{fontSize:20}}>⛽</span>
            <span style={{fontSize:13, fontWeight:700, color:'#92400e', textTransform:'uppercase', letterSpacing:.4}}>Other</span>
          </div>
          <div style={{display:'grid', gridTemplateColumns:'repeat(auto-fill, minmax(200px, 1fr))', gap:8}}>
            <button onClick={()=>navigate('/fueling/quick')}
              style={{background:'#fffbeb', border:'1px solid #fde68a', borderRadius:10, padding:'14px 14px', textAlign:'left', cursor:'pointer', fontFamily:'inherit'}}>
              <div style={{fontSize:14, fontWeight:700, color:'#92400e'}}>⛽ Quick Fuel Log</div>
              <div style={{fontSize:11, color:'#92400e', opacity:.8}}>Fast entry, no checklist</div>
            </button>
          </div>
        </div>

        <div style={{textAlign:'center', marginTop:16}}>
          <button onClick={()=>{ window.location.hash = '#webforms'; window.location.reload(); }} style={{background:'none', border:'none', color:'#57534e', fontSize:13, cursor:'pointer', fontFamily:'inherit', textDecoration:'underline'}}>{'← Back to Daily Reports'}</button>
        </div>
      </div>
    </div>
  );
}
