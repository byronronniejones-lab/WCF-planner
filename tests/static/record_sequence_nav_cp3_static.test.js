import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {describe, it, expect} from 'vitest';

// CP3 record-page sequence navigation wiring locks. Each operational record
// family that has a dedicated record page passes the originating list's visible
// order through route state (recordSeqNavOptions) and renders the shared
// RecordSequenceNav on the record page, carrying the sequence forward.
//
// broiler.batch is now INCLUDED — its former BatchForm custom side-nav was
// retired in favor of the shared RecordSequenceNav; see the broiler.batch
// describe at the bottom.

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..', '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

const HELPER_IMPORT = "from '../lib/recordSequence.js'";
const NAV_IMPORT = "from '../shared/RecordSequenceNav.jsx'";

// [label, listFile, listAssertions[], pageFile, pageRoutePrefix, currentIdExpr]
const SURFACES = [
  {
    name: 'cattle.processing',
    list: 'src/cattle/CattleBatchesView.jsx',
    listContains: [
      // Processed batches are collapsed behind Show Processed Batches; they
      // only join the sequence when that section is expanded. The redesign
      // passes the FILTERED+SORTED visible rows (scheduledVisible / activeVisible
      // / completedVisible) so nav stepping matches what the operator sees.
      'const batchSeqRows = [...scheduledVisible, ...activeVisible, ...(showCompleted ? completedVisible : [])]',
      "labeledSeqItems(batchSeqRows, 'name')",
    ],
    page: 'src/cattle/CattleBatchPage.jsx',
    nav: "navigate('/cattle/batches/' + id, recordSeqNavOptions(recordSeq))",
  },
  {
    name: 'sheep.processing',
    list: 'src/sheep/SheepBatchesView.jsx',
    // Redesign converted the planned/completed sections into one unified grid;
    // the filtered+sorted set (sortedBatches) is the single visible-order source
    // for render, record-sequence nav, and CSV/print.
    listContains: ['const batchSeqRows = sortedBatches', "labeledSeqItems(batchSeqRows, 'name')"],
    page: 'src/sheep/SheepBatchPage.jsx',
    nav: "navigate('/sheep/batches/' + id, recordSeqNavOptions(recordSeq))",
  },
  {
    name: 'layer.batch',
    list: 'src/layer/LayerBatchesView.jsx',
    // Redesign serves a unified inspection grid; the filtered+sorted set
    // (sorted) is the single visible-order source for render, record-sequence
    // nav, and CSV/print.
    listContains: ['const batchSeqRows = sorted', "labeledSeqItems(batchSeqRows, 'name')"],
    page: 'src/layer/LayerBatchPage.jsx',
    nav: "navigate('/layer/batches/' + id, recordSeqNavOptions(recordSeq))",
  },
  {
    name: 'layer.housing',
    list: 'src/layer/LayerBatchPage.jsx',
    listContains: ["recordSeqNavOptions(labeledSeqItems(batchHousings, 'housing_name'))"],
    page: 'src/layer/LayerHousingPage.jsx',
    nav: "navigate('/layer/housings/' + id, recordSeqNavOptions(recordSeq))",
  },
  {
    name: 'task.instance',
    list: 'src/tasks/MyTasksTab.jsx',
    listContains: [
      'const taskSeqRows =',
      // Collapsed other-assignee groups are excluded — only expanded groups join.
      'otherGroups.filter((g) => isGroupOpen(',
      "labeledSeqItems(taskSeqRows, 'title')",
    ],
    page: 'src/tasks/TaskInstancePage.jsx',
    nav: "navigate('/tasks/' + id, recordSeqNavOptions(recordSeq))",
  },
];

