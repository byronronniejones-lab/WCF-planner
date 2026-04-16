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
  for(const l of byTag.values()) l.sort((a,b)=>(b.entered_at||'').localeCompare(a.entered_at||''));

  // For each momma, find her latest weigh-in and check if there's a same-date alternative
  let suspects = [];
  for(const c of mommas){
    const tags = new Set([c.tag, ...(c.old_tags||[]).map(t=>t.tag)].filter(Boolean));
    let all = [];
    for(const t of tags){ if(byTag.has(t)) all = all.concat(byTag.get(t)); }
    if(all.length === 0) continue;
    all.sort((a,b)=>(b.entered_at||'').localeCompare(a.entered_at||''));
    const latest = all[0];
    const sameDate = all.filter(w => w.entered_at === latest.entered_at);
    const isRcv = (latest.note||'').includes('Receiving weight');
    const hasScaleSameDate = sameDate.some(w => !(w.note||'').includes('Receiving weight'));
    if(isRcv && hasScaleSameDate) {
      const scale = sameDate.find(w => !(w.note||'').includes('Receiving weight'));
      suspects.push({tag:c.tag, picked:latest.weight, scale:scale.weight, date:(latest.entered_at||'').slice(0,10)});
    }
  }
  console.log(`Mommas where latest is receiving-weight but a scale weigh-in exists on same date: ${suspects.length}`);
  suspects.forEach(s => console.log(`  #${s.tag}  picked=${s.picked} lb  scale=${s.scale} lb  date=${s.date}  (diff ${s.picked-s.scale})`));
  const delta = suspects.reduce((sum,s) => sum + (s.scale - s.picked), 0);
  console.log(`\nTotal shift if we flipped these to scale values: ${delta} lb`);
})();
