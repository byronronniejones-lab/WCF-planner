// EquipmentDetail — the per-equipment page. Sections:
//   1. Header: name / status / serial / current reading / fuel type
//   2. Spec panel (editable inline for admin): fluids / filters / capacities
//   3. Upcoming service calculator (service_intervals + completions)
//   4. Fueling + checklist history (expandable rows)
//   5. Maintenance events (+ Add modal with photo upload)
//   6. Warranty expiration flag when < 60 days out
import React from 'react';
import { EQUIPMENT_COLOR, WARRANTY_WINDOW_DAYS, computeIntervalStatus, fmtReading, daysSince, stripPodioHtml } from '../lib/equipment.js';
import EquipmentMaintenanceModal from './EquipmentMaintenanceModal.jsx';

export default function EquipmentDetail({sb, fmt, equipment, fuelings, maintenance, authState, onReload}) {
  const eq = equipment;
  const reading = eq.tracking_unit === 'km' ? eq.current_km : eq.current_hours;
  const readingLabel = eq.tracking_unit === 'km' ? 'KM' : 'Hours';
  const [expandedFueling, setExpandedFueling] = React.useState(null);
  const [showMaintenanceModal, setShowMaintenanceModal] = React.useState(false);
  const [editingMaintenance, setEditingMaintenance] = React.useState(null);

  // Debounced inline auto-save: any spec field is live-edited; after 800ms
  // of no typing the field patches to Supabase. Matches the cattle/sheep
  // inline-edit UX.
  const saveTimers = React.useRef({});
  async function patchEq(fields) {
    const {error} = await sb.from('equipment').update(fields).eq('id', eq.id);
    if (error) { alert('Save failed: '+error.message); return; }
    onReload();
  }
  function queueFieldSave(field, rawValue, parser) {
    if (saveTimers.current[field]) clearTimeout(saveTimers.current[field]);
    saveTimers.current[field] = setTimeout(() => {
      let next;
      if (parser === 'number') {
        const n = parseFloat(rawValue);
        next = Number.isFinite(n) ? n : null;
      } else {
        next = (rawValue || '').trim() || null;
      }
      patchEq({[field]: next});
    }, 800);
  }

  const sortedFuelings = [...(fuelings || [])].sort((a, b) => (b.date || '').localeCompare(a.date || ''));
  const totalGallons = sortedFuelings.reduce((s, f) => s + (parseFloat(f.gallons) || 0), 0);

  // Flatten completions for the interval calculator.
  const completions = [];
  for (const f of fuelings) {
    for (const c of (f.service_intervals_completed || [])) {
      completions.push({...c, reading_at_completion: f.hours_reading != null ? f.hours_reading : (f.km_reading != null ? f.km_reading : null)});
    }
  }
  const intervalStatus = computeIntervalStatus(eq.service_intervals, completions, reading);

  const warrantyDays = eq.warranty_expiration ? daysSince(eq.warranty_expiration) : null;
  const warrantyExpiresSoon = warrantyDays != null && warrantyDays < 0 && warrantyDays > -WARRANTY_WINDOW_DAYS;

  async function deleteMaintenance(id) {
    if (!confirm('Delete this maintenance event?')) return;
    await sb.from('equipment_maintenance_events').delete().eq('id', id);
    onReload();
  }

  const sectionTitle = {fontSize:11, fontWeight:700, color:'#4b5563', textTransform:'uppercase', letterSpacing:.5, marginBottom:8};
  const inpS = {fontSize:12, padding:'5px 8px', border:'1px solid #d1d5db', borderRadius:5, fontFamily:'inherit', width:'100%', boxSizing:'border-box'};

  return (
    <div style={{display:'flex', flexDirection:'column', gap:16}}>
      {/* Header tile */}
      <div style={{background:'white', border:'2px solid '+EQUIPMENT_COLOR, borderRadius:12, padding:'14px 20px'}}>
        <div style={{display:'flex', alignItems:'center', gap:14, flexWrap:'wrap', marginBottom:10}}>
          <span style={{fontSize:20, fontWeight:700, color:EQUIPMENT_COLOR}}>{eq.name}</span>
          <span style={{fontSize:11, fontWeight:700, padding:'2px 10px', borderRadius:10, background:eq.status==='active'?'#d1fae5':'#f3f4f6', color:eq.status==='active'?'#065f46':'#374151', textTransform:'uppercase'}}>{eq.status}</span>
          {eq.serial_number && <span style={{fontSize:11, color:'#6b7280'}}>Serial: <strong>{eq.serial_number}</strong></span>}
          {eq.fuel_type && <span style={{fontSize:11, color:'#6b7280'}}>Fuel: <strong>{eq.fuel_type}</strong></span>}
          <button onClick={async ()=>{
            const next = eq.status === 'retired' ? 'active' : 'retired';
            const {error} = await sb.from('equipment').update({status: next}).eq('id', eq.id);
            if (error) { alert('Status update failed: '+error.message); return; }
            onReload();
          }} style={{marginLeft:'auto', padding:'5px 12px', borderRadius:6, border:'1px solid '+(eq.status==='retired'?'#047857':'#b45309'), background:'white', color:eq.status==='retired'?'#047857':'#92400e', fontSize:11, fontWeight:600, cursor:'pointer', fontFamily:'inherit'}}>{eq.status === 'retired' ? '↻ Restore to active' : '↓ Archive'}</button>
        </div>
        <div style={{display:'grid', gridTemplateColumns:'repeat(auto-fit, minmax(140px, 1fr))', gap:12, fontSize:12}}>
          <StatTile label={eq.tracking_unit==='km'?'Current KM':'Current Hours'} value={fmtReading(reading, eq.tracking_unit)} color="#111827"/>
          <StatTile label="Fuel tank" value={eq.fuel_tank_gal ? eq.fuel_tank_gal+' gal' : '—'} color="#6b7280"/>
          {eq.def_tank_gal != null && eq.def_tank_gal > 0 && <StatTile label="DEF tank" value={eq.def_tank_gal+' gal'} color="#6b7280"/>}
          <StatTile label="Fuelings" value={sortedFuelings.length.toLocaleString()} color="#1e40af"/>
          <StatTile label="Total gallons" value={Math.round(totalGallons).toLocaleString()} color="#1e40af"/>
        </div>
        {warrantyExpiresSoon && (
          <div style={{marginTop:10, padding:'6px 10px', background:'#fffbeb', border:'1px solid #fde68a', borderRadius:6, fontSize:12, color:'#92400e'}}>
            ⚠ Warranty expires in <strong>{-warrantyDays} days</strong> ({fmt(eq.warranty_expiration)}).
          </div>
        )}
      </div>

      {/* Spec panel — always inline-editable with debounced auto-save.
          No Edit button. Click any field to type; autosaves 800ms after
          you stop typing. Matches the cattle/sheep inline-edit pattern. */}
      <div style={{background:'white', border:'1px solid #e5e7eb', borderRadius:12, padding:'14px 20px'}}>
        <div style={sectionTitle}>Specs & Fluids <span style={{color:'#9ca3af', fontWeight:400, fontSize:10, marginLeft:8}}>Click any field to edit · auto-saves</span></div>
        <div style={{display:'grid', gridTemplateColumns:'repeat(auto-fit, minmax(220px, 1fr))', gap:'6px 14px', fontSize:12}}>
          {[
            ['engine_oil','Engine Oil'],
            ['oil_filter','Oil Filter'],
            ['hydraulic_oil','Hydraulic Oil'],
            ['hydraulic_filter','Hydraulic Filter'],
            ['coolant','Coolant'],
            ['brake_fluid','Brake Fluid'],
            ['fuel_filter','Fuel Filter'],
            ['def_filter','DEF Filter'],
            ['gearbox_drive_oil','Gearbox / Drive Oil'],
            ['air_filters','Air Filters'],
            ['serial_number','Serial Number'],
          ].map(([k, label]) => (
            <div key={k} style={{display:'grid', gridTemplateColumns:'140px 1fr', gap:6, alignItems:'center'}}>
              <span style={{color:'#9ca3af'}}>{label}:</span>
              <input
                type="text"
                defaultValue={eq[k] || ''}
                onChange={e => queueFieldSave(k, e.target.value, 'text')}
                style={{...inpS, padding:'4px 7px', background:'transparent'}}
              />
            </div>
          ))}
          <div style={{display:'grid', gridTemplateColumns:'140px 1fr', gap:6, alignItems:'center'}}>
            <span style={{color:'#9ca3af'}}>Warranty ends:</span>
            <input
              type="date"
              defaultValue={eq.warranty_expiration || ''}
              onChange={e => queueFieldSave('warranty_expiration', e.target.value, 'text')}
              style={{...inpS, padding:'4px 7px', background:'transparent'}}
            />
          </div>
          <div style={{display:'grid', gridTemplateColumns:'140px 1fr', gap:6, alignItems:'center'}}>
            <span style={{color:'#9ca3af'}}>Warranty note:</span>
            <input
              type="text"
              defaultValue={eq.warranty_description || ''}
              onChange={e => queueFieldSave('warranty_description', e.target.value, 'text')}
              style={{...inpS, padding:'4px 7px', background:'transparent'}}
            />
          </div>
          <div style={{display:'grid', gridTemplateColumns:'140px 1fr', gap:6, alignItems:'center'}}>
            <span style={{color:'#9ca3af'}}>Fuel tank (gal):</span>
            <input
              type="number" min="0" step="0.1"
              defaultValue={eq.fuel_tank_gal != null ? eq.fuel_tank_gal : ''}
              onChange={e => queueFieldSave('fuel_tank_gal', e.target.value, 'number')}
              style={{...inpS, padding:'4px 7px', background:'transparent'}}
            />
          </div>
          {eq.takes_def && (
            <div style={{display:'grid', gridTemplateColumns:'140px 1fr', gap:6, alignItems:'center'}}>
              <span style={{color:'#9ca3af'}}>DEF tank (gal):</span>
              <input
                type="number" min="0" step="0.1"
                defaultValue={eq.def_tank_gal != null ? eq.def_tank_gal : ''}
                onChange={e => queueFieldSave('def_tank_gal', e.target.value, 'number')}
                style={{...inpS, padding:'4px 7px', background:'transparent'}}
              />
            </div>
          )}
        </div>
      </div>

      {/* Upcoming service calculator */}
      <div style={{background:'white', border:'1px solid #e5e7eb', borderRadius:12, padding:'14px 20px'}}>
        <div style={sectionTitle}>Upcoming Service</div>
        {intervalStatus.length === 0 && <div style={{fontSize:12, color:'#9ca3af', fontStyle:'italic'}}>No service intervals configured yet. Edit equipment to add.</div>}
        {intervalStatus.length > 0 && (
          <div style={{display:'grid', gridTemplateColumns:'repeat(auto-fit, minmax(160px, 1fr))', gap:8}}>
            {intervalStatus.sort((a, b) => (a.next_due - (reading||0)) - (b.next_due - (reading||0))).map(iv => {
              const color = iv.overdue ? '#b91c1c' : (iv.until_due != null && iv.until_due < 50 ? '#a16207' : '#065f46');
              const bg    = iv.overdue ? '#fef2f2' : (iv.until_due != null && iv.until_due < 50 ? '#fffbeb' : '#ecfdf5');
              return (
                <div key={iv.kind+'-'+iv.hours_or_km} style={{background:bg, border:'1px solid '+color+'55', borderRadius:8, padding:'8px 10px', fontSize:11}}>
                  <div style={{fontWeight:700, color:color, fontSize:12}}>{iv.label}</div>
                  <div style={{color:'#6b7280', marginTop:2}}>Next at <strong>{iv.next_due.toLocaleString()}{iv.kind.charAt(0)}</strong></div>
                  {iv.until_due != null && (
                    <div style={{color:color, fontWeight:600, marginTop:2}}>{iv.overdue ? 'OVERDUE by '+Math.abs(iv.until_due)+iv.kind.charAt(0) : iv.until_due+iv.kind.charAt(0)+' away'}</div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Fueling history */}
      <div style={{background:'white', border:'1px solid #e5e7eb', borderRadius:12, padding:'14px 20px'}}>
        <div style={sectionTitle}>Fueling & Checklist History ({sortedFuelings.length})</div>
        {sortedFuelings.length === 0 && <div style={{fontSize:12, color:'#9ca3af', fontStyle:'italic'}}>No fueling entries yet.</div>}
        {sortedFuelings.length > 0 && (
          <div style={{border:'1px solid #f3f4f6', borderRadius:8, overflow:'hidden'}}>
            <div style={{display:'grid', gridTemplateColumns:'90px 60px 60px 60px 80px 120px 1fr', gap:0, background:'#f9fafb', padding:'6px 12px', fontSize:10, fontWeight:700, color:'#6b7280', textTransform:'uppercase', letterSpacing:.5}}>
              <div>Date</div><div>Fuel</div><div style={{textAlign:'right'}}>Gal</div><div style={{textAlign:'right'}}>DEF</div><div style={{textAlign:'right'}}>{readingLabel}</div><div>Team</div><div>Notes</div>
            </div>
            {sortedFuelings.slice(0, 100).map(f => {
              const isExp = expandedFueling === f.id;
              const rdg = f.hours_reading != null ? Math.round(f.hours_reading) : (f.km_reading != null ? Math.round(f.km_reading) : null);
              return (
                <div key={f.id} style={{borderTop:'1px solid #f3f4f6'}}>
                  <div onClick={()=>setExpandedFueling(isExp?null:f.id)} style={{display:'grid', gridTemplateColumns:'90px 60px 60px 60px 80px 120px 1fr', gap:0, padding:'6px 12px', fontSize:12, cursor:'pointer'}} className="hoverable-tile">
                    <div style={{color:'#111827'}}>{fmt(f.date)}</div>
                    <div style={{color:'#6b7280'}}>{f.fuel_type||'—'}</div>
                    <div style={{textAlign:'right', color:'#1e40af', fontWeight:600}}>{f.gallons ? Math.round(f.gallons*10)/10 : '—'}</div>
                    <div style={{textAlign:'right', color:'#a16207', fontWeight:600}}>{f.def_gallons ? Math.round(f.def_gallons*10)/10 : '—'}</div>
                    <div style={{textAlign:'right', color:'#6b7280'}}>{rdg != null ? rdg.toLocaleString() : '—'}</div>
                    <div style={{color:'#6b7280'}}>{f.team_member||'—'}</div>
                    <div style={{color:'#6b7280', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap', fontStyle:stripPodioHtml(f.comments)?'italic':'normal'}}>{stripPodioHtml(f.comments) || '—'}</div>
                  </div>
                  {isExp && (
                    <div style={{background:'#fafafa', padding:'10px 14px', borderTop:'1px solid #f3f4f6', fontSize:11}}>
                      {(f.every_fillup_check||[]).length > 0 && (
                        <div style={{marginBottom:6}}>
                          <strong style={{color:'#374151'}}>Every-fillup checks:</strong>{' '}
                          {f.every_fillup_check.map((c, i) => <span key={i} style={{fontSize:10, padding:'1px 6px', borderRadius:4, background:'#ecfdf5', color:'#065f46', marginRight:4}}>{c.label || c.id}</span>)}
                        </div>
                      )}
                      {(f.service_intervals_completed||[]).length > 0 && (
                        <div>
                          <strong style={{color:'#374151'}}>Service intervals completed:</strong>{' '}
                          {f.service_intervals_completed.map((c, i) => <span key={i} style={{fontSize:10, padding:'1px 6px', borderRadius:4, background:'#eff6ff', color:'#1e40af', marginRight:4}}>{c.label || (c.interval+c.kind.charAt(0))}</span>)}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
            {sortedFuelings.length > 100 && (
              <div style={{padding:'8px 12px', background:'#f9fafb', color:'#9ca3af', fontSize:11, textAlign:'center'}}>
                Showing 100 of {sortedFuelings.length} — use the Fuel Log tab for full history.
              </div>
            )}
          </div>
        )}
      </div>

      {/* Maintenance events */}
      <div style={{background:'white', border:'1px solid #e5e7eb', borderRadius:12, padding:'14px 20px'}}>
        <div style={{display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:8}}>
          <div style={sectionTitle}>Maintenance Events ({maintenance.length})</div>
          <button onClick={()=>{setEditingMaintenance(null); setShowMaintenanceModal(true);}} style={{fontSize:11, color:'white', background:EQUIPMENT_COLOR, border:'none', borderRadius:5, padding:'5px 12px', cursor:'pointer', fontFamily:'inherit', fontWeight:600}}>+ Add Event</button>
        </div>
        {maintenance.length === 0 && <div style={{fontSize:12, color:'#9ca3af', fontStyle:'italic'}}>No maintenance events yet.</div>}
        {maintenance.length > 0 && (
          <div style={{display:'flex', flexDirection:'column', gap:8}}>
            {maintenance.map(m => (
              <div key={m.id} style={{background:'#fafafa', border:'1px solid #e5e7eb', borderRadius:8, padding:'10px 14px'}}>
                <div style={{display:'flex', alignItems:'center', gap:10, marginBottom:6, flexWrap:'wrap'}}>
                  <strong style={{fontSize:13, color:'#111827'}}>{fmt(m.event_date)}</strong>
                  {m.event_type && <span style={{fontSize:10, fontWeight:700, padding:'1px 8px', borderRadius:4, background:'#eff6ff', color:'#1e40af', textTransform:'uppercase'}}>{m.event_type}</span>}
                  {m.title && <span style={{fontSize:12, color:'#374151', fontWeight:600}}>{m.title}</span>}
                  {m.cost && <span style={{fontSize:12, color:'#065f46'}}>${Number(m.cost).toLocaleString()}</span>}
                  {m.hours_at_event && <span style={{fontSize:11, color:'#6b7280'}}>at {Math.round(m.hours_at_event)}h</span>}
                  {m.team_member && <span style={{fontSize:11, color:'#9ca3af'}}>· {m.team_member}</span>}
                  <div style={{marginLeft:'auto', display:'flex', gap:6}}>
                    <button onClick={()=>{setEditingMaintenance(m); setShowMaintenanceModal(true);}} style={{fontSize:11, color:'#1d4ed8', background:'none', border:'none', cursor:'pointer', fontFamily:'inherit'}}>Edit</button>
                    <button onClick={()=>deleteMaintenance(m.id)} style={{fontSize:11, color:'#b91c1c', background:'none', border:'none', cursor:'pointer', fontFamily:'inherit'}}>Delete</button>
                  </div>
                </div>
                {m.description && <div style={{fontSize:12, color:'#4b5563', whiteSpace:'pre-wrap'}}>{m.description}</div>}
                {Array.isArray(m.photos) && m.photos.length > 0 && (
                  <div style={{marginTop:8, display:'flex', gap:6, flexWrap:'wrap'}}>
                    {m.photos.map((p, i) => (
                      <a key={i} href={p.url} target="_blank" rel="noreferrer" title={p.name} style={{display:'block'}}>
                        <img src={p.url} alt={p.name} style={{width:80, height:80, objectFit:'cover', borderRadius:6, border:'1px solid #e5e7eb'}}/>
                      </a>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {showMaintenanceModal && (
        <EquipmentMaintenanceModal
          sb={sb}
          equipment={eq}
          existing={editingMaintenance}
          authState={authState}
          onClose={()=>setShowMaintenanceModal(false)}
          onSaved={()=>{setShowMaintenanceModal(false); onReload();}}
        />
      )}
    </div>
  );
}

function StatTile({label, value, color}) {
  return (
    <div>
      <div style={{color:'#9ca3af', fontSize:10, textTransform:'uppercase', letterSpacing:.4}}>{label}</div>
      <div style={{fontSize:16, fontWeight:700, color:color}}>{value}</div>
    </div>
  );
}
