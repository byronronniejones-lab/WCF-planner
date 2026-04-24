// Takes the 33 PDFs already pulled from Podio's Equipment Maintenance app
// (photos/<file_id>/<filename> on disk from the photo-pull run) and
// uploads them to Supabase Storage, then attaches them to the
// corresponding equipment row's `manuals` or `documents` JSONB.
//
// Splits by filename:
//   - manuals   (operator-facing, shown on /fueling + /equipment):
//       OPERATORS MANUAL, OWNER'S MANUAL, SERVICE INTERVALS, FILTERS,
//       PARTS MANUAL, MAINTENANCE INTERVALS, OIL TEST, CAPACITIES
//   - documents (admin-only):
//       PURCHASE DOCUMENTS, TERMS AND CONDITIONS, PLAN SUMMARY,
//       WARRANTY, CONTRACT, INVOICE
//
// Requires migration 025 applied (adds equipment.documents column).
// Uses the cursor file produced by pull_podio_equipment_photos.cjs.
//
// Usage:
//   node scripts/patch_upload_equipment_documents.cjs           # preview
//   node scripts/patch_upload_equipment_documents.cjs --commit  # upload + link
// Idempotent (skips storage paths that already exist; upsert on equipment).

const fs = require('fs');
const path = require('path');

const COMMIT = process.argv.includes('--commit');
const DUMP_DIR = path.join(__dirname, 'podio_equipment_dump');
const PHOTOS_DIR = path.join(DUMP_DIR, 'photos');
const CURSOR_PATH = path.join(DUMP_DIR, '_photos_pull_cursor.json');

function loadEnv() {
  const p = path.join(__dirname, '.env');
  if (!fs.existsSync(p)) return;
  for (const line of fs.readFileSync(p, 'utf8').split(/\r?\n/)) {
    const m = /^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*?)\s*$/.exec(line);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
}
loadEnv();

const {createClient} = require('@supabase/supabase-js');
const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {auth:{persistSession:false}});

// Returns 'manuals' or 'documents' based on filename keywords.
function classify(filename) {
  const f = String(filename || '').toLowerCase();
  // Admin-only paperwork first — those should win when keywords overlap.
  if (/purchase|terms|conditions|plan.?summary|warranty.*note|contract|invoice|bill.?of.?sale/i.test(f)) return 'documents';
  // Operator-facing reference material.
  if (/operator|owner|service.*interval|maintenance.*interval|parts|filter|oil.*test|capacit/i.test(f)) return 'manuals';
  // Default to manuals (safer — operators can always see the doc).
  return 'manuals';
}

function prettyTitle(filename) {
  return String(filename || '').replace(/\.[^.]+$/, '').replace(/[_-]+/g, ' ').replace(/\s+/g, ' ').trim();
}