for (const s of SURFACES) {
  describe(`CP3 sequence nav — ${s.name}`, () => {
    const listSrc = read(s.list);
    const pageSrc = read(s.page);

    it('list imports the recordSequence helpers', () => {
      expect(listSrc).toContain(HELPER_IMPORT);
    });
    it('list passes the visible-order sequence through route state', () => {
      expect(listSrc).toContain('recordSeqNavOptions(');
      for (const c of s.listContains) expect(listSrc, c).toContain(c);
    });
    it('record page reads the sequence from route state', () => {
      expect(pageSrc).toContain('location.state?.recordSeq');
    });
    it('record page renders the shared RecordSequenceNav', () => {
      expect(pageSrc).toContain(NAV_IMPORT);
      expect(pageSrc).toContain('<RecordSequenceNav');
    });
    it('record page carries the sequence forward', () => {
      expect(pageSrc).toContain(s.nav);
    });
  });
}

// CompletedTab is the second task list surface.
describe('CP3 sequence nav — task.instance (CompletedTab)', () => {
  const src = read('src/tasks/CompletedTab.jsx');
  it('passes the completed visible order through route state', () => {
    expect(src).toContain('const taskSeqRows =');
    expect(src).toContain("labeledSeqItems(taskSeqRows, 'title')");
  });
});

describe('CP3 sequence nav — pig.batch', () => {
  const viewSrc = read('src/pig/PigBatchesView.jsx');
  const pageSrc = read('src/pig/PigBatchPage.jsx');
  it('hub/router imports helpers and passes the visible-order sequence through route state', () => {
    expect(viewSrc).toContain(HELPER_IMPORT);
    expect(viewSrc).toContain('const visiblePigBatches =');
    expect(viewSrc).toContain("labeledSeqItems(rows, 'batchName')");
    expect(viewSrc).toContain('recordSeqNavOptions(');
  });
  it('hub/router reads route-state sequence and carries it forward', () => {
    expect(viewSrc).toContain('location.state?.recordSeq');
    expect(viewSrc).toContain("navigate('/pig/batches/' + encodeURIComponent(id), recordSeqNavOptions(recordSeq))");
  });
  it('record component owns the shared RecordSequenceNav render', () => {
    expect(pageSrc).toContain(NAV_IMPORT);
    expect(pageSrc).toContain('<RecordSequenceNav');
    expect(pageSrc).toContain('seq={recordSeq}');
    expect(pageSrc).toContain('currentId={recordId || group.id}');
    expect(pageSrc).toContain('onNavigate={onNavigateSeq}');
  });
});

describe('CP3 sequence nav — pig.breeding-pig', () => {
  const src = read('src/pig/SowsView.jsx');
  it('registry imports helpers and passes the visible-order sequence through route state', () => {
    expect(src).toContain(HELPER_IMPORT);
    expect(src).toContain('const breedingPigSeqRows =');
    expect(src).toContain("labeledSeqItems(rows, 'tag')");
    expect(src).toContain('recordSeqNavOptions(');
  });
  it('record router reads route-state sequence and carries it forward', () => {
    expect(src).toContain('location.state?.recordSeq');
    expect(src).toContain("navigate('/pig/sows/' + encodeURIComponent(id), recordSeqNavOptions(recordSeq))");
  });
  it('record page renders the shared RecordSequenceNav', () => {
    expect(src).toContain(NAV_IMPORT);
    expect(src).toContain('<RecordSequenceNav');
    expect(src).toContain('seq={recordSeq}');
    expect(src).toContain('currentId={recordId}');
    expect(src).toContain('onNavigate={navigateSeq}');
  });
});

// equipment.item is split: EquipmentFleetView builds the visible order and
// hands it up via onOpen; EquipmentHome (the nav owner) builds the slug-keyed
// options and renders RecordSequenceNav above the prop-driven EquipmentDetail.
describe('CP3 sequence nav — equipment.item', () => {
  const fleet = read('src/equipment/EquipmentFleetView.jsx');
  const home = read('src/equipment/EquipmentHome.jsx');
  it('fleet view builds the visible order and passes it through onOpen', () => {
    expect(fleet).toContain('const fleetSeqRows =');
    expect(fleet).toContain('onOpen(eq.slug, fleetSeqRows)');
  });
  it('fleet tiles carry a data-equipment-tile hook (CP4 test hook)', () => {
    expect(fleet).toContain('data-equipment-tile={eq.slug}');
  });
  it('home imports helpers and builds slug-keyed labeled items', () => {
    expect(home).toContain(HELPER_IMPORT);
    expect(home).toContain("labeledSeqItems(items, 'name', 'slug')");
  });
  it('home reads the sequence from route state and renders RecordSequenceNav', () => {
    expect(home).toContain('location.state?.recordSeq');
    expect(home).toContain(NAV_IMPORT);
    expect(home).toContain('<RecordSequenceNav');
  });
  it('home carries the sequence forward (slug-keyed)', () => {
    expect(home).toContain("navigate('/fleet/' + slug, recordSeqNavOptions(recordSeq))");
  });
});

