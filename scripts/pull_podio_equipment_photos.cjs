// scripts/pull_podio_equipment_photos.cjs
//
// Second-pass Podio pull: fetches COMMENTS + FILE attachments for every
// item in the Equipment Maintenance app + every per-equipment fueling
// checklist app. Comments hold maintenance notes; files attached to items
// (+ to comments) are the maintenance photos Ronnie wants imported.
//
// Writes:
//   * scripts/podio_equipment_dump/photos/<file_id>/<safe_name>   (raw bytes)
//   * scripts/podio_equipment_dump/_photos_index.json              (manifest)
//
// Usage:
//   node scripts/pull_podio_equipment_photos.cjs             # downloads everything
//   node scripts/pull_podio_equipment_photos.cjs --upload    # also uploads to Supabase
//                                                              and creates rows in
//                                                              equipment_maintenance_events
//                                                              + updates equipment_fuelings.photos
//
// Requires scripts/.env with PODIO_CLIENT_ID/SECRET/USERNAME/PASSWORD +
// SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY.
//
// Respects Podio rate limits (5000 req/hr/user). Makes ~1 request per item
// for comments + 1 per file download. ~1,800 items in the dump => fits
// comfortably under the hourly limit but takes ~30 min to run.

const fs = require('fs');
const path = require('path');

const DUMP_DIR   = path.join(__dirname, 'podio_equipment_dump');
const PHOTOS_DIR = path.join(DUMP_DIR, 'photos');
const INDEX_PATH = path.join(DUMP_DIR, '_photos_index.json');
const UPLOAD = process.argv.includes('--upload');

// ───── env ───────────────────────────────────────────────────────────────────
function loadEnv() {
  const p = path.join(__dirname, '.env');
  if (!fs.existsSync(p)) return;
  for (const line of fs.readFileSync(p, 'utf8').split(/\r?\n/)) {
    const m = /^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*?)\s*$/.exec(line);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
}
loadEnv();

const CLIENT_ID     = process.env.PODIO_CLIENT_ID;
const CLIENT_SECRET = process.env.PODIO_CLIENT_SECRET;
const USERNAME      = process.env.PODIO_USERNAME;
const PASSWORD      = process.env.PODIO_PASSWORD;
if (!CLIENT_ID || !CLIENT_SECRET || !USERNAME || !PASSWORD) {
  console.error('Missing PODIO_* env vars in scripts/.env.');
  process.exit(1);
}

let sb = null;
if (UPLOAD) {
  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SERVICE_KEY  = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!SUPABASE_URL || !SERVICE_KEY) {
    console.error('--upload requires SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY in scripts/.env');
    process.exit(1);
  }
  const {createClient} = require('@supabase/supabase-js');
  sb = createClient(SUPABASE_URL, SERVICE_KEY, {auth:{persistSession:false}});
}

if (!fs.existsSync(PHOTOS_DIR)) fs.mkdirSync(PHOTOS_DIR, {recursive:true});

