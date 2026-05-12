const fs = require('fs');
const path = require('path');
const envPath = path.join(__dirname, '.env');
for (const line of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
  const m = /^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*?)\s*$/.exec(line);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
}
const URL = process.env.SUPABASE_URL;
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

async function count(q) {
  const res = await fetch(`${URL}/rest/v1/${q}&select=*`, {
    headers: {apikey: KEY, Authorization: `Bearer ${KEY}`, Prefer: 'count=exact', Range: '0-0'},
  });
  const cr = res.headers.get('content-range');
  return cr ? cr.split('/')[1] : 'unknown';
}
async function row(q) {
  const res = await fetch(`${URL}/rest/v1/${q}`, {
    headers: {apikey: KEY, Authorization: `Bearer ${KEY}`},
  });
  return await res.json();
}

(async () => {
  console.log('=== Sheep import verification ===\n');

  console.log('Counts:');
  console.log(`  sheep:                 ${await count('sheep?select=id')}`);
  console.log(`  sheep (ewes):          ${await count('sheep?flock=eq.ewes')}`);
  console.log(`  sheep (processed):     ${await count('sheep?flock=eq.processed')}`);
  console.log(`  sheep (deceased):      ${await count('sheep?flock=eq.deceased')}`);
  console.log(`  sheep (sold):          ${await count('sheep?flock=eq.sold')}`);
  console.log(`  sheep_origins:         ${await count('sheep_origins?select=id')}`);
  console.log(`  sheep_lambing_records: ${await count('sheep_lambing_records?select=id')}`);
  console.log(`  weigh_in_sessions (species=sheep): ${await count('weigh_in_sessions?species=eq.sheep')}`);
  console.log(`  weigh_ins (via sheep sessions): ${await count('weigh_ins?session_id=like.wsess-imp-sheep-*')}`);
  console.log(`  sheep_dailys:          ${await count('sheep_dailys?select=id')}`);
  console.log(`  sheep_dailys (ewes):   ${await count('sheep_dailys?flock=eq.ewes')}`);
  console.log(`  sheep_dailys (rams):   ${await count('sheep_dailys?flock=eq.rams')}`);
  console.log(`  sheep_dailys (feeders):${await count('sheep_dailys?flock=eq.feeders')}`);

  console.log('\nSample new lambs:');
  const newOnes = await row(
    'sheep?id=like.sheep-new-%25&select=tag,sex,flock,breed,origin,purchase_date,purchase_amount&order=tag',
  );
  newOnes.forEach((s) =>
    console.log(
      `  tag="${s.tag}" sex=${s.sex} flock=${s.flock} breed=${s.breed} origin=${s.origin} $${s.purchase_amount}`,
    ),
  );

  console.log('\nSample historical weigh-in (tag 55):');
  const w55 = await row('weigh_ins?tag=eq.55&select=tag,weight,session_id,note');
  w55.forEach((w) => console.log(`  tag=${w.tag} weight=${w.weight} session=${w.session_id}`));

  console.log('\nSample lambing record:');
  const lr = await row('sheep_lambing_records?select=dam_tag,lambing_date,lamb_tag&order=lambing_date.desc&limit=3');
  lr.forEach((l) => console.log(`  dam=${l.dam_tag} → lamb=${l.lamb_tag} (${l.lambing_date})`));

  console.log('\nDate range of sheep_dailys:');
  const first = await row('sheep_dailys?select=date&order=date.asc&limit=1');
  const last = await row('sheep_dailys?select=date&order=date.desc&limit=1');
  console.log(`  earliest: ${first[0]?.date}   latest: ${last[0]?.date}`);
})();
