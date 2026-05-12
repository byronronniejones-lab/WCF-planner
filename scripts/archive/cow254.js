const fs = require('fs'),
  path = require('path');
const XLSX = require('xlsx');
for (const l of fs.readFileSync(path.join(__dirname, '.env'), 'utf8').split(/\r?\n/)) {
  const m = /^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*?)\s*$/.exec(l);
  if (m) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
}
const URL = process.env.SUPABASE_URL,
  KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const H = {apikey: KEY, Authorization: `Bearer ${KEY}`};
(async () => {
  const c = await fetch(`${URL}/rest/v1/cattle?tag=eq.254&select=*`, {headers: H});
  const cow = (await c.json())[0];
  console.log('Our cow #254:', {tag: cow.tag, herd: cow.herd, old_tags: cow.old_tags});

  const w = await fetch(
    `${URL}/rest/v1/weigh_ins?tag=eq.254&order=entered_at.desc&select=weight,entered_at,note,session_id`,
    {headers: H},
  );
  console.log('\nWeigh-ins under tag 254 (our DB):');
  (await w.json()).forEach((r) =>
    console.log(`  ${(r.entered_at || '').slice(0, 10)}  ${r.weight} lb  ${r.note || ''}  sid=${r.session_id}`),
  );

  // xlsx rows where Cow=254 or Tag#=254
  const wb = XLSX.readFile('c:/Users/Ronni/OneDrive/Desktop/Cattle upload from Podio/Weigh Ins - All Weigh Ins.xlsx', {
    cellDates: true,
  });
  const rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], {defval: null});
  const hits = rows.filter((r) => String(r['Tag #'] || '').trim() === '254' || String(r['Cow'] || '').trim() === '254');
  console.log(`\nWeigh-in xlsx rows matching #254 (by Tag# OR Cow): ${hits.length}`);
  hits
    .sort((a, b) => (b['Date'] || 0) - (a['Date'] || 0))
    .forEach((r) => {
      const d = r['Date'] instanceof Date ? r['Date'].toISOString().slice(0, 10) : '?';
      console.log(`  ${d}  Tag#=${r['Tag #']}  Cow=${r['Cow']}  Weight=${r['Weight']}`);
    });
})();
