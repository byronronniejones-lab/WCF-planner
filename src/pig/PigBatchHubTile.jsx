import {S} from '../lib/styles.js';

// Presentational nav-only hub tile for one pig feeder batch (CP6 extraction
// from PigBatchesView). Render-only: the caller computes `current` (ledger
// current count) and `started` because those need breeders + dailys; this
// component just displays them and routes on click. Clicking opens the
// /pig/batches/<id> record page via the caller-supplied onOpen.
export default function PigBatchHubTile({group, current, started, statusColor, onOpen}) {
  return (
    <div
      data-pig-batch-tile={group.id}
      onClick={onOpen}
      style={{
        background: 'white',
        border: '1px solid #e5e7eb',
        borderRadius: 12,
        padding: '12px 16px',
        marginBottom: 10,
        cursor: 'pointer',
        display: 'flex',
        flexWrap: 'wrap',
        gap: '6px 16px',
        alignItems: 'center',
      }}
    >
      <strong style={{fontSize: 14, color: '#111827'}}>{group.batchName}</strong>
      <span style={S.badge(statusColor.bg, statusColor.tx)}>{group.status}</span>
      {current !== null ? (
        <span style={{fontSize: 13, color: '#374151'}}>
          Current: <strong>{current}</strong>
        </span>
      ) : (
        started > 0 && <span style={{fontSize: 13, color: '#6b7280'}}>Started: {started}</span>
      )}
      <span style={{marginLeft: 'auto', fontSize: 12, color: '#085041', fontWeight: 600}}>{'Open →'}</span>
    </div>
  );
}
