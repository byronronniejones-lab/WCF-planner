// ============================================================================
// src/pig/BreedingView.jsx  —  Phase 2 Round 6
// ----------------------------------------------------------------------------
// Breeding Gantt view for pig cycles. Form state + the cycle array come
// from usePig(); the persist helper + auto-save ref still live in App and
// come in as props (persistBreeding, breedAutoSaveTimer).
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
  PIG_GROUPS,
  PIG_GROUP_COLORS,
  PIG_GROUP_TEXT,
} from '../lib/pig.js';
import UsersModal from '../auth/UsersModal.jsx';
import { useAuth } from '../contexts/AuthContext.jsx';
import { useBatches } from '../contexts/BatchesContext.jsx';
import { usePig } from '../contexts/PigContext.jsx';
import { useUI } from '../contexts/UIContext.jsx';

export default function BreedingView({ Header, loadUsers, persistBreeding, breedAutoSaveTimer, confirmDelete }) {
  const { authState, showUsers, setShowUsers, allUsers, setAllUsers } = useAuth();
  const { tooltip, setTooltip } = useBatches();
  const {
    breedingCycles, setBreedingCycles,
    boarNames,
    breedTlStart, setBreedTlStart,
    breedForm, setBreedForm,
    showBreedForm, setShowBreedForm,
    editBreedId, setEditBreedId,
    breeders,
  } = usePig();
  const { setView } = useUI();
    const BREED_WEEKS = 104;
    const btlS = new Date(breedTlStart+"T12:00:00");
    const btlE = addDays(btlS, BREED_WEEKS*7);
    const bTotalDays = BREED_WEEKS*7;
    function bpct(iso){ return ((new Date(iso+"T12:00:00")-btlS)/86400000/bTotalDays)*100; }
    const bWkHdrs = Array.from({length:BREED_WEEKS},(_,i)=>addDays(btlS,i*7));
    const cycleSeqMap = buildCycleSeqMap(breedingCycles);

    const EMPTY_BREED = {group:"1",customSuffix:"",boar1Tags:"",boar2Tags:"",exposureStart:"",notes:"",boar1Name:boarNames.boar1,boar2Name:boarNames.boar2};

    function persistBreedCycle(formSnapshot, cycleId){
      if(!formSnapshot.exposureStart) return;
      const tl = calcBreedingTimeline(formSnapshot.exposureStart);
      const parseTags = function(str){return str.split('\n').map(function(t){return t.trim();}).filter(Boolean);};
      const t1 = parseTags(formSnapshot.boar1Tags);
      const t2 = parseTags(formSnapshot.boar2Tags);
      const id = cycleId||String(Date.now());
      const cycle = {id:id,
        ...formSnapshot,
        sowCount: t1.length + t2.length,
        boar1Count: t1.length,
        boar2Count: t2.length,
        ...tl,
        boar1Name:formSnapshot.boar1Name||boarNames.boar1, boar2Name:formSnapshot.boar2Name||boarNames.boar2};
      const nb = cycleId
        ? breedingCycles.map(function(c){return c.id===cycleId?cycle:c;})
        : [...breedingCycles, cycle];
      nb.sort(function(a,b){return a.exposureStart.localeCompare(b.exposureStart);});
      setBreedingCycles(nb); persistBreeding(nb);
      if(!editBreedId) setEditBreedId(id);
    }
    function updBreed(k, v){
      var next = {...breedForm, [k]: v};
      setBreedForm(next);
      if(!next.exposureStart) return;
      clearTimeout(breedAutoSaveTimer.current);
      breedAutoSaveTimer.current = setTimeout(function(){
        persistBreedCycle(next, editBreedId);
      }, 1500);
    }
    function closeBreedForm(){
      clearTimeout(breedAutoSaveTimer.current);
      if(breedForm.exposureStart){
        persistBreedCycle(breedForm, editBreedId);
      }
      setShowBreedForm(false); setEditBreedId(null);
    }

    // Phase row definitions per group
    const phaseRows = PIG_GROUPS.flatMap(g=>[
      {group:g, phase:"boar",     label:`G${g} — Sows in with Boars`,      startKey:"boarStart",     endKey:"boarEnd"},
      {group:g, phase:"paddock",  label:`G${g} — Sows in Exposed Paddock`, startKey:"paddockStart",  endKey:"paddockEnd"},
      {group:g, phase:"farrowing",label:`G${g} — Farrowing`,               startKey:"farrowingStart",endKey:"farrowingEnd"},
      {group:g, phase:"weaning",  label:`G${g} — Weaning`,                 startKey:"weaningStart",  endKey:"weaningEnd"},
      {group:g, phase:"gilt",     label:`G${g} — Gilts Grow Out`,          startKey:"growStart",     endKey:"growEnd"},
      {group:g, phase:"boarGrow", label:`G${g} — Boars Grow Out`,          startKey:"growStart",     endKey:"growEnd"},
    ]);

    return (
      <div>
        <Header/>
        {showBreedForm&&(
          <div style={{background:"rgba(0,0,0,.45)",position:"fixed",top:0,left:0,right:0,bottom:0,zIndex:500,display:"flex",alignItems:"flex-start",justifyContent:"center",padding:"2rem 1rem",overflowY:"auto"}}>
            <div style={{background:"white",borderRadius:12,width:"100%",maxWidth:560,border:"1px solid #e5e7eb"}}>
              <div style={{padding:"14px 20px",borderBottom:"1px solid #e5e7eb",display:"flex",justifyContent:"space-between",alignItems:"center"}}>
                <div style={{fontSize:15,fontWeight:600}}>{editBreedId?"Edit Breeding Cycle":"Add Breeding Cycle"} <span style={{fontWeight:400,color:"#9ca3af",fontSize:11,marginLeft:6}}>Auto-saves as you type</span></div>
                <button onClick={closeBreedForm} style={{background:"none",border:"none",fontSize:22,cursor:"pointer",color:"#999"}}>×</button>
              </div>
              <div style={{padding:"16px 20px",display:"flex",flexDirection:"column",gap:10}}>

                {/* Boar names (per cycle) */}
                <div style={{background:"#f0f7ff",border:"1px solid #B5D4F4",borderRadius:10,padding:"10px 14px"}}>
                  <div style={{fontSize:12,fontWeight:600,color:"#1d4ed8",marginBottom:8}}>Boar names for this cycle</div>
                  <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10}}>
                    <div>
                      <label style={S.label}>Boar 1 name</label>
                      <input value={breedForm.boar1Name||''} onChange={e=>updBreed('boar1Name',e.target.value)}/>
                    </div>
                    <div>
                      <label style={S.label}>Boar 2 name</label>
                      <input value={breedForm.boar2Name||''} onChange={e=>updBreed('boar2Name',e.target.value)}/>
                    </div>
                  </div>
                </div>

                <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10}}>
                  <div>
                    <label style={S.label}>Sow group</label>
                    <select value={breedForm.group} onChange={e=>updBreed('group',e.target.value)}>
                      {PIG_GROUPS.map(g=><option key={g} value={g}>Group {g}</option>)}
                    </select>
                  </div>

                  <div>
                    <label style={S.label}>Cycle code <span style={{fontWeight:400,color:"#9ca3af",fontSize:11}}>(overrides the auto year-sequence, e.g. "26-01")</span></label>
                    <input type="text" value={breedForm.customSuffix||''} onChange={e=>updBreed('customSuffix',e.target.value)} placeholder="e.g. 26-01 or Spring Batch"/>
                  </div>

                  <div>
                    <label style={S.label}>First day exposure (start date)</label>
                    <input type="date" value={breedForm.exposureStart} onChange={e=>updBreed('exposureStart',e.target.value)}/>
                  </div>
                  <div>
                    <label style={S.label}>{breedForm.boar1Name||boarNames.boar1} sow tags <span style={{fontWeight:400,color:"#9ca3af"}}>(one per line — or select below)</span></label>
                    <textarea rows={5} value={breedForm.boar1Tags||""} onChange={e=>updBreed('boar1Tags',e.target.value)} placeholder="e.g. 5&#10;13&#10;19" style={{fontFamily:"monospace",fontSize:13}}/>
                    <div style={{marginTop:4}}>
                      <select onChange={e=>{if(!e.target.value)return;const cur=(breedForm.boar1Tags||'').split('\n').map(t=>t.trim()).filter(Boolean);if(!cur.includes(e.target.value)){updBreed('boar1Tags',[...cur,e.target.value].join('\n'));}e.target.value='';}} style={{fontSize:11}}>
                        <option value="">＋ Add sow from profiles...</option>
                        {breeders.filter(b=>!b.archived&&(b.sex==='Sow'||b.sex==='Gilt')).sort((a,b)=>(parseFloat(a.tag)||0)-(parseFloat(b.tag)||0)).map(b=>(
                          <option key={b.tag} value={b.tag}>#{b.tag} — {b.breed||'—'} (Group {b.group||'?'})</option>
                        ))}
                      </select>
                    </div>
                    <div style={{fontSize:11,color:"#065f46",marginTop:3}}>{(breedForm.boar1Tags||"").split("\n").map(t=>t.trim()).filter(Boolean).length} sows</div>
                  </div>
                  <div>
                    <label style={S.label}>{breedForm.boar2Name||boarNames.boar2} sow tags <span style={{fontWeight:400,color:"#9ca3af"}}>(one per line — or select below)</span></label>
                    <textarea rows={5} value={breedForm.boar2Tags||""} onChange={e=>updBreed('boar2Tags',e.target.value)} placeholder="e.g. 6&#10;17&#10;98" style={{fontFamily:"monospace",fontSize:13}}/>
                    <div style={{marginTop:4}}>
                      <select onChange={e=>{if(!e.target.value)return;const cur=(breedForm.boar2Tags||'').split('\n').map(t=>t.trim()).filter(Boolean);if(!cur.includes(e.target.value)){updBreed('boar2Tags',[...cur,e.target.value].join('\n'));}e.target.value='';}} style={{fontSize:11}}>
                        <option value="">＋ Add sow from profiles...</option>
                        {breeders.filter(b=>!b.archived&&(b.sex==='Sow'||b.sex==='Gilt')).sort((a,b)=>(parseFloat(a.tag)||0)-(parseFloat(b.tag)||0)).map(b=>(
                          <option key={b.tag} value={b.tag}>#{b.tag} — {b.breed||'—'} (Group {b.group||'?'})</option>
                        ))}
                      </select>
                    </div>
                    <div style={{fontSize:11,color:"#065f46",marginTop:3}}>{(breedForm.boar2Tags||"").split("\n").map(t=>t.trim()).filter(Boolean).length} sows</div>
                  </div>
                  <div style={{gridColumn:"1/-1",background:"#ecfdf5",border:"1px solid #a7f3d0",borderRadius:8,padding:"8px 12px",fontSize:12,color:"#065f46"}}>
                    <strong>Total sows in cycle: {(breedForm.boar1Tags||"").split("\n").map(t=>t.trim()).filter(Boolean).length + (breedForm.boar2Tags||"").split("\n").map(t=>t.trim()).filter(Boolean).length}</strong>
                    &nbsp;·&nbsp; {boarNames.boar1}: {(breedForm.boar1Tags||"").split("\n").map(t=>t.trim()).filter(Boolean).length}
                    &nbsp;·&nbsp; {boarNames.boar2}: {(breedForm.boar2Tags||"").split("\n").map(t=>t.trim()).filter(Boolean).length}
                  </div>
                </div>

                {/* Calculated timeline preview */}
                {breedForm.exposureStart&&(()=>{
                  const tl=calcBreedingTimeline(breedForm.exposureStart);
                  if(!tl) return null;
                  return (
                    <div style={{background:"#ecfdf5",border:"1px solid #a7f3d0",borderRadius:10,padding:"10px 14px",fontSize:12,color:"#085041"}}>
                      <div style={{fontWeight:600,marginBottom:6}}>Calculated timeline</div>
                      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:"3px 12px"}}>
                        <div>Sows in with Boars: <strong>{fmtS(tl.boarStart)} → {fmtS(tl.boarEnd)}</strong></div>
                        <div>Sows in Exposed Paddock: <strong>{fmtS(tl.paddockStart)} → {fmtS(tl.paddockEnd)}</strong></div>
                        <div>Farrowing window: <strong>{fmtS(tl.farrowingStart)} → {fmtS(tl.farrowingEnd)}</strong></div>
                        <div>Weaning: <strong>{fmtS(tl.weaningStart)} → {fmtS(tl.weaningEnd)}</strong></div>
                        <div>Grow-out ends: <strong>{fmtS(tl.growEnd)}</strong></div>
                      </div>
                    </div>
                  );
                })()}

                <div>
                  <label style={S.label}>Notes</label>
                  <textarea value={breedForm.notes} onChange={e=>updBreed('notes',e.target.value)} rows={2}/>
                </div>
              </div>
              {editBreedId&&<div style={{padding:"12px 20px",borderTop:"1px solid #e5e7eb",display:"flex",gap:8}}>
                <button onClick={()=>{confirmDelete("Delete this breeding cycle? This cannot be undone.",()=>{clearTimeout(breedAutoSaveTimer.current);const nb=breedingCycles.filter(c=>c.id!==editBreedId);setBreedingCycles(nb);persistBreeding(nb);setShowBreedForm(false);setEditBreedId(null);});}} style={S.btnDanger}>Delete</button>
              </div>}
            </div>
          </div>
        )}

        <div style={{padding:"1rem"}}>
          {showUsers&&<UsersModal sb={sb} authState={authState} allUsers={allUsers} setAllUsers={setAllUsers} setShowUsers={setShowUsers} loadUsers={loadUsers}/>}
          {/* Nav bar */}
          <div style={{display:"flex",gap:6,marginBottom:12,alignItems:"center"}}>
            <button onClick={()=>{const d=new Date();d.setMonth(d.getMonth()-1);d.setDate(1);setBreedTlStart(toISO(d));}} style={{padding:"5px 14px",borderRadius:5,border:"none",background:"#085041",color:"white",cursor:"pointer",fontSize:11,fontWeight:600}}>Today</button>
            <span style={{fontSize:11,color:"#9ca3af"}}>{fmtS(breedTlStart)} — {fmtS(toISO(btlE))}</span>
            <button onClick={()=>{setBreedForm(EMPTY_BREED);setEditBreedId(null);setShowBreedForm(true);}}
              style={{marginLeft:"auto",padding:"5px 14px",borderRadius:8,border:"none",background:"#085041",color:"white",cursor:"pointer",fontSize:12,fontWeight:600}}>
              + Add Cycle
            </button>
          </div>

          {/* Gantt */}
          <div className="breed-gantt" style={{...S.card,overflowX:"auto",position:"relative"}}>
            {/* Floating tooltip for pig timeline */}
            {tooltip&&tooltip.type==='pig'&&(function(){
              return React.createElement('div',{style:{position:'fixed',left:tooltip.vx,top:tooltip.vy,transform:'translate(-50%,-100%)',zIndex:9999,pointerEvents:'none',display:'flex',flexDirection:'column',alignItems:'center'}},
                React.createElement('div',{style:{background:'#1a1a1a',color:'white',borderRadius:10,padding:'9px 12px',fontSize:12,boxShadow:'0 4px 16px rgba(0,0,0,.35)',minWidth:180,maxWidth:260}},
                  React.createElement('div',{style:{fontWeight:700,fontSize:13,marginBottom:5,color:'white'}},(tooltip.cycleLbl||('Group '+tooltip.group))+' \u2014 '+tooltip.phaseName),
                  React.createElement('div',{style:{display:'grid',gridTemplateColumns:'auto 1fr',gap:'3px 10px'}},
                    React.createElement('span',{style:{color:'#9ca3af'}},'Period:'),
                    React.createElement('span',{style:{color:'white'}},fmt(tooltip.start)+' \u2192 '+fmt(tooltip.end)),
                    React.createElement('span',{style:{color:'#9ca3af'}},'Sows:'),
                    React.createElement('span',{style:{color:'white'}},(tooltip.sowCount||'?')+' total')
                  )
                ),
                React.createElement('div',{style:{width:0,height:0,borderLeft:'7px solid transparent',borderRight:'7px solid transparent',borderTop:'7px solid #1a1a1a'}})
              );
            })()}
            <div style={{width:`${210+BREED_WEEKS*40}px`}}>
              {/* Week headers */}
              <div style={{display:"flex",borderBottom:"1px solid #e5e7eb"}}>
                <div style={{width:210,flexShrink:0,padding:"6px 10px",fontSize:10,fontWeight:600,color:"#9ca3af",borderRight:"1px solid #e5e7eb",background:"#ecfdf5",position:"sticky",left:0,zIndex:10}}>Phase</div>
                <div style={{flex:1,position:"relative",height:26,overflow:"hidden"}}>
                  {bWkHdrs.map((w,i)=>{
                    const isNew=w.getDate()<=7;
                    return (
                      <div key={i} style={{position:"absolute",top:0,left:`${(i/BREED_WEEKS)*100}%`,height:"100%",borderLeft:`1px solid ${isNew?"#aaa":"#eee"}`,paddingLeft:3,display:"flex",alignItems:"center"}}>
                        <span style={{fontSize:9,whiteSpace:"nowrap",color:isNew?"#444":"#bbb",fontWeight:isNew?600:400}}>
                          {isNew?w.toLocaleDateString("en-US",{month:"short",year:"2-digit"}):w.getDate()}
                        </span>
                      </div>
                    );
                  })}
                </div>
              </div>

              {phaseRows.map((row, ri)=>{
                const isGroupStart = ri%6===0;
                const rowCycles = breedingCycles.filter(c=>c.group===row.group);
                const todayPct = bpct(todayISO());
                const phaseColor = PIG_GROUP_COLORS[row.group]?.[row.phase]||"#ccc";
                const txtColor = PIG_GROUP_TEXT[row.group]||"white";
                return (
                  <div key={ri} style={{display:"flex",borderTop:isGroupStart?"2px solid #bbb":"1px solid #f0f0f0"}}>
                    <div style={{width:210,flexShrink:0,padding:"0 10px",display:"flex",alignItems:"center",height:40,fontSize:10,fontWeight:isGroupStart?700:400,color:isGroupStart?"#333":"#666",borderRight:"1px solid #e5e7eb",background:"#ecfdf5",whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis",position:"sticky",left:0,zIndex:10}}>
                      {row.label}
                    </div>
                    <div style={{flex:1,position:"relative",height:40}}>
                      {bWkHdrs.map((_,i)=>(
                        <div key={i} style={{position:"absolute",top:0,left:`${(i/BREED_WEEKS)*100}%`,height:"100%",borderLeft:"1px solid #f5f5f5",pointerEvents:"none"}}/>
                      ))}
                      {todayPct>=0&&todayPct<=100&&(
                        <div style={{position:"absolute",top:0,left:`${todayPct}%`,height:"100%",borderLeft:"2px solid rgba(8,80,65,.4)",pointerEvents:"none",zIndex:2}}/>
                      )}
                      {rowCycles.map(c=>{
                        // Always recalculate live so stale stored values never show
                        const liveTl = calcBreedingTimeline(c.exposureStart);
                        if(!liveTl) return null;
                        const liveC = {...c, ...liveTl};
                        const s = liveC[row.startKey], e = liveC[row.endKey];
                        if(!s||!e) return null;
                        const left  = Math.max(0,   bpct(s));
                        const right = Math.min(100,  bpct(e));
                        const w = right-left;
                        if(w<0.2) return null;
                        const phaseNames = {
                          boar:"Sows in with Boars",
                          paddock:"Sows in Exposed Paddock",
                          farrowing:"Farrowing",
                          weaning:"Weaning",
                          gilt:"Gilts Grow Out",
                          boarGrow:"Boars Grow Out",
                        };
                        const cLbl = cycleLabel(c, cycleSeqMap);
                        const cSuffix = cycleSeqMap[c.id];
                        const label = `G${c.group}${cSuffix?' · '+cSuffix:''} — ${phaseNames[row.phase]||row.phase}`;
                        return (
                          <div key={c.id} onClick={()=>{setBreedForm({group:c.group,customSuffix:c.customSuffix||"",boar1Tags:(c.boar1Tags||"").split(",").join("\n").split(", ").join("\n"),boar2Tags:(c.boar2Tags||"").split(",").join("\n").split(", ").join("\n"),exposureStart:c.exposureStart,notes:c.notes||"",boar1Name:c.boar1Name||boarNames.boar1,boar2Name:c.boar2Name||boarNames.boar2});setEditBreedId(c.id);setShowBreedForm(true);}}
                            onMouseEnter={function(ev){var r=ev.currentTarget.getBoundingClientRect();setTooltip({type:'pig',group:c.group,cycleLbl:cLbl,phase:row.phase,phaseName:phaseNames[row.phase]||row.phase,start:s,end:e,sowCount:c.sowCount,vx:r.left+r.width/2,vy:r.top-10});}}
                            onMouseLeave={function(){setTooltip(null);}}
                            style={{position:"absolute",left:`${left}%`,width:`${w}%`,top:4,bottom:4,borderRadius:4,cursor:"pointer",
                              background:phaseColor,display:"flex",alignItems:"center",padding:"0 7px",overflow:"hidden",
                              outline:tooltip&&tooltip.type==='pig'&&tooltip.group===c.group&&tooltip.phase===row.phase?'2px solid rgba(0,0,0,.25)':'none'}}>
                            <span style={{fontSize:10,fontWeight:600,color:txtColor,whiteSpace:"nowrap",textOverflow:"ellipsis",overflow:"hidden"}}>{label}</span>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Legend */}
          <div style={{display:"flex",gap:12,marginTop:10,flexWrap:"wrap",alignItems:"center"}}>
            {PIG_GROUPS.map(g=>(
              <div key={g} style={{display:"flex",alignItems:"center",gap:6}}>
                <div style={{width:10,height:10,borderRadius:2,background:PIG_GROUP_COLORS[g].boar}}/>
                <div style={{width:10,height:10,borderRadius:2,background:PIG_GROUP_COLORS[g].farrowing}}/>
                <div style={{width:10,height:10,borderRadius:2,background:PIG_GROUP_COLORS[g].boarGrow}}/>
                <span style={{fontSize:11,color:"#4b5563"}}>Group {g}</span>
              </div>
            ))}
            <span style={{fontSize:11,color:"#9ca3af"}}>Light → dark = earlier → later phases · Click bar to edit · Green line = today</span>
          </div>

          {/* Cycle cards below chart */}
          {breedingCycles.length>0&&(
            <div style={{marginTop:"1rem",display:"flex",flexDirection:"column",gap:8}}>
              <div style={{fontSize:13,fontWeight:600,color:"#4b5563"}}>Breeding cycles</div>
              {breedingCycles.map(c=>{
                const C=PIG_GROUP_COLORS[c.group];
                const tl=calcBreedingTimeline(c.exposureStart)||c;
                return (
                  <div key={c.id} style={{background:"white",border:`1px solid ${C.farrowing}`,borderRadius:10,padding:"10px 14px",fontSize:12}}>
                    <div style={{display:"flex",flexWrap:"wrap",gap:"6px 20px",alignItems:"center",marginBottom:6}}>
                      <strong>{cycleLabel(c, cycleSeqMap)}</strong>
                      <span style={{color:"#4b5563"}}>{c.sowCount||"?"} sows total</span>
                      <span style={{color:"#4b5563"}}>Sows in with Boars: {fmt(tl.boarStart)} {'\u2192'} {fmt(tl.boarEnd)}</span>
                      <span style={{color:"#4b5563"}}>Exposed Paddock: {fmt(tl.paddockStart)} {'\u2192'} {fmt(tl.paddockEnd)}</span>
                      <span style={{color:"#4b5563"}}>Farrowing: {fmt(tl.farrowingStart)} {'\u2192'} {fmt(tl.farrowingEnd)}</span>
                      <span style={{color:"#4b5563"}}>Grow-out ends: {fmt(tl.growEnd)}</span>
                      <span style={S.badge(calcCycleStatus(c)==="completed"?"#4b5563":calcCycleStatus(c)==="active"?"#085041":"#374151","white")}>{c.status}</span>
                      <button onClick={()=>{setBreedForm({group:c.group,boar1Tags:(c.boar1Tags||"").split(",").join("\n").split(", ").join("\n"),boar2Tags:(c.boar2Tags||"").split(",").join("\n").split(", ").join("\n"),exposureStart:c.exposureStart,notes:c.notes||"",boar1Name:c.boar1Name||boarNames.boar1,boar2Name:c.boar2Name||boarNames.boar2});setEditBreedId(c.id);setShowBreedForm(true);}} style={{marginLeft:"auto",fontSize:11,color:"#1d4ed8",background:"none",border:"none",cursor:"pointer"}}>Edit</button>
                    </div>
                    <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:"4px 20px",borderTop:"1px solid #e5e7eb",paddingTop:6}}>
                      <div style={{fontSize:11}}><span style={{color:"#9ca3af"}}>{c.boar1Name||boarNames.boar1} ({c.boar1Count||"?"} sows): </span><span style={{fontWeight:500}}>{c.boar1Tags||"—"}</span></div>
                      <div style={{fontSize:11}}><span style={{color:"#9ca3af"}}>{c.boar2Name||boarNames.boar2} ({c.boar2Count||"?"} sows): </span><span style={{fontWeight:500}}>{c.boar2Tags||"—"}</span></div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
          {breedingCycles.length===0&&<div style={{textAlign:"center",padding:"3rem",color:"#9ca3af",fontSize:13}}>No breeding cycles yet — click "+ Add Cycle" to get started</div>}
        </div>
      </div>
    );
}
