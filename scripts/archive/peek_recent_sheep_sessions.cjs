// Read-only peek at the 5 most recent sheep weigh-in sessions.
const fs = require('fs');
const path = require('path');
function loadEnv() {
  const p = path.join(__dirname, '.env');
  if (!fs.existsSync(p)) return;
  for (const line of fs.readFileSync(p, 'utf8').split(/\r?\n/)) {
    const m = /^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*?)\s*$/.exec(line);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
}
loadEnv();
(async () => {
  const {createClient} = require('@supabase/supabase-js');
  const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: {persistSession: false},
  });
  const {data, error} = await sb
    .from('weigh_in_sessions')
    .select('id,date,started_at,status,herd,team_member')
    .eq('species', 'sheep')
    .order('started_at', {ascending: false})
    .limit(5);
  if (error) {
    console.error(error);
    process.exit(1);
  }
  for (const s of data || []) {
    console.log(`  date=${s.date}  herd=${s.herd}  status=${s.status}  team=${s.team_member}  id=${s.id}`);
  }
})();
