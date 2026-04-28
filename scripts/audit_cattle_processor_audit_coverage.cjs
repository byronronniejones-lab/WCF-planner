// scripts/audit_cattle_processor_audit_coverage.cjs
//
// Read-only audit. Answers Codex's question: "Does cattle_transfers have
// enough audit data for all existing processor sends? If not, clearing old
// flags may be ambiguous."
//
// Walks every cow currently in herd='processed' and checks whether a
// cattle_transfers row exists with reason='processing_batch' and
// reference_id=cow.processing_batch_id. Reports the gap.
//
// Usage: node scripts/audit_cattle_processor_audit_coverage.cjs

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

async function main() {
  const {createClient} = require('@supabase/supabase-js');
  const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: {persistSession: false},
  });

  const cows = [];
  for (let from = 0; ; from += 1000) {
    const {data, error} = await sb
      .from('cattle')
      .select('id,tag,herd,processing_batch_id')
      .eq('herd', 'processed')
      .range(from, from + 999);
    if (error) {
      console.error(error);
      process.exit(1);
    }
    if (!data || data.length === 0) break;
    cows.push(...data);
    if (data.length < 1000) break;
  }
  console.log('Processed cows total:', cows.length);

  // Probe the table directly first
  const probe = await sb.from('cattle_transfers').select('id', {count: 'exact', head: true});
  if (probe.error) {
    console.error('cattle_transfers probe error:', probe.error.code, probe.error.message);
    process.exit(2);
  }
  console.log('cattle_transfers row count (any to_herd):', probe.count);

  const transfers = [];
  for (let from = 0; ; from += 1000) {
    // Use the actual column name from migration 001: transferred_at (not created_at)
    const {data, error} = await sb
      .from('cattle_transfers')
      .select('id,cattle_id,from_herd,to_herd,reason,reference_id,team_member,transferred_at')
      .eq('to_herd', 'processed')
      .range(from, from + 999);
    if (error) {
      console.error('select error:', error.code, error.message);
      process.exit(1);
    }
    if (!data || data.length === 0) break;
    transfers.push(...data);
    if (data.length < 1000) break;
  }
  console.log('cattle_transfers rows with to_herd=processed:', transfers.length);

  // For each cow with herd='processed' and processing_batch_id set, look for
  // a matching transfer row.
  const cowsWithBatch = cows.filter((c) => c.processing_batch_id);
  const cowsWithoutBatch = cows.filter((c) => !c.processing_batch_id);
  console.log('  - with processing_batch_id:   ', cowsWithBatch.length);
  console.log('  - without processing_batch_id:', cowsWithoutBatch.length, '(legacy/manual herd flip)');

  let matched = 0;
  let missing = [];
  for (const c of cowsWithBatch) {
    const m = transfers.find(
      (t) => t.cattle_id === c.id && t.reason === 'processing_batch' && t.reference_id === c.processing_batch_id,
    );
    if (m) matched++;
    else missing.push(c);
  }
  console.log('');
  console.log('Cows with a matching cattle_transfers audit row:', matched, '/', cowsWithBatch.length);
  if (missing.length > 0) {
    console.log('');
    console.log('⚠ Cows in processed herd, with processing_batch_id set, but NO matching');
    console.log('  cattle_transfers row to source from_herd from:');
    console.log("  These cows can't be auto-reverted if their flag is cleared.");
    console.log('');
    for (const c of missing.slice(0, 30)) {
      console.log('   - cow id=' + c.id + ' tag=' + (c.tag || '?') + ' batch=' + c.processing_batch_id);
    }
    if (missing.length > 30) console.log('   ... and ' + (missing.length - 30) + ' more');
  }

  // Distribution of from_herd values among the matched audit rows
  const fromHerdCounts = {};
  for (const c of cowsWithBatch) {
    const m = transfers.find(
      (t) => t.cattle_id === c.id && t.reason === 'processing_batch' && t.reference_id === c.processing_batch_id,
    );
    if (m) fromHerdCounts[m.from_herd || '(null)'] = (fromHerdCounts[m.from_herd || '(null)'] || 0) + 1;
  }
  console.log('');
  console.log('Audit-row from_herd distribution (for matched rows):');
  for (const [k, v] of Object.entries(fromHerdCounts).sort((a, b) => b[1] - a[1])) {
    console.log('   ' + k.padEnd(16) + v);
  }
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
