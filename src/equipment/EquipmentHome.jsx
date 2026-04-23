// EquipmentHome — container for /equipment/* routes. Owns sub-routing:
//   /equipment              → Fleet view (default)
//   /equipment/fleet        → Fleet view (explicit)
//   /equipment/fuel-log     → flat Fuel Log
//   /equipment/<slug>       → per-equipment detail
//
// Mirrors the pattern used by WebformHub for /webforms/* routes. main.jsx
// maps every /equipment/* path to view='equipmentHome' so the browser back
// button can traverse sub-routes without the app snapping to /.
import React from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import UsersModal from '../auth/UsersModal.jsx';
import EquipmentFleetView from './EquipmentFleetView.jsx';
import EquipmentFuelLogView from './EquipmentFuelLogView.jsx';
import EquipmentDetail from './EquipmentDetail.jsx';

export default function EquipmentHome({sb, fmt, Header, authState, setView, showUsers, setShowUsers, allUsers, setAllUsers, loadUsers}) {
  const [equipment, setEquipment] = React.useState([]);
  const [fuelings, setFuelings] = React.useState([]);
  const [maintenance, setMaintenance] = React.useState([]);
  const [loading, setLoading] = React.useState(true);
  const [missingSchema, setMissingSchema] = React.useState(false);

  const location = useLocation();
  const navigate = useNavigate();

  async function loadAll() {
    setLoading(true);
    const [eR, fR, mR] = await Promise.all([
      sb.from('equipment').select('*').order('name'),
      sb.from('equipment_fuelings').select('*').order('date',{ascending:false}).limit(5000),
      sb.from('equipment_maintenance_events').select('*').order('event_date',{ascending:false}).limit(500),
    ]);
    // If migration 016 hasn't been applied, the tables won't exist. Show a
    // friendly banner instead of crashing.
    if (eR.error && /does not exist|relation/i.test(eR.error.message || '')) {
      setMissingSchema(true);
      setLoading(false);
      return;
    }
    if (eR.data) setEquipment(eR.data);
    if (fR && fR.data) setFuelings(fR.data);
    if (mR && mR.data) setMaintenance(mR.data);
    setLoading(false);
  }
  React.useEffect(() => { loadAll(); }, []);

  const path = location.pathname;
  let subView = 'fleet';
  let detailSlug = null;
  if (path === '/equipment/fuel-log') subView = 'fuel-log';
  else if (path.startsWith('/equipment/') && path !== '/equipment/fleet') {
    detailSlug = path.slice('/equipment/'.length);
    subView = 'detail';
  }

  const activeEq = detailSlug ? equipment.find(e => e.slug === detailSlug) : null;

  const subNavBtn = (active) => ({
    padding:'7px 14px', borderRadius:8, cursor:'pointer', fontFamily:'inherit',
    fontSize:12, fontWeight:active?700:500, whiteSpace:'nowrap',
    border: active?'2px solid #57534e':'1px solid #d1d5db',
    background: active?'#57534e':'white',
    color: active?'white':'#374151',
  });

  return (
    <div style={{minHeight:'100vh', background:'#f1f3f2'}}>
      {showUsers && <UsersModal sb={sb} authState={authState} allUsers={allUsers} setAllUsers={setAllUsers} setShowUsers={setShowUsers} loadUsers={loadUsers}/>}
      <Header/>

      {/* Secondary sub-nav within /equipment */}
      <div style={{background:'white', borderBottom:'1px solid #e5e7eb', padding:'8px 1.25rem', display:'flex', gap:6, alignItems:'center', flexWrap:'wrap'}}>
        <button onClick={()=>navigate('/equipment')} style={subNavBtn(subView==='fleet')}>🚜 Fleet</button>
        <button onClick={()=>navigate('/equipment/fuel-log')} style={subNavBtn(subView==='fuel-log')}>⛽ Fuel Log</button>
        {detailSlug && activeEq && (
          <>
            <span style={{color:'#9ca3af', fontSize:12}}>{'›'}</span>
            <span style={{padding:'7px 14px', borderRadius:8, background:'#57534e', color:'white', fontSize:12, fontWeight:700}}>{activeEq.name}</span>
          </>
        )}
      </div>

      <div style={{padding:'1rem', maxWidth:1200, margin:'0 auto'}}>
        {missingSchema && (
          <div style={{background:'#fff7ed', border:'1px solid #fdba74', borderRadius:10, padding:'1rem 1.25rem', marginBottom:12, color:'#9a3412', fontSize:13}}>
            <strong>Equipment schema missing.</strong> Apply <code>supabase-migrations/016_equipment_module.sql</code> in the SQL Editor, then run <code>node scripts/import_equipment.cjs --commit</code> to populate the tables. Reload this page once that's done.
          </div>
        )}

        {loading && !missingSchema && <div style={{textAlign:'center', padding:'3rem', color:'#9ca3af'}}>Loading{'…'}</div>}

        {!loading && !missingSchema && subView === 'fleet' && (
          <EquipmentFleetView
            equipment={equipment}
            fuelings={fuelings}
            fmt={fmt}
            onOpen={(slug)=>navigate('/equipment/'+slug)}
          />
        )}
        {!loading && !missingSchema && subView === 'fuel-log' && (
          <EquipmentFuelLogView
            equipment={equipment}
            fuelings={fuelings}
            fmt={fmt}
          />
        )}
        {!loading && !missingSchema && subView === 'detail' && activeEq && (
          <EquipmentDetail
            sb={sb}
            fmt={fmt}
            equipment={activeEq}
            fuelings={fuelings.filter(f => f.equipment_id === activeEq.id)}
            maintenance={maintenance.filter(m => m.equipment_id === activeEq.id)}
            authState={authState}
            onReload={loadAll}
          />
        )}
        {!loading && !missingSchema && subView === 'detail' && !activeEq && (
          <div style={{background:'white', border:'1px solid #e5e7eb', borderRadius:12, padding:'2rem', textAlign:'center', color:'#6b7280', fontSize:13}}>
            No equipment with slug <code>{detailSlug}</code>. <a onClick={(e)=>{e.preventDefault(); navigate('/equipment');}} href="#" style={{color:'#1d4ed8', cursor:'pointer'}}>Back to Fleet</a>.
          </div>
        )}
      </div>
    </div>
  );
}
