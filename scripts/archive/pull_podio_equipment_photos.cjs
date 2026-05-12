// scripts/pull_podio_equipment_photos.cjs
//
// Second-pass Podio pull: fetches COMMENTS + FILE attachments for every
// item in the Equipment Maintenance app + every per-equipment fueling
// checklist app. Comments hold maintenance notes; files attached to items
// (+ to comments) are the maintenance photos Ronnie wants imported.
//
// Writes:
//   * scripts/podio_equipment_dump/photos/<file_id>/<safe_name>       (raw bytes)
//   * scripts/podio_equipment_dump/_photos_index.json                  (final manifest)
//   * scripts/podio_equipment_dump/_photos_pull_cursor.json            (resume cursor,
//                                                                       deleted on full
//                                                                       completion)
//
// Usage:
//   node scripts/pull_podio_equipment_photos.cjs             # download (resumable)
//   node scripts/pull_podio_equipment_photos.cjs --upload    # download (resumable)
//                                                              then upload to Supabase
//
// Rate-limit behavior (Podio allows 5000 req/hr/user):
//   * Proactive throttle target 4000 req/hr (20% headroom). Sliding 1hr window.
//   * Per-item cursor write so interrupts / 420s / Ctrl+C all resume cleanly.
//   * On HTTP 420, save cursor, log the reset time, exit code 2. Rerun to resume.
//
// Requires scripts/.env with PODIO_CLIENT_ID/SECRET/USERNAME/PASSWORD +
// SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY.

const fs = require('fs');
const path = require('path');

const DUMP_DIR = path.join(__dirname, 'podio_equipment_dump');
const PHOTOS_DIR = path.join(DUMP_DIR, 'photos');
const INDEX_PATH = path.join(DUMP_DIR, '_photos_index.json');
const CURSOR_PATH = path.join(DUMP_DIR, '_photos_pull_cursor.json');
const UPLOAD = process.argv.includes('--upload');

const HOURLY_BUDGET = 4000; // keep 20% headroom under Podio's 5000/hr
const WINDOW_MS = 3600 * 1000;
const HEADER_MIN_REMAINING = 100; // pause if Podio reports we're this close

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

const CLIENT_ID = process.env.PODIO_CLIENT_ID;
const CLIENT_SECRET = process.env.PODIO_CLIENT_SECRET;
const USERNAME = process.env.PODIO_USERNAME;
const PASSWORD = process.env.PODIO_PASSWORD;
if (!CLIENT_ID || !CLIENT_SECRET || !USERNAME || !PASSWORD) {
  console.error('Missing PODIO_* env vars in scripts/.env.');
  process.exit(1);
}

let sb = null;
if (UPLOAD) {
  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!SUPABASE_URL || !SERVICE_KEY) {
    console.error('--upload requires SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY in scripts/.env');
    process.exit(1);
  }
  const {createClient} = require('@supabase/supabase-js');
  sb = createClient(SUPABASE_URL, SERVICE_KEY, {auth: {persistSession: false}});
}

if (!fs.existsSync(PHOTOS_DIR)) fs.mkdirSync(PHOTOS_DIR, {recursive: true});

// ───── cursor (resume state) ─────────────────────────────────────────────────
// Shape:
//   {
//     started_at, last_updated_at,
//     completed_apps: [app_id, ...],         // fully walked
//     current_app:    app_id | null,         // mid-walk
//     last_completed_item_index: number,     // resume past this index in current_app
//     entries: [...manifest rows accumulated so far...]
//   }
function loadCursor() {
  if (!fs.existsSync(CURSOR_PATH)) return null;
  try {
    return JSON.parse(fs.readFileSync(CURSOR_PATH, 'utf8'));
  } catch (e) {
    console.error(`Could not parse cursor (${e.message}). Ignoring and starting fresh.`);
    return null;
  }
}
function atomicWrite(destPath, content) {
  const tmp = destPath + '.tmp';
  fs.writeFileSync(tmp, content);
  fs.renameSync(tmp, destPath);
}
function saveCursor(cursor) {
  cursor.last_updated_at = new Date().toISOString();
  atomicWrite(CURSOR_PATH, JSON.stringify(cursor, null, 2));
}
function clearCursor() {
  if (fs.existsSync(CURSOR_PATH)) fs.unlinkSync(CURSOR_PATH);
}

