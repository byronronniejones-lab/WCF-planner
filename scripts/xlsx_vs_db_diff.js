const fs=require('fs'),path=require('path');
const XLSX=require('xlsx');
for(const l of fs.readFileSync(path.join(__dirname,'.env'),'utf8').split(/\r?\n/)){
  const m=/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*?)\s*$/.exec(l);
  if(m)process.env[m[1]]=m[2].replace(/^["']|["']$/g,'');
}
const URL=process.env.SUPABASE_URL,KEY=process.env.SUPABASE_SERVICE_ROLE_KEY;
const H={apikey:KEY,Authorization:`Bearer ${KEY}`};
async function fetchAll(qs){let all=[],from=0;while(true){const r=await fetch(`${URL}/rest/v1/${qs}&limit=1000&offset=${from}`,{headers:H});const d=await r.json();all=all.concat(d);if(d.length<1000)break;from+=1000;}return all;}

function iso(d){ if(!(d instanceof Date)) return null; return d.toISOString().slice(0,10); }

(async()=>{
  // Load xlsx
  const wb = XLSX.readFile('c:/Users/Ronni/OneDrive/Desktop/Cattle upload from Podio/Weigh Ins - All Weigh Ins.xlsx', { cellDates: true });
  const xlsxRaw = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { defval: null });
  const xlsxRows = xlsxRaw.map(r => ({
    tag: String(r['Tag #'] ?? '').trim(),
    date: iso(r['Date']),
    weight: Number(r['Weight']),
  })).filter(r => r.tag && r.date && Number.isFinite(r.weight) && r.weight > 0);

  // Load DB weigh_ins (exclude receiving-weight imports — those aren't in xlsx)
  const dbAll = await fetchAll('weigh_ins?select=tag,weight,note,entered_at&');
  const dbRows = dbAll
    .filter(w => !(w.note || '').includes('Receiving weight'))
    .map(w => ({
      tag: String(w.tag || '').trim(),
      date: (w.entered_at || '').slice(0,10),
      weight: Number(w.weight),
    }));

  // Multiset comparison: key = tag|date|weight
  const bag = (rows) => {
    const m = new Map();
    for(const r of rows){
      const k = r.tag + '|' + r.date + '|' + r.weight;
      m.set(k, (m.get(k)||0) + 1);
    }
    return m;
  };
  const xBag = bag(xlsxRows), dBag = bag(dbRows);

  const inXlsxNotDb = [];
  for(const [k, n] of xBag){
    const dN = dBag.get(k) || 0;
    if(n > dN) inXlsxNotDb.push({ k, diff: n - dN });
  }
  const inDbNotXlsx = [];
  for(const [k, n] of dBag){
    const xN = xBag.get(k) || 0;
    if(n > xN) inDbNotXlsx.push({ k, diff: n - xN });
  }

  console.log(`xlsx rows (valid): ${xlsxRows.length}`);
  console.log(`DB weigh_ins (excl. receiving-weight): ${dbRows.length}`);
  console.log(`\nxlsx keys missing/short in DB: ${inXlsxNotDb.length}`);
  if(inXlsxNotDb.length) inXlsxNotDb.slice(0,20).forEach(r => console.log(`  ${r.k}  missing ${r.diff}`));
  console.log(`\nDB keys not in xlsx: ${inDbNotXlsx.length}`);
  if(inDbNotXlsx.length) inDbNotXlsx.slice(0,20).forEach(r => console.log(`  ${r.k}  extra ${r.diff}`));

  // Sum check
  const xSum = xlsxRows.reduce((s,r) => s + r.weight, 0);
  const dSum = dbRows.reduce((s,r) => s + r.weight, 0);
  console.log(`\nWeight SUM xlsx: ${xSum}`);
  console.log(`Weight SUM DB:   ${dSum}`);
  console.log(`Difference:      ${Math.abs(xSum - dSum)}`);
})();
