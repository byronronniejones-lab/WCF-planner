// Public Fuel Supply Log webform. Canonical URL is /fueling/supply (tile on
// the FuelingHub). Legacy /fuel-supply alias is still wired in main.jsx + routes.js
// so any direct bookmarks keep working.
//
// Logged when there's no fueling checklist for what's being filled with fuel
// (portable cell fills, gas cans, farm-truck top-offs, etc). Writes to
// fuel_supplies — never counts as equipment consumption.
//
// Anonymous access (RLS policy on fuel_supplies allows anon insert). No
// auth required.

import React from 'react';

const DESTINATIONS = [
  {value:'cell',       label:'Portable fuel cell'},
  {value:'gas_can',    label:'Gas can(s)'},
  {value:'farm_truck', label:'Farm truck'},
  {value:'other',      label:'Other'},
];

const FUEL_TYPES = [
  {value:'diesel',   label:'Diesel'},
  {value:'gasoline', label:'Gasoline'},
  {value:'def',      label:'DEF'},
];

export default function FuelSupplyWebform({sb, onBack}) {
  const [teamMembers, setTeamMembers] = React.useState([]);
  const today = new Date().toISOString().slice(0, 10);
  const [date, setDate] = React.useState(today);
  const [team, setTeam] = React.useState(localStorage.getItem('wcf_team') || '');
  const [gallons, setGallons] = React.useState('');
  const [fuelType, setFuelType] = React.useState('diesel');
  const [destination, setDestination] = React.useState('cell');
  const [notes, setNotes] = React.useState('');
  const [err, setErr] = React.useState('');
  const [submitting, setSubmitting] = React.useState(false);
  const [done, setDone] = React.useState(false);

  React.useEffect(() => {
    let cancelled = false;
    (async () => {
      // Per-form override (admin > Equipment > Fuel Supply) wins.
      const {data: pf} = await sb.from('webform_config').select('data').eq('key','per_form_team_members').maybeSingle();
      const pfList = pf && pf.data && Array.isArray(pf.data['fuel-supply']) ? pf.data['fuel-supply'] : null;
      if (pfList && pfList.length) {
        if (!cancelled) setTeamMembers(pfList);
        return;
      }
      // Fall back to the master list.
      const {data} = await sb.from('webform_config').select('data').eq('key','team_members').maybeSingle();
      if (!cancelled && data && Array.isArray(data.data)) setTeamMembers(data.data);
    })();
    return () => { cancelled = true; };
  }, [sb]);

  async function submit() {
    setErr('');
    if (!team) { setErr('Pick a team member.'); return; }
    if (!date) { setErr('Date required.'); return; }
    const gal = parseFloat(gallons);
    if (!Number.isFinite(gal) || gal <= 0) { setErr('Gallons must be a positive number.'); return; }
    localStorage.setItem('wcf_team', team);
    setSubmitting(true);

    const id = 'fs-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8);
    const rec = {
      id,
      date,
      gallons: gal,
      fuel_type: fuelType || null,
      destination,
      team_member: team,
      notes: notes.trim() || null,
      source: 'webform',
    };

    const {error} = await sb.from('fuel_supplies').insert(rec);
    setSubmitting(false);
    if (error) { setErr('Save failed: ' + error.message); return; }
    setDone(true);
    // Reset for a fresh entry
    setGallons(''); setNotes('');
  }

  const cardS = {background:'white', border:'1px solid #e5e7eb', borderRadius:12, padding:'14px 18px', marginBottom:14};
  const lblS  = {display:'block', fontSize:11, fontWeight:600, color:'#4b5563', textTransform:'uppercase', letterSpacing:.4, marginBottom:4};
  const inpS  = {fontSize:14, padding:'8px 10px', border:'1px solid #d1d5db', borderRadius:6, fontFamily:'inherit', width:'100%', boxSizing:'border-box'};

  return (
    <div style={{minHeight:'100vh', background:'#f1f3f2'}}>
      <div style={{background:'#085041', color:'white', padding:'14px 20px', display:'flex', alignItems:'center', gap:12}}>
        <div style={{fontSize:18, fontWeight:700}}>⛽ Fuel Supply Log</div>
        <div style={{fontSize:11, opacity:.85}}>WCF Planner</div>
        {onBack && <button onClick={onBack} style={{marginLeft:'auto', background:'transparent', color:'white', border:'1px solid rgba(255,255,255,.4)', borderRadius:6, padding:'4px 10px', cursor:'pointer', fontSize:12, fontFamily:'inherit'}}>← Back</button>}
      </div>

      <div style={{maxWidth:560, margin:'0 auto', padding:'16px'}}>
        <div style={{...cardS, background:'#fffbeb', borderColor:'#fde68a'}}>
          <div style={{fontSize:12, fontWeight:700, color:'#92400e', marginBottom:6}}>⚠ When to use this form</div>
          <div style={{fontSize:12, color:'#78716c'}}>
            Use this form when there is no fueling checklist for what is being filled with fuel.
          </div>
        </div>

        {done && (
          <div style={{...cardS, background:'#ecfdf5', borderColor:'#a7f3d0'}}>
            <div style={{fontSize:13, fontWeight:700, color:'#065f46', marginBottom:4}}>✓ Supply logged</div>
            <div style={{fontSize:12, color:'#047857'}}>Form reset for another entry. You can keep logging deliveries.</div>
          </div>
        )}

        <div style={cardS}>
          <div style={{marginBottom:12}}>
            <label style={lblS}>Date *</label>
            <input type="date" value={date} onChange={e=>setDate(e.target.value)} style={inpS}/>
          </div>

          <div style={{marginBottom:12}}>
            <label style={lblS}>Team member *</label>
            <select value={team} onChange={e=>setTeam(e.target.value)} style={inpS}>
              <option value=''>Select…</option>
              {teamMembers.map(n => <option key={n} value={n}>{n}</option>)}
            </select>
          </div>

          <div style={{marginBottom:12}}>
            <label style={lblS}>Destination *</label>
            <select value={destination} onChange={e=>setDestination(e.target.value)} style={inpS}>
              {DESTINATIONS.map(d => <option key={d.value} value={d.value}>{d.label}</option>)}
            </select>
          </div>

          <div style={{marginBottom:12}}>
            <label style={lblS}>Fuel type *</label>
            <select value={fuelType} onChange={e=>setFuelType(e.target.value)} style={inpS}>
              {FUEL_TYPES.map(f => <option key={f.value} value={f.value}>{f.label}</option>)}
            </select>
          </div>

          <div style={{marginBottom:12}}>
            <label style={lblS}>Gallons *</label>
            <input type="number" min="0" step="0.1" value={gallons} onChange={e=>setGallons(e.target.value)} placeholder="e.g. 300" style={inpS}/>
          </div>

          <div style={{marginBottom:12}}>
            <label style={lblS}>Notes <span style={{color:'#9ca3af', textTransform:'none', fontWeight:400}}>(optional)</span></label>
            <textarea rows={3} value={notes} onChange={e=>setNotes(e.target.value)} placeholder="Anything worth noting" style={{...inpS, resize:'vertical'}}/>
          </div>

          {err && <div style={{background:'#fef2f2', border:'1px solid #fecaca', color:'#b91c1c', padding:'8px 12px', borderRadius:6, fontSize:12, marginBottom:12}}>{err}</div>}

          <button
            onClick={submit}
            disabled={submitting}
            style={{
              width:'100%', padding:'14px 16px', borderRadius:8, border:'none',
              background: submitting ? '#9ca3af' : '#085041', color:'white',
              fontSize:15, fontWeight:700, cursor: submitting ? 'not-allowed' : 'pointer',
              fontFamily:'inherit',
            }}>
            {submitting ? 'Saving…' : 'Log supply'}
          </button>
        </div>
      </div>
    </div>
  );
}
