// Seeds the WCF Cattle Import Template with the 41 cows from the
// New Momma Planner Import xlsx (A-Z Feeders + Wright Farms), per
// the Q&A answers from the 2026-04-18 session.
//
// Reads:  ~/OneDrive/Desktop/New Momma Planner Import.xlsx
// Writes: ~/OneDrive/Desktop/WCF Cattle Import Template - Momma Planner SEEDED.xlsx
//
// Run:    node scripts/seed_momma_import_template.js

const XLSX = require('xlsx');
const path = require('path');
const os = require('os');

const SRC = path.join(os.homedir(), 'OneDrive', 'Desktop', 'New Momma Planner Import.xlsx');
const OUT = path.join(os.homedir(), 'OneDrive', 'Desktop', 'WCF Cattle Import Template - Momma Planner SEEDED.xlsx');

const COLS = [
  'tag','sex','herd','breed','pct_wagyu','origin',
  'purchase_date','purchase_amount','birth_date',
  'dam_tag','dam_reg_num','sire_tag','sire_reg_num','registration_num',
  'breeding_status','last_calve_date','receiving_weight','comment'
];

function pad(n){ return String(n).padStart(2,'0'); }

// "M/D/YY" or "M/D/YYYY" → YYYY-MM-DD
function parseSlashDate(s, defaultYear) {
  if(!s) return null;
  s = String(s).trim();
  const full = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
  if(full) {
    let y = parseInt(full[3],10);
    if(y < 100) y += 2000;
    return y + '-' + pad(parseInt(full[1],10)) + '-' + pad(parseInt(full[2],10));
  }
  // "M/D" with externally supplied year (special: IR553 last_calve "10/08")
  const partial = s.match(/^(\d{1,2})\/(\d{1,2})$/);
  if(partial && defaultYear) {
    return defaultYear + '-' + pad(parseInt(partial[1],10)) + '-' + pad(parseInt(partial[2],10));
  }
  return null;
}

const wb = XLSX.readFile(SRC);
const az = XLSX.utils.sheet_to_json(wb.Sheets['A to Z'], {defval:null});
const wr = XLSX.utils.sheet_to_json(wb.Sheets['Wright Farms'], {defval:null});

const rows = [];

// Sheet 1: A-Z Feeders, 17 heifers
// Note: SIRE REG # in the source xlsx is the sire of the calf each heifer
// is currently pregnant with (NOT the heifer's own sire). Put it in the
// comment with the registering body so it stays discoverable on the
// timeline; leave sire_reg_num blank.
for(const r of az) {
  const tag = String(r['Tag #']).replace(/\s+/g,'');  // "M 1" → "M1"
  const dob = parseSlashDate(String(r['DOB'])+'/'+r['DOB Year']);
  const calfSireReg = r['SIRE REG #'] || '';
  const comment = calfSireReg
    ? 'Calf sire reg # ' + calfSireReg + ' (American Wagyu Association)'
    : '';
  rows.push({
    tag,
    sex: 'heifer',
    herd: 'mommas',
    breed: 'FULL BLOOD WAGYU',
    pct_wagyu: 100,
    origin: 'A-Z FEEDERS',
    purchase_date: '2026-03-17',
    purchase_amount: 4800,
    birth_date: dob,
    dam_tag: '',
    dam_reg_num: '',
    sire_tag: '',
    sire_reg_num: '',
    registration_num: '',
    breeding_status: 'Pregnant',
    last_calve_date: '',
    receiving_weight: '',     // Q6: skip Sheet 1 weights
    comment,
  });
}

// Sheet 2: Wright Farms, 24 cows / heifers
for(const r of wr) {
  const sexRaw = String(r['SEX']||'').toLowerCase();
  const sex = sexRaw === 'cow' ? 'cow' : 'heifer';
  const breedRaw = String(r['Breed']||'').toLowerCase();
  const breed = breedRaw.includes('akaushi') ? 'AKAUSHI-ANGUS CROSS'
              : breedRaw.includes('red angus') ? 'RED ANGUS'
              : String(r['Breed']||'').toUpperCase();
  const tag = String(r['Tag']||'').trim();
  const bdate = parseSlashDate(r['Birthdate']);
  // IR553's "10/08" gets the 2025 default per Q11
  const lcRaw = r['Last Calve Date'];
  const lcdate = lcRaw ? parseSlashDate(lcRaw, 2025) : null;

  // SIRE REG # in the source xlsx is the sire of the calf this cow/heifer
  // is currently carrying (NOT her own sire). Tucked into the comment with
  // the registering body; sire_reg_num stays blank.
  const calfSireReg = r['SIRE REG #'] || '';
  const comment = 'Preg check 2/28/25 \u2014 Pregnant.'
    + (calfSireReg ? ' Calf sire reg # ' + calfSireReg + ' (American Akaushi Association).' : '');
  rows.push({
    tag,
    sex,
    herd: 'mommas',
    breed,
    pct_wagyu: 50,
    origin: 'WRIGHT FARMS',
    purchase_date: '2026-03-18',
    purchase_amount: 4500,
    birth_date: bdate,
    dam_tag: '',
    dam_reg_num: '',
    sire_tag: '',
    sire_reg_num: '',
    registration_num: '',
    breeding_status: 'Pregnant',
    last_calve_date: lcdate || '',
    receiving_weight: '',
    comment,
  });
}

// Build the workbook
const out = XLSX.utils.book_new();
const ws = XLSX.utils.json_to_sheet(rows, {header: COLS});
XLSX.utils.book_append_sheet(out, ws, 'Cattle');

const inst = [
  ['Column','Required','Notes'],
  ['tag','yes','WCF tag #. Must be unique among active-herd cows.'],
  ['sex','yes','cow | heifer | bull | steer'],
  ['herd','yes','mommas | backgrounders | finishers | bulls (or processed/deceased/sold)'],
  ['breed','no','Free text. Auto-creates new breed if not in the dropdown.'],
  ['pct_wagyu','no','Integer 0-100.'],
  ['origin','no','Selling farm. Auto-creates new origin if not in the dropdown.'],
  ['purchase_date','no','YYYY-MM-DD or M/D/YY.'],
  ['purchase_amount','no','Number, no $ or commas.'],
  ['birth_date','no','YYYY-MM-DD or M/D/YY.'],
  ['dam_tag','no','Mother\u2019s tag # (text).'],
  ['dam_reg_num','no','Mother\u2019s registration #.'],
  ['sire_tag','no','Father\u2019s tag # (text).'],
  ['sire_reg_num','no','Father\u2019s registration #.'],
  ['registration_num','no','This cow\u2019s own registration #.'],
  ['breeding_status','no','Open | Pregnant | N/A. Cow/heifer only.'],
  ['last_calve_date','no','If set, creates a calving record dated this day.'],
  ['receiving_weight','no','If set, creates a wsess-rcv-* session at purchase_date with this weight.'],
  ['comment','no','If set, creates a comment on the cow\u2019s timeline (source=import).'],
];
XLSX.utils.book_append_sheet(out, XLSX.utils.aoa_to_sheet(inst), 'Instructions');

XLSX.writeFile(out, OUT);
console.log('Wrote', rows.length, 'rows to:', OUT);
console.log('  17 from A-Z Feeders (Sheet 1)');
console.log('  24 from Wright Farms (Sheet 2)');
