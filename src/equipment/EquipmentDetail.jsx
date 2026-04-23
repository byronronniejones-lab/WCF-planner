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

export default function EquipmentDetail({sb, fmt, equipment, fuelings, maintenance, authState, isEquipmentTech, onReload}) {
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

  // Per-fueling-row debounced auto-save. Same pattern as the spec panel
  // above, but scoped per fueling row so we can have multiple rows open
  // and editing independently.
  const fuelingTimers = React.useRef({});
  function queueFuelingSave(fuelingId, field, rawValue, parser) {
    const key = fuelingId + ':' + field;
    if (fuelingTimers.current[key]) clearTimeout(fuelingTimers.current[key]);
    fuelingTimers.current[key] = setTimeout(async () => {
      let next;
      if (parser === 'number') {
        const n = parseFloat(rawValue);
        next = Number.isFinite(n) && n >= 0 ? n : null;
      } else {
        next = (rawValue || '').trim() || null;
      }
      const {error} = await sb.from('equipment_fuelings').update({[field]: next}).eq('id', fuelingId);
      if (error) { alert('Save failed: '+error.message); return; }
      onReload();
    }, 800);
  }
  async function deleteFueling(fuelingId) {
    if (!confirm('Delete this fueling entry? This cannot be undone.')) return;
    const {error} = await sb.from('equipment_fuelings').delete().eq('id', fuelingId);
    if (error) { alert('Delete failed: '+error.message); return; }
    onReload();
  }
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
          you stop typing. Matches the cattle/sheep inline-edit pattern.
          Hidden from equipment_tech users (only admins edit specs). */}
      {!isEquipmentTech && (
      <div style={{background:'white', border:'1px solid #e5e7eb', borderRadius:12, padding:'14px 20px'}}>
        <div style={sectionTitle}>Specs & Fluids <span style={{color:'#9ca3af', fontWeight:400, fontSize:10, marginLeft:8}}>Click any field to edit · auto-saves</span></div>
        <div style={{display:'grid', gridTemplateColumns:'repeat(auto-fit, minmax(360px, 1fr))', gap:'8px 18px', fontSize:12}}>
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
            <div key={k} style={{display:'grid', gridTemplateColumns:'130px 1fr', gap:6, alignItems:'center'}}>
              <span style={{color:'#9ca3af'}}>{label}:</span>
              <input
                type="text"
                defaultValue={eq[k] || ''}
                onChange={e => queueFieldSave(k, e.target.value, 'text')}
                style={{...inpS, padding:'4px 7px', background:'transparent'}}
              />
            </div>
          ))}
          <div style={{display:'grid', gridTemplateColumns:'130px 1fr', gap:6, alignItems:'center'}}>
            <span style={{color:'#9ca3af'}}>Warranty ends:</span>
            <input
              type="date"
              defaultValue={eq.warranty_expiration || ''}
              onChange={e => queueFieldSave('warranty_expiration', e.target.value, 'text')}
              style={{...inpS, padding:'4px 7px', background:'transparent'}}
            />
          </div>
          <div style={{display:'grid', gridTemplateColumns:'130px 1fr', gap:6, alignItems:'center'}}>
            <span style={{color:'#9ca3af'}}>Warranty note:</span>
            <input
              type="text"
              defaultValue={eq.warranty_description || ''}
              onChange={e => queueFieldSave('warranty_description', e.target.value, 'text')}
              style={{...inpS, padding:'4px 7px', background:'transparent'}}
            />
          </div>
          <div style={{display:'grid', gridTemplateColumns:'130px 1fr', gap:6, alignItems:'center'}}>
            <span style={{color:'#9ca3af'}}>Fuel tank (gal):</span>
            <input
              type="number" min="0" step="0.1"
              defaultValue={eq.fuel_tank_gal != null ? eq.fuel_tank_gal : ''}
              onChange={e => queueFieldSave('fuel_tank_gal', e.target.value, 'number')}
              style={{...inpS, padding:'4px 7px', background:'transparent'}}
            />
          </div>
          {eq.takes_def && (
            <div style={{display:'grid', gridTemplateColumns:'130px 1fr', gap:6, alignItems:'center'}}>
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

      )}

      {/* Webform config editing (intervals, tasks, help text, every-fillup,
          attachment checklists) lives in /webforms → Equipment admin tab,
          not here. This page is a read view of the piece itself. */}

      {/* Upcoming service calculator */}
      <div style={{background:'white', border:'1px solid #e5e7eb', borderRadius:12, padding:'14px 20px'}}>
        <div style={sectionTitle}>Upcoming Service</div>
        {intervalStatus.length === 0 && <div style={{fontSize:12, color:'#9ca3af', fontStyle:'italic'}}>No service intervals configured yet. Edit equipment to add.</div>}
        {intervalStatus.length > 0 && (
          <div style={{display:'grid', gridTemplateColumns:'repeat(auto-fit, minmax(160px, 1fr))', gap:8}}>
            {intervalStatus.sort((a, b) => (a.next_due - (reading||0)) - (b.next_due - (reading||0))).map(iv => {
              // Two colors only: red for overdue, amber for upcoming.
              const color = iv.overdue ? '#b91c1c' : '#92400e';
              const bg    = iv.overdue ? '#fef2f2' : '#fffbeb';
              const bd    = iv.overdue ? '#fca5a5' : '#fde68a';
              return (
                <div key={iv.kind+'-'+iv.hours_or_km} style={{background:bg, border:'1px solid '+bd, borderRadius:8, padding:'8px 10px', fontSize:11}}>
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
            <div style={{display:'grid', gridTemplateColumns:eq.takes_def?'90px 110px 80px 80px 100px 1fr':'90px 110px 80px 100px 1fr', gap:'0 14px', background:'#f9fafb', padding:'6px 12px', fontSize:10, fontWeight:700, color:'#6b7280', textTransform:'uppercase', letterSpacing:.5}}>
              <div>Date</div>
              <div style={{textAlign:'right'}}>{(eq.fuel_type||'Fuel').toUpperCase()} GAL</div>
              {eq.takes_def && <div style={{textAlign:'right'}}>DEF GAL</div>}
              <div style={{textAlign:'right'}}>{readingLabel}</div>
              <div>Team</div>
              <div>Notes</div>
            </div>
            {sortedFuelings.slice(0, 100).map(f => {
              const isExp = expandedFueling === f.id;
              const rdg = f.hours_reading != null ? Math.round(f.hours_reading) : (f.km_reading != null ? Math.round(f.km_reading) : null);
              return (
                <div key={f.id} style={{borderTop:'1px solid #f3f4f6'}}>
                  <div onClick={()=>setExpandedFueling(isExp?null:f.id)} style={{display:'grid', gridTemplateColumns:eq.takes_def?'90px 110px 80px 80px 100px 1fr':'90px 110px 80px 100px 1fr', gap:'0 14px', padding:'6px 12px', fontSize:12, cursor:'pointer'}} className="hoverable-tile">
                    <div style={{color:'#111827'}}>{fmt(f.date)}</div>
                    <div style={{textAlign:'right', color:'#1e40af', fontWeight:600}}>{f.gallons ? Math.round(f.gallons*10)/10 : '—'}</div>
                    {eq.takes_def && <div style={{textAlign:'right', color:'#a16207', fontWeight:600}}>{f.def_gallons ? Math.round(f.def_gallons*10)/10 : '—'}</div>}
                    <div style={{textAlign:'right', color:'#6b7280'}}>{rdg != null ? rdg.toLocaleString() : '—'}</div>
                    <div style={{color:'#6b7280'}}>{f.team_member||'—'}</div>
                    <div style={{color:'#6b7280', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap', fontStyle:stripPodioHtml(f.comments)?'italic':'normal'}}>{stripPodioHtml(f.comments) || '—'}</div>
                  </div>
                  {isExp && (
                    <div style={{background:'#fafafa', padding:'12px 14px', borderTop:'1px solid #f3f4f6', fontSize:11}}>
                      <div style={{fontSize:10, color:'#9ca3af', textTransform:'uppercase', letterSpacing:.4, fontWeight:600, marginBottom:8}}>Edit entry (auto-saves)</div>
                      <div style={{display:'grid', gridTemplateColumns:'repeat(auto-fit, minmax(130px, 1fr))', gap:8, marginBottom:10}}>
                        <div>
                          <div style={{fontSize:10, color:'#9ca3af'}}>Date</div>
                          <input type="date" defaultValue={f.date||''} onChange={e=>queueFuelingSave(f.id,'date',e.target.value,'text')} style={{fontSize:12, padding:'4px 7px', border:'1px solid #d1d5db', borderRadius:5, fontFamily:'inherit', width:'100%', boxSizing:'border-box'}}/>
                        </div>
                        <div>
                          <div style={{fontSize:10, color:'#9ca3af'}}>Team</div>
                          <input type="text" defaultValue={f.team_member||''} onChange={e=>queueFuelingSave(f.id,'team_member',e.target.value,'text')} style={{fontSize:12, padding:'4px 7px', border:'1px solid #d1d5db', borderRadius:5, fontFamily:'inherit', width:'100%', boxSizing:'border-box'}}/>
                        </div>
                        <div>
                          <div style={{fontSize:10, color:'#9ca3af'}}>Gallons</div>
                          <input type="number" min="0" step="0.1" defaultValue={f.gallons!=null?f.gallons:''} onChange={e=>queueFuelingSave(f.id,'gallons',e.target.value,'number')} style={{fontSize:12, padding:'4px 7px', border:'1px solid #d1d5db', borderRadius:5, fontFamily:'inherit', width:'100%', boxSizing:'border-box'}}/>
                        </div>
                        {eq.takes_def && (
                          <div>
                            <div style={{fontSize:10, color:'#9ca3af'}}>DEF gallons</div>
                            <input type="number" min="0" step="0.1" defaultValue={f.def_gallons!=null?f.def_gallons:''} onChange={e=>queueFuelingSave(f.id,'def_gallons',e.target.value,'number')} style={{fontSize:12, padding:'4px 7px', border:'1px solid #d1d5db', borderRadius:5, fontFamily:'inherit', width:'100%', boxSizing:'border-box'}}/>
                          </div>
                        )}
                        <div>
                          <div style={{fontSize:10, color:'#9ca3af'}}>{readingLabel}</div>
                          <input type="number" min="0" step="0.1" defaultValue={eq.tracking_unit==='km' ? (f.km_reading||'') : (f.hours_reading||'')} onChange={e=>queueFuelingSave(f.id, eq.tracking_unit==='km'?'km_reading':'hours_reading', e.target.value,'number')} style={{fontSize:12, padding:'4px 7px', border:'1px solid #d1d5db', borderRadius:5, fontFamily:'inherit', width:'100%', boxSizing:'border-box'}}/>
                        </div>
                      </div>
                      <div style={{marginBottom:10}}>
                        <div style={{fontSize:10, color:'#9ca3af'}}>Comments</div>
                        <textarea defaultValue={stripPodioHtml(f.comments) || ''} onChange={e=>queueFuelingSave(f.id,'comments',e.target.value,'text')} rows={2} style={{fontSize:12, padding:'4px 7px', border:'1px solid #d1d5db', borderRadius:5, fontFamily:'inherit', width:'100%', boxSizing:'border-box', resize:'vertical'}}/>
                      </div>
                      {(f.every_fillup_check||[]).length > 0 && (
                        <div style={{marginBottom:10}}>
                          <div style={{fontSize:11, fontWeight:700, color:'#065f46', marginBottom:4}}>Every fuel fill up checklist</div>
                          <div style={{display:'flex', flexWrap:'wrap', gap:4}}>
                            {f.every_fillup_check.map((c, i) => <span key={i} style={{fontSize:10, padding:'3px 8px', borderRadius:4, background:'#d1fae5', color:'#065f46', border:'1px solid #a7f3d0'}}>{c.label || c.id}</span>)}
                          </div>
                        </div>
                      )}
                      {(f.service_intervals_completed||[]).length > 0 && (
                        <div style={{marginBottom:10}}>
                          {f.service_intervals_completed.map((c, i) => {
                            // Resolve items_completed IDs → task labels using the
                            // current equipment config (tasks are kept in service_intervals
                            // or attachment_checklists). Falls back to raw ID if not found.
                            const iv = c.attachment_name
                              ? (eq.attachment_checklists || []).find(a => a.name === c.attachment_name && a.kind === c.kind && a.hours_or_km === c.interval)
                              : (eq.service_intervals || []).find(x => x.kind === c.kind && x.hours_or_km === c.interval);
                            const taskById = new Map((iv?.tasks || []).map(t => [t.id, t.label]));
                            const items = Array.isArray(c.items_completed) ? c.items_completed : [];
                            const totalNow = iv?.tasks?.length || c.total_tasks || 0;
                            const isFull = totalNow > 0 && items.length >= totalNow;
                            return (
                              <div key={i} style={{marginBottom:8, padding:'8px 10px', background:'white', border:'1px solid '+(isFull?'#bfdbfe':'#fde68a'), borderRadius:6}}>
                                <div style={{fontSize:11, fontWeight:700, color:isFull?'#1e40af':'#92400e', marginBottom:4}}>
                                  {c.attachment_name ? c.attachment_name+' — ' : ''}{c.label || (c.interval+c.kind.charAt(0))}
                                  <span style={{fontSize:10, fontWeight:500, marginLeft:8, color:'#6b7280'}}>{items.length}/{totalNow} tasks {isFull?'· full':(items.length>0?'· partial':'')}</span>
                                </div>
                                {items.length > 0 && (
                                  <div style={{display:'flex', flexWrap:'wrap', gap:4}}>
                                    {items.map((id, ii) => (
                                      <span key={ii} style={{fontSize:10, padding:'3px 8px', borderRadius:4, background:'#eff6ff', color:'#1e40af', border:'1px solid #bfdbfe'}}>
                                        {taskById.get(id) || id}
                                      </span>
                                    ))}
                                  </div>
                                )}
                              </div>
                            );
                          })}
                        </div>
                      )}
                      {Array.isArray(f.photos) && f.photos.length > 0 && (
                        <div style={{marginBottom:10}}>
                          <div style={{fontSize:11, fontWeight:700, color:'#374151', marginBottom:4}}>Photos ({f.photos.length})</div>
                          <div style={{display:'flex', flexWrap:'wrap', gap:6}}>
                            {f.photos.map((p, i) => (
                              <a key={i} href={p.url} target="_blank" rel="noopener noreferrer" title={p.name || ''} style={{display:'inline-block'}}>
                                <img src={p.url} alt={p.name || ''} style={{width:90, height:90, objectFit:'cover', borderRadius:6, border:'1px solid #e5e7eb', cursor:'pointer'}}/>
                              </a>
                            ))}
                          </div>
                        </div>
                      )}
                      <div style={{display:'flex', justifyContent:'flex-end', marginTop:8}}>
                        <button onClick={()=>deleteFueling(f.id)} style={{padding:'4px 10px', borderRadius:5, border:'1px solid #fecaca', background:'white', color:'#b91c1c', fontSize:11, cursor:'pointer', fontFamily:'inherit'}}>Delete entry</button>
                      </div>
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

      {/* Maintenance events (admin only) */}
      {!isEquipmentTech && (
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
      )}

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