// broiler.batch now follows the shared contract (the BatchForm custom side-nav
// exception was retired). Its route resolves a sequence id to the current batch
// name before navigating, so it has a bespoke (non-template) nav assertion.
describe('CP3 sequence nav — broiler.batch (now shared)', () => {
  const listSrc = read('src/broiler/BroilerListView.jsx');
  const pageSrc = read('src/broiler/BroilerBatchPage.jsx');
  const formSrc = read('src/broiler/BatchForm.jsx');

  it('list imports helpers + passes a batch-name sequence through route state', () => {
    expect(listSrc).toContain(HELPER_IMPORT);
    expect(listSrc).toContain('recordSeqNavOptions(');
    expect(listSrc).toContain("labeledSeqItems(seqRows, 'name')");
  });
  it('record page reads the sequence and renders the shared RecordSequenceNav', () => {
    expect(pageSrc).toContain('location.state?.recordSeq');
    expect(pageSrc).toContain(NAV_IMPORT);
    expect(pageSrc).toContain('<RecordSequenceNav');
  });
  it('record page carries the sequence forward (id resolved to current name)', () => {
    expect(pageSrc).toContain(
      "navigate('/broiler/batches/' + encodeURIComponent(target.name), recordSeqNavOptions(recordSeq))",
    );
  });
  it('BatchForm no longer ships a custom side-nav exception', () => {
    expect(formSrc).not.toContain('data-batchform-side-nav');
    expect(formSrc).not.toContain('onNavigatePrev');
    expect(formSrc).not.toContain('onNavigateNext');
  });
});

describe('RecordSequenceNav — fixed side controls', () => {
  const navSrc = read('src/shared/RecordSequenceNav.jsx');
  const navCss = read('src/shared/RecordSequenceNav.css');
  it('owns fixed-position side navigation styling with the stable hooks', () => {
    expect(navCss).toContain('.record-sequence-nav__button');
    expect(navCss).toContain('position: fixed');
    expect(navSrc).toContain('data-record-seq-nav');
    expect(navSrc).toContain('data-record-seq-prev');
    expect(navSrc).toContain('data-record-seq-next');
    expect(navSrc).toContain('data-record-seq-position');
  });
  it('keeps desktop controls icon-only while exposing target labels accessibly', () => {
    expect(navSrc).toContain("aria-label={prev ? 'Previous record: ' + prevLabel : 'No previous record'}");
    expect(navSrc).toContain("aria-label={next ? 'Next record: ' + nextLabel : 'No next record'}");
    expect(navSrc).toContain("title={prev ? 'Previous: ' + prevLabel : 'No previous record'}");
    expect(navSrc).toContain("title={next ? 'Next: ' + nextLabel : 'No next record'}");
    expect(navCss).toContain('@media (min-width: 701px)');
    expect(navCss).toContain('clip: rect(0, 0, 0, 0)');
  });
  it('switches to an in-flow compact mobile row instead of side-fixed controls', () => {
    expect(navSrc).toContain('data-record-seq-mobile');
    expect(navCss).toContain('@media (max-width: 700px)');
    expect(navCss).toContain('.record-sequence-nav {');
    expect(navCss).toContain('position: static');
    expect(navCss).toContain('grid-template-columns: minmax(0, 1fr) auto minmax(0, 1fr)');
    expect(navCss).toContain('transform: none');
  });
  it('renders nothing without a valid sequence', () => {
    expect(navSrc).toContain('if (index === -1) return null');
  });
});
