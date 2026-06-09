import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {describe, expect, it} from 'vitest';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..', '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

const sowsSrc = read('src/pig/SowsView.jsx');
const breedingSrc = read('src/pig/BreedingView.jsx');
const mainSrc = read('src/main.jsx');

describe('Lane 14 - breeding pig record pages', () => {
  it('routes /pig/sows/<id> through SowsView without clobbering the record URL', () => {
    expect(mainSrc).toContain("location.pathname.startsWith('/pig/sows/')");
    expect(mainSrc).toContain("const isPigSowsSubpath = !exactPathView && location.pathname.startsWith('/pig/sows/')");
    expect(mainSrc).toMatch(/isPigSowsSubpath\s*\?\s*'sows'/);
    expect(mainSrc).toContain("if (view === 'sows' && location.pathname.startsWith('/pig/sows/')) return;");
  });

  it('SowsView owns the breeder-record router and sequence state', () => {
    expect(sowsSrc).toContain("import {useLocation, useNavigate} from 'react-router-dom'");
    expect(sowsSrc).toContain("from '../lib/recordSequence.js'");
    expect(sowsSrc).toContain("const recordMode = location.pathname.startsWith('/pig/sows/')");
    expect(sowsSrc).toContain("location.pathname.slice('/pig/sows/'.length)");
    expect(sowsSrc).toContain("const recordRawId = recordMode ? location.pathname.slice('/pig/sows/'.length)");
    expect(sowsSrc).toMatch(/try \{\s*recordId = decodeURIComponent\(recordRawId\)/);
    expect(sowsSrc).toContain('location.state?.recordSeq');
    expect(sowsSrc).toContain("navigate('/pig/sows/' + encodeURIComponent(id), recordSeqNavOptions(recordSeq))");
  });

  it('tiles keep their edit click and add a record-page entry point with visible-order sequence', () => {
    expect(sowsSrc).toContain(
      'const breedingPigSeqRows = [...activeSows, ...activeBoars, ...(showArchived ? archivedPigs : [])]',
    );
    expect(sowsSrc).toContain('data-breeding-pig-record-link={pig.id}');
    expect(sowsSrc).toContain('openBreedingPigRecord(pig, breedingPigSeqRows)');
    expect(sowsSrc).toContain("recordSeqNavOptions(labeledSeqItems(rows, 'tag'))");
    expect(sowsSrc).toContain('setShowBreederForm(true)');
  });

  it('record page uses shared chrome and exposes the loaded marker', () => {
    expect(sowsSrc).toContain("from '../shared/RecordPageShell.jsx'");
    expect(sowsSrc).toContain("from '../shared/RecordSequenceNav.jsx'");
    expect(sowsSrc).toContain('<RecordPageBody maxWidth={960} data-breeding-pig-record-loaded="true">');
    expect(sowsSrc).toContain('<RecordBackLink label="Back to Breeding Pigs"');
    expect(sowsSrc).toContain('<RecordSequenceNav seq={recordSeq} currentId={recordId} onNavigate={navigateSeq} />');
    expect(sowsSrc).toContain('<RecordTitle>{breedingPigTitle(recordPig)}</RecordTitle>');
  });

  it('record details mirror the current breeder tile/modal data sources', () => {
    expect(sowsSrc).toContain('function BreedingPigRecordDetails({pig})');
    expect(sowsSrc).toContain('const stats = sowFarrowStats(pig.tag)');
    expect(sowsSrc).toContain('const history = isSow ? sowFarrowHistory(pig.tag) : []');
    expect(sowsSrc).toContain('const weighins = Array.isArray(pig.weighins) ? pig.weighins : []');
    expect(sowsSrc).toContain('data-breeding-pig-weight-history={pig.id}');
    expect(sowsSrc).toContain('data-breeding-pig-farrowing-history={pig.id}');
    expect(sowsSrc).toContain('data-breeding-pig-transfer-note={pig.id}');
    expect(sowsSrc).toContain('data-breeding-pig-notes={pig.id}');
  });
});

describe('Lane 14 - /pig/breeding scroll stability', () => {
  it('keeps pig breeding timeline tooltip local to BreedingView', () => {
    expect(breedingSrc).toContain('const [tooltip, setTooltip] = React.useState(null)');
    expect(breedingSrc).not.toContain("from '../contexts/BatchesContext.jsx'");
    expect(breedingSrc).not.toContain('useBatches()');
  });
});

describe('Lane F - breeding pig list search and empty state', () => {
  it('uses the existing sowSearch state to filter visible breeder rows', () => {
    expect(sowsSrc).toContain('sowSearch,');
    expect(sowsSrc).toContain('setSowSearch,');
    expect(sowsSrc).toContain("const breederSearchQ = (sowSearch || '').trim().toLowerCase()");
    expect(sowsSrc).toContain('function breederMatchesSearch(pig)');
    expect(sowsSrc).toContain('!p.archived && breederMatchesSearch(p)');
    expect(sowsSrc).toContain('p.archived && breederMatchesSearch(p)');
  });

  it('renders search controls and distinguishes true-empty from search-empty', () => {
    expect(sowsSrc).toContain("from '../shared/OperationalListEmptyState.jsx'");
    expect(sowsSrc).toContain('data-breeding-pig-search="1"');
    expect(sowsSrc).toContain('onChange={(e) => setSowSearch(e.target.value)}');
    expect(sowsSrc).toContain('data-breeding-pig-search-clear="1"');
    expect(sowsSrc).toContain('<OperationalListEmptyState');
    expect(sowsSrc).toContain('totalCount={breeders.length}');
    expect(sowsSrc).toContain('filteredCount={filteredBreederCount}');
    expect(sowsSrc).toContain('emptyLabel="No breeding pigs yet"');
    expect(sowsSrc).toContain('filteredLabel="No breeding pigs match the current search"');
    expect(sowsSrc).toContain('data-empty-state="breeding-pigs"');
  });
});

describe('Lane K - breeding pig list export and print', () => {
  it('uses the shared CSV and print owners for the visible breeder rows', () => {
    expect(sowsSrc).toContain("from '../lib/csvExport.js'");
    expect(sowsSrc).toContain("from '../lib/printExport.js'");
    expect(sowsSrc).toContain('function breedingPigExportColumns()');
    expect(sowsSrc).toContain('function handleExportCsv()');
    expect(sowsSrc).toContain("downloadCsv(csvFilename('pig-breeding-pigs'), rowsToCsv(columns, breedingPigSeqRows))");
    expect(sowsSrc).toContain('function handlePrintRows()');
    expect(sowsSrc).toContain("subtitle: breedingPigSeqRows.length + ' visible breeding pigs'");
    expect(sowsSrc).toContain('rows: breedingPigSeqRows');
    expect(sowsSrc).not.toContain('rowsToCsv(columns, breeders)');
    expect(sowsSrc).not.toContain('rows: breeders');
  });

  it('renders export controls with useful column coverage and browser-only fallback copy', () => {
    for (const header of [
      'Tag',
      'Sex',
      'Group',
      'Status',
      'Breed',
      'Origin',
      'Birth date',
      'Age',
      'Last weight',
      'Purchase date',
      'Purchase amount',
      'Litters',
      'Alive total',
      'Notes',
      'Record ID',
    ]) {
      expect(sowsSrc).toContain(`header: '${header}'`);
    }
    expect(sowsSrc).toContain('data-breeding-pigs-export-csv="1"');
    expect(sowsSrc).toContain('data-breeding-pigs-print="1"');
    expect(sowsSrc).toContain('CSV export is only available in the browser.');
    expect(sowsSrc).toContain('Print is only available in the browser.');
    expect(sowsSrc).not.toContain('window.alert');
    expect(sowsSrc).not.toContain('window.confirm');
  });
});
