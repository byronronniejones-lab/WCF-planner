import React from 'react';
import {useNavigate, useLocation} from 'react-router-dom';
// eslint-disable-next-line no-unused-vars -- JSX-only use
import CommentsSection from '../shared/CommentsSection.jsx';
// eslint-disable-next-line no-unused-vars -- JSX-only use
import InlineNotice from '../shared/InlineNotice.jsx';
// eslint-disable-next-line no-unused-vars -- JSX-only use
import RecordActivityLog from '../shared/RecordActivityLog.jsx';
import {softDeleteDailyReport, canDeleteDailyReport} from '../lib/dailyReportsApi.js';

const fieldRow = {
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'center',
  padding: '6px 0',
  borderBottom: '1px solid #f3f4f6',
  fontSize: 13,
};
const fieldLabel = {fontWeight: 600, color: '#4b5563', fontSize: 12};

export default function EggDailyPage({sb, fmt, authState, Header}) {
  const navigate = useNavigate();
  const location = useLocation();
  const recordId = location.pathname.replace('/layer/eggs/', '');

  const [record, setRecord] = React.useState(null);
  const [loading, setLoading] = React.useState(true);
  const [notice, setNotice] = React.useState(null);

  async function loadAll() {
    const {data} = await sb.from('egg_dailys').select('*').eq('id', recordId).is('deleted_at', null).single();
    if (data) setRecord(data);
    setLoading(false);
  }

  React.useEffect(() => {
    setRecord(null);
    setLoading(true);
    setNotice(null);
    loadAll();
  }, [recordId]);

  React.useEffect(() => {
    if (!loading && location.hash) {
      const anchor = location.hash.slice(1);
      setTimeout(() => {
        const el = document.getElementById(anchor);
        if (el) el.scrollIntoView({behavior: 'smooth', block: 'center'});
      }, 200);
    }
  }, [loading, location.hash]);

  async function handleDelete() {
    if (!window._wcfConfirmDelete) return;
    window._wcfConfirmDelete('Delete this daily report?', async () => {
      try {
        const label = record.date;
        await softDeleteDailyReport(sb, 'egg.daily', record.id, label);
        navigate('/layer/eggs');
      } catch (e) {
        setNotice({kind: 'error', message: 'Delete failed: ' + (e.message || String(e))});
      }
    });
  }

  if (loading) {
    return (
      <div style={{minHeight: '100vh', background: '#f1f3f2'}}>
        {Header && <Header />}
        <div style={{padding: 24, textAlign: 'center', color: '#6b7280', fontSize: 14}}>Loading…</div>
      </div>
    );
  }

  if (!record) {
    return (
      <div style={{minHeight: '100vh', background: '#f1f3f2'}}>
        {Header && <Header />}
        <div style={{padding: 24}}>
          <button
            type="button"
            onClick={() => navigate('/layer/eggs')}
            style={{
              background: 'none',
              border: 'none',
              color: '#1d4ed8',
              cursor: 'pointer',
              fontSize: 14,
              fontFamily: 'inherit',
              padding: 0,
            }}
          >
            ← Back to Egg Reports
          </button>
          <div style={{marginTop: 16, color: '#6b7280', fontSize: 14}}>
            Egg report not found. It may have been deleted.
          </div>
        </div>
      </div>
    );
  }

  const entityLabel = record.date;

  return (
    <div style={{minHeight: '100vh', background: '#f1f3f2'}}>
      {Header && <Header />}
      <div style={{maxWidth: 800, margin: '0 auto', padding: '12px 16px'}}>
        <div style={{marginBottom: 12}}>
          <button
            type="button"
            onClick={() => navigate('/layer/eggs')}
            style={{
              background: 'none',
              border: 'none',
              color: '#1d4ed8',
              cursor: 'pointer',
              fontSize: 14,
              fontFamily: 'inherit',
              padding: 0,
              fontWeight: 500,
            }}
          >
            ← Back to Egg Reports
          </button>
        </div>

        <h1
          data-record-title="1"
          style={{fontSize: 28, fontWeight: 700, color: '#111827', margin: '0 0 12px', lineHeight: 1.2}}
        >
          {entityLabel}
        </h1>

        {notice && <InlineNotice kind={notice.kind} message={notice.message} onDismiss={() => setNotice(null)} />}

        <div
          key={record.id}
          style={{background: 'white', border: '1px solid #e5e7eb', borderRadius: 10, padding: '14px 18px'}}
        >
          <div style={fieldRow}>
            <span style={fieldLabel}>Date</span>
            <span>{record.date || '—'}</span>
          </div>
          <div style={fieldRow}>
            <span style={fieldLabel}>Team member</span>
            <span>{record.team_member || '—'}</span>
          </div>
          {record.group1_name && (
            <div style={fieldRow}>
              <span style={fieldLabel}>{record.group1_name}</span>
              <span>{record.group1_count != null ? record.group1_count : '—'}</span>
            </div>
          )}
          {record.group2_name && (
            <div style={fieldRow}>
              <span style={fieldLabel}>{record.group2_name}</span>
              <span>{record.group2_count != null ? record.group2_count : '—'}</span>
            </div>
          )}
          {record.group3_name && (
            <div style={fieldRow}>
              <span style={fieldLabel}>{record.group3_name}</span>
              <span>{record.group3_count != null ? record.group3_count : '—'}</span>
            </div>
          )}
          {record.group4_name && (
            <div style={fieldRow}>
              <span style={fieldLabel}>{record.group4_name}</span>
              <span>{record.group4_count != null ? record.group4_count : '—'}</span>
            </div>
          )}
          <div style={fieldRow}>
            <span style={fieldLabel}>Dozens on hand</span>
            <span>{record.dozens_on_hand != null ? record.dozens_on_hand : '—'}</span>
          </div>
          {record.comments && (
            <div style={fieldRow}>
              <span style={fieldLabel}>Comments</span>
              <span>{record.comments}</span>
            </div>
          )}
        </div>

        {canDeleteDailyReport(authState) && (
          <button
            onClick={handleDelete}
            style={{
              marginTop: 12,
              padding: '8px 18px',
              borderRadius: 8,
              border: '1px solid #fca5a5',
              background: '#fef2f2',
              color: '#b91c1c',
              fontWeight: 600,
              fontSize: 12,
              cursor: 'pointer',
              fontFamily: 'inherit',
            }}
          >
            Delete report
          </button>
        )}

        <div style={{marginTop: 16}}>
          <CommentsSection
            sb={sb}
            authState={authState}
            entityType="egg.daily"
            entityId={record.id}
            entityLabel={entityLabel}
          />
        </div>

        <div style={{marginTop: 16}}>
          <RecordActivityLog sb={sb} entityType="egg.daily" entityId={record.id} />
        </div>
      </div>
    </div>
  );
}
