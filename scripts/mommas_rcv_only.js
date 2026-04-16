const fs=require('fs'),path=require('path');
for(const l of fs.readFileSync(path.join(__dirname,'.env'),'utf8').split(/\r?\n/)){
  const m=/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*?)\s*$/.exec(l);
  if(m)process.env[m[1]]=m[2].replace(/^["']|["']$/g,'');
}
const URL=process.env.SUPABASE_URL,KEY=process.env.SUPABASE_SERVICE_ROLE_KEY;
const H={apikey:KEY,Authorization:`Bearer ${KEY}`};
async function fetchAll(qs){let all=[],from=0;while(true){const r=await fetch(`${URL}/rest/v1/${qs}&limit=1000&offset=${from}`,{headers:H});const d=await r.json();all=all.concat(d);if(d.length<1000)break;from+=1000;}return all;}
(async()=>{
  const mommas = await fetchAll('cattle?select=id,tag,herd,old_tags&herd=eq.mommas&');
  const allW = await fetchAll('weigh_ins?select=tag,weight,note,entered_at&');
  const byTag = new Map();
  for(const w of allW){ if(!w.tag) continue; if(!byTag.has(w.tag)) byTag.set(w.tag,[]); byTag.get(w.tag).push(w); }
  let rcvOnly = 0, rcvSum = 0, mommas_with_weighin = 0;
  const rcvOnlyList = [];
  for(const c of mommas){
    const tags = new Set([c.tag, ...(c.old_tags||[]).map(t=>t.tag)].filter(Boolean));
    let all = [];
    for(const t of tags){ if(byTag.has(t)) all = all.concat(byTag.get(t)); }
    if(all.length === 0) continue;
    mommas_with_weighin++;
    const hasScale = all.some(w => !(w.note||'').includes('Receiving weight'));
    if(!hasScale){
      all.sort((a,b)=>(b.entered_at||'').localeCompare(a.entered_at||''));
      rcvOnly++;
      rcvSum += parseFloat(all[0].weight);
      rcvOnlyList.push(`#${c.tag} @ ${all[0].weight}lb (${(all[0].entered_at||'').slice(0,10)})`);
    }
  }
  console.log(`Mommas with a weigh-in: ${mommas_with_weighin}`);
  console.log(`Mommas whose ONLY weigh-in is receiving-weight (no scale data): ${rcvOnly}, sum = ${Math.round(rcvSum)} lb`);
  if(rcvOnly) rcvOnlyList.forEach(s => console.log(`  ${s}`));
})();
