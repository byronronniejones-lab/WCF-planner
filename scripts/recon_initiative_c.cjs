// scripts/recon_initiative_c.cjs
//
// Read-only. Initiative C plan recon. Two questions:
//   (1) What anon-write policies exist in prod for the 9 target tables + the
//       equipment-maintenance-docs storage bucket?
//   (2) Are anon UPDATEs to equipment.current_hours/current_km landing in
//       prod? If MAX(equipment_fuelings.<reading>) > equipment.current_<unit>
//       for the same equipment_id, the UPDATE is silently failing.
//
// (1) cannot be answered from this script in production. The pg_policies
// branch below uses an exec_sql RPC that exists only on the test Supabase
// project (installed by the test bootstrap). Ronnie has explicitly chosen
// NOT to install exec_sql in prod for this recon — policy capture for
// migration 031 comes from a Supabase-dashboard pg_policies export. The
// branch is left here so the same script works against the test DB as a
// schema-truth check.
//
// (2) works in prod via the standard Supabase REST surface and is the
// load-bearing question for HomeDashboard's drift fix.
//
// No writes. Service role used purely for read access. Not safe to install
// any RPC from this script.
//
// Usage: node scripts/recon_initiative_c.cjs

const fs = require('fs');
const path = require('path');
const {createClient} = require('@supabase/supabase-js');

function loadEnv() {
  const p = path.join(__dirname, '.env');
  if (!fs.existsSync(p)) return;
  for (const line of fs.readFileSync(p, 'utf8').split(/\r?\n/)) {
    const m = /^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*?)\s*$/.exec(line);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
}
loadEnv();

const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: {persistSession: false, autoRefreshToken: false},
});

const TARGET_TABLES = [
  'pig_dailys',
  'poultry_dailys',
  'layer_dailys',
  'cattle_dailys',
  'sheep_dailys',
  'egg_dailys',
  'weigh_in_sessions',
  'weigh_ins',
  'equipment_fuelings',
  'fuel_supplies',
  'equipment',
];

async function execSql(sql) {
  const {data, error} = await sb.rpc('exec_sql', {sql});
  if (error) throw error;
  return data;
}

