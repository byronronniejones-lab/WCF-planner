const fs=require('fs'),path=require('path');
for(const l of fs.readFileSync(path.join(__dirname,'.env'),'utf8').split(/\r?\n/)){
  const m=/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*?)\s*$/.exec(l);
  if(m)process.env[m[1]]=m[2].replace(/^["']|["']$/g,'');
}
const URL=process.env.SUPABASE_URL,KEY=process.env.SUPABASE_SERVICE_ROLE_KEY;
const H={apikey:KEY,Authorization:`Bearer ${KEY}`};
(async()=>{
  const r=await fetch(`${URL}/rest/v1/weigh_in_sessions?select=id,date,notes,team_member&species=eq.cattle&date=eq.2026-04-16`,{headers:H});
  const sess=await r.json();
  console.log(`Sessions dated 2026-04-16: ${sess.length}`);
  for(const s of sess){
    const w=await fetch(`${URL}/rest/v1/weigh_ins?session_id=eq.${encodeURIComponent(s.id)}&select=id,tag,weight,note`,{headers:H});
    const entries=await w.json();
    console.log(`\n  session ${s.id}  team=${s.team_member}  notes="${s.notes}"`);
    console.log(`  ${entries.length} weigh_ins:`);
    entries.forEach(e=>console.log(`    tag ${e.tag}  ${e.weight}lb  note="${e.note||''}"`));
  }
})();
