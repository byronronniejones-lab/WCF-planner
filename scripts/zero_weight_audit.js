const fs=require('fs'),path=require('path');
for(const l of fs.readFileSync(path.join(__dirname,'.env'),'utf8').split(/\r?\n/)){
  const m=/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*?)\s*$/.exec(l);
  if(m)process.env[m[1]]=m[2].replace(/^["']|["']$/g,'');
}
(async()=>{
  const URL=process.env.SUPABASE_URL,KEY=process.env.SUPABASE_SERVICE_ROLE_KEY;
  const res=await fetch(`${URL}/rest/v1/weigh_ins?select=id,tag,weight,session_id&weight=eq.0`,{
    headers:{apikey:KEY,Authorization:`Bearer ${KEY}`,'Range-Unit':'items'}
  });
  const zeros=await res.json();
  console.log('weigh_ins rows with weight=0:',zeros.length);
  if(zeros.length)console.log('Sample:',zeros.slice(0,5));
})();
