// ============================================================================
// src/webforms/WebformsAdminView.jsx  —  Phase 2 Round 6
// ----------------------------------------------------------------------------
// Admin-only webforms config editor. Most form state is App-scope (Round 0
// deliberately left these out of WebformsConfigContext per §14's unowned
// state list) and comes in as a pile of props. webformsConfig itself is
// in useWebformsConfig(); the persist helper is passed in.
// ============================================================================
import React from 'react';
import { sb } from '../lib/supabase.js';
import { fmt, fmtS, todayISO, addDays } from '../lib/dateUtils.js';
import { S } from '../lib/styles.js';
import UsersModal from '../auth/UsersModal.jsx';
import FeedCostsPanel from '../admin/FeedCostsPanel.jsx';
import FeedCostByMonthPanel from '../admin/FeedCostByMonthPanel.jsx';
import LivestockFeedInputsPanel from '../admin/LivestockFeedInputsPanel.jsx';
import NutritionTargetsPanel from '../admin/NutritionTargetsPanel.jsx';
import { useAuth } from '../contexts/AuthContext.jsx';
import { useFeedCosts } from '../contexts/FeedCostsContext.jsx';
import { useWebformsConfig } from '../contexts/WebformsConfigContext.jsx';
import { useUI } from '../contexts/UIContext.jsx';

