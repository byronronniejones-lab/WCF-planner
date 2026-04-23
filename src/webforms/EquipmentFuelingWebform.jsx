// EquipmentFuelingWebform — per-equipment form rendered at /fueling/<slug>.
// Also handles the /fueling/quick variant: pass equipment=null + the full
// equipment list, and the form adds an equipment-picker at the top.
//
// Writes one equipment_fuelings row. Applies the divisor rule when the
// team ticks a bigger interval — any smaller interval that divides it is
// auto-added to service_intervals_completed.
import React from 'react';

export default function EquipmentFuelingWebform({sb, equipment, equipmentList, onBack}) {
  const isQuick = !equipment;
  const [selectedEq, setSelectedEq] = React.useState(equipment || null);
  const [teamMembers, setTeamMembers] = React.useState([]);
  const [teamMember, setTeamMember] = React.useState(() => localStorage.getItem('wcf_team') || '');
  const [date, setDate] = React.useState(() => new Date().toISOString().slice(0, 10));
  const [fuelType, setFuelType] = React.useState(equipment?.fuel_type || '');
  const [gallons, setGallons] = React.useState('');
  const [reading, setReading] = React.useState('');
  const [fillupTicks, setFillupTicks] = React.useState(new Set());
  const [intervalTicks, setIntervalTicks] = React.useState(new Set()); // keys 'kind:value'
  const [comments, setComments] = React.useState('');
  const [submitting, setSubmitting] = React.useState(false);
  const [done, setDone] = React.useState(false);
  const [err, setErr] = React.useState('');

  const eq = selectedEq;

  React.useEffect(() => {
    sb.from('webform_config').select('data').eq('key','team_members').maybeSingle().then(({data}) => {
      if (data && Array.isArray(data.data)) setTeamMembers(data.data);
    });
  }, []);

  React.useEffect(() => {
    if (!eq) return;
    if (!fuelType && eq.fuel_type) setFuelType(eq.fuel_type);
  }, [eq]);

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
  // Divisor rule preview: when the user ticks a big interval X, we light up
  // any registered smaller interval Y where Y | X. (Visual aid; the submit
  // also writes those completions.)
  function isImplicitlyCompleted(kind, value) {
    if (!eq) return false;
    if (intervalTicks.has(kind + ':' + value)) return false; // explicitly ticked
    for (const iv of (eq.service_intervals || [])) {
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
    if (!gallons || parseFloat(gallons) <= 0) { setErr('Gallons required.'); return; }
    localStorage.setItem('wcf_team', teamMember);

    // Build service_intervals_completed including divisor-rule auto-ticks.
    const completed = [];
    const explicit = new Set();
    for (const key of intervalTicks) {
      const [kind, v] = key.split(':');
      const iv = (eq.service_intervals || []).find(x => x.kind === kind && String(x.hours_or_km) === v);
      if (!iv) continue;
      completed.push({interval: iv.hours_or_km, kind: iv.kind, label: iv.label, completed_at: date});
      explicit.add(key);
    }
    // Auto-tick divisors of every explicit tick.
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

    // every_fillup_check array
    const fillup = Array.from(fillupTicks).map(id => {
      const item = (eq.every_fillup_items || []).find(x => x.id === id);
      return {id, label: item?.label || id, ok: true};
    });

    const readingNum = parseFloat(reading);
    const rec = {
      id: 'fuel-webform-' + Date.now() + '-' + Math.random().toString(36).slice(2, 6),
      equipment_id: eq.id,
      date,
      team_member: teamMember,
      fuel_type: fuelType || null,
      gallons: parseFloat(gallons),
      fuel_cost_per_gal: null,
      hours_reading: eq.tracking_unit === 'hours' && Number.isFinite(readingNum) ? readingNum : null,
      km_reading:    eq.tracking_unit === 'km'    && Number.isFinite(readingNum) ? readingNum : null,
      every_fillup_check: fillup,
      service_intervals_completed: completed,
      comments: comments || null,
      source: 'fuel_log_webform',
      podio_source_app: null,
    };
    setSubmitting(true);
    const {error} = await sb.from('equipment_fuelings').insert(rec);
    if (error) { setErr('Save failed: '+error.message); setSubmitting(false); return; }
    // Update equipment's current reading + fuel_type if we got new info.
    if (Number.isFinite(readingNum)) {
      const upd = {};
      if (eq.tracking_unit === 'hours') upd.current_hours = readingNum;
      else if (eq.tracking_unit === 'km') upd.current_km = readingNum;
      if (fuelType && fuelType !== eq.fuel_type) upd.fuel_type = fuelType;
      if (Object.keys(upd).length > 0) {
        await sb.from('equipment').update(upd).eq('id', eq.id).then(() => {});
      }
    }
    setSubmitting(false);
    setDone(true);
  }

  const wfBg = {minHeight:'100vh', background:'linear-gradient(135deg,#fafaf9 0%,#e7e5e4 100%)', padding:'1rem', fontFamily:'inherit'};
  const cardS = {background:'white', borderRadius:12, padding:'20px', marginBottom:12, boxShadow:'0 1px 3px rgba(0,0,0,.08)'};
  const inpS = {fontFamily:'inherit', fontSize:14, padding:'10px 12px', border:'1px solid #d1d5db', borderRadius:8, width:'100%', outline:'none', background:'white', color:'#111827', boxSizing:'border-box'};
  const lblS = {display:'block', fontSize:13, color:'#374151', marginBottom:5, fontWeight:500};
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
        <div style={{fontSize:14, color:'#4b5563', marginBottom:28}}>{eq ? eq.name : ''} · {gallons} gal{fuelType ? ' · '+fuelType : ''}</div>
        <button onClick={()=>{
          if (isQuick) { setSelectedEq(null); setDone(false); setGallons(''); setReading(''); setComments(''); setFillupTicks(new Set()); setIntervalTicks(new Set()); }
          else { setDone(false); setGallons(''); setReading(''); setComments(''); setFillupTicks(new Set()); setIntervalTicks(new Set()); }
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

        <div style={cardS}>
          {isQuick && (
            <div style={{marginBottom:12}}>
              <label style={lblS}>Equipment *</label>
              <select value={eq?.id || ''} onChange={e=>{
                const found = (equipmentList||[]).find(x => x.id === e.target.value);
                setSelectedEq(found || null);
                if (found && found.fuel_type) setFuelType(found.fuel_type);
              }} style={inpS}>
                <option value=''>Select equipment...</option>
                {(equipmentList||[]).map(x => <option key={x.id} value={x.id}>{x.name}</option>)}
              </select>
            </div>
          )}
          {eq && !isQuick && (
            <div style={{marginBottom:12}}>
              <div style={{fontSize:18, fontWeight:700, color:'#57534e'}}>{eq.name}</div>
              <div style={{fontSize:11, color:'#6b7280', marginTop:2}}>{eq.tracking_unit === 'km' ? 'tracks KM' : 'tracks hours'}{eq.fuel_type ? ' · '+eq.fuel_type : ''}</div>
            </div>
          )}
          <div style={{marginBottom:10}}>
            <label style={lblS}>Date *</label>
            <input type="date" value={date} onChange={e=>setDate(e.target.value)} style={inpS}/>
          </div>
          <div style={{marginBottom:10}}>
            <label style={lblS}>Team Member *</label>
            <select value={teamMember} onChange={e=>setTeamMember(e.target.value)} style={inpS}>
              <option value=''>Select...</option>
              {teamMembers.map(m => <option key={m} value={m}>{m}</option>)}
            </select>
          </div>
          <div style={{display:'grid', gridTemplateColumns:'1fr 1fr', gap:8, marginBottom:10}}>
            <div>
              <label style={lblS}>Fuel type</label>
              <select value={fuelType} onChange={e=>setFuelType(e.target.value)} style={inpS}>
                <option value=''>—</option>
                <option value='diesel'>Diesel</option>
                <option value='gasoline'>Gasoline</option>
                <option value='def'>DEF</option>
              </select>
            </div>
            <div>
              <label style={lblS}>Gallons *</label>
              <input type="number" min="0" step="0.1" value={gallons} onChange={e=>setGallons(e.target.value)} placeholder="0" style={inpS}/>
            </div>
          </div>
          <div style={{marginBottom:10}}>
            <label style={lblS}>{eq?.tracking_unit === 'km' ? 'KM reading' : 'Hours reading'}</label>
            <input type="number" min="0" step="0.1" value={reading} onChange={e=>setReading(e.target.value)} placeholder="e.g. 1234" style={inpS}/>
          </div>
        </div>

        {eq && (eq.every_fillup_items || []).length > 0 && (
          <div style={cardS}>
            <div style={{fontSize:13, fontWeight:700, color:'#57534e', marginBottom:10}}>Every-fillup checks</div>
            <div style={{display:'flex', flexDirection:'column', gap:6}}>
              {eq.every_fillup_items.map(item => (
                <label key={item.id} style={{display:'flex', alignItems:'center', gap:10, padding:'8px 10px', borderRadius:6, background:fillupTicks.has(item.id)?'#ecfdf5':'#f9fafb', cursor:'pointer', border:'1px solid '+(fillupTicks.has(item.id)?'#a7f3d0':'#e5e7eb'), fontSize:13}}>
                  <input type="checkbox" checked={fillupTicks.has(item.id)} onChange={()=>toggleFillup(item.id)} style={{margin:0}}/>
                  <span style={{color:fillupTicks.has(item.id)?'#065f46':'#374151', fontWeight:fillupTicks.has(item.id)?600:500}}>{item.label}</span>
                </label>
              ))}
            </div>
          </div>
        )}

        {eq && (eq.service_intervals || []).length > 0 && (
          <div style={cardS}>
            <div style={{fontSize:13, fontWeight:700, color:'#57534e', marginBottom:4}}>Service intervals</div>
            <div style={{fontSize:11, color:'#6b7280', marginBottom:10}}>Tick a bigger interval to auto-complete any smaller one that divides it.</div>
            <div style={{display:'grid', gridTemplateColumns:'repeat(auto-fit, minmax(130px, 1fr))', gap:6}}>
              {eq.service_intervals.map(iv => {
                const k = iv.kind+':'+iv.hours_or_km;
                const explicit = intervalTicks.has(k);
                const implicit = isImplicitlyCompleted(iv.kind, iv.hours_or_km);
                const done = explicit || implicit;
                return (
                  <label key={k} style={{display:'flex', alignItems:'center', gap:8, padding:'7px 10px', borderRadius:6, background:done?'#eff6ff':'#f9fafb', cursor:'pointer', border:'1px solid '+(done?'#bfdbfe':'#e5e7eb'), fontSize:12}}>
                    <input type="checkbox" checked={explicit} disabled={implicit} onChange={()=>toggleInterval(iv.kind, iv.hours_or_km)} style={{margin:0}}/>
                    <span style={{color:done?'#1e40af':'#374151', fontWeight:done?700:500}}>{iv.hours_or_km}{iv.kind.charAt(0)}{implicit ? ' ·auto' : ''}</span>
                  </label>
                );
              })}
            </div>
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
