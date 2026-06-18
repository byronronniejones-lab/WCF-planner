import {test} from './fixtures.js';
import fs from 'node:fs';

// ============================================================================
// Broiler Batches controls redesign — UI preview capture (NOT a CI assertion).
// Seeds a mix of planned/active/processed broiler batches, then screenshots
// /broiler/batches: the default list (processed newest-first), the open Filters
// panel, and the open Sort panel, desktop + mobile.
// Screenshots -> C:/Users/Ronni/cc-research/broiler-batches/.
// ============================================================================

const SHOT = 'C:/Users/Ronni/cc-research/broiler-batches';
const DESKTOP = {width: 1280, height: 1000};
const MOBILE = {width: 390, height: 900};

const BATCHES = [
  {
    id: 'b1',
    name: 'B-26-10',
    status: 'processed',
    breed: 'CC',
    hatchery: 'Meyer Hatchery',
    brooder: 'Brooder 1',
    schooner: '2&3',
    hatchDate: '2026-01-01',
    processingDate: '2026-03-15',
    birdCount: 750,
    birdCountActual: 742,
    totalToProcessor: 705,
    week4Lbs: 1.5,
    week6Lbs: 4.25,
  },
  {
    id: 'b2',
    name: 'B-26-09',
    status: 'processed',
    breed: 'WR',
    hatchery: 'Mt. Healthy',
    brooder: 'Brooder 2',
    schooner: '1',
    hatchDate: '2025-12-10',
    processingDate: '2026-02-20',
    birdCount: 800,
    birdCountActual: 788,
    totalToProcessor: 760,
  },
  {
    id: 'b3',
    name: 'B-26-08',
    status: 'processed',
    breed: 'CC',
    hatchery: 'Meyer Hatchery',
    brooder: 'Brooder 1',
    schooner: '2&3',
    hatchDate: '2025-11-15',
    processingDate: '2026-01-30',
    birdCount: 600,
    birdCountActual: 590,
    totalToProcessor: 560,
  },
  {
    id: 'b4',
    name: 'B-26-12',
    status: 'active',
    breed: 'CC',
    hatchery: 'Meyer Hatchery',
    brooder: 'Brooder 3',
    schooner: '1',
    hatchDate: '2026-05-01',
    birdCount: 820,
  },
  {
    id: 'b5',
    name: 'B-26-13',
    status: 'active',
    breed: 'FR',
    hatchery: 'Ridgway',
    brooder: 'Brooder 2',
    schooner: '2&3',
    hatchDate: '2026-05-20',
    birdCount: 500,
  },
  {
    id: 'b6',
    name: 'B-26-14',
    status: 'planned',
    breed: 'CY',
    hatchery: 'Ridgway',
    brooder: 'Brooder 1',
    schooner: '1',
    hatchDate: '2026-06-25',
    birdCount: 900,
  },
];

test.describe('Broiler Batches controls redesign preview', () => {
  test('seed + capture /broiler/batches', async ({page, supabaseAdmin, resetDb}) => {
    test.setTimeout(180_000);
    await resetDb();
    fs.mkdirSync(SHOT, {recursive: true});

    const r = await supabaseAdmin.from('app_store').upsert({key: 'ppp-v4', data: BATCHES}, {onConflict: 'key'});
    if (r.error) throw new Error('seed ppp-v4: ' + r.error.message);

    const ready = '[data-broiler-batches-loaded="true"]';
    const go = async () => {
      await page.goto('/broiler/batches');
      await page.waitForSelector('#wcf-boot-loader', {state: 'detached', timeout: 20_000}).catch(() => {});
      await page.waitForSelector(ready, {timeout: 20_000}).catch(() => {});
      await page.waitForTimeout(500);
    };

    // Desktop — default list
    await page.setViewportSize(DESKTOP);
    await go();
    await page.screenshot({path: `${SHOT}/01-default-desktop.png`, fullPage: true});

    // Desktop — Filters panel open
    await page.locator('[data-broiler-batches-filters-toggle="1"]').click();
    await page.waitForTimeout(300);
    await page.screenshot({path: `${SHOT}/02-filters-desktop.png`, fullPage: true});

    // Desktop — Sort panel open
    await page.locator('[data-broiler-batches-sort-toggle="1"]').click();
    await page.waitForTimeout(300);
    await page.screenshot({path: `${SHOT}/03-sort-desktop.png`, fullPage: true});

    // Desktop — Columns (display) picker open (full 2-column list)
    await page.locator('[data-broiler-batches-columns-toggle="1"]').click();
    await page.waitForTimeout(300);
    await page.screenshot({path: `${SHOT}/08-columns-all-desktop.png`, fullPage: true});

    // Desktop — hide a couple columns to show the picker drives the table
    await page.locator('[data-broiler-column-toggle="perBird"]').click();
    await page.locator('[data-broiler-column-toggle="hatchery"]').click();
    await page.waitForTimeout(300);
    await page.screenshot({path: `${SHOT}/07-columns-applied-desktop.png`, fullPage: true});

    // Mobile — default + filters open
    await page.setViewportSize(MOBILE);
    await go();
    await page.screenshot({path: `${SHOT}/04-default-mobile.png`, fullPage: true});
    await page.locator('[data-broiler-batches-filters-toggle="1"]').click();
    await page.waitForTimeout(300);
    await page.screenshot({path: `${SHOT}/05-filters-mobile.png`, fullPage: true});
  });
});
