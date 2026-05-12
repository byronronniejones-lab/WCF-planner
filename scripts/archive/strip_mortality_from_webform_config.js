// One-time: strip s-mortality section from cattle-dailys in webform_config.full_config.
// Run with --commit to apply.
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
  const res = await fetch(`${URL}/rest/v1/webform_config?select=data&key=eq.full_config`, {headers: H});
  const rows = await res.json();
  if (!rows[0]) {
    console.log('No full_config row found.');
    return;
  }
  const cfg = rows[0].data;
  const before = JSON.stringify(cfg).length;
  const cattleWf = (cfg.webforms || []).find((w) => w.id === 'cattle-dailys');
  if (!cattleWf) {
    console.log('No cattle-dailys webform in config — nothing to do.');
    return;
  }
  const hadMort = (cattleWf.sections || []).some((s) => s.id === 's-mortality');
  if (!hadMort) {
    console.log('cattle-dailys already has no s-mortality section.');
    return;
  }
  cfg.webforms = cfg.webforms.map((w) => {
    if (w.id !== 'cattle-dailys') return w;
    return {...w, sections: (w.sections || []).filter((s) => s.id !== 's-mortality')};
  });
  console.log(`Would strip s-mortality. Size: ${before} -> ${JSON.stringify(cfg).length} bytes`);

  if (!process.argv.includes('--commit')) {
    console.log('(Preview only. Rerun with --commit to apply.)');
    return;
  }

  const u = await fetch(`${URL}/rest/v1/webform_config?key=eq.full_config`, {
    method: 'PATCH',
    headers: {...H, Prefer: 'return=minimal'},
    body: JSON.stringify({data: cfg}),
  });
  if (!u.ok) throw new Error(await u.text());
  console.log('✓ Stripped s-mortality from webform_config.full_config.');
})();
