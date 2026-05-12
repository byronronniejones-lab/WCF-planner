const fs = require('fs'),
  path = require('path');
for (const l of fs.readFileSync(path.join(__dirname, '.env'), 'utf8').split(/\r?\n/)) {
  const m = /^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*?)\s*$/.exec(l);
  if (m) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
}
const URL = process.env.SUPABASE_URL,
  KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const H = {apikey: KEY, Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json'};
(async () => {
  if (!process.argv.includes('--commit')) {
    console.log('Preview: would delete 4 receiving-weight weigh_ins on 2026-04-16 + empty session.');
    console.log('Run with --commit to apply.');
    return;
  }
  const sr = await fetch(`${URL}/rest/v1/weigh_in_sessions?select=id&species=eq.cattle&date=eq.2026-04-16`, {
    headers: H,
  });
  const sess = await sr.json();
  for (const s of sess) {
    const d1 = await fetch(`${URL}/rest/v1/weigh_ins?session_id=eq.${encodeURIComponent(s.id)}`, {
      method: 'DELETE',
      headers: {...H, Prefer: 'return=minimal'},
    });
    if (!d1.ok) throw new Error(await d1.text());
    const d2 = await fetch(`${URL}/rest/v1/weigh_in_sessions?id=eq.${encodeURIComponent(s.id)}`, {
      method: 'DELETE',
      headers: {...H, Prefer: 'return=minimal'},
    });
    if (!d2.ok) throw new Error(await d2.text());
    console.log(`deleted session ${s.id} + its weigh_ins`);
  }
  console.log('done.');
})();
