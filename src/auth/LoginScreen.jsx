// ============================================================================
// LoginScreen — Phase 2.1.5
// ============================================================================
// Verbatim byte-for-byte extraction from main.jsx. Email/password sign-in +
// forgot-password flow. Uses the same supabase client as everything else.
// ============================================================================
import React, { useState } from 'react';
import { sb } from '../lib/supabase.js';
function LoginScreen({onLogin}) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [mode, setMode] = useState('login'); // 'login' | 'reset'
  const [resetSent, setResetSent] = useState(false);

  async function handleLogin(e) {
    e.preventDefault();
    setLoading(true); setError('');
    const {error} = await sb.auth.signInWithPassword({email, password});
    if(error) { setError(error.message); setLoading(false); }
  }

  async function handleReset(e) {
    e.preventDefault();
    setLoading(true); setError('');
    try {
      // Use our branded email via edge function instead of Supabase's default
      const {error: fnError} = await sb.functions.invoke('rapid-processor', {
        body: { type: 'password_reset', data: { email: email } }
      });
      if(fnError) throw fnError;
      setResetSent(true);
    } catch(err) {
      setError(err.message||'Could not send reset email. Please try again.');
    }
    setLoading(false);
  }

  return (
    <div style={{minHeight:"100vh",background:"#085041",display:"flex",alignItems:"center",justifyContent:"center",padding:"1rem"}}>
      <div style={{background:"white",borderRadius:14,padding:"2.5rem",width:"100%",maxWidth:400,boxShadow:"0 8px 32px rgba(0,0,0,.2)"}}>
        <div style={{textAlign:"center",marginBottom:"2rem"}}>
          <div style={{fontSize:24,fontWeight:700,color:"#085041"}}>Broiler, Layer & Pig Planner</div>
          <div style={{fontSize:13,color:"#9ca3af",marginTop:4}}>White Creek Farm</div>
        </div>
        {mode==='login' ? (
          <form onSubmit={handleLogin} style={{display:"flex",flexDirection:"column",gap:12}}>
            <div>
              <label style={{fontSize:12,color:"#4b5563",display:"block",marginBottom:3}}>Email</label>
              <input type="email" value={email} onChange={e=>setEmail(e.target.value)} placeholder="your@email.com" required style={{marginBottom:0}}/>
            </div>
            <div>
              <label style={{fontSize:12,color:"#4b5563",display:"block",marginBottom:3}}>Password</label>
              <input type="password" value={password} onChange={e=>setPassword(e.target.value)} placeholder="••••••••" required/>
            </div>
            {error&&<div style={{color:"#b91c1c",fontSize:12,background:"#fef2f2",padding:"8px 12px",borderRadius:8}}>{error}</div>}
            <button type="submit" disabled={loading} style={{padding:"10px",borderRadius:10,border:"none",background:"#085041",color:"white",fontWeight:600,fontSize:14,cursor:loading?"not-allowed":"pointer",opacity:loading?.7:1,marginTop:4}}>
              {loading?"Signing in...":"Sign In"}
            </button>
            <button type="button" onClick={()=>setMode('reset')} style={{background:"none",border:"none",color:"#085041",fontSize:12,cursor:"pointer",textAlign:"center"}}>
              Forgot password?
            </button>
          </form>
        ) : (
          <form onSubmit={handleReset} style={{display:"flex",flexDirection:"column",gap:12}}>
            {resetSent ? (
              <div style={{textAlign:"center",color:"#085041",fontSize:13}}>
                <div style={{fontSize:32,marginBottom:8}}>✓</div>
                Check your email for a password reset link.
              </div>
            ) : (
              <>
                <div style={{fontSize:13,color:"#4b5563"}}>Enter your email and we'll send a reset link.</div>
                <input type="email" value={email} onChange={e=>setEmail(e.target.value)} placeholder="your@email.com" required style={{marginBottom:0}}/>
                {error&&<div style={{color:"#b91c1c",fontSize:12,background:"#fef2f2",padding:"8px 12px",borderRadius:8}}>{error}</div>}
                <button type="submit" disabled={loading} style={{padding:"10px",borderRadius:10,border:"none",background:"#085041",color:"white",fontWeight:600,fontSize:14,cursor:"pointer"}}>
                  {loading?"Sending...":"Send Reset Link"}
                </button>
              </>
            )}
            <button type="button" onClick={()=>{setMode('login');setResetSent(false);}} style={{background:"none",border:"none",color:"#085041",fontSize:12,cursor:"pointer",textAlign:"center"}}>
              ← Back to sign in
            </button>
          </form>
        )}
      </div>
    </div>
  );
}