export default function WebformsAdminView({
  Header, loadUsers, persistWebforms,
  saveFeedCosts, confirmDelete,
  adminTab, setAdminTab,
  wfForm, setWfForm,
  wfSubmitting, setWfSubmitting,
  wfDone, setWfDone,
  wfErr, setWfErr,
  wfGroupName, setWfGroupName,
  wfView, setWfView,
  editWfId, setEditWfId,
  editFieldId, setEditFieldId,
  wfFieldForm, setWfFieldForm,
  newTeamMember, setNewTeamMember,
  addingTo, setAddingTo,
  editFldLbl, setEditFldLbl,
  editFldVal, setEditFldVal,
  editSecIdx, setEditSecIdx,
  editSecVal, setEditSecVal,
  newOpt, setNewOpt,
}) {
  const { authState, showUsers, setShowUsers, allUsers, setAllUsers } = useAuth();
  const { webformsConfig, wfGroups, setWfGroups, wfTeamMembers, setWfTeamMembers } = useWebformsConfig();
  const { feedCosts } = useFeedCosts();
  const { setView } = useUI();
    const FIELD_TYPES = [
      {value:"text",          label:"Text (single line)"},
      {value:"textarea",      label:"Text (multi-line)"},
      {value:"number",        label:"Number"},
      {value:"yes_no",        label:"Yes / No toggle"},
      {value:"button_toggle", label:"Button toggle (custom options)"},
      {value:"date",          label:"Date picker"},
    ];
    const TYPE_LABELS = {
      text:"Text",textarea:"Multi-line text",number:"Number",
      yes_no:"Yes/No toggle",button_toggle:"Button toggle",
      date:"Date",team_picker:"Team member picker",
      group_picker:"Group selector",egg_group:"Egg group pair"
    };
    const TYPE_COLOR = {
      text:"#374151",textarea:"#374151",number:"#1d4ed8",
      yes_no:"#085041",button_toggle:"#1e40af",date:"#92400e",
      team_picker:"#0369a1",group_picker:"#be185d",egg_group:"#d97706"
    };

    const currentWf = editWfId ? webformsConfig.webforms.find(w=>w.id===editWfId) : null;

    function updateWf(updated){
      const nb={...webformsConfig,webforms:webformsConfig.webforms.map(w=>w.id===editWfId?updated:w)};
      persistWebforms(nb);
    }
    function updateSections(s){ updateWf({...currentWf,sections:s}); }

    function addTeamMember(){
      if(!newTeamMember.trim()) return;
      if(webformsConfig.teamMembers.includes(newTeamMember.trim())){setNewTeamMember("");return;}
      persistWebforms({...webformsConfig,teamMembers:[...webformsConfig.teamMembers,newTeamMember.trim()].sort()});
      setNewTeamMember("");
    }
    function removeTeamMember(name){
      persistWebforms({...webformsConfig,teamMembers:webformsConfig.teamMembers.filter(m=>m!==name)});
    }
    function moveSection(si,dir){
      const s=[...currentWf.sections];
      if(si+dir<0||si+dir>=s.length) return;
      [s[si],s[si+dir]]=[s[si+dir],s[si]]; updateSections(s);
    }
    function addSection(){
      updateSections([...currentWf.sections,{id:"sec-"+Date.now(),title:"New Section",system:false,fields:[]}]);
    }
    function renameSection(si,title){
      updateSections(currentWf.sections.map((s,i)=>i===si?{...s,title}:s));
    }
    function deleteSection(si){
      confirmDelete("Delete this section and all its fields? This cannot be undone.",()=>{
        updateSections(currentWf.sections.filter((_,i)=>i!==si));
      });
    }
    function moveField(si,fi,dir){
      updateSections(currentWf.sections.map((s,i)=>{
        if(i!==si) return s;
        const f=[...s.fields];
        if(fi+dir<0||fi+dir>=f.length) return s;
        [f[fi],f[fi+dir]]=[f[fi+dir],f[fi]]; return {...s,fields:f};
      }));
    }
    function toggleField(si,fi){
      updateSections(currentWf.sections.map((s,i)=>i!==si?s:{...s,fields:s.fields.map((f,j)=>j!==fi?f:{...f,enabled:!f.enabled})}));
    }
    function deleteField(si,fi){
      confirmDelete("Delete this field? This cannot be undone.",()=>{
        updateSections(currentWf.sections.map((s,i)=>i!==si?s:{...s,fields:s.fields.filter((_,j)=>j!==fi)}));
      });
    }
    function renameField(si,fi,label){
      updateSections(currentWf.sections.map((s,i)=>i!==si?s:{...s,fields:s.fields.map((f,j)=>j!==fi?f:{...f,label})}));
    }
    function saveNewField(si){
      if(!wfFieldForm.label.trim()){alert("Enter a field label.");return;}
      if(wfFieldForm.type==="button_toggle"&&(!wfFieldForm.options||wfFieldForm.options.length<2)){alert("Add at least 2 button options.");return;}
      const nf={id:"c-"+Date.now(),...wfFieldForm,system:false,enabled:true};
      updateSections(currentWf.sections.map((s,i)=>i!==si?s:{...s,fields:[...s.fields,nf]}));
      setWfFieldForm({label:"",type:"text",required:false,options:[]}); setWfView("list");
    }

    return (
      <div>
        <Header/>
        {/* Sub-nav bar — matches animal section style */}
        <div style={{background:"white",borderBottom:"1px solid #e5e7eb",padding:"8px 1.25rem",display:"flex",gap:6,alignItems:"center",flexWrap:"wrap"}}>
          <button onClick={()=>setView('home')} style={{padding:'7px 12px',borderRadius:8,border:'1px solid #d1d5db',cursor:'pointer',fontSize:12,fontWeight:500,background:'white',color:'#6b7280',fontFamily:'inherit',whiteSpace:'nowrap'}}>⌂ Home</button>
          <div style={{width:1,height:20,background:"#e5e7eb",margin:"0 4px"}}/>
          {[{id:'webforms',label:'Webforms'},{id:'feedcosts',label:'Feed'},{id:'costsbymonth',label:'Cost by Month'}].map(t=>{
            const active=adminTab===t.id&&!editWfId;
            return (
              <button key={t.id} onClick={()=>{setAdminTab(t.id);setEditWfId(null);setWfView('list');}}
                style={{padding:'7px 16px',borderRadius:8,cursor:'pointer',fontFamily:'inherit',fontSize:12,fontWeight:active?700:500,whiteSpace:'nowrap',border:active?'2px solid #085041':'1px solid #d1d5db',background:active?'#085041':'white',color:active?'white':'#374151'}}>
                {t.label}
              </button>
            );
          })}
        </div>
        <div style={{padding:"1rem",maxWidth:720,margin:"0 auto"}}>
          {showUsers&&<UsersModal sb={sb} authState={authState} allUsers={allUsers} setAllUsers={setAllUsers} setShowUsers={setShowUsers} loadUsers={loadUsers}/>}

          {adminTab==='feedcosts'&&(
            <div style={{display:'flex',flexDirection:'column'}}>
              <FeedCostsPanel feedCosts={feedCosts} saveFeedCosts={saveFeedCosts}/>
              <LivestockFeedInputsPanel sb={sb}/>
              <NutritionTargetsPanel sb={sb}/>
            </div>
          )}

          {adminTab==='costsbymonth'&&(
            <FeedCostByMonthPanel sb={sb} feedCosts={feedCosts}/>
          )}

          {adminTab==='webforms'&&<div>

          {/* ── EDITOR ── */}
          {editWfId&&currentWf&&(
            <div>
              <div style={{display:"flex",alignItems:"center",gap:10,marginBottom:16}}>
                <button onClick={()=>{setEditWfId(null);setWfView("list");setAddingTo(null);}}
                  style={{fontSize:12,color:"#1d4ed8",background:"none",border:"none",cursor:"pointer"}}>← All webforms</button>
                <span style={{color:"#d1d5db"}}>/</span>
                <span style={{fontSize:14,fontWeight:700}}>{currentWf.name}</span>
              </div>
              <div style={{background:"#ecfdf5",border:"1px solid #a7f3d0",borderRadius:10,padding:"10px 16px",marginBottom:16,fontSize:12,display:"flex",alignItems:"center",gap:10}}>
                <span style={{color:"#6b7280"}}>Live URL:</span>
                <strong style={{color:"#085041"}}>wcfplanner.com/#webforms</strong>
                <a href="/#webforms" target="_blank" style={{color:"#085041",fontSize:11,marginLeft:"auto"}}>Open form →</a>
              </div>

              {/* Team Members — per form */}
              <div style={{background:"white",border:"1px solid #e5e7eb",borderRadius:10,padding:"16px",marginBottom:16}}>
                <div style={{fontSize:13,fontWeight:700,color:"#111827",marginBottom:12}}>Team Members <span style={{fontSize:11,fontWeight:400,color:"#9ca3af"}}>(for this form only)</span></div>
                <div style={{display:"flex",gap:6,flexWrap:"wrap",marginBottom:10}}>
                  {(currentWf.teamMembers||[]).map(m=>(
                    <div key={m} style={{display:"flex",alignItems:"center",gap:4,background:"#f3f4f6",border:"1px solid #e5e7eb",borderRadius:6,padding:"4px 10px",fontSize:12}}>
                      {m}<button onClick={()=>updateWf({...currentWf,teamMembers:(currentWf.teamMembers||[]).filter(x=>x!==m)})} style={{background:"none",border:"none",color:"#9ca3af",cursor:"pointer",fontSize:14,lineHeight:1,padding:0,marginLeft:4}}>×</button>
                    </div>
                  ))}
                  {(currentWf.teamMembers||[]).length===0&&<span style={{fontSize:12,color:"#9ca3af"}}>No team members yet</span>}
                </div>
                <div style={{display:"flex",gap:6}}>
                  <input value={newTeamMember} onChange={e=>setNewTeamMember(e.target.value)}
                    onKeyDown={e=>{if(e.key==="Enter"&&newTeamMember.trim()){if(!(currentWf.teamMembers||[]).includes(newTeamMember.trim()))updateWf({...currentWf,teamMembers:[...(currentWf.teamMembers||[]),newTeamMember.trim()].sort()});setNewTeamMember("");}}}
                    placeholder="Add name…" style={{fontSize:12,padding:"6px 10px",flex:1}}/>
                  <button onClick={()=>{if(newTeamMember.trim()&&!(currentWf.teamMembers||[]).includes(newTeamMember.trim())){updateWf({...currentWf,teamMembers:[...(currentWf.teamMembers||[]),newTeamMember.trim()].sort()});}setNewTeamMember("");}}
                    style={{padding:"6px 14px",borderRadius:6,border:"none",background:"#085041",color:"white",fontSize:12,fontWeight:600,cursor:"pointer"}}>Add</button>
                </div>
              </div>

              {/* Sections header */}
              <div style={{marginBottom:12,display:"flex",justifyContent:"space-between",alignItems:"center"}}>
                <div style={{fontSize:13,fontWeight:700,color:"#111827"}}>Form Sections & Fields</div>
                <button onClick={addSection} style={{padding:"6px 14px",borderRadius:6,border:"none",background:"#085041",color:"white",fontSize:12,fontWeight:600,cursor:"pointer"}}>+ Add Section</button>
              </div>

              {(currentWf.sections||[]).map((sec,si)=>(
                <div key={sec.id} style={{background:"white",border:"1px solid #e5e7eb",borderRadius:10,marginBottom:12,overflow:"hidden"}}>
                  {/* Section header row */}
                  <div style={{padding:"10px 14px",background:sec.system?"#f0fdf9":"#f9fafb",display:"flex",alignItems:"center",gap:8,borderBottom:"1px solid #e5e7eb"}}>
                    <div style={{display:"flex",flexDirection:"column",gap:2}}>
                      <button onClick={()=>moveSection(si,-1)} style={{background:"none",border:"none",cursor:"pointer",fontSize:10,color:"#9ca3af",lineHeight:1,padding:0,opacity:si===0?.3:1}}>▲</button>
                      <button onClick={()=>moveSection(si,1)} style={{background:"none",border:"none",cursor:"pointer",fontSize:10,color:"#9ca3af",lineHeight:1,padding:0,opacity:si===currentWf.sections.length-1?.3:1}}>▼</button>
                    </div>
                    {editSecIdx===si ? (
                      <input autoFocus value={editSecVal} onChange={e=>setEditSecVal(e.target.value)}
                        onBlur={()=>{renameSection(si,editSecVal);setEditSecIdx(null);}}
                        onKeyDown={e=>{if(e.key==="Enter"){renameSection(si,editSecVal);setEditSecIdx(null);}}}
                        style={{fontSize:13,fontWeight:600,border:"1px solid #3b82f6",borderRadius:4,padding:"2px 6px",flex:1}}/>
                    ) : (
                      <div style={{fontWeight:600,fontSize:13,color:"#111827",flex:1,display:"flex",alignItems:"center",gap:6}}>
                        {sec.title}
                        {sec.system&&<span style={{fontSize:10,color:"#085041",background:"#ecfdf5",border:"1px solid #a7f3d0",borderRadius:4,padding:"1px 5px"}}>system</span>}
                        {!sec.system&&<button onClick={()=>{setEditSecIdx(si);setEditSecVal(sec.title);}} style={{fontSize:11,color:"#9ca3af",background:"none",border:"none",cursor:"pointer",padding:"0 4px"}}>✎ rename</button>}
                      </div>
                    )}
                    <div style={{display:"flex",gap:6,alignItems:"center"}}>
                      <button onClick={()=>setAddingTo(addingTo===si?null:si)}
                        style={{fontSize:11,padding:"3px 10px",borderRadius:5,border:"1px solid #d1d5db",background:"white",color:"#085041",cursor:"pointer",fontWeight:600}}>+ Field</button>
                      {!sec.system&&<button onClick={()=>deleteSection(si)} style={{fontSize:11,color:"#b91c1c",background:"none",border:"none",cursor:"pointer"}}>Delete</button>}
                    </div>
                  </div>

                  {/* Add field form */}
                  {addingTo===si&&(
                    <div style={{padding:"12px 14px",background:"#f0f7ff",borderBottom:"1px solid #e5e7eb"}}>
                      <div style={{fontSize:12,fontWeight:600,color:"#1d4ed8",marginBottom:10}}>Add field to "{sec.title}"</div>
                      <div style={{display:"grid",gridTemplateColumns:"2fr 1fr",gap:10,marginBottom:10}}>
                        <div>
                          <label style={{fontSize:11,color:"#6b7280",display:"block",marginBottom:3}}>Label *</label>
                          <input value={wfFieldForm.label} onChange={e=>setWfFieldForm({...wfFieldForm,label:e.target.value})}
                            placeholder="e.g. Body weight (lbs)" style={{fontSize:12,padding:"6px 10px",width:"100%"}}/>
                        </div>
                        <div>
                          <label style={{fontSize:11,color:"#6b7280",display:"block",marginBottom:3}}>Type</label>
                          <select value={wfFieldForm.type} onChange={e=>setWfFieldForm({...wfFieldForm,type:e.target.value,options:[]})} style={{fontSize:12,padding:"6px 8px",width:"100%"}}>
                            {FIELD_TYPES.map(t=><option key={t.value} value={t.value}>{t.label}</option>)}
                          </select>
                        </div>
                      </div>
                      {wfFieldForm.type==="button_toggle"&&(
                        <div style={{marginBottom:10}}>
                          <label style={{fontSize:11,color:"#6b7280",display:"block",marginBottom:3}}>Button options (min 2)</label>
                          <div style={{display:"flex",gap:4,flexWrap:"wrap",marginBottom:6}}>
                            {(wfFieldForm.options||[]).map(o=>(
                              <div key={o} style={{background:"#e5e7eb",borderRadius:4,padding:"2px 8px",fontSize:11,display:"flex",alignItems:"center",gap:4}}>
                                {o}<button onClick={()=>setWfFieldForm({...wfFieldForm,options:wfFieldForm.options.filter(x=>x!==o)})} style={{background:"none",border:"none",cursor:"pointer",color:"#6b7280",fontSize:12,padding:0}}>×</button>
                              </div>
                            ))}
                          </div>
                          <div style={{display:"flex",gap:6}}>
                            <input value={newOpt} onChange={e=>setNewOpt(e.target.value)}
                              onKeyDown={e=>{if(e.key==="Enter"&&newOpt.trim()){setWfFieldForm({...wfFieldForm,options:[...(wfFieldForm.options||[]),newOpt.trim()]});setNewOpt("");}}}
                              placeholder="Add option…" style={{fontSize:12,padding:"5px 8px",flex:1}}/>
                            <button onClick={()=>{if(newOpt.trim()){setWfFieldForm({...wfFieldForm,options:[...(wfFieldForm.options||[]),newOpt.trim()]});setNewOpt("");}}} style={{padding:"5px 10px",borderRadius:5,border:"none",background:"#374151",color:"white",fontSize:11,cursor:"pointer"}}>Add</button>
                          </div>
                        </div>
                      )}
                      <label style={{display:"flex",alignItems:"center",gap:6,fontSize:12,cursor:"pointer",marginBottom:8}}>
                        <input type="checkbox" checked={wfFieldForm.required} onChange={e=>setWfFieldForm({...wfFieldForm,required:e.target.checked})} style={{width:"auto"}}/>Required
                      </label>
                      <div style={{display:"flex",gap:6}}>
                        <button onClick={()=>saveNewField(si)} style={{padding:"6px 14px",borderRadius:6,border:"none",background:"#085041",color:"white",fontSize:12,fontWeight:600,cursor:"pointer"}}>Add Field</button>
                        <button onClick={()=>{setAddingTo(null);setWfFieldForm({label:"",type:"text",required:false,options:[]});setNewOpt("");}} style={{padding:"6px 12px",borderRadius:6,border:"1px solid #d1d5db",background:"white",color:"#374151",fontSize:12,cursor:"pointer"}}>Cancel</button>
                      </div>
                    </div>
                  )}

                  {sec.fields.length===0&&<div style={{padding:"12px 14px",fontSize:12,color:"#9ca3af",textAlign:"center",fontStyle:"italic"}}>No fields — click "+ Field" to add</div>}

                  {sec.fields.map((f,fi)=>(
                    <div key={f.id} style={{padding:"10px 14px",borderBottom:fi<sec.fields.length-1?"1px solid #f3f4f6":"none",
                      display:"flex",alignItems:"center",gap:8,background:f.enabled?"white":"#fafafa",opacity:f.enabled?1:.55}}>
                      <div style={{display:"flex",flexDirection:"column",gap:2,flexShrink:0}}>
                        <button onClick={()=>moveField(si,fi,-1)} style={{background:"none",border:"none",cursor:"pointer",fontSize:10,color:"#9ca3af",lineHeight:1,padding:0,opacity:(fi===0||f.system)?.3:1}}>▲</button>
                        <button onClick={()=>moveField(si,fi,1)} style={{background:"none",border:"none",cursor:"pointer",fontSize:10,color:"#9ca3af",lineHeight:1,padding:0,opacity:(fi===sec.fields.length-1||f.system)?.3:1}}>▼</button>
                      </div>
                      <div style={{flex:1}}>
                        {editFldLbl&&editFldLbl.si===si&&editFldLbl.fi===fi ? (
                          <input autoFocus value={editFldVal} onChange={e=>setEditFldVal(e.target.value)}
                            onBlur={()=>{renameField(si,fi,editFldVal);setEditFldLbl(null);}}
                            onKeyDown={e=>{if(e.key==="Enter"){renameField(si,fi,editFldVal);setEditFldLbl(null);}}}
                            style={{fontSize:13,border:"1px solid #3b82f6",borderRadius:4,padding:"2px 6px",width:"100%"}}/>
                        ) : (
                          <div style={{display:"flex",alignItems:"center",gap:6}}>
                            <span style={{fontSize:13,fontWeight:500,color:"#111827"}}>{f.label}</span>
                            {!f.system&&<button onClick={()=>{setEditFldLbl({si,fi});setEditFldVal(f.label);}} style={{fontSize:11,color:"#9ca3af",background:"none",border:"none",cursor:"pointer",padding:"0 2px"}}>✎</button>}
                          </div>
                        )}
                        <div style={{display:"flex",gap:4,marginTop:3,flexWrap:"wrap",alignItems:"center"}}>
                          <span style={{fontSize:10,padding:"1px 6px",borderRadius:4,background:TYPE_COLOR[f.type]||"#374151",color:"white",fontWeight:500}}>{TYPE_LABELS[f.type]||f.type}</span>
                          {f.required&&<span style={{fontSize:10,padding:"1px 6px",borderRadius:4,background:"#fef3c7",color:"#92400e",fontWeight:500}}>required</span>}
                          {f.system&&<span style={{fontSize:10,padding:"1px 6px",borderRadius:4,background:"#f3f4f6",color:"#6b7280"}}>system — locked</span>}
                          {f.type==="button_toggle"&&f.options&&<span style={{fontSize:10,color:"#9ca3af"}}>{f.options.join(" / ")}</span>}
                        </div>
                      </div>
                      <div style={{display:"flex",gap:6,flexShrink:0,alignItems:"center"}}>
                        {!f.system&&<>
                          <button onClick={()=>{
                            updateSections(currentWf.sections.map((s,i)=>i!==si?s:{...s,fields:s.fields.map((ff,j)=>j!==fi?ff:{...ff,required:!ff.required})}));
                          }} style={{fontSize:11,padding:"3px 8px",borderRadius:5,border:"1px solid #d1d5db",background:f.required?"#fef3c7":"white",color:f.required?"#92400e":"#6b7280",cursor:"pointer",fontWeight:f.required?600:400}}>
                            {f.required?"★ Req":"☆ Req"}
                          </button>
                          <button onClick={()=>toggleField(si,fi)} style={{fontSize:11,padding:"3px 8px",borderRadius:5,border:"1px solid #d1d5db",background:"white",color:"#4b5563",cursor:"pointer"}}>{f.enabled?"Hide":"Show"}</button>
                          <button onClick={()=>deleteField(si,fi)} style={{fontSize:11,color:"#b91c1c",background:"none",border:"none",cursor:"pointer"}}>Del</button>
                        </>}
                      </div>
                    </div>
                  ))}
                </div>
              ))}
            </div>
          )}

          {/* ── LIST ── */}
          {!editWfId&&(
            <div>
              <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:4}}>
                <div style={{fontSize:15,fontWeight:700,color:"#111827"}}>Webforms</div>
                <button onClick={()=>setView("home")} style={{padding:"5px 14px",borderRadius:7,border:"1px solid #d1d5db",background:"white",color:"#374151",fontSize:12,fontWeight:500,cursor:"pointer"}}>← Home</button>
              </div>
              <div style={{fontSize:12,color:"#6b7280",marginBottom:16}}>Manage sections, fields, and team members. Changes go live immediately.</div>



              {webformsConfig.webforms.map(wf=>{
                const isAddFeed=wf.id==='add-feed-webform';
                const totalFields=(wf.sections||[]).reduce((s,sec)=>s+sec.fields.filter(f=>f.enabled).length,0);
                return (
                  <div key={wf.id} style={{background:isAddFeed?"#fffbeb":"white",border:isAddFeed?"1px solid #fde68a":"1px solid #e5e7eb",borderRadius:10,padding:"16px",marginBottom:12}}>
                    <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",flexWrap:"wrap",gap:8}}>
                      <div>
                        <div style={{fontSize:14,fontWeight:700,color:isAddFeed?"#92400e":"#111827"}}>{isAddFeed?'\ud83c\udf3e ':''}{wf.name}</div>
                        <div style={{fontSize:12,color:"#6b7280",marginTop:2}}>{wf.description}</div>
                        <a href={isAddFeed?"/#addfeed":"/#webforms"} target="_blank" style={{fontSize:11,color:"#085041",display:"block",marginTop:4}}>{'wcfplanner.com/#'+(isAddFeed?'addfeed':'webforms')}</a>
                      </div>
                      <button onClick={()=>{setEditWfId(wf.id);setWfView("list");setAddingTo(null);}} style={{padding:"6px 16px",borderRadius:7,border:"none",background:isAddFeed?"#92400e":"#085041",color:"white",fontSize:12,fontWeight:600,cursor:"pointer"}}>Edit {'\u2192'}</button>
                    </div>
                    <div style={{marginTop:10,display:"flex",gap:16,fontSize:12,color:"#6b7280",alignItems:"center",flexWrap:"wrap"}}>
                      {!isAddFeed&&<span>📋 {(wf.sections||[]).length} sections · {totalFields} active fields</span>}
                      <span>👤 {(wf.teamMembers||[]).length} team members</span>
                      <label style={{display:"flex",alignItems:"center",gap:6,cursor:"pointer",marginLeft:"auto",userSelect:"none"}}>
                        <span style={{color:"#374151",fontWeight:500,fontSize:11}}>Add Group:</span>
                        <div onClick={()=>{const nb={...webformsConfig,webforms:webformsConfig.webforms.map(w=>w.id===wf.id?{...w,allowAddGroup:!wf.allowAddGroup}:w)};persistWebforms(nb);}}
                          style={{width:36,height:20,borderRadius:10,background:wf.allowAddGroup?"#085041":"#d1d5db",cursor:"pointer",position:"relative",transition:"background .2s",flexShrink:0}}>
                          <div style={{position:"absolute",top:2,left:wf.allowAddGroup?18:2,width:16,height:16,borderRadius:"50%",background:"white",transition:"left .2s",boxShadow:"0 1px 3px rgba(0,0,0,.2)"}}/>
                        </div>
                        <span style={{fontSize:11,color:wf.allowAddGroup?"#085041":"#9ca3af"}}>{wf.allowAddGroup?"On":"Off"}</span>
                      </label>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
          </div>}
        </div>
      </div>
    );
}
