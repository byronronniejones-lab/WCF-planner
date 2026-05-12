const fs = require('fs'),
  path = require('path');
for (const l of fs.readFileSync(path.join(__dirname, '.env'), 'utf8').split(/\r?\n/)) {
  const m = /^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*?)\s*$/.exec(l);
  if (m) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
}
const URL = process.env.SUPABASE_URL,
  KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const H = {apikey: KEY, Authorization: `Bearer ${KEY}`};
(async () => {
  // All finishers
  const r = await fetch(`${URL}/rest/v1/cattle?select=id,tag,herd&herd=eq.finishers&order=tag`, {headers: H});
  const finishers = await r.json();
  const tags = finishers.map((c) => c.tag).filter(Boolean);
  console.log(`Finishers: ${finishers.length}, tags: ${tags.slice(0, 20).join(', ')}...`);

  // Pull weigh-ins for these tags, latest per tag
  const results = {};
  for (const t of tags) {
    const w = await fetch(
      `${URL}/rest/v1/weigh_ins?select=weight,entered_at&tag=eq.${encodeURIComponent(t)}&order=entered_at.desc&limit=1`,
      {headers: H},
    );
    const data = await w.json();
    results[t] = data[0] || null;
  }
  let sum = 0,
    count = 0;
  console.log('\nFinishers (tag · latest weight · date):');
  for (const c of finishers) {
    const r = results[c.tag];
    if (r) {
      sum += parseFloat(r.weight);
      count++;
      console.log(`  #${c.tag}  ${r.weight} lb  ${(r.entered_at || '').slice(0, 10)}`);
    } else {
      console.log(`  #${c.tag}  (NO weigh-in)`);
    }
  }
  console.log(
    `\nSum of latest weights: ${Math.round(sum).toLocaleString()} lb across ${count} cows (Podio says 44,809)`,
  );
})();