const DEFAULT_WEBFORMS_CONFIG = {
  webforms:[
    {id:"pig-dailys",teamMembers:[],name:"Pig Daily Report",description:"Daily care report for each pig group",table:"pig_dailys",allowAddGroup:false,sections:[
      {id:"s-info",title:"Report Info",system:true,fields:[
        {id:"date",label:"Date",type:"date",required:true,system:true,enabled:true},
        {id:"team_member",label:"Team Member",type:"team_picker",required:true,system:true,enabled:true}
      ]},
      {id:"s-group",title:"Pig Group",system:false,fields:[
        {id:"batch_label",label:"Pig Group",type:"group_picker",groupType:"pig",required:true,system:true,enabled:true}
      ]},
      {id:"s-feed",title:"Count & Feed",system:false,fields:[
        {id:"pig_count",label:"# Pigs in group",type:"number",required:false,system:false,enabled:true},
        {id:"feed_lbs",label:"Feed given (lbs)",type:"number",required:false,system:false,enabled:true}
      ]},
      {id:"s-checks",title:"Daily Checks",system:false,fields:[
        {id:"group_moved",label:"Group moved?",type:"yes_no",required:false,system:false,enabled:true},
        {id:"nipple_drinker_moved",label:"Nipple drinker moved?",type:"yes_no",required:false,system:false,enabled:true},
        {id:"nipple_drinker_working",label:"Nipple drinker working?",type:"yes_no",required:false,system:false,enabled:true},
        {id:"troughs_moved",label:"Feed troughs moved?",type:"yes_no",required:false,system:false,enabled:true},
        {id:"fence_walked",label:"Fence line walked?",type:"yes_no",required:false,system:false,enabled:true},
        {id:"fence_voltage",label:"Fence voltage (kV)",type:"number",required:false,system:false,enabled:true}
      ]},
      {id:"s-comments",title:"Comments",system:false,fields:[
        {id:"issues",label:"Comments / Issues",type:"textarea",required:false,system:false,enabled:true}
      ]}
    ]},
    {id:"broiler-dailys",teamMembers:[],name:"Broiler Daily Report",description:"Daily care report for broiler batches",table:"poultry_dailys",allowAddGroup:false,sections:[
      {id:"s-info",title:"Report Info",system:true,fields:[
        {id:"date",label:"Date",type:"date",required:true,system:true,enabled:true},
        {id:"team_member",label:"Team Member",type:"team_picker",required:true,system:true,enabled:true}
      ]},
      {id:"s-group-feed",title:"Broiler Group & Feed",system:false,fields:[
        {id:"batch_label",label:"Broiler Group",type:"group_picker",groupType:"broiler",required:true,system:true,enabled:true},
        {id:"feed_type",label:"Feed Type",type:"button_toggle",options:["STARTER","GROWER"],required:true,system:false,enabled:true},
        {id:"feed_lbs",label:"Feed given (lbs)",type:"number",required:false,system:false,enabled:true},
        {id:"grit_lbs",label:"Grit given (lbs)",type:"number",required:false,system:false,enabled:true}
      ]},
      {id:"s-checks",title:"Daily Checks",system:false,fields:[
        {id:"group_moved",label:"Group moved?",type:"yes_no",required:false,system:false,enabled:true},
        {id:"waterer_checked",label:"Waterer checked?",type:"yes_no",required:false,system:false,enabled:true}
      ]},
      {id:"s-mortality",title:"Mortality",system:false,fields:[
        {id:"mortality_count",label:"# Mortalities",type:"number",required:false,system:false,enabled:true},
        {id:"mortality_reason",label:"Reason",type:"text",required:false,system:false,enabled:true}
      ]},
      {id:"s-comments",title:"Comments",system:false,fields:[
        {id:"comments",label:"Comments / Issues",type:"textarea",required:false,system:false,enabled:true}
      ]}
    ]},
    {id:"layer-dailys",teamMembers:[],name:"Layer Daily Report",description:"Daily care report for layer flocks",table:"layer_dailys",allowAddGroup:false,sections:[
      {id:"s-info",title:"Report Info",system:true,fields:[
        {id:"date",label:"Date",type:"date",required:true,system:true,enabled:true},
        {id:"team_member",label:"Team Member",type:"team_picker",required:true,system:true,enabled:true}
      ]},
      {id:"s-group-feed",title:"Layer Group & Feed",system:false,fields:[
        {id:"batch_label",label:"Layer Group",type:"group_picker",groupType:"layer",required:true,system:true,enabled:true},
        {id:"feed_type",label:"Feed Type",type:"button_toggle",options:["STARTER","GROWER","LAYER"],required:true,system:false,enabled:true},
        {id:"feed_lbs",label:"Feed given (lbs)",type:"number",required:false,system:false,enabled:true},
        {id:"grit_lbs",label:"Grit given (lbs)",type:"number",required:false,system:false,enabled:true},
        {id:"layer_count",label:"Current layer count",type:"number",required:false,system:false,enabled:true}
      ]},
      {id:"s-checks",title:"Daily Checks",system:false,fields:[
        {id:"group_moved",label:"Group moved?",type:"yes_no",required:false,system:false,enabled:true},
        {id:"waterer_checked",label:"Waterer checked?",type:"yes_no",required:false,system:false,enabled:true}
      ]},
      {id:"s-mortality",title:"Mortality",system:false,fields:[
        {id:"mortality_count",label:"# Mortalities",type:"number",required:false,system:false,enabled:true},
        {id:"mortality_reason",label:"Reason",type:"text",required:false,system:false,enabled:true}
      ]},
      {id:"s-comments",title:"Comments",system:false,fields:[
        {id:"comments",label:"Comments / Issues",type:"textarea",required:false,system:false,enabled:true}
      ]}
    ]},
    {id:"egg-dailys",teamMembers:[],name:"Egg Daily Report",description:"Daily egg collection report",table:"egg_dailys",allowAddGroup:false,sections:[
      {id:"s-info",title:"Report Info",system:true,fields:[
        {id:"date",label:"Date",type:"date",required:true,system:true,enabled:true},
        {id:"team_member",label:"Team Member",type:"team_picker",required:true,system:true,enabled:true}
      ]},
      {id:"s-collection",title:"Egg Collection",system:true,fields:[
        {id:"group1_pair",label:"Group 1",type:"egg_group",slot:1,required:true,system:true,enabled:true},
        {id:"group2_pair",label:"Group 2",type:"egg_group",slot:2,required:false,system:true,enabled:true},
        {id:"group3_pair",label:"Group 3",type:"egg_group",slot:3,required:false,system:true,enabled:true},
        {id:"group4_pair",label:"Group 4",type:"egg_group",slot:4,required:false,system:true,enabled:true}
      ]},
      {id:"s-summary",title:"Summary",system:false,fields:[
        {id:"dozens_on_hand",label:"Dozens on hand",type:"number",required:false,system:false,enabled:true}
      ]},
      {id:"s-comments",title:"Comments",system:false,fields:[
        {id:"comments",label:"Comments / Issues",type:"textarea",required:false,system:false,enabled:true}
      ]}
    ]},
    {id:"cattle-dailys",teamMembers:[],name:"Cattle Daily Report",description:"Daily care report for cattle herds",table:"cattle_dailys",allowAddGroup:false,sections:[
      {id:"s-info",title:"Report Info",system:true,fields:[
        {id:"date",label:"Date",type:"date",required:true,system:true,enabled:true},
        {id:"team_member",label:"Team Member",type:"team_picker",required:true,system:true,enabled:true}
      ]},
      {id:"s-herd",title:"Cattle Herd",system:true,fields:[
        {id:"herd",label:"Herd (mommas/backgrounders/finishers/bulls)",type:"herd_picker",required:true,system:true,enabled:true}
      ]},
      {id:"s-feeds",title:"Feeds & Minerals",system:true,fields:[
        {id:"feeds",label:"Feeds (multi-line, with creep toggle)",type:"feed_lines",required:false,system:true,enabled:true},
        {id:"minerals",label:"Minerals (multi-line)",type:"mineral_lines",required:false,system:true,enabled:true}
      ]},
      {id:"s-checks",title:"Daily Checks",system:false,fields:[
        {id:"fence_voltage",label:"Fence voltage (kV)",type:"number",required:false,system:false,enabled:true},
        {id:"water_checked",label:"Water source checked?",type:"yes_no",required:false,system:false,enabled:true}
      ]},
      {id:"s-comments",title:"Comments",system:false,fields:[
        {id:"issues",label:"Comments / Issues",type:"textarea",required:false,system:false,enabled:true}
      ]}
    ]}
  ]
}

export default LoginScreen;