// ───── rate limit plumbing ───────────────────────────────────────────────────
class RateLimitError extends Error {
  constructor(waitSec, detail) {
    super(`Podio 420 rate limit — wait ${waitSec}s${detail ? ` (${detail})` : ''}`);
    this.waitSec = waitSec;
  }
}

const reqTimes = []; // timestamps of every Podio-bound HTTP call (incl. token + file/raw)
let lastRemainingSeen = null;

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function throttleBeforeCall() {
  const now = Date.now();
  const cutoff = now - WINDOW_MS;
  while (reqTimes.length && reqTimes[0] < cutoff) reqTimes.shift();

  // Proactive: if we're at the self-imposed budget, wait for the oldest entry
  // in the window to age out.
  if (reqTimes.length >= HOURLY_BUDGET) {
    const waitMs = reqTimes[0] + WINDOW_MS - now + 500;
    console.log(
      `  ⏸  proactive throttle: sleeping ${Math.round(waitMs / 1000)}s (window full at ${reqTimes.length}/${HOURLY_BUDGET})`,
    );
    await sleep(Math.max(waitMs, 1000));
  }
  // Reactive: if Podio's own X-Rate-Limit-Remaining header says we're near
  // empty, bail cleanly and let the user wait for the window to roll over.
  // (Podio's accounting can include prior-session quota that hasn't aged out
  // yet — sleeping 60s at a time just dribbles forward at 1 req/min, which
  // is useless. Better to exit, wait an hour, resume with a fresh budget.)
  if (lastRemainingSeen != null && lastRemainingSeen < HEADER_MIN_REMAINING) {
    throw new RateLimitError(3600, `Podio reports ${lastRemainingSeen} requests remaining in the hourly window`);
  }
}
function recordCall() {
  reqTimes.push(Date.now());
}

function readRateHeaders(res) {
  // Podio docs describe X-Rate-Limit-Remaining / X-Rate-Limit-Limit. Not
  // always present on every response, but when they are, use them.
  const rem = res.headers.get('x-rate-limit-remaining') || res.headers.get('X-Rate-Limit-Remaining');
  if (rem != null && rem !== '') {
    const n = Number(rem);
    if (Number.isFinite(n)) lastRemainingSeen = n;
  }
}

function parse420Wait(bodyText) {
  // Typical body: "420 You have hit the rate limit. Please wait 3600 seconds"
  // or JSON: {"error_description":"You have hit the rate limit. Please wait 3600 seconds"}
  const m = /wait\s+(\d+)\s*seconds/i.exec(bodyText || '');
  return m ? Number(m[1]) : 3600;
}

// ───── auth ────────────────────────────────────────────────────────────────
let ACCESS_TOKEN = null;
async function auth() {
  await throttleBeforeCall();
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
  recordCall();
  readRateHeaders(res);
  const text = await res.text();
  if (res.status === 420) throw new RateLimitError(parse420Wait(text), 'auth');
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    data = {};
  }
  if (!res.ok || !data.access_token) {
    console.error('Auth failed:', text.slice(0, 500));
    process.exit(1);
  }
  ACCESS_TOKEN = data.access_token;
  console.log(`✓ Authenticated as ${USERNAME}`);
}

async function api(pathname) {
  await throttleBeforeCall();
  const url = pathname.startsWith('http') ? pathname : `https://api.podio.com${pathname}`;
  const res = await fetch(url, {headers: {Authorization: `OAuth2 ${ACCESS_TOKEN}`}});
  recordCall();
  readRateHeaders(res);
  if (res.status === 420) {
    const body = await res.text();
    throw new RateLimitError(parse420Wait(body), `GET ${pathname}`);
  }
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`GET ${pathname} → ${res.status}: ${body.slice(0, 200)}`);
  }
  return res.json();
}

