// scripts/pull_podio_equipment.cjs
//
// One-shot bulk exporter for the Podio "Equipment" workspace.
// Pulls every app in the space, every item, field definitions, and writes
// JSON files under scripts/podio_equipment_dump/ for downstream analysis
// and the Equipment module schema design.
//
// Usage:
//   1. Fill in scripts/.env (see README block below).
//   2. node scripts/pull_podio_equipment.cjs
//
// scripts/.env additions:
//   PODIO_CLIENT_ID=...          # from https://podio.com/settings/api
//   PODIO_CLIENT_SECRET=...
//   PODIO_USERNAME=...           # your Podio login email
//   PODIO_PASSWORD=...
//   PODIO_SPACE_NAME=Equipment   # name of the workspace
//
// Output (scripts/podio_equipment_dump/):
//   _summary.json                # apps found, item counts, timestamps
//   <app_id>.<slug>.config.json  # Podio app config: fields, views, etc.
//   <app_id>.<slug>.items.json   # all items (paginated fully)
//
// Respects Podio rate limits (5000 req/hr per user, 100 per app/day for
// filtered item reads). Uses filter endpoint with limit=500, paginates.

const fs = require('fs');
const path = require('path');

// ───── env ──────────────────────────────────────────────────────────────────
function loadEnv() {
  const p = path.join(__dirname, '.env');
  if (!fs.existsSync(p)) return;
  for (const line of fs.readFileSync(p, 'utf8').split(/\r?\n/)) {
    const m = /^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*?)\s*$/.exec(line);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
}
loadEnv();

const CLIENT_ID = process.env.PODIO_CLIENT_ID;
const CLIENT_SECRET = process.env.PODIO_CLIENT_SECRET;
const USERNAME = process.env.PODIO_USERNAME;
const PASSWORD = process.env.PODIO_PASSWORD;
const SPACE_NAME = process.env.PODIO_SPACE_NAME || 'Equipment';

if (!CLIENT_ID || !CLIENT_SECRET || !USERNAME || !PASSWORD) {
  console.error('Missing PODIO_* env vars in scripts/.env. See file header for required keys.');
  process.exit(1);
}

// ───── fetch helpers ───────────────────────────────────────────────────────
let ACCESS_TOKEN = null;

async function auth() {
  const body = new URLSearchParams({
    grant_type: 'password',
    client_id: CLIENT_ID,
    client_secret: CLIENT_SECRET,
    username: USERNAME,
    password: PASSWORD,
  });
  const res = await fetch('https://podio.com/oauth/token', {
    method: 'POST',
    headers: {'Content-Type': 'application/x-www-form-urlencoded'},
    body: body.toString(),
  });
  const data = await res.json();
  if (!res.ok || !data.access_token) {
    console.error('Auth failed:', JSON.stringify(data, null, 2));
    process.exit(1);
  }
  ACCESS_TOKEN = data.access_token;
  console.log(`✓ Authenticated as ${USERNAME} (token expires in ${data.expires_in}s)`);
}

async function api(pathname, opts = {}) {
  const url = pathname.startsWith('http') ? pathname : `https://api.podio.com${pathname}`;
  const res = await fetch(url, {
    method: opts.method || 'GET',
    headers: {
      Authorization: `OAuth2 ${ACCESS_TOKEN}`,
      'Content-Type': 'application/json',
      ...(opts.headers || {}),
    },
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  const text = await res.text();
  let data;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }
  if (!res.ok) {
    throw new Error(
      `API ${res.status} ${pathname}: ${typeof data === 'string' ? data.slice(0, 300) : JSON.stringify(data).slice(0, 300)}`,
    );
  }
  return data;
}

function slugify(s) {
  return (
    String(s || '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 40) || 'untitled'
  );
}

// ───── main ────────────────────────────────────────────────────────────────
(async () => {
  const outDir = path.join(__dirname, 'podio_equipment_dump');
  fs.mkdirSync(outDir, {recursive: true});

  await auth();

  // 1. Find organizations the user belongs to
  const orgs = await api('/org/');
  console.log(`Orgs accessible: ${orgs.length}`);

  // 2. Find the Equipment space across all orgs
  let targetSpace = null;
  for (const org of orgs) {
    for (const sp of org.spaces || []) {
      if (sp.name === SPACE_NAME || sp.name.toLowerCase() === SPACE_NAME.toLowerCase()) {
        targetSpace = sp;
        console.log(`✓ Matched space "${sp.name}" (id=${sp.space_id || sp.id}) in org "${org.name}"`);
        break;
      }
    }
    if (targetSpace) break;
  }
  if (!targetSpace) {
    console.error(`No space named "${SPACE_NAME}" found. Available:`);
    for (const org of orgs) {
      console.error(`  org="${org.name}": ` + (org.spaces || []).map((s) => s.name).join(', '));
    }
    process.exit(1);
  }
  const spaceId = targetSpace.space_id || targetSpace.id;

  // 3. List apps in the space
  const apps = await api(`/app/space/${spaceId}/`);
  console.log(`\nApps in "${SPACE_NAME}" space: ${apps.length}`);
  apps.forEach((a) => console.log(`  [${a.app_id}] ${a.config?.name || a.name || '(unnamed)'}`));

  // 4. For each app, pull config + all items
  const summary = {
    pulled_at: new Date().toISOString(),
    space: {id: spaceId, name: targetSpace.name},
    apps: [],
  };
  for (const app of apps) {
    const appId = app.app_id;
    const name = app.config?.name || app.name || 'untitled';
    const slug = slugify(name);
    console.log(`\n── App: ${name} (id=${appId}) ──`);

    // 4a. Full app config (fields, relations, views, etc.)
    const cfg = await api(`/app/${appId}`);
    fs.writeFileSync(path.join(outDir, `${appId}.${slug}.config.json`), JSON.stringify(cfg, null, 2));
    console.log(`  config saved: ${cfg.fields?.length || 0} fields`);

    // 4b. All items, paginated (500/page max)
    const allItems = [];
    const limit = 500;
    let offset = 0;
    while (true) {
      const page = await api(`/item/app/${appId}/filter/`, {
        method: 'POST',
        body: {limit, offset, sort_by: 'created_on', sort_desc: false},
      });
      const items = page.items || [];
      allItems.push(...items);
      if (items.length < limit || allItems.length >= (page.total || 0)) break;
      offset += limit;
      console.log(`  paged: ${allItems.length} / ${page.total}`);
    }
    fs.writeFileSync(path.join(outDir, `${appId}.${slug}.items.json`), JSON.stringify(allItems, null, 2));
    console.log(`  items saved: ${allItems.length}`);

    summary.apps.push({
      app_id: appId,
      name,
      slug,
      field_count: cfg.fields?.length || 0,
      item_count: allItems.length,
    });
  }

  fs.writeFileSync(path.join(outDir, '_summary.json'), JSON.stringify(summary, null, 2));
  console.log(`\n✓ Done. Dumped ${summary.apps.length} apps to ${outDir}`);
  console.log(`  Total items: ${summary.apps.reduce((s, a) => s + a.item_count, 0)}`);
})().catch((e) => {
  console.error('\nERROR:', e.message);
  process.exit(1);
});