(async () => {
  if (!fs.existsSync(CURSOR_PATH)) {
    console.error('No cursor file found. Run pull_podio_equipment_photos.cjs first.');
    process.exit(1);
  }
  const cursor = JSON.parse(fs.readFileSync(CURSOR_PATH, 'utf8'));
  const eqAppEntries = (cursor.entries || []).filter(e => e.app_id === 29670695); // Equipment Maintenance app
  console.log(`${eqAppEntries.length} files cataloged from Equipment Maintenance.`);

  let {data: eqs, error: selErr} = await sb.from('equipment').select('id,slug,name,podio_item_id,manuals,documents');
  let docsAvailable = true;
  if (selErr && /column.*documents/i.test(selErr.message || '')) {
    console.log('  (migration 025 not applied — falling back to manuals-only; all files will go into the operator-facing `manuals` bucket)');
    docsAvailable = false;
    ({data: eqs} = await sb.from('equipment').select('id,slug,name,podio_item_id,manuals'));
  } else if (selErr) {
    console.error('Equipment select failed:', selErr.message); process.exit(1);
  }
  if (!Array.isArray(eqs)) { console.error('No equipment rows returned.'); process.exit(1); }
  const eqByPodioId = new Map(eqs.map(e => [e.podio_item_id, e]));

  // Group by equipment.
  const plan = new Map(); // slug → {eq, toAdd: {manuals:[], documents:[]}}
  const unresolved = [];
  for (const entry of eqAppEntries) {
    const eq = eqByPodioId.get(entry.item_id);
    if (!eq) { unresolved.push(entry); continue; }
    // If migration 025 isn't applied, route everything to manuals.
    const bucket = docsAvailable ? classify(entry.name) : 'manuals';
    if (!plan.has(eq.slug)) plan.set(eq.slug, {eq, manuals: [], documents: []});
    plan.get(eq.slug)[bucket].push(entry);
  }

  console.log(`\nResolved to ${plan.size} equipment pieces:`);
  for (const [slug, p] of plan) {
    console.log(`  ${slug.padEnd(18)} — ${p.manuals.length} manual(s), ${p.documents.length} document(s)`);
    for (const e of p.manuals)    console.log(`    📖 manual:   ${e.name}`);
    for (const e of p.documents)  console.log(`    📄 document: ${e.name}`);
  }
  if (unresolved.length) console.log(`\n${unresolved.length} files unresolved (item_id not in equipment table):`, unresolved.map(u=>u.name).join(', '));

  if (!COMMIT) {
    console.log('\nPreview only — rerun with --commit to upload + link.');
    return;
  }

  console.log('\nUploading + linking...');
  let uploaded = 0, linked = 0, errs = 0;
  for (const [slug, p] of plan) {
    const updates = {};
    // Existing buckets (start with what's already on the row).
    const existingManuals = Array.isArray(p.eq.manuals) ? [...p.eq.manuals] : [];
    const existingDocs    = Array.isArray(p.eq.documents) ? [...p.eq.documents] : [];
    const addManuals = [];
    const addDocs = [];

    for (const bucket of ['manuals', 'documents']) {
      for (const entry of p[bucket]) {
        const localPath = path.join(__dirname, entry.local_path);
        if (!fs.existsSync(localPath)) { console.error(`  ✗ file not on disk: ${entry.local_path}`); errs++; continue; }

        // Deterministic bucket path so re-runs can detect already-uploaded.
        const safeName = String(entry.name || 'file').replace(/[^a-zA-Z0-9._-]/g, '_');
        const bucketPath = bucket + '/' + slug + '/' + entry.file_id + '-' + safeName;

        // Skip link if already present on the equipment row.
        const list = bucket === 'manuals' ? existingManuals : existingDocs;
        if (list.some(x => x.path === bucketPath)) { continue; }

        // Upload (tolerate "already exists").
        const content = fs.readFileSync(localPath);
        const {error: upErr} = await sb.storage.from('equipment-maintenance-docs').upload(bucketPath, content, {
          upsert: false,
          contentType: entry.mime_type || 'application/pdf',
        });
        if (upErr && !/already exists|the resource already exists/i.test(upErr.message || '')) {
          console.error(`  ✗ upload ${bucketPath}: ${upErr.message}`); errs++; continue;
        }
        uploaded++;

        const {data: pub} = sb.storage.from('equipment-maintenance-docs').getPublicUrl(bucketPath);
        const item = {
          type: 'pdf',
          title: prettyTitle(entry.name),
          url: pub.publicUrl,
          path: bucketPath,
          uploadedAt: new Date().toISOString(),
          source: 'podio_equipment_maintenance',
          podio_file_id: entry.file_id,
        };
        if (bucket === 'manuals') addManuals.push(item); else addDocs.push(item);
      }
    }

    if (addManuals.length === 0 && addDocs.length === 0) continue;
    if (addManuals.length) updates.manuals = [...existingManuals, ...addManuals];
    if (addDocs.length)    updates.documents = [...existingDocs, ...addDocs];

    const {error: updErr} = await sb.from('equipment').update(updates).eq('id', p.eq.id);
    if (updErr) {
      if (/column.*documents/i.test(updErr.message||'')) {
        console.error(`  ✗ ${slug}: 'documents' column missing — apply migration 025 first.`);
      } else {
        console.error(`  ✗ ${slug}: ${updErr.message}`);
      }
      errs++; continue;
    }
    linked += addManuals.length + addDocs.length;
    console.log(`  ✓ ${slug}: +${addManuals.length} manual(s) +${addDocs.length} document(s)`);
  }

  console.log(`\n✓ ${uploaded} file(s) uploaded, ${linked} row link(s) written, ${errs} error(s).`);
})().catch(e => { console.error(e); process.exit(1); });
