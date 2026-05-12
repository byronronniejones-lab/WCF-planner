const fs = require('fs'),
  path = require('path');
for (const l of fs.readFileSync(path.join(__dirname, '.env'), 'utf8').split(/\r?\n/)) {
  const m = /^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*?)\s*$/.exec(l);
  if (m) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
}
(async () => {
  const URL = process.env.SUPABASE_URL,
    KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
  async function fetchAll(path) {
    let all = [],
      from = 0;
    while (true) {
      const res = await fetch(`${URL}/rest/v1/${path}&limit=1000&offset=${from}`, {
        headers: {apikey: KEY, Authorization: `Bearer ${KEY}`},
      });
      const d = await res.json();
      all = all.concat(d);
      if (d.length < 1000) break;
      from += 1000;
    }
    return all;
  }
  const sessions = await fetchAll('weigh_in_sessions?select=id,date,herd,species,notes,team_member&species=eq.cattle&');
  const weighIns = await fetchAll('weigh_ins?select=id,session_id,weight&');
  const countBySess = {};
  for (const w of weighIns) countBySess[w.session_id] = (countBySess[w.session_id] || 0) + 1;
  const zeroEntry = sessions.filter((s) => !countBySess[s.id]);
  const oneEntry = sessions.filter((s) => countBySess[s.id] === 1);
  console.log('Total cattle sessions:', sessions.length);
  console.log('Sessions with 0 entries:', zeroEntry.length);
  console.log('Sessions with 1 entry:', oneEntry.length);
  // Break down by type
  const rcv = sessions.filter((s) => (s.id || '').startsWith('wsess-rcv-'));
  const imp = sessions.filter((s) => (s.id || '').startsWith('wsess-imp-'));
  const other = sessions.filter(
    (s) => !(s.id || '').startsWith('wsess-rcv-') && !(s.id || '').startsWith('wsess-imp-'),
  );
  console.log('  of which receiving-weight (wsess-rcv-*):', rcv.length);
  console.log('  of which imported-podio (wsess-imp-*):', imp.length);
  console.log('  of which other (manual):', other.length);
  if (zeroEntry.length) {
    console.log('\nSample zero-entry sessions:');
    zeroEntry.slice(0, 5).forEach((s) => console.log(' ', s.id, s.date, s.notes));
  }
})();