async function main() {
  console.log('━━━ Initiative C recon ━━━\n');

  // Q1a: pg_policies for the target tables
  console.log('## (1a) pg_policies for target application tables\n');
  const tablesList = TARGET_TABLES.map((t) => `'${t}'`).join(', ');
  const polSql = `
    SELECT schemaname, tablename, policyname, cmd, roles::text, qual, with_check
    FROM pg_policies
    WHERE schemaname = 'public' AND tablename IN (${tablesList})
    ORDER BY tablename, cmd, policyname;
  `;
  try {
    const rows = await execSql(polSql);
    if (Array.isArray(rows) && rows.length) {
      for (const r of rows) {
        console.log(`  [${r.tablename}] ${r.policyname} (${r.cmd}) roles=${r.roles}`);
        if (r.qual) console.log(`    USING: ${r.qual}`);
        if (r.with_check) console.log(`    WITH CHECK: ${r.with_check}`);
      }
      console.log(`\n  Total policies: ${rows.length}\n`);
    } else {
      console.log('  (no policies returned)\n');
    }
  } catch (e) {
    console.log('  exec_sql RPC failed:', e.message);
    console.log('  (likely the RPC does not exist on prod — only test project has it)\n');
  }

  // Q1b: storage.objects policies for the equipment-maintenance-docs bucket
  console.log('## (1b) pg_policies on storage.objects for relevant buckets\n');
  const storageSql = `
    SELECT policyname, cmd, roles::text, qual, with_check
    FROM pg_policies
    WHERE schemaname = 'storage' AND tablename = 'objects'
    ORDER BY policyname;
  `;
  try {
    const rows = await execSql(storageSql);
    if (Array.isArray(rows) && rows.length) {
      for (const r of rows) {
        console.log(`  [storage.objects] ${r.policyname} (${r.cmd}) roles=${r.roles}`);
        if (r.qual) console.log(`    USING: ${r.qual}`);
        if (r.with_check) console.log(`    WITH CHECK: ${r.with_check}`);
      }
      console.log(`\n  Total policies: ${rows.length}\n`);
    } else {
      console.log('  (no policies returned)\n');
    }
  } catch (e) {
    console.log('  exec_sql RPC failed:', e.message, '\n');
  }

  // Q2: equipment.current_hours/km vs LATEST-BY-DATE equipment_fuelings per piece.
  // Matches the comparison the shipped HomeDashboard helper (latestSaneReading)
  // uses — operator's most recent submission is the canonical truth, not the
  // max reading (which can include legacy import outliers like honda-atv-1's
  // 5437h row from 2025-01-11). MAX-reading-based drift surfacing is left as
  // a future enhancement (would catch typos but also amplifies outliers).
  console.log('## (2) equipment.current_<unit> vs LATEST-BY-DATE equipment_fuelings per piece\n');
  console.log("    Same comparison HomeDashboard's latestSaneReading() helper makes.\n");
  console.log('    If the latest-by-date fueling reading exceeds the parent equipment row,\n');
  console.log('    the anon UPDATE is silently failing for that piece.\n');
  const eqRes = await sb
    .from('equipment')
    .select('id, slug, name, tracking_unit, current_hours, current_km, status')
    .eq('status', 'active');
  if (eqRes.error) {
    console.log('  equipment select failed:', eqRes.error.message);
    return;
  }
  const eqRows = eqRes.data || [];

  let drift = 0;
  let aligned = 0;
  let no_fuelings = 0;

  for (const eq of eqRows) {
    const unit = eq.tracking_unit === 'km' ? 'km' : 'hours';
    const readingCol = unit === 'km' ? 'km_reading' : 'hours_reading';
    const currentCol = unit === 'km' ? 'current_km' : 'current_hours';

    // Order by DATE descending (matches latestSaneReading). Reading-magnitude
    // ordering would have surfaced the honda-atv-1 5437h legacy outlier as
    // drift even though its actual most-recent fueling is ~1086h.
    const {data: fuelings, error} = await sb
      .from('equipment_fuelings')
      .select(`id, date, ${readingCol}`)
      .eq('equipment_id', eq.id)
      .not(readingCol, 'is', null)
      .order('date', {ascending: false})
      .limit(1);
    if (error) {
      console.log(`  [${eq.slug}] fueling select failed: ${error.message}`);
      continue;
    }
    if (!fuelings || fuelings.length === 0) {
      no_fuelings++;
      continue;
    }

    const latestReading = Number(fuelings[0][readingCol]);
    const equipmentReading = Number(eq[currentCol]);

    if (latestReading > equipmentReading) {
      drift++;
      console.log(
        `  ⚠ DRIFT  [${eq.slug}] equipment.${currentCol}=${equipmentReading} ${unit}, but latest-by-date fueling=${latestReading} ${unit} on ${fuelings[0].date} (delta +${(latestReading - equipmentReading).toFixed(1)})`,
      );
    } else {
      aligned++;
    }
  }

  console.log(
    `\n  Summary: ${eqRows.length} active pieces — ${aligned} aligned, ${drift} drifted (fueling > equipment), ${no_fuelings} no fuelings`,
  );
  if (drift > 0) {
    console.log(
      `\n  ⚠ Conclusion: anon UPDATE on equipment.current_${eqRows[0]?.tracking_unit === 'km' ? 'km' : 'hours'} is likely SILENTLY FAILING in prod for ${drift} piece(s).`,
    );
  } else if (no_fuelings === eqRows.length) {
    console.log('\n  Inconclusive: no fueling readings exist to compare against.');
  } else {
    console.log(
      '\n  Conclusion: anon UPDATE appears to be landing for the pieces with fueling history. Capture the policy in mig 031.',
    );
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
