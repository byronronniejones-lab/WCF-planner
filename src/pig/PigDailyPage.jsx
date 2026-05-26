import React from 'react';
import {useNavigate, useLocation} from 'react-router-dom';
// eslint-disable-next-line no-unused-vars -- JSX-only use
import CommentsSection from '../shared/CommentsSection.jsx';
// eslint-disable-next-line no-unused-vars -- JSX-only use
import InlineNotice from '../shared/InlineNotice.jsx';
import {listActivityEvents, ACTIVITY_CHANGE_EVENT} from '../lib/activityApi.js';
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

export default function PigDailyPage({sb, fmt, authState, Header}) {
  const navigate = useNavigate();
  const location = useLocation();
  const recordId = location.pathname.replace('/pig/dailys/', '');

  const [record, setRecord] = React.useState(null);
  const [loading, setLoading] = React.useState(true);
  const [notice, setNotice] = React.useState(null);
  const [activityExpanded, setActivityExpanded] = React.useState(false);
  const [activityEvents, setActivityEvents] = React.useState([]);
  const [activityCount, setActivityCount] = React.useState(0);

  async function loadAll() {
    const {data} = await sb.from('pig_dailys').select('*').eq('id', recordId).is('deleted_at', null).single();
    if (data) setRecord(data);
    setLoading(false);
  }

  React.useEffect(() => {
    setRecord(null);
    setLoading(true);
    setNotice(null);
    setActivityExpanded(false);
    setActivityEvents([]);
    setActivityCount(0);
    loadAll();
  }, [recordId]);

  React.useEffect(() => {
    if (!activityExpanded || !record) return;
    let cancelled = false;
    (async () => {
      try {
        const rows = await listActivityEvents(sb, 'pig.daily', record.id, {limit: 50});
        if (cancelled) return;
        const auditOnly = (rows || []).filter((e) => e.event_type !== 'comment.posted');
        setActivityEvents(auditOnly);
        setActivityCount(auditOnly.filter((e) => !e.deleted_at).length);
      } catch (_e) {
        /* soft-fail */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [activityExpanded, record?.id]);

  React.useEffect(() => {
    if (!record) return;
    listActivityEvents(sb, 'pig.daily', record.id, {limit: 50}).then((rows) => {
      const auditOnly = (rows || []).filter((e) => e.event_type !== 'comment.posted');
      setActivityCount(auditOnly.filter((e) => !e.deleted_at).length);
    });
  }, [record?.id]);

  React.useEffect(() => {
    function onActivityChange() {
      if (!record || !activityExpanded) return;
      listActivityEvents(sb, 'pig.daily', record.id, {limit: 50}).then((rows) => {
        const auditOnly = (rows || []).filter((e) => e.event_type !== 'comment.posted');
        setActivityEvents(auditOnly);
        setActivityCount(auditOnly.filter((e) => !e.deleted_at).length);
      });
    }
    window.addEventListener(ACTIVITY_CHANGE_EVENT, onActivityChange);
    return () => window.removeEventListener(ACTIVITY_CHANGE_EVENT, onActivityChange);
  }, [record?.id, activityExpanded]);

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
        const label = record.date + (record.batch_label ? ' · ' + record.batch_label : '');
        await softDeleteDailyReport(sb, 'pig.daily', record.id, label);
        navigate('/pig/dailys');
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
            onClick={() => navigate('/pig/dailys')}
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
            ← Back to Daily Reports
          </button>
          <div style={{marginTop: 16, color: '#6b7280', fontSize: 14}}>
            Daily report not found. It may have been deleted.
          </div>
        </div>
      </div>
    );
  }

  const entityLabel = record.date + (record.batch_label ? ' · ' + record.batch_label : '');

  return (
    <div style={{minHeight: '100vh', background: '#f1f3f2'}}>
      {Header && <Header />}
      <div style={{maxWidth: 800, margin: '0 auto', padding: '12px 16px'}}>
        <div style={{marginBottom: 12}}>
          <button
            type="button"
            onClick={() => navigate('/pig/dailys')}
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
            ← Back to Daily Reports
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
            <span style={fieldLabel}>Batch</span>
            <span>{record.batch_label || '—'}</span>
          </div>
          <div style={fieldRow}>
            <span style={fieldLabel}>Team member</span>
            <span>{record.team_member || '—'}</span>
          </div>
          <div style={fieldRow}>
            <span style={fieldLabel}>Pig count</span>
            <span>{record.pig_count != null ? record.pig_count : '—'}</span>
          </div>
          <div style={fieldRow}>
            <span style={fieldLabel}>Feed (lbs)</span>
            <span>{record.feed_lbs != null ? record.feed_lbs : '—'}</span>
          </div>
          <div style={fieldRow}>
            <span style={fieldLabel}>Fence voltage</span>
            <span>{record.fence_voltage != null ? record.fence_voltage + ' kV' : '—'}</span>
          </div>
          <div style={fieldRow}>
            <span style={fieldLabel}>Group moved</span>
            <span>{record.group_moved === false ? 'No' : 'Yes'}</span>
          </div>
          <div style={fieldRow}>
            <span style={fieldLabel}>Nipple drinker moved</span>
            <span>{record.nipple_drinker_moved === false ? 'No' : 'Yes'}</span>
          </div>
          <div style={fieldRow}>
            <span style={fieldLabel}>Nipple drinker working</span>
            <span>{record.nipple_drinker_working === false ? 'No' : 'Yes'}</span>
          </div>
          <div style={fieldRow}>
            <span style={fieldLabel}>Troughs moved</span>
            <span>{record.troughs_moved === false ? 'No' : 'Yes'}</span>
          </div>
          <div style={fieldRow}>
            <span style={fieldLabel}>Fence walked</span>
            <span>{record.fence_walked === false ? 'No' : 'Yes'}</span>
          </div>
          {record.issues && (
            <div style={fieldRow}>
              <span style={fieldLabel}>Issues</span>
              <span>{record.issues}</span>
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
            entityType="pig.daily"
            entityId={record.id}
            entityLabel={entityLabel}
          />
        </div>

        <div style={{marginTop: 16}}>
          <button
            type="button"
            data-activity-log-toggle="1"
            onClick={() => setActivityExpanded((p) => !p)}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              background: 'white',
              border: '1px solid #e5e7eb',
              borderRadius: 10,
              padding: '10px 14px',
              cursor: 'pointer',
              fontSize: 13,
              fontWeight: 600,
              color: '#374151',
              fontFamily: 'inherit',
              width: '100%',
              textAlign: 'left',
            }}
          >
            <span style={{fontSize: 10}}>{activityExpanded ? '▼' : '▶'}</span>
            Activity log ({activityCount})
          </button>
          {activityExpanded && (
            <div
              data-activity-audit-log="1"
              style={{
                background: 'white',
                border: '1px solid #e5e7eb',
                borderTop: 'none',
                borderRadius: '0 0 10px 10px',
                padding: 14,
              }}
            >
              {activityEvents.length === 0 && (
                <div style={{fontSize: 12.5, color: '#6b7280'}}>No audit events yet.</div>
              )}
              {activityEvents.map((ev) => (
                <div key={ev.id} style={{padding: '6px 0', borderBottom: '1px solid #f3f4f6', fontSize: 12}}>
                  <span style={{fontWeight: 700, color: '#111827', fontSize: 12.5}}>
                    {ev.actor_display_name || (ev.actor_profile_id ? 'Unknown user' : 'System')}
                  </span>{' '}
                  <span
                    style={{
                      fontSize: 10,
                      fontWeight: 700,
                      textTransform: 'uppercase',
                      padding: '1px 6px',
                      borderRadius: 4,
                      background: '#e0f2fe',
                      color: '#075985',
                    }}
                  >
                    {ev.event_type.replace('.', ' ')}
                  </span>
                  {' · '}
                  <span style={{color: '#6b7280'}}>
                    {(() => {
                      try {
                        const d = new Date(ev.created_at);
                        const diff = (Date.now() - d.getTime()) / 1000;
                        if (diff < 60) return 'just now';
                        if (diff < 3600) return Math.floor(diff / 60) + 'm ago';
                        if (diff < 86400) return Math.floor(diff / 3600) + 'h ago';
                        return d.toLocaleString();
                      } catch (_e) {
                        return ev.created_at;
                      }
                    })()}
                  </span>
                  {ev.body && <div style={{color: '#374151', marginTop: 2}}>{ev.body}</div>}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