async function downloadBinary(fileId, destPath) {
  await throttleBeforeCall();
  const url = `https://api.podio.com/file/${fileId}/raw`;
  const res = await fetch(url, {headers: {Authorization: `OAuth2 ${ACCESS_TOKEN}`}});
  recordCall();
  readRateHeaders(res);
  if (res.status === 420) {
    const body = await res.text();
    throw new RateLimitError(parse420Wait(body), `file/${fileId}/raw`);
  }
  if (!res.ok) throw new Error(`File ${fileId} download failed: ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  fs.writeFileSync(destPath, buf);
  return buf.length;
}

// ───── gather + download ───────────────────────────────────────────────────
async function main() {
  // Fast-path: download already complete (cursor cleared, manifest on disk).
  // Skip straight to upload if --upload, otherwise nothing to do.
  if (!fs.existsSync(CURSOR_PATH) && fs.existsSync(INDEX_PATH)) {
    const index = JSON.parse(fs.readFileSync(INDEX_PATH, 'utf8'));
    console.log(`✓ Prior download complete — ${index.entries.length} entries in ${INDEX_PATH}.`);
    if (!UPLOAD) {
      console.log('Nothing to download. Rerun with --upload to push to Supabase.');
      return;
    }
    await doUpload(index);
    return;
  }

  // Load resume cursor if present.
  const prior = loadCursor();
  const cursor = prior || {
    started_at: new Date().toISOString(),
    last_updated_at: new Date().toISOString(),
    completed_apps: [],
    current_app: null,
    last_completed_item_index: -1,
    entries: [],
  };
  if (prior) {
    console.log(
      `↻ Resuming from cursor — ${prior.completed_apps.length} apps complete, ` +
        `current app ${prior.current_app || '(none)'} at item index ${prior.last_completed_item_index}, ` +
        `${prior.entries.length} entries already cataloged.`,
    );
  }

  await auth();

  const summary = JSON.parse(fs.readFileSync(path.join(DUMP_DIR, '_summary.json'), 'utf8'));
  const apps = summary.apps || [];
  const completed = new Set(cursor.completed_apps);

  for (const app of apps) {
    if (completed.has(app.app_id)) {
      console.log(`[${app.name}] ✓ already complete, skipping`);
      continue;
    }

    const itemsFile = path.join(DUMP_DIR, `${app.app_id}.${app.slug}.items.json`);
    if (!fs.existsSync(itemsFile)) {
      // Nothing to walk — mark complete so we don't revisit.
      cursor.completed_apps.push(app.app_id);
      cursor.current_app = null;
      cursor.last_completed_item_index = -1;
      saveCursor(cursor);
      continue;
    }
    const items = JSON.parse(fs.readFileSync(itemsFile, 'utf8'));

    // Resume-in-the-middle-of-this-app support.
    let startIdx = 0;
    if (cursor.current_app === app.app_id) {
      startIdx = cursor.last_completed_item_index + 1;
    } else {
      cursor.current_app = app.app_id;
      cursor.last_completed_item_index = -1;
    }
    console.log(`\n[${app.name}] ${items.length} items — scanning from index ${startIdx}...`);

    for (let i = startIdx; i < items.length; i++) {
      const item = items[i];

      // 1. Files attached to the item itself.
      let itemDetail;
      try {
        itemDetail = await api(`/item/${item.item_id}`);
      } catch (e) {
        if (e instanceof RateLimitError) throw e;
        console.error(`  ✗ item ${item.item_id}: ${e.message}`);
        cursor.last_completed_item_index = i;
        saveCursor(cursor);
        continue;
      }
      const files = itemDetail.files || [];
      for (const f of files) {
        const safeName = (f.name || 'file-' + f.file_id).replace(/[^a-zA-Z0-9._-]/g, '_');
        const destDir = path.join(PHOTOS_DIR, String(f.file_id));
        if (!fs.existsSync(destDir)) fs.mkdirSync(destDir, {recursive: true});
        const destPath = path.join(destDir, safeName);
        if (!fs.existsSync(destPath)) {
          try {
            const size = await downloadBinary(f.file_id, destPath);
            console.log(`  ↓ ${f.file_id} ${safeName} (${Math.round(size / 1024)}KB)`);
          } catch (e) {
            if (e instanceof RateLimitError) throw e;
            console.error(`  ✗ file ${f.file_id}: ${e.message}`);
            continue;
          }
        }
        cursor.entries.push({
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
          if (e instanceof RateLimitError) throw e;
          console.error(`  ✗ comments ${item.item_id}: ${e.message}`);
          comments = [];
        }
        for (const c of comments) {
          const cFiles = c.files || [];
          for (const f of cFiles) {
            const safeName = (f.name || 'file-' + f.file_id).replace(/[^a-zA-Z0-9._-]/g, '_');
            const destDir = path.join(PHOTOS_DIR, String(f.file_id));
            if (!fs.existsSync(destDir)) fs.mkdirSync(destDir, {recursive: true});
            const destPath = path.join(destDir, safeName);
            if (!fs.existsSync(destPath)) {
              try {
                const size = await downloadBinary(f.file_id, destPath);
                console.log(`  ↓ (cmt ${c.comment_id}) ${f.file_id} ${safeName} (${Math.round(size / 1024)}KB)`);
              } catch (e) {
                if (e instanceof RateLimitError) throw e;
                console.error(`  ✗ file ${f.file_id}: ${e.message}`);
                continue;
              }
            }
            cursor.entries.push({
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
      }

      // Per-item checkpoint.
      cursor.last_completed_item_index = i;
      saveCursor(cursor);

      // Low-noise progress every 50 items.
      if ((i + 1) % 50 === 0) {
        console.log(
          `    · ${i + 1}/${items.length} items, ${cursor.entries.length} entries, ${reqTimes.length} reqs in last hour`,
        );
      }
    }

    // App complete.
    cursor.completed_apps.push(app.app_id);
    cursor.current_app = null;
    cursor.last_completed_item_index = -1;
    saveCursor(cursor);
    console.log(`[${app.name}] ✓ done`);
  }

  // Download phase done — write final manifest, drop cursor.
  const index = {pulled_at: new Date().toISOString(), entries: cursor.entries};
  fs.writeFileSync(INDEX_PATH, JSON.stringify(index, null, 2));
  clearCursor();
  console.log(`\n✓ ${index.entries.length} files cataloged. Manifest at ${INDEX_PATH}`);

  if (!UPLOAD) {
    console.log('\nPreview only. Rerun with --upload to push to Supabase.');
    return;
  }

  await doUpload(index);
}

// ───── upload ──────────────────────────────────────────────────────────────
async function doUpload(index) {
  console.log('\n── Uploading to Supabase Storage + linking to Supabase rows ──');

  // Load the slug-to-equipment-id map (equipment already imported).
  const {data: eqRows, error: eqErr} = await sb.from('equipment').select('id,slug,podio_item_id');
  if (eqErr) {
    console.error('Could not load equipment:', eqErr);
    process.exit(1);
  }
  const eqByPodioId = new Map(eqRows.map((e) => [e.podio_item_id, e]));

  // Also build a fueling lookup: fuelings by (source_app, podio_item_id).
  // We pull a narrow select since we only need to patch photos.
  const {data: fRows} = await sb.from('equipment_fuelings').select('id,podio_item_id,podio_source_app');
  const fuelByPodioId = new Map();
  for (const r of fRows || []) {
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
      const bucketPath =
        (targetEq ? 'maintenance' : 'fueling') +
        '/' +
        (targetEq?.slug || 'unknown') +
        '/' +
        e.file_id +
        '-' +
        path.basename(e.local_path);
      const {error: upErr} = await sb.storage.from('equipment-maintenance-docs').upload(bucketPath, content, {
        upsert: false,
        contentType: e.mime_type || 'application/octet-stream',
      });
      if (upErr && !/already exists/i.test(upErr.message || '')) {
        console.error('  ✗ upload', bucketPath, upErr.message);
        continue;
      }
      const {data: pub} = sb.storage.from('equipment-maintenance-docs').getPublicUrl(bucketPath);
      uploaded.push({
        name: e.name,
        path: bucketPath,
        url: pub.publicUrl,
        uploadedAt: new Date().toISOString(),
        podio_file_id: e.file_id,
      });
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
      const {error: insErr} = await sb.from('equipment_maintenance_events').upsert(rec, {onConflict: 'id'});
      if (insErr) console.error('  ✗ event insert', insErr.message);
      else eventsCreated++;
    } else if (targetFueling) {
      // Patch equipment_fuelings.photos for this specific fueling row.
      const {error: upErr} = await sb.from('equipment_fuelings').update({photos: uploaded}).eq('id', targetFueling.id);
      if (upErr) console.error('  ✗ fueling patch', upErr.message);
      else fuelingsPatched++;
    }
  }

  console.log(
    `\n✓ Uploads done: ${photosUploaded} photos, ${eventsCreated} maintenance events, ${fuelingsPatched} fuelings patched.`,
  );
}

// ───── top-level ───────────────────────────────────────────────────────────
main().catch((e) => {
  if (e instanceof RateLimitError) {
    const resetAt = new Date(Date.now() + e.waitSec * 1000);
    console.error(`\n⏸  Podio rate-limited: wait ~${e.waitSec}s (until ${resetAt.toLocaleTimeString()}).`);
    console.error(`   Cursor saved at ${CURSOR_PATH}. Re-run the same command after the window clears to resume.`);
    process.exit(2);
  }
  console.error(e);
  process.exit(1);
});
