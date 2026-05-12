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
  const r = await fetch(
    `${URL}/rest/v1/cattle?select=tag,herd&tag=in.(%222%22,%223%22,%224%22,%225%22,%226%22,%227%22,%228%22,%229%22)&order=tag`,
    {headers: H},
  );
  const c = await r.json();
  console.log('Low-tag cattle:');
  c.forEach((x) => console.log(`  #${x.tag}  herd=${x.herd}`));
})();
