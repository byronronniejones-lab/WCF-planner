// EquipmentFuelingWebform — per-equipment form rendered at /fueling/<slug>.
// Also handles the /fueling/quick variant: pass equipment=null + the full
// equipment list, and the form adds an equipment-picker at the top.
//
// Writes one equipment_fuelings row. Fuel type is hardcoded per piece
// (not a dropdown). DEF gallons is a separate field shown only when the
// equipment has takes_def=true. Service intervals surface only when they
// are actually due given the reading the team just entered + history.
import React from 'react';
import { computeDueIntervals } from '../lib/equipment.js';

export default function EquipmentFuelingWebform({sb, equipment, equipmentList, onBack}) {
  const isQuick = !equipment;
  const [selectedEq, setSelectedEq] = React.useState(equipment || null);
  const [teamMembers, setTeamMembers] = React.useState([]);
  const [teamMember, setTeamMember] = React.useState(() => localStorage.getItem('wcf_team') || '');
  const [date, setDate] = React.useState(() => new Date().toISOString().slice(0, 10));
  const [gallons, setGallons] = React.useState('');
  const [defGallons, setDefGallons] = React.useState('');
  const [reading, setReading] = React.useState('');
  const [fillupTicks, setFillupTicks] = React.useState(new Set());
  const [intervalTicks, setIntervalTicks] = React.useState(new Set()); // keys 'kind:value'
  const [comments, setComments] = React.useState('');
  const [submitting, setSubmitting] = React.useState(false);
  const [done, setDone] = React.useState(false);
  const [err, setErr] = React.useState('');
  const [history, setHistory] = React.useState([]); // prior fuelings on this piece (for due-interval math)

  const eq = selectedEq;
  const fuelLabel = eq?.fuel_type === 'gasoline' ? 'Gasoline' : (eq?.fuel_type === 'diesel' ? 'Diesel' : 'Fuel');
  const readingLabel = eq?.tracking_unit === 'km' ? 'KM' : 'Hours';

  React.useEffect(() => {
    sb.from('webform_config').select('data').eq('key','team_members').maybeSingle().then(({data}) => {
      if (data && Array.isArray(data.data)) setTeamMembers(data.data);
    });
  }, []);

  // Load this piece's fueling history to compute due intervals.
  React.useEffect(() => {
    if (!eq) { setHistory([]); return; }
    sb.from('equipment_fuelings').select('date,hours_reading,km_reading,service_intervals_completed').eq('equipment_id', eq.id).order('date', {ascending:false}).limit(500).then(({data}) => {
      if (data) setHistory(data);
    });
  }, [eq]);

  // Build the completions list with reading_at_completion baked in for the
  // due-interval math.
  const completions = React.useMemo(() => {
    const out = [];
    for (const h of history) {
      const snap = h.hours_reading != null ? Number(h.hours_reading) : (h.km_reading != null ? Number(h.km_reading) : null);
      if (snap == null) continue;
      for (const c of (h.service_intervals_completed || [])) {
        out.push({...c, reading_at_completion: snap});
      }
    }
    return out;
  }, [history]);

  const readingNum = parseFloat(reading);
  const hasReading = Number.isFinite(readingNum) && readingNum > 0;
  const dueIntervals = React.useMemo(() => {
    if (!eq || !hasReading) return [];
    return computeDueIntervals(eq.service_intervals || [], completions, readingNum);
  }, [eq, completions, readingNum, hasReading]);

  function toggleFillup(id) {
    const next = new Set(fillupTicks);
    if (next.has(id)) next.delete(id); else next.add(id);
    setFillupTicks(next);
  }
  function toggleInterval(kind, value) {
    const k = kind + ':' + value;
    const next = new Set(intervalTicks);
    if (next.has(k)) next.delete(k); else next.add(k);
    setIntervalTicks(next);
  }
  // If the team ticks a big interval, the divisor rule implicitly covers
  // any smaller due interval that divides it. Surface this visually.
  function isImplicitlyCompleted(kind, value) {
    if (!eq) return false;
    if (intervalTicks.has(kind + ':' + value)) return false;
    for (const iv of dueIntervals) {
      if (iv.kind !== kind) continue;
      if (iv.hours_or_km === value) continue;
      if (intervalTicks.has(iv.kind + ':' + iv.hours_or_km) && iv.hours_or_km % value === 0) return true;
    }
    return false;
  }

  async function submit() {
    setErr('');
    if (!eq) { setErr('Pick equipment.'); return; }
    if (!teamMember) { setErr('Pick a team member.'); return; }
    if (!date) { setErr('Date required.'); return; }
    if (!gallons || parseFloat(gallons) <= 0) { setErr(fuelLabel + ' gallons required.'); return; }
    localStorage.setItem('wcf_team', teamMember);

    // Build service_intervals_completed including divisor-rule auto-ticks.
    const completed = [];
    const explicit = new Set();
    for (const key of intervalTicks) {
      const [kind, v] = key.split(':');
      const iv = dueIntervals.find(x => x.kind === kind && String(x.hours_or_km) === v);
      if (!iv) continue;
      completed.push({interval: iv.hours_or_km, kind: iv.kind, label: iv.label, completed_at: date});
      explicit.add(key);
    }
    for (const key of explicit) {
      const [kind, vStr] = key.split(':');
      const v = parseInt(vStr, 10);
      for (const iv of (eq.service_intervals || [])) {
        if (iv.kind !== kind) continue;
        if (iv.hours_or_km === v) continue;
        if (v % iv.hours_or_km !== 0) continue;
        const kk = iv.kind + ':' + iv.hours_or_km;
        if (explicit.has(kk)) continue;
        completed.push({interval: iv.hours_or_km, kind: iv.kind, label: iv.label, completed_at: date, auto_from: v});
      }
    }

    const fillup = Array.from(fillupTicks).map(id => {
      const item = (eq.every_fillup_items || []).find(x => x.id === id);
      return {id, label: item?.label || id, ok: true};
    });

    const defNum = parseFloat(defGallons);
    const rec = {
      id: 'fuel-webform-' + Date.now() + '-' + Math.random().toString(36).slice(2, 6),
      equipment_id: eq.id,
      date,
      team_member: teamMember,
      fuel_type: eq.fuel_type || null,
      gallons: parseFloat(gallons),
      def_gallons: Number.isFinite(defNum) && defNum > 0 ? defNum : null,
      fuel_cost_per_gal: null,
      hours_reading: eq.tracking_unit === 'hours' ? readingNum : null,
      km_reading:    eq.tracking_unit === 'km'    ? readingNum : null,
      every_fillup_check: fillup,
      service_intervals_completed: completed,
      comments: comments || null,
      source: 'fuel_log_webform',
      podio_source_app: null,
    };
    setSubmitting(true);
    const {error} = await sb.from('equipment_fuelings').insert(rec);
    if (error) { setErr('Save failed: '+error.message); setSubmitting(false); return; }
    // Bump current reading on the equipment row.
    if (hasReading) {
      const upd = {};
      if (eq.tracking_unit === 'hours') upd.current_hours = readingNum;
      else if (eq.tracking_unit === 'km') upd.current_km = readingNum;
      if (Object.keys(upd).length > 0) {
        await sb.from('equipment').update(upd).eq('id', eq.id).then(() => {});
      }
    }
    setSubmitting(false);
    setDone(true);
  }

  const wfBg = {minHeight:'100vh', background:'linear-gradient(135deg,#fafaf9 0%,#e7e5e4 100%)', padding:'1rem', fontFamily:'inherit'};
  const cardS = {background:'white', borderRadius:12, padding:'18px 20px', marginBottom:12, boxShadow:'0 1px 3px rgba(0,0,0,.08)'};
  const inpS = {fontFamily:'inherit', fontSize:14, padding:'10px 12px', border:'1px solid #d1d5db', borderRadius:8, width:'100%', outline:'none', background:'white', color:'#111827', boxSizing:'border-box'};
  const lblS = {display:'block', fontSize:12, color:'#6b7280', marginBottom:5, fontWeight:600, textTransform:'uppercase', letterSpacing:.4};
  const logoEl = (
    <div style={{textAlign:'center', marginBottom:20}}>
      <div style={{fontSize:18, fontWeight:800, color:'#57534e', letterSpacing:-.3}}>⛽ WCF Planner</div>
      <div style={{fontSize:12, color:'#6b7280', marginTop:2}}>Fueling Log</div>
    </div>
  );

  if (done) return (
    <div style={wfBg}>
      <div style={{maxWidth:480, margin:'0 auto', paddingTop:'2rem', textAlign:'center'}}>
        {logoEl}
        <div style={{fontSize:56, marginBottom:12}}>{'✅'}</div>
        <div style={{fontSize:20, fontWeight:700, color:'#57534e', marginBottom:8}}>Fueling saved</div>
        <div style={{fontSize:14, color:'#4b5563', marginBottom:28}}>{eq ? eq.name : ''} · {gallons} gal {fuelLabel}{defGallons ? ' + ' + defGallons + ' gal DEF' : ''}</div>
        <button onClick={()=>{
          if (isQuick) { setSelectedEq(null); setDone(false); setGallons(''); setDefGallons(''); setReading(''); setComments(''); setFillupTicks(new Set()); setIntervalTicks(new Set()); }
          else { setDone(false); setGallons(''); setDefGallons(''); setReading(''); setComments(''); setFillupTicks(new Set()); setIntervalTicks(new Set()); }
        }} style={{width:'100%', padding:14, borderRadius:10, border:'none', background:'#57534e', color:'white', fontSize:15, fontWeight:600, cursor:'pointer', fontFamily:'inherit', marginBottom:10}}>Log Another</button>
        <button onClick={onBack} style={{width:'100%', padding:14, borderRadius:10, border:'1px solid #d1d5db', background:'white', color:'#374151', fontSize:15, fontWeight:600, cursor:'pointer', fontFamily:'inherit'}}>Back to Hub</button>
      </div>
    </div>
  );

  return (
    <div style={wfBg}>
      <div style={{maxWidth:520, margin:'0 auto', paddingTop:'1rem'}}>
        {logoEl}
        <button onClick={onBack} style={{background:'none', border:'none', color:'#57534e', fontSize:13, cursor:'pointer', marginBottom:12, padding:0, fontFamily:'inherit'}}>{'‹ Back'}</button>

        {/* Header tile: what piece am I fueling? */}
        <div style={cardS}>
          {isQuick && (
            <div style={{marginBottom:12}}>
              <label style={lblS}>Equipment *</label>
              <select value={eq?.id || ''} onChange={e=>{
                const found = (equipmentList||[]).find(x => x.id === e.target.value);
                setSelectedEq(found || null);
              }} style={inpS}>
                <option value=''>Select equipment...</option>
                {(equipmentList||[]).map(x => <option key={x.id} value={x.id}>{x.name}</option>)}
              </select>
            </div>
          )}
          {eq && !isQuick && (
            <div>
              <div style={{fontSize:18, fontWeight:700, color:'#57534e'}}>{eq.name}</div>
              <div style={{fontSize:12, color:'#6b7280', marginTop:2}}>{eq.fuel_type ? eq.fuel_type.charAt(0).toUpperCase()+eq.fuel_type.slice(1) : ''}{eq.takes_def ? ' + DEF' : ''} · tracks {readingLabel}</div>
            </div>
          )}
        </div>

        {/* Date + Team Member on their own rows */}
        <div style={cardS}>
          <div style={{marginBottom:12}}>
            <label style={lblS}>Date *</label>
            <input type="date" value={date} onChange={e=>setDate(e.target.value)} style={inpS}/>
          </div>
          <div>
            <label style={lblS}>Team Member *</label>
            <select value={teamMember} onChange={e=>setTeamMember(e.target.value)} style={inpS}>
              <option value=''>Select...</option>
              {teamMembers.map(m => <option key={m} value={m}>{m}</option>)}
            </select>
          </div>
        </div>

        {/* Fuel + DEF (per-piece, not a dropdown). */}
        {eq && eq.fuel_type && (
          <div style={cardS}>
            <div style={{marginBottom:12}}>
              <label style={lblS}>{fuelLabel} gallons *</label>
              <input type="number" min="0" step="0.1" value={gallons} onChange={e=>setGallons(e.target.value)} placeholder="0" style={inpS}/>
            </div>
            {eq.takes_def && (
              <div>
                <label style={lblS}>DEF gallons</label>
                <input type="number" min="0" step="0.1" value={defGallons} onChange={e=>setDefGallons(e.target.value)} placeholder="0" style={inpS}/>
              </div>
            )}
          </div>
        )}

        {/* Reading (hours / km). Required for service-interval math. */}
        {eq && (
          <div style={cardS}>
            <label style={lblS}>{readingLabel} *</label>
            <input type="number" min="0" step="0.1" value={reading} onChange={e=>setReading(e.target.value)} placeholder={'Current '+readingLabel.toLowerCase()} style={inpS}/>
            <div style={{fontSize:11, color:'#9ca3af', marginTop:6}}>Every-fillup and service-interval checklists appear below once you enter this.</div>
          </div>
        )}

        {/* Every-fillup checks — hidden until the team enters a reading so
            the checklist section doesn't open before we know what to show. */}
        {eq && hasReading && (eq.every_fillup_items || []).length > 0 && (
          <div style={cardS}>
            <div style={{fontSize:13, fontWeight:700, color:'#57534e', marginBottom:10}}>Every-fillup checks</div>
            <div style={{display:'flex', flexDirection:'column', gap:6}}>
              {eq.every_fillup_items.map(item => (
                <label key={item.id} style={{display:'flex', alignItems:'center', gap:10, padding:'10px 12px', borderRadius:6, background:fillupTicks.has(item.id)?'#ecfdf5':'#f9fafb', cursor:'pointer', border:'1px solid '+(fillupTicks.has(item.id)?'#a7f3d0':'#e5e7eb'), fontSize:13}}>
                  <input type="checkbox" checked={fillupTicks.has(item.id)} onChange={()=>toggleFillup(item.id)} style={{margin:0, flexShrink:0, width:18, height:18, padding:0, border:'1px solid #d1d5db'}}/>
                  <span style={{color:fillupTicks.has(item.id)?'#065f46':'#374151', fontWeight:fillupTicks.has(item.id)?600:500}}>{item.label}</span>
                </label>
              ))}
            </div>
          </div>
        )}

        {/* Service intervals — ONLY those that are due given the reading. */}
        {eq && hasReading && dueIntervals.length > 0 && (
          <div style={cardS}>
            <div style={{fontSize:13, fontWeight:700, color:'#991b1b', marginBottom:4}}>⚠ Service due</div>
            <div style={{fontSize:11, color:'#6b7280', marginBottom:12}}>
              Based on {readingLabel.toLowerCase()} {readingNum.toLocaleString()} + prior completions. Tick any service you performed during this fill. A bigger interval auto-covers smaller ones that divide it.
            </div>
            <div style={{display:'flex', flexDirection:'column', gap:6}}>
              {dueIntervals.map(iv => {
                const k = iv.kind+':'+iv.hours_or_km;
                const explicit = intervalTicks.has(k);
                const implicit = isImplicitlyCompleted(iv.kind, iv.hours_or_km);
                const done = explicit || implicit;
                return (
                  <label key={k} style={{display:'flex', alignItems:'center', gap:10, padding:'10px 12px', borderRadius:6, background:done?'#eff6ff':'#fef2f2', cursor:'pointer', border:'1px solid '+(done?'#bfdbfe':'#fca5a5'), fontSize:13}}>
                    <input type="checkbox" checked={explicit} disabled={implicit} onChange={()=>toggleInterval(iv.kind, iv.hours_or_km)} style={{margin:0, flexShrink:0, width:18, height:18, padding:0, border:'1px solid #d1d5db'}}/>
                    <div style={{flex:1}}>
                      <div style={{fontWeight:700, color:done?'#1e40af':'#991b1b'}}>{iv.label}</div>
                      <div style={{fontSize:11, color:'#6b7280', marginTop:2}}>
                        {iv.missed_count > 1 ? `Missed ${iv.missed_count} times since ` : 'Passed at '}
                        {iv.first_missed_at.toLocaleString()}{iv.kind === 'km' ? ' km' : ' h'}
                        {iv.last_done_at ? ` · last done at ${iv.last_done_at.toLocaleString()}${iv.kind === 'km' ? ' km' : ' h'}` : ' · never completed'}
                        {implicit ? ' · auto-covered' : ''}
                      </div>
                    </div>
                  </label>
                );
              })}
            </div>
          </div>
        )}

        {eq && hasReading && dueIntervals.length === 0 && (eq.service_intervals || []).length > 0 && (
          <div style={{...cardS, border:'1px solid #a7f3d0', background:'#ecfdf5'}}>
            <div style={{fontSize:13, fontWeight:600, color:'#065f46'}}>✓ No service due at {readingNum.toLocaleString()} {readingLabel.toLowerCase()}.</div>
          </div>
        )}

        <div style={cardS}>
          <label style={lblS}>Comments / issues</label>
          <textarea value={comments} onChange={e=>setComments(e.target.value)} rows={3} placeholder="Anything the next team member should know." style={{...inpS, resize:'vertical'}}/>
        </div>

        {err && <div style={{color:'#b91c1c', fontSize:13, marginBottom:10, padding:'8px 12px', background:'#fef2f2', borderRadius:8}}>{err}</div>}

        <button onClick={submit} disabled={submitting || !eq} style={{width:'100%', padding:14, borderRadius:10, border:'none', background:(submitting||!eq)?'#9ca3af':'#57534e', color:'white', fontSize:15, fontWeight:700, cursor:(submitting||!eq)?'not-allowed':'pointer', fontFamily:'inherit'}}>{submitting ? 'Saving…' : 'Save Fueling'}</button>
      </div>
    </div>
  );
}
