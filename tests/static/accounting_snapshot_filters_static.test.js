import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {describe, expect, it} from 'vitest';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..', '..');

const cattleView = fs.readFileSync(path.join(ROOT, 'src/cattle/CattleHerdsView.jsx'), 'utf8');
const sheepView = fs.readFileSync(path.join(ROOT, 'src/sheep/SheepFlocksView.jsx'), 'utf8');
const helper = fs.readFileSync(path.join(ROOT, 'src/lib/accountingMonthEndSnapshot.js'), 'utf8');

describe('cattle/sheep accounting month-end snapshots', () => {
  it('keeps the snapshot math in a shared pure helper', () => {
    expect(helper).toContain('export function accountingSnapshotRows');
    expect(helper).toContain('export function animalGroupAsOfMonthEnd');
    expect(helper).toContain('purchase_date || row.birth_date || row.created_at');
    expect(helper).toContain("import {centralISOFor} from './dateUtils.js'");
    expect(helper).toContain('centralISOFor(transfer.transferred_at || transfer.created_at)');
  });

  it('wires cattle snapshots through transfer history and saved filter state', () => {
    expect(cattleView).toContain("from '../lib/accountingMonthEndSnapshot.js'");
    expect(cattleView).toContain("sb.from('cattle_transfers').select('*').order('transferred_at', {ascending: false})");
    expect(cattleView).toContain("filters.accountingSnapshotMonth || ''");
    expect(cattleView).toContain('accountingSnapshotRows(');
    expect(cattleView).toContain("groupField: 'herd'");
    expect(cattleView).toContain("transferEntityIdField: 'cattle_id'");
    expect(cattleView).toContain("transferFromField: 'from_herd'");
    expect(cattleView).toContain('data-cattle-accounting-snapshot-month="1"');
    expect(cattleView).toContain("setFilter('accountingSnapshotMonth', e.target.value)");
    expect(cattleView).toContain('Snapshot herd');
    expect(cattleView).toContain("label: 'Snapshot Herd'");
    expect(cattleView).toContain('HERD_LABELS[c._accountingSnapshotOriginalGroup]');
    expect(cattleView).toContain('active cattle at');
  });

  it('wires sheep snapshots through transfer history and saved filter state', () => {
    expect(sheepView).toContain("from '../lib/accountingMonthEndSnapshot.js'");
    expect(sheepView).toContain("sb.from('sheep_transfers').select('*').order('transferred_at', {ascending: false})");
    expect(sheepView).toContain("filters.accountingSnapshotMonth || ''");
    expect(sheepView).toContain('accountingSnapshotRows(');
    expect(sheepView).toContain("groupField: 'flock'");
    expect(sheepView).toContain("transferEntityIdField: 'sheep_id'");
    expect(sheepView).toContain("transferFromField: 'from_flock'");
    expect(sheepView).toContain('data-sheep-accounting-snapshot-month="1"');
    expect(sheepView).toContain("setFilter('accountingSnapshotMonth', e.target.value)");
    expect(sheepView).toContain('Snapshot flock');
    expect(sheepView).toContain("label: 'Snapshot Flock'");
    expect(sheepView).toContain('FLOCK_LABELS[s._accountingSnapshotOriginalGroup]');
    expect(sheepView).toContain('active sheep at');
  });
});
