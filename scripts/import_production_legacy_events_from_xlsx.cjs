// Import historical production backfill rows from Ronnie's Processing Events
// spreadsheet into public.production_legacy_events.
//
// Usage:
//   node scripts/import_production_legacy_events_from_xlsx.cjs --dry-run
//   node scripts/import_production_legacy_events_from_xlsx.cjs --test
//   node scripts/import_production_legacy_events_from_xlsx.cjs --file "C:\path\Processing Events - ALL.xlsx"
//
// Env for DB import:
//   VITE_SUPABASE_URL or SUPABASE_URL
//   SUPABASE_SERVICE_ROLE_KEY

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const xlsx = require('xlsx');

function loadDotEnv(file) {
  if (!fs.existsSync(file)) return;
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (!m) continue;
    let v = m[2].trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    if (process.env[m[1]] === undefined) process.env[m[1]] = v;
  }
}

function argValue(name) {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : null;
}

const dryRun = process.argv.includes('--dry-run');
const useTestEnv = process.argv.includes('--test');
const defaultFile = 'C:\\Users\\Ronni\\OneDrive\\Desktop\\Processing Events - ALL.xlsx';
const file = argValue('--file') || defaultFile;
const ROOT = path.join(__dirname, '..');
const MAIN_WORKTREE = path.resolve(ROOT, '..', 'WCF-planner');
const envFiles = useTestEnv
  ? [
      path.join(ROOT, '.env.test'),
      path.join(ROOT, '.env.test.local'),
      path.join(MAIN_WORKTREE, '.env.test'),
      path.join(MAIN_WORKTREE, '.env.test.local'),
    ]
  : [
      path.join(ROOT, '.env.local'),
      path.join(ROOT, '.env'),
      path.join(ROOT, '.env.test.local'),
      path.join(ROOT, '.env.test'),
      path.join(MAIN_WORKTREE, '.env.local'),
      path.join(MAIN_WORKTREE, '.env'),
      path.join(MAIN_WORKTREE, '.env.test.local'),
      path.join(MAIN_WORKTREE, '.env.test'),
    ];
for (const envFile of envFiles) loadDotEnv(envFile);

function normalizeProgram(value) {
  const raw = String(value || '')
    .trim()
    .toUpperCase();
  if (raw === 'CHICKEN' || raw === 'BROILER' || raw === 'BROILERS') return 'broiler';
  if (raw === 'PIG' || raw === 'PIGS') return 'pig';
  if (raw === 'CATTLE' || raw === 'BEEF') return 'cattle';
  if (raw === 'LAMB' || raw === 'LAMBS' || raw === 'SHEEP') return 'sheep';
  if (raw === 'EGG' || raw === 'EGGS') return 'egg';
  return null;
}

function quantityUnit(program) {
  if (program === 'broiler') return 'birds';
  if (program === 'egg') return 'eggs';
  return 'head';
}

function isoDate(value) {
  if (!value) return null;
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value.toISOString().slice(0, 10);
  if (typeof value === 'number') {
    const parsed = xlsx.SSF.parse_date_code(value);
    if (!parsed) return null;
    return `${parsed.y}-${String(parsed.m).padStart(2, '0')}-${String(parsed.d).padStart(2, '0')}`;
  }
  const str = String(value).trim();
  const match = str.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (match) return `${match[1]}-${match[2]}-${match[3]}`;
  const fallback = new Date(str);
  return Number.isNaN(fallback.getTime()) ? null : fallback.toISOString().slice(0, 10);
}

function numberValue(value) {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(String(value).replace(/,/g, '').trim());
  return Number.isFinite(n) ? n : null;
}

function stableKey(parts) {
  return crypto.createHash('sha256').update(parts.join('|')).digest('hex').slice(0, 20);
}

function parseWorkbook(filePath) {
  const wb = xlsx.readFile(filePath, {cellDates: true});
  const sheetName = wb.SheetNames[0];
  const rows = xlsx.utils.sheet_to_json(wb.Sheets[sheetName], {defval: null, raw: true});
  const parsed = [];
  const skipped = [];

  rows.forEach((row, index) => {
    const sourceRowNumber = index + 2;
    const date = isoDate(row.Date);
    const program = normalizeProgram(row.Program);
    const quantity = numberValue(row['Number Processed']);
    if (!date || !program || quantity === null || quantity < 0) {
      skipped.push({sourceRowNumber, row});
      return;
    }
    const batchName = row['Batch Name'] ? String(row['Batch Name']).trim() : null;
    const hash = stableKey([sourceRowNumber, date, program, batchName || '', quantity]);
    parsed.push({
      id: `prod-legacy-${hash}`,
      source_key: `processing-events-all:${hash}`,
      event_date: date,
      program,
      batch_name: batchName,
      quantity,
      quantity_unit: quantityUnit(program),
      source_file: path.basename(filePath),
      source_row_number: sourceRowNumber,
      raw_program: row.Program == null ? null : String(row.Program),
      raw_relationship: row.Relationship == null ? null : String(row.Relationship),
      review_status: 'approved',
    });
  });

  return {rows: parsed, skipped};
}

function summarize(rows) {
  const totals = new Map();
  for (const row of rows) {
    const year = row.event_date.slice(0, 4);
    const key = `${row.program}:${year}`;
    totals.set(key, (totals.get(key) || 0) + row.quantity);
  }
  return [...totals.entries()].sort().map(([key, quantity]) => ({key, quantity}));
}

async function main() {
  if (!fs.existsSync(file)) {
    console.error(`File not found: ${file}`);
    process.exit(2);
  }
  const parsed = parseWorkbook(file);
  console.log(`parsed rows=${parsed.rows.length} skipped=${parsed.skipped.length}`);
  for (const item of summarize(parsed.rows)) console.log(`${item.key}=${item.quantity}`);

  if (dryRun) return;

  const url = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    console.error('Missing VITE_SUPABASE_URL/SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY.');
    process.exit(2);
  }
  if (useTestEnv && url.includes('pzfujbjtayhkdlxiblwe')) {
    console.error('Refusing --test import against PROD url.');
    process.exit(2);
  }

  const {createClient} = require('@supabase/supabase-js');
  const sb = createClient(url, key, {auth: {autoRefreshToken: false, persistSession: false}});
  const {error} = await sb.from('production_legacy_events').upsert(parsed.rows, {onConflict: 'source_key'});
  if (error) {
    console.error('production_legacy_events upsert failed:', error.message || error);
    process.exit(1);
  }
  console.log(`upserted ${parsed.rows.length} production_legacy_events rows`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