// ───── auth ────────────────────────────────────────────────────────────────
let ACCESS_TOKEN = null;
async function auth() {
  const body = new URLSearchParams({
    grant_type:    'password',
    client_id:     CLIENT_ID,
    client_secret: CLIENT_SECRET,
    username:      USERNAME,
    password:      PASSWORD,
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
  console.log(`✓ Authenticated as ${USERNAME}`);
}

async function api(pathname) {
  const url = pathname.startsWith('http') ? pathname : `https://api.podio.com${pathname}`;
  const res = await fetch(url, {headers: {Authorization: `OAuth2 ${ACCESS_TOKEN}`}});
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`GET ${pathname} → ${res.status}: ${body.slice(0,200)}`);
  }
  return res.json();
}
async function downloadBinary(fileId, destPath) {
  const url = `https://api.podio.com/file/${fileId}/raw`;
  const res = await fetch(url, {headers: {Authorization: `OAuth2 ${ACCESS_TOKEN}`}});
  if (!res.ok) throw new Error(`File ${fileId} download failed: ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  fs.writeFileSync(destPath, buf);
  return buf.length;
}
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// ───── gather + download ───────────────────────────────────────────────────
async function main() {
  await auth();

  const index = {pulled_at: new Date().toISOString(), entries: []};

  // Read the summary to figure out which apps to walk.
  const summary = JSON.parse(fs.readFileSync(path.join(DUMP_DIR, '_summary.json'), 'utf8'));
  const apps = summary.apps || [];

  for (const app of apps) {
    // For each app, read the items dump and walk items.
    const itemsFile = path.join(DUMP_DIR, `${app.app_id}.${app.slug}.items.json`);
    if (!fs.existsSync(itemsFile)) continue;
    const items = JSON.parse(fs.readFileSync(itemsFile, 'utf8'));
    console.log(`\n[${app.name}] ${items.length} items — scanning for files + comments...`);

    for (const item of items) {
      // 1. Files attached to the item itself (if any).
      let itemDetail;
      try {
        itemDetail = await api(`/item/${item.item_id}`);
      } catch (e) {
        console.error(`  ✗ item ${item.item_id}: ${e.message}`);
        continue;
      }
      const files = itemDetail.files || [];
      for (const f of files) {
        const safeName = (f.name || ('file-' + f.file_id)).replace(/[^a-zA-Z0-9._-]/g, '_');
        const destDir = path.join(PHOTOS_DIR, String(f.file_id));
        if (!fs.existsSync(destDir)) fs.mkdirSync(destDir, {recursive:true});
        const destPath = path.join(destDir, safeName);
        if (!fs.existsSync(destPath)) {
          try {
            const size = await downloadBinary(f.file_id, destPath);
            console.log(`  ↓ ${f.file_id} ${safeName} (${Math.round(size/1024)}KB)`);
            await sleep(60);
          } catch (e) {
            console.error(`  ✗ file ${f.file_id}: ${e.message}`);
            continue;
          }
        }
        index.entries.push({
          app_id: app.app_id,
          app_slug: app.slug,
          item_id: item.item_id,
          file_id: f.file_id,
          name: f.name,
          source: 'item_attachment',
          local_path: path.relative(__dirname, destPath),
          mime_type: f.mimetype || null,
          size: f.size || null,
        });
      }

      // 2. Comments on the item — each comment can carry files too.
      if (item.comment_count && item.comment_count > 0) {
        let comments;
        try {
          comments = await api(`/comment/item/${item.item_id}`);
        } catch (e) {
          console.error(`  ✗ comments ${item.item_id}: ${e.message}`);
          comments = [];
        }
        for (const c of comments) {
          const cFiles = c.files || [];
          for (const f of cFiles) {
            const safeName = (f.name || ('file-' + f.file_id)).replace(/[^a-zA-Z0-9._-]/g, '_');
            const destDir = path.join(PHOTOS_DIR, String(f.file_id));
            if (!fs.existsSync(destDir)) fs.mkdirSync(destDir, {recursive:true});
            const destPath = path.join(destDir, safeName);
            if (!fs.existsSync(destPath)) {
              try {
                const size = await downloadBinary(f.file_id, destPath);
                console.log(`  ↓ (cmt ${c.comment_id}) ${f.file_id} ${safeName} (${Math.round(size/1024)}KB)`);
                await sleep(60);
              } catch (e) {
                console.error(`  ✗ file ${f.file_id}: ${e.message}`);
                continue;
              }
            }
            index.entries.push({
              app_id: app.app_id,
              app_slug: app.slug,
              item_id: item.item_id,
              file_id: f.file_id,
              name: f.name,
              source: 'comment',
              comment_id: c.comment_id,
              comment_value: (c.value || '').slice(0, 2000),
              comment_date: c.created_on || null,
              comment_author: (c.created_by && c.created_by.name) || null,
              local_path: path.relative(__dirname, destPath),
              mime_type: f.mimetype || null,
              size: f.size || null,
            });
          }
        }
        await sleep(80);
      }
    }
  }

  fs.writeFileSync(INDEX_PATH, JSON.stringify(index, null, 2));
  console.log(`\n✓ ${index.entries.length} files cataloged. Manifest at ${INDEX_PATH}`);

  if (!UPLOAD) {
    console.log('\nPreview only. Rerun with --upload to push to Supabase.');
    return;
  }

  console.log('\n── Uploading to Supabase Storage + linking to Supabase rows ──');

  // Load the slug-to-equipment-id map (equipment already imported).
  const {data: eqRows, error: eqErr} = await sb.from('equipment').select('id,slug,podio_item_id');
  if (eqErr) { console.error('Could not load equipment:', eqErr); process.exit(1); }
  const eqByPodioId = new Map(eqRows.map(e => [e.podio_item_id, e]));

  // Also build a fueling lookup: fuelings by (source_app, podio_item_id).
  // We pull a narrow select since we only need to patch photos.
  const {data: fRows} = await sb.from('equipment_fuelings').select('id,podio_item_id,podio_source_app');
  const fuelByPodioId = new Map();
  for (const r of (fRows || [])) {
    if (r.podio_item_id != null) fuelByPodioId.set(r.podio_item_id, r);
  }

  // Group entries by (app_id, item_id) so we only create one maintenance
  // event per equipment/comment cluster rather than one per photo.
  const grouped = new Map();
  for (const e of index.entries) {
    const key = e.app_id + ':' + e.item_id + ':' + (e.comment_id || 'item');
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key).push(e);
  }

  let eventsCreated = 0;
  let photosUploaded = 0;
  let fuelingsPatched = 0;

  for (const [key, entries] of grouped) {
    const first = entries[0];
    // Determine target: equipment maintenance event vs fueling photo.
    const targetEq = eqByPodioId.get(first.item_id) || null;
    const targetFueling = fuelByPodioId.get(first.item_id) || null;

    if (!targetEq && !targetFueling) {
      // Orphan — item isn't in our registry. Skip.
      continue;
    }

    // Upload each file to the bucket and collect URLs.
    const uploaded = [];
    for (const e of entries) {
      const localPath = path.join(__dirname, e.local_path);
      if (!fs.existsSync(localPath)) continue;
      const content = fs.readFileSync(localPath);
      const bucketPath = (targetEq ? 'maintenance' : 'fueling') + '/' + (targetEq?.slug || 'unknown') + '/' + e.file_id + '-' + path.basename(e.local_path);
      const {error: upErr} = await sb.storage.from('equipment-maintenance-docs').upload(bucketPath, content, {
        upsert: false,
        contentType: e.mime_type || 'application/octet-stream',
      });
      if (upErr && !/already exists/i.test(upErr.message || '')) {
        console.error('  ✗ upload', bucketPath, upErr.message);
        continue;
      }
      const {data: pub} = sb.storage.from('equipment-maintenance-docs').getPublicUrl(bucketPath);
      uploaded.push({name: e.name, path: bucketPath, url: pub.publicUrl, uploadedAt: new Date().toISOString(), podio_file_id: e.file_id});
      photosUploaded++;
    }
    if (uploaded.length === 0) continue;

    if (targetEq) {
      // Create a maintenance event row for this equipment, anchored to the
      // comment's date if we have one, else today.
      const eventDate = (first.comment_date || '').slice(0, 10) || new Date().toISOString().slice(0, 10);
      const id = 'emev-podio-' + first.item_id + '-' + (first.comment_id || 'itemfiles');
      const rec = {
        id,
        equipment_id: targetEq.id,
        event_date: eventDate,
        event_type: 'other',
        title: first.comment_id ? 'Podio comment' : 'Podio item attachments',
        description: first.comment_value || null,
        photos: uploaded,
        team_member: first.comment_author || null,
      };
      const {error: insErr} = await sb.from('equipment_maintenance_events').upsert(rec, {onConflict:'id'});
      if (insErr) console.error('  ✗ event insert', insErr.message);
      else eventsCreated++;
    } else if (targetFueling) {
      // Patch equipment_fuelings.photos for this specific fueling row.
      const {error: upErr} = await sb.from('equipment_fuelings').update({photos: uploaded}).eq('id', targetFueling.id);
      if (upErr) console.error('  ✗ fueling patch', upErr.message);
      else fuelingsPatched++;
    }
  }

  console.log(`\n✓ Uploads done: ${photosUploaded} photos, ${eventsCreated} maintenance events, ${fuelingsPatched} fuelings patched.`);
}

main().catch(e => { console.error(e); process.exit(1); });
