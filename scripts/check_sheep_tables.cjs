const fs = require('fs');
const path = require('path');
const envPath = path.join(__dirname, '.env');
for (const line of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
  const m = /^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*?)\s*$/.exec(line);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
}
const URL = process.env.SUPABASE_URL;
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

const tables = ['sheep', 'sheep_breeds', 'sheep_origins', 'sheep_dailys', 'sheep_lambing_records', 'sheep_comments', 'weigh_in_sessions', 'weigh_ins'];

(async () => {
  for (const t of tables) {
    const res = await fetch(`${URL}/rest/v1/${t}?select=*&limit=1`, {
      headers: { apikey: KEY, Authorization: `Bearer ${KEY}` },
    });
    const body = await res.text();
    const status = res.ok ? 'OK' : `HTTP ${res.status}`;
    const snippet = res.ok ? body.slice(0, 80) : body.slice(0, 200);
    console.log(`${t.padEnd(26)} ${status}   ${snippet}`);
  }
})();
