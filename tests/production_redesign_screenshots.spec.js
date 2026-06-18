import {test} from './fixtures.js';
import fs from 'node:fs';
import xlsx from 'xlsx';

// ============================================================================
// Production multi-year redesign — UI preview capture (NOT a CI assertion).
// Seeds the real imported Processing Events export into production_legacy_events
// plus a few egg-day records, then screenshots /production (Summary matrix +
// Production Events), desktop + mobile.
// Screenshots -> C:/Users/Ronni/cc-research/production-redesign/.
// ============================================================================

const SHOT = 'C:/Users/Ronni/cc-research/production-redesign';
const XLSX_FILE = 'C:/Users/Ronni/OneDrive/Desktop/Processing Events - ALL.xlsx';
const DESKTOP = {width: 1280, height: 1000};
const MOBILE = {width: 390, height: 900};

function normalizeProgram(value) {
  const raw = String(value || '')
    .trim()
    .toUpperCase();
  if (['CHICKEN', 'BROILER', 'BROILERS'].includes(raw)) return 'broiler';
  if (['PIG', 'PIGS'].includes(raw)) return 'pig';
  if (['CATTLE', 'BEEF'].includes(raw)) return 'cattle';
  if (['LAMB', 'LAMBS', 'SHEEP'].includes(raw)) return 'sheep';
  if (['EGG', 'EGGS'].includes(raw)) return 'egg';
  return null;
}
function isoDate(value) {
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value.toISOString().slice(0, 10);
  if (typeof value === 'number') {
    const p = xlsx.SSF.parse_date_code(value);
    return p ? `${p.y}-${String(p.m).padStart(2, '0')}-${String(p.d).padStart(2, '0')}` : null;
  }
  const m = String(value || '').match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? `${m[1]}-${m[2]}-${m[3]}` : null;
}

test.describe('Production multi-year redesign preview', () => {
  test('seed + capture /production', async ({page, supabaseAdmin, resetDb}) => {
    test.setTimeout(180_000);
    await resetDb();
    fs.mkdirSync(SHOT, {recursive: true});

    // ---- real imported legacy production events ----
    const wb = xlsx.readFile(XLSX_FILE, {cellDates: true});
    const sheet = wb.Sheets[wb.SheetNames[0]];
    const rows = xlsx.utils.sheet_to_json(sheet, {defval: null, raw: true});
    const legacy = [];
    rows.forEach((row, index) => {
      const date = isoDate(row.Date);
      const program = normalizeProgram(row.Program);
      const quantity = Number(String(row['Number Processed']).replace(/,/g, ''));
      if (!date || !program || !Number.isFinite(quantity) || quantity < 0) return;
      const key = `shot-${index}-${date}-${program}-${quantity}`;
      legacy.push({
        id: key,
        source_key: key,
        event_date: date,
        program,
        batch_name: row['Batch Name'] ? String(row['Batch Name']).trim() : null,
        quantity,
        quantity_unit: program === 'broiler' ? 'birds' : 'head',
        review_status: 'approved',
      });
    });
    // resetDb does not own production_legacy_events; clear any prior import so
    // the preview reflects exactly this seed (no stacked duplicate totals).
    const rDel = await supabaseAdmin.from('production_legacy_events').delete().not('source_key', 'is', null);
    if (rDel.error) throw new Error('legacy clear: ' + rDel.error.message);
    const r1 = await supabaseAdmin.from('production_legacy_events').upsert(legacy, {onConflict: 'source_key'});
    if (r1.error) throw new Error('legacy: ' + r1.error.message);

    // ---- egg-day records so the Eggs row shows dozens across years ----
    const eggDoz = {'2022-07-01': 2980, '2023-07-01': 3210, '2024-07-01': 3460, '2025-07-01': 3343.4};
    const eggRows = Object.entries(eggDoz).map(([date, doz], i) => ({
      id: `shot-egg-${i}`,
      date,
      team_member: 'Jenny Lee',
      group1_name: 'Eggmobile',
      group1_count: Math.round(doz * 12),
      deleted_at: null,
      deleted_by: null,
    }));
    const r2 = await supabaseAdmin.from('egg_dailys').upsert(eggRows, {onConflict: 'id'});
    if (r2.error) throw new Error('egg: ' + r2.error.message);

    const ready = '[data-production-loaded="true"]';
    const shoot = async (name) => {
      await page.waitForSelector(ready, {timeout: 20_000}).catch(() => {});
      await page.waitForTimeout(600);
      await page.screenshot({path: `${SHOT}/${name}.png`, fullPage: true});
    };

    // Summary (matrix) — desktop + mobile
    await page.setViewportSize(DESKTOP);
    await page.goto('/production');
    await shoot('01-production-summary-desktop');
    await page.setViewportSize(MOBILE);
    await page.goto('/production');
    await shoot('01-production-summary-mobile');

    // Production Events — desktop + mobile (switch to a fuller year)
    await page.setViewportSize(DESKTOP);
    await page.goto('/production');
    await page.waitForSelector(ready, {timeout: 20_000}).catch(() => {});
    await page.getByRole('tab', {name: 'Production Events'}).click();
    await page.selectOption('.production-year-picker select', '2025').catch(() => {});
    await page.waitForTimeout(500);
    await page.screenshot({path: `${SHOT}/02-production-events-desktop.png`, fullPage: true});
    await page.setViewportSize(MOBILE);
    await page.waitForTimeout(400);
    await page.screenshot({path: `${SHOT}/02-production-events-mobile.png`, fullPage: true});
  });
});
