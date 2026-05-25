// Static lock: expanded cow / sheep detail panes show a read-only Age
// alongside the existing Birth Date input.
//
// Operators see age on the collapsed herd/flock tile; without this prop,
// it disappears once the animal is expanded. Each parent view passes
// ageLabel={age(<animal>.birth_date) || '—'} into the detail component,
// and the detail component renders that label near birth_date.

import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {dirname, resolve} from 'node:path';
import {describe, it, expect} from 'vitest';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '../..');

const COW_DETAIL_CALLERS = ['src/cattle/CattleAnimalPage.jsx', 'src/cattle/CattleForecastView.jsx'];

const animalPage = readFileSync(resolve(ROOT, 'src/cattle/CattleAnimalPage.jsx'), 'utf8');
const forecastView = readFileSync(resolve(ROOT, 'src/cattle/CattleForecastView.jsx'), 'utf8');
const cowDetail = readFileSync(resolve(ROOT, 'src/cattle/CowDetail.jsx'), 'utf8');
const flocksView = readFileSync(resolve(ROOT, 'src/sheep/SheepFlocksView.jsx'), 'utf8');
const sheepDetail = readFileSync(resolve(ROOT, 'src/sheep/SheepDetail.jsx'), 'utf8');

describe('Every CowDetail caller passes ageLabel', () => {
  // Any file that renders <CowDetail> must pass the ageLabel prop, so the
  // shared Age row in CowDetail never falls back to "—" by accident in a
  // surface where age is already available. New callers added in the
  // future will fail this lock until they pass the prop.
  it('all CowDetail callers in src/ pass ageLabel', () => {
    for (const rel of COW_DETAIL_CALLERS) {
      const source = readFileSync(resolve(ROOT, rel), 'utf8');
      const cowDetailOpens = source.match(/<CowDetail\b/g) || [];
      const agePropPasses = source.match(/ageLabel=\{/g) || [];
      expect(cowDetailOpens.length, `${rel}: expected at least one <CowDetail> render`).toBeGreaterThan(0);
      expect(agePropPasses.length, `${rel}: ageLabel prop count must match <CowDetail> render count`).toBe(
        cowDetailOpens.length,
      );
    }
  });
});

describe('CattleAnimalPage → CowDetail ageLabel wiring', () => {
  it('uses an age() helper with the "—" fallback for missing birth_date', () => {
    expect(animalPage).toMatch(/ageLabel=\{age\(cow\.birth_date\)\s*\|\|\s*'—'\}/);
  });
});

describe('CattleForecastView → CowDetail ageLabel wiring', () => {
  it('passes the existing local ageStr ("—" already baked in upstream)', () => {
    expect(forecastView).toMatch(/ageLabel=\{ageStr\}/);
  });
});

describe('CowDetail accepts and renders ageLabel near birth_date', () => {
  it('destructures ageLabel from props', () => {
    expect(cowDetail).toMatch(/\bageLabel\b/);
  });

  it('renders an "Age:" label and the ageLabel value with the "—" fallback', () => {
    expect(cowDetail).toMatch(/>Age:</);
    expect(cowDetail).toMatch(/\{ageLabel\s*\|\|\s*'—'\}/);
  });

  it('Age block sits between Birth and Purchased fields', () => {
    const birthIdx = cowDetail.indexOf('cow.birth_date');
    const ageIdx = cowDetail.indexOf('>Age:<');
    const purchasedIdx = cowDetail.indexOf('cow.purchase_date');
    expect(birthIdx).toBeGreaterThan(-1);
    expect(ageIdx).toBeGreaterThan(birthIdx);
    expect(purchasedIdx).toBeGreaterThan(ageIdx);
  });
});

describe('SheepFlocksView → SheepDetail ageLabel wiring', () => {
  it('passes ageLabel into the SheepDetail render site', () => {
    expect(flocksView).toMatch(/ageLabel=\{age\(s\.birth_date\)\s*\|\|\s*'—'\}/);
  });
});

describe('SheepDetail accepts and renders ageLabel near birth_date', () => {
  it('destructures ageLabel from props', () => {
    expect(sheepDetail).toMatch(/\bageLabel\b/);
  });

  it('renders an "Age:" label and the ageLabel value with the "—" fallback', () => {
    expect(sheepDetail).toMatch(/>Age:</);
    expect(sheepDetail).toMatch(/\{ageLabel\s*\|\|\s*'—'\}/);
  });

  it('Age block sits between Birth and Purchased fields', () => {
    const birthIdx = sheepDetail.indexOf('sheep.birth_date');
    const ageIdx = sheepDetail.indexOf('>Age:<');
    const purchasedIdx = sheepDetail.indexOf('sheep.purchase_date');
    expect(birthIdx).toBeGreaterThan(-1);
    expect(ageIdx).toBeGreaterThan(birthIdx);
    expect(purchasedIdx).toBeGreaterThan(ageIdx);
  });
});
