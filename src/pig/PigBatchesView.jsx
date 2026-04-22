// ============================================================================
// src/pig/PigBatchesView.jsx  —  Phase 2 Round 6
// ----------------------------------------------------------------------------
// Pig feeder batches admin view (largest inline-JSX view by line count —
// ~662 lines). Pig entity arrays, the feeder form, and the trip form all
// live in PigContext; collapsed-state Sets, the three auto-save refs, and
// the persistFeeders helper still live in App and come in as props.
// ============================================================================
import React from 'react';
import { sb } from '../lib/supabase.js';
import { fmt, fmtS, todayISO, addDays, toISO } from '../lib/dateUtils.js';
import { S } from '../lib/styles.js';
import {
  calcBreedingTimeline,
  calcCycleStatus,
  buildCycleSeqMap,
  cycleLabel,
  PIG_GROUP_COLORS,
} from '../lib/pig.js';
import UsersModal from '../auth/UsersModal.jsx';
import { useAuth } from '../contexts/AuthContext.jsx';
import { usePig } from '../contexts/PigContext.jsx';
import { useDailysRecent } from '../contexts/DailysRecentContext.jsx';
import { useUI } from '../contexts/UIContext.jsx';

export default function PigBatchesView({
  Header, loadUsers, persistFeeders, confirmDelete,
  pigAutoSaveTimer, subAutoSaveTimer, tripAutoSaveTimer,
  showSubForm, setShowSubForm,
  subForm, setSubForm,
  editSubId, setEditSubId,
  collapsedBatches, setCollapsedBatches,
  collapsedMonths, setCollapsedMonths,
  showArchBatches, setShowArchBatches,
}) {
  const { authState, showUsers, setShowUsers, allUsers, setAllUsers } = useAuth();
  const {
    breedingCycles,
    breeders,
    farrowingRecs,
    feederGroups, setFeederGroups,
    feederForm, setFeederForm,
    originalFeederForm, setOriginalFeederForm,
    showFeederForm, setShowFeederForm,
    editFeederId, setEditFeederId,
    activeTripBatchId, setActiveTripBatchId,
    tripForm, setTripForm,
    editTripId, setEditTripId,
    boarNames,
  } = usePig();
  const { pigDailys } = useDailysRecent();
  const { setView } = useUI();
    const statusColors = {active:{bg:"#085041",tx:"white"},processed:{bg:"#4b5563",tx:"white"}};
    const cycleSeqMap = buildCycleSeqMap(breedingCycles);
    // Trip source tracking: for each processing trip, which weigh-in session(s)
    // contributed pigs. Pulled from weigh_ins (sent_to_trip_id) + sessions (batch_id).
    const [tripSentWeighins, setTripSentWeighins] = React.useState([]);
    const [tripSessionBatch, setTripSessionBatch] = React.useState({}); // session_id -> batch_id
    React.useEffect(() => {
      (async () => {
        const { data: sent } = await sb.from('weigh_ins').select('id, session_id, sent_to_trip_id, weight').not('sent_to_trip_id', 'is', null);
        if(!sent) return;
        setTripSentWeighins(sent);
        const ids = [...new Set(sent.map(e => e.session_id).filter(Boolean))];
        if(ids.length === 0) return;
        const { data: sess } = await sb.from('weigh_in_sessions').select('id, batch_id').in('id', ids);
        const m = {};
        (sess||[]).forEach(s => { m[s.id] = s.batch_id; });
        setTripSessionBatch(m);
      })();
    }, []);
    function tripSourceCounts(tripId) {
      if(!tripId) return {};
      const counts = {};
      tripSentWeighins.forEach(e => {
        if(e.sent_to_trip_id !== tripId) return;
        const name = tripSessionBatch[e.session_id] || 'Unknown session';
        counts[name] = (counts[name] || 0) + 1;
      });
      return counts;
    }

    // Match pig_dailys to a name (case-insensitive) — used for both batch and sub-batch matching
    function dailysForName(name){
      const n = name.trim().toLowerCase();
      // Also build a slug version for fallback matching
      const slug = n.replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'');
      return pigDailys.filter(d=>{
        const lbl = (d.batch_label||"").trim().toLowerCase();
        const bid = (d.batch_id||"").trim().toLowerCase();
        const bidSlug = bid.replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'');
        const lblSlug = lbl.replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'');
        return lbl===n || bid===n || bidSlug===slug || lblSlug===slug;
      });
    }

    function archiveBatch(batchId){
      if(!window.confirm("Mark this batch as processed? It will be hidden from the webform.")) return;
      const nb = feederGroups.map(g=>g.id===batchId?{...g,status:"processed",subBatches:(g.subBatches||[]).map(s=>({...s,status:"processed"}))}:g);
      persistFeeders(nb);
    }
    function unarchiveBatch(batchId){
      const nb = feederGroups.map(g=>g.id===batchId?{...g,status:"active"}:g);
      persistFeeders(nb);
    }
    function archiveSubBatch(batchId, subId){
      const nb = feederGroups.map(g=>g.id!==batchId?g:{...g,subBatches:(g.subBatches||[]).map(s=>s.id===subId?{...s,status:"processed"}:s)});
      persistFeeders(nb);
    }
    function unarchiveSubBatch(batchId, subId){
      const nb = feederGroups.map(g=>g.id!==batchId?g:{...g,subBatches:(g.subBatches||[]).map(s=>s.id===subId?{...s,status:"active"}:s)});
      persistFeeders(nb);
    }
    // Persist a sub-batch using the given form state. Returns the new subId on success.
    // For new sub-batches: only persists if name is non-empty (so in-progress new entries don't pollute the list).
    // For edit mode (editSubId set): always persists.
    function persistSubBatch(batchId, formState, currentSubId){
      // Parse numeric form fields back to numbers (form state holds raw strings during typing)
      const subFormNum = {...formState};
      ['giltCount','boarCount','originalPigCount'].forEach(key=>{
        const v = subFormNum[key];
        subFormNum[key] = (v===''||v==null) ? 0 : (parseFloat(v)||0);
      });
      const subId = currentSubId || String(Date.now());
      const nb = feederGroups.map(g=>{
        if(g.id!==batchId) return g;
        const subs = g.subBatches||[];
        const sub = {id:subId, status:"active", ...subFormNum};
        const updated = currentSubId ? subs.map(s=>s.id===currentSubId?sub:s) : [...subs,sub];
        return {...g, subBatches:updated};
      });
      persistFeeders(nb);
      return subId;
    }

    function updSub(batchId, k, v){
      const next = {...subForm, [k]: v};
      setSubForm(next);
      // Only autosave once name is set (otherwise creating an empty sub-batch on every keystroke)
      if(!next.name || !next.name.trim()) return;
      clearTimeout(subAutoSaveTimer.current);
      subAutoSaveTimer.current = setTimeout(()=>{
        const newId = persistSubBatch(batchId, next, editSubId);
        // For new sub-batch: after first autosave, switch to edit mode so subsequent saves update the same row
        if(!editSubId) setEditSubId(newId);
      }, 1500);
    }

    function closeSubForm(batchId){
      clearTimeout(subAutoSaveTimer.current);
      // Flush any pending changes synchronously on close (only if name is filled)
      if(subForm.name && subForm.name.trim()){
        persistSubBatch(batchId, subForm, editSubId);
      }
      setShowSubForm(null);
      setEditSubId(null);
      setSubForm({name:"",giltCount:0,boarCount:0,originalPigCount:0,notes:""});
    }

    function saveSubBatch(batchId){
      if(!subForm.name.trim()){alert("Please enter a sub-batch name.");return;}
      clearTimeout(subAutoSaveTimer.current);
      persistSubBatch(batchId, subForm, editSubId);
      setShowSubForm(null); setEditSubId(null); setSubForm({name:"",giltCount:0,boarCount:0,originalPigCount:0,notes:""});
    }
    function deleteSubBatch(batchId, subId){
      confirmDelete("Delete this sub-batch? This cannot be undone.",()=>{
        const nb = feederGroups.map(g=>g.id!==batchId?g:{...g,subBatches:(g.subBatches||[]).filter(s=>s.id!==subId)});
        persistFeeders(nb);
      });
    }

    function daysToMWD(days) {
      // Ronnie prefers months+weeks on the batch tile. Days dropped.
      if(days<=0) return null;
      const m = Math.floor(days/30);
      const w = Math.floor((days % 30)/7);
      return `${m}m ${w}w`;
    }

    // Get farrowing records that belong to a given breeding cycle (match group + within farrowing window)
    function cycleRecords(cycle) {
      if(!cycle) return [];
      const tl = calcBreedingTimeline(cycle.exposureStart);
      if(!tl) return [];
      return farrowingRecs.filter(r => {
        if(r.group !== cycle.group) return false;
        if(!r.farrowingDate) return false;
        // Must fall within the theoretical farrowing window (with a 2-week buffer for edge cases)
        const rd = new Date(r.farrowingDate+"T12:00:00");
        const wStart = new Date(tl.farrowingStart+"T12:00:00");
        const wEnd   = addDays(tl.farrowingEnd, 14); // buffer
        return rd >= wStart && rd <= wEnd;
      });
    }

    function calcAgeRange(cycleId) {
      const cycle = breedingCycles.find(c=>c.id===cycleId);
      if(!cycle) return {text:"—", hasActual:false, count:0, total:0};
      const tl = calcBreedingTimeline(cycle.exposureStart);
      if(!tl) return {text:"—", hasActual:false, count:0, total:0};

      const recs = cycleRecords(cycle);
      const today = new Date();

      let firstDate, lastDate, hasActual=false;

      if(recs.length>0) {
        // Use actual farrowing dates
        const dates = recs.map(r=>new Date(r.farrowingDate+"T12:00:00")).sort((a,b)=>a-b);
        firstDate = dates[0];
        lastDate  = dates[dates.length-1];
        hasActual = true;
      } else {
        // Fall back to theoretical window
        firstDate = new Date(tl.farrowingStart+"T12:00:00");
        lastDate  = new Date(tl.farrowingEnd+"T12:00:00");
      }

      const oldestDays   = Math.round((today-firstDate)/86400000);
      const youngestDays = Math.round((today-lastDate)/86400000);

      if(oldestDays<=0) return {text:"Not yet born", hasActual, count:recs.length, total:parseInt(cycle.sowCount)||0};
      const oldest = daysToMWD(oldestDays);
      const text = youngestDays<=0
        ? `Up to ${oldest}${!hasActual?" (est.)":""}`
        : `${daysToMWD(youngestDays)} – ${oldest}${!hasActual?" (est.)":""}`;
      return {text, hasActual, count:recs.length, total:parseInt(cycle.sowCount)||0};
    }

    // Trip helpers
    function parseLiveWeights(str) {
      return (str||"").split(/[\s,]+/).map(v=>parseFloat(v)).filter(v=>!isNaN(v)&&v>0);
    }
    function tripTotalLive(t) { return parseLiveWeights(t.liveWeights).reduce((a,b)=>a+b,0); }
    function tripYield(t) {
      const live = tripTotalLive(t);
      const hang = parseFloat(t.hangingWeight)||0;
      if(!live||!hang) return null;
      return Math.round((hang/live)*1000)/10;
    }

    function persistTrip(batchId, formSnapshot, currentTripId) {
      if(!formSnapshot.date) return;
      const tripFormNum = {...formSnapshot};
      ['pigCount','hangingWeight'].forEach(key=>{
        const v = tripFormNum[key];
        tripFormNum[key] = (v===''||v==null) ? 0 : (parseFloat(v)||0);
      });
      const tripId = currentTripId || String(Date.now());
      const trip = {id:tripId, ...tripFormNum};
      const nb = feederGroups.map(g=>{
        if(g.id!==batchId) return g;
        const trips = g.processingTrips||[];
        const updated = currentTripId ? trips.map(t=>t.id===currentTripId?trip:t) : [...trips,trip];
        updated.sort((a,b)=>a.date.localeCompare(b.date));
        return {...g, processingTrips:updated};
      });
      persistFeeders(nb);
      if(!editTripId) setEditTripId(tripId);
      return tripId;
    }
    function updTrip(k, v) {
      const next = {...tripForm, [k]: v};
      setTripForm(next);
      if(!next.date) return;
      clearTimeout(tripAutoSaveTimer.current);
      tripAutoSaveTimer.current = setTimeout(()=>{
        persistTrip(activeTripBatchId, next, editTripId);
      }, 1500);
    }
    function closeTripForm() {
      clearTimeout(tripAutoSaveTimer.current);
      if(tripForm.date && activeTripBatchId) {
        persistTrip(activeTripBatchId, tripForm, editTripId);
      }
      setTripForm({date:"",pigCount:0,liveWeights:"",hangingWeight:0,notes:""});
      setEditTripId(null); setActiveTripBatchId(null);
    }

    function deleteTrip(batchId, tripId) {
      confirmDelete("Delete this processing trip? This cannot be undone.",()=>{
        const nb = feederGroups.map(g=>{
          if(g.id!==batchId) return g;
          return {...g, processingTrips:(g.processingTrips||[]).filter(t=>t.id!==tripId)};
        });
        persistFeeders(nb);
      });
    }

    function updFeeder(k, v) {
      const f = {...feederForm, [k]: v};
      // Auto-compute originalPigCount from gilts + boars
      if(k==='giltCount'||k==='boarCount') f.originalPigCount=(parseInt(k==='giltCount'?v:f.giltCount)||0)+(parseInt(k==='boarCount'?v:f.boarCount)||0);
      setFeederForm(f);
      if (editFeederId) {
        clearTimeout(pigAutoSaveTimer.current);
        pigAutoSaveTimer.current = setTimeout(() => {
          // Parse numeric form fields back to numbers (form state holds raw strings during typing)
          const fNum = {...f};
          ['giltCount','boarCount','originalPigCount','perLbFeedCost','legacyFeedLbs'].forEach(key=>{
            const v2 = fNum[key];
            fNum[key] = (v2===''||v2==null) ? 0 : (parseFloat(v2)||0);
          });
          const existing = feederGroups.find(g => g.id === editFeederId);
          const grp = {processingTrips:[], subBatches:[], ...existing, ...fNum, id: editFeederId};
          const nb = feederGroups.map(g => g.id === editFeederId ? grp : g);
          persistFeeders(nb);
          setOriginalFeederForm(f);
        }, 1500);
      }
    }
    function closeFeederForm() {
      clearTimeout(pigAutoSaveTimer.current);
      if (editFeederId && originalFeederForm) {
        const FEEDER_KEYS = ['batchName','cycleId','giltCount','boarCount','startDate','originalPigCount','perLbFeedCost','legacyFeedLbs','notes','status'];
        const changed = FEEDER_KEYS.some(k => String(feederForm[k]||'') !== String(originalFeederForm[k]||''));
        if (changed) {
          // Parse numeric form fields back to numbers
          const fNum = {...feederForm};
          ['giltCount','boarCount','originalPigCount','perLbFeedCost','legacyFeedLbs'].forEach(key=>{
            const v2 = fNum[key];
            fNum[key] = (v2===''||v2==null) ? 0 : (parseFloat(v2)||0);
          });
          const existing = feederGroups.find(g => g.id === editFeederId);
          const grp = {processingTrips:[], subBatches:[], ...existing, ...fNum, id: editFeederId};
          const nb = feederGroups.map(g => g.id === editFeederId ? grp : g);
          persistFeeders(nb);
        }
      }
      setShowFeederForm(false);
      setEditFeederId(null);
      setOriginalFeederForm(null);
    }

    return (
      <div>
        <Header/>
        <div style={{padding:"1rem"}}>
          {showUsers&&<UsersModal sb={sb} authState={authState} allUsers={allUsers} setAllUsers={setAllUsers} setShowUsers={setShowUsers} loadUsers={loadUsers}/>}
          <div style={{display:"flex",justifyContent:"flex-end",marginBottom:12}}>
            <div style={{display:"flex",gap:8,alignItems:"center"}}>
              {feederGroups.some(g=>g.status==="processed")&&(
                <button onClick={()=>setShowArchBatches(s=>!s)}
                  style={{padding:"7px 14px",borderRadius:8,border:"1px solid #d1d5db",background:"white",color:"#6b7280",cursor:"pointer",fontSize:12,fontFamily:"inherit"}}>
                  {showArchBatches?"Hide processed":"Show processed"} ({feederGroups.filter(g=>g.status==="processed").length})
                </button>
              )}
              <button onClick={()=>{setFeederForm({batchName:"",cycleId:"",giltCount:0,boarCount:0,startDate:"",originalPigCount:0,perLbFeedCost:0,legacyFeedLbs:0,notes:"",status:"active"});setEditFeederId(null);setShowFeederForm(true);setActiveTripBatchId(null);setShowSubForm(null);}}
                style={{padding:"7px 18px",borderRadius:8,border:"none",background:"#085041",color:"white",cursor:"pointer",fontSize:12,fontWeight:600,letterSpacing:.1,fontFamily:"inherit"}}>+ Add Batch</button>
            </div>
          </div>

          {/* Add/Edit batch form */}
          {showFeederForm&&(
            <div onClick={closeFeederForm} style={{position:"fixed",top:0,left:0,right:0,bottom:0,background:"rgba(0,0,0,.45)",zIndex:500,display:"flex",alignItems:"center",justifyContent:"center",padding:"1rem",overflowY:"auto"}}>
            <div onClick={e=>e.stopPropagation()} style={{background:"white",borderRadius:12,width:"100%",maxWidth:580,boxShadow:"0 8px 32px rgba(0,0,0,.2)",maxHeight:"90vh",overflowY:"auto"}}>
              <div style={{padding:"14px 20px",borderBottom:"1px solid #e5e7eb",display:"flex",justifyContent:"space-between",alignItems:"center",position:"sticky",top:0,background:"white",zIndex:1}}>
                <div style={{display:"flex",alignItems:"center",gap:10}}>
                  <div style={{fontSize:15,fontWeight:600,color:"#085041"}}>{editFeederId?"Edit Pig Batch":"Add Pig Batch"}</div>
                  {editFeederId&&<div style={{marginLeft:8,fontSize:11,color:"#9ca3af"}}>Auto-saves as you type</div>}
                  {editFeederId&&(()=>{
                    const sorted=[...feederGroups].sort((a,b)=>(a.batchName||'').localeCompare(b.batchName||'',undefined,{numeric:true}));
                    const idx=sorted.findIndex(g=>g.id===editFeederId);
                    const prev=idx>0?sorted[idx-1]:null;
                    const next=idx<sorted.length-1?sorted[idx+1]:null;
                    const ns=(on)=>({padding:"3px 10px",borderRadius:6,border:"1px solid #d1d5db",background:on?"white":"#f9fafb",color:on?"#374151":"#d1d5db",cursor:on?"pointer":"default",fontSize:11,fontWeight:600,fontFamily:"inherit"});
                    return (
                      <div style={{display:"flex",gap:4,alignItems:"center"}}>
                        <button disabled={!prev} style={ns(!!prev)} onClick={()=>{if(prev){closeFeederForm();setTimeout(()=>{const f={batchName:prev.batchName||"",cycleId:prev.cycleId||"",giltCount:prev.giltCount||0,boarCount:prev.boarCount||0,startDate:prev.startDate||"",originalPigCount:prev.originalPigCount||0,perLbFeedCost:prev.perLbFeedCost||0,legacyFeedLbs:prev.legacyFeedLbs||0,notes:prev.notes||"",status:prev.status||"active"};setFeederForm(f);setOriginalFeederForm(f);setEditFeederId(prev.id);setShowFeederForm(true);},50);}}}>{'\u2039 '+( prev?prev.batchName:'\u2014')}</button>
                        <span style={{fontSize:10,color:"#9ca3af"}}>{idx+1}/{sorted.length}</span>
                        <button disabled={!next} style={ns(!!next)} onClick={()=>{if(next){closeFeederForm();setTimeout(()=>{const f={batchName:next.batchName||"",cycleId:next.cycleId||"",giltCount:next.giltCount||0,boarCount:next.boarCount||0,startDate:next.startDate||"",originalPigCount:next.originalPigCount||0,perLbFeedCost:next.perLbFeedCost||0,legacyFeedLbs:next.legacyFeedLbs||0,notes:next.notes||"",status:next.status||"active"};setFeederForm(f);setOriginalFeederForm(f);setEditFeederId(next.id);setShowFeederForm(true);},50);}}}>{(next?next.batchName:'\u2014')+' \u203a'}</button>
                      </div>
                    );
                  })()}
                </div>
                <button onClick={closeFeederForm} style={{background:"none",border:"none",fontSize:22,cursor:"pointer",color:"#9ca3af",lineHeight:1,padding:"0 4px"}}>×</button>
              </div>
              <div style={{padding:"16px 20px"}}>
              <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10}}>
                <div style={{gridColumn:"1/-1"}}>
                  <label style={S.label}>Batch name <span style={{color:'#dc2626'}}>*</span></label>
                  <input value={feederForm.batchName} onChange={e=>updFeeder('batchName',e.target.value)} placeholder="e.g. Group 2 Fall 2025"/>
                </div>
                <div>
                  <label style={S.label}>Linked breeding cycle <span style={{color:'#dc2626'}}>*</span></label>
                  <select value={feederForm.cycleId} onChange={e=>updFeeder('cycleId',e.target.value)}>
                    <option value="">{'\u2014 Select \u2014'}</option>
                    {breedingCycles.map(c=>{
                      const tl=calcBreedingTimeline(c.exposureStart);
                      return <option key={c.id} value={c.id}>{cycleLabel(c, cycleSeqMap)} — {tl?fmtS(tl.farrowingStart)+" to "+fmtS(tl.farrowingEnd):fmtS(c.exposureStart)}</option>;
                    })}
                  </select>
                </div>
                <div>
                  <label style={S.label}>Status <span style={{color:'#dc2626'}}>*</span></label>
                  <select value={feederForm.status} onChange={e=>updFeeder('status',e.target.value)}>
                    {["active","processed"].map(s=><option key={s} value={s}>{s==="processed"?"Processed":"Active"}</option>)}
                  </select>
                </div>
                <div>
                  <label style={S.label}>Start date <span style={{color:'#dc2626'}}>*</span></label>
                  <input type="date" value={feederForm.startDate||""} onChange={e=>updFeeder('startDate',e.target.value)}/>
                </div>
                <div>
                  <label style={S.label}>Gilts count <span style={{color:'#dc2626'}}>*</span></label>
                  <input type="number" min="0" value={feederForm.giltCount||''} onChange={e=>updFeeder('giltCount',e.target.value)}/>
                </div>
                <div>
                  <label style={S.label}>Boars count (intact males) <span style={{color:'#dc2626'}}>*</span></label>
                  <input type="number" min="0" value={feederForm.boarCount||''} onChange={e=>updFeeder('boarCount',e.target.value)}/>
                </div>
                <div style={{gridColumn:"1/-1"}}>
                  <label style={S.label}>Original pig count</label>
                  <div style={{padding:'8px 11px',background:'#f9fafb',border:'1px solid #e5e7eb',borderRadius:6,fontSize:13,fontWeight:600,color:'#374151'}}>{(parseInt(feederForm.giltCount)||0)+(parseInt(feederForm.boarCount)||0)}</div>
                  <div style={{fontSize:11,color:"#9ca3af",marginTop:2}}>Auto-calculated: gilts + boars</div>
                </div>
                <div style={{gridColumn:"1/-1"}}>
                  <div style={{fontSize:11,fontWeight:700,color:'#4b5563',letterSpacing:.5,marginBottom:6}}>{'\ud83d\udcb0 FEED COST RATE'} <span style={{fontWeight:400,color:'#9ca3af'}}>{'(locked \u2014 set in Admin \u203a Feed Costs)'}</span></div>
                  <div style={{fontSize:12,color:'#374151',padding:'8px 12px',background:'#f9fafb',borderRadius:8,border:'1px solid #e5e7eb'}}>
                    Pig feed: <strong>{feederForm.perLbFeedCost!==''&&feederForm.perLbFeedCost!=null?'$'+parseFloat(feederForm.perLbFeedCost).toFixed(3)+'/lb':'\u2014'}</strong>
                  </div>
                </div>

                {feederForm.cycleId&&(
                  <div style={{gridColumn:"1/-1",background:"#ecfdf5",border:"1px solid #a7f3d0",borderRadius:8,padding:"8px 12px",fontSize:12,color:"#085041"}}>
                    <strong>Age range today:</strong> {calcAgeRange(feederForm.cycleId).text}
                  </div>
                )}
                <div style={{gridColumn:"1/-1"}}>
                  <label style={S.label}>Notes</label>
                  <input value={feederForm.notes} onChange={e=>updFeeder('notes',e.target.value)} placeholder="Any notes about this batch..."/>
                </div>
              </div>
              <div style={{display:"flex",gap:8,marginTop:12}}>
                {!editFeederId && (
                  <button onClick={()=>{
                    if(!feederForm.batchName){ alert("Please enter a batch name."); return; }
                    const grp={id:String(Date.now()), processingTrips:[], subBatches:[], ...feederForm};
                    const nb=[...feederGroups,grp];
                    persistFeeders(nb); setShowFeederForm(false); setEditFeederId(null); setOriginalFeederForm(null);
                  }} style={{...S.btnPrimary,width:"auto",padding:"8px 20px"}}>Add batch</button>
                )}
                {editFeederId&&<button onClick={()=>{confirmDelete("Delete this batch? This cannot be undone.",()=>{clearTimeout(pigAutoSaveTimer.current);const nb=feederGroups.filter(g=>g.id!==editFeederId);setFeederGroups(nb);persistFeeders(nb);setShowFeederForm(false);setEditFeederId(null);setOriginalFeederForm(null);});}} style={S.btnDanger}>Delete</button>}
              </div>
              </div>
            </div>
            </div>
          )}

          {feederGroups.filter(g=>g.status!=="processed").length===0&&!showFeederForm&&(
            <div style={{textAlign:"center",padding:"3rem",color:"#9ca3af",fontSize:13}}>No pig batches yet — click "+ Add Batch" to get started</div>
          )}

          {feederGroups.filter(g=>showArchBatches||g.status!=="processed").map(g=>{
            const cycle = breedingCycles.find(c=>c.id===g.cycleId);
            const tl = cycle ? calcBreedingTimeline(cycle.exposureStart) : null;
            const ageRange = calcAgeRange(g.cycleId);
            const sc = statusColors[g.status]||statusColors.active;
            const C = cycle ? PIG_GROUP_COLORS[cycle.group] : null;
            const trips = g.processingTrips||[];
            const totalLive = trips.reduce((s,t)=>s+tripTotalLive(t),0);
            const totalHang = trips.reduce((s,t)=>s+(parseFloat(t.hangingWeight)||0),0);
            const overallYield = totalLive>0&&totalHang>0 ? Math.round((totalHang/totalLive)*1000)/10 : null;
            // Sub-batches
            const subBatches = g.subBatches||[];
            const hasSubBatches = subBatches.length>0;

            // Feed matching by label (case-insensitive) for parent batch
            const batchDailys = hasSubBatches ? [] : dailysForName(g.batchName);
            const dailyFeedTotal = batchDailys.reduce((s,d)=>s+(parseFloat(d.feed_lbs)||0),0);
            const legacyFeed = parseFloat(g.legacyFeedLbs)||parseFloat(g.totalFeedLbs)||0;

            // Sub-batch feed totals
            const subFeedTotals = subBatches.map(sb=>{
              const sd = dailysForName(sb.name);
              const feed = sd.reduce((s,d)=>s+(parseFloat(d.feed_lbs)||0),0) + (parseFloat(sb.legacyFeedLbs)||0);
              const latest = [...sd].sort((a,b)=>b.date.localeCompare(a.date)||b.submitted_at?.localeCompare(a.submitted_at||'')||0)[0]||null;
              return {sb, dailys:sd, feedTotal:feed, latestDaily:latest, currentCount:latest?.pig_count??null};
            });
            const subFeedGrandTotal = subFeedTotals.reduce((s,sf)=>s+sf.feedTotal,0);
            const totalFeed = hasSubBatches ? subFeedGrandTotal + legacyFeed : dailyFeedTotal + legacyFeed;

            // Current pig count — from most recent daily across all sub-batches or parent
            const sortedDailys = hasSubBatches
              ? subFeedTotals.flatMap(sf=>sf.dailys).sort((a,b)=>b.date.localeCompare(a.date)||b.submitted_at?.localeCompare(a.submitted_at||'')||0)
              : [...batchDailys].sort((a,b)=>b.date.localeCompare(a.date)||b.submitted_at?.localeCompare(a.submitted_at||'')||0);
            const latestDaily = sortedDailys[0]||null;
            const currentPigCount = hasSubBatches
              ? subFeedTotals.reduce((s,sf)=>s+(sf.currentCount||0),0)||null
              : latestDaily?.pig_count??null;
            const originalPigCount = hasSubBatches
              ? subBatches.reduce((s,sb)=>s+(parseInt(sb.originalPigCount)||0),0)||parseInt(g.originalPigCount)||0
              : parseInt(g.originalPigCount)||0;
            // Feed cost
            const perLbCost = parseFloat(g.perLbFeedCost)||0;
            const totalFeedCost = totalFeed>0&&perLbCost>0 ? totalFeed*perLbCost : null;
            // Feed conversion: (total feed / original pig count) / (total live wt / pigs processed)
            // = avg feed per pig / avg live weight per pig
            const pigsProcessed = trips.reduce((s,t)=>s+(parseInt(t.pigCount)||0),0);
            const avgFeedPerPig = originalPigCount>0&&totalFeed>0 ? totalFeed/originalPigCount : null;
            const avgLiveWeight = pigsProcessed>0&&totalLive>0 ? totalLive/pigsProcessed : null;
            const feedConversion = avgFeedPerPig&&avgLiveWeight ? Math.round((avgFeedPerPig/avgLiveWeight)*100)/100 : null;
            const showTripForm = activeTripBatchId===g.id;
            const farrowPct = ageRange.total>0 ? Math.round((ageRange.count/ageRange.total)*100) : 0;

            return (
              <div key={g.id} style={{background:"white",border:`1px solid ${C?C.farrowing:"#e0e0e0"}`,borderRadius:10,marginBottom:14,overflow:"hidden",fontSize:12}}>

                {/* Batch header */}
                <div style={{padding:"12px 16px",background:C?C.boar:"#f9f9f9",display:"flex",flexWrap:"wrap",gap:"6px 16px",alignItems:"center"}}>
                  <strong style={{fontSize:14}}>{g.batchName}</strong>
                  <span style={S.badge("#065f46","white")}>Gilts: {g.giltCount}</span>
                  <span style={S.badge("#1e40af","white")}>Boars: {g.boarCount}</span>
                  {currentPigCount!==null
                    ? <span style={{color:"#111827",fontWeight:500}}>Current: <strong>{currentPigCount}</strong></span>
                    : originalPigCount>0&&<span style={{color:"#6b7280"}}>Started: {originalPigCount}</span>
                  }
                  <span style={{color:"#085041",fontWeight:600}}>
                    Age: {ageRange.text}
                    {!ageRange.hasActual&&ageRange.text!=="—"&&<span style={{fontSize:10,color:"#92400e",marginLeft:4}}>(estimated)</span>}
                  </span>
                  {g.startDate&&<span style={{color:"#6b7280",fontSize:11}}>Started {fmt(g.startDate)}</span>}
                  <span style={S.badge(sc.bg,sc.tx)}>{g.status}</span>
                  <div style={{marginLeft:"auto",display:"flex",gap:6,alignItems:"center",flexWrap:"wrap"}}>

                    {g.status==="active"
                      ? <button onClick={()=>archiveBatch(g.id)} style={{fontSize:11,padding:"3px 10px",borderRadius:5,border:"1px solid #d1d5db",color:"#6b7280",background:"white",cursor:"pointer",fontFamily:"inherit"}}>Mark Processed</button>
                      : <button onClick={()=>unarchiveBatch(g.id)} style={{fontSize:11,padding:"3px 10px",borderRadius:5,border:"1px solid #085041",color:"#085041",background:"white",cursor:"pointer",fontFamily:"inherit"}}>Reactivate</button>
                    }
                    <button onClick={()=>{const f={batchName:g.batchName,cycleId:g.cycleId||"",giltCount:g.giltCount,boarCount:g.boarCount,startDate:g.startDate||"",originalPigCount:g.originalPigCount||0,perLbFeedCost:g.perLbFeedCost||0,legacyFeedLbs:g.legacyFeedLbs||0,notes:g.notes||"",status:g.status};setFeederForm(f);setOriginalFeederForm(f);setEditFeederId(g.id);setShowFeederForm(true);setShowSubForm(null);}} style={{fontSize:11,color:"#1d4ed8",background:"none",border:"none",cursor:"pointer"}}>Edit</button>
                  </div>
                </div>

                {/* Summary stats */}
                {(()=>{const anyDailys=hasSubBatches?subFeedTotals.some(sf=>sf.dailys.length>0):batchDailys.length>0; return (trips.length>0||totalFeed>0||anyDailys)})()&&(
                  <div style={{padding:"10px 16px",background:"#f9fafb",borderBottom:"1px solid #e5e7eb"}}>
                    <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(130px,1fr))",gap:8}}>
                    {[
                      {label:"Total feed",val:totalFeed>0?`${Math.round(totalFeed).toLocaleString()} lbs`:"—",color:"#92400e",hint:dailyFeedTotal>0&&legacyFeed>0?`${Math.round(dailyFeedTotal).toLocaleString()} from dailys + ${Math.round(legacyFeed).toLocaleString()} legacy`:dailyFeedTotal>0?`from ${batchDailys.length} daily reports`:null},
                      {label:"Lbs per pig",val:(()=>{const op=hasSubBatches?subFeedTotals.reduce((s,sf)=>s+(parseInt(sf.sb.originalPigCount)||0),0):parseInt(g.originalPigCount)||0;return totalFeed>0&&op>0?`${Math.round(totalFeed/op)} lbs/pig`:"—";})(),color:"#78350f",hint:null},
                      {label:"Feed cost",val:totalFeedCost?`$${totalFeedCost.toLocaleString(undefined,{minimumFractionDigits:2,maximumFractionDigits:2})}`:"—",color:"#92400e",hint:perLbCost>0?`$${perLbCost}/lb`:null},
                      {label:"Feed conversion",val:feedConversion?`${feedConversion} lbs/lb`:"—",color:"#78350f"},
                      {label:"Pigs processed",val:trips.reduce((s,t)=>s+(parseInt(t.pigCount)||0),0),color:"#111827"},
                      {label:"Total live wt",val:totalLive>0?`${Math.round(totalLive)} lbs`:"—",color:"#1d4ed8"},
                      {label:"Avg carcass yield",val:overallYield?`${overallYield}%`:"—",color:"#16a34a"},
                    ].map(s=>(
                      <div key={s.label} style={{textAlign:"center",background:"white",border:"1px solid #e5e7eb",borderRadius:8,padding:"6px 10px"}}>
                        <div style={{fontSize:10,color:"#9ca3af",textTransform:"uppercase",letterSpacing:.4,marginBottom:2}}>{s.label}</div>
                        <div style={{fontSize:15,fontWeight:700,color:s.color}}>{s.val===0?"—":s.val}</div>
                        {s.hint&&<div style={{fontSize:10,color:"#9ca3af",marginTop:1}}>{s.hint}</div>}
                      </div>
                    ))}
                    </div>
                    {(()=>{
                      const allDailysCount = hasSubBatches ? subFeedTotals.reduce((s,sf)=>s+sf.dailys.length,0) : batchDailys.length;
                      return allDailysCount>0?(
                        <div style={{marginTop:8,fontSize:11,color:"#6b7280"}}>
                          <span>📋 {allDailysCount} daily report{allDailysCount!==1?"s":""}</span>
                        </div>
                      ):null;
                    })()}
                  </div>
                )}

                {/* Sub-batches panel */}
                <div style={{padding:"10px 16px",borderBottom:"1px solid #e5e7eb"}}>
                  <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:8}}>
                    <div style={{fontSize:12,fontWeight:600,color:"#4b5563"}}>
                      Sub-batches {subBatches.length>0?`(${subBatches.length})`:""}
                    </div>
                    <div style={{display:"flex",gap:6}}>
                      {showSubForm===g.id&&!editSubId
                        ? <button onClick={()=>closeSubForm(g.id)} style={{fontSize:11,color:"#6b7280",background:"none",border:"none",cursor:"pointer"}}>Close</button>
                        : <button onClick={()=>{setShowSubForm(g.id);setEditSubId(null);setSubForm({name:"",giltCount:0,boarCount:0,originalPigCount:0,notes:""}); }} style={{padding:"3px 10px",borderRadius:5,border:"none",background:"#ecfdf5",color:"#083d30",cursor:"pointer",fontSize:11,fontWeight:600,fontFamily:"inherit"}}>+ Add sub-batch</button>
                      }
                    </div>
                  </div>

                  {/* Sub-batch form (modal) */}
                  {(showSubForm===g.id)&&(
                    <div onClick={()=>closeSubForm(g.id)} style={{position:"fixed",top:0,left:0,right:0,bottom:0,background:"rgba(0,0,0,.45)",zIndex:500,display:"flex",alignItems:"center",justifyContent:"center",padding:"1rem"}}>
                      <div onClick={e=>e.stopPropagation()} style={{background:"white",borderRadius:12,width:"100%",maxWidth:480,boxShadow:"0 8px 32px rgba(0,0,0,.2)"}}>
                        <div style={{padding:"14px 20px",borderBottom:"1px solid #e5e7eb",display:"flex",alignItems:"center",justifyContent:"space-between"}}>
                          <div style={{fontSize:15,fontWeight:600,color:"#085041"}}>{editSubId?"Edit Sub-batch":"New Sub-batch"} <span style={{fontWeight:400,color:"#9ca3af",fontSize:11,marginLeft:6}}>Auto-saves as you type</span></div>
                          <button onClick={()=>closeSubForm(g.id)} style={{background:"none",border:"none",fontSize:22,cursor:"pointer",color:"#9ca3af",lineHeight:1}}>×</button>
                        </div>
                        <div style={{padding:"16px 20px",display:"grid",gridTemplateColumns:"1fr 1fr",gap:10}}>
                          <div style={{gridColumn:"1/-1"}}>
                            <label style={S.label}>Sub-batch name *</label>
                            <input value={subForm.name} onChange={e=>updSub(g.id,'name',e.target.value)} placeholder="e.g. P-26-01 A (GILTS)"/>
                            <div style={{fontSize:10,color:"#9ca3af",marginTop:2}}>Must match the label used on daily reports</div>
                          </div>
                          <div>
                            <label style={S.label}>Gilts count</label>
                            <input type="number" min="0" value={subForm.giltCount||''} onChange={e=>updSub(g.id,'giltCount',e.target.value)}/>
                          </div>
                          <div>
                            <label style={S.label}>Boars count</label>
                            <input type="number" min="0" value={subForm.boarCount||''} onChange={e=>updSub(g.id,'boarCount',e.target.value)}/>
                          </div>
                          <div>
                            <label style={S.label}>Original count</label>
                            <input type="number" min="0" value={subForm.originalPigCount||''} onChange={e=>updSub(g.id,'originalPigCount',e.target.value)}/>
                          </div>
                          <div>
                            <label style={S.label}>Notes</label>
                            <input value={subForm.notes} onChange={e=>updSub(g.id,'notes',e.target.value)} placeholder="Optional"/>
                          </div>
                        </div>
                        {editSubId&&<div style={{padding:"12px 20px",borderTop:"1px solid #e5e7eb",display:"flex",gap:8}}>
                          <button onClick={()=>deleteSubBatch(g.id,editSubId)} style={S.btnDanger}>Delete</button>
                        </div>}
                      </div>
                    </div>
                  )}

                  {subBatches.length===0&&showSubForm!==g.id&&(
                    <div style={{fontSize:11,color:"#9ca3af",padding:"2px 0 6px"}}>No sub-batches — daily reports go directly to this batch. Add sub-batches to split A/B groups.</div>
                  )}

                  {subBatches.map(sb=>{
                    const sft = subFeedTotals.find(x=>x.sb.id===sb.id)||{feedTotal:0,dailys:[],latestDaily:null,currentCount:null};
                    const sbSc = statusColors[sb.status]||statusColors.active;
                    return (
                      <div key={sb.id} style={{display:"flex",flexWrap:"wrap",alignItems:"center",gap:"6px 12px",padding:"8px 10px",borderRadius:7,border:"1px solid #e5e7eb",marginBottom:6,background:sb.status==="processed"?"#f9fafb":"white",opacity:sb.status==="processed"?.7:1}}>
                        <strong style={{fontSize:12,color:"#111827"}}>{sb.name}</strong>
                        <span style={S.badge(sbSc.bg,sbSc.tx)}>{sb.status}</span>
                        {sb.giltCount>0&&<span style={{fontSize:11,color:"#065f46"}}>Gilts: {sb.giltCount}</span>}
                        {sb.boarCount>0&&<span style={{fontSize:11,color:"#1e40af"}}>Boars: {sb.boarCount}</span>}
                        {sft.feedTotal>0&&<span style={{fontSize:11,color:"#92400e",fontWeight:600}}>🌾 {Math.round(sft.feedTotal).toLocaleString()} lbs feed</span>}
                        {sft.feedTotal>0&&(parseInt(sb.originalPigCount)||0)>0&&<span style={{fontSize:11,color:"#78350f"}}>({Math.round(sft.feedTotal/(parseInt(sb.originalPigCount)||1))} lbs/pig)</span>}
                        {sft.currentCount!=null&&<span style={{fontSize:11,color:"#111827"}}>🐷 {sft.currentCount} current</span>}
                        {sft.dailys.length>0&&<span style={{fontSize:11,color:"#6b7280"}}>📋 {sft.dailys.length} reports</span>}

                        <div style={{marginLeft:"auto",display:"flex",gap:8}}>

                          <button onClick={()=>{clearTimeout(subAutoSaveTimer.current);setShowSubForm(g.id);setEditSubId(sb.id);setSubForm({name:sb.name,giltCount:sb.giltCount||0,boarCount:sb.boarCount||0,originalPigCount:sb.originalPigCount||0,notes:sb.notes||""});}} style={{fontSize:11,color:"#1d4ed8",background:"none",border:"none",cursor:"pointer"}}>Edit</button>
                        </div>

                      </div>
                    );
                  })}
                </div>

                {/* Processing trips */}
                <div style={{padding:"10px 16px"}}>
                  <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:8}}>
                    <div style={{fontSize:12,fontWeight:600,color:"#4b5563"}}>Processing trips {trips.length>0?`(${trips.length})`:""}</div>
                    <button onClick={()=>{setActiveTripBatchId(showTripForm?null:g.id);setTripForm({date:toISO(new Date()),pigCount:0,liveWeights:"",hangingWeight:0,notes:""});setEditTripId(null);}}
                      style={{padding:"4px 12px",borderRadius:5,border:"none",background:"#ecfdf5",color:"#083d30",cursor:"pointer",fontSize:11,fontWeight:600}}>
                      {showTripForm?"Cancel":"+ Add Trip"}
                    </button>
                  </div>

                  {/* Trip form (modal) */}
                  {showTripForm&&(
                    <div onClick={closeTripForm} style={{position:"fixed",top:0,left:0,right:0,bottom:0,background:"rgba(0,0,0,.45)",zIndex:500,display:"flex",alignItems:"center",justifyContent:"center",padding:"1rem"}}>
                      <div onClick={e=>e.stopPropagation()} style={{background:"white",borderRadius:12,width:"100%",maxWidth:520,boxShadow:"0 8px 32px rgba(0,0,0,.2)"}}>
                        <div style={{padding:"14px 20px",borderBottom:"1px solid #e5e7eb",display:"flex",alignItems:"center",justifyContent:"space-between"}}>
                          <div style={{fontSize:15,fontWeight:600,color:"#085041"}}>{editTripId?"Edit Processing Trip":"New Processing Trip"} <span style={{fontWeight:400,color:"#9ca3af",fontSize:11,marginLeft:6}}>Auto-saves as you type</span></div>
                          <button onClick={closeTripForm} style={{background:"none",border:"none",fontSize:22,cursor:"pointer",color:"#9ca3af",lineHeight:1}}>×</button>
                        </div>
                        <div style={{padding:"16px 20px",display:"grid",gridTemplateColumns:"1fr 1fr",gap:10}}>
                          <div>
                            <label style={S.label}>Processing date</label>
                            <input type="date" value={tripForm.date} onChange={e=>updTrip('date',e.target.value)}/>
                          </div>
                          <div>
                            <label style={S.label}>Number of pigs</label>
                            <input type="number" min="0" value={tripForm.pigCount||''} onChange={e=>updTrip('pigCount',e.target.value)}/>
                          </div>
                          <div style={{gridColumn:"1/-1"}}>
                            <label style={S.label}>Live weights — enter each pig's weight separated by commas or spaces</label>
                            <input value={tripForm.liveWeights} onChange={e=>updTrip('liveWeights',e.target.value)} placeholder="e.g. 245, 268, 231, 255, 240"/>
                            {tripForm.liveWeights&&(()=>{
                              const wts = parseLiveWeights(tripForm.liveWeights);
                              const total = wts.reduce((a,b)=>a+b,0);
                              const avg = wts.length>0?Math.round(total/wts.length):0;
                              return wts.length>0?(
                                <div style={{fontSize:11,color:"#085041",marginTop:3}}>{wts.length} pigs {'\u00b7'} Total: {Math.round(total)} lbs{'\u00b7'} Avg: {avg} lbs/pig</div>
                              ):null;
                            })()}
                            {editTripId && (() => {
                              const counts = tripSourceCounts(editTripId);
                              const keys = Object.keys(counts);
                              if(keys.length === 0) return null;
                              return (
                                <div style={{fontSize:11,color:"#065f46",marginTop:6,padding:"5px 9px",background:"#ecfdf5",border:"1px solid #a7f3d0",borderRadius:5}}>
                                  <strong>Sources:</strong> {keys.map(k => k + " (" + counts[k] + ")").join(", ")}
                                </div>
                              );
                            })()}
                          </div>
                          <div>
                            <label style={S.label}>Hanging weight (lbs) — total for this trip</label>
                            <input type="number" min="0" step="0.1" value={tripForm.hangingWeight||''} onChange={e=>updTrip('hangingWeight',e.target.value)}/>
                            {tripForm.hangingWeight>0&&tripTotalLive(tripForm)>0&&(
                              <div style={{fontSize:11,color:"#16a34a",marginTop:3}}>Carcass yield: {tripYield(tripForm)}%</div>
                            )}
                          </div>
                          <div>
                            <label style={S.label}>Notes</label>
                            <input value={tripForm.notes} onChange={e=>updTrip('notes',e.target.value)} placeholder="Any notes for this trip..."/>
                          </div>
                        </div>
                        {editTripId&&<div style={{padding:"12px 20px",borderTop:"1px solid #e5e7eb",display:"flex",gap:8}}>
                          <button onClick={()=>{deleteTrip(g.id,editTripId);setActiveTripBatchId(null);setEditTripId(null);}} style={S.btnDanger}>Delete</button>
                        </div>}
                      </div>
                    </div>
                  )}

                  {/* Trip list */}
                  {trips.length===0&&!showTripForm&&<div style={{color:"#9ca3af",fontSize:11,padding:"4px 0 8px"}}>No processing trips yet — click "+ Add Trip" to record a sub-batch sent to processor</div>}
                  {trips.map((t,ti)=>{
                    const live = tripTotalLive(t);
                    const yld  = tripYield(t);
                    const wts  = parseLiveWeights(t.liveWeights);
                    const avg  = wts.length>0 ? Math.round(live/wts.length) : 0;
                    return (
                      <div key={t.id} style={{borderTop:"1px solid #e5e7eb",padding:"8px 0",display:"flex",flexWrap:"wrap",gap:"4px 14px",alignItems:"flex-start"}}>
                        <div style={{fontWeight:600,minWidth:90,color:"#111827"}}>{fmt(t.date)}</div>
                        <span>{parseInt(t.pigCount)||0} pigs</span>
                        {live>0&&<span style={{color:"#1d4ed8"}}>Live: {Math.round(live)} lbs{avg>0?` (avg ${avg} lbs)`:""}</span>}
                        {parseFloat(t.hangingWeight)>0&&<span style={{color:"#085041"}}>Hang: {parseFloat(t.hangingWeight)} lbs</span>}
                        {yld!==null&&<span style={{color:"#16a34a",fontWeight:600}}>Yield: {yld}%</span>}
                        {t.notes&&<span style={{color:"#9ca3af",fontStyle:"italic"}}>{t.notes}</span>}
                        <div style={{marginLeft:"auto",display:"flex",gap:8}}>
                          <button onClick={()=>{setTripForm({date:t.date,pigCount:t.pigCount,liveWeights:t.liveWeights,hangingWeight:t.hangingWeight,notes:t.notes||""});setEditTripId(t.id);setActiveTripBatchId(g.id);}} style={{fontSize:11,color:"#1d4ed8",background:"none",border:"none",cursor:"pointer"}}>Edit</button>
                          <button onClick={()=>deleteTrip(g.id,t.id)} style={{fontSize:11,color:"#b91c1c",background:"none",border:"none",cursor:"pointer"}}>Delete</button>
                        </div>
                        {wts.length>0&&<div style={{width:"100%",fontSize:10,color:"#9ca3af",marginTop:1}}>Weights: {t.liveWeights}</div>}
                        {(() => {
                          const counts = tripSourceCounts(t.id);
                          const keys = Object.keys(counts);
                          if(keys.length === 0) return null;
                          return (<div style={{width:"100%",fontSize:11,color:"#065f46",marginTop:2}}><strong>From:</strong> {keys.map(k => k + " (" + counts[k] + ")").join(", ")}</div>);
                        })()}
                      </div>
                    );
                  })}
                </div>

                {/* Cycle info footer */}
                {tl&&(
                  <div style={{padding:"6px 16px",background:"#ecfdf5",borderTop:"1px solid #e5e7eb",fontSize:11,color:"#9ca3af"}}>
                    {cycleLabel(cycle, cycleSeqMap)} · Farrowing: {fmtS(tl.farrowingStart)} → {fmtS(tl.farrowingEnd)} · {boarNames.boar1}: {cycle.boar1Tags||"—"} · {boarNames.boar2}: {cycle.boar2Tags||"—"}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    );
}
